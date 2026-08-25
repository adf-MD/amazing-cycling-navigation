import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  canDeriveEditableWaypoints,
  resolveEditableWaypoints,
} from "../../domain/editableWaypoints.ts";
import { createWaypointId } from "../../domain/id.ts";
import { hasTrustedManoeuvres } from "../../domain/manoeuvreTrust.ts";
import type { PlannedRoute, Waypoint } from "../../domain/types.ts";
import { MapView, type RouteFeatureOverlay } from "../../map/MapView.tsx";
import type { MapFactory } from "../../map/mapAdapter.ts";
import type { GeolocationError, GeolocationSource } from "../../platform/geolocation.ts";
import { systemClock, useNow, type Clock } from "../../platform/clock.ts";
import { logError } from "../../platform/errorLog.ts";
import { useOnlineStatus } from "../../platform/onlineStatus.ts";
import { isWakeLockSupported, type WakeLockSource } from "../../platform/wakeLock.ts";
import {
  analyzeRouteElevationProfile,
  clipClassifiedSegments,
} from "../../navigation/gradient.ts";
import {
  detectRouteFeatures,
  findFeatureAtDistance,
  findNextClimbAfterDistance,
  listClimbsInRouteOrder,
  resolveElevationChartTap,
  type ClimbGradientBand,
  type DescentLocalKey,
  type RouteFeature,
} from "../../navigation/routeFeatures.ts";
import { buildFeatureDetailSegments } from "../../navigation/routeFeatureDetail.ts";
import type { MicroDetailVisualKey } from "../../navigation/routeFeaturePalette.ts";
import type { ClassifiedSegment } from "../../navigation/gradient.ts";
import {
  buildClimbChartViewModel,
  computeClimbProgressMetrics,
  selectEffectiveElevationView,
} from "../../navigation/climbElevationView.ts";
import {
  classifyManoeuvreUrgency,
  selectNextManoeuvre,
} from "../../navigation/nextManoeuvre.ts";
import type { ElevationViewMode } from "../../navigation/types.ts";
import {
  ELEVATION_VIEW_MODE_OPTIONS,
  interpolateRoutePointAt,
  selectElevationDistanceGuides,
} from "../../navigation/upcomingElevation.ts";
import { getDraft, saveDraft } from "../../storage/planningDraftRepository.ts";
import { getPlanningPreferences } from "../../storage/planningPreferencesRepository.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";
import { ClimbCategoriesDisclosure } from "../shared/ClimbCategoriesDisclosure.tsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import {
  ElevationChart,
  type ElevationChartSelectedRange,
} from "../shared/ElevationChart.tsx";
import { GradientColoursDisclosure } from "../shared/GradientColoursDisclosure.tsx";
import { GradientSegmentDetailsPanel } from "../shared/GradientSegmentDetailsPanel.tsx";
import { RouteFeatureDetailsPanel } from "../shared/RouteFeatureDetailsPanel.tsx";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";
import { RidingClimbCue } from "./RidingClimbCue.tsx";
import { RidingClimbPreviewPanel } from "./RidingClimbPreviewPanel.tsx";
import { RidingClimbProgressPanel } from "./RidingClimbProgressPanel.tsx";
import { RidingClimbSelector } from "./RidingClimbSelector.tsx";
import { RidingCompactManoeuvreCue } from "./RidingCompactManoeuvreCue.tsx";
import { RidingImmersiveHeader } from "./RidingImmersiveHeader.tsx";
import { RidingNextManoeuvrePanel } from "./RidingNextManoeuvrePanel.tsx";
import { RidingRouteCompletionPanel } from "./RidingRouteCompletionPanel.tsx";
import { RidingStatusCard } from "./RidingStatusCard.tsx";
import { useRideCamera } from "./useRideCamera.ts";
import { useRideNavigation } from "./useRideNavigation.ts";
import { useRouteCompletionCandidate } from "./useRouteCompletionCandidate.ts";

export interface RidingScreenProps {
  route: PlannedRoute;
  /** A one-use resume intent from App.tsx's launcher-driven cold recovery
   * (backlog item 72) — set only when this screen was mounted via
   * RidingLauncher's "Resume ride" action, undefined for every other entry
   * path (a fresh route, an ordinary Routes-card reopen, a Planning-save-
   * then-ride, or a still-mounted screen after an in-session Pause, whose
   * token — if any — was already consumed on first mount and is never
   * re-consumed). Consumed at most once per distinct value, only once
   * restoration has genuinely completed for this exact route, via the same
   * authoritative handleStart() transition the "Resume ride"/"Start riding"
   * button itself uses. */
  resumeIntentToken?: number;
  geolocationSource?: GeolocationSource;
  mapFactory?: MapFactory;
  clock?: Clock;
  wakeLockSource?: WakeLockSource;
  onRidingActiveChange?: (active: boolean) => void;
  /** Called once an "Edit copy" draft has been seeded and persisted
   * successfully — the caller (App.tsx) is responsible only for switching
   * screens, mirroring onNavigateToSettings's exact shape; all the actual
   * draft-seeding work happens in this component. Reversing a route is no
   * longer a pre-ride action at all (backlog item 38 moved it into
   * Planning itself, as an ordinary, repeatable, undoable edit — see
   * PlanningScreen.tsx's "Reverse route" button and
   * waypointHistoryReducer's "reverse" case) — this callback only ever
   * fires for a plain, unreversed copy now. */
  onNavigateToPlanning?: () => void;
  /** Called once a successful End ride or Finish ride has fully completed —
   * after nav.finish()'s own storage-clear-then-reset lifecycle has already
   * resolved AND this screen's own runtime cleanup (camera.resetCamera(),
   * completion.reset(), reachedManoeuvreIndex reset, closing the
   * confirmation dialog) has already applied. App.tsx is the only current
   * caller; it clears its own selectedRoute in response, which is what
   * actually unmounts this screen and shows the empty Ride launcher in its
   * place — this component has no notion of what the caller does with the
   * notification. Never called on cancellation, Escape, a genuine storage
   * failure, or a duplicate/re-entrant submission. If the callback itself
   * throws, that's logged only (see performFinalizeRide) — finalisation has
   * already fully succeeded by this point, so a bug in the caller's own
   * handler must never be reported as a finalisation failure. */
  onRideFinalized?: () => void;
  /** Called when the rider taps the pre-ride-only "Back to Ride options"
   * action (backlog item 51) — a synchronous, non-destructive reset with
   * no confirmation, no persisted-storage write, and no geolocation/
   * camera/wake-lock side effect of any kind. Only ever rendered while
   * nav.geolocationStatus === "idle" (this screen's own idle/pre-ride
   * panel), for both a clean and a resumable pre-ride state alike; never
   * once GPS tracking has genuinely started — watching/error already have
   * their own separate End-ride lifecycle instead. Disabled while
   * activeFinalizeSource !== null, to avoid unmounting this screen while
   * an End-ride finalize it started moments earlier is still writing to
   * storage (see this prop's own render-site comment for the exact race).
   * App.tsx is the only current caller; it resets its own in-memory
   * ridingContent pointer to "none" in response, which is what actually
   * unmounts this screen and shows the Ride launcher in its place —
   * mirrors onRideFinalized's "caller decides what to do with the
   * notification" shape, but never touches persisted rideState the way a
   * completed End/Finish ride does. */
  onReturnToRideLauncher?: () => void;
  /** Called once a successful Pause (backlog item 55) has fully completed —
   * after nav.pause()'s own write-the-resumable-snapshot-then-stop
   * lifecycle has already resolved. Unlike onRideFinalized, Pause never
   * clears persisted storage — the active-ride row stays present and
   * resumable, so App.tsx's response (resetting only its own in-memory
   * ridingContent pointer back to "none") drops the rider onto a Ride
   * launcher that immediately offers Resume route for this same session.
   * Never called on a genuine storage failure or a duplicate/re-entrant
   * submission. If the callback itself throws, that's logged only (see
   * performPauseRide) — the pause has already fully succeeded by this
   * point, so a bug in the caller's own handler must never be reported as
   * a pause failure. */
  onRidePaused?: () => void;
}

const DEFAULT_CAMERA_STATE: StoredCameraState = {
  mode: "overview",
  coordinate: null,
  zoom: null,
  bearingDegrees: 0,
  pitchDegrees: 0,
};

// MapLibre's own already-established single-level step, mirroring
// PlanningScreen.tsx's identical PLANNING_ZOOM_STEP — never a
// configurable product setting (backlog item 53).
const RIDING_ZOOM_STEP = 1;

const EDIT_COPY_DIALOG_TITLE = "Replace your current draft?";
const EDIT_COPY_DIALOG_MESSAGE =
  "Editing this route will replace your unsaved draft in Planning. This route itself will remain unchanged.";
const EDIT_COPY_CONFIRM_LABEL = "Replace and edit";
const EDIT_COPY_GENERIC_ERROR_MESSAGE =
  "The editable copy could not be created on this device. Try again.";

function formatGeolocationError(error: GeolocationError): string {
  switch (error.reason) {
    case "permission-denied":
      return "Location permission was denied. Allow location access in your browser settings to use Riding mode.";
    case "timeout":
      return "Getting your location timed out. Check you have a clear view of the sky and try again.";
    case "unsupported":
      return "This browser does not support location services.";
    case "position-unavailable":
    default:
      return "Your location is currently unavailable.";
  }
}

function isSameElevationViewMode(a: ElevationViewMode, b: ElevationViewMode): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "upcoming" && b.kind === "upcoming"
    ? a.windowMetres === b.windowMetres
    : true;
}

function elevationViewModeLabel(mode: ElevationViewMode): string {
  return mode.kind === "full" ? "Full" : `${String(mode.windowMetres / 1000)} km`;
}

function elevationViewModeKey(mode: ElevationViewMode): string {
  return mode.kind === "full" ? "full" : `upcoming-${String(mode.windowMetres)}`;
}

export function RidingScreen({
  route,
  resumeIntentToken,
  geolocationSource,
  mapFactory,
  clock = systemClock,
  wakeLockSource,
  onRidingActiveChange,
  onNavigateToPlanning,
  onRideFinalized,
  onReturnToRideLauncher,
  onRidePaused,
}: RidingScreenProps) {
  // Bridges useRideCamera's current camera state into useRideNavigation's
  // persistence. Both hooks are called in this same render, and
  // useRideCamera needs useRideNavigation's restoredCameraState as an
  // input, so neither can feed the other's *current* render output back
  // into its own call — a stable getter reading a ref (updated below,
  // once camera exists) avoids that without a setState-in-effect bridge.
  const cameraStateRef = useRef<StoredCameraState>(DEFAULT_CAMERA_STATE);
  const getCameraState = useCallback(() => cameraStateRef.current, []);

  const nav = useRideNavigation(route, { geolocationSource, clock, getCameraState });
  const camera = useRideCamera({
    routeId: route.id,
    routePoints: route.points,
    currentFix: nav.currentFix,
    isStale: nav.isStale,
    matchedDistanceFromStartMetres: nav.matchedDistanceFromStartMetres,
    offRouteLevel: nav.offRouteLevel,
    restoredCameraState: nav.restoredCameraState,
  });

  useEffect(() => {
    cameraStateRef.current = camera.persistableCameraState;
  }, [camera.persistableCameraState]);

  // Zoom in/out (backlog item 53) — never calls camera.reportUserInteraction,
  // so a zoom press keeps Follow engaged with no "Map follow paused" toast,
  // a deliberate product decision (zooming while followed is a normal
  // riding action, unlike a genuine manual pan/rotate/pitch gesture).
  const { requestZoom: cameraRequestZoom, requestFollow: cameraRequestFollow } = camera;
  const { start: navStart } = nav;
  const handleZoomIn = useCallback(() => {
    cameraRequestZoom(RIDING_ZOOM_STEP);
  }, [cameraRequestZoom]);
  const handleZoomOut = useCallback(() => {
    cameraRequestZoom(-RIDING_ZOOM_STEP);
  }, [cameraRequestZoom]);

  // Reports whether this ride is genuinely GPS-active back to App, purely
  // so the immersive-Riding-shell contract (immersiveRidingShell.ts,
  // backlog item 55 — MainNavigation and its wrapping <header> genuinely
  // absent while active, replaced by this screen's own compact
  // Pause/title/End header) can react to it. nav.geolocationStatus is the
  // app's own authoritative
  // ride-tracking state and is already used for this exact "is riding
  // genuinely under way" boundary elsewhere in this file — the wake-lock
  // gate, the next-manoeuvre panel, and the map's active/overview class
  // all key off the identical `!== "idle"` predicate — so this is a
  // pass-through of an existing concept, not a newly-derived boolean.
  // "error" counts as active: the underlying watch is deliberately never
  // torn down for a transient GPS error (see the "Try again" comment
  // above), so a mid-ride error stays part of one continuous ride
  // session. This is App's first use of a callback prop to receive state
  // back from a child screen — mirrors the existing
  // onOpenRoute/onRouteSaved/onNavigateToSettings convention rather than
  // introducing React context. The cleanup path resets App's copy to
  // false the instant the rider navigates away from Riding entirely:
  // this screen always fully unmounts on every screen switch (no `key`
  // anywhere in App.tsx's conditional rendering), so unmount is the only
  // other place this can change, and needs no separate handling.
  useEffect(() => {
    onRidingActiveChange?.(nav.geolocationStatus !== "idle");
    return () => {
      onRidingActiveChange?.(false);
    };
  }, [nav.geolocationStatus, onRidingActiveChange]);

  const now = useNow(clock);
  const fixAgeMs = nav.currentFix ? now - nav.currentFix.timestampMs : null;
  const online = useOnlineStatus();
  // Gates the single compact status card (backlog item 75): true whenever
  // there is anything for it to say — a fix (even a stale/idle-retained
  // one, e.g. a paused ride awaiting Resume) or an active, non-idle
  // geolocation watch/error, which covers "waiting for the first fix" and
  // "error before any fix" too. Wake lock is gated separately below, since
  // it stays unsupported-or-idle-suppressed independently of whether the
  // card itself has status content to show.
  const showStatusCard = nav.geolocationStatus !== "idle" || Boolean(nav.currentFix);

  // Computed once per loaded route (route's identity is stable for the
  // component's lifetime; recomputing per GPS fix would be wasted work for
  // no visible benefit, since the analysis never depends on progress).
  // The 2/5/10 km windowed views clip this same analysis rather than
  // re-running it on their own point slice, so Full and windowed views
  // always agree on classification at the same global route distance.
  // `displayPoints` is the shared smoothed series used as the chart's
  // prominent line — useRideNavigation's own windowed view is already
  // sourced from this same analysis, so only the pre-start/Full call
  // sites below need to switch from `route.points` explicitly.
  // `routeFeatures` is detected from the exact same one-per-route profile
  // (never a second resample/smooth pass) — deliberately not added to
  // useRideNavigation, mirroring how this screen already independently
  // re-derives the elevation profile in its own memo, separate from the
  // hook's own internal one, keeping the hook's public contract stable.
  const { runs, displayPoints, routeFeatures } = useMemo(() => {
    const profile = analyzeRouteElevationProfile(route.points);
    return {
      runs: profile.runs,
      displayPoints: profile.displayPoints,
      routeFeatures: detectRouteFeatures(profile),
    };
  }, [route]);

  // An explicit feature choice, tagged with the route it was made for —
  // rather than storing the "current" feature id directly and resetting
  // it imperatively (via an effect or a during-render ref comparison,
  // both awkward here: the former trips this project's
  // react-hooks/set-state-in-effect rule, the latter trips
  // react-hooks/refs for reasons specific to this component that weren't
  // worth chasing further), the *displayed* selection below is a pure
  // derivation: an explicit choice only counts while its routeId still
  // matches the current route, and otherwise falls back to the pre-ride
  // default (the first recognised climb). This also means the fallback
  // recomputes for free if the route ever changed without this screen
  // unmounting, rather than depending on that always being true.
  const [explicitFeatureSelection, setExplicitFeatureSelection] = useState<{
    routeId: string;
    featureId: string | null;
  } | null>(null);

  const [selectedGradientSegment, setSelectedGradientSegment] =
    useState<ClassifiedSegment<MicroDetailVisualKey> | null>(null);

  // Manual selection of the Climb button while no climb is active yet —
  // previews the next recognised climb (backlog item 71). Tagged by route
  // and climb id, mirroring explicitFeatureSelection's own established
  // idiom exactly: a pure derivation below only honours this while its
  // climbId still matches the currently-upcoming climb, so every leave/
  // enter/route-change/skip transition self-resets with no imperative
  // clearing code anywhere. Deliberately NOT persisted (like activeView)
  // — a suspend/reload always restores to "no preview selected",
  // requiring one more tap; only the active-climb dismissal state is
  // persisted.
  const [climbPreviewSelection, setClimbPreviewSelection] = useState<{
    routeId: string;
    climbId: string;
  } | null>(null);

  // Which of the two fixed active-Riding views is shown (backlog item 56).
  // Presentation-only, deliberately not persisted: defaults to "map" on
  // mount and is reset to "map" only inside handleStart's own idle-only
  // branch below (a genuinely fresh Start or an explicit Resume-riding
  // tap), never on the mid-ride "Try again" retry path — a rider who was
  // reviewing Profile through a transient GPS error must not be yanked
  // back to Map. A Pause->relaunch->Resume cycle gets a fresh "map" default
  // for free, since this whole screen unmounts on Pause.
  const [activeView, setActiveView] = useState<"map" | "profile">("map");

  // Tracks the furthest manoeuvre reliably reached so far, so selection
  // stays monotonic (never regresses on GPS jitter) — derived during
  // render and conditionally set, the same pattern this file already uses
  // for explicitFeatureSelection, rather than an effect. No route-id
  // tagging is needed here (unlike explicitFeatureSelection): this screen
  // fully remounts on route change, and selectNextManoeuvre itself no-ops
  // (returning the unchanged previous index) while there is no reliable
  // presentation distance yet, so there is nothing to reset on handleStart
  // either.
  const [reachedManoeuvreIndex, setReachedManoeuvreIndex] = useState(0);
  // Restores the invariant "a non-null selection is always trustworthy":
  // gate at selectNextManoeuvre's own input (an empty list) rather than
  // only in the panel's messaging, so a route with non-empty but
  // untrusted manoeuvres (structurally possible now that GPX re-imports
  // can carry manoeuvres) never drives live turn-by-turn navigation.
  const isTrustedForNavigation = hasTrustedManoeuvres(route);
  const { reachedIndex: nextReachedManoeuvreIndex, selection: nextManoeuvre } =
    selectNextManoeuvre(
      isTrustedForNavigation ? route.manoeuvres : [],
      nav.presentationDistanceFromStartMetres,
      reachedManoeuvreIndex,
    );
  if (nextReachedManoeuvreIndex !== reachedManoeuvreIndex) {
    setReachedManoeuvreIndex(nextReachedManoeuvreIndex);
  }

  // Recognised climbs, in route order, for the pre-ride selector below.
  const climbs = useMemo(() => listClimbsInRouteOrder(routeFeatures), [routeFeatures]);

  // True only for the genuine pre-ride full-route overview (backlog item
  // 77) — never merely "matchedDistanceFromStartMetres is null", since a
  // paused ride restored from storage (still geolocationStatus === "idle",
  // Resume not yet pressed) can already have restored matched progress and
  // a restored elevationViewMode. If that restored mode is "full", the
  // chart still shows the whole route with no active tracking under way,
  // so it must count as the pre-ride overview too; if the restored mode is
  // a window (2 km/10 km), it is not "the full-route overview" and must be
  // left exactly as it renders today. Once geolocationStatus leaves
  // "idle", tracking has genuinely started (Start/Resume was pressed) even
  // if the very first fix hasn't matched onto the route yet, so that
  // remains the ordinary active-Riding presentation.
  const isPreRideFullRouteOverview =
    nav.geolocationStatus === "idle" &&
    (nav.matchedDistanceFromStartMetres === null ||
      nav.elevationProfileDisplay.kind === "full");

  // No feature is selected by default — the pre-ride dropdown starts on
  // "All route" (and a fresh route never carries over a previous route's
  // selection, since an explicit choice only counts while its own routeId
  // still matches the current route).
  const selectedRouteFeatureId =
    explicitFeatureSelection?.routeId === route.id
      ? explicitFeatureSelection.featureId
      : null;

  const selectedFeature =
    routeFeatures.find((feature) => feature.id === selectedRouteFeatureId) ?? null;
  // The recognised climb/descent the rider is currently riding through,
  // determined via the existing frozen-while-off-route presentation-
  // distance policy (see useRideNavigation/rideNavigationCore) — never
  // the live/raw matched distance, matching every other presentation
  // value already keyed off this same frozen distance.
  const activeFeature =
    nav.presentationDistanceFromStartMetres === null
      ? null
      : findFeatureAtDistance(routeFeatures, nav.presentationDistanceFromStartMetres);
  // An explicit selection wins over merely being "active" — a rider can
  // inspect a different climb than the one they're currently on.
  const microDetailFeature = selectedFeature ?? activeFeature;
  // Numbers the shared details panel's heading exactly like the pre-ride
  // dropdown ("Climb 2 · Category 3"), whichever way the climb was
  // selected (dropdown, map tap or chart tap) — undefined once riding is
  // under way (no numbering there, matching the existing mid-ride
  // heading) and for a descent (no numbering concept there).
  let preRideClimbNumber: number | undefined;
  if (nav.geolocationStatus === "idle" && microDetailFeature?.kind === "climb") {
    const index = climbs.findIndex((climb) => climb.id === microDetailFeature.id);
    preRideClimbNumber = index === -1 ? undefined : index + 1;
  }
  // buildFeatureDetailSegments does real classify+merge+flicker-suppress
  // work over the feature's owning run (unlike the old cheap clip-only
  // approach), so this must be memoized — otherwise it would re-run on
  // every GPS tick during active Riding.
  const microDetailSegments = useMemo(
    () =>
      microDetailFeature ? buildFeatureDetailSegments(microDetailFeature, runs) : [],
    [microDetailFeature, runs],
  );
  // A read-only, whole-climb preview of whatever's selected in the pre-ride
  // dropdown — same gate as preRideClimbNumber above, so the heading, this
  // chart, and RouteFeatureDetailsPanel's own facts always describe the
  // same climb in the same render. Reuses microDetailSegments (already
  // memoized above) rather than reclassifying. Built inline, unmemoized,
  // matching how the active Climb-view branch below has always constructed
  // its own equivalent window — this one is strictly cheaper, since it only
  // changes on a dropdown-driven re-render, never per GPS tick.
  const preRideClimbChart =
    nav.geolocationStatus === "idle" &&
    microDetailFeature?.kind === "climb" &&
    preRideClimbNumber !== undefined
      ? (() => {
          const viewModel = buildClimbChartViewModel(
            { kind: "pre-ride-selected-feature" },
            microDetailFeature,
            displayPoints,
            microDetailSegments,
          );
          return (
            <ElevationChart
              points={viewModel.points}
              domain={viewModel.domain}
              gradientSegments={viewModel.gradientSegments}
              areaFill={viewModel.areaFill}
              marker={viewModel.marker}
              ariaLabel={`Elevation profile for Climb ${String(preRideClimbNumber)}`}
            />
          );
        })()
      : undefined;
  // The descent counterpart of preRideClimbChart (backlog item 79) — a
  // read-only preview of whatever recognised descent is selected pre-ride
  // (dropdown has no descent entries, but the map and full-profile chart
  // both select descents through the same explicitFeatureSelection path),
  // rebased to local distance from zero exactly like the climb chart.
  // Descents are never numbered anywhere in this app, so there is no
  // equivalent to preRideClimbNumber here. Mutually exclusive with
  // preRideClimbChart by construction (each is gated on a different
  // feature.kind), so the two are combined with `??` at the
  // RouteFeatureDetailsPanel call site below.
  const preRideDescentChart =
    nav.geolocationStatus === "idle" && microDetailFeature?.kind === "descent"
      ? (() => {
          const viewModel = buildClimbChartViewModel(
            { kind: "pre-ride-selected-feature" },
            microDetailFeature,
            displayPoints,
            microDetailSegments,
          );
          return (
            <ElevationChart
              points={viewModel.points}
              domain={viewModel.domain}
              gradientSegments={viewModel.gradientSegments}
              areaFill={viewModel.areaFill}
              marker={viewModel.marker}
              ariaLabel="Elevation profile for selected recognised descent"
            />
          );
        })()
      : undefined;
  // The climb the rider is actually riding through, independent of any
  // unrelated explicit tap/dropdown selection elsewhere (microDetailFeature
  // above) — Climb elevation view must always reflect live progress, never
  // a merely-inspected feature. A descent or an ordinary (unrecognised)
  // uphill never activates it, since activeFeature is null or a descent
  // there.
  const activeClimb = activeFeature?.kind === "climb" ? activeFeature : null;
  // The next recognised climb strictly ahead of the rider's frozen/
  // reliable position (backlog item 71) — never derived while idle (the
  // pre-ride briefing already has its own preview mechanism,
  // RidingClimbSelector's dropdown; this must not duplicate it there,
  // and a paused ride's restored idle position can already sit inside a
  // climb, which must not leak this active-Riding-only feature into the
  // pre-ride screen) and null before any fix/restored progress exists,
  // mirroring activeFeature's own null-when-unknown convention.
  const upcomingClimb =
    nav.geolocationStatus === "idle" || nav.presentationDistanceFromStartMetres === null
      ? null
      : findNextClimbAfterDistance(climbs, nav.presentationDistanceFromStartMetres);
  // Only counts while it still names the currently-upcoming climb — see
  // this state's own doc comment for why every leave/enter/route-change/
  // skip transition self-resets for free from this comparison alone.
  const climbPreviewSelectedClimbId =
    climbPreviewSelection?.routeId === route.id ? climbPreviewSelection.climbId : null;
  // Reuses microDetailSegments in the common case (nothing else explicitly
  // selected, so activeClimb === microDetailFeature) rather than always
  // re-running buildFeatureDetailSegments — still correct either way, since
  // both call sites reuse the exact same classify+merge+flicker-suppress
  // pipeline over the same runs.
  const activeClimbDetailSegments = useMemo(
    () =>
      activeClimb === null
        ? []
        : activeClimb === microDetailFeature
          ? microDetailSegments
          : buildFeatureDetailSegments(activeClimb, runs),
    [activeClimb, microDetailFeature, microDetailSegments, runs],
  );
  // Mirrors activeClimbDetailSegments's own reuse pattern above.
  const upcomingClimbDetailSegments = useMemo(
    () =>
      upcomingClimb === null
        ? []
        : upcomingClimb === microDetailFeature
          ? microDetailSegments
          : buildFeatureDetailSegments(upcomingClimb, runs),
    [upcomingClimb, microDetailFeature, microDetailSegments, runs],
  );
  const climbProgressMetrics = activeClimb
    ? computeClimbProgressMetrics(
        activeClimb,
        displayPoints,
        activeClimbDetailSegments,
        nav.presentationDistanceFromStartMetres,
      )
    : null;
  // The elevation view actually shown — see climbElevationView.ts's own
  // doc comment for why this pure derivation needs no effect and no
  // "already auto-shown" tracking state beyond dismissedClimbFeatureId
  // (for the active-climb case) or climbPreviewSelection (for the
  // upcoming-preview case, backlog item 71).
  const effectiveElevationView = selectEffectiveElevationView(
    nav.elevationViewMode,
    activeClimb,
    nav.dismissedClimbFeatureId,
    upcomingClimb,
    climbPreviewSelectedClimbId,
  );
  // Visual emphasis (the extra stroke-width bump) is reserved for an
  // explicit selection, never for a merely-active feature — mirrors the
  // map's own selected-feature-halo policy (no halo for "active" alone).
  const chartSelectedRangeMetres: ElevationChartSelectedRange | null =
    selectedGradientSegment
      ? {
          startDistanceMetres: selectedGradientSegment.startDistanceMetres,
          endDistanceMetres: selectedGradientSegment.endDistanceMetres,
        }
      : selectedFeature
        ? {
            startDistanceMetres: selectedFeature.startDistanceMetres,
            endDistanceMetres: selectedFeature.endDistanceMetres,
          }
        : null;
  const selectedSegmentStartElevationMetres = selectedGradientSegment
    ? (interpolateRoutePointAt(displayPoints, selectedGradientSegment.startDistanceMetres)
        ?.elevationMetres ?? null)
    : null;
  const selectedSegmentEndElevationMetres = selectedGradientSegment
    ? (interpolateRoutePointAt(displayPoints, selectedGradientSegment.endDistanceMetres)
        ?.elevationMetres ?? null)
    : null;

  const selectRouteFeature = useCallback(
    (id: string) => {
      setSelectedGradientSegment(null);
      setExplicitFeatureSelection({ routeId: route.id, featureId: id });
    },
    [route.id],
  );
  const handleClearRouteFeatureSelection = useCallback(() => {
    setExplicitFeatureSelection({ routeId: route.id, featureId: null });
    setSelectedGradientSegment(null);
  }, [route.id]);
  const handleClearGradientSegmentSelection = useCallback(() => {
    setSelectedGradientSegment(null);
  }, []);
  // Not useCallback-wrapped: microDetailSegments is itself a fresh array
  // every render (a cheap clip, not memoized), so this closure would gain
  // no stable identity from memoizing anyway.
  function handleChartTapDistance(distanceMetres: number): void {
    const result = resolveElevationChartTap(
      distanceMetres,
      routeFeatures,
      microDetailFeature,
      microDetailSegments,
    );
    if (result?.kind === "feature") {
      selectRouteFeature(result.feature.id);
    } else if (result?.kind === "segment") {
      setSelectedGradientSegment(result.segment);
    }
  }

  const routeFeatureOverlay: RouteFeatureOverlay = {
    features: routeFeatures,
    selectedFeatureId: selectedRouteFeatureId,
    onSelectRouteFeature: selectRouteFeature,
  };

  // "Edit copy" — a single pre-ride action that seeds a new Planning draft
  // from this route's recovered or derived waypoints (see
  // domain/editableWaypoints.ts). Backlog item 38 removed this file's
  // former second copy operation ("Reverse route") entirely — reversing a
  // route is now an ordinary, repeatable, undoable Planning edit instead
  // (see PlanningScreen.tsx), not a pre-ride seed-time choice — so this is
  // no longer a two-way, kind-parameterised guard; a single re-entrancy
  // ref is sufficient. Entirely self-contained: this screen owns the
  // meaningful-draft check, the confirmation, waypoint resolution and
  // persistence; App.tsx only ever switches screens once told to via
  // onNavigateToPlanning.
  const editCopyButtonRef = useRef<HTMLButtonElement>(null);
  const [isEditCopyConfirmOpen, setIsEditCopyConfirmOpen] = useState(false);
  const [isEditCopyInFlight, setIsEditCopyInFlight] = useState(false);
  const [editCopyError, setEditCopyError] = useState<string | null>(null);
  // Synchronous guard against a rapid double click/Confirm, mirroring
  // PlanningScreen.tsx's own isLocatingRef idiom — React state alone
  // isn't reliably readable synchronously across the same tick.
  const isEditCopyActionPendingRef = useRef(false);

  // End ride / Finish ride — the shared ride-finalisation lifecycle. Both
  // actions converge on one performFinalizeRide, mirroring
  // performEditCopy's own catch-block shape (logError, a source-tagged
  // accessible error message, focus restored to whichever button triggered
  // the action). endRideTriggerRef is shared across the two mutually
  // exclusive render sites the End-ride button can appear at (the
  // Resume-riding idle panel, and the active-tracking slot near the top of
  // the screen, directly after the offline notice and before the map) —
  // exactly one is ever mounted at a time.
  const endRideTriggerRef = useRef<HTMLButtonElement>(null);
  const finishRideButtonRef = useRef<HTMLButtonElement>(null);
  const [isEndRideConfirmOpen, setIsEndRideConfirmOpen] = useState(false);
  const [activeFinalizeSource, setActiveFinalizeSource] = useState<
    "end" | "finish" | null
  >(null);
  const [finalizeError, setFinalizeError] = useState<{
    source: "end" | "finish";
    message: string;
  } | null>(null);
  // Synchronous guard against a rapid double End/Finish submission,
  // mirroring isEditCopyActionPendingRef above — the primary UX guard;
  // useRideNavigation's own finish() also guards re-entrancy defensively.
  const isFinalizeActionPendingRef = useRef(false);
  // End-ride's trigger unmounts/remounts as its confirmation opens/closes
  // (item 50's in-place confirmation morph — see renderEndRideAction
  // below), so Cancel/Escape and a failed finalisation both record a
  // pending focus request here instead of calling .focus() directly —
  // mirrors PlanningScreen.tsx's pendingClearDraftFocusRef exactly (item
  // 49). Finish-ride's own trigger never unmounts (RidingRouteCompletionPanel
  // has no confirmation dialog to swap in), so it keeps its own plain
  // finalizeError-identity effect below and never touches this latch.
  const pendingEndRideFocusRef = useRef(false);

  // Pause — the reversible, non-destructive counterpart to End/Finish ride
  // (backlog item 55). Deliberately separate state from
  // activeFinalizeSource/finalizeError above, not a widened union: Pause
  // doesn't finalize anything, and mutual exclusion between Pause and
  // End/Finish is enforced primarily here at the screen level (each
  // action's own guard cross-checks the other's ref — see
  // performPauseRide/performFinalizeRide below), with useRideNavigation's
  // own isPausingRef/isFinalizingRef serving only as a defensive backstop.
  // Pause's own button never unmounts (no confirmation swaps it out — see
  // "Pause must not require a destructive confirmation"), so it needs no
  // pendingEndRideFocusRef-style unmount-dance; a plain finalizeError-
  // identity-style effect below is sufficient.
  const pauseButtonRef = useRef<HTMLButtonElement>(null);
  const [isPausePending, setIsPausePending] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  // Synchronous guard against a rapid double Pause submission, mirroring
  // isFinalizeActionPendingRef above. Also the primary, bidirectional
  // mutual-exclusion mechanism against End/Finish: performPauseRide checks
  // isFinalizeActionPendingRef before starting, and performFinalizeRide
  // checks this ref before starting — each screen-level guard cross-checks
  // the other's ref directly, which is what actually prevents Pause and
  // End/Finish from ever reaching useRideNavigation concurrently in
  // practice (the hook's own isPausingRef/isFinalizingRef cross-check is
  // only a defensive backstop beneath this, and is itself asymmetric for
  // an unrelated eslint-plugin-react-hooks reason — see that ref's own
  // declaration comment in useRideNavigation.ts).
  const isPauseActionPendingRef = useRef(false);

  const completion = useRouteCompletionCandidate({
    routeId: route.id,
    isRideActive: nav.geolocationStatus === "watching",
    currentFix: nav.currentFix,
    isStale: nav.isStale,
    offRouteLevel: nav.offRouteLevel,
    reliableDistanceFromStartMetres: nav.presentationDistanceFromStartMetres,
    routeTotalDistanceMetres: route.distanceMetres,
    routeFinalCoordinate: route.points.at(-1)?.coordinate ?? null,
    armed: nav.completionArmed,
  });

  // Persists the moment arming evidence is first detected, conditionally
  // during render — mirroring reachedManoeuvreIndex's own "adjust state
  // during render" idiom. Safe here even though nav.setCompletionArmed
  // belongs to a different custom hook's useState: useRideNavigation(route,
  // ...) executes synchronously inside this component's own render body, so
  // the setState closure it returns is bound to this component's own fiber
  // — indistinguishable, at the React-internals level, from a useState
  // called directly here. (This is not "safe because it's lint-clean" —
  // ESLint's set-state-in-render rule only traces setters back to a
  // useState/useReducer call in the same function body, so it can neither
  // confirm nor deny a setter reached through a custom hook's return
  // object; its silence here isn't evidence either way.)
  if (completion.isArmed && !nav.completionArmed) {
    nav.setCompletionArmed(true);
  }

  const performFinalizeRide = async (source: "end" | "finish") => {
    // Cross-guard with Pause, so End/Finish is blocked while a Pause is
    // genuinely in flight (backlog item 55) — the primary, bidirectional
    // enforcement; see isPauseActionPendingRef's own declaration comment.
    if (isFinalizeActionPendingRef.current || isPauseActionPendingRef.current) return;
    isFinalizeActionPendingRef.current = true;
    setActiveFinalizeSource(source);
    setFinalizeError(null);
    try {
      await nav.finish();
      camera.resetCamera();
      completion.reset();
      // handleStart never resets this (correct for Resume riding); a
      // fresh ride following a finalisation must not inherit it.
      setReachedManoeuvreIndex(0);
      setIsEndRideConfirmOpen(false);
      // Finalisation has now fully succeeded — storage cleared and this
      // screen's own runtime cleanup already applied above. Notify the
      // caller. Its own nested try/catch, deliberately separate from the
      // outer one: a throw here would only ever indicate a bug in the
      // caller's own handler, never a genuine finalisation failure, so it
      // must never be surfaced as one (which would misleadingly invite a
      // pointless retry after the ride has already ended).
      try {
        onRideFinalized?.();
      } catch (callbackError) {
        logError("riding-ride-finalized-callback", callbackError);
      }
    } catch (error) {
      logError(source === "end" ? "riding-end-ride" : "riding-finish-ride", error);
      setFinalizeError({
        source,
        message:
          source === "end"
            ? "The ride could not be ended on this device. Try again."
            : "Finish ride could not be completed on this device. Try again.",
      });
      setIsEndRideConfirmOpen(false);
      if (source === "end") {
        // End-ride's trigger genuinely unmounts while its confirmation is
        // open (item 50), so restoring focus is deferred to the pending-ref
        // effect above rather than called directly here: the trigger is
        // still disabled/absent in the DOM at this exact synchronous point
        // (activeFinalizeSource only resets to null in the finally block
        // below, and React doesn't commit that until this synchronous
        // catch/finally sequence finishes). Finish-ride's own trigger never
        // unmounts, so its focus restoration stays on the plain
        // finalizeError-identity effect above and needs no latch here.
        pendingEndRideFocusRef.current = true;
      }
    } finally {
      isFinalizeActionPendingRef.current = false;
      setActiveFinalizeSource(null);
    }
  };

  // Pause (backlog item 55) — reversible, no confirmation. Mirrors
  // performFinalizeRide's own try/catch/finally shape, but never touches
  // camera.resetCamera()/completion.reset()/reachedManoeuvreIndex — Pause
  // preserves progress, camera choice, climb-dismissal and
  // completion-armed state exactly as they were; only End/Finish reset
  // them.
  const performPauseRide = async () => {
    if (isPauseActionPendingRef.current || isFinalizeActionPendingRef.current) return;
    isPauseActionPendingRef.current = true;
    setIsPausePending(true);
    setPauseError(null);
    try {
      await nav.pause();
      // The pause has now fully succeeded — the resumable snapshot is
      // written and the watch is stopped. Notify the caller with its own
      // nested try/catch, mirroring performFinalizeRide's identical
      // rationale: a throw here indicates only a bug in the caller's own
      // handler, never a genuine pause failure.
      try {
        onRidePaused?.();
      } catch (callbackError) {
        logError("riding-ride-paused-callback", callbackError);
      }
    } catch (error) {
      logError("riding-pause-ride", error);
      setPauseError("The ride could not be paused on this device. Try again.");
    } finally {
      isPauseActionPendingRef.current = false;
      setIsPausePending(false);
    }
  };

  // Pause's own button never unmounts (no confirmation swaps it out), so
  // this follows Finish-ride's existing plain-effect pattern below, not
  // the pendingEndRideFocusRef unmount-dance End-ride needs.
  useEffect(() => {
    if (!pauseError) return;
    pauseButtonRef.current?.focus();
  }, [pauseError]);

  // Finish ride's own trigger never unmounts (RidingRouteCompletionPanel has
  // no confirmation dialog to swap in), so a plain finalizeError-identity
  // effect remains correct and sufficient for it, unaffected by this file's
  // own End-ride in-place-confirmation morph (backlog item 50) below.
  useEffect(() => {
    if (finalizeError?.source !== "finish") return;
    finishRideButtonRef.current?.focus();
  }, [finalizeError]);

  // A no-deps effect re-checks pendingEndRideFocusRef's readiness (mounted
  // AND enabled) on every render, rather than consuming the request
  // unconditionally on the first post-set commit.
  useEffect(() => {
    if (!pendingEndRideFocusRef.current) return;
    const trigger = endRideTriggerRef.current;
    if (!trigger || trigger.disabled) return;
    pendingEndRideFocusRef.current = false;
    trigger.focus();
  });

  const handleEndRideClick = () => {
    if (isEndRideConfirmOpen || isFinalizeActionPendingRef.current) return;
    setFinalizeError(null);
    setIsEndRideConfirmOpen(true);
  };

  const handleEndRideCancel = () => {
    // Escape can bypass a disabled Cancel button, so guard here too.
    if (isFinalizeActionPendingRef.current) return;
    pendingEndRideFocusRef.current = true;
    setIsEndRideConfirmOpen(false);
  };

  const performEditCopy = useCallback(async () => {
    if (isEditCopyActionPendingRef.current) return;
    isEditCopyActionPendingRef.current = true;
    setIsEditCopyInFlight(true);
    setEditCopyError(null);
    try {
      const preferences = await getPlanningPreferences();
      const resolved = resolveEditableWaypoints(route, {
        avoidFerries: preferences.avoidFerriesByDefault,
      });
      if (!resolved) {
        // Defensive only — canDeriveEditableWaypoints already disables
        // the triggering button for this case, so this should be
        // unreachable.
        setEditCopyError(
          "This route doesn't have enough distinct geometry to create an editable copy.",
        );
        setIsEditCopyConfirmOpen(false);
        return;
      }
      const waypoints: Waypoint[] = resolved.waypoints.map((coordinate) => ({
        id: createWaypointId(),
        coordinate,
      }));
      await saveDraft({
        waypoints,
        routeName: route.name,
        avoidFerries: resolved.avoidFerries,
        profile: resolved.profile,
        editCopySourceRouteId: route.id,
        editCopyWaypointsOrigin: resolved.origin,
        editCopyOperation: "forward",
      });
      setIsEditCopyConfirmOpen(false);
      onNavigateToPlanning?.();
    } catch (error) {
      logError("riding-edit-copy-in-planning", error);
      setEditCopyError(EDIT_COPY_GENERIC_ERROR_MESSAGE);
      setIsEditCopyConfirmOpen(false);
      editCopyButtonRef.current?.focus();
    } finally {
      isEditCopyActionPendingRef.current = false;
      setIsEditCopyInFlight(false);
    }
  }, [route, onNavigateToPlanning]);

  const handleEditCopyClick = useCallback(() => {
    if (isEditCopyConfirmOpen || isEditCopyActionPendingRef.current) return;
    setEditCopyError(null);
    getDraft()
      .then((draft) => {
        const hasMeaningfulDraft = !!draft && draft.waypoints.length > 0;
        if (hasMeaningfulDraft) {
          setIsEditCopyConfirmOpen(true);
          return;
        }
        void performEditCopy();
      })
      .catch((error: unknown) => {
        logError("riding-edit-copy-check-draft", error);
        setEditCopyError("Your existing draft could not be checked. Try again.");
      });
  }, [isEditCopyConfirmOpen, performEditCopy]);

  const handleEditCopyCancel = useCallback(() => {
    setIsEditCopyConfirmOpen(false);
    editCopyButtonRef.current?.focus();
  }, []);

  // useCallback-wrapped (backlog item 72) so it can be a dependency of the
  // resume-intent consumption effect below without that effect refiring on
  // every unrelated render — this is the ONE authoritative start
  // transition, reused verbatim by the ordinary button, the mid-ride "Try
  // again" retry, and the cold-recovery resume-intent auto-consume.
  const handleStart = useCallback(() => {
    // Only clear a pre-ride selection when genuinely transitioning out of
    // the pre-ride (idle) state — this same handler also backs the
    // mid-ride "Try again" retry button (geolocationStatus === "error"),
    // and CLAUDE.md requires that retry to preserve ride progress, which
    // includes not silently discarding a rider's in-progress feature
    // selection. Clearing here (idle only) is what stops a climb merely
    // previewed pre-ride from continuing to override the rider's actual
    // active climb for the rest of the ride, since
    // microDetailFeature = selectedFeature ?? activeFeature would
    // otherwise keep preferring the stale pre-ride pick.
    if (nav.geolocationStatus === "idle") {
      setExplicitFeatureSelection({ routeId: route.id, featureId: null });
      setSelectedGradientSegment(null);
      // Default to the Map view on a genuinely fresh Start or an explicit
      // Resume-riding tap (backlog item 56) — same idle-only branch, so
      // the mid-ride "Try again" retry path (the else case this handler
      // also backs) leaves whichever view the rider already had open
      // untouched.
      setActiveView("map");
    }
    navStart();
    cameraRequestFollow();
  }, [nav.geolocationStatus, navStart, cameraRequestFollow, route.id]);

  // Consumes App.tsx's one-use cold-recovery resume intent (backlog item
  // 72): waits for restoration to genuinely finish (both this route's own
  // progress/preference restoration, via nav.restorationStatus, and — when
  // there is a persisted camera state to restore at all — camera's own
  // "restore" dispatch, via camera.hasAppliedRestoredCamera) before calling
  // the SAME handleStart() the ordinary button uses. Gating on
  // hasAppliedRestoredCamera specifically (rather than merely
  // restorationStatus) is what guarantees the restore action is already
  // enqueued/applied before requestFollow's "follow-requested" dispatch —
  // React processes multiple dispatches made in one synchronous callback in
  // call order, so this ordering is deterministic, not merely likely.
  //
  // consumedResumeIntentTokenRef guards against double-consuming a token —
  // mirroring this codebase's existing watchGenerationRef/
  // hydrationGenerationRef idioms, it mutates synchronously and
  // immediately, so React Strict Mode's double-invoked effects (or any
  // unrelated rerender) see the already-updated guard on their second pass
  // even without an intervening commit. handleStart() is called from
  // inside a single if-block whose test (shouldConsume) is a boolean
  // combining that ref comparison with restoredForThisRoute — the ref is
  // always updated to the latest token regardless of which branch runs, so
  // a stale/missing/wrong-route row (restoredForThisRoute false) still
  // marks the token consumed and falls through to the ordinary manual idle
  // panel exactly once, never auto-starting a fresh ride and never
  // retry-looping.
  const consumedResumeIntentTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (resumeIntentToken === undefined) return;
    if (nav.restorationStatus !== "ready") return;
    const cameraRestorationReady =
      nav.restoredCameraState === null || camera.hasAppliedRestoredCamera;
    if (!cameraRestorationReady) return;
    const shouldConsume =
      consumedResumeIntentTokenRef.current !== resumeIntentToken &&
      nav.restoredForThisRoute;
    if (shouldConsume) {
      consumedResumeIntentTokenRef.current = resumeIntentToken;
      handleStart();
    } else {
      consumedResumeIntentTokenRef.current = resumeIntentToken;
    }
  }, [
    resumeIntentToken,
    nav.restorationStatus,
    nav.restoredForThisRoute,
    nav.restoredCameraState,
    camera.hasAppliedRestoredCamera,
    handleStart,
  ]);

  // True only while a resume intent is present and restoration hasn't yet
  // settled into a definite outcome — gates the idle panel's pending/error
  // presentation below, so the ordinary Start/Resume buttons never flash on
  // screen during the render(s) a cold-recovery resume spends waiting on
  // restoration. Deliberately NOT derived from the guard ref above (ref
  // values must not be read during render) — once restoration is ready and
  // camera-ready, either handleStart() is about to fire (geolocationStatus
  // will leave "idle" on the very next render, at which point this whole
  // idle-panel block stops rendering regardless of this value) or the row
  // never matched this route, in which case this correctly settles to
  // false and the ordinary idle panel takes over.
  const restorationSettled =
    nav.restorationStatus === "ready" &&
    (nav.restoredCameraState === null || camera.hasAppliedRestoredCamera);
  const isConsumingResumeIntent =
    resumeIntentToken !== undefined && !(restorationSettled && !nav.restoredForThisRoute);

  // Renders the End-ride action in place: either the trigger button (plus
  // any error) or the confirmation itself, never both — called from both of
  // this screen's two mutually exclusive trigger locations below (the
  // idle/resumable panel and the active-tracking row), so the ConfirmDialog
  // JSX exists at exactly one call site and can never mount twice, since
  // only one of those two branches ever renders per commit (backlog item
  // 50's in-place confirmation morph, mirroring PlanningScreen.tsx's own
  // Clear-draft treatment from item 49).
  function renderEndRideAction(): ReactNode {
    if (isEndRideConfirmOpen) {
      return (
        <ConfirmDialog
          open={isEndRideConfirmOpen}
          title="End this ride?"
          message="Navigation progress for this ride will be cleared. The saved route will remain in your library."
          confirmLabel={activeFinalizeSource === "end" ? "Ending ride…" : "End ride"}
          cancelLabel="Cancel"
          confirmDisabled={activeFinalizeSource === "end"}
          cancelDisabled={activeFinalizeSource === "end"}
          onConfirm={() => {
            void performFinalizeRide("end");
          }}
          onCancel={handleEndRideCancel}
        />
      );
    }
    return (
      <>
        <button
          type="button"
          className="btn-danger"
          ref={endRideTriggerRef}
          onClick={handleEndRideClick}
          disabled={activeFinalizeSource !== null || isPausePending}
        >
          End ride
        </button>
        {finalizeError?.source === "end" ? (
          <p className="field-error" role="alert">
            {finalizeError.message}
          </p>
        ) : null}
      </>
    );
  }

  // True while the shown manoeuvre/distance is based on the rider's last
  // reliable position rather than a fresh, on-route fix — shared by both
  // the full Map-view panel and the compact Profile-view cue below so the
  // two never disagree on this qualifier.
  const isManoeuvreFrozen = nav.isStale || nav.offRouteLevel === "off-route";
  // Reuses the exact same, already-computed nextManoeuvre selection and
  // the existing exported classifyManoeuvreUrgency (backlog item 56) — no
  // new navigation logic. showCompactManoeuvreCue is recomputed fresh
  // every render, so the compact cue disappears automatically once the
  // manoeuvre is passed or its urgency returns to "normal", with no
  // explicit "hide" action needed.
  const manoeuvreUrgency = nextManoeuvre
    ? classifyManoeuvreUrgency(nextManoeuvre.remainingDistanceMetres)
    : null;
  // Gated on activeView === "profile" (not just "not idle") so the compact
  // cue is only ever actually mounted while Profile is genuinely selected —
  // unlike the always-mounted Map/Profile panes themselves (kept mounted
  // for GradientColoursDisclosure's uncontrolled <details> state and
  // <MapView>'s continuity), the compact cue is stateless and has no such
  // requirement, so conditionally rendering it avoids ever having its
  // instruction text sit duplicated in the DOM alongside the full Map-view
  // panel's identical text at the same time (aria-hidden/visibility hide it
  // visually and from the accessibility tree either way, but a plain
  // text-content query does not respect either).
  const showCompactManoeuvreCue =
    nav.geolocationStatus !== "idle" &&
    activeView === "profile" &&
    nextManoeuvre !== null &&
    manoeuvreUrgency !== null &&
    manoeuvreUrgency !== "normal";

  // The Route-profile card's inner content (window selector, chart/climb
  // branch, disclosures, detail panels) — hoisted, unchanged, out of the
  // JSX below (backlog item 56) so it can be referenced from both the
  // idle .ride-profile-panel and the active .ride-profile-pane--immersive
  // without writing it twice. Purely a relocation: no calculation here
  // changed from before this slice.
  const elevationSectionBody = (
    <>
      {nav.matchedDistanceFromStartMetres !== null ? (
        <div
          role="group"
          aria-label="Elevation profile view"
          className="elevation-window-group"
        >
          {ELEVATION_VIEW_MODE_OPTIONS.map((mode) => {
            const isSelected =
              effectiveElevationView.kind !== "climb" &&
              effectiveElevationView.kind !== "climb-preview" &&
              isSameElevationViewMode(effectiveElevationView, mode);
            return (
              <button
                key={elevationViewModeKey(mode)}
                type="button"
                className={`elevation-window-button${isSelected ? " is-selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => {
                  nav.setElevationViewMode(mode);
                  // Manually picking a standard view while inside a climb
                  // dismisses Climb view for the remainder of that climb —
                  // see climbElevationView.ts's selectEffectiveElevationView.
                  if (activeClimb !== null) {
                    nav.setDismissedClimbFeatureId(activeClimb.id);
                  }
                  // Leaving an upcoming preview is a pure UI-selection
                  // change — there is no active climb to dismiss, so this
                  // is an unconditional, separate write from the branch
                  // above (backlog item 71).
                  setClimbPreviewSelection(null);
                }}
              >
                {elevationViewModeLabel(mode)}
              </button>
            );
          })}
          {activeClimb !== null || upcomingClimb !== null ? (
            <button
              type="button"
              className={`elevation-window-button${
                effectiveElevationView.kind === "climb" ||
                effectiveElevationView.kind === "climb-preview"
                  ? " is-selected"
                  : ""
              }`}
              aria-pressed={
                effectiveElevationView.kind === "climb" ||
                effectiveElevationView.kind === "climb-preview"
              }
              onClick={() => {
                if (activeClimb !== null) {
                  // Un-dismisses the active climb — safe unconditionally,
                  // since a dismissal only ever matters when it matches
                  // the currently active climb's own id.
                  nav.setDismissedClimbFeatureId(null);
                } else if (upcomingClimb !== null) {
                  // Selects the upcoming-climb preview (backlog item 71)
                  // — never touches dismissedClimbFeatureId, since there
                  // is no active climb.
                  setClimbPreviewSelection({
                    routeId: route.id,
                    climbId: upcomingClimb.id,
                  });
                }
              }}
            >
              Climb
            </button>
          ) : null}
        </div>
      ) : null}
      {/* Before any matched progress (live or restored), show the whole
       * route with no marker. Once there's matched progress, Full mode
       * shows the whole route with a progress marker and Upcoming mode
       * shows a rebased rolling window. Macro route-feature colouring
       * (routeFeatures) always covers the whole route regardless of view,
       * EXCEPT the genuine pre-ride full-route overview (backlog item 77,
       * isPreRideFullRouteOverview), which passes only climbs — descents
       * fall back to the ordinary currentColor line there; only the
       * detailed micro overlay (gradientSegments, already narrowed to the
       * selected-or-active feature) is further clipped to the current
       * window, so the legend never lists a detail class that isn't
       * currently on screen. */}
      {(() => {
        let displayedMicroSegments = microDetailSegments;
        // Defaults to microDetailFeature (the same feature
        // displayedMicroSegments already reflects in every other branch);
        // only the new Climb branch below ever reassigns this to a
        // different feature (activeClimb), so GradientColoursDisclosure's
        // climb-band gate stays correct even when a rider has an unrelated
        // explicit selection elsewhere while also actively climbing.
        let displayedMicroDetailFeature: RouteFeature | null = microDetailFeature;
        let chart: ReactNode;
        let climbProgressPanel: ReactNode = null;

        if (nav.matchedDistanceFromStartMetres === null) {
          chart = (
            <ElevationChart
              points={displayPoints}
              routeFeatures={isPreRideFullRouteOverview ? climbs : routeFeatures}
              gradientSegments={microDetailSegments}
              selectedRangeMetres={chartSelectedRangeMetres}
              onTapDistance={handleChartTapDistance}
            />
          );
        } else if (
          activeClimb !== null &&
          effectiveElevationView.kind === "climb" &&
          climbProgressMetrics !== null
        ) {
          const climbViewModel = buildClimbChartViewModel(
            {
              kind: "active-current-climb",
              marker: {
                distanceFromStartMetres:
                  climbProgressMetrics.clampedPresentationDistanceMetres,
                elevationMetres: climbProgressMetrics.currentElevationMetres,
                stale: nav.isStale,
              },
            },
            activeClimb,
            displayPoints,
            activeClimbDetailSegments,
          );
          displayedMicroSegments = activeClimbDetailSegments;
          displayedMicroDetailFeature = activeClimb;
          chart = (
            <ElevationChart
              points={climbViewModel.points}
              domain={climbViewModel.domain}
              gradientSegments={climbViewModel.gradientSegments}
              areaFill={climbViewModel.areaFill}
              selectedRangeMetres={chartSelectedRangeMetres}
              onTapDistance={handleChartTapDistance}
              marker={climbViewModel.marker}
            />
          );
          climbProgressPanel = (
            <RidingClimbProgressPanel
              climb={activeClimb}
              climbNumber={climbs.findIndex((climb) => climb.id === activeClimb.id) + 1}
              metrics={climbProgressMetrics}
            />
          );
        } else if (
          activeClimb === null &&
          effectiveElevationView.kind === "climb-preview" &&
          upcomingClimb !== null &&
          nav.presentationDistanceFromStartMetres !== null
        ) {
          // Read-only preview of the next recognised climb before it
          // begins (backlog item 71). Reuses the same "pre-ride-selected-
          // feature" chart mode the idle dropdown preview already uses
          // (rebased-to-0, no marker) — never computeClimbProgressMetrics,
          // which would fabricate progress at the climb's own start.
          const distanceUntilStartMetres =
            upcomingClimb.startDistanceMetres - nav.presentationDistanceFromStartMetres;
          const previewViewModel = buildClimbChartViewModel(
            { kind: "pre-ride-selected-feature" },
            upcomingClimb,
            displayPoints,
            upcomingClimbDetailSegments,
          );
          displayedMicroSegments = upcomingClimbDetailSegments;
          displayedMicroDetailFeature = upcomingClimb;
          const upcomingClimbNumber =
            climbs.findIndex((climb) => climb.id === upcomingClimb.id) + 1;
          chart = (
            <ElevationChart
              points={previewViewModel.points}
              domain={previewViewModel.domain}
              gradientSegments={previewViewModel.gradientSegments}
              areaFill={previewViewModel.areaFill}
              marker={previewViewModel.marker}
              ariaLabel={`Elevation profile for Climb ${String(upcomingClimbNumber)}`}
            />
          );
          climbProgressPanel = (
            <RidingClimbPreviewPanel
              climb={upcomingClimb}
              climbNumber={upcomingClimbNumber}
              distanceUntilStartMetres={distanceUntilStartMetres}
            />
          );
        } else if (nav.elevationProfileDisplay.kind === "full") {
          chart = (
            <ElevationChart
              points={displayPoints}
              routeFeatures={isPreRideFullRouteOverview ? climbs : routeFeatures}
              gradientSegments={microDetailSegments}
              selectedRangeMetres={chartSelectedRangeMetres}
              onTapDistance={handleChartTapDistance}
              marker={
                nav.elevationProfileDisplay.marker
                  ? {
                      distanceFromStartMetres:
                        nav.elevationProfileDisplay.marker.markerDistanceFromStartMetres,
                      elevationMetres:
                        nav.elevationProfileDisplay.marker.point.elevationMetres,
                      stale: nav.isStale,
                    }
                  : null
              }
            />
          );
        } else {
          const window = nav.elevationProfileDisplay.window;
          const windowMicroSegments = clipClassifiedSegments(
            microDetailSegments,
            window.startDistanceMetres,
            window.endDistanceMetres,
          );
          displayedMicroSegments = windowMicroSegments;
          // elevationProfileDisplay is derived 1:1 from elevationViewMode
          // in useRideNavigation.ts, so elevationViewMode.kind is
          // provably "upcoming" here too — TS can't see that
          // correlation across the two separately-returned hook
          // values, so this narrows defensively rather than asserting.
          const windowMetres =
            nav.elevationViewMode.kind === "upcoming"
              ? nav.elevationViewMode.windowMetres
              : null;
          const distanceGuides =
            windowMetres !== null
              ? selectElevationDistanceGuides(window, windowMetres)
              : [];
          chart = (
            <ElevationChart
              points={window.points}
              domain={{
                startDistanceMetres: window.startDistanceMetres,
                endDistanceMetres: window.endDistanceMetres,
              }}
              routeFeatures={routeFeatures}
              gradientSegments={windowMicroSegments}
              selectedRangeMetres={chartSelectedRangeMetres}
              onTapDistance={handleChartTapDistance}
              distanceGuides={distanceGuides}
            />
          );
        }

        return (
          <>
            {climbProgressPanel}
            {chart}
            {isPreRideFullRouteOverview ? (
              <ClimbCategoriesDisclosure
                presentCategories={new Set(climbs.map((climb) => climb.category))}
              />
            ) : (
              <GradientColoursDisclosure
                presentClimbBands={
                  displayedMicroDetailFeature?.kind === "climb"
                    ? new Set(
                        displayedMicroSegments.map(
                          (segment) => segment.visualKey as ClimbGradientBand,
                        ),
                      )
                    : new Set()
                }
                presentVisualKeys={
                  new Set(
                    routeFeatures.map((feature) =>
                      feature.kind === "climb" ? feature.category : feature.band,
                    ),
                  )
                }
              />
            )}
            {nav.geolocationStatus === "idle" ? (
              <RidingClimbSelector
                climbs={climbs}
                selectedClimbId={
                  selectedFeature?.kind === "climb" ? selectedFeature.id : null
                }
                onSelectClimb={(id) => {
                  if (id) {
                    selectRouteFeature(id);
                  } else {
                    handleClearRouteFeatureSelection();
                  }
                }}
              />
            ) : null}
            <RouteFeatureDetailsPanel
              feature={
                effectiveElevationView.kind === "climb-preview" && upcomingClimb !== null
                  ? upcomingClimb
                  : microDetailFeature
              }
              climbNumber={preRideClimbNumber}
              detailChart={preRideClimbChart ?? preRideDescentChart}
              presentClimbLocalBands={
                nav.geolocationStatus === "idle" && microDetailFeature?.kind === "climb"
                  ? new Set(
                      microDetailSegments.map(
                        (segment) => segment.visualKey as ClimbGradientBand,
                      ),
                    )
                  : undefined
              }
              presentDescentLocalKeys={
                nav.geolocationStatus === "idle" && microDetailFeature?.kind === "descent"
                  ? new Set(
                      microDetailSegments.map(
                        (segment) => segment.visualKey as DescentLocalKey,
                      ),
                    )
                  : undefined
              }
              onClear={
                effectiveElevationView.kind === "climb-preview"
                  ? undefined
                  : selectedFeature
                    ? handleClearRouteFeatureSelection
                    : undefined
              }
            />
            <GradientSegmentDetailsPanel
              segment={selectedGradientSegment}
              startElevationMetres={selectedSegmentStartElevationMetres}
              endElevationMetres={selectedSegmentEndElevationMetres}
              onClear={handleClearGradientSegmentSelection}
            />
          </>
        );
      })()}
    </>
  );

  return (
    <section
      className={`screen${nav.geolocationStatus !== "idle" ? " riding-fixed-shell" : ""}`}
      aria-label="Riding"
    >
      {nav.geolocationStatus === "idle" ? (
        <div className="ride-route-header">
          <h1 className="screen-title">{route.name}</h1>
          <p className="route-card-meta">
            {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
          </p>
        </div>
      ) : (
        // The immersive Pause/title/End header (backlog item 55), plus
        // its own error/confirmation rows immediately beneath it — a
        // deliberate relocation, superseding item 40's "directly after
        // the offline notice" ordering for this active case only, per
        // item 55's own "show the full-width inline confirmation
        // immediately below the compact header" requirement.
        <>
          <RidingImmersiveHeader
            title={route.name}
            pauseLabel={isPausePending ? "Pausing…" : "Pause"}
            onPause={() => {
              void performPauseRide();
            }}
            pauseDisabled={isPausePending || activeFinalizeSource !== null}
            pauseButtonRef={pauseButtonRef}
            endAction={!isEndRideConfirmOpen ? renderEndRideAction() : null}
          />
          {pauseError ? (
            <p className="field-error" role="alert">
              {pauseError}
            </p>
          ) : null}
          {isEndRideConfirmOpen ? (
            <div className="ride-end-ride-confirm-row">{renderEndRideAction()}</div>
          ) : null}
        </>
      )}

      {/* Only the genuine pre-ride/no-fix-yet state uses this standalone
       * paragraph (backlog item 75) — once showStatusCard is true (active
       * riding, or an idle ride paused with a retained fix), the card's
       * own compact Offline row is the single source of this message, so
       * both never render together. */}
      {!online && !showStatusCard ? (
        <p role="status" className="status-row">
          Offline — the route, your position, progress and elevation still work; map
          imagery may be unavailable.
        </p>
      ) : null}

      {nav.geolocationStatus === "idle" && isConsumingResumeIntent ? (
        nav.restorationStatus === "error" ? (
          <div role="alert" className="ride-alert-panel">
            <p>Your ride could not be restored on this device. Try again.</p>
            <button type="button" className="btn-primary" onClick={nav.retryRestoration}>
              Retry
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onReturnToRideLauncher?.();
              }}
            >
              Back to Ride options
            </button>
          </div>
        ) : (
          <p role="status" className="status-row">
            Resuming your ride…
          </p>
        )
      ) : null}

      {nav.geolocationStatus === "idle" && !isConsumingResumeIntent ? (
        <div className="panel stack ride-start-panel">
          <p>
            {nav.currentFix
              ? "Resume riding to continue tracking your progress."
              : "Location access is needed to track your progress on this ride."}
          </p>
          <button
            type="button"
            className="btn-primary ride-start-panel-button"
            onClick={handleStart}
          >
            {nav.currentFix ? "Resume ride" : "Start riding"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              onReturnToRideLauncher?.();
            }}
            disabled={activeFinalizeSource !== null}
          >
            Back to Ride options
          </button>
          <button
            type="button"
            className="btn-secondary"
            ref={editCopyButtonRef}
            onClick={handleEditCopyClick}
            disabled={!canDeriveEditableWaypoints(route) || isEditCopyInFlight}
          >
            {isEditCopyInFlight ? "Creating editable copy…" : "Edit copy"}
          </button>
          {!canDeriveEditableWaypoints(route) ? (
            <p className="field-hint">
              This route doesn't have enough distinct geometry to create an editable copy.
            </p>
          ) : null}
          {editCopyError ? (
            <p className="field-error" role="alert">
              {editCopyError}
            </p>
          ) : null}
          <ConfirmDialog
            open={isEditCopyConfirmOpen}
            title={EDIT_COPY_DIALOG_TITLE}
            message={EDIT_COPY_DIALOG_MESSAGE}
            confirmLabel={EDIT_COPY_CONFIRM_LABEL}
            cancelLabel="Cancel"
            onConfirm={() => {
              void performEditCopy();
            }}
            onCancel={handleEditCopyCancel}
          />
          {nav.currentFix ? (
            <div className="ride-end-ride-panel-row stack">{renderEndRideAction()}</div>
          ) : null}
        </div>
      ) : null}

      {/* The single compact status card (backlog item 75, superseding item
       * 68's still-separate wake-lock/status-strip siblings): route/GPS
       * status and the wake-lock control share one top row, followed by
       * remaining distance/ascent, GPS freshness, a compact geolocation-
       * error row with its own inline retry, and a compact offline
       * indicator — all inside one bordered card, never an empty one. */}
      {showStatusCard ? (
        <RidingStatusCard
          liveStatus={
            nav.currentFix
              ? {
                  offRouteLevel: nav.offRouteLevel,
                  distanceRemainingMetres: nav.distanceRemainingMetres,
                  remainingAscentMetres: nav.remainingAscentMetres,
                  accuracyMetres: nav.currentFix.accuracyMetres,
                  isStale: nav.isStale,
                  fixAgeMs,
                }
              : null
          }
          geolocationErrorMessage={
            nav.geolocationStatus === "error" && nav.geolocationError
              ? formatGeolocationError(nav.geolocationError)
              : null
          }
          onRetryGeolocation={handleStart}
          online={online}
          wakeLock={
            isWakeLockSupported() && nav.geolocationStatus !== "idle"
              ? {
                  desired: nav.wakeLockDesired,
                  onToggleDesired: nav.setWakeLockDesired,
                  wakeLockSource,
                  clock,
                }
              : undefined
          }
        />
      ) : null}

      {/* Map-exclusive (backlog item 56): the full panel has no idle
       * counterpart and holds no state of its own, so it's simply omitted
       * — not merely hidden — while Profile is selected, matching the
       * Profile mock-ups and freeing that view's own space for elevation
       * content. Profile gets its own compact, near/imminent-only cue
       * instead (see showCompactManoeuvreCue below). */}
      {nav.geolocationStatus !== "idle" && activeView === "map" ? (
        <RidingNextManoeuvrePanel
          sourceKind={route.source.kind}
          isTrusted={isTrustedForNavigation}
          selection={nextManoeuvre}
          isFrozen={isManoeuvreFrozen}
        />
      ) : null}

      {completion.isConfirmed ? (
        <RidingRouteCompletionPanel
          onFinish={() => {
            void performFinalizeRide("finish");
          }}
          onKeepRiding={completion.dismiss}
          isFinishing={activeFinalizeSource === "finish"}
          disabled={isPausePending}
          error={finalizeError?.source === "finish" ? finalizeError.message : null}
          finishButtonRef={finishRideButtonRef}
        />
      ) : null}

      {/* backlog item 56: the fixed Map/Profile shell. Both .ride-map-container
       * and the Profile pane below are unconditionally rendered — present with
       * the same shape in idle and active, only className/style/aria-hidden
       * differ — so <MapView>'s own JSX call site never moves or gets wrapped
       * differently and never remounts, and GradientColoursDisclosure's
       * uncontrolled <details> state survives every idle<->active and
       * Map<->Profile transition it is actually rendered across. The one
       * exception (backlog item 77): isPreRideFullRouteOverview swaps the
       * disclosure element type itself (ClimbCategoriesDisclosure <->
       * GradientColoursDisclosure), so React remounts and any open/closed
       * state is lost exactly at that boundary — intentional, since the two
       * disclosures show unrelated content, but worth noting here since it
       * is the one place this file's "never remounts" claim has a carve-out.
       * While idle this wrapper is a plain flex
       * column (visually identical to before this slice); while active it
       * becomes a position:relative flex:1 box with both children absolutely
       * stacked inset:0, toggled only via inline visibility/pointerEvents (not
       * display:none) so the map's own rendered box size never changes on
       * toggle — no resize risk to reason about. */}
      <div
        className={`ride-content-area${
          nav.geolocationStatus !== "idle" ? " ride-content-area--immersive" : ""
        }`}
      >
        {/* Shown before Start riding is tapped, too — the whole route is
         * already known and privacy-safe (no live location involved), so
         * there's no reason to wait for a GPS fix to preview it. MapView
         * always frames the entire route regardless of ride progress. */}
        <div
          className={`ride-map-container${
            nav.geolocationStatus !== "idle"
              ? " ride-map-container--immersive"
              : " ride-map-container--overview"
          }`}
          style={
            nav.geolocationStatus !== "idle"
              ? {
                  visibility: activeView === "map" ? "visible" : "hidden",
                  pointerEvents: activeView === "map" ? undefined : "none",
                }
              : undefined
          }
          aria-hidden={
            nav.geolocationStatus !== "idle" ? activeView !== "map" : undefined
          }
        >
          <MapView
            points={route.points}
            matchedDistanceFromStartMetres={nav.matchedDistanceFromStartMetres ?? 0}
            distanceBadgeProgressMetres={nav.presentationDistanceFromStartMetres}
            currentPosition={nav.currentFix?.coordinate}
            mapFactory={mapFactory}
            routeFeatureOverlay={routeFeatureOverlay}
            gradientOverlay={{ segments: microDetailSegments }}
            cameraTarget={camera.cameraTarget}
            zoomTarget={camera.zoomTarget}
            suppressInitialOverviewFit={camera.hasActionableCameraTarget}
            onUserCameraInteraction={camera.reportUserInteraction}
            onCameraSettled={(settled) => {
              camera.reportCameraSettled(
                settled.coordinate,
                settled.zoom,
                settled.bearingDegrees,
                settled.pitchDegrees,
                settled.hasAppliedCameraCommand,
              );
            }}
          />
          {nav.geolocationStatus === "watching" ? (
            <div className="ride-map-zoom-controls">
              <button
                type="button"
                onClick={handleZoomIn}
                aria-label="Zoom in"
                className="ride-map-control ride-map-control--zoom"
              >
                +
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                aria-label="Zoom out"
                className="ride-map-control ride-map-control--zoom"
              >
                −
              </button>
            </div>
          ) : null}
          {nav.geolocationStatus === "watching" ? (
            <div className="ride-map-camera-controls">
              <button
                type="button"
                onClick={camera.requestNorthUp}
                aria-label="North-up, top-down view"
                aria-pressed={camera.isNorthUpTopDown}
                className={`ride-map-control ride-map-control--north-up${
                  camera.isNorthUpTopDown ? " is-pressed" : ""
                }`}
              >
                N
              </button>
              <button
                type="button"
                onClick={camera.requestFollow}
                aria-label="Follow my location"
                aria-pressed={camera.mode === "following"}
                className={`ride-map-control ride-map-control--follow${
                  camera.mode === "following" ? " is-pressed" : ""
                }`}
              >
                {camera.mode === "following" && camera.awaitingFreshFix
                  ? "Waiting…"
                  : "⌖"}
              </button>
            </div>
          ) : null}
          {/* Moved inside the map container as a non-layout-affecting
           * overlay (backlog item 56) — it previously sat in the shared
           * status stack above the fixed shell's flex-fill map, and its
           * own transient appear/dismiss cycle measurably resized the map
           * (the shared stack's height directly determines how much space
           * .ride-map-container--immersive's flex:1 has left), which in
           * turn shifted the reported camera centre by a small but
           * real amount via the follow-offset recalculation on resize — a
           * genuine regression a real e2e test caught. A toast about the
           * map's own camera state belongs over the map, not in a
           * layout-affecting position, and is naturally Map-view-exclusive
           * this way (no reason to show it while Profile is selected). */}
          {camera.showPausedToast ? (
            <p role="status" className="ride-map-paused-toast">
              Map follow paused.
            </p>
          ) : null}
          {/* backlog item 57: a non-disruptive climb cue, Map-view-only.
           * Pure derivation, no new state: effectiveElevationView.kind
           * already encodes "there is an active climb, not manually
           * dismissed for this climb" (see climbElevationView.ts's
           * selectEffectiveElevationView), the same condition that already
           * drives the Profile pane's own Climb chart branch above. The
           * geolocationStatus !== "idle" guard matters here, not just as a
           * defensive mirror of RidingNextManoeuvrePanel's own gate — this
           * map container is unconditionally mounted (including for the
           * idle pre-ride preview), so a resumable session with stale
           * climb state must not show the cue before Resume riding is
           * pressed. Positioned top-centre (not bottom, alongside the
           * existing bottom-centre paused-follow toast and bottom-left
           * attribution) so it never needs pixel-offset coordination with
           * a transient sibling; the 64px side insets mirror
           * .planning-map-status-overlay's own arithmetic for clearing a
           * 48px .ride-map-control column plus its own 8px inset (see
           * .ride-climb-cue's own CSS comment). */}
          {nav.geolocationStatus !== "idle" &&
          activeView === "map" &&
          effectiveElevationView.kind === "climb" &&
          activeClimb !== null &&
          climbProgressMetrics !== null ? (
            <RidingClimbCue
              metrics={climbProgressMetrics}
              onViewClimb={() => {
                setActiveView("profile");
              }}
            />
          ) : null}
        </div>

        <div
          className={
            nav.geolocationStatus === "idle"
              ? "panel stack ride-profile-panel"
              : "ride-profile-pane--immersive"
          }
          style={
            nav.geolocationStatus !== "idle"
              ? {
                  visibility: activeView === "profile" ? "visible" : "hidden",
                  pointerEvents: activeView === "profile" ? undefined : "none",
                }
              : undefined
          }
          aria-hidden={
            nav.geolocationStatus !== "idle" ? activeView !== "profile" : undefined
          }
        >
          {nav.geolocationStatus === "idle" ? <h2>Route profile</h2> : null}
          <div className="ride-elevation-section">
            {/* A compact, near/imminent-only cue (backlog item 56) — see
             * RidingCompactManoeuvreCue's own doc comment. TypeScript's
             * aliased-condition narrowing already infers nextManoeuvre is
             * non-null here from showCompactManoeuvreCue's own definition
             * (one of its && terms), so no separate re-check is needed. */}
            {showCompactManoeuvreCue ? (
              <RidingCompactManoeuvreCue
                selection={nextManoeuvre}
                isFrozen={isManoeuvreFrozen}
              />
            ) : null}
            {elevationSectionBody}
          </div>
        </div>
      </div>

      {nav.geolocationStatus !== "idle" ? (
        <div role="group" aria-label="Riding view" className="ride-immersive-switcher">
          <button
            type="button"
            className={`ride-immersive-switcher-button${
              activeView === "map" ? " is-selected" : ""
            }`}
            aria-pressed={activeView === "map"}
            onClick={() => {
              setActiveView("map");
            }}
          >
            Map
          </button>
          <button
            type="button"
            className={`ride-immersive-switcher-button${
              activeView === "profile" ? " is-selected" : ""
            }`}
            aria-pressed={activeView === "profile"}
            onClick={() => {
              setActiveView("profile");
            }}
          >
            Profile
          </button>
        </div>
      ) : null}
    </section>
  );
}
