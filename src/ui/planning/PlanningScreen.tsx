import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  Coordinate,
  PlannedRoute,
  PlanningProvenance,
  RoutingProfile,
  Waypoint,
} from "../../domain/types.ts";
import { exportRouteToGpx } from "../../gpx/exportGpx.ts";
import { isValidLatitude, isValidLongitude } from "../../gpx/validateGpx.ts";
import {
  MapView,
  type BoundsCameraTarget,
  type CentreCameraTarget,
  type OrientNorthCameraTarget,
  type PlanningOverlay,
  type RouteFeatureOverlay,
  type WarningOverlay,
} from "../../map/MapView.tsx";
import type { MapFactory } from "../../map/mapAdapter.ts";
import { computeLocalAreaBounds } from "../../map/localAreaBounds.ts";
import { deriveWaypointRoles } from "../../map/planningLayer.ts";
import { computeBoundingBox, type BoundingBox } from "../../map/routeLayer.ts";
import { shortestAngularDifferenceDegrees } from "../../navigation/bearing.ts";
import {
  analyzeRouteElevationProfile,
  type ClassifiedSegment,
} from "../../navigation/gradient.ts";
import {
  detectRouteFeatures,
  resolveElevationChartTap,
} from "../../navigation/routeFeatures.ts";
import { buildFeatureDetailSegments } from "../../navigation/routeFeatureDetail.ts";
import type { MicroDetailVisualKey } from "../../navigation/routeFeaturePalette.ts";
import { interpolateRoutePointAt } from "../../navigation/upcomingElevation.ts";
import { coalesceAdjacentWarnings } from "../../navigation/warningGeometry.ts";
import { getApproximateLocationOnce } from "../../platform/geolocation.ts";
import { logError } from "../../platform/errorLog.ts";
import { generateId } from "../../platform/idGenerator.ts";
import { systemClock, useNow, type Clock } from "../../platform/clock.ts";
import { OpenRouteServiceAdapter } from "../../routing/openRouteServiceAdapter.ts";
import type { RoutingProvider } from "../../routing/provider.ts";
import {
  DEFAULT_ROUTING_PROFILE,
  ROUTING_PROFILES,
  describeRoutingProfile,
  formatRoutingProfileLabel,
} from "../../routing/routingProfiles.ts";
import {
  getProviderKey,
  getProviderKeyVerification,
} from "../../storage/providerKeyRepository.ts";
import {
  clearDraft,
  getDraft,
  saveDraft,
} from "../../storage/planningDraftRepository.ts";
import { getPlanningPreferences } from "../../storage/planningPreferencesRepository.ts";
import { saveRoute } from "../../storage/routesRepository.ts";
import type { EditCopyOperation } from "../../storage/mapping.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { downloadTextFile } from "../shared/downloadTextFile.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { describeProviderKeyStatus } from "../settings/providerKeyStatus.ts";
import { canSaveOrExportPlan } from "./canSaveOrExportPlan.ts";
import { describeStaleRouteStatus } from "./describeStaleRouteStatus.ts";
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

/** "loading" until the initial draft read resolves (successfully or not);
 * "ready" once either a restored draft, or genuinely-fresh defaults, have
 * been applied as the authoritative in-memory state — the only condition
 * that may ever enable autosave; "failed" when the read itself rejected,
 * meaning nothing was read or applied at all. A rider action taken before
 * "ready" jumps straight to it — see noteHydrationOverriddenByUserEdit. */
type PlanningDraftHydrationStatus = "loading" | "ready" | "failed";

/** The restorable draft fields hydration coordinates rider edits against —
 * see hasUserModifiedDraftFieldsRef's own doc comment below. */
type DraftEditableField = "waypoints" | "routeName" | "profile" | "avoidFerries";

/** How close a settled bearing must be to 0° (via
 * shortestAngularDifferenceDegrees, so the 0°/360° wrap is handled
 * correctly — e.g. a settled 359.7° is genuinely only 0.3° from north) to
 * still count as north-up for the control's pressed state. A small
 * tolerance, not exact equality: Planning has no following mode, so a
 * manual pinch/rotate gesture released a fraction of a degree off zero is
 * a real, expected case here, not just a hypothetical one — unlike
 * Riding's exact-equality isNorthUpTopDown (useRideCamera.ts), which only
 * ever compares its own commanded value to itself one tick later. */
const NORTH_UP_BEARING_TOLERANCE_DEGREES = 0.5;
/** See NORTH_UP_BEARING_TOLERANCE_DEGREES. Pitch never wraps, so a plain
 * absolute-value comparison is sufficient here. */
const NORTH_UP_PITCH_TOLERANCE_DEGREES = 0.5;

function buildDefaultAdapter(): RoutingProvider {
  return new OpenRouteServiceAdapter({
    getApiKey: () => getProviderKey().then((key) => key?.apiKey),
  });
}

/** Guards a resolved geolocation fix before it's shown as a map marker —
 * reuses the project's only existing finite/range coordinate validators
 * (gpx/validateGpx.ts) rather than a second one. Independent of
 * computeLocalAreaBounds's own internal validity check, whose null return
 * means "not usable for local-area framing", not a general coordinate
 * validity contract. */
function isValidCoordinate(coordinate: Coordinate): boolean {
  return isValidLongitude(coordinate[0]) && isValidLatitude(coordinate[1]);
}

/** Bounds for the one-time camera fit applied to a restored or externally
 * seeded (edit-copy/reverse-copy) waypoint set at hydration time — see the
 * hydration effect below. A single waypoint reuses the existing "frame
 * reasonably around one coordinate" abstraction (the same ~50 km box the
 * fresh-session and Locate-me fits already use) rather than
 * computeBoundingBox's own degenerate zero-area box for a single
 * coordinate, which would zoom in to fitBounds's maxZoom with no visible
 * margin. Two or more waypoints use the plain coordinate envelope. */
function computeWaypointHydrationBounds(
  waypoints: readonly Waypoint[],
): BoundingBox | null {
  const [onlyWaypoint] = waypoints;
  if (waypoints.length === 1 && onlyWaypoint) {
    return computeLocalAreaBounds(onlyWaypoint.coordinate);
  }
  return computeBoundingBox(waypoints.map((waypoint) => waypoint.coordinate));
}

/** Stamps the live Planning waypoints onto a route about to be saved or
 * exported, so a future "Edit copy" (or GPX round-trip) can recover them
 * exactly — see domain/editableWaypoints.ts and PlanningProvenance's own
 * doc comment. Used by both handleSave and handleExport so the two never
 * disagree about what was actually planned. Naturally captures a reversed
 * waypoint order too, once the rider has explicitly recalculated after
 * pressing Reverse route (see handleReverseRoute above) — no separate
 * "reversed" provenance field exists or is needed. */
function buildPlanningProvenance(
  waypoints: readonly Waypoint[],
  profile: RoutingProfile,
  avoidFerries: boolean,
): PlanningProvenance {
  return {
    kind: "planning-session",
    waypoints: waypoints.map((waypoint) => waypoint.coordinate),
    profile,
    avoidFerries,
  };
}

/** The read-only Planning notice text for a hydrated/autosaved edit-copy
 * draft — one of exactly four combinations of operation ("forward" from
 * Edit copy, "reverse" — legacy only, see below) and origin ("exact"
 * recovered planning waypoints, or "derived" from route geometry). Never
 * shows more than one notice: this function always returns exactly one
 * string.
 *
 * Since backlog item 38 moved "Reverse route" from a pre-ride, seed-time-
 * only action (RidingScreen.tsx) into an ordinary, repeatable Planning
 * edit (see waypointHistoryReducer's "reverse" case and handleReverseRoute
 * above), reversing an open draft never touches editCopyMeta at all —
 * editCopyMeta/operation describes seed provenance ("how this draft was
 * first created"), not live edit history, and stays exactly as it was
 * when the draft was seeded, however many times it's since been reversed.
 * No code path writes operation: "reverse" any more (its one writer,
 * RidingScreen.tsx's old REVERSE_ROUTE_CONFIG, was deleted); the
 * "reverse" branch below survives purely to correctly display a legacy
 * draft row written by v0.3.17–v0.3.28, before this change. A freshly
 * Edit-copied-then-reversed-in-Planning draft therefore shows the
 * unchanged "forward" notice below, describing how the draft was seeded,
 * not that it has since been reversed — this is deliberate, not a
 * contradiction: the notice narrates the draft's origin, a historical
 * fact unaffected by later edits, exactly like it already tolerates an
 * ordinary append/delete edit without updating. */
function describeEditCopyNotice(meta: {
  origin: "exact" | "derived";
  operation: EditCopyOperation;
}): string {
  if (meta.operation === "reverse") {
    return meta.origin === "exact"
      ? "Reversed editable copy created. Recalculate before saving; one-way restrictions may make the new route differ from the original. The saved route remains unchanged."
      : "Reversed waypoints were estimated from this route. Recalculation may follow different roads, especially around one-way restrictions. The saved route remains unchanged.";
  }
  return meta.origin === "exact"
    ? "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged."
    : "Editable waypoints were estimated from this route. Recalculation may follow different roads. The saved route will remain unchanged.";
}

/** The always-visible compact routing-preference summary shown beside
 * Calculate, e.g. "Routing: Road bike · Ferries avoided" — always the
 * current draft's own live profile/avoidFerries state (editable via the
 * adjacent Change disclosure), never the Settings default, which only
 * ever seeds a genuinely fresh draft (see the hydration effect below). */
function describeCurrentDraftRoutingSummary(
  profile: RoutingProfile,
  avoidFerries: boolean,
): string {
  return `Routing: ${formatRoutingProfileLabel(profile)} · Ferries ${
    avoidFerries ? "avoided" : "allowed"
  }`;
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
  // Pre-hydration placeholder only — overwritten before the first paint
  // that matters by the draft-hydration effect below, either from a
  // restored draft's own stored value or (for a genuinely fresh draft)
  // from getPlanningPreferences()'s resolved default, which is also
  // `true` when nothing has been saved in Settings.
  const [avoidFerries, setAvoidFerries] = useState(true);
  const [profile, setProfile] = useState<RoutingProfile>(DEFAULT_ROUTING_PROFILE);
  // Route name lives inside the waypoint-history reducer's own present
  // snapshot (state.present.routeName), not a separate useState — see
  // waypointHistory.ts's WaypointDraftSnapshot doc comment (backlog item
  // 38) for why: a "reverse" action must change waypoint order and the
  // route name together as one atomic, undoable history entry, which a
  // separate useState could never guarantee stays in sync with undo/redo.
  // Set together, or neither — present only when this draft was created via
  // "Edit copy" (see RidingScreen.tsx), restored from the
  // hydrated draft below or set fresh by the debounced autosave effect.
  // Held as one nullable object, not two separate booleans/strings, so the
  // two fields can never drift out of sync. Drives only the read-only
  // informational notice below — never gates Save/Export, recalculation or
  // routing behaviour, all of which are already governed by the existing
  // waypoint/profile/avoidFerries fingerprint.
  const [editCopyMeta, setEditCopyMeta] = useState<{
    sourceRouteId: string;
    origin: "exact" | "derived";
    operation: EditCopyOperation;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [crosshairCoordinate, setCrosshairCoordinate] = useState<Coordinate | null>(null);
  // The rider's last successfully resolved approximate-location fix, shown
  // as a plain dot via MapView's existing currentPosition/acn-position
  // mechanism (otherwise only ever fed from Riding's continuous watch).
  // Purely transient device/component state: never persisted to the
  // draft, a saved route, IndexedDB, service worker or GPX, and reset to
  // null on every fresh mount. A failed or invalid Locate-me retry
  // deliberately leaves the previous marker in place rather than clearing
  // it (see handleLocateMe below).
  const [currentPosition, setCurrentPosition] = useState<Coordinate | null>(null);
  // Three-state hydration lifecycle (extends this file's own existing
  // locateStatus tri-state convention below) plus a numeric generation ref
  // (mirroring useRideNavigation.ts's watchGenerationRef idiom) — the one
  // authoritative "is this async draft-read attempt still relevant" check,
  // guarding against a result from a superseded (unmounted/retried) attempt.
  // Autosave and the fresh-session location-framing effect below both gate
  // on hydrationStatus === "ready"; see the hydration effect's own doc
  // comment for the full invariant.
  const [hydrationStatus, setHydrationStatus] =
    useState<PlanningDraftHydrationStatus>("loading");
  const hydrationGenerationRef = useRef(0);
  const [hydrationRetryToken, setHydrationRetryToken] = useState(0);
  // Bumped only by a successful Clear draft (see handleClearDraftConfirm
  // below) to re-run the fresh-session location/camera-framing effect's
  // meaningful body exactly once more, as if this were a brand-new mount —
  // never touched by ordinary hydration/retry, so it never causes that
  // effect to fire on its own.
  const [freshSessionFramingToken, setFreshSessionFramingToken] = useState(0);
  // Which restorable draft fields (waypoints, route name, cycling profile,
  // avoid-ferries) have been directly edited by the rider before hydration
  // applied a result for them. Was a single coarse boolean before backlog
  // item 36 made avoidFerries directly editable in Planning (alongside the
  // already-editable profile) — a single flag could no longer serve both
  // consumers below without either overwriting a rider's choice or
  // suppressing an unrelated Settings default, so this is now tracked
  // per-field:
  //  - The restore branch (below) still gates atomically: ANY field
  //    touched (waypoints, routeName, profile OR avoidFerries) skips the
  //    *entire* restore, never applying some stored fields while skipping
  //    others — "never partially apply stale stored fields" (see that
  //    branch's own comment).
  //  - The genuinely-fresh branch (below) gates profile and avoidFerries
  //    *independently* against the Settings defaults it seeds — editing
  //    only one must never suppress the untouched other's default. It
  //    never reads waypoints/routeName at all, so an early waypoint or
  //    route-name edit can never suppress either Settings default either
  //    — confirmed necessary by real, pre-existing tests that place
  //    waypoints immediately after mount, before any read has had a
  //    chance to resolve.
  // Each field is monotonic: once true, stays true for the rest of this
  // mount's life — once the rider has taken direct action on a field, no
  // later-arriving restore or Settings-default read (including after a
  // failed hydration's retry) should ever overwrite it.
  const hasUserModifiedDraftFieldsRef = useRef<Record<DraftEditableField, boolean>>({
    waypoints: false,
    routeName: false,
    profile: false,
    avoidFerries: false,
  });
  // Set once by the hydration effect's restore branch to the candidate
  // bounds for a restored/seeded waypoint set's one-time camera fit — a
  // pure geometry value, never itself a decision to actually apply it.
  // Consumed exactly once by the fresh-session location effect below,
  // which is where hasManualCameraActionRef/hasAppliedInitialFramingRef
  // are actually consulted (see that effect's own doc comment for why).
  // useState rather than a ref specifically so setting it triggers that
  // effect to re-run and observe it.
  const [pendingWaypointHydrationBounds, setPendingWaypointHydrationBounds] =
    useState<BoundingBox | null>(null);
  const [boundsTarget, setBoundsTarget] = useState<BoundsCameraTarget | null>(null);
  const [centreTarget, setCentreTarget] = useState<CentreCameraTarget | null>(null);
  const [orientNorthTarget, setOrientNorthTarget] =
    useState<OrientNorthCameraTarget | null>(null);
  // Null until the map's camera has genuinely settled at least once —
  // deliberately not defaulted to {bearingDegrees: 0, pitchDegrees: 0},
  // which would make the north-up control report pressed before the map
  // has ever actually settled.
  const [settledOrientation, setSettledOrientation] = useState<{
    bearingDegrees: number;
    pitchDegrees: number;
  } | null>(null);
  const [locateStatus, setLocateStatus] = useState<"idle" | "locating" | "failed">(
    "idle",
  );
  // False while a genuine user gesture (drag/pinch/rotate, including
  // momentum after the finger lifts) is still moving the camera —
  // crosshairCoordinate only updates on settle, so placing here mid-gesture
  // would silently use a stale centre. Never toggled by MapView's own
  // programmatic moves (fitBounds/setCamera), since onUserCameraInteraction
  // only ever fires for a real gesture (see MapView's own doc comment).
  const [isCameraSettled, setIsCameraSettled] = useState(false);
  const [selectedWarningIndex, setSelectedWarningIndex] = useState<number | null>(null);
  // Increments once per map-originated warning selection (including a
  // repeat tap on an already-selected warning) — the one-shot signal
  // RouteSummaryPanel uses to scroll the matching entry into view. Never
  // itself a selection source; always updated alongside
  // selectedWarningIndex in selectWarning below. A list-originated
  // selection does not bump this, since the entry is already where the
  // user is interacting.
  const [warningRevealToken, setWarningRevealToken] = useState(0);
  const [selectedRouteFeatureId, setSelectedRouteFeatureId] = useState<string | null>(
    null,
  );
  // Drilling into a specific local-gradient segment within the currently
  // selected feature — cleared whenever the feature selection itself
  // changes (see selectRouteFeature/handleClearRouteFeatureSelection).
  const [selectedGradientSegment, setSelectedGradientSegment] =
    useState<ClassifiedSegment<MicroDetailVisualKey> | null>(null);
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
    waypoints: state.present.waypoints,
    profile,
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
  // Same referential-stability reasoning as displayWarnings above: derived
  // off routedRoute (not routing.state directly), so a failed
  // recalculation — which leaves routedRoute unchanged — leaves this
  // unchanged too, preserving the map's and chart's gradient colours
  // alongside the rest of the "retain last successful route" policy.
  // `elevationDisplayPoints` is the same shared smoothed series Riding
  // uses as its chart's prominent line — RouteSummaryPanel plots it
  // instead of the raw routed points. `routeFeatures` is detected from
  // the exact same one-per-route analysis (never a second resample/smooth
  // pass) — see routeFeatures.ts's own doc comment on why it must always
  // be derived from the full-route profile, never a windowed slice.
  const {
    runs,
    displayPoints: elevationDisplayPoints,
    routeFeatures,
  } = useMemo(() => {
    if (!routedRoute) return { runs: [], displayPoints: [], routeFeatures: [] };
    const profile = analyzeRouteElevationProfile(routedRoute.points);
    return {
      runs: profile.runs,
      displayPoints: profile.displayPoints,
      routeFeatures: detectRouteFeatures(profile),
    };
  }, [routedRoute]);

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
    // Route-feature ids are only stable for the route they were computed
    // from — a recalculation invalidates any previous selection, exactly
    // like the warning selection above.
    if (selectedRouteFeatureId !== null) {
      setSelectedRouteFeatureId(null);
    }
    if (selectedGradientSegment !== null) {
      setSelectedGradientSegment(null);
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

  // Records that the rider has taken direct action on one restorable field
  // (see hasUserModifiedDraftFieldsRef's own doc comment above) — consulted
  // by the hydration effect's restore branch (atomically, across all four
  // fields) and its fresh-session branch (per-field, for profile/
  // avoidFerries only). Also unblocks autosave immediately if hydration had
  // already reached a permanent dead end ("failed"): the read already
  // rejected, so there is no pending promise left to ever move it to
  // "ready" on its own, and the rider has now started fresh work that
  // deserves saving. While still "loading", this deliberately leaves
  // hydrationStatus alone — the in-flight read's own resolution (which
  // consults the ref above) is what decides the transition to "ready", not
  // this call site.
  const noteHydrationOverriddenByUserEdit = useCallback((field: DraftEditableField) => {
    hasUserModifiedDraftFieldsRef.current = {
      ...hasUserModifiedDraftFieldsRef.current,
      [field]: true,
    };
    setHydrationStatus((current) => (current === "failed" ? "ready" : current));
  }, []);

  // Every waypoint-history dispatch also clears any active warning
  // selection ("selecting or editing a waypoint clears the warning
  // selection") — centralised here so no call site (including undo/redo)
  // can forget it. Without this, a stale warning selection could keep
  // wrongly blocking placement for the ~900ms-plus-network gap until the
  // next recalculation lands (see handlePlacementAt's own guard below).
  // Also the single place that "a rider edit wins over hydration" is
  // enforced for every waypoint mutation — including the post-save reset
  // below, which is already a no-op there by construction, since handleSave
  // is only reachable once routing.state.kind === "routed", which itself
  // requires hydrationStatus to already be "ready".
  const dispatchWaypointAction = useCallback(
    (action: WaypointAction) => {
      noteHydrationOverriddenByUserEdit("waypoints");
      if (selectedWarningIndex !== null) setSelectedWarningIndex(null);
      if (selectedRouteFeatureId !== null) setSelectedRouteFeatureId(null);
      if (selectedGradientSegment !== null) setSelectedGradientSegment(null);
      dispatch(action);
    },
    [
      selectedWarningIndex,
      selectedRouteFeatureId,
      selectedGradientSegment,
      noteHydrationOverriddenByUserEdit,
    ],
  );

  // Central warning-selection path, shared by both origins — the *only*
  // place selectedWarningIndex is ever set to a non-null value, so list-
  // and map-originated selection can never diverge in policy. "Selecting
  // a warning clears any waypoint movement/insertion mode." Also clears
  // any route-feature selection — the two are mutually exclusive, mirroring
  // the existing "editing a waypoint clears warning selection" precedent,
  // so only one "something is selected, its detail panel is showing"
  // state ever competes for the rider's attention at once.
  const selectWarning = useCallback((index: number, origin: "map" | "list") => {
    setPendingWaypointAction(null);
    setSelectedRouteFeatureId(null);
    setSelectedGradientSegment(null);
    setSelectedWarningIndex(index);
    if (origin === "map") {
      setWarningRevealToken((token) => token + 1);
    }
  }, []);
  const handleSelectWarning = useCallback(
    (index: number) => {
      selectWarning(index, "list");
    },
    [selectWarning],
  );
  // Wired to MapView's warningOverlay.onSelectWarning — MapView itself
  // does no Planning-workflow logic; this applies the exact same policy
  // as handleSelectWarning, differing only in the recorded origin (drives
  // RouteSummaryPanel's one-time scroll-into-view via warningRevealToken
  // — never a second selection mechanism).
  const handleSelectWarningFromMap = useCallback(
    (index: number) => {
      selectWarning(index, "map");
    },
    [selectWarning],
  );
  // Deliberately does not restore pendingWaypointAction — clearing a
  // warning selection returns to a non-destructive state rather than
  // guessing the rider's previous placement intention.
  const handleClearWarningSelection = useCallback(() => {
    setSelectedWarningIndex(null);
  }, []);

  // The *only* place selectedRouteFeatureId is ever set to a non-null
  // value — mirrors selectWarning's own shape, including mutual
  // exclusivity with warning selection. Drilling into a specific micro
  // segment (selectedGradientSegment) is a separate, finer-grained
  // selection that does NOT go through this function — see
  // handleChartTapDistance below.
  const selectRouteFeature = useCallback((id: string) => {
    setPendingWaypointAction(null);
    setSelectedWarningIndex(null);
    setSelectedGradientSegment(null);
    setSelectedRouteFeatureId(id);
  }, []);
  const handleClearRouteFeatureSelection = useCallback(() => {
    setSelectedRouteFeatureId(null);
    setSelectedGradientSegment(null);
  }, []);
  const handleClearGradientSegmentSelection = useCallback(() => {
    setSelectedGradientSegment(null);
  }, []);

  // Both toggle: clicking an already-active Move/Insert-after button
  // cancels it, returning to plain "selected" — the same aria-pressed
  // affordance doubling as a cancel control.
  const handleStartMove = useCallback(
    (waypointId: string) => {
      if (selectedWarningIndex !== null) setSelectedWarningIndex(null);
      if (selectedRouteFeatureId !== null) setSelectedRouteFeatureId(null);
      if (selectedGradientSegment !== null) setSelectedGradientSegment(null);
      setPendingWaypointAction((current) =>
        current?.waypointId === waypointId && current.kind === "move"
          ? null
          : { waypointId, kind: "move" },
      );
    },
    [selectedWarningIndex, selectedRouteFeatureId, selectedGradientSegment],
  );
  const handleStartInsertAfter = useCallback(
    (waypointId: string) => {
      if (selectedWarningIndex !== null) setSelectedWarningIndex(null);
      if (selectedRouteFeatureId !== null) setSelectedRouteFeatureId(null);
      if (selectedGradientSegment !== null) setSelectedGradientSegment(null);
      setPendingWaypointAction((current) =>
        current?.waypointId === waypointId && current.kind === "insert-after"
          ? null
          : { waypointId, kind: "insert-after" },
      );
    },
    [selectedWarningIndex, selectedRouteFeatureId, selectedGradientSegment],
  );

  // Loads any previously saved draft exactly once per attempt (initial
  // mount, or a retry after a failed read), before draft-persisting starts
  // below — otherwise the persist effect's first run (an empty array,
  // before the load resolves) could overwrite a real saved draft.
  //
  // Invariant: Planning must not autosave until the initial draft read has
  // completed successfully and the resolved draft, or the deliberate
  // fresh-plan defaults when no draft exists, has been applied as the
  // authoritative in-memory state. Enforced here via a single generation
  // check (hydrationGenerationRef) that gates the *entire* continuation —
  // both the restored-draft branch and the nested fresh-session
  // getPlanningPreferences() read — so a result from a superseded attempt
  // (after unmount, or after a retry has started a new attempt) can never
  // apply stale data or enable autosave. The cleanup below bumps the
  // generation on every unmount/re-run (including React StrictMode's
  // mount->cleanup->mount double-invocation — getDraft() is a read, so a
  // duplicate call is harmless; only the winning generation's result is
  // ever applied). Separately, the restore branch also consults
  // hasUserModifiedDraftFieldsRef (see its own doc comment above) to skip
  // re-applying fields the rider has already directly changed themselves.
  // Deliberately does not itself set hydrationStatus to "loading" (which
  // would be a synchronous setState-in-effect, an anti-pattern this
  // codebase avoids elsewhere too) — the initial "loading" default already
  // covers the first mount, and the Retry button's own onClick below sets
  // it directly before bumping hydrationRetryToken, mirroring
  // handleLocateMe's existing convention of setting status in the
  // triggering event handler, not inside the effect it kicks off.
  useEffect(() => {
    const generation = ++hydrationGenerationRef.current;

    getDraft()
      .then((draft) => {
        if (hydrationGenerationRef.current !== generation) return;
        if (draft && draft.waypoints.length > 0) {
          // Atomic across all four restorable fields — see
          // hasUserModifiedDraftFieldsRef's own doc comment above: any
          // single field the rider has already touched (waypoints,
          // routeName, profile OR avoidFerries) skips the *entire*
          // restore, never applying some stored fields while skipping
          // others.
          const hasAnyUserEdit = Object.values(
            hasUserModifiedDraftFieldsRef.current,
          ).some(Boolean);
          if (!hasAnyUserEdit) {
            dispatch({
              type: "reset",
              waypoints: draft.waypoints,
              routeName: draft.routeName,
            });
            setAvoidFerries(draft.avoidFerries);
            setProfile(draft.profile);
            // Both fields, or neither — see editCopyMeta's own doc comment.
            if (
              draft.editCopySourceRouteId !== undefined &&
              draft.editCopyWaypointsOrigin !== undefined
            ) {
              setEditCopyMeta({
                sourceRouteId: draft.editCopySourceRouteId,
                origin: draft.editCopyWaypointsOrigin,
                // mapping.ts's fromStoredPlanningDraft already resolves
                // this to a concrete "forward"/"reverse" (defaulting a
                // pre-Reverse-route draft, which never had this field, to
                // "forward") — the `?? "forward"` here only satisfies
                // PlanningDraftContent's optional type, which stays
                // optional because the *write* side must still be able to
                // omit it for an ordinary, non-edit-copy draft.
                operation: draft.editCopyOperation ?? "forward",
              });
            }
            // Candidate bounds for the one-time camera fit these restored/
            // seeded waypoints deserve — a pure geometry computation only,
            // with no read of hasManualCameraActionRef/
            // hasAppliedInitialFramingRef here. Whether it's actually
            // applied (the rider may already own the camera by the time
            // this resolves) is decided by the fresh-session location
            // effect below, the one place those two refs are read — see
            // its own doc comment for why.
            setPendingWaypointHydrationBounds(
              computeWaypointHydrationBounds(draft.waypoints),
            );
          }
          // Reached "ready" either way: if the rider already edited, their
          // own in-memory state (not this draft's) is now authoritative,
          // and autosave must still be unblocked for it.
          setHydrationStatus("ready");
          return;
        }
        // Genuinely fresh: no draft row at all, or a draft row with zero
        // waypoints — the exact boundary this effect already used before
        // the Settings-level defaults existed, and the same boundary the
        // debounced autosave effect below relies on (it only ever writes
        // once state.present is non-empty). Seed this session's profile
        // and avoidFerries once each from the Settings defaults; from the
        // draft's first autosave onward it is fully self-contained, and a
        // later change to either Settings default never touches it again.
        // Each field is gated independently against
        // hasUserModifiedDraftFieldsRef, not the object as a whole: the
        // rider may have already opened the current-draft "Change"
        // disclosure and touched just one of profile/avoidFerries before
        // this read resolves, and that must never suppress the untouched
        // other field's own Settings default. This branch never reads or
        // restores waypoints/routeName, so an early waypoint or
        // route-name edit can never suppress either default either —
        // confirmed necessary by pre-existing tests that place waypoints
        // immediately on mount and still expect the Settings defaults to
        // apply.
        getPlanningPreferences()
          .then((preferences) => {
            if (hydrationGenerationRef.current !== generation) return;
            if (!hasUserModifiedDraftFieldsRef.current.profile) {
              setProfile(preferences.profileByDefault);
            }
            if (!hasUserModifiedDraftFieldsRef.current.avoidFerries) {
              setAvoidFerries(preferences.avoidFerriesByDefault);
            }
          })
          .catch((error: unknown) => {
            logError("planning-load-preferences", error);
            // Leaves profile/avoidFerries at their useState initial values
            // (DEFAULT_ROUTING_PROFILE, true) — the same values the
            // Settings defaults themselves resolve to when nothing has
            // been saved, so a failed read here is never observably
            // different from the ordinary case.
          })
          .finally(() => {
            if (hydrationGenerationRef.current === generation) {
              setHydrationStatus("ready");
            }
          });
      })
      .catch((error: unknown) => {
        if (hydrationGenerationRef.current !== generation) return;
        logError("planning-load-draft", error);
        // Never "ready" — nothing was read or applied, so autosave must
        // stay blocked (otherwise the debounced effect below would soon
        // see zero waypoints and silently clearDraft() the real, unread
        // row). Surfaces an accessible retry state instead; see the
        // failure UI below and the Retry button's hydrationRetryToken. A
        // rider edit made after this still recovers — see
        // noteHydrationOverriddenByUserEdit's own "failed" -> "ready"
        // transition.
        setHydrationStatus("failed");
      });

    return () => {
      if (hydrationGenerationRef.current === generation) {
        hydrationGenerationRef.current += 1;
      }
    };
  }, [hydrationRetryToken]);

  // Synchronous, timing-independent protection for the "stale-timer
  // resurrects a just-cleared draft" race (CLAUDE.md future-backlog item
  // 30): handleSave below disables its own button (isSaving) AND, mirroring
  // isLocatingRef's own established rationale above ("React state updates
  // aren't synchronous"), checks isSavingRef synchronously as a
  // belt-and-suspenders guard against a second click slipping through.
  // saveTimeoutRef is the one synchronously-reachable handle for whichever
  // autosave timer is currently scheduled, shared by this effect and
  // handleSave, so handleSave can cancel a pending timer the instant Save is
  // pressed rather than waiting for a render. saveGenerationRef additionally
  // guards handleSave's own async continuations against a resolution
  // arriving after unmount, mirroring hydrationGenerationRef's identical
  // idiom above.
  //
  // Clear draft (backlog item 37) below reuses saveGenerationRef and
  // saveTimeoutRef literally, rather than a third, independently-invented
  // mechanism (CLAUDE.md's own instruction) — cancelling the pending
  // autosave timer and invalidating stale continuations exactly like
  // handleSave already does. It gets its own isClearingRef/isClearing pair
  // because it must work in states handleSave cannot (no calculated route
  // yet), and the two are made mutually exclusive so a Save and a Clear
  // can never race each other: handleSave's own guard below also checks
  // isClearingRef, and handleClearDraftConfirm checks isSavingRef.
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const saveGenerationRef = useRef(0);
  const saveTimeoutRef = useRef<number | undefined>(undefined);
  const isClearingRef = useRef(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearDraftError, setClearDraftError] = useState<string | null>(null);
  const [isClearDraftConfirmOpen, setIsClearDraftConfirmOpen] = useState(false);
  const clearDraftTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    return () => {
      saveGenerationRef.current += 1;
    };
  }, []);

  // A separate 900ms debounce from usePlanningRoute's own recalculation
  // debounce below — this one persists the draft (waypoints, route name,
  // avoid-ferries, cycling profile), so it deliberately DOES depend on
  // avoidFerries/profile, unlike the routing debounce, which never receives
  // routeName. Depends on state.present (not a standalone routeName dep):
  // every reducer case that changes routeName (rename, reverse, reset)
  // already produces a new state.present object reference — see
  // waypointHistory.ts — so state.present's own identity already covers
  // name changes, and a rename's own deliberate reuse of the same
  // waypoints array reference (see waypointHistoryReducer's "rename" case)
  // is what stops a rename from ever looking like a waypoint change to
  // usePlanningRoute's separate recalculation-debounce effect. Also gated
  // on isSaving, and included in the dependency array, so no new timer is
  // ever scheduled while an explicit Save attempt is in flight (see
  // handleSave below).
  useEffect(() => {
    if (hydrationStatus !== "ready" || isSaving) return;
    const generation = saveGenerationRef.current;
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = undefined;
      // Defence in depth: the pending timer that could ever race a Save is
      // always cancelled synchronously by handleSave before this could fire
      // (see the "Why this closes the race" comment there); this check
      // guards against a future refactor weakening that primary guard.
      if (saveGenerationRef.current !== generation) return;
      const persist =
        state.present.waypoints.length === 0
          ? clearDraft()
          : saveDraft({
              waypoints: state.present.waypoints,
              routeName: state.present.routeName,
              avoidFerries,
              profile,
              // Carried through on every autosave, not just the initial
              // hydration — saveDraft fully replaces the stored row, so
              // omitting this here would silently drop it on the very
              // first autosave after a fresh "Edit copy" open.
              ...(editCopyMeta
                ? {
                    editCopySourceRouteId: editCopyMeta.sourceRouteId,
                    editCopyWaypointsOrigin: editCopyMeta.origin,
                    editCopyOperation: editCopyMeta.operation,
                  }
                : {}),
            });
      persist.catch((error: unknown) => {
        logError("planning-save-draft", error);
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(saveTimeoutRef.current);
    };
  }, [state.present, avoidFerries, profile, editCopyMeta, hydrationStatus, isSaving]);

  // Read fresh inside the location effect below rather than depending on
  // state.present directly, so a waypoint added while the location request
  // is still pending is seen without re-triggering the request itself.
  const waypointsRef = useRef(state.present.waypoints);
  useEffect(() => {
    waypointsRef.current = state.present.waypoints;
  }, [state.present.waypoints]);

  // Set true the instant the rider manually pans/pinches/rotates/pitches
  // the map, or explicitly taps Locate me — blocks a still-in-flight
  // automatic fresh-session framing result, or a still-pending restored/
  // seeded-waypoint hydration fit (see pendingWaypointHydrationBounds and
  // the fresh-session location effect below, which is where this ref is
  // actually consulted for that path), from later overriding whatever the
  // rider has since done themselves. Never reset back to false. North-up
  // taps deliberately do NOT set this: orientation-only, no coordinate
  // framing of its own, so it carries no "the rider already has a view
  // they care about" signal the way a pan or Locate-me tap does.
  const hasManualCameraActionRef = useRef(false);
  // Set true only by a genuine pan/pinch/rotate/pitch gesture — never by a
  // Locate-me tap, successful or not, unlike hasManualCameraActionRef
  // above. Used solely by handleLocateMe to decide whether the session's
  // one-time regional box-fit is still available: a prior *failed*
  // Locate-me attempt establishes no camera view at all (nothing moved),
  // so it must not by itself force every later successful attempt into
  // recentre-only mode — only an actual gesture, or a framing that has
  // already genuinely been applied, should do that (see
  // hasAppliedInitialFramingRef below).
  const hasManualGestureRef = useRef(false);
  // Synchronous double-tap guard for handleLocateMe (see below) — a plain
  // locateStatus === "locating" check in the handler isn't enough on its
  // own, since React state updates aren't synchronous.
  const isLocatingRef = useRef(false);
  // True once the session's one-time initial camera framing has been
  // applied — by *any* of three paths, all decided inside this same
  // effect below: the automatic fresh-session regional framing itself, an
  // explicit Locate-me press racing ahead of it (e.g. because the
  // automatic attempt failed or is still pending), or applying the
  // hydration effect's own candidate bounds for a restored or externally
  // seeded (edit-copy/reverse-copy) waypoint set (see
  // pendingWaypointHydrationBounds's own doc comment above). Once true,
  // every subsequent Locate-me press only recentres (see handleLocateMe)
  // — whichever path resolves first gets to frame the area; every later
  // one does not repeat it.
  const hasAppliedInitialFramingRef = useRef(false);

  // Frames a genuinely fresh Planning session (no restored draft, no
  // waypoints yet) in an approximately 50 × 50 km box around the rider's
  // approximate location, once — never re-requested for this component
  // instance, and skipped entirely once there's already something to
  // show, so it can never fight a restored draft or waypoints placed
  // before the fix resolves. Silently no-ops on failure (matching this
  // effect's pre-existing behaviour) — Locate me (see handleLocateMe
  // below) is the always-available, discoverable explicit recovery path,
  // and owns its own separate loading/failure UI.
  //
  // Also the sole place that applies pendingWaypointHydrationBounds (the
  // hydration effect's own candidate fit for a restored/seeded waypoint
  // set) once it's genuinely safe to: this is deliberate, not incidental
  // — hasManualCameraActionRef/hasAppliedInitialFramingRef must only ever
  // be read from one effect (the underlying React-Compiler-backed lint
  // rule for these two refs — both mutated from plain callbacks
  // (handleLocateMe, onUserCameraInteraction) — flags a second reader
  // effect as unsound, since it can no longer verify the two stay
  // consistent across independently-scheduled effects). Keeping the
  // restored-waypoint fit's guard checks here, alongside the fresh-
  // session fit's own identical checks, is what keeps this the only
  // reader. hasRequestedInitialLocationRef's existing "run my meaningful
  // body once per mount" guard is reused for both concerns.
  //
  // A third caller of this same discipline: handleClearDraftConfirm below
  // resets hasRequestedInitialLocationRef/hasAppliedInitialFramingRef/
  // hasManualCameraActionRef/hasManualGestureRef to their fresh-mount
  // values and bumps freshSessionFramingToken (a dependency of this
  // effect) after a successful Clear draft, so this effect's meaningful
  // body runs again exactly once — as if Planning had never held a draft
  // — without becoming a second reader of the two refs the comment above
  // restricts to this one effect (handleClearDraftConfirm is a plain
  // callback that only writes them, mirroring handleLocateMe/
  // onUserCameraInteraction).
  const hasRequestedInitialLocationRef = useRef(false);
  useEffect(() => {
    if (hydrationStatus !== "ready" || hasRequestedInitialLocationRef.current) return;
    hasRequestedInitialLocationRef.current = true;
    if (waypointsRef.current.length > 0) {
      // A restored/seeded draft, or a rider's own already-placed
      // waypoint(s) if hasUserModifiedDraftFieldsRef's own gate meant the
      // hydration effect skipped restoring — computeWaypointHydrationBounds
      // is only ever set for the former (inside that gate; see the
      // hydration effect above), so pendingWaypointHydrationBounds being
      // null here correctly covers the latter with no fit, exactly as a
      // fresh session's own manually-placed first waypoint already
      // retains whatever camera the rider used to place it.
      if (
        pendingWaypointHydrationBounds &&
        !hasManualCameraActionRef.current &&
        !hasAppliedInitialFramingRef.current
      ) {
        hasAppliedInitialFramingRef.current = true;
        setBoundsTarget({
          bounds: pendingWaypointHydrationBounds,
          requestId: generateId(),
        });
      }
      return;
    }
    requestApproximateLocation()
      .then((coordinate) => {
        if (!coordinate) return;
        if (isValidCoordinate(coordinate)) {
          setCurrentPosition(coordinate);
        }
        if (waypointsRef.current.length > 0 || hasManualCameraActionRef.current) return;
        const bounds = computeLocalAreaBounds(coordinate);
        if (!bounds) return;
        hasAppliedInitialFramingRef.current = true;
        setBoundsTarget({ bounds, requestId: generateId() });
      })
      .catch((error: unknown) => {
        logError("planning-initial-location", error);
      });
  }, [
    hydrationStatus,
    requestApproximateLocation,
    pendingWaypointHydrationBounds,
    freshSessionFramingToken,
  ]);

  const handleLocateMe = useCallback(() => {
    if (isLocatingRef.current) return;
    isLocatingRef.current = true;
    const hadEstablishedViewFromGesture = hasManualGestureRef.current;
    hasManualCameraActionRef.current = true;
    setLocateStatus("locating");
    requestApproximateLocation()
      .then((coordinate) => {
        if (!coordinate || !isValidCoordinate(coordinate)) {
          setLocateStatus("failed");
          return;
        }
        setCurrentPosition(coordinate);
        // Only the session's first successful geolocation resolution (from
        // either this control or the automatic fresh-session effect above)
        // performs the one-time regional box-fit; every later press only
        // recentres, preserving whatever zoom/bearing/pitch the rider
        // already has (see mapAdapter.ts's centreOn).
        const shouldApplyInitialFraming =
          !hadEstablishedViewFromGesture && !hasAppliedInitialFramingRef.current;
        if (shouldApplyInitialFraming) {
          const bounds = computeLocalAreaBounds(coordinate);
          if (bounds) {
            hasAppliedInitialFramingRef.current = true;
            setBoundsTarget({ bounds, requestId: generateId() });
            setLocateStatus("idle");
            return;
          }
        }
        setCentreTarget({ coordinate, requestId: generateId() });
        setLocateStatus("idle");
      })
      .catch((error: unknown) => {
        logError("planning-locate-me", error);
        setLocateStatus("failed");
      })
      .finally(() => {
        isLocatingRef.current = false;
      });
  }, [requestApproximateLocation]);

  const handleRequestNorthUp = useCallback(() => {
    setOrientNorthTarget({ requestId: generateId() });
  }, []);

  const isNorthUpTopDown =
    settledOrientation !== null &&
    Math.abs(shortestAngularDifferenceDegrees(0, settledOrientation.bearingDegrees)) <=
      NORTH_UP_BEARING_TOLERANCE_DEGREES &&
    Math.abs(settledOrientation.pitchDegrees) <= NORTH_UP_PITCH_TOLERANCE_DEGREES;

  // --- Map-tap event-priority policy (implemented) ---
  // A genuine map tap (never a drag-then-release — see mapAdapter.ts's
  // onMapTap) resolves to exactly ONE of the following, in order:
  //   1. The tap hits a selectable warning feature — MapView hit-tests
  //      the warning category layers itself (see queryTopWarningFeatureAt/
  //      resolveWarningIndexHit) and calls handleSelectWarningFromMap
  //      directly, WITHOUT ever invoking planningOverlay.onMapTap /
  //      handlePlacementAt below — so a warning hit can never also
  //      append/move/insert a waypoint. (Waypoint markers are not
  //      hit-tested from the map; selecting a waypoint remains a
  //      WaypointList-only action, out of scope for this policy.)
  //   2. Otherwise, if there is an explicit active move/insert-after
  //      operation, the tap completes that operation.
  //   3. Otherwise, a bare tap only appends when append mode is visibly
  //      active — never just because nothing else matched ("selected"
  //      mode with no pending move/insert still does nothing on a bare
  //      tap, see below).
  //   4. Otherwise, the tap does nothing.
  // Panning/zooming/dragging never go through onMapTap at all, so are
  // unaffected.
  //
  // Cases 2-4 are handlePlacementAt's own logic below, shared by both the
  // map tap and the crosshair button (so both behave identically for
  // them); case 1 is map-tap-only — the crosshair always places/moves
  // relative to the centre crosshair, never a warning feature. The
  // `if (selectedWarningIndex !== null) return;` guard immediately below
  // stays as belt-and-suspenders for the crosshair path in particular
  // (which has no hit-testing of its own): once a warning is selected via
  // either origin, neither entry point can sneak in a placement until
  // it's explicitly cleared.
  const handlePlacementAt = useCallback(
    (coordinate: Coordinate) => {
      // Warning inspection takes priority — "a bare map tap must not
      // append or move a waypoint" while a warning is selected and framed.
      // A selected route feature (climb/descent) gets the same guard, for
      // the same reason — inspecting its detail shouldn't risk an
      // accidental placement.
      if (selectedWarningIndex !== null || selectedRouteFeatureId !== null) return;
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
    [
      interactionMode,
      selectedWarningIndex,
      selectedRouteFeatureId,
      dispatchWaypointAction,
    ],
  );

  const handlePlacementHere = () => {
    if (!crosshairCoordinate) return;
    handlePlacementAt(crosshairCoordinate);
  };

  const selectedIndex = state.selectedWaypointId
    ? state.present.waypoints.findIndex(
        (waypoint) => waypoint.id === state.selectedWaypointId,
      )
    : -1;
  const selectedWaypointIndex = selectedIndex === -1 ? null : selectedIndex;

  // Shared with the map's own waypoint markers — see
  // planningLayer.ts's deriveWaypointRoles doc comment.
  const waypointRoles = deriveWaypointRoles(
    state.present.waypoints.map((waypoint) => waypoint.coordinate),
  );

  const first = state.present.waypoints[0];
  const last = state.present.waypoints.at(-1);
  const canReturnToStart =
    state.present.waypoints.length >= 2 &&
    !!first &&
    !!last &&
    !sameCoordinate(first.coordinate, last.coordinate);

  const canSaveOrExport = canSaveOrExportPlan(routing.state, routing.isStale);

  // Reverses waypoint order and the route name together as one atomic,
  // undoable history entry (waypointHistoryReducer's "reverse" case, see
  // its own doc comment) — local only, no routing-provider request. Calling
  // routing.reset() strictly after the dispatch (mirroring
  // handleClearDraftConfirm's own ordering below) discards any in-flight
  // or previously calculated result and, critically, sets hasRoutedResultRef
  // to false before usePlanningRoute's debounced recalculation-scheduling
  // effect next runs — which is what stops that effect from silently
  // scheduling a provider request ~900ms after a reversal, something
  // isStale's own order-sensitive fingerprint check alone would not have
  // prevented (it only gates Save/Export, not the debounce). Deliberately
  // no confirmation dialog (local + fully undoable) and no re-entrancy
  // guard beyond the disabled prop below — matching Undo/Redo/Return to
  // start, none of which have one either; a rapid double-click simply
  // double-reverses, which is harmless and fully undoable.
  const handleReverseRoute = () => {
    if (state.present.waypoints.length < 2) return; // defensive; button disabled below this anyway
    setPendingWaypointAction(null);
    noteHydrationOverriddenByUserEdit("routeName");
    dispatchWaypointAction({ type: "reverse" });
    routing.reset();
  };

  const handleSave = () => {
    if (routing.state.kind !== "routed" || isSavingRef.current || isClearingRef.current)
      return;
    isSavingRef.current = true;

    // Synchronously cancel any pending autosave timer and invalidate its
    // generation before any async work begins, so it cannot fire and write
    // stale pre-save waypoints back into the draft row after clearDraft()
    // below has cleared it — the documented Save-versus-autosave race
    // (CLAUDE.md future-backlog item 30). This is the only pending timer
    // that could ever race this Save: the autosave effect's own deps don't
    // change synchronously during the async gap below (nothing else writes
    // to them until the post-clearDraft reset), and it's additionally gated
    // on isSaving, so no *new* timer can be scheduled while this attempt is
    // in flight either.
    window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = undefined;
    saveGenerationRef.current += 1;
    const attemptGeneration = saveGenerationRef.current;

    const routeToSave: PlannedRoute = {
      ...routing.state.route,
      name: state.present.routeName.trim() || "Planned route",
      planningProvenance: buildPlanningProvenance(
        state.present.waypoints,
        profile,
        avoidFerries,
      ),
    };
    setSaveError(null);
    setIsSaving(true);
    saveRoute(routeToSave)
      .then(() => clearDraft())
      .then(() => {
        // Superseded only by unmount (isSavingRef already blocks a second
        // concurrent attempt) — skip applying state after that.
        if (saveGenerationRef.current !== attemptGeneration) return;
        dispatchWaypointAction({
          type: "reset",
          waypoints: [],
          routeName: "Planned route",
        });
        setEditCopyMeta(null);
        onRouteSaved?.(routeToSave);
      })
      .catch((error: unknown) => {
        if (saveGenerationRef.current !== attemptGeneration) return;
        logError("planning-save-route", error);
        setSaveError("The route could not be saved on this device. Try again.");
      })
      .finally(() => {
        isSavingRef.current = false;
        // Re-establishes normal debounced autosave for the current
        // in-memory plan on failure — the autosave effect's own isSaving
        // dependency picks this up and re-arms against live render state,
        // with nothing snapshotted here.
        if (saveGenerationRef.current === attemptGeneration) {
          setIsSaving(false);
        }
      });
  };

  // Restores focus to the Clear-draft trigger once a failed clear has
  // genuinely re-enabled it — an effect, not an imperative call inside the
  // .catch() block below, for the exact reason RidingScreen.tsx's own
  // finalizeError-keyed effect documents: at the moment .catch() runs,
  // isClearing (driving the trigger's own disabled prop) has not yet
  // committed to false, and .focus() on a still-disabled element silently
  // no-ops. Keyed on clearDraftError's own object identity, which is fresh
  // only for a genuinely new error, so this never re-fires on an unrelated
  // re-render while the same error is still shown.
  useEffect(() => {
    if (!clearDraftError) return;
    clearDraftTriggerRef.current?.focus();
  }, [clearDraftError]);

  const handleClearDraftClick = () => {
    if (isClearDraftConfirmOpen || isClearingRef.current || isSavingRef.current) return;
    setClearDraftError(null);
    setIsClearDraftConfirmOpen(true);
  };

  const handleClearDraftCancel = () => {
    // Escape can bypass a disabled Cancel button, so guard here too.
    if (isClearingRef.current) return;
    setIsClearDraftConfirmOpen(false);
    clearDraftTriggerRef.current?.focus();
  };

  // Wipes the entire mutable Planning draft — waypoints, routed/stale
  // result, name, edit-copy/reversal provenance, selection state — back to
  // a genuinely fresh session, and clears the persisted draft row. Never
  // clears in-memory state optimistically: everything below the
  // Promise.all only runs once the storage write (and, independently, a
  // fresh read of the current Settings defaults) has actually resolved.
  // Reuses saveGenerationRef/saveTimeoutRef exactly like handleSave above
  // — see that ref pair's own doc comment for why this is deliberate reuse,
  // not a third mechanism.
  const handleClearDraftConfirm = () => {
    if (isSavingRef.current || isClearingRef.current) return;
    isClearingRef.current = true;

    window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = undefined;
    saveGenerationRef.current += 1;
    const attemptGeneration = saveGenerationRef.current;

    setClearDraftError(null);
    setIsClearing(true);

    Promise.all([
      clearDraft(),
      // A Settings-read failure here must never be reported as "the draft
      // could not be cleared" — the destructive clear itself can still
      // succeed — so it swallows its own rejection and falls back to the
      // same safe defaults getPlanningPreferences() itself resolves to
      // when no preferences row has ever been saved, mirroring the
      // existing fresh-session hydration branch's identical precedent
      // above.
      getPlanningPreferences().catch((error: unknown) => {
        logError("planning-clear-draft-load-preferences", error);
        return {
          profileByDefault: DEFAULT_ROUTING_PROFILE,
          avoidFerriesByDefault: true,
        };
      }),
    ])
      .then(([, preferences]) => {
        // Superseded only by unmount — isClearingRef already blocks a
        // second concurrent attempt.
        if (saveGenerationRef.current !== attemptGeneration) return;
        dispatchWaypointAction({
          type: "reset",
          waypoints: [],
          routeName: "Planned route",
        });
        setEditCopyMeta(null);
        setPendingWaypointAction(null);
        setSaveError(null);
        setExportError(null);
        // Unconditional, unlike the hydration effect's own fresh-session
        // branch above: hasUserModifiedDraftFieldsRef.current.profile/
        // avoidFerries mean "modified since this component mounted" and
        // are never reset by an ordinary edit, so a rider who customised
        // routing before pressing Clear draft (an entirely normal flow —
        // e.g. after arriving via "Edit copy") would already
        // have one or both flags permanently true; gating this reseed on
        // them the same way would silently skip it precisely when it
        // matters most. Clear draft is itself the explicit "start over"
        // request, so it always wins over whatever was set before it.
        setProfile(preferences.profileByDefault);
        setAvoidFerries(preferences.avoidFerriesByDefault);
        routing.reset();
        // Re-arms the fresh-session camera/geolocation framing effect's
        // "run once" guard exactly as if this were a brand-new mount — see
        // that effect's own doc comment above for the full ordering and
        // lint-safety reasoning.
        hasRequestedInitialLocationRef.current = false;
        hasAppliedInitialFramingRef.current = false;
        hasManualCameraActionRef.current = false;
        hasManualGestureRef.current = false;
        setPendingWaypointHydrationBounds(null);
        setFreshSessionFramingToken((token) => token + 1);
        setIsClearDraftConfirmOpen(false);
      })
      .catch((error: unknown) => {
        // Only reachable for a genuine clearDraft() rejection — the
        // preferences read above already swallows its own failure.
        if (saveGenerationRef.current !== attemptGeneration) return;
        logError("planning-clear-draft", error);
        setClearDraftError("The draft could not be cleared on this device. Try again.");
        setIsClearDraftConfirmOpen(false);
      })
      .finally(() => {
        isClearingRef.current = false;
        if (saveGenerationRef.current === attemptGeneration) {
          setIsClearing(false);
        }
      });
  };

  const handleExport = () => {
    if (routing.state.kind !== "routed") return;
    setExportError(null);
    const trimmedName = state.present.routeName.trim() || "Planned route";
    const routeToExport: PlannedRoute = {
      ...routing.state.route,
      name: trimmedName,
      planningProvenance: buildPlanningProvenance(
        state.present.waypoints,
        profile,
        avoidFerries,
      ),
    };
    exportRouteToGpx(routeToExport)
      .then((xml) => {
        downloadTextFile(`${trimmedName}.gpx`, xml, "application/gpx+xml");
      })
      .catch((error: unknown) => {
        setExportError(
          error instanceof Error ? error.message : "The route could not be exported.",
        );
        logError("planning-export-route", error);
      });
  };

  const planningOverlay: PlanningOverlay = {
    waypoints: state.present.waypoints,
    // Only shown before/between calculations — once routed, the real
    // geometry is already visible via `points` below, and this preview
    // must never be mixed with it (see planningLayer.ts).
    previewCoordinates:
      routing.state.kind === "routed"
        ? []
        : state.present.waypoints.map((w) => w.coordinate),
    selectedWaypointIndex,
    onMapTap: handlePlacementAt,
  };

  const mapPoints = routing.state.kind === "routed" ? routing.state.route.points : [];
  // Fits the map to the whole route exactly once per draft — the render
  // where the first successful calculation commits — then stays true for
  // every later recalculation (edit, undo/redo, retry), so an edit-
  // triggered recalculation never yanks the camera away from a
  // just-placed/just-moved waypoint. Pure per-render derivation, no ref or
  // timeout: see usePlanningRoute's isFirstRouteForDraft for why this is
  // race-free across retries after an earlier failure.
  const suppressInitialOverviewFit =
    routing.state.kind === "routed" ? !routing.state.isFirstRouteForDraft : true;

  const warningOverlay: WarningOverlay = {
    warnings: displayWarnings,
    selectedWarningIndex,
    onSelectWarning: handleSelectWarningFromMap,
  };

  const selectedRouteFeature =
    routeFeatures.find((feature) => feature.id === selectedRouteFeatureId) ?? null;
  // The detailed local-gradient analysis, narrowed to the selected
  // feature's own clipped range — empty (no detail colouring) when
  // nothing is selected. Planning has no "currently active during a ride"
  // concept, so selection is the only source of micro detail here, unlike
  // RidingScreen's selectedFeature ?? activeFeature.
  // buildFeatureDetailSegments does real classify+merge+flicker-suppress
  // work over the feature's owning run, so this must be memoized to avoid
  // recomputing it on every unrelated render (e.g. a keystroke in the
  // route name field).
  const microDetailSegments = useMemo(
    () =>
      selectedRouteFeature ? buildFeatureDetailSegments(selectedRouteFeature, runs) : [],
    [selectedRouteFeature, runs],
  );
  const chartSelectedRangeMetres = selectedGradientSegment
    ? {
        startDistanceMetres: selectedGradientSegment.startDistanceMetres,
        endDistanceMetres: selectedGradientSegment.endDistanceMetres,
      }
    : selectedRouteFeature
      ? {
          startDistanceMetres: selectedRouteFeature.startDistanceMetres,
          endDistanceMetres: selectedRouteFeature.endDistanceMetres,
        }
      : null;
  const selectedSegmentStartElevationMetres = selectedGradientSegment
    ? (interpolateRoutePointAt(
        elevationDisplayPoints,
        selectedGradientSegment.startDistanceMetres,
      )?.elevationMetres ?? null)
    : null;
  const selectedSegmentEndElevationMetres = selectedGradientSegment
    ? (interpolateRoutePointAt(
        elevationDisplayPoints,
        selectedGradientSegment.endDistanceMetres,
      )?.elevationMetres ?? null)
    : null;
  const routeFeatureOverlay: RouteFeatureOverlay = {
    features: routeFeatures,
    selectedFeatureId: selectedRouteFeatureId,
    onSelectRouteFeature: selectRouteFeature,
  };
  const handleChartTapDistance = (distanceMetres: number) => {
    const result = resolveElevationChartTap(
      distanceMetres,
      routeFeatures,
      selectedRouteFeature,
      microDetailSegments,
    );
    if (result?.kind === "feature") {
      selectRouteFeature(result.feature.id);
    } else if (result?.kind === "segment") {
      setSelectedGradientSegment(result.segment);
    }
  };

  return (
    <section aria-label="Planning" className="screen planning-screen">
      <h1 className="screen-title">Plan a route</h1>

      {!hasKey ? <NoApiKeyNotice onOpenSettings={onNavigateToSettings} /> : null}

      {hydrationStatus === "loading" ? (
        <p className="status-row" role="status">
          Loading your draft…
        </p>
      ) : null}

      {hydrationStatus === "failed" ? (
        <div className="row">
          <p className="field-error" role="alert">
            Your saved draft could not be loaded. Nothing in storage has been changed.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setHydrationStatus("loading");
              setHydrationRetryToken((token) => token + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {editCopyMeta ? (
        <p className="status-row status-row--info" role="status">
          {describeEditCopyNotice(editCopyMeta)}
        </p>
      ) : null}

      <div className="planning-map-container">
        <MapView
          points={mapPoints}
          currentPosition={currentPosition ?? undefined}
          mapFactory={mapFactory}
          planningOverlay={planningOverlay}
          warningOverlay={warningOverlay}
          routeFeatureOverlay={routeFeatureOverlay}
          gradientOverlay={{ segments: microDetailSegments }}
          centreTarget={centreTarget}
          orientNorthTarget={orientNorthTarget}
          boundsTarget={boundsTarget}
          suppressInitialOverviewFit={suppressInitialOverviewFit}
          onUserCameraInteraction={() => {
            hasManualCameraActionRef.current = true;
            hasManualGestureRef.current = true;
            setIsCameraSettled(false);
          }}
          onCameraSettled={(camera) => {
            setCrosshairCoordinate(camera.coordinate);
            setSettledOrientation({
              bearingDegrees: camera.bearingDegrees,
              pitchDegrees: camera.pitchDegrees,
            });
            setIsCameraSettled(true);
          }}
        />
        <div
          aria-hidden="true"
          className="planning-crosshair"
          data-testid="planning-crosshair"
        />
        <button
          type="button"
          className="planning-crosshair-callout"
          onClick={handlePlacementHere}
          disabled={
            !crosshairCoordinate ||
            !isCameraSettled ||
            interactionMode.kind === "selected" ||
            selectedWarningIndex !== null ||
            selectedRouteFeatureId !== null
          }
        >
          {describeCrosshairAction(interactionMode, state.present.waypoints)}
        </button>
        <div className="planning-map-controls">
          <button
            type="button"
            className="planning-map-control"
            onClick={handleLocateMe}
            disabled={locateStatus === "locating"}
            aria-label="Locate me"
          >
            {locateStatus === "locating" ? "Locating…" : "⌖"}
          </button>
          <button
            type="button"
            className={`planning-map-control${isNorthUpTopDown ? " is-pressed" : ""}`}
            onClick={handleRequestNorthUp}
            aria-label="North-up, top-down view"
            aria-pressed={isNorthUpTopDown}
          >
            N
          </button>
        </div>
        <div className="planning-map-status-overlay">
          {locateStatus === "failed" ? (
            <p role="status" className="planning-map-status-message">
              Your location could not be determined.
            </p>
          ) : null}
          {selectedWarningIndex !== null ? (
            <p role="status" className="planning-map-status-message">
              Clear the selected warning to place or move a waypoint.
            </p>
          ) : null}
          {selectedRouteFeatureId !== null ? (
            <p role="status" className="planning-map-status-message">
              Clear the selected route feature to place or move a waypoint.
            </p>
          ) : null}
        </div>
      </div>

      <div className="panel stack planning-section">
        <div role="group" aria-label="Waypoint actions" className="row">
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
            className="btn-secondary"
            onClick={() => {
              dispatchWaypointAction({ type: "returnToStart" });
            }}
            disabled={!canReturnToStart}
          >
            Return to start
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleReverseRoute}
            disabled={state.present.waypoints.length < 2}
          >
            Reverse route
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

        <div className="planning-calculate-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={routing.calculateNow}
            disabled={
              state.present.waypoints.length < 2 || !hasKey || routing.isCalculating
            }
          >
            {routing.isCalculating
              ? routing.updatingLegCount !== null
                ? `Calculating ${String(routing.updatingLegCount)} route sections…`
                : "Calculating…"
              : routing.lastErrorMessage
                ? "Try again"
                : "Calculate route"}
          </button>
          {hasKey ? (
            <p className="status-row" role="status">
              {describeProviderKeyStatus(key, verification, now).headline}
            </p>
          ) : null}
          {routing.lastErrorMessage ? (
            <p className="field-error" role="alert">
              {routing.lastErrorMessage}
            </p>
          ) : null}
          {routing.isStale && routing.state.kind === "routed" ? (
            <p className="status-row" role="status">
              {describeStaleRouteStatus({
                previousProfile: routing.state.route.source.profile,
                currentProfile: profile,
                isCalculating: routing.isCalculating,
              })}
            </p>
          ) : null}
          <details className="settings-disclosure">
            <summary>How recalculation works</summary>
            <p>
              A route is calculated in sections between waypoints. The first calculation
              uses one routing request per section; later edits normally recalculate only
              changed sections.
            </p>
          </details>
        </div>

        <div className="row">
          <p className="field-hint">
            {describeCurrentDraftRoutingSummary(profile, avoidFerries)}
          </p>
          <details className="settings-disclosure">
            <summary>Change</summary>
            <div className="stack">
              <div>
                <div
                  role="group"
                  aria-label="Cycling profile for this draft"
                  className="cycling-profile-group"
                >
                  {ROUTING_PROFILES.map((metadata) => {
                    const isSelected = profile === metadata.value;
                    return (
                      <button
                        key={metadata.value}
                        type="button"
                        className={
                          isSelected
                            ? "cycling-profile-button is-selected"
                            : "cycling-profile-button"
                        }
                        aria-pressed={isSelected}
                        onClick={() => {
                          noteHydrationOverriddenByUserEdit("profile");
                          setProfile(metadata.value);
                        }}
                      >
                        {metadata.label}
                      </button>
                    );
                  })}
                </div>
                <p className="field-hint">{describeRoutingProfile(profile)}</p>
              </div>
              <label className="setting-row" htmlFor="planning-avoid-ferries-checkbox">
                <input
                  id="planning-avoid-ferries-checkbox"
                  type="checkbox"
                  className="setting-row-checkbox"
                  checked={avoidFerries}
                  onChange={(event) => {
                    noteHydrationOverriddenByUserEdit("avoidFerries");
                    setAvoidFerries(event.target.checked);
                  }}
                />
                <span className="setting-row-text">
                  <span className="setting-row-title">Avoid ferries for this draft</span>
                </span>
              </label>
            </div>
          </details>
        </div>

        <div className="row">
          <button
            type="button"
            className="btn-danger"
            ref={clearDraftTriggerRef}
            onClick={handleClearDraftClick}
            disabled={isSaving || isClearing}
          >
            Clear draft
          </button>
          {clearDraftError ? (
            <p className="field-error" role="alert">
              {clearDraftError}
            </p>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={isClearDraftConfirmOpen}
        title="Clear this draft?"
        message="This removes all waypoints, the calculated route and other unsaved draft details. Saved routes are not affected."
        confirmLabel={isClearing ? "Clearing…" : "Clear draft"}
        cancelLabel="Cancel"
        confirmDisabled={isClearing}
        cancelDisabled={isClearing}
        onConfirm={handleClearDraftConfirm}
        onCancel={handleClearDraftCancel}
      />

      <div className="stack planning-section">
        <h2>Waypoints</h2>
        <WaypointList
          waypoints={state.present.waypoints}
          waypointRoles={waypointRoles}
          interactionMode={interactionMode}
          onSelect={(waypointId) => {
            // Tapping the already-selected waypoint again deselects it —
            // but only when no relocation is active for it, mirroring
            // Move/Insert-after's own toggle idiom above. Suspending on
            // effectivePendingAction (rather than pendingWaypointAction
            // directly) keeps this consistent with interactionMode's own
            // derivation: a stale pending action for a waypoint that is no
            // longer selected already reads as "no relocation active"
            // everywhere else in this file.
            const shouldDeselect =
              effectivePendingAction === null && waypointId === state.selectedWaypointId;
            dispatchWaypointAction({
              type: "select",
              waypointId: shouldDeselect ? null : waypointId,
            });
          }}
          onStartMove={handleStartMove}
          onStartInsertAfter={handleStartInsertAfter}
          onMoveUp={(waypointId) => {
            const index = state.present.waypoints.findIndex((w) => w.id === waypointId);
            dispatchWaypointAction({ type: "reorder", waypointId, toIndex: index - 1 });
          }}
          onMoveDown={(waypointId) => {
            const index = state.present.waypoints.findIndex((w) => w.id === waypointId);
            dispatchWaypointAction({ type: "reorder", waypointId, toIndex: index + 1 });
          }}
          onDelete={(waypointId) => {
            dispatchWaypointAction({ type: "delete", waypointId });
          }}
        />
      </div>

      {routing.state.kind === "routed" ? (
        <RouteSummaryPanel
          route={routing.state.route}
          waypointCount={routing.state.waypoints.length}
          warnings={displayWarnings}
          selectedWarningIndex={selectedWarningIndex}
          onSelectWarning={handleSelectWarning}
          onClearWarningSelection={handleClearWarningSelection}
          revealToken={warningRevealToken}
          gradientSegments={microDetailSegments}
          displayPoints={elevationDisplayPoints}
          routeFeatures={routeFeatures}
          selectedRouteFeature={selectedRouteFeature}
          onClearRouteFeatureSelection={handleClearRouteFeatureSelection}
          onTapDistance={handleChartTapDistance}
          selectedRangeMetres={chartSelectedRangeMetres}
          selectedGradientSegment={selectedGradientSegment}
          selectedSegmentStartElevationMetres={selectedSegmentStartElevationMetres}
          selectedSegmentEndElevationMetres={selectedSegmentEndElevationMetres}
          onClearGradientSegmentSelection={handleClearGradientSegmentSelection}
        />
      ) : null}

      <div className="panel stack planning-section">
        <h2>Save or export</h2>
        <div className="stack">
          <label htmlFor="planning-route-name">Route name</label>
          <input
            id="planning-route-name"
            type="text"
            className="field-input"
            value={state.present.routeName}
            onChange={(event) => {
              noteHydrationOverriddenByUserEdit("routeName");
              // Plain dispatch, not dispatchWaypointAction: typing a name
              // must not clear an active warning/route-feature selection
              // (unlike an actual waypoint edit), and the reducer's
              // "rename" case itself never creates a history entry — see
              // waypointHistory.ts's own doc comment on why route-name
              // typing must stay outside undo/redo.
              dispatch({ type: "rename", routeName: event.target.value });
            }}
          />
        </div>
        {!canSaveOrExport && !routing.isStale ? (
          <p className="field-hint">
            Calculate a complete routed result before saving or exporting.
          </p>
        ) : null}
        {saveError ? (
          <p className="field-error" role="alert">
            {saveError}
          </p>
        ) : null}
        {exportError ? (
          <p className="field-error" role="alert">
            {exportError}
          </p>
        ) : null}
        <div className="row">
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={!canSaveOrExport || isSaving || isClearing}
          >
            {isSaving ? "Saving…" : "Save route"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExport}
            disabled={!canSaveOrExport}
          >
            Export GPX
          </button>
        </div>
      </div>
    </section>
  );
}
