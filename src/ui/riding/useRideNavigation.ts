import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import {
  browserGeolocationSource,
  type GeolocationError,
  type GeolocationFix,
  type GeolocationSource,
  type GeolocationWatchStatus,
} from "../../platform/geolocation.ts";
import type { OffRouteLevel, ElevationViewMode } from "../../navigation/types.ts";
import { analyzeRouteElevationProfile } from "../../navigation/gradient.ts";
import {
  DEFAULT_ELEVATION_VIEW_MODE,
  buildFullProfileMarker,
  selectUpcomingElevationWindow,
  type FullProfileMarker,
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

/** What the elevation chart should show for the current view mode. `full`'s
 * `marker` is `null` only when there's no matched progress to place it at
 * (an empty route, handled defensively — RidingScreen itself gates on
 * `matchedDistanceFromStartMetres !== null` before rendering a marker at
 * all). */
export type ElevationProfileDisplay =
  | { kind: "full"; marker: FullProfileMarker | null }
  | { kind: "upcoming"; window: UpcomingElevationWindow };

export interface RideNavigationState {
  geolocationStatus: GeolocationWatchStatus;
  geolocationError: GeolocationError | null;
  currentFix: GeolocationFix | null;
  isStale: boolean;
  matchedDistanceFromStartMetres: number | null;
  /** The presentation-only route distance used for the elevation view:
   * tracks `matchedDistanceFromStartMetres` while on-route, and freezes at
   * the last reliable position while strongly off-route (see
   * `RideNavigationCoreState.lastReliableMatch`). Never used for the map's
   * live position marker, camera, or off-route warning — those use
   * `matchedDistanceFromStartMetres` directly. */
  presentationDistanceFromStartMetres: number | null;
  distanceRemainingMetres: number | null;
  offRouteLevel: OffRouteLevel;
  elevationViewMode: ElevationViewMode;
  elevationProfileDisplay: ElevationProfileDisplay;
  setElevationViewMode: (mode: ElevationViewMode) => void;
  /** The rider's desired wake-lock preference for this active ride only —
   * see storage/mapping.ts's wakeLockDesired field. Never a global
   * setting; restored/persisted exactly like elevationViewMode above. */
  wakeLockDesired: boolean;
  setWakeLockDesired: (next: boolean) => void;
  /** The stable RouteFeature.id of the recognised climb the rider has
   * manually left Climb elevation view for, or null when nothing is
   * dismissed — see storage/mapping.ts's dismissedClimbFeatureId field and
   * navigation/climbElevationView.ts's selectEffectiveElevationView, which
   * is the sole consumer of this value (RidingScreen owns the derivation,
   * since only it has the route's detected features). Restored/persisted
   * exactly like elevationViewMode/wakeLockDesired above. */
  dismissedClimbFeatureId: string | null;
  setDismissedClimbFeatureId: (next: string | null) => void;
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
  bearingDegrees: 0,
  pitchDegrees: 0,
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
  const [elevationViewMode, setElevationViewMode] = useState<ElevationViewMode>(
    DEFAULT_ELEVATION_VIEW_MODE,
  );
  const [restoredCameraState, setRestoredCameraState] =
    useState<StoredCameraState | null>(null);
  const [wakeLockDesired, setWakeLockDesired] = useState(false);
  const [dismissedClimbFeatureId, setDismissedClimbFeatureId] = useState<string | null>(
    null,
  );

  const clearWatchRef = useRef<(() => void) | null>(null);
  // Bumped whenever a genuinely new native watch is created (start()) or
  // the current one is explicitly torn down (stop(), unmount). Callbacks
  // registered against a specific watch close over the generation they
  // were created with and become permanent no-ops once it no longer
  // matches — this rejects stale/superseded-watch callbacks structurally,
  // regardless of timing, rather than relying on clearWatchRef alone.
  const watchGenerationRef = useRef(0);
  // Mirrors geolocationStatus synchronously. start()'s reentry guard and
  // the visibilitychange/pageshow resume gate below must read this, not
  // the reactive geolocationStatus closure value: stop() immediately
  // followed by start() (see resumeIfWatching) would otherwise see a
  // stale, not-yet-flushed status and silently no-op the restart, since
  // React state updates aren't applied mid-callback.
  const statusRef = useRef<GeolocationWatchStatus>("idle");
  const startedAtRef = useRef<string | null>(null);
  const routePoints = route.points;

  const setStatus = useCallback((next: GeolocationWatchStatus) => {
    statusRef.current = next;
    setGeolocationStatus(next);
  }, []);

  // Fix processing happens directly in the geolocation callback — an
  // external-system subscription calling setState when new data arrives
  // — rather than in a useEffect reacting to a fix value, which would
  // cause an extra cascading render for every single fix. Every accepted
  // fix restores "watching" and clears any error, whether it's the very
  // first fix, an ordinary in-progress one, or one that self-heals a
  // still-live watch after a transient error (see handleError's policy).
  const handleFix = useCallback(
    (fix: GeolocationFix) => {
      startedAtRef.current ??= new Date(clock.now()).toISOString();
      setCurrentFix(fix);
      setIsStale(false);
      setStatus("watching");
      setGeolocationError(null);
      setCoreState(
        (previous) =>
          processFix(routePoints, fix.coordinate, fix.accuracyMetres, previous).coreState,
      );
    },
    [clock, routePoints, setStatus],
  );

  // Chosen policy: an error does NOT tear down the underlying native
  // watch. The same watchPosition registration can legitimately keep
  // delivering fixes after an error (see GeolocationSource's contract),
  // so leaving it live lets a transient failure self-heal automatically
  // via handleFix above. start() (an explicit Try again) still gives the
  // rider a reliable, explicit dispose-and-recreate path regardless of
  // whether the old watch would have recovered on its own.
  const handleError = useCallback(
    (nextError: GeolocationError) => {
      setGeolocationError(nextError);
      setIsStale(true);
      setStatus("error");
    },
    [setStatus],
  );

  const start = useCallback(() => {
    // Reads the synchronously-updated ref, not the batched React state —
    // this is what makes stop(); start() (resumeIfWatching) and rapid
    // repeated taps both work correctly. Proceeds from "idle" (first
    // start) and from "error" (Try again); no-ops only while already
    // "watching", so duplicate taps never create a second concurrent
    // watch.
    if (statusRef.current === "watching") return;

    // Dispose whatever watch is currently registered — a no-op when
    // idle, and the explicit "dispose the obsolete/error-state watch"
    // Try again needs when recovering from an error (see handleError's
    // policy above, which leaves that watch alive until this point).
    clearWatchRef.current?.();

    const generation = watchGenerationRef.current + 1;
    watchGenerationRef.current = generation;
    setStatus("watching");
    setGeolocationError(null);

    const clear = geolocationSource.watchPosition(
      (fix) => {
        if (watchGenerationRef.current !== generation) return;
        handleFix(fix);
      },
      (error) => {
        if (watchGenerationRef.current !== generation) return;
        handleError(error);
      },
    );

    // Defends the synchronous-callback race: if this generation was
    // already superseded before watchPosition returned its cleanup (e.g.
    // something else invalidated it reentrantly), don't resurrect it by
    // storing the cleanup as if it were still current — dispose it
    // immediately instead.
    if (watchGenerationRef.current !== generation) {
      clear();
      return;
    }
    clearWatchRef.current = clear;
  }, [geolocationSource, handleFix, handleError, setStatus]);

  const stop = useCallback(() => {
    // Invalidate any in-flight callback from the watch being stopped
    // before disposing it, so a queued callback that the source's own
    // cleanup doesn't synchronously prevent is still rejected.
    watchGenerationRef.current += 1;
    clearWatchRef.current?.();
    clearWatchRef.current = null;
    setStatus("idle");
  }, [setStatus]);

  useEffect(() => {
    return () => {
      watchGenerationRef.current += 1;
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
        setElevationViewMode(restored.elevationViewMode);
        setRestoredCameraState(restored.cameraState);
        setWakeLockDesired(restored.wakeLockDesired);
        setDismissedClimbFeatureId(restored.dismissedClimbFeatureId);
      })
      .catch(() => {
        // No usable stored state; continue with a fresh session.
      });
    return () => {
      cancelled = true;
    };
  }, [route.id]);

  // Persist after every accepted fix or elevation-view-mode change — each
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
        elevationViewMode,
        getCameraState(),
        wakeLockDesired,
        dismissedClimbFeatureId,
      ),
    ).catch(() => {
      // Persistence failure isn't fatal to an in-progress ride; the next
      // successful write will catch the state up.
    });
  }, [
    route.id,
    currentFix,
    coreState,
    elevationViewMode,
    getCameraState,
    wakeLockDesired,
    dismissedClimbFeatureId,
  ]);

  // On visibilitychange/pageshow, mark the current fix stale and restart
  // the watch — but only if it was already running: a genuine reload
  // starts fresh (status "idle") and must wait for an explicit tap,
  // matching the rule that geolocation is never requested at page load.
  useEffect(() => {
    function resumeIfWatching() {
      // Ref read, not the closed-over geolocationStatus state — see the
      // refs' doc comment above for why this matters here.
      if (statusRef.current !== "watching") return;
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
  }, [start, stop]);

  const matchedDistanceFromStartMetres =
    coreState.lastMatch?.distanceFromStartMetres ?? null;
  const presentationDistanceFromStartMetres =
    coreState.lastReliableMatch?.distanceFromStartMetres ?? null;
  const distanceRemainingMetres =
    matchedDistanceFromStartMetres === null
      ? null
      : Math.max(0, route.distanceMetres - matchedDistanceFromStartMetres);

  // Computed once per loaded route (route's identity is stable for the
  // component's lifetime; recomputing per GPS fix would be wasted work for
  // no visible benefit, since the analysis never depends on progress) —
  // this is the same shared, noise-resistant series RidingScreen/
  // PlanningScreen use for the chart line and gradient colours, so the
  // Full marker and the rolling window are placed against the smoothed
  // profile the rider actually sees, not the raw imported samples.
  const elevationDisplayPoints = useMemo(
    () => analyzeRouteElevationProfile(route.points).displayPoints,
    [route],
  );

  const elevationProfileDisplay: ElevationProfileDisplay =
    elevationViewMode.kind === "full"
      ? {
          kind: "full",
          marker:
            presentationDistanceFromStartMetres === null
              ? null
              : buildFullProfileMarker(
                  elevationDisplayPoints,
                  presentationDistanceFromStartMetres,
                ),
        }
      : {
          kind: "upcoming",
          window: selectUpcomingElevationWindow(
            elevationDisplayPoints,
            presentationDistanceFromStartMetres ?? 0,
            elevationViewMode.windowMetres,
          ),
        };

  return {
    geolocationStatus,
    geolocationError,
    currentFix,
    isStale,
    matchedDistanceFromStartMetres,
    presentationDistanceFromStartMetres,
    distanceRemainingMetres,
    offRouteLevel: coreState.offRouteMachineState.level,
    elevationViewMode,
    elevationProfileDisplay,
    setElevationViewMode,
    wakeLockDesired,
    setWakeLockDesired,
    dismissedClimbFeatureId,
    setDismissedClimbFeatureId,
    start,
    restoredCameraState,
  };
}
