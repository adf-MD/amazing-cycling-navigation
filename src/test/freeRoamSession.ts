import type { StoredFreeRoamRideState } from "../storage/db.ts";
import { setActiveRideState } from "../storage/rideStateRepository.ts";

/**
 * The free-roam session a test opens FreeRoamScreen or useFreeRoamNavigation
 * for (backlog item 140). In the app, App stores this row — or validates
 * it, on Resume — before the screen mounts and owns its identity; the
 * screen adopts only that session, and treats a missing or different one
 * as gone. Tests seed it the same way.
 */
export const OWNED_FREE_ROAM_SESSION_ID = "free-roam-session-owned";

export function ownedFreeRoamRow(
  overrides: Partial<StoredFreeRoamRideState> = {},
): StoredFreeRoamRideState {
  return {
    id: "active",
    kind: "free-roam",
    startedAt: "2026-01-01T08:00:00.000Z",
    sessionId: OWNED_FREE_ROAM_SESSION_ID,
    lastFix: null,
    cameraMode: "overview",
    cameraCoordinate: null,
    cameraZoom: null,
    cameraBearingDegrees: 0,
    cameraPitchDegrees: 0,
    wakeLockDesired: false,
    ...overrides,
  };
}

/** Stores App's row for the owned session, as App does before mounting. */
export async function seedOwnedFreeRoamSession(
  overrides: Partial<StoredFreeRoamRideState> = {},
): Promise<void> {
  await setActiveRideState(ownedFreeRoamRow(overrides));
}
