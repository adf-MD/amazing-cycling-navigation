import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Coordinate, RoutePoint } from "../../domain/types.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import { routeTangentBearingDegrees } from "../../navigation/bearing.ts";
import type { OffRouteLevel } from "../../navigation/types.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";
import {
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
    if (state.camera.mode !== "free") return state;
    return {
      ...state,
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

  // Gives each explicit Northwards/Follow-location press its own request
  // identity, so MapView can tell a genuine re-press (which must reapply
  // even with byte-identical resulting camera values, e.g. after an
  // intervening manual gesture) apart from an unrelated rerender. A plain
  // monotonic counter — deliberately not a timestamp or crypto.randomUUID()
  // — read and incremented only inside requestFollow/requestNorthUp below,
  // each of which only actually runs once per real user click, so this
  // stays safe under React 18 StrictMode's double-invoke of render/reducer
  // code (which this ref is never read from). A remount resets this
  // alongside MapView's own lastAppliedCameraTargetRef (freshly null), so
  // no cross-remount collision is possible; an internal-only MapView
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
  const persistableCameraState = useMemo<StoredCameraState>(
    () =>
      state.camera.mode === "free" && freeCoordinate !== null
        ? {
            mode: "free",
            coordinate: freeCoordinate,
            zoom: freeZoom,
            bearingDegrees: freeBearing,
            pitchDegrees: freePitch,
          }
        : {
            mode: state.camera.mode,
            coordinate: null,
            zoom: null,
            bearingDegrees: 0,
            pitchDegrees: 0,
          },
    [state.camera.mode, freeCoordinate, freeZoom, freeBearing, freePitch],
  );

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
    isNorthUpTopDown,
    reportCameraSettled,
    persistableCameraState,
    resetCamera,
  };
}
