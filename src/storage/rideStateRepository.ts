import { generateId } from "../platform/idGenerator.ts";
import { db, type StoredRideState } from "./db.ts";

const ACTIVE_RIDE_STATE_ID = "active";

declare global {
  interface Window {
    /** Test-only seam (backlog item 68): awaited immediately before the
     * persistence write below, so a Playwright e2e test can hold a Pause
     * write open long enough to assert the wide "Pausing…" pending label
     * deterministically, instead of racing a naturally fast transient
     * state or adding a fixed sleep. Unlike navigator.wakeLock or a
     * network request, IndexedDB has no request/network boundary
     * Playwright can intercept from outside the page, so this narrow,
     * always-inert-by-default hook is the smallest reliable alternative.
     * Never set outside an e2e test's own `page.addInitScript` — for
     * every real session this property is undefined, so the guarded call
     * below is skipped entirely rather than merely resolved, adding no
     * extra microtask tick to this hot persistence path. */
    __acnE2eRideStateWriteDelay?: () => Promise<void>;
    /** Test-only seam (backlog item 73): when set and it returns an Error,
     * clearActiveRideState() throws that error instead of performing the
     * real delete — lets a Playwright e2e test deterministically exercise
     * a genuine storage-clear failure and its retry, without faking the
     * whole IndexedDB layer. Mirrors __acnE2eRideStateWriteDelay's exact
     * contract: never set outside an e2e test's own page.addInitScript,
     * always undefined for a real session, so the guarded call below adds
     * no overhead to this hot finalisation path in production. */
    __acnE2eRideStateClearFailure?: () => Error | undefined;
  }
}

export async function getActiveRideState(): Promise<StoredRideState | undefined> {
  return db.rideState.get(ACTIVE_RIDE_STATE_ID);
}

export async function setActiveRideState(state: StoredRideState): Promise<void> {
  const testDelay = window.__acnE2eRideStateWriteDelay;
  if (testDelay) {
    await testDelay();
  }
  await db.rideState.put(state);
}

export async function clearActiveRideState(): Promise<void> {
  const testFailure = window.__acnE2eRideStateClearFailure?.();
  if (testFailure) {
    throw testFailure;
  }
  await db.rideState.delete(ACTIVE_RIDE_STATE_ID);
}

/** A stored session together with the identity a confirmation anchors to. */
export type IdentifiedStoredRideState = StoredRideState & { sessionId: string };

/**
 * Reads the stored session for the Ride launcher (backlog item 140),
 * giving a row without a `sessionId` one first. The read and the
 * assignment happen in one read-write transaction, so the identity
 * returned belongs to exactly the row returned: an End ride or Discard the
 * launcher then offers is anchored to that session and no other.
 *
 * A row lacks an id when it was written before the field existed, or when
 * another window rewrote it without one. Every other field is kept as
 * stored, an unsupported row's unknown ones included; a row that already
 * has an id is never written. A failed write rejects like a failed read:
 * the session cannot be anchored, so nothing is offered for it.
 */
export async function getActiveRideStateWithSessionId(): Promise<
  IdentifiedStoredRideState | undefined
> {
  return db.transaction("rw", db.rideState, async () => {
    const stored = await db.rideState.get(ACTIVE_RIDE_STATE_ID);
    if (!stored) return undefined;
    if (typeof stored.sessionId === "string") {
      return { ...stored, sessionId: stored.sessionId };
    }
    const identified: IdentifiedStoredRideState = { ...stored, sessionId: generateId() };
    await db.rideState.put(identified);
    return identified;
  });
}

/** What a conditional clear found: the session it was given ("cleared"),
 * no session ("missing"), or a different one, left untouched ("changed"). */
export type ConditionalRideStateClearResult = "cleared" | "missing" | "changed";

/**
 * Clears the stored session only if it is the one with `sessionId`
 * (backlog item 140): a confirmation may clear only the session it
 * represents. The check and the delete happen in one read-write
 * transaction, so no other write to the store can land between them — a
 * fresh read followed by an unconditional delete would still leave that
 * window. A row without an id is never the session asked for: the
 * launcher's own read gives it one before offering any confirmation.
 *
 * Honours the same __acnE2eRideStateClearFailure seam as
 * clearActiveRideState(), so a failure behaves exactly as it did before.
 */
export async function clearActiveRideStateIfSession(
  sessionId: string,
): Promise<ConditionalRideStateClearResult> {
  const testFailure = window.__acnE2eRideStateClearFailure?.();
  if (testFailure) {
    throw testFailure;
  }
  return db.transaction("rw", db.rideState, async () => {
    const stored = await db.rideState.get(ACTIVE_RIDE_STATE_ID);
    if (!stored) return "missing";
    if (stored.sessionId !== sessionId) return "changed";
    await db.rideState.delete(ACTIVE_RIDE_STATE_ID);
    return "cleared";
  });
}
