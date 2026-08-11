import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  canDeriveEditableWaypoints,
  resolveEditableWaypoints,
  reverseEditableWaypoints,
} from "../../domain/editableWaypoints.ts";
import { createWaypointId } from "../../domain/id.ts";
import { hasTrustedManoeuvres } from "../../domain/manoeuvreTrust.ts";
import { suggestReversedRouteName } from "../../domain/routeNaming.ts";
import type { Coordinate, PlannedRoute, Waypoint } from "../../domain/types.ts";
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
  listClimbsInRouteOrder,
  resolveElevationChartTap,
  type ClimbGradientBand,
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
import { selectNextManoeuvre } from "../../navigation/nextManoeuvre.ts";
import type { ElevationViewMode } from "../../navigation/types.ts";
import {
  ELEVATION_VIEW_MODE_OPTIONS,
  interpolateRoutePointAt,
} from "../../navigation/upcomingElevation.ts";
import { getDraft, saveDraft } from "../../storage/planningDraftRepository.ts";
import { getPlanningPreferences } from "../../storage/planningPreferencesRepository.ts";
import type { EditCopyOperation, StoredCameraState } from "../../storage/mapping.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import {
  ElevationChart,
  type ElevationChartSelectedRange,
} from "../shared/ElevationChart.tsx";
import { GradientColoursDisclosure } from "../shared/GradientColoursDisclosure.tsx";
import { GradientSegmentDetailsPanel } from "../shared/GradientSegmentDetailsPanel.tsx";
import { RouteFeatureDetailsPanel } from "../shared/RouteFeatureDetailsPanel.tsx";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";
import { RidingClimbProgressPanel } from "./RidingClimbProgressPanel.tsx";
import { RidingClimbSelector } from "./RidingClimbSelector.tsx";
import { RidingNextManoeuvrePanel } from "./RidingNextManoeuvrePanel.tsx";
import { RidingRouteCompletionPanel } from "./RidingRouteCompletionPanel.tsx";
import { RidingStatusStrip } from "./RidingStatusStrip.tsx";
import { RidingWakeLockControl } from "./RidingWakeLockControl.tsx";
import { useRideCamera } from "./useRideCamera.ts";
import { useRideNavigation } from "./useRideNavigation.ts";
import { useRouteCompletionCandidate } from "./useRouteCompletionCandidate.ts";

export interface RidingScreenProps {
  route: PlannedRoute;
  geolocationSource?: GeolocationSource;
  mapFactory?: MapFactory;
  clock?: Clock;
  wakeLockSource?: WakeLockSource;
  onRidingActiveChange?: (active: boolean) => void;
  /** Called once an "Edit copy in Planning" or "Reverse route" draft has
   * been seeded and persisted successfully — the caller (App.tsx) is
   * responsible only for switching screens, mirroring
   * onNavigateToSettings's exact shape; all the actual draft-seeding work
   * happens in this component. */
  onNavigateToPlanning?: () => void;
}

const DEFAULT_CAMERA_STATE: StoredCameraState = {
  mode: "overview",
  coordinate: null,
  zoom: null,
  bearingDegrees: 0,
  pitchDegrees: 0,
};

/**
 * "Edit copy in Planning" and "Reverse route" share every part of their
 * flow (source-route eligibility, waypoint resolution, meaningful-draft
 * detection, confirmation, persistence, storage-failure handling,
 * navigation, rapid-action guards) except for a small, fixed set of
 * per-operation inputs, captured here rather than duplicated as two
 * near-identical async implementations — see performCopyOperation below.
 */
type CopyOperationKind = "edit-copy" | "reverse";

interface CopyOperationConfig {
  kind: CopyOperationKind;
  triggerLabel: string;
  pendingLabel: string;
  dialogTitle: string;
  dialogMessage: string;
  confirmLabel: string;
  genericErrorMessage: string;
  logTag: string;
  checkDraftLogTag: string;
  transformWaypoints: (waypoints: readonly Coordinate[]) => readonly Coordinate[];
  suggestedName: (sourceName: string) => string;
  operationMarker: EditCopyOperation;
}

const EDIT_COPY_CONFIG: CopyOperationConfig = {
  kind: "edit-copy",
  triggerLabel: "Edit copy in Planning",
  pendingLabel: "Creating editable copy…",
  dialogTitle: "Replace your current plan?",
  dialogMessage:
    "Editing this route will replace your unsaved plan in Planning. This route itself will remain unchanged.",
  confirmLabel: "Replace and edit",
  genericErrorMessage:
    "The editable copy could not be created on this device. Try again.",
  logTag: "riding-edit-copy-in-planning",
  checkDraftLogTag: "riding-edit-copy-check-draft",
  transformWaypoints: (waypoints) => waypoints,
  suggestedName: (sourceName) => sourceName,
  operationMarker: "forward",
};

const REVERSE_ROUTE_CONFIG: CopyOperationConfig = {
  kind: "reverse",
  triggerLabel: "Reverse route",
  pendingLabel: "Reversing route…",
  dialogTitle: "Replace your current plan to reverse this route?",
  dialogMessage:
    "Reversing this route will replace your unsaved plan in Planning. This route itself will remain unchanged.",
  confirmLabel: "Replace and reverse",
  genericErrorMessage:
    "The reversed copy could not be created on this device. Try again.",
  logTag: "riding-reverse-route",
  checkDraftLogTag: "riding-reverse-check-draft",
  transformWaypoints: reverseEditableWaypoints,
  suggestedName: suggestReversedRouteName,
  operationMarker: "reverse",
};

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
  geolocationSource,
  mapFactory,
  clock = systemClock,
  wakeLockSource,
  onRidingActiveChange,
  onNavigateToPlanning,
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

  // Reports whether this ride is genuinely GPS-active back to App, purely
  // so the sticky/static main-navigation contract (navPositionMode.ts)
  // can react to it. nav.geolocationStatus is the app's own authoritative
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
            { kind: "pre-ride-selected-climb" },
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
  // The climb the rider is actually riding through, independent of any
  // unrelated explicit tap/dropdown selection elsewhere (microDetailFeature
  // above) — Climb elevation view must always reflect live progress, never
  // a merely-inspected feature. A descent or an ordinary (unrecognised)
  // uphill never activates it, since activeFeature is null or a descent
  // there.
  const activeClimb = activeFeature?.kind === "climb" ? activeFeature : null;
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
  // "already auto-shown" tracking state beyond dismissedClimbFeatureId.
  const effectiveElevationView = selectEffectiveElevationView(
    nav.elevationViewMode,
    activeClimb,
    nav.dismissedClimbFeatureId,
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

  // "Edit copy in Planning" and "Reverse route" — two pre-ride actions
  // that both seed a new Planning draft from this route's recovered or
  // derived waypoints (see domain/editableWaypoints.ts), differing only
  // in whether the waypoints are kept forward or reversed and in the
  // suggested draft name — see performCopyOperation and the two
  // CopyOperationConfig constants above. Both actions read/write the same
  // singleton Planning draft, so they deliberately share one guard: the
  // pendingConfirmKind/isActionPendingRef pair below serialises each
  // action against itself (rapid double-click) and against the other
  // action (they must never run concurrently) with no extra coupling
  // code. Entirely self-contained: this screen owns the meaningful-draft
  // check, the confirmation, waypoint resolution and persistence;
  // App.tsx only ever switches screens once told to via
  // onNavigateToPlanning.
  const editCopyButtonRef = useRef<HTMLButtonElement>(null);
  const reverseButtonRef = useRef<HTMLButtonElement>(null);
  const [pendingConfirmKind, setPendingConfirmKind] = useState<CopyOperationKind | null>(
    null,
  );
  const [activeOperationKind, setActiveOperationKind] =
    useState<CopyOperationKind | null>(null);
  const [copyOperationError, setCopyOperationError] = useState<{
    kind: CopyOperationKind;
    message: string;
  } | null>(null);
  // Synchronous guard against a rapid double Confirm click, mirroring
  // PlanningScreen.tsx's own isLocatingRef idiom — activeOperationKind
  // state alone isn't reliably readable synchronously across the same
  // tick.
  const isActionPendingRef = useRef(false);

  // End ride / Finish ride — the shared ride-finalisation lifecycle. Both
  // actions converge on one performFinalizeRide, mirroring
  // performCopyOperation's own catch-block shape (logError, a source-tagged
  // accessible error message, focus restored to whichever button triggered
  // the action). endRideTriggerRef is shared across the two mutually
  // exclusive render sites the End-ride button can appear at (the
  // Resume-riding idle panel, and the active-tracking slot below the map) —
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
  // mirroring isActionPendingRef above — the primary UX guard;
  // useRideNavigation's own finish() also guards re-entrancy defensively.
  const isFinalizeActionPendingRef = useRef(false);

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
    if (isFinalizeActionPendingRef.current) return;
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
      // Focus restoration is handled by an effect (below), not directly
      // here: the trigger button is still disabled in the DOM at this
      // exact point (activeFinalizeSource only resets to null in the
      // finally block below, and React doesn't commit that until this
      // synchronous catch/finally sequence finishes) — a disabled button
      // can't receive focus, so calling .focus() here would silently
      // no-op and lose focus to <body> once the dialog unmounts.
    } finally {
      isFinalizeActionPendingRef.current = false;
      setActiveFinalizeSource(null);
    }
  };

  // Restores focus to whichever trigger a failed finalisation belongs to,
  // once the DOM has actually committed the button being re-enabled — an
  // effect (not an imperative call inside performFinalizeRide's catch
  // block) is required here because the trigger is still disabled in the
  // DOM at the moment the catch block runs (activeFinalizeSource only
  // resets to null in the same synchronous finally block, and React
  // doesn't apply that to the DOM until this render commits); a disabled
  // button can't receive focus. Keyed on finalizeError's own object
  // identity, which is fresh only for a genuinely new error, so this never
  // re-fires on an unrelated re-render while the same error is still shown.
  useEffect(() => {
    if (!finalizeError) return;
    (finalizeError.source === "end"
      ? endRideTriggerRef
      : finishRideButtonRef
    ).current?.focus();
  }, [finalizeError]);

  const handleEndRideClick = () => {
    if (isEndRideConfirmOpen || isFinalizeActionPendingRef.current) return;
    setFinalizeError(null);
    setIsEndRideConfirmOpen(true);
  };

  const handleEndRideCancel = () => {
    // Escape can bypass a disabled Cancel button, so guard here too.
    if (isFinalizeActionPendingRef.current) return;
    setIsEndRideConfirmOpen(false);
    endRideTriggerRef.current?.focus();
  };

  const triggerRefForKind = useCallback((kind: CopyOperationKind) => {
    return kind === "reverse" ? reverseButtonRef : editCopyButtonRef;
  }, []);

  const performCopyOperation = useCallback(
    async (config: CopyOperationConfig) => {
      if (isActionPendingRef.current) return;
      isActionPendingRef.current = true;
      setActiveOperationKind(config.kind);
      setCopyOperationError(null);
      try {
        const preferences = await getPlanningPreferences();
        const resolved = resolveEditableWaypoints(route, {
          avoidFerries: preferences.avoidFerriesByDefault,
        });
        if (!resolved) {
          // Defensive only — canDeriveEditableWaypoints already disables
          // both triggering buttons for this case, so this should be
          // unreachable.
          setCopyOperationError({
            kind: config.kind,
            message:
              "This route doesn't have enough distinct geometry to create an editable copy.",
          });
          setPendingConfirmKind(null);
          return;
        }
        const orderedCoordinates = config.transformWaypoints(resolved.waypoints);
        const waypoints: Waypoint[] = orderedCoordinates.map((coordinate) => ({
          id: createWaypointId(),
          coordinate,
        }));
        await saveDraft({
          waypoints,
          routeName: config.suggestedName(route.name),
          avoidFerries: resolved.avoidFerries,
          profile: resolved.profile,
          editCopySourceRouteId: route.id,
          editCopyWaypointsOrigin: resolved.origin,
          editCopyOperation: config.operationMarker,
        });
        setPendingConfirmKind(null);
        onNavigateToPlanning?.();
      } catch (error) {
        logError(config.logTag, error);
        setCopyOperationError({ kind: config.kind, message: config.genericErrorMessage });
        setPendingConfirmKind(null);
        triggerRefForKind(config.kind).current?.focus();
      } finally {
        isActionPendingRef.current = false;
        setActiveOperationKind(null);
      }
    },
    [route, onNavigateToPlanning, triggerRefForKind],
  );

  const handleCopyOperationClick = useCallback(
    (config: CopyOperationConfig) => {
      if (pendingConfirmKind !== null || isActionPendingRef.current) return;
      setCopyOperationError(null);
      getDraft()
        .then((draft) => {
          const hasMeaningfulDraft = !!draft && draft.waypoints.length > 0;
          if (hasMeaningfulDraft) {
            setPendingConfirmKind(config.kind);
            return;
          }
          void performCopyOperation(config);
        })
        .catch((error: unknown) => {
          logError(config.checkDraftLogTag, error);
          setCopyOperationError({
            kind: config.kind,
            message: "Your existing plan could not be checked. Try again.",
          });
        });
    },
    [pendingConfirmKind, performCopyOperation],
  );

  const handleCopyOperationCancel = useCallback(() => {
    if (pendingConfirmKind !== null) {
      triggerRefForKind(pendingConfirmKind).current?.focus();
    }
    setPendingConfirmKind(null);
  }, [pendingConfirmKind, triggerRefForKind]);

  const pendingCopyOperationConfig =
    pendingConfirmKind === "reverse"
      ? REVERSE_ROUTE_CONFIG
      : pendingConfirmKind === "edit-copy"
        ? EDIT_COPY_CONFIG
        : null;

  const handleStart = () => {
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
    }
    nav.start();
    camera.requestFollow();
  };

  return (
    <section className="screen" aria-label="Riding">
      {isWakeLockSupported() && nav.geolocationStatus !== "idle" ? (
        <RidingWakeLockControl
          desired={nav.wakeLockDesired}
          onToggleDesired={nav.setWakeLockDesired}
          wakeLockSource={wakeLockSource}
          clock={clock}
        />
      ) : null}

      <div className="ride-route-header">
        <h1 className="screen-title">{route.name}</h1>
        <p className="route-card-meta">
          {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
        </p>
      </div>

      {!online ? (
        <p role="status" className="status-row">
          Offline — the route, your position, progress and elevation still work; map
          imagery may be unavailable.
        </p>
      ) : null}

      {nav.geolocationStatus === "idle" ? (
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
            {nav.currentFix ? "Resume riding" : "Start riding"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            ref={editCopyButtonRef}
            onClick={() => {
              handleCopyOperationClick(EDIT_COPY_CONFIG);
            }}
            disabled={!canDeriveEditableWaypoints(route) || activeOperationKind !== null}
          >
            {activeOperationKind === "edit-copy"
              ? EDIT_COPY_CONFIG.pendingLabel
              : EDIT_COPY_CONFIG.triggerLabel}
          </button>
          <button
            type="button"
            className="btn-secondary"
            ref={reverseButtonRef}
            onClick={() => {
              handleCopyOperationClick(REVERSE_ROUTE_CONFIG);
            }}
            disabled={!canDeriveEditableWaypoints(route) || activeOperationKind !== null}
          >
            {activeOperationKind === "reverse"
              ? REVERSE_ROUTE_CONFIG.pendingLabel
              : REVERSE_ROUTE_CONFIG.triggerLabel}
          </button>
          {!canDeriveEditableWaypoints(route) ? (
            <p className="field-hint">
              This route doesn't have enough distinct geometry to create an editable copy.
            </p>
          ) : null}
          {copyOperationError ? (
            <p className="field-error" role="alert">
              {copyOperationError.message}
            </p>
          ) : null}
          <ConfirmDialog
            open={pendingCopyOperationConfig !== null}
            title={pendingCopyOperationConfig?.dialogTitle ?? ""}
            message={pendingCopyOperationConfig?.dialogMessage ?? ""}
            confirmLabel={pendingCopyOperationConfig?.confirmLabel ?? "Confirm"}
            cancelLabel="Cancel"
            onConfirm={() => {
              if (pendingCopyOperationConfig) {
                void performCopyOperation(pendingCopyOperationConfig);
              }
            }}
            onCancel={handleCopyOperationCancel}
          />
          {nav.currentFix ? (
            <>
              <button
                type="button"
                className="btn-danger"
                ref={endRideTriggerRef}
                onClick={handleEndRideClick}
                disabled={activeFinalizeSource !== null}
              >
                End ride
              </button>
              {finalizeError?.source === "end" ? (
                <p className="field-error" role="alert">
                  {finalizeError.message}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

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

      {nav.geolocationStatus === "error" && nav.geolocationError ? (
        <div role="alert" className="ride-alert-panel">
          <p>{formatGeolocationError(nav.geolocationError)}</p>
          <button type="button" onClick={handleStart}>
            Try again
          </button>
        </div>
      ) : null}

      {nav.geolocationStatus === "watching" && !nav.currentFix ? (
        <p role="status" className="status-row">
          Waiting for a GPS fix…
        </p>
      ) : null}

      {nav.currentFix ? (
        <RidingStatusStrip
          offRouteLevel={nav.offRouteLevel}
          distanceRemainingMetres={nav.distanceRemainingMetres}
          accuracyMetres={nav.currentFix.accuracyMetres}
          isStale={nav.isStale}
          fixAgeMs={fixAgeMs}
        />
      ) : null}

      {nav.geolocationStatus !== "idle" ? (
        <RidingNextManoeuvrePanel
          sourceKind={route.source.kind}
          isTrusted={isTrustedForNavigation}
          selection={nextManoeuvre}
          isFrozen={nav.isStale || nav.offRouteLevel === "off-route"}
        />
      ) : null}

      {completion.isConfirmed ? (
        <RidingRouteCompletionPanel
          onFinish={() => {
            void performFinalizeRide("finish");
          }}
          onKeepRiding={completion.dismiss}
          isFinishing={activeFinalizeSource === "finish"}
          error={finalizeError?.source === "finish" ? finalizeError.message : null}
          finishButtonRef={finishRideButtonRef}
        />
      ) : null}

      {camera.showPausedToast ? <p role="status">Map follow paused.</p> : null}

      {/* Shown before Start riding is tapped, too — the whole route is
       * already known and privacy-safe (no live location involved), so
       * there's no reason to wait for a GPS fix to preview it. MapView
       * always frames the entire route regardless of ride progress. */}
      <div
        className={`ride-map-container${
          nav.geolocationStatus !== "idle"
            ? " ride-map-container--active"
            : " ride-map-container--overview"
        }`}
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
          suppressInitialOverviewFit={camera.hasActionableCameraTarget}
          onUserCameraInteraction={camera.reportUserInteraction}
          onCameraSettled={(settled) => {
            camera.reportCameraSettled(
              settled.coordinate,
              settled.zoom,
              settled.bearingDegrees,
              settled.pitchDegrees,
            );
          }}
        />
        {nav.geolocationStatus === "watching" ? (
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
        ) : null}
        {nav.geolocationStatus === "watching" ? (
          <button
            type="button"
            onClick={camera.requestFollow}
            aria-label="Follow my location"
            aria-pressed={camera.mode === "following"}
            className={`ride-map-control ride-map-control--follow${
              camera.mode === "following" ? " is-pressed" : ""
            }`}
          >
            {camera.mode === "following" && camera.awaitingFreshFix ? "Waiting…" : "⌖"}
          </button>
        ) : null}
      </div>

      {nav.geolocationStatus === "idle" ? (
        <RidingClimbSelector
          climbs={climbs}
          selectedClimbId={selectedFeature?.kind === "climb" ? selectedFeature.id : null}
          onSelectClimb={(id) => {
            if (id) {
              selectRouteFeature(id);
            } else {
              handleClearRouteFeatureSelection();
            }
          }}
        />
      ) : (
        <div className="ride-end-ride-row">
          <button
            type="button"
            className="btn-danger"
            ref={endRideTriggerRef}
            onClick={handleEndRideClick}
            disabled={activeFinalizeSource !== null}
          >
            End ride
          </button>
          {finalizeError?.source === "end" ? (
            <p className="field-error" role="alert">
              {finalizeError.message}
            </p>
          ) : null}
        </div>
      )}

      <div
        className={
          nav.geolocationStatus === "idle" ? "panel stack ride-profile-panel" : undefined
        }
      >
        {nav.geolocationStatus === "idle" ? <h2>Route profile</h2> : null}
        <div className="ride-elevation-section">
          {nav.matchedDistanceFromStartMetres !== null ? (
            <div
              role="group"
              aria-label="Elevation profile view"
              className="elevation-window-group"
            >
              {ELEVATION_VIEW_MODE_OPTIONS.map((mode) => {
                const isSelected =
                  effectiveElevationView.kind !== "climb" &&
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
                    }}
                  >
                    {elevationViewModeLabel(mode)}
                  </button>
                );
              })}
              {activeClimb !== null ? (
                <button
                  type="button"
                  className={`elevation-window-button${
                    effectiveElevationView.kind === "climb" ? " is-selected" : ""
                  }`}
                  aria-pressed={effectiveElevationView.kind === "climb"}
                  onClick={() => {
                    // Un-dismisses the active climb — safe unconditionally,
                    // since a dismissal only ever matters when it matches the
                    // currently active climb's own id.
                    nav.setDismissedClimbFeatureId(null);
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
           * (routeFeatures) always covers the whole route regardless of view;
           * only the detailed micro overlay (gradientSegments, already
           * narrowed to the selected-or-active feature) is further clipped to
           * the current window, so the legend never lists a detail class that
           * isn't currently on screen. */}
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
                  routeFeatures={routeFeatures}
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
                  climbNumber={
                    climbs.findIndex((climb) => climb.id === activeClimb.id) + 1
                  }
                  metrics={climbProgressMetrics}
                />
              );
            } else if (nav.elevationProfileDisplay.kind === "full") {
              chart = (
                <ElevationChart
                  points={displayPoints}
                  routeFeatures={routeFeatures}
                  gradientSegments={microDetailSegments}
                  selectedRangeMetres={chartSelectedRangeMetres}
                  onTapDistance={handleChartTapDistance}
                  marker={
                    nav.elevationProfileDisplay.marker
                      ? {
                          distanceFromStartMetres:
                            nav.elevationProfileDisplay.marker
                              .markerDistanceFromStartMetres,
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
                />
              );
            }

            return (
              <>
                {climbProgressPanel}
                {chart}
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
                <RouteFeatureDetailsPanel
                  feature={microDetailFeature}
                  climbNumber={preRideClimbNumber}
                  detailChart={preRideClimbChart}
                  onClear={selectedFeature ? handleClearRouteFeatureSelection : undefined}
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
        </div>
      </div>
    </section>
  );
}
