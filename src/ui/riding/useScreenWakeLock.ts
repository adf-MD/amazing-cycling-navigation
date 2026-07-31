import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserWakeLockSource,
  type WakeLockHandle,
  type WakeLockSource,
} from "../../platform/wakeLock.ts";
import { systemClock, type Clock } from "../../platform/clock.ts";
import { logError } from "../../platform/errorLog.ts";

export type ScreenWakeLockStatus = "inactive" | "acquiring" | "active" | "unavailable";

export interface UseScreenWakeLockOptions {
  /** The rider's desired on/off preference for this active ride. */
  desired: boolean;
  wakeLockSource?: WakeLockSource;
  clock?: Clock;
}

export interface UseScreenWakeLockResult {
  status: ScreenWakeLockStatus;
  /** Requests a fresh lock. Only has an effect while desired is true and
   * status is "unavailable" — a deliberate retry after a failure. Never
   * auto-invoked by this hook itself. */
  retry: () => void;
}

/**
 * Owns the live Screen Wake Lock sentinel for as long as this hook stays
 * mounted. Callers gate mounting on "ride is active" (see
 * RidingWakeLockControl/RidingScreen), so unmount alone gives "release
 * when Riding mode becomes inactive / the rider leaves the screen / the
 * route is cleared" for free — there is no separate `active` parameter
 * for this hook to track defensively.
 *
 * Mirrors useRideNavigation's geolocation-watch generation-token
 * discipline, but with one real difference: this hook must also
 * auto-reacquire on mount/visibility-return when `desired` is already
 * true (a restored preference), whereas the watch is only ever (re)
 * started from an explicit user tap. That difference is what makes React
 * 18 StrictMode's double-invoked effects a real hazard here — resolved by
 * two deliberately asymmetric pieces below: effect 1 has NO cleanup
 * function on its "still desired" path, and effect 3 (mount/unmount)
 * NEVER calls setStatus. Removing either reintroduces a real bug (a
 * request stuck forever in "acquiring", or a duplicate live request) that
 * the type checker cannot catch — see the trace in this project's plan
 * for the full reasoning before changing this shape.
 */
export function useScreenWakeLock({
  desired,
  wakeLockSource = browserWakeLockSource,
  clock = systemClock,
}: UseScreenWakeLockOptions): UseScreenWakeLockResult {
  const [status, setStatusState] = useState<ScreenWakeLockStatus>("inactive");
  // Mirrors `status` synchronously — every guard below must read this,
  // not the reactive `status` closure value, for the same reason
  // useRideNavigation's statusRef exists (React state updates aren't
  // applied mid-callback).
  const statusRef = useRef<ScreenWakeLockStatus>("inactive");
  const sentinelRef = useRef<WakeLockHandle | null>(null);
  const unsubscribeReleaseRef = useRef<(() => void) | null>(null);
  // Identity token of whichever request() attempt is still "wanted" — an
  // obsolete resolution checks this before touching any state.
  const currentAttemptRef = useRef<object | null>(null);
  const mountedRef = useRef(false);
  const desiredRef = useRef(desired);

  const setStatus = useCallback((next: ScreenWakeLockStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const releaseHandle = useCallback((handle: WakeLockHandle | null) => {
    if (handle) void handle.release().catch(() => undefined);
  }, []);

  const teardownCurrent = useCallback(
    (nextStatus: ScreenWakeLockStatus) => {
      // Unsubscribe before releasing, so a synchronous native "release"
      // fired from inside release() itself can never be double-handled.
      unsubscribeReleaseRef.current?.();
      unsubscribeReleaseRef.current = null;
      const handle = sentinelRef.current;
      sentinelRef.current = null;
      setStatus(nextStatus);
      releaseHandle(handle);
    },
    [releaseHandle, setStatus],
  );

  const beginAttempt = useCallback(() => {
    // Never a second concurrent request, never re-request an
    // already-held lock.
    if (statusRef.current === "acquiring" || statusRef.current === "active") return;

    const token = {};
    currentAttemptRef.current = token;
    setStatus("acquiring");

    wakeLockSource.request().then(
      (handle) => {
        if (currentAttemptRef.current !== token || !mountedRef.current) {
          // Obsolete: superseded (desired flipped off, a new attempt
          // started) or the component is gone. Release it immediately
          // and never attach it to the ride.
          releaseHandle(handle);
          return;
        }
        sentinelRef.current = handle;
        setStatus("active");
        unsubscribeReleaseRef.current = handle.onRelease(() => {
          if (sentinelRef.current !== handle) return; // already torn down deliberately
          sentinelRef.current = null;
          unsubscribeReleaseRef.current = null;
          if (!mountedRef.current) return;
          if (document.visibilityState !== "visible") {
            // Expected: the browser auto-released while hidden. Desired
            // stays true; the visibility effect below silently
            // reacquires once the page is visible again.
            setStatus("inactive");
          } else {
            // Unexpected while still visible: surface the retry state,
            // never auto-loop.
            logError(
              "riding-wake-lock",
              new Error("Wake lock released unexpectedly while visible"),
              clock,
            );
            setStatus("unavailable");
          }
        });
      },
      (error: unknown) => {
        if (currentAttemptRef.current !== token || !mountedRef.current) return;
        logError("riding-wake-lock", error, clock);
        setStatus("unavailable");
      },
    );
  }, [wakeLockSource, clock, releaseHandle, setStatus]);

  // Effect 1 — desired-driven: the only automatic trigger to ACQUIRE.
  useEffect(() => {
    desiredRef.current = desired;
    if (!desired) {
      currentAttemptRef.current = null; // invalidates any pending request
      if (statusRef.current !== "inactive") teardownCurrent("inactive");
      return;
    }
    if (document.visibilityState !== "visible") return; // effect 2 owns hidden -> visible
    beginAttempt();
    // Deliberately no cleanup function on this path — see this hook's
    // own doc comment for why that matters under StrictMode.
  }, [desired, beginAttempt, teardownCurrent]);

  // Effect 2 — visibility: hidden releases defensively; visible
  // reacquires only from a quiescent "inactive", never from
  // "unavailable" — a hide/show cycle must never silently retry a real
  // failure; only a deliberate retry() may.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") {
        if (statusRef.current === "active" || statusRef.current === "acquiring") {
          currentAttemptRef.current = null;
          teardownCurrent("inactive");
        }
        return;
      }
      if (desiredRef.current && statusRef.current === "inactive") {
        beginAttempt();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [beginAttempt, teardownCurrent]);

  // Effect 3 — mount/unmount safety net only. Never calls setStatus — see
  // this hook's own doc comment for why that matters under StrictMode.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      unsubscribeReleaseRef.current?.();
      unsubscribeReleaseRef.current = null;
      releaseHandle(sentinelRef.current);
      sentinelRef.current = null;
    };
  }, [releaseHandle]);

  const retry = useCallback(() => {
    if (!desiredRef.current || statusRef.current !== "unavailable") return;
    beginAttempt();
  }, [beginAttempt]);

  return { status, retry };
}
