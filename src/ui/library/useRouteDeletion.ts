import { useCallback, useMemo, useRef, useState } from "react";
import { logError } from "../../platform/errorLog.ts";
import { deleteRoute } from "../../storage/routesRepository.ts";
import {
  clearFailedRouteDeletion,
  dismissRouteDeletion,
  isRouteDeletionBusy,
  markRouteDeletionCommitted,
  markRouteDeletionFailed,
  reconcileRouteDeletion,
  startRouteDeletion,
  type RouteDeletion,
} from "./routeDeletion.ts";

/** What the Routes screen needs from the confirmed deletion's owner (backlog
 * item 124, D-02). See routeDeletion.ts for the lifecycle itself. */
export interface RouteDeletionController {
  readonly deletion: RouteDeletion | null;
  /** Starts deleting `routeId` and returns the new attempt's number, or
   * null — starting nothing — while another deletion is busy. */
  start(routeId: string): number | null;
  /** Dismisses a failed attempt; ignored for any other attempt or phase. */
  dismiss(attempt: number): void;
  /** Clears a committed or failed attempt once the caller has seen the
   * loaded live list without its route. */
  reconcile(attempt: number): void;
  /** Clears a failed attempt, whichever route it was for. */
  clearFailed(): void;
  /** Whether a deletion of this route is running or awaiting the list —
   * read synchronously, so it is current even within one batch. */
  isBusyFor(routeId: string): boolean;
}

// Module-level, so attempts from two instances (App's, and a standalone
// RouteLibrary's own in its component tests) can never share a number. A
// plain monotonic counter, never a timestamp or a random id, as elsewhere.
let nextAttempt = 0;

/**
 * The confirmed deletion's owner. App calls this once, so the deletion
 * outlives the Routes screen; a RouteLibrary rendered without App owns one
 * itself. Holds no effects: an idle instance does nothing.
 *
 * Every change goes through `update`, which computes the next value from a
 * synchronous ref — outside any state updater, so nothing runs twice under
 * Strict Mode — and stores both. That ref is the admission check, so a
 * second Delete route press landing in the same batch as the first starts
 * nothing, which a state value read from a render could not guarantee.
 *
 * The outcome is recorded whether or not the Routes screen is still mounted,
 * and a failure is always logged here (`route-delete`, redacted by the error
 * log), so leaving Routes neither loses the result nor the diagnostic.
 */
export function useRouteDeletion(): RouteDeletionController {
  const [deletion, setDeletion] = useState<RouteDeletion | null>(null);
  const deletionRef = useRef<RouteDeletion | null>(null);

  const update = useCallback(
    (transition: (current: RouteDeletion | null) => RouteDeletion | null) => {
      const next = transition(deletionRef.current);
      if (next === deletionRef.current) return;
      deletionRef.current = next;
      setDeletion(next);
    },
    [],
  );

  const start = useCallback(
    (routeId: string): number | null => {
      if (isRouteDeletionBusy(deletionRef.current)) return null;
      nextAttempt += 1;
      const attempt = nextAttempt;
      update(() => startRouteDeletion(attempt, routeId));
      deleteRoute(routeId).then(
        () => {
          update((current) => markRouteDeletionCommitted(current, attempt));
        },
        (error: unknown) => {
          logError("route-delete", error);
          update((current) => markRouteDeletionFailed(current, attempt));
        },
      );
      return attempt;
    },
    [update],
  );

  const dismiss = useCallback(
    (attempt: number) => {
      update((current) => dismissRouteDeletion(current, attempt));
    },
    [update],
  );

  const reconcile = useCallback(
    (attempt: number) => {
      update((current) => reconcileRouteDeletion(current, attempt));
    },
    [update],
  );

  const clearFailed = useCallback(() => {
    update(clearFailedRouteDeletion);
  }, [update]);

  const isBusyFor = useCallback((routeId: string) => {
    const current = deletionRef.current;
    return isRouteDeletionBusy(current) && current?.routeId === routeId;
  }, []);

  return useMemo(
    () => ({ deletion, start, dismiss, reconcile, clearFailed, isBusyFor }),
    [deletion, start, dismiss, reconcile, clearFailed, isBusyFor],
  );
}
