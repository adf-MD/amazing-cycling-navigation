import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import { exportRouteToGpx } from "../../gpx/exportGpx.ts";
import { MapView, type CameraTarget, type PlanningOverlay } from "../../map/MapView.tsx";
import type { MapFactory } from "../../map/mapAdapter.ts";
import { getApproximateLocationOnce } from "../../platform/geolocation.ts";
import { logError } from "../../platform/errorLog.ts";
import { systemClock, useNow, type Clock } from "../../platform/clock.ts";
import { OpenRouteServiceAdapter } from "../../routing/openRouteServiceAdapter.ts";
import type { RoutingProvider } from "../../routing/provider.ts";
import {
  getProviderKey,
  getProviderKeyVerification,
} from "../../storage/providerKeyRepository.ts";
import {
  clearDraft,
  getDraft,
  saveDraft,
} from "../../storage/planningDraftRepository.ts";
import { saveRoute } from "../../storage/routesRepository.ts";
import { downloadTextFile } from "../shared/downloadTextFile.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { describeProviderKeyStatus } from "../settings/providerKeyStatus.ts";
import { canSaveOrExportPlan } from "./canSaveOrExportPlan.ts";
import { NoApiKeyNotice } from "./NoApiKeyNotice.tsx";
import { RouteSummaryPanel } from "./RouteSummaryPanel.tsx";
import { usePlanningRoute } from "./usePlanningRoute.ts";
import {
  INITIAL_WAYPOINT_HISTORY_STATE,
  sameCoordinate,
  waypointHistoryReducer,
} from "./waypointHistory.ts";
import { WaypointList } from "./WaypointList.tsx";

export interface PlanningScreenProps {
  onNavigateToSettings: () => void;
  onRouteSaved?: (route: PlannedRoute) => void;
  mapFactory?: MapFactory;
  /** Injectable for tests; defaults to a real OpenRouteServiceAdapter
   * reading the user's stored key fresh on every request. */
  routingProvider?: RoutingProvider;
  /** Injectable for tests; defaults to a real one-shot, low-accuracy
   * location request (see getApproximateLocationOnce). */
  requestApproximateLocation?: () => Promise<Coordinate | null>;
  clock?: Clock;
}

/** How long to wait, after a settled waypoint edit, before persisting the
 * draft — the same debounce boundary usePlanningRoute applies to
 * recalculation, so a rapid burst of edits writes once, not per edit. */
const DRAFT_DEBOUNCE_MS = 900;

/** Regional/country scale — deliberately not a street-level zoom. Used only
 * to frame a genuinely fresh Planning session around the rider's
 * approximate location; a calculated route reframes the view itself once
 * it exists. */
const INITIAL_LOCATION_ZOOM = 6;

function buildDefaultAdapter(): RoutingProvider {
  return new OpenRouteServiceAdapter({
    getApiKey: () => getProviderKey().then((key) => key?.apiKey),
  });
}

/**
 * Orchestrates waypoint editing, debounced route calculation, draft
 * persistence and save/export — the map's own lifecycle, sources and
 * layers stay entirely inside MapView (see planningOverlay there); this
 * component only ever produces the data and callbacks that prop expects.
 */
export function PlanningScreen({
  onNavigateToSettings,
  onRouteSaved,
  mapFactory,
  routingProvider,
  requestApproximateLocation = getApproximateLocationOnce,
  clock = systemClock,
}: PlanningScreenProps) {
  // Created once, ignoring any later identity change of the routingProvider
  // prop — mirrors how mapFactory/clock are treated elsewhere in this
  // project as effectively-stable injectable dependencies.
  const [adapter] = useState<RoutingProvider>(
    () => routingProvider ?? buildDefaultAdapter(),
  );

  const [state, dispatch] = useReducer(
    waypointHistoryReducer,
    INITIAL_WAYPOINT_HISTORY_STATE,
  );
  const [avoidFerries, setAvoidFerries] = useState(true);
  const [routeName, setRouteName] = useState("Planned route");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [crosshairCoordinate, setCrosshairCoordinate] = useState<Coordinate | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [initialCameraTarget, setInitialCameraTarget] = useState<CameraTarget | null>(
    null,
  );

  const keyQuery = useCallback(() => getProviderKey(), []);
  const key = useLiveQuery(keyQuery);
  // Ambiguous while the live query is still loading versus genuinely
  // unset — the same brief, imperceptible flash-on-load already accepted
  // by every other useLiveQuery consumer in this codebase (e.g.
  // SettingsScreen), rather than adding a second loading concept.
  const hasKey = key !== undefined;

  // Reuses Settings' own key-verification status so the rider can see
  // whether their key/connection to OpenRouteService actually works
  // without having to leave Planning — updated automatically after every
  // calculation attempt via recordProviderKeyVerification.
  const verificationQuery = useCallback(() => getProviderKeyVerification(), []);
  const verification = useLiveQuery(verificationQuery);
  const now = useNow(clock);

  const routing = usePlanningRoute({
    waypoints: state.present,
    profile: "cycling-road",
    avoidFerries,
    adapter,
  });

  // Loads any previously saved draft exactly once, before draft-persisting
  // starts below — otherwise the persist effect's first run (an empty
  // array, before the load resolves) could overwrite a real saved draft.
  useEffect(() => {
    let cancelled = false;
    getDraft()
      .then((draft) => {
        if (cancelled) return;
        if (draft && draft.waypoints.length > 0) {
          dispatch({ type: "reset", waypoints: draft.waypoints });
        }
        setIsDraftHydrated(true);
      })
      .catch((error: unknown) => {
        logError("planning-load-draft", error);
        setIsDraftHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDraftHydrated) return;
    const timeoutId = window.setTimeout(() => {
      const persist =
        state.present.length === 0 ? clearDraft() : saveDraft(state.present);
      persist.catch((error: unknown) => {
        logError("planning-save-draft", error);
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [state.present, isDraftHydrated]);

  // Read fresh inside the location effect below rather than depending on
  // state.present directly, so a waypoint added while the location request
  // is still pending is seen without re-triggering the request itself.
  const waypointsRef = useRef(state.present);
  useEffect(() => {
    waypointsRef.current = state.present;
  }, [state.present]);

  // Frames a genuinely fresh Planning session (no restored draft, no
  // waypoints yet) around the rider's approximate location, once — never
  // re-requested for this component instance, and skipped entirely once
  // there's already something to show, so it can never fight a restored
  // draft or waypoints placed before the fix resolves.
  const hasRequestedInitialLocationRef = useRef(false);
  useEffect(() => {
    if (!isDraftHydrated || hasRequestedInitialLocationRef.current) return;
    hasRequestedInitialLocationRef.current = true;
    if (waypointsRef.current.length > 0) return;
    requestApproximateLocation()
      .then((coordinate) => {
        if (!coordinate || waypointsRef.current.length > 0) return;
        setInitialCameraTarget({
          coordinate,
          zoom: INITIAL_LOCATION_ZOOM,
          bearingDegrees: 0,
          pitchDegrees: 0,
          animate: false,
          followOffset: false,
        });
      })
      .catch((error: unknown) => {
        logError("planning-initial-location", error);
      });
  }, [isDraftHydrated, requestApproximateLocation]);

  // Add-or-move: with a waypoint selected, a tap/click relocates it;
  // otherwise it appends (or inserts after the selected waypoint — see
  // waypointHistoryReducer's "add"). Shared by the map tap and the
  // crosshair button, so both paths behave identically.
  const handleAddOrMoveAt = useCallback(
    (coordinate: Coordinate) => {
      if (state.selectedWaypointId) {
        dispatch({ type: "move", waypointId: state.selectedWaypointId, coordinate });
      } else {
        dispatch({ type: "add", coordinate });
      }
    },
    [state.selectedWaypointId],
  );

  const handleAddOrMoveHere = () => {
    if (!crosshairCoordinate) return;
    handleAddOrMoveAt(crosshairCoordinate);
  };

  const selectedIndex = state.selectedWaypointId
    ? state.present.findIndex((waypoint) => waypoint.id === state.selectedWaypointId)
    : -1;
  const selectedWaypointIndex = selectedIndex === -1 ? null : selectedIndex;

  const first = state.present[0];
  const last = state.present.at(-1);
  const canReturnToStart =
    state.present.length >= 2 &&
    !!first &&
    !!last &&
    !sameCoordinate(first.coordinate, last.coordinate);

  const canSaveOrExport = canSaveOrExportPlan(routing.state);

  const handleSave = () => {
    if (routing.state.kind !== "routed") return;
    const routeToSave: PlannedRoute = {
      ...routing.state.route,
      name: routeName.trim() || "Planned route",
    };
    setSaveError(null);
    saveRoute(routeToSave)
      .then(() => clearDraft())
      .then(() => {
        dispatch({ type: "reset", waypoints: [] });
        setRouteName("Planned route");
        onRouteSaved?.(routeToSave);
      })
      .catch((error: unknown) => {
        logError("planning-save-route", error);
        setSaveError("The route could not be saved on this device. Try again.");
      });
  };

  const handleExport = () => {
    if (routing.state.kind !== "routed") return;
    const trimmedName = routeName.trim() || "Planned route";
    const routeToExport: PlannedRoute = { ...routing.state.route, name: trimmedName };
    downloadTextFile(
      `${trimmedName}.gpx`,
      exportRouteToGpx(routeToExport),
      "application/gpx+xml",
    );
  };

  const planningOverlay: PlanningOverlay = {
    waypoints: state.present,
    // Only shown before/between calculations — once routed, the real
    // geometry is already visible via `points` below, and this preview
    // must never be mixed with it (see planningLayer.ts).
    previewCoordinates:
      routing.state.kind === "routed" ? [] : state.present.map((w) => w.coordinate),
    selectedWaypointIndex,
    onMapTap: handleAddOrMoveAt,
  };

  const mapPoints = routing.state.kind === "routed" ? routing.state.route.points : [];

  return (
    <section aria-label="Planning">
      <h2>Plan a route</h2>

      {!hasKey ? <NoApiKeyNotice onOpenSettings={onNavigateToSettings} /> : null}

      <div style={{ height: 320, position: "relative" }}>
        <MapView
          points={mapPoints}
          mapFactory={mapFactory}
          planningOverlay={planningOverlay}
          cameraTarget={initialCameraTarget}
          onCameraSettled={(camera) => {
            setCrosshairCoordinate(camera.coordinate);
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 16,
            height: 16,
            marginTop: -8,
            marginLeft: -8,
            border: "2px solid #d32f2f",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
        <button
          type="button"
          onClick={handleAddOrMoveHere}
          disabled={!crosshairCoordinate}
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            minHeight: 44,
          }}
        >
          {state.selectedWaypointId ? "Move selected waypoint here" : "Add waypoint here"}
        </button>
      </div>

      <div role="group" aria-label="Waypoint actions">
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "undo" });
          }}
          disabled={state.past.length === 0}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "redo" });
          }}
          disabled={state.future.length === 0}
        >
          Redo
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "returnToStart" });
          }}
          disabled={!canReturnToStart}
        >
          Return to start
        </button>
        {state.selectedWaypointId ? (
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "select", waypointId: null });
            }}
          >
            Clear selection
          </button>
        ) : null}
      </div>

      <WaypointList
        waypoints={state.present}
        selectedWaypointId={state.selectedWaypointId}
        onSelect={(waypointId) => {
          dispatch({ type: "select", waypointId });
        }}
        onMoveUp={(waypointId) => {
          const index = state.present.findIndex((w) => w.id === waypointId);
          dispatch({ type: "reorder", waypointId, toIndex: index - 1 });
        }}
        onMoveDown={(waypointId) => {
          const index = state.present.findIndex((w) => w.id === waypointId);
          dispatch({ type: "reorder", waypointId, toIndex: index + 1 });
        }}
        onDelete={(waypointId) => {
          dispatch({ type: "delete", waypointId });
        }}
      />

      <div>
        <label>
          <input
            type="checkbox"
            checked={avoidFerries}
            onChange={(event) => {
              setAvoidFerries(event.target.checked);
            }}
          />
          Avoid ferries
        </label>
      </div>

      <button
        type="button"
        onClick={routing.calculateNow}
        disabled={state.present.length < 2 || !hasKey || routing.isCalculating}
      >
        {routing.isCalculating ? "Calculating…" : "Calculate route"}
      </button>
      {hasKey ? (
        <p role="status">{describeProviderKeyStatus(key, verification, now).headline}</p>
      ) : null}
      {routing.lastErrorMessage ? <p role="alert">{routing.lastErrorMessage}</p> : null}

      {routing.state.kind === "routed" ? (
        <RouteSummaryPanel
          route={routing.state.route}
          waypointCount={routing.state.waypoints.length}
        />
      ) : null}

      <div>
        <label htmlFor="planning-route-name">Route name</label>
        <input
          id="planning-route-name"
          type="text"
          value={routeName}
          onChange={(event) => {
            setRouteName(event.target.value);
          }}
        />
      </div>
      {!canSaveOrExport ? (
        <p>Calculate a complete routed result before saving or exporting.</p>
      ) : null}
      {saveError ? <p role="alert">{saveError}</p> : null}
      <button type="button" onClick={handleSave} disabled={!canSaveOrExport}>
        Save route
      </button>
      <button type="button" onClick={handleExport} disabled={!canSaveOrExport}>
        Export GPX
      </button>
    </section>
  );
}
