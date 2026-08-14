import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Coordinate } from "../../domain/types.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";
import {
  INITIAL_RIDE_CAMERA_STATE,
  NAVIGATION_ZOOM,
  rideCameraReducer,
  type BearingContext,
  type RideCameraCommand,
  type RideCameraEvent,
  type RideCameraMode,
  type RideCameraState,
} from "./rideCamera.ts";

/** How long the "Map follow paused" message stays visible after a manual
 * interaction (or the north-up control) interrupts following. Matches
 * useRideCamera.ts's own identically-named/valued constant — kept as a
 * separate, local literal rather than a shared import, mirroring this
 * codebase's convention of each screen/hook owning its own small,
 * non-tunable-policy constants (see rideCamera.ts's own doc comments for
 * which values genuinely count as shared, tested policy versus glue). */
const FOLLOW_PAUSED_TOAST_MS = 3_000;

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
  toastToken: number;
  freeCameraPosition: FreeCameraPosition | null;
}

const INITIAL_HOOK_STATE: HookState = {
  camera: INITIAL_RIDE_CAMERA_STATE,
  cameraTarget: null,
  toastToken: 0,
  freeCameraPosition: null,
};

// Adapted from useRideCamera.ts's own private hookReducer — orchestration
// glue (camera-settled/freeCameraPosition/toast-token bookkeeping) around
// the unmodified, shared rideCameraReducer, not tunable policy, so
// duplicating a hook-local copy here doesn't risk "subtly different
// thresholds" (none live in this function). Deliberately omits
// hasActionableCameraTarget: free roam has no route geometry for MapView's
// overview-fit effect to ever act on (points=[] always yields a null
// bounding box), so suppressInitialOverviewFit is passed as a fixed `true`
// with no dynamic latch needed.
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
  };
}

/** Free roam's equivalent of useRideCamera.ts's buildBearingContext —
 * always feeds a null route tangent and a fixed "on-route" level into the
 * shared selectTravelBearingDegrees policy (rideCamera.ts), which already
 * falls back to "GPS course when reliable, else retain the last stable
 * bearing, else none" for exactly that input shape — confirmed by direct
 * reading, no changes needed to that shared, tested function. */
function buildFreeRoamBearingContext(fix: GeolocationFix): BearingContext {
  return {
    headingDegrees: fix.headingDegrees,
    speedMetresPerSecond: fix.speedMetresPerSecond,
    routeTangentBearingDegrees: null,
    offRouteLevel: "on-route",
  };
}

const NEUTRAL_BEARING_CONTEXT: BearingContext = {
  headingDegrees: null,
  speedMetresPerSecond: null,
  routeTangentBearingDegrees: null,
  offRouteLevel: "on-route",
};

export interface UseFreeRoamCameraOptions {
  currentFix: GeolocationFix | null;
  isStale: boolean;
  /** From useFreeRoamNavigation's restoredCameraState — null until (and
   * unless) a persisted camera state for this session is found. */
  restoredCameraState: StoredCameraState | null;
  /** From useFreeRoamNavigation's restoredLastReliableBearingDegrees —
   * used only to frame a resumed-into-following session sensibly before
   * the first fresh fix arrives (see cameraTarget's own doc comment
   * below); never fed into the shared bearing-selection policy directly. */
  restoredLastReliableBearingDegrees: number | null;
}

export interface UseFreeRoamCameraResult {
  mode: RideCameraMode;
  awaitingFreshFix: boolean;
  cameraTarget: RideCameraCommand | null;
  showPausedToast: boolean;
  requestFollow: () => void;
  reportUserInteraction: () => void;
  requestNorthUp: () => void;
  isNorthUpTopDown: boolean;
  reportCameraSettled: (
    coordinate: Coordinate,
    zoom: number,
    bearingDegrees: number,
    pitchDegrees: number,
  ) => void;
  persistableCameraState: StoredCameraState;
  /** The reducer's own internal dead-band/retain-state
   * (lastCommandedBearingDegrees), exposed unconditionally regardless of
   * camera mode — unlike persistableCameraState above, which (matching
   * route-Riding's own useRideCamera.ts) only ever carries a real bearing
   * while mode is "free". Route Riding never needs to persist a live
   * "following" bearing, since a route tangent is always available to
   * re-derive one on resume; free roam has no such fallback, so this must
   * be persisted separately to frame a resumed-into-following session
   * before the first fresh fix (see cameraTarget's own doc comment). */
  persistableLastReliableBearingDegrees: number | null;
  resetCamera: () => void;
}

/**
 * Free roam's counterpart to useRideCamera.ts — reuses the shared, pure
 * rideCameraReducer/selectTravelBearingDegrees policy completely unchanged
 * (see buildFreeRoamBearingContext above), with its own smaller, adapted
 * React wiring: no routeId-keyed reset effect (FreeRoamScreen always fully
 * unmounts/remounts on any session change, so there's no "same instance,
 * different session" case to reset for, unlike RidingScreen receiving a
 * different route prop) and no hasActionableCameraTarget latch (see
 * hookReducer's own doc comment).
 */
export function useFreeRoamCamera({
  currentFix,
  isStale,
  restoredCameraState,
  restoredLastReliableBearingDegrees,
}: UseFreeRoamCameraOptions): UseFreeRoamCameraResult {
  const [state, dispatch] = useReducer(hookReducer, INITIAL_HOOK_STATE);
  const [showPausedToast, setShowPausedToast] = useState(false);

  // Fires once per genuinely new restored value — mirrors
  // useRideCamera.ts's identical restore-dispatch effect, with one
  // free-roam-specific addition: an "overview" restored mode is skipped
  // entirely, never dispatched. This closes a real race found and
  // reproduced while writing this hook's own e2e coverage: RidingLauncher's
  // "Start free roam" always persists an initial row with cameraMode
  // "overview" (there is nothing more meaningful to write before any fix
  // has ever been accepted — see toStoredFreeRoamState's own initial call
  // site), and FreeRoamScreen's mount effect calls requestFollow()
  // synchronously in the same tick, immediately setting mode to
  // "following". Because the storage read this restore effect depends on
  // resolves asynchronously (a microtask, after that synchronous mount
  // effect), an "overview" restore would otherwise always fire *after* the
  // follow request and reset mode straight back to "overview" — silently
  // undoing it, every single time a brand-new session starts. "overview"
  // is never a meaningful state to restore *into* regardless: it's
  // rideCameraReducer's own INITIAL_RIDE_CAMERA_STATE already, and once a
  // session is genuinely under way its persisted mode is always
  // "following" or "free" (the only ways a route session's cameraMode
  // could legitimately still read "overview" here don't exist for free
  // roam — a real Resume free roam only ever becomes reachable after the
  // first fix has already been accepted and persisted, per
  // useFreeRoamNavigation's own persistence-effect guard).
  const lastRestoredRef = useRef<StoredCameraState | null>(null);
  useEffect(() => {
    if (!restoredCameraState || restoredCameraState === lastRestoredRef.current) return;
    lastRestoredRef.current = restoredCameraState;
    if (restoredCameraState.mode === "overview") return;
    dispatch({
      type: "restore",
      mode: restoredCameraState.mode,
      coordinate: restoredCameraState.coordinate,
      zoom: restoredCameraState.zoom,
      bearingDegrees: restoredCameraState.bearingDegrees,
      pitchDegrees: restoredCameraState.pitchDegrees,
    });
  }, [restoredCameraState]);

  // Dispatches a "fresh-fix" for every new, non-stale fix — mirrors
  // useRideCamera.ts's identical effect, minus the route-tangent inputs.
  const lastDispatchedFixRef = useRef<GeolocationFix | null>(null);
  useEffect(() => {
    if (!currentFix || isStale || currentFix === lastDispatchedFixRef.current) return;
    lastDispatchedFixRef.current = currentFix;
    dispatch({
      type: "fresh-fix",
      coordinate: currentFix.coordinate,
      bearingContext: buildFreeRoamBearingContext(currentFix),
    });
  }, [currentFix, isStale]);

  // Shows the paused toast for FOLLOW_PAUSED_TOAST_MS on every genuinely
  // new pause — identical mechanism to useRideCamera.ts's own equivalent.
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

  const latestFixInfoRef = useRef({ currentFix, isStale });
  useEffect(() => {
    latestFixInfoRef.current = { currentFix, isStale };
  }, [currentFix, isStale]);

  // See useRideCamera.ts's identical nextCameraRequestIdRef doc comment for
  // the full requestId/dedup rationale — copied verbatim.
  const nextCameraRequestIdRef = useRef(0);

  const requestFollow = useCallback(() => {
    const { currentFix: fix, isStale: stale } = latestFixInfoRef.current;
    const freshFix = fix && !stale ? fix : null;
    const bearingContext: BearingContext = freshFix
      ? buildFreeRoamBearingContext(freshFix)
      : NEUTRAL_BEARING_CONTEXT;
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

  // Avoids MapLibre's raw default world view while resuming into a
  // "following" session with no fresh fix yet — rideCameraReducer's own
  // "restore" case deliberately produces no command for a following
  // restore (route-Riding fills that gap with MapView's separate
  // overview-fit-to-route-bounds effect, which has nothing to fit here,
  // since points=[] always yields a null bounding box). This hook-local
  // synthetic command frames the restored (possibly stale) fix instead,
  // using the restored last-reliable-bearing or north-up (0) when absent.
  // It self-cancels on every relevant transition: a real "fresh-fix"
  // command existing (state.cameraTarget becomes non-null), isStale
  // flipping false (this recomputes to null), or the rider
  // interacting/pressing north-up (mode leaves "following") — no extra
  // bookkeeping needed for any of the three.
  const initialFramingCommand = useMemo<RideCameraCommand | null>(() => {
    if (!currentFix || !isStale) return null;
    return {
      coordinate: currentFix.coordinate,
      zoom: NAVIGATION_ZOOM,
      bearingDegrees: restoredLastReliableBearingDegrees ?? 0,
      pitchDegrees: 0,
      animate: false,
      followOffset: false,
    };
  }, [currentFix, isStale, restoredLastReliableBearingDegrees]);

  const cameraTarget =
    state.cameraTarget ??
    (state.camera.mode === "following" ? initialFramingCommand : null);

  return {
    mode: state.camera.mode,
    awaitingFreshFix: state.camera.awaitingFreshFix,
    cameraTarget,
    showPausedToast,
    requestFollow,
    reportUserInteraction,
    requestNorthUp,
    isNorthUpTopDown,
    reportCameraSettled,
    persistableCameraState,
    persistableLastReliableBearingDegrees: state.camera.lastCommandedBearingDegrees,
    resetCamera,
  };
}
