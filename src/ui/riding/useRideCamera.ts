import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Coordinate, RoutePoint } from "../../domain/types.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import { generateId } from "../../platform/idGenerator.ts";
import { routeTangentBearingDegrees } from "../../navigation/bearing.ts";
import type { OffRouteLevel } from "../../navigation/types.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";
import type { ZoomCameraTarget } from "../../map/MapView.tsx";
import {
  hasActionableFollowAnchor,
  INITIAL_RIDE_CAMERA_STATE,
  rideCameraReducer,
  type BearingContext,
  type RideCameraCommand,
  type RideCameraEvent,
  type RideCameraMode,
  type RideCameraState,
} from "./rideCamera.ts";

/** How long the "Map follow paused" message stays visible after a manual
 * interaction (or the north-up control) interrupts following — a brief,
 * non-blocking indication, not something the rider has to dismiss. */
const FOLLOW_PAUSED_TOAST_MS = 3_000;

/** Reported whenever the map's camera settles (see MapView's
 * onCameraSettled) — hook-level bookkeeping only, not part of the pure
 * rideCameraReducer state machine, so it's a separate event the wrapping
 * reducer below handles directly. */
interface CameraSettledEvent {
  type: "camera-settled";
  coordinate: Coordinate;
  zoom: number;
  bearingDegrees: number;
  pitchDegrees: number;
}

type HookEvent = RideCameraEvent | CameraSettledEvent;

interface FreeCameraPosition {
  coordinate: Coordinate;
  zoom: number;
  bearingDegrees: number;
  pitchDegrees: number;
}

interface HookState {
  camera: RideCameraState;
  cameraTarget: RideCameraCommand | null;
  /** Bumped on every transition that should show the paused toast — a
   * plain boolean can't distinguish "still the same pause" from "paused
   * again", so this is compared by value, not truthiness. */
  toastToken: number;
  /** The rider's manually-panned position (and orientation) while free,
   * so it can be persisted and restored later, and so the north-up
   * control's pressed-state can tell "free and still north-up" apart from
   * "free and rotated away". Cleared whenever mode leaves "free". */
  freeCameraPosition: FreeCameraPosition | null;
  /** Sticky/monotonic within a route-open session: true once a real
   * camera command has ever been produced (a live follow ease or a
   * restore jump), so a suspended-then-restored "following" ride that is
   * still awaiting its first fresh fix reports false — see
   * RidingScreen.tsx's suppressInitialOverviewFit, which must show the
   * route overview exactly while this is false, and never re-fit once
   * it's true. Deliberately NOT derived as a plain `cameraTarget !==
   * null` on every render: cameraTarget itself goes back to null the
   * moment an active following session is manually paused into "free"
   * (see below), and un-latching then would make MapView's overview-fit
   * effect re-run and incorrectly re-fit the whole route mid-ride. Only
   * resets to false when the camera genuinely returns to "overview" —
   * a new route ("route-opened") or an overview-mode restore — both of
   * which legitimately want a fresh fit. */
  hasActionableCameraTarget: boolean;
}

const INITIAL_HOOK_STATE: HookState = {
  camera: INITIAL_RIDE_CAMERA_STATE,
  cameraTarget: null,
  toastToken: 0,
  freeCameraPosition: null,
  hasActionableCameraTarget: false,
};

function hookReducer(state: HookState, event: HookEvent): HookState {
  if (event.type === "camera-settled") {
    // Always routed through the pure reducer (never bypassed) so
    // followZoomLevel is reconciled to MapLibre's real settled zoom while
    // genuinely following — see rideCamera.ts's "follow-zoom-settled"
    // event for the awaitingFreshFix guard that stops an unrelated
    // overview-fit settle from corrupting a just-restored/chosen zoom.
    // Reference-stable when nothing changed (mirrors the previous
    // early-return-on-not-free no-op exactly in that case), so this never
    // adds a re-render on every ordinary moveend while following.
    const zoomReconciled = rideCameraReducer(state.camera, {
      type: "follow-zoom-settled",
      zoom: event.zoom,
    }).state;
    if (state.camera.mode !== "free") {
      return zoomReconciled === state.camera
        ? state
        : { ...state, camera: zoomReconciled };
    }
    return {
      ...state,
      camera: zoomReconciled,
      freeCameraPosition: {
        coordinate: event.coordinate,
        zoom: event.zoom,
        bearingDegrees: event.bearingDegrees,
        pitchDegrees: event.pitchDegrees,
      },
    };
  }

  const transition = rideCameraReducer(state.camera, event);
  const nextMode = transition.state.mode;
  const nextCameraTarget =
    transition.command ?? (nextMode === "following" ? state.cameraTarget : null);

  return {
    camera: transition.state,
    cameraTarget: nextCameraTarget,
    toastToken: transition.pausedToast ? state.toastToken + 1 : state.toastToken,
    freeCameraPosition:
      event.type === "restore" && event.mode === "free" && event.coordinate
        ? {
            coordinate: event.coordinate,
            zoom: event.zoom ?? 0,
            bearingDegrees: event.bearingDegrees,
            pitchDegrees: event.pitchDegrees,
          }
        : nextMode === "free"
          ? state.freeCameraPosition
          : null,
    hasActionableCameraTarget:
      nextMode === "overview"
        ? false
        : state.hasActionableCameraTarget || nextCameraTarget !== null,
  };
}

/** Combines a fix's own heading/speed with the route's own tangent
 * direction around the rider's matched distance — everything
 * selectTravelBearingDegrees (rideCamera.ts) needs, pre-derived here so
 * the pure reducer never touches raw route geometry or GeolocationFix. */
function buildBearingContext(
  fix: GeolocationFix,
  routePoints: readonly RoutePoint[],
  matchedDistanceFromStartMetres: number | null,
  offRouteLevel: OffRouteLevel,
): BearingContext {
  return {
    headingDegrees: fix.headingDegrees,
    speedMetresPerSecond: fix.speedMetresPerSecond,
    routeTangentBearingDegrees:
      matchedDistanceFromStartMetres === null
        ? null
        : routeTangentBearingDegrees(routePoints, matchedDistanceFromStartMetres),
    offRouteLevel,
  };
}

export interface UseRideCameraOptions {
  routeId: string;
  routePoints: readonly RoutePoint[];
  currentFix: GeolocationFix | null;
  isStale: boolean;
  matchedDistanceFromStartMetres: number | null;
  offRouteLevel: OffRouteLevel;
  /** From useRideNavigation's restoredCameraState — null until (and
   * unless) a persisted camera state for this exact route is found. */
  restoredCameraState: StoredCameraState | null;
}

export interface UseRideCameraResult {
  mode: RideCameraMode;
  awaitingFreshFix: boolean;
  cameraTarget: RideCameraCommand | null;
  /** See HookState's own doc comment — true once a real camera command
   * has ever been produced this route-open session, sticky through a
   * later manual pause to "free". Intended for RidingScreen's own
   * MapView `suppressInitialOverviewFit` prop, so a restored "following"
   * ride still awaiting its first fresh fix shows the route overview
   * instead of MapLibre's default view. */
  hasActionableCameraTarget: boolean;
  showPausedToast: boolean;
  requestFollow: () => void;
  reportUserInteraction: () => void;
  /** Resets orientation to north-up/top-down: from "following", pauses
   * following and enters "free"; from "free", stays free and just resets
   * bearing/pitch, preserving centre/zoom either way. */
  requestNorthUp: () => void;
  /** The zoom-only, unanchored command for MapView's own `zoomTarget` prop
   * (backlog item 53) — for RidingScreen to pass straight through. Never
   * touches centre/bearing/pitch/mode; never calls reportUserInteraction.
   * Left unset by a zoom press that instead updates cameraTarget (backlog
   * item 65 — see requestZoom's own doc comment). */
  zoomTarget: ZoomCameraTarget | null;
  /** Issues a relative zoom change (e.g. ±1). Keeps Follow engaged with no
   * pause toast — this is a deliberate, settled product decision: zooming
   * while still being followed is a normal riding action, distinct from a
   * genuine manual pan/rotate/pitch gesture. While genuinely following
   * with an actionable anchor (hasActionableFollowAnchor, rideCamera.ts),
   * re-anchors the rider's own coordinate at the new zoom via
   * cameraTarget/setCamera, preserving the below-centre screen position
   * (backlog item 65) — never the ordinary true-centre-relative
   * zoomTarget/changeZoomBy path used otherwise (free/overview mode, or
   * following but still awaiting the first fix). */
  requestZoom: (delta: number) => void;
  /** True once the camera is free AND its last-settled orientation is
   * genuinely north-up/top-down — based on the real settled readback, not
   * optimistic intent, so it only reports true once a north-up transition
   * actually completes, and clears the moment a manual rotate/pitch
   * gesture is observed. */
  isNorthUpTopDown: boolean;
  /** Reports the camera's resting position after any move (user or
   * programmatic) settles — only actually retained while mode is "free",
   * so a suspended free-panned/north-up ride can be restored later. Safe
   * (and expected) to call for programmatic moves too; it's a no-op then. */
  reportCameraSettled: (
    coordinate: Coordinate,
    zoom: number,
    bearingDegrees: number,
    pitchDegrees: number,
  ) => void;
  /** For useRideNavigation's persistence — folded into its existing
   * write path (src/storage/mapping.ts), not a second one. */
  persistableCameraState: StoredCameraState;
  /** Resets the camera to its clean, pre-ride "overview" state — for the
   * shared End ride/Finish ride finaliser, since ending a ride never
   * changes routeId and so would never trigger the existing automatic
   * route-opened reset above on its own. Dispatches the same
   * "route-opened" event that reset already uses; no new reducer branch. */
  resetCamera: () => void;
}

/**
 * Camera UI state, kept entirely separate from GPS/progress/off-route
 * calculations (see src/ui/riding/useRideNavigation.ts, which this reads
 * from but never drives). Decisions are delegated to the pure
 * rideCameraReducer; this hook only handles React wiring: dispatching
 * events at the right times, resolving the bearing context a fix or
 * follow-request needs, and the paused-toast timer.
 */
export function useRideCamera({
  routeId,
  routePoints,
  currentFix,
  isStale,
  matchedDistanceFromStartMetres,
  offRouteLevel,
  restoredCameraState,
}: UseRideCameraOptions): UseRideCameraResult {
  const [state, dispatch] = useReducer(hookReducer, INITIAL_HOOK_STATE);
  const [showPausedToast, setShowPausedToast] = useState(false);

  // Resets to "route-opened" for every genuinely different route after
  // the first — the first is left alone so a pending restore (below) can
  // take over instead of every ride starting with a visible reset.
  const processedRouteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (processedRouteIdRef.current === routeId) return;
    const isFirstRouteSeen = processedRouteIdRef.current === null;
    processedRouteIdRef.current = routeId;
    if (!isFirstRouteSeen) {
      dispatch({ type: "route-opened" });
    }
  }, [routeId]);

  // Fires once per genuinely new restored value (useRideNavigation
  // re-attempts this per route.id, producing a fresh object only when a
  // real match is found) — never for a re-render with the same object.
  const lastRestoredRef = useRef<StoredCameraState | null>(null);
  useEffect(() => {
    if (!restoredCameraState || restoredCameraState === lastRestoredRef.current) return;
    lastRestoredRef.current = restoredCameraState;
    dispatch({
      type: "restore",
      mode: restoredCameraState.mode,
      coordinate: restoredCameraState.coordinate,
      zoom: restoredCameraState.zoom,
      bearingDegrees: restoredCameraState.bearingDegrees,
      pitchDegrees: restoredCameraState.pitchDegrees,
    });
  }, [restoredCameraState]);

  // Dispatches a "fresh-fix" for every new, non-stale fix — never for a
  // restored/resumed fix (isStale) or an unrelated rerender with the same
  // fix object. matchedDistanceFromStartMetres/offRouteLevel always
  // change together with currentFix (all three come from the same
  // processFix call in useRideNavigation), so reading them directly here
  // — rather than through a ref — always reflects the value for this
  // exact fix.
  const lastDispatchedFixRef = useRef<GeolocationFix | null>(null);
  useEffect(() => {
    if (!currentFix || isStale || currentFix === lastDispatchedFixRef.current) return;
    lastDispatchedFixRef.current = currentFix;
    dispatch({
      type: "fresh-fix",
      coordinate: currentFix.coordinate,
      bearingContext: buildBearingContext(
        currentFix,
        routePoints,
        matchedDistanceFromStartMetres,
        offRouteLevel,
      ),
    });
  }, [currentFix, isStale, routePoints, matchedDistanceFromStartMetres, offRouteLevel]);

  // Shows the paused toast for FOLLOW_PAUSED_TOAST_MS on every genuinely
  // new pause (toastToken increments), restarting the timer if another
  // pause happens before the previous one finished. Skipped on the very
  // first render, when toastToken is just its initial value.
  const isFirstToastRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstToastRenderRef.current) {
      isFirstToastRenderRef.current = false;
      return;
    }
    setShowPausedToast(true);
    const timeoutId = window.setTimeout(() => {
      setShowPausedToast(false);
    }, FOLLOW_PAUSED_TOAST_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [state.toastToken]);

  const latestFixInfoRef = useRef({
    currentFix,
    isStale,
    routePoints,
    matchedDistanceFromStartMetres,
    offRouteLevel,
  });
  useEffect(() => {
    latestFixInfoRef.current = {
      currentFix,
      isStale,
      routePoints,
      matchedDistanceFromStartMetres,
      offRouteLevel,
    };
  }, [currentFix, isStale, routePoints, matchedDistanceFromStartMetres, offRouteLevel]);

  // Always the latest state.camera, for requestZoom below to read
  // synchronously — dispatch() has no return value, so requestZoom must
  // decide whether a press is genuinely followed (hasActionableFollowAnchor,
  // backlog item 65) *before* dispatching, not from the dispatch's own
  // result. Mirrors latestFixInfoRef's identical "always latest" idiom:
  // safe because effects always commit before a subsequent user click can
  // fire, so this is never stale at the moment requestZoom actually runs.
  const latestCameraStateRef = useRef(state.camera);
  useEffect(() => {
    latestCameraStateRef.current = state.camera;
  }, [state.camera]);

  // Gives each explicit Northwards/Follow-location press, and now (backlog
  // item 65) each anchored zoom press while genuinely following, its own
  // request identity, so MapView can tell a genuine re-press (which must
  // reapply even with byte-identical resulting camera values, e.g. after
  // an intervening manual gesture) apart from an unrelated rerender. A
  // plain monotonic counter — deliberately not a timestamp or
  // crypto.randomUUID() — read and incremented only inside
  // requestFollow/requestNorthUp/requestZoom below, each of which only
  // actually runs once per real user click, so this stays safe under
  // React 18 StrictMode's double-invoke of render/reducer code (which
  // this ref is never read from). A remount resets this alongside
  // MapView's own lastAppliedCameraTargetRef (freshly null), so no
  // cross-remount collision is possible; an internal-only MapView
  // remount (style retry/fallback) also resets only that side, which is
  // equally harmless since the ref is null there too.
  const nextCameraRequestIdRef = useRef(0);

  const requestFollow = useCallback(() => {
    const {
      currentFix: fix,
      isStale: stale,
      routePoints: latestRoutePoints,
      matchedDistanceFromStartMetres: latestMatchedDistance,
      offRouteLevel: latestOffRouteLevel,
    } = latestFixInfoRef.current;
    const freshFix = fix && !stale ? fix : null;
    // Without a fresh fix, bearingContext is unused (the reducer's
    // pending-following branch never reads it) — the neutral shape here
    // just satisfies the event's type.
    const bearingContext: BearingContext = freshFix
      ? buildBearingContext(
          freshFix,
          latestRoutePoints,
          latestMatchedDistance,
          latestOffRouteLevel,
        )
      : {
          headingDegrees: null,
          speedMetresPerSecond: null,
          routeTangentBearingDegrees: null,
          offRouteLevel: latestOffRouteLevel,
        };
    nextCameraRequestIdRef.current += 1;
    dispatch({
      type: "follow-requested",
      freshCoordinate: freshFix ? freshFix.coordinate : null,
      bearingContext,
      requestId: String(nextCameraRequestIdRef.current),
    });
  }, []);

  const reportUserInteraction = useCallback(() => {
    dispatch({ type: "user-interaction" });
  }, []);

  const requestNorthUp = useCallback(() => {
    nextCameraRequestIdRef.current += 1;
    dispatch({
      type: "north-up-requested",
      requestId: String(nextCameraRequestIdRef.current),
    });
  }, []);

  const resetCamera = useCallback(() => {
    dispatch({ type: "route-opened" });
  }, []);

  // The zoom-only, unanchored command MapView applies via mapAdapter.ts's
  // changeZoomBy — deduped by requestId like Planning's own identical
  // mechanism (PlanningScreen.tsx's zoomTarget/generateId() convention),
  // NOT the monotonic counter used for cameraTarget's explicit
  // north-up/follow requestId above. Only actually set by requestZoom
  // below while NOT genuinely following with an actionable anchor (see
  // hasActionableFollowAnchor, rideCamera.ts) — a zoom press while
  // genuinely following instead routes through cameraTarget/setCamera,
  // reusing the monotonic counter above, so the rider's below-centre
  // screen anchor is preserved through the zoom (backlog item 65). The
  // two are mutually exclusive per press: requestZoom decides which one
  // to use, since dispatch has no synchronous return value to branch on
  // afterwards.
  const [zoomTarget, setZoomTarget] = useState<ZoomCameraTarget | null>(null);

  const requestZoom = useCallback((delta: number) => {
    if (hasActionableFollowAnchor(latestCameraStateRef.current)) {
      // Backlog item 65: reissue the already-committed follow coordinate/
      // bearing at the new zoom through the SAME explicit-command channel
      // North-up/explicit-Follow already use (cameraTarget/setCamera),
      // preserving the rider's below-centre screen anchor through the
      // zoom — never the ordinary true-centre-relative zoomTarget/
      // changeZoomBy path, and never both for the same press (see
      // RideCameraEvent's own "follow-zoom-changed" doc comment).
      nextCameraRequestIdRef.current += 1;
      dispatch({
        type: "follow-zoom-changed",
        delta,
        requestId: String(nextCameraRequestIdRef.current),
      });
      return;
    }
    // Not genuinely following with an actionable anchor (free/overview,
    // or following but still awaiting the first fix) — nothing to
    // honestly anchor to, so fall back to the ordinary, unanchored zoom
    // exactly as before item 65.
    setZoomTarget({ delta, requestId: generateId() });
    dispatch({ type: "follow-zoom-changed", delta });
  }, []);

  const reportCameraSettled = useCallback(
    (
      coordinate: Coordinate,
      zoom: number,
      bearingDegrees: number,
      pitchDegrees: number,
    ) => {
      dispatch({
        type: "camera-settled",
        coordinate,
        zoom,
        bearingDegrees,
        pitchDegrees,
      });
    },
    [],
  );

  // Memoized so its reference only changes when the underlying values do —
  // callers (useRideNavigation, via RidingScreen) key a persistence effect
  // off this, and a fresh object on every unrelated render would turn
  // that into a write on every render instead of only on real changes.
  const freeCoordinate = state.freeCameraPosition?.coordinate ?? null;
  const freeZoom = state.freeCameraPosition?.zoom ?? null;
  const freeBearing = state.freeCameraPosition?.bearingDegrees ?? 0;
  const freePitch = state.freeCameraPosition?.pitchDegrees ?? 0;
  const persistableCameraState = useMemo<StoredCameraState>(() => {
    if (state.camera.mode === "free" && freeCoordinate !== null) {
      return {
        mode: "free",
        coordinate: freeCoordinate,
        zoom: freeZoom,
        bearingDegrees: freeBearing,
        pitchDegrees: freePitch,
      };
    }
    if (state.camera.mode === "following") {
      // Broadens StoredCameraState.zoom's existing contract (backlog item
      // 53) rather than adding a second overlapping stored field: while
      // "free" it's the settled pan zoom as above; while "following" it's
      // the rider's selected follow zoom, restored via
      // rideCameraReducer's own "restore" case, defaulting to
      // NAVIGATION_ZOOM there — never here — for an invalid/missing value.
      return {
        mode: "following",
        coordinate: null,
        zoom: state.camera.followZoomLevel,
        bearingDegrees: 0,
        pitchDegrees: 0,
      };
    }
    return {
      mode: state.camera.mode,
      coordinate: null,
      zoom: null,
      bearingDegrees: 0,
      pitchDegrees: 0,
    };
  }, [
    state.camera.mode,
    state.camera.followZoomLevel,
    freeCoordinate,
    freeZoom,
    freeBearing,
    freePitch,
  ]);

  const isNorthUpTopDown =
    state.camera.mode === "free" &&
    state.freeCameraPosition !== null &&
    state.freeCameraPosition.bearingDegrees === 0 &&
    state.freeCameraPosition.pitchDegrees === 0;

  return {
    mode: state.camera.mode,
    awaitingFreshFix: state.camera.awaitingFreshFix,
    cameraTarget: state.cameraTarget,
    hasActionableCameraTarget: state.hasActionableCameraTarget,
    showPausedToast,
    requestFollow,
    reportUserInteraction,
    requestNorthUp,
    zoomTarget,
    requestZoom,
    isNorthUpTopDown,
    reportCameraSettled,
    persistableCameraState,
    resetCamera,
  };
}
