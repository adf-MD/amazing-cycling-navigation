import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserGeolocationSource,
  type GeolocationError,
  type GeolocationFix,
  type GeolocationSource,
  type GeolocationWatchStatus,
} from "../../platform/geolocation.ts";
import {
  fromStoredFreeRoamState,
  isStoredFreeRoamRideState,
  toStoredFreeRoamState,
  type StoredCameraState,
} from "../../storage/mapping.ts";
import {
  clearActiveRideState,
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import { systemClock, type Clock } from "../../platform/clock.ts";

export interface FreeRoamNavigationState {
  geolocationStatus: GeolocationWatchStatus;
  geolocationError: GeolocationError | null;
  currentFix: GeolocationFix | null;
  isStale: boolean;
  /** The rider's desired wake-lock preference for this active free-roam
   * session only — never a global setting; restored/persisted exactly like
   * useRideNavigation's own identically-named field. */
  wakeLockDesired: boolean;
  setWakeLockDesired: (next: boolean) => void;
  start: () => void;
  /** The shared End ride finaliser — see useRideNavigation.ts's own
   * `finish` doc comment for the full race-safety rationale; this mirrors
   * it exactly (clear storage first, only then reset in-memory state). */
  finish: () => Promise<void>;
  /** The reversible counterpart to finish() (backlog item 55) — mirrors
   * useRideNavigation.ts's own `pause` doc comment exactly, using
   * getPersistableSnapshot() for a fresh camera+bearing read at call time. */
  pause: () => Promise<void>;
  /** Non-null only once a persisted camera state for this free-roam
   * session has actually been restored. */
  restoredCameraState: StoredCameraState | null;
  /** Non-null only once a persisted last-reliable-bearing has actually been
   * restored — see StoredFreeRoamRideState.lastReliableBearingDegrees. */
  restoredLastReliableBearingDegrees: number | null;
}

const DEFAULT_CAMERA_STATE: StoredCameraState = {
  mode: "overview",
  coordinate: null,
  zoom: null,
  bearingDegrees: 0,
  pitchDegrees: 0,
};

function defaultGetPersistableSnapshot(): {
  cameraState: StoredCameraState;
  lastReliableBearingDegrees: number | null;
} {
  return { cameraState: DEFAULT_CAMERA_STATE, lastReliableBearingDegrees: null };
}

export interface UseFreeRoamNavigationOptions {
  geolocationSource?: GeolocationSource;
  clock?: Clock;
  /** Called only when about to persist (an accepted fix), reading whatever
   * useFreeRoamCamera's latest camera state and last-reliable-bearing are
   * at that moment — bundled into one getter (not two) since both values
   * flow from the same camera hook and are needed together on every
   * persistence write. Mirrors useRideNavigation's own getCameraState
   * option: both hooks are called in the same render, and the camera hook
   * needs this hook's restoredCameraState/restoredLastReliableBearingDegrees
   * as inputs, so neither can feed the other's *current* render output back
   * into its own call — a stable function reading a ref avoids that
   * without a setState-in-effect bridge. */
  getPersistableSnapshot?: () => {
    cameraState: StoredCameraState;
    lastReliableBearingDegrees: number | null;
  };
}

/**
 * Route-less "free roam" counterpart to useRideNavigation.ts — a
 * deliberately separate hook, not a `route: PlannedRoute | null`
 * parameterisation of that one. The watch-lifecycle machinery below
 * (generation token, statusRef, isFinalizingRef, start/stop, the
 * visibilitychange/pageshow effect, the persistence-effect's guard
 * structure) is copied from useRideNavigation.ts near-verbatim, since it
 * has zero coupling to a route there either — only route-matching
 * (processFix), elevation, and climb/completion state are genuinely
 * route-shaped, and none of that exists here.
 */
export function useFreeRoamNavigation(
  options: UseFreeRoamNavigationOptions = {},
): FreeRoamNavigationState {
  const geolocationSource = options.geolocationSource ?? browserGeolocationSource;
  const clock = options.clock ?? systemClock;
  const getPersistableSnapshot =
    options.getPersistableSnapshot ?? defaultGetPersistableSnapshot;

  const [geolocationStatus, setGeolocationStatus] =
    useState<GeolocationWatchStatus>("idle");
  const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null);
  const [currentFix, setCurrentFix] = useState<GeolocationFix | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [restoredCameraState, setRestoredCameraState] =
    useState<StoredCameraState | null>(null);
  const [restoredLastReliableBearingDegrees, setRestoredLastReliableBearingDegrees] =
    useState<number | null>(null);
  const [wakeLockDesired, setWakeLockDesired] = useState(false);

  const clearWatchRef = useRef<(() => void) | null>(null);
  // See useRideNavigation.ts's identical field for the full rationale —
  // copied verbatim, since none of it is route-specific.
  const watchGenerationRef = useRef(0);
  const statusRef = useRef<GeolocationWatchStatus>("idle");
  const startedAtRef = useRef<string | null>(null);
  // Also read (never written) by pause() below, so a Pause attempt is
  // blocked while a Finish/End finalisation is in flight — finish() does
  // NOT symmetrically read isPausingRef in return; see that ref's own
  // declaration comment (mirrors useRideNavigation.ts's identical
  // asymmetry and rationale exactly — a react-hooks/immutability lint
  // constraint, safe because the hook-level guard is only ever a
  // defensive backstop beneath FreeRoamScreen's own primary,
  // bidirectional cross-guard).
  const isFinalizingRef = useRef(false);

  const setStatus = useCallback((next: GeolocationWatchStatus) => {
    statusRef.current = next;
    setGeolocationStatus(next);
  }, []);

  const handleFix = useCallback(
    (fix: GeolocationFix) => {
      startedAtRef.current ??= new Date(clock.now()).toISOString();
      setCurrentFix(fix);
      setIsStale(false);
      setStatus("watching");
      setGeolocationError(null);
    },
    [clock, setStatus],
  );

  const handleError = useCallback(
    (nextError: GeolocationError) => {
      setGeolocationError(nextError);
      setIsStale(true);
      setStatus("error");
    },
    [setStatus],
  );

  const start = useCallback(() => {
    if (statusRef.current === "watching") return;

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

    if (watchGenerationRef.current !== generation) {
      clear();
      return;
    }
    clearWatchRef.current = clear;
  }, [geolocationSource, handleFix, handleError, setStatus]);

  const stop = useCallback(() => {
    watchGenerationRef.current += 1;
    clearWatchRef.current?.();
    clearWatchRef.current = null;
    setStatus("idle");
  }, [setStatus]);

  const finish = useCallback(async () => {
    // Deliberately does not also check isPausingRef here — see
    // isFinalizingRef's own declaration comment above for why (a
    // react-hooks/immutability lint constraint) and why the asymmetry is
    // safe in practice.
    if (isFinalizingRef.current) return;
    isFinalizingRef.current = true;
    try {
      await clearActiveRideState();
    } catch (error) {
      isFinalizingRef.current = false;
      throw error;
    }
    stop();
    startedAtRef.current = null;
    setCurrentFix(null);
    setIsStale(false);
    setGeolocationError(null);
    setWakeLockDesired(false);
    setRestoredCameraState(null);
    setRestoredLastReliableBearingDegrees(null);
    isFinalizingRef.current = false;
  }, [stop]);

  // See useRideNavigation.ts's identical field for the full rationale —
  // copied verbatim, since none of it is route-specific (backlog item 55).
  const isPausingRef = useRef(false);

  // The reversible counterpart to finish() — mirrors
  // useRideNavigation.ts's own pause() exactly, using
  // getPersistableSnapshot() for a fresh camera+bearing read at call time.
  // Free roam's row already exists pre-mount (RidingLauncher's own
  // "Start free roam" seed), but this still needs to run to write the
  // *final* current snapshot (position, camera, wake-lock preference)
  // over that initial row before stopping the watch.
  const pause = useCallback(async () => {
    if (isPausingRef.current || isFinalizingRef.current) return;
    isPausingRef.current = true;
    try {
      startedAtRef.current ??= new Date(clock.now()).toISOString();
      const snapshot = getPersistableSnapshot();
      await setActiveRideState(
        toStoredFreeRoamState(
          startedAtRef.current,
          currentFix,
          snapshot.cameraState,
          snapshot.lastReliableBearingDegrees,
          wakeLockDesired,
        ),
      );
    } catch (error) {
      isPausingRef.current = false;
      throw error;
    }
    stop();
    isPausingRef.current = false;
  }, [clock, currentFix, getPersistableSnapshot, wakeLockDesired, stop]);

  useEffect(() => {
    return () => {
      watchGenerationRef.current += 1;
      clearWatchRef.current?.();
    };
  }, []);

  // Restore once on mount — no varying identity to key on (unlike
  // useRideNavigation's route.id), and this is safe because App.tsx's
  // conditional render always fully unmounts FreeRoamScreen on any change
  // to which ride content is shown (no `key` prop anywhere in its JSX), so
  // a fresh mount always means a fresh restore attempt.
  useEffect(() => {
    let cancelled = false;
    getActiveRideState()
      .then((stored) => {
        if (cancelled || !stored || !isStoredFreeRoamRideState(stored)) return;
        const restored = fromStoredFreeRoamState(stored);
        startedAtRef.current = stored.startedAt;
        setCurrentFix(restored.lastFix);
        setIsStale(restored.lastFix !== null);
        setRestoredCameraState(restored.cameraState);
        setRestoredLastReliableBearingDegrees(restored.lastReliableBearingDegrees);
        setWakeLockDesired(restored.wakeLockDesired);
      })
      .catch(() => {
        // No usable stored state; continue with a fresh session.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist after every accepted fix — mirrors useRideNavigation's own
  // persistence effect exactly, including the isFinalizingRef/isPausingRef
  // guards.
  useEffect(() => {
    if (isFinalizingRef.current || isPausingRef.current) return;
    if (currentFix === null || startedAtRef.current === null) return;
    const snapshot = getPersistableSnapshot();
    setActiveRideState(
      toStoredFreeRoamState(
        startedAtRef.current,
        currentFix,
        snapshot.cameraState,
        snapshot.lastReliableBearingDegrees,
        wakeLockDesired,
      ),
    ).catch(() => {
      // Persistence failure isn't fatal to an in-progress session; the next
      // successful write will catch the state up.
    });
  }, [currentFix, getPersistableSnapshot, wakeLockDesired]);

  // On visibilitychange/pageshow, mark the current fix stale and restart
  // the watch — but only if it was already running. Identical policy and
  // rationale to useRideNavigation.ts's own equivalent effect.
  useEffect(() => {
    function resumeIfWatching() {
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

  return {
    geolocationStatus,
    geolocationError,
    currentFix,
    isStale,
    wakeLockDesired,
    setWakeLockDesired,
    start,
    finish,
    pause,
    restoredCameraState,
    restoredLastReliableBearingDegrees,
  };
}
