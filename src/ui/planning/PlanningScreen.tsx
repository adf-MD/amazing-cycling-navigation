import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import { exportRouteToGpx } from "../../gpx/exportGpx.ts";
import {
  MapView,
  type CameraTarget,
  type PlanningOverlay,
  type WarningOverlay,
} from "../../map/MapView.tsx";
import type { MapFactory } from "../../map/mapAdapter.ts";
import { coalesceAdjacentWarnings } from "../../navigation/warningGeometry.ts";
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
import {
  deriveInteractionMode,
  describeCrosshairAction,
  type PendingWaypointAction,
} from "./planningInteractionMode.ts";
import { RouteSummaryPanel } from "./RouteSummaryPanel.tsx";
import { usePlanningRoute } from "./usePlanningRoute.ts";
import type { WaypointAction } from "./waypointHistory.ts";
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
  const [selectedWarningIndex, setSelectedWarningIndex] = useState<number | null>(null);
  // Tracks which waypoint a pending move/insert-after applies to,
  // alongside the action itself — so a selection change to a *different*
  // waypoint (or to none) automatically invalidates a stale pending
  // action just by no longer matching, with no separate reset effect/ref
  // needed. "move" doesn't change selectedWaypointId (see
  // waypointHistory.ts), so the one-shot completion in handlePlacementAt
  // below still clears this explicitly rather than relying on that.
  const [pendingWaypointAction, setPendingWaypointAction] = useState<{
    waypointId: string;
    kind: "move" | "insert-after";
  } | null>(null);

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

  // Extracted before memoizing: usePlanningRoute's returned state object is
  // reconstructed every render even when nothing changed, so memoizing
  // displayWarnings directly off `routing.state` would re-slice warning
  // geometry on every unrelated render (e.g. every keystroke in the route
  // name field).
  const routedRoute = routing.state.kind === "routed" ? routing.state.route : null;
  const displayWarnings = useMemo(
    () => (routedRoute ? coalesceAdjacentWarnings(routedRoute.warnings) : []),
    [routedRoute],
  );

  // A new calculation invalidates the previous selection — the warnings
  // array is rebuilt wholesale each time (see RouteSummaryPanel), so a
  // stale index could otherwise point at an unrelated warning. Adjusted
  // directly during render (React's documented pattern for resetting
  // state when a derived value changes) rather than in an effect, which
  // would cause an avoidable extra render.
  const lastRoutedRouteForSelectionRef = useRef<PlannedRoute | null>(null);
  if (lastRoutedRouteForSelectionRef.current !== routedRoute) {
    lastRoutedRouteForSelectionRef.current = routedRoute;
    if (selectedWarningIndex !== null) {
      setSelectedWarningIndex(null);
    }
  }

  // A pending action only counts while it still applies to the currently
  // selected waypoint — a selection change to a different waypoint (or to
  // none) invalidates it just by no longer matching, computed fresh each
  // render rather than needing an explicit reset.
  const effectivePendingAction: PendingWaypointAction =
    pendingWaypointAction?.waypointId === state.selectedWaypointId
      ? pendingWaypointAction.kind
      : null;
  const interactionMode = deriveInteractionMode(
    state.selectedWaypointId,
    effectivePendingAction,
  );

  // Every waypoint-history dispatch also clears any active warning
  // selection ("selecting or editing a waypoint clears the warning
  // selection") — centralised here so no call site (including undo/redo)
  // can forget it. Without this, a stale warning selection could keep
  // wrongly blocking placement for the ~900ms-plus-network gap until the
  // next recalculation lands (see handlePlacementAt's own guard below).
  const dispatchWaypointAction = useCallback(
    (action: WaypointAction) => {
      if (selectedWarningIndex !== null) setSelectedWarningIndex(null);
      dispatch(action);
    },
    [selectedWarningIndex],
  );

  const handleSelectWarning = useCallback((index: number) => {
    // "Selecting a warning clears any waypoint movement/insertion mode."
    setPendingWaypointAction(null);
    setSelectedWarningIndex(index);
  }, []);
  // Deliberately does not restore pendingWaypointAction — clearing a
  // warning selection returns to a non-destructive state rather than
  // guessing the rider's previous placement intention.
  const handleClearWarningSelection = useCallback(() => {
    setSelectedWarningIndex(null);
  }, []);

  // Both toggle: clicking an already-active Move/Insert-after button
  // cancels it, returning to plain "selected" — the same aria-pressed
  // affordance doubling as a cancel control.
  const handleStartMove = useCallback(
    (waypointId: string) => {
      if (selectedWarningIndex !== null) setSelectedWarningIndex(null);
      setPendingWaypointAction((current) =>
        current?.waypointId === waypointId && current.kind === "move"
          ? null
          : { waypointId, kind: "move" },
      );
    },
    [selectedWarningIndex],
  );
  const handleStartInsertAfter = useCallback(
    (waypointId: string) => {
      if (selectedWarningIndex !== null) setSelectedWarningIndex(null);
      setPendingWaypointAction((current) =>
        current?.waypointId === waypointId && current.kind === "insert-after"
          ? null
          : { waypointId, kind: "insert-after" },
      );
    },
    [selectedWarningIndex],
  );

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
          setRouteName(draft.routeName);
          setAvoidFerries(draft.avoidFerries);
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

  // A separate 900ms debounce from usePlanningRoute's own recalculation
  // debounce below — this one persists the draft (waypoints, route name,
  // avoid-ferries), so it deliberately DOES depend on routeName/
  // avoidFerries, unlike the routing debounce, which never receives them.
  useEffect(() => {
    if (!isDraftHydrated) return;
    const timeoutId = window.setTimeout(() => {
      const persist =
        state.present.length === 0
          ? clearDraft()
          : saveDraft({ waypoints: state.present, routeName, avoidFerries });
      persist.catch((error: unknown) => {
        logError("planning-save-draft", error);
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [state.present, routeName, avoidFerries, isDraftHydrated]);

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

  // --- Future event-priority policy (map-to-list warning tapping) ---
  // Not implemented this slice — there is no warning-layer hit testing yet
  // (mapAdapter.ts's onMapTap is a single map-wide click listener, not
  // layer-scoped; nothing calls queryRenderedFeatures). When that lands, a
  // single map tap must resolve to exactly ONE of the following, in order:
  //   1. The tap hits a selectable warning or waypoint feature — select
  //      that feature; it must never also append/move/insert a waypoint.
  //   2. Otherwise, if there is an explicit active move/insert-after
  //      operation, the tap completes that operation.
  //   3. Otherwise, a bare tap only appends when append mode is visibly
  //      active — never just because nothing else matched ("selected"
  //      mode with no pending move/insert still does nothing on a bare
  //      tap, see below).
  // Panning/zooming never go through onMapTap at all, so are unaffected.
  //
  // Shared by both the map tap and the crosshair button, so both paths
  // behave identically.
  const handlePlacementAt = useCallback(
    (coordinate: Coordinate) => {
      // Warning inspection takes priority — "a bare map tap must not
      // append or move a waypoint" while a warning is selected and framed.
      if (selectedWarningIndex !== null) return;
      switch (interactionMode.kind) {
        case "append":
          dispatchWaypointAction({ type: "append", coordinate });
          break;
        case "move":
          dispatchWaypointAction({
            type: "move",
            waypointId: interactionMode.waypointId,
            coordinate,
          });
          setPendingWaypointAction(null);
          break;
        case "insert-after":
          dispatchWaypointAction({
            type: "insertAfter",
            afterWaypointId: interactionMode.waypointId,
            coordinate,
          });
          setPendingWaypointAction(null);
          break;
        case "selected":
          // Merely inspecting — no implicit geometry change from a tap.
          break;
      }
    },
    [interactionMode, selectedWarningIndex, dispatchWaypointAction],
  );

  const handlePlacementHere = () => {
    if (!crosshairCoordinate) return;
    handlePlacementAt(crosshairCoordinate);
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
        dispatchWaypointAction({ type: "reset", waypoints: [] });
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
    onMapTap: handlePlacementAt,
  };

  const mapPoints = routing.state.kind === "routed" ? routing.state.route.points : [];

  const warningOverlay: WarningOverlay = {
    warnings: displayWarnings,
    selectedWarningIndex,
  };

  return (
    <section aria-label="Planning">
      <h2>Plan a route</h2>

      {!hasKey ? <NoApiKeyNotice onOpenSettings={onNavigateToSettings} /> : null}

      <div style={{ height: 320, position: "relative" }}>
        <MapView
          points={mapPoints}
          mapFactory={mapFactory}
          planningOverlay={planningOverlay}
          warningOverlay={warningOverlay}
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
          onClick={handlePlacementHere}
          disabled={
            !crosshairCoordinate ||
            interactionMode.kind === "selected" ||
            selectedWarningIndex !== null
          }
          style={{
            position: "absolute",
            // Clears the map-attribution overlay's bottom-left corner
            // (src/index.css's .map-attribution) on narrow phone widths,
            // where this centred button would otherwise sit underneath it.
            bottom: 44,
            left: "50%",
            transform: "translateX(-50%)",
            minHeight: 44,
          }}
        >
          {describeCrosshairAction(interactionMode, state.present)}
        </button>
        {selectedWarningIndex !== null ? (
          <p role="status">Clear the selected warning to place or move a waypoint.</p>
        ) : null}
      </div>

      <div role="group" aria-label="Waypoint actions">
        <button
          type="button"
          onClick={() => {
            dispatchWaypointAction({ type: "undo" });
          }}
          disabled={state.past.length === 0}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => {
            dispatchWaypointAction({ type: "redo" });
          }}
          disabled={state.future.length === 0}
        >
          Redo
        </button>
        <button
          type="button"
          onClick={() => {
            dispatchWaypointAction({ type: "returnToStart" });
          }}
          disabled={!canReturnToStart}
        >
          Return to start
        </button>
        {state.selectedWaypointId ? (
          <button
            type="button"
            onClick={() => {
              dispatchWaypointAction({ type: "select", waypointId: null });
            }}
          >
            Add to end
          </button>
        ) : null}
      </div>

      <WaypointList
        waypoints={state.present}
        interactionMode={interactionMode}
        onSelect={(waypointId) => {
          dispatchWaypointAction({ type: "select", waypointId });
        }}
        onStartMove={handleStartMove}
        onStartInsertAfter={handleStartInsertAfter}
        onMoveUp={(waypointId) => {
          const index = state.present.findIndex((w) => w.id === waypointId);
          dispatchWaypointAction({ type: "reorder", waypointId, toIndex: index - 1 });
        }}
        onMoveDown={(waypointId) => {
          const index = state.present.findIndex((w) => w.id === waypointId);
          dispatchWaypointAction({ type: "reorder", waypointId, toIndex: index + 1 });
        }}
        onDelete={(waypointId) => {
          dispatchWaypointAction({ type: "delete", waypointId });
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
        {routing.isCalculating
          ? "Calculating…"
          : routing.lastErrorMessage
            ? "Try again"
            : "Calculate route"}
      </button>
      {hasKey ? (
        <p role="status">{describeProviderKeyStatus(key, verification, now).headline}</p>
      ) : null}
      {routing.lastErrorMessage ? <p role="alert">{routing.lastErrorMessage}</p> : null}

      {routing.state.kind === "routed" ? (
        <RouteSummaryPanel
          route={routing.state.route}
          waypointCount={routing.state.waypoints.length}
          warnings={displayWarnings}
          selectedWarningIndex={selectedWarningIndex}
          onSelectWarning={handleSelectWarning}
          onClearWarningSelection={handleClearWarningSelection}
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
