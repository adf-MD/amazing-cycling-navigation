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
  await db.rideState.delete(ACTIVE_RIDE_STATE_ID);
}
