import { useCallback, useEffect, useRef, useState } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import {
  browserGeolocationSource,
  type GeolocationError,
  type GeolocationFix,
  type GeolocationSource,
  type GeolocationWatchStatus,
} from "../../platform/geolocation.ts";
import type { OffRouteLevel, ElevationWindowMetres } from "../../navigation/types.ts";
import {
  DEFAULT_ELEVATION_WINDOW_METRES,
  selectUpcomingElevationWindow,
  type UpcomingElevationWindow,
} from "../../navigation/upcomingElevation.ts";
import {
  fromStoredRideState,
  toStoredRideState,
  type StoredCameraState,
} from "../../storage/mapping.ts";
import {
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import { systemClock, type Clock } from "../../platform/clock.ts";
import {
  INITIAL_RIDE_NAVIGATION_CORE_STATE,
  processFix,
} from "../../navigation/rideNavigationCore.ts";

export interface RideNavigationState {
  geolocationStatus: GeolocationWatchStatus;
  geolocationError: GeolocationError | null;
  currentFix: GeolocationFix | null;
  isStale: boolean;
  matchedDistanceFromStartMetres: number | null;
  distanceRemainingMetres: number | null;
  offRouteLevel: OffRouteLevel;
  elevationWindowMetres: ElevationWindowMetres;
  upcomingElevation: UpcomingElevationWindow;
  setElevationWindowMetres: (metres: ElevationWindowMetres) => void;
  start: () => void;
  /** Non-null only once a persisted camera state for this exact route has
   * actually been restored — a genuinely new ride has nothing to
   * restore, so useRideCamera's own default "overview" state is already
   * correct and doesn't need a restore event dispatched. */
  restoredCameraState: StoredCameraState | null;
}

const DEFAULT_CAMERA_STATE: StoredCameraState = {
  mode: "overview",
  coordinate: null,
  zoom: null,
};

function defaultGetCameraState(): StoredCameraState {
  return DEFAULT_CAMERA_STATE;
}

export interface UseRideNavigationOptions {
  geolocationSource?: GeolocationSource;
  /** Called only when about to persist (a fix/progress/elevation-window
   * change), reading whatever the camera controller's latest state is at
   * that moment — folded into the same write path as everything else,
   * not a second one. A getter rather than a reactive value: both hooks
   * are called in the same render (useRideCamera needs this hook's
   * restoredCameraState as an input), so neither can feed the other's
   * *current* render output back into its own call — passing a stable
   * function that reads a ref avoids that without a setState-in-effect
   * bridge. A camera-only change (e.g. panning while free, no new fix)
   * isn't persisted until the next fix, which arrives roughly every
   * second while actively riding — an acceptable lag for this. */
  getCameraState?: () => StoredCameraState;
  clock?: Clock;
}

export function useRideNavigation(
  route: PlannedRoute,
  options: UseRideNavigationOptions = {},
): RideNavigationState {
  const geolocationSource = options.geolocationSource ?? browserGeolocationSource;
  const clock = options.clock ?? systemClock;
  const getCameraState = options.getCameraState ?? defaultGetCameraState;

  const [geolocationStatus, setGeolocationStatus] =
    useState<GeolocationWatchStatus>("idle");
  const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null);
  const [coreState, setCoreState] = useState(INITIAL_RIDE_NAVIGATION_CORE_STATE);
  const [currentFix, setCurrentFix] = useState<GeolocationFix | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [elevationWindowMetres, setElevationWindowMetres] =
    useState<ElevationWindowMetres>(DEFAULT_ELEVATION_WINDOW_METRES);
  const [restoredCameraState, setRestoredCameraState] =
    useState<StoredCameraState | null>(null);

  const clearWatchRef = useRef<(() => void) | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const routePoints = route.points;

  // Fix processing happens directly in the geolocation callback — an
  // external-system subscription calling setState when new data arrives
  // — rather than in a useEffect reacting to a fix value, which would
  // cause an extra cascading render for every single fix.
  const handleFix = useCallback(
    (fix: GeolocationFix) => {
      startedAtRef.current ??= new Date(clock.now()).toISOString();
      setCurrentFix(fix);
      setIsStale(false);
      setCoreState(
        (previous) =>
          processFix(routePoints, fix.coordinate, fix.accuracyMetres, previous).coreState,
      );
    },
    [clock, routePoints],
  );

  const handleError = useCallback((nextError: GeolocationError) => {
    setGeolocationError(nextError);
    setGeolocationStatus("error");
  }, []);

  const start = useCallback(() => {
    if (clearWatchRef.current) return;
    setGeolocationStatus("watching");
    setGeolocationError(null);
    clearWatchRef.current = geolocationSource.watchPosition(handleFix, handleError);
  }, [geolocationSource, handleFix, handleError]);

  const stop = useCallback(() => {
    clearWatchRef.current?.();
    clearWatchRef.current = null;
    setGeolocationStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      clearWatchRef.current?.();
    };
  }, []);

  // Restore any persisted ride state for this exact route as soon as the
  // screen mounts, before the rider has taken any action. The restored
  // fix is shown immediately but marked stale until a fresh one arrives.
  useEffect(() => {
    let cancelled = false;
    getActiveRideState()
      .then((stored) => {
        if (cancelled || stored?.routeId !== route.id) return;
        const restored = fromStoredRideState(stored);
        startedAtRef.current = stored.startedAt;
        setCoreState(restored.core);
        setCurrentFix(restored.lastFix);
        setIsStale(restored.lastFix !== null);
        setElevationWindowMetres(restored.elevationWindowMetres);
        setRestoredCameraState(restored.cameraState);
      })
      .catch(() => {
        // No usable stored state; continue with a fresh session.
      });
    return () => {
      cancelled = true;
    };
  }, [route.id]);

  // Persist after every accepted fix or elevation-window change — each
  // write is a cheap single-row upsert, so no extra throttling is
  // needed. Reads the camera state fresh via getCameraState() rather
  // than depending on it directly (see the option's doc comment).
  useEffect(() => {
    if (currentFix === null || startedAtRef.current === null) return;
    setActiveRideState(
      toStoredRideState(
        route.id,
        startedAtRef.current,
        currentFix,
        coreState,
        elevationWindowMetres,
        getCameraState(),
      ),
    ).catch(() => {
      // Persistence failure isn't fatal to an in-progress ride; the next
      // successful write will catch the state up.
    });
  }, [route.id, currentFix, coreState, elevationWindowMetres, getCameraState]);

  // On visibilitychange/pageshow, mark the current fix stale and restart
  // the watch — but only if it was already running: a genuine reload
  // starts fresh (status "idle") and must wait for an explicit tap,
  // matching the rule that geolocation is never requested at page load.
  useEffect(() => {
    function resumeIfWatching() {
      if (geolocationStatus !== "watching") return;
      setIsStale(true);
      stop();
      start();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        resumeIfWatching();
      }
    }

    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        resumeIfWatching();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [geolocationStatus, start, stop]);

  const matchedDistanceFromStartMetres =
    coreState.lastMatch?.distanceFromStartMetres ?? null;
  const distanceRemainingMetres =
    matchedDistanceFromStartMetres === null
      ? null
      : Math.max(0, route.distanceMetres - matchedDistanceFromStartMetres);

  return {
    geolocationStatus,
    geolocationError,
    currentFix,
    isStale,
    matchedDistanceFromStartMetres,
    distanceRemainingMetres,
    offRouteLevel: coreState.offRouteMachineState.level,
    elevationWindowMetres,
    upcomingElevation: selectUpcomingElevationWindow(
      route.points,
      matchedDistanceFromStartMetres ?? 0,
      elevationWindowMetres,
    ),
    setElevationWindowMetres,
    start,
    restoredCameraState,
  };
}
