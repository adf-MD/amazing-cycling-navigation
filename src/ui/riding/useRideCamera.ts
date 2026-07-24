import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Coordinate } from "../../domain/types.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";
import {
  INITIAL_RIDE_CAMERA_STATE,
  rideCameraReducer,
  type RideCameraCommand,
  type RideCameraEvent,
  type RideCameraMode,
  type RideCameraState,
} from "./rideCamera.ts";

/** How long the "Map follow paused" message stays visible after a manual
 * interaction interrupts following — a brief, non-blocking indication,
 * not something the rider has to dismiss. */
const FOLLOW_PAUSED_TOAST_MS = 3_000;

/** Reported whenever the map's camera settles (see MapView's
 * onCameraSettled) — hook-level bookkeeping only, not part of the pure
 * rideCameraReducer state machine, so it's a separate event the wrapping
 * reducer below handles directly. */
interface CameraSettledEvent {
  type: "camera-settled";
  coordinate: Coordinate;
  zoom: number;
}

type HookEvent = RideCameraEvent | CameraSettledEvent;

interface HookState {
  camera: RideCameraState;
  cameraTarget: RideCameraCommand | null;
  /** Bumped on every transition that should show the paused toast — a
   * plain boolean can't distinguish "still the same pause" from "paused
   * again", so this is compared by value, not truthiness. */
  toastToken: number;
  /** The rider's manually-panned position while free, so it can be
   * persisted and restored later. Cleared whenever mode leaves "free". */
  freeCameraPosition: { coordinate: Coordinate; zoom: number } | null;
}

const INITIAL_HOOK_STATE: HookState = {
  camera: INITIAL_RIDE_CAMERA_STATE,
  cameraTarget: null,
  toastToken: 0,
  freeCameraPosition: null,
};

function hookReducer(state: HookState, event: HookEvent): HookState {
  if (event.type === "camera-settled") {
    if (state.camera.mode !== "free") return state;
    return {
      ...state,
      freeCameraPosition: { coordinate: event.coordinate, zoom: event.zoom },
    };
  }

  const transition = rideCameraReducer(state.camera, event);
  const nextMode = transition.state.mode;

  return {
    camera: transition.state,
    cameraTarget:
      transition.command ?? (nextMode === "following" ? state.cameraTarget : null),
    toastToken: transition.pausedToast ? state.toastToken + 1 : state.toastToken,
    freeCameraPosition:
      event.type === "restore" && event.mode === "free" && event.coordinate
        ? { coordinate: event.coordinate, zoom: event.zoom ?? 0 }
        : nextMode === "free"
          ? state.freeCameraPosition
          : null,
  };
}

export interface UseRideCameraOptions {
  routeId: string;
  currentFix: GeolocationFix | null;
  isStale: boolean;
  /** From useRideNavigation's restoredCameraState — null until (and
   * unless) a persisted camera state for this exact route is found. */
  restoredCameraState: StoredCameraState | null;
}

export interface UseRideCameraResult {
  mode: RideCameraMode;
  awaitingFreshFix: boolean;
  cameraTarget: RideCameraCommand | null;
  showPausedToast: boolean;
  requestFollow: () => void;
  reportUserInteraction: () => void;
  /** Reports the camera's resting position after any move (user or
   * programmatic) settles — only actually retained while mode is "free",
   * so a suspended free-panned ride can be restored later. Safe (and
   * expected) to call for programmatic moves too; it's a no-op then. */
  reportCameraSettled: (coordinate: Coordinate, zoom: number) => void;
  /** For useRideNavigation's persistence — folded into its existing
   * write path (src/storage/mapping.ts), not a second one. */
  persistableCameraState: StoredCameraState;
}

/**
 * Camera UI state, kept entirely separate from GPS/progress/off-route
 * calculations (see src/ui/riding/useRideNavigation.ts, which this reads
 * from but never drives). Decisions are delegated to the pure
 * rideCameraReducer; this hook only handles React wiring: dispatching
 * events at the right times, and the paused-toast timer.
 */
export function useRideCamera({
  routeId,
  currentFix,
  isStale,
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
    });
  }, [restoredCameraState]);

  // Dispatches a "fresh-fix" for every new, non-stale fix — never for a
  // restored/resumed fix (isStale) or an unrelated rerender with the same
  // fix object.
  const lastDispatchedFixRef = useRef<GeolocationFix | null>(null);
  useEffect(() => {
    if (!currentFix || isStale || currentFix === lastDispatchedFixRef.current) return;
    lastDispatchedFixRef.current = currentFix;
    dispatch({ type: "fresh-fix", coordinate: currentFix.coordinate });
  }, [currentFix, isStale]);

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

  const latestFixInfoRef = useRef({ currentFix, isStale });
  useEffect(() => {
    latestFixInfoRef.current = { currentFix, isStale };
  }, [currentFix, isStale]);

  const requestFollow = useCallback(() => {
    const { currentFix: fix, isStale: stale } = latestFixInfoRef.current;
    dispatch({
      type: "follow-requested",
      freshCoordinate: fix && !stale ? fix.coordinate : null,
    });
  }, []);

  const reportUserInteraction = useCallback(() => {
    dispatch({ type: "user-interaction" });
  }, []);

  const reportCameraSettled = useCallback((coordinate: Coordinate, zoom: number) => {
    dispatch({ type: "camera-settled", coordinate, zoom });
  }, []);

  // Memoized so its reference only changes when the underlying values do —
  // callers (useRideNavigation, via RidingScreen) key a persistence effect
  // off this, and a fresh object on every unrelated render would turn
  // that into a write on every render instead of only on real changes.
  const freeCoordinate = state.freeCameraPosition?.coordinate ?? null;
  const freeZoom = state.freeCameraPosition?.zoom ?? null;
  const persistableCameraState = useMemo<StoredCameraState>(
    () =>
      state.camera.mode === "free" && freeCoordinate !== null
        ? { mode: "free", coordinate: freeCoordinate, zoom: freeZoom }
        : { mode: state.camera.mode, coordinate: null, zoom: null },
    [state.camera.mode, freeCoordinate, freeZoom],
  );

  return {
    mode: state.camera.mode,
    awaitingFreshFix: state.camera.awaitingFreshFix,
    cameraTarget: state.cameraTarget,
    showPausedToast,
    requestFollow,
    reportUserInteraction,
    reportCameraSettled,
    persistableCameraState,
  };
}
