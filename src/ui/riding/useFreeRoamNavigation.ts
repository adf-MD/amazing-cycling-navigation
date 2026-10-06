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
  clearActiveRideStateIfSession,
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import { logError } from "../../platform/errorLog.ts";
import type { RideFinishOutcome } from "./useRideNavigation.ts";

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
  /** This free roam's session identity — the App-owned id it was opened
   * with (backlog item 140). Read in event handlers only. */
  getSessionId: () => string | null;
  /** The shared End ride finaliser — see useRideNavigation.ts's own
   * `finish` doc comment; this mirrors it, clearing only the session with
   * `expectedSessionId`. App stored this session before the screen
   * mounted, so a missing or different stored session is always
   * "session-gone" here, never a session that was never stored. */
  finish: (expectedSessionId: string | null) => Promise<RideFinishOutcome>;
  /** True once the mount restore read has found the App-owned session
   * missing, or another session stored in its place (backlog item 140).
   * The hook has then stopped and retired, writing nothing, and the
   * screen hands back to the Ride launcher. */
  sessionGone: boolean;
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

/** Where the mount restore read stands: still "pending"; "adopted" (the
 * App-owned session found and restored); "gone" (no stored session, or a
 * different one); or "failed" (the read itself failed — not evidence of
 * either). */
type FreeRoamRestoration = "pending" | "adopted" | "gone" | "failed";

export interface UseFreeRoamNavigationOptions {
  /** The session App opened this free roam for (backlog item 140): App
   * writes it — or validates it, on Resume — before the screen mounts, and
   * owns its identity. Every write and the End ride clear use it; it is
   * never minted here. */
  sessionId: string;
  geolocationSource?: GeolocationSource;
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
  options: UseFreeRoamNavigationOptions,
): FreeRoamNavigationState {
  const geolocationSource = options.geolocationSource ?? browserGeolocationSource;
  const ownedSessionId = options.sessionId;
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
  // Adopted, with the rest of the session, from App's stored row.
  const startedAtRef = useRef<string | null>(null);
  // This session's identity: the App-owned id (backlog item 140), never
  // minted or replaced here.
  const sessionIdRef = useRef<string>(ownedSessionId);
  // The mount restore read's outcome (backlog item 140). This screen
  // starts its watch on mount, so a fix can arrive before that read
  // settles; nothing is persisted until the App-owned session has been
  // found and adopted. If it is missing or another session is stored in
  // its place, that session is gone: nothing is written, not even on the
  // next fix, and the screen hands back to the Ride launcher. "failed" is
  // not evidence either way, so after a failed read nothing is written,
  // while End ride still clears only the owned session. The promise lets
  // pause() wait for the same outcome.
  const [restoration, setRestoration] = useState<FreeRoamRestoration>("pending");
  const restorationRef = useRef<Promise<FreeRoamRestoration> | null>(null);
  // As in useRideNavigation.ts: bumped as finish() begins, cancelling any
  // write not yet issued.
  const persistenceEpochRef = useRef(0);
  // Set once this session has ended, been found gone, or been refused as
  // gone: the hook never starts, persists or pauses again.
  const isRetiredRef = useRef(false);
  // Set by the first live fix. The restore read can settle after it — this
  // screen starts watching on mount — and must not then replace that fresh
  // position with the stored one (App's new row stores none at all).
  const hasLiveFixRef = useRef(false);
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
      hasLiveFixRef.current = true;
      setCurrentFix(fix);
      setIsStale(false);
      setStatus("watching");
      setGeolocationError(null);
    },
    [setStatus],
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
    if (isRetiredRef.current) return;

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

  const getSessionId = useCallback(() => sessionIdRef.current, []);

  const finish = useCallback(
    async (expectedSessionId: string | null): Promise<RideFinishOutcome> => {
      // Deliberately does not also check isPausingRef here — see
      // isFinalizingRef's own declaration comment above for why (a
      // react-hooks/immutability lint constraint) and why the asymmetry is
      // safe in practice.
      if (isFinalizingRef.current || isRetiredRef.current) return "ignored";
      if (expectedSessionId === null || expectedSessionId !== sessionIdRef.current) {
        return "ignored";
      }
      isFinalizingRef.current = true;
      // Any of this session's writes not yet issued is cancelled from here.
      persistenceEpochRef.current += 1;
      let outcome: "cleared" | "missing" | "changed";
      try {
        outcome = await clearActiveRideStateIfSession(expectedSessionId);
      } catch (error) {
        isFinalizingRef.current = false;
        throw error;
      }
      stop();
      isRetiredRef.current = true;
      // App stored this session before the screen mounted, so missing or
      // changed means ended or replaced elsewhere: nothing was deleted, and
      // isFinalizingRef stays set so nothing is persisted again.
      if (outcome !== "cleared") return "session-gone";
      startedAtRef.current = null;
      setCurrentFix(null);
      setIsStale(false);
      setGeolocationError(null);
      setWakeLockDesired(false);
      setRestoredCameraState(null);
      setRestoredLastReliableBearingDegrees(null);
      isFinalizingRef.current = false;
      return "ended";
    },
    [stop],
  );

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
    if (isPausingRef.current || isFinalizingRef.current || isRetiredRef.current) return;
    isPausingRef.current = true;
    try {
      // A Pause in the restore read's first milliseconds waits for it.
      // Only the adopted App-owned session is ever written: after a failed
      // read, or once that session is gone, Pause saves nothing over
      // whatever is stored. Once the read has settled nothing is awaited
      // here, so the write below is issued synchronously, exactly as before.
      const restored =
        restoration === "pending" ? await restorationRef.current : restoration;
      if (restored !== "adopted" || startedAtRef.current === null) {
        throw new Error("The stored free-roam session is not available to save");
      }
      const snapshot = getPersistableSnapshot();
      const epoch = persistenceEpochRef.current;
      const written = await setActiveRideState(
        toStoredFreeRoamState(
          startedAtRef.current,
          sessionIdRef.current,
          currentFix,
          snapshot.cameraState,
          snapshot.lastReliableBearingDegrees,
          wakeLockDesired,
        ),
        { isCancelled: () => persistenceEpochRef.current !== epoch },
      );
      if (!written) {
        // An End began while this write was still waiting to be issued; it
        // was dropped, and the End takes over.
        isPausingRef.current = false;
        return;
      }
    } catch (error) {
      isPausingRef.current = false;
      throw error;
    }
    stop();
    isPausingRef.current = false;
  }, [currentFix, getPersistableSnapshot, restoration, wakeLockDesired, stop]);

  useEffect(() => {
    return () => {
      watchGenerationRef.current += 1;
      clearWatchRef.current?.();
    };
  }, []);

  // Restore once on mount. App keys FreeRoamScreen by the session it
  // owns, and fully unmounts it on any change to which ride content is
  // shown, so a fresh mount always means a fresh restore of that session.
  // Only App's own session is adopted (backlog item 140): it was stored
  // before this screen mounted, so finding none, or another session in its
  // place, means it is gone — this hook then stops and retires, writing
  // nothing, and the screen hands back to the Ride launcher.
  useEffect(() => {
    let cancelled = false;
    const outcome = getActiveRideState().then(
      (stored): FreeRoamRestoration => {
        if (
          !stored ||
          !isStoredFreeRoamRideState(stored) ||
          stored.sessionId !== ownedSessionId
        ) {
          if (!cancelled) {
            isRetiredRef.current = true;
            persistenceEpochRef.current += 1;
            stop();
          }
          return "gone";
        }
        if (cancelled) return "adopted";
        const restored = fromStoredFreeRoamState(stored);
        startedAtRef.current = stored.startedAt;
        if (!hasLiveFixRef.current) {
          setCurrentFix(restored.lastFix);
          setIsStale(restored.lastFix !== null);
        }
        setRestoredCameraState(restored.cameraState);
        setRestoredLastReliableBearingDegrees(restored.lastReliableBearingDegrees);
        setWakeLockDesired(restored.wakeLockDesired);
        return "adopted";
      },
      (error: unknown): FreeRoamRestoration => {
        if (!cancelled) logError("free-roam-restore", error);
        return "failed";
      },
    );
    restorationRef.current = outcome;
    void outcome.then((settled) => {
      if (!cancelled) setRestoration(settled);
    });
    return () => {
      cancelled = true;
    };
  }, [ownedSessionId, stop]);

  // Persist after every accepted fix — mirrors useRideNavigation's own
  // persistence effect, including the isFinalizingRef/isPausingRef guards,
  // but writes only once App's own session has been adopted (backlog item
  // 140; see restoration above), and never after it has ended or gone.
  useEffect(() => {
    if (isFinalizingRef.current || isPausingRef.current || isRetiredRef.current) return;
    if (restoration !== "adopted" || currentFix === null) return;
    if (startedAtRef.current === null) return;
    const snapshot = getPersistableSnapshot();
    const epoch = persistenceEpochRef.current;
    setActiveRideState(
      toStoredFreeRoamState(
        startedAtRef.current,
        sessionIdRef.current,
        currentFix,
        snapshot.cameraState,
        snapshot.lastReliableBearingDegrees,
        wakeLockDesired,
      ),
      { isCancelled: () => persistenceEpochRef.current !== epoch },
    ).catch(() => {
      // Persistence failure isn't fatal to an in-progress session; the next
      // successful write will catch the state up.
    });
  }, [currentFix, getPersistableSnapshot, restoration, wakeLockDesired]);

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
    getSessionId,
    finish,
    pause,
    restoredCameraState,
    restoredLastReliableBearingDegrees,
    sessionGone: restoration === "gone",
  };
}
