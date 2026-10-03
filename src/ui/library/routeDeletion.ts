/**
 * A confirmed route deletion (backlog item 124, D-02): the one deletion the
 * Routes screen may have running or just failed. Owned by App through
 * useRouteDeletion.ts, so it survives the Routes screen unmounting — leaving
 * Routes while a deletion runs must not bring the rider back to an ordinary,
 * fully enabled card, and a failure must stay beside its route.
 *
 * - `deleting`: the storage transaction is still running.
 * - `committed`: the transaction has committed, but the live route list may
 *   not reflect it yet. The card keeps showing "Deleting…" until the loaded
 *   list itself no longer contains the route (`reconcileRouteDeletion`), so
 *   a deleted route is never shown as an ordinary card in between.
 * - `failed`: the transaction failed; the route is still stored, and its
 *   confirmation shows the translated failure until the rider dismisses it,
 *   retries, or the route turns out to have been deleted elsewhere.
 *
 * An unconfirmed confirmation is not represented here: RouteLibrary keeps
 * that locally, and leaving Routes still closes it (item 124's D-03).
 *
 * Every transition is pure, guarded by its attempt number so a late result
 * can never change a newer attempt, and returns the same object when it
 * changes nothing, so a caller's state update is then a no-op.
 */
export type RouteDeletionPhase = "deleting" | "committed" | "failed";

export interface RouteDeletion {
  readonly attempt: number;
  readonly routeId: string;
  readonly phase: RouteDeletionPhase;
}

/** Deleting, or committed but not yet reflected by the live list. While
 * busy, the Routes screen refuses a second deletion, pinning and the tag
 * manager, as it always has while a deletion runs. */
export function isRouteDeletionBusy(current: RouteDeletion | null): boolean {
  return current !== null && current.phase !== "failed";
}

export function startRouteDeletion(attempt: number, routeId: string): RouteDeletion {
  return { attempt, routeId, phase: "deleting" };
}

export function markRouteDeletionCommitted(
  current: RouteDeletion | null,
  attempt: number,
): RouteDeletion | null {
  if (current?.attempt !== attempt || current.phase !== "deleting") return current;
  return { ...current, phase: "committed" };
}

export function markRouteDeletionFailed(
  current: RouteDeletion | null,
  attempt: number,
): RouteDeletion | null {
  if (current?.attempt !== attempt || current.phase !== "deleting") return current;
  return { ...current, phase: "failed" };
}

/** The rider dismissed this failed attempt: Cancel or Escape on its
 * confirmation, or another action on its card that closes it. A running or
 * committed deletion is never dismissed. */
export function dismissRouteDeletion(
  current: RouteDeletion | null,
  attempt: number,
): RouteDeletion | null {
  if (current?.attempt !== attempt || current.phase !== "failed") return current;
  return null;
}

/** The loaded live list no longer contains this attempt's route: a
 * committed deletion is now reflected, or a failed one's route was deleted
 * elsewhere. The caller establishes the absence; a running deletion is never
 * cleared by it. */
export function reconcileRouteDeletion(
  current: RouteDeletion | null,
  attempt: number,
): RouteDeletion | null {
  if (current?.attempt !== attempt || current.phase === "deleting") return current;
  return null;
}

/** A newer interaction supersedes a failed deletion's confirmation (a route
 * card's switch prompt appearing). Never clears a running or committed one. */
export function clearFailedRouteDeletion(
  current: RouteDeletion | null,
): RouteDeletion | null {
  return current?.phase === "failed" ? null : current;
}
