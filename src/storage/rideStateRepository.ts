import { db, type StoredRideState } from "./db.ts";

const ACTIVE_RIDE_STATE_ID = "active";

export async function getActiveRideState(): Promise<StoredRideState | undefined> {
  return db.rideState.get(ACTIVE_RIDE_STATE_ID);
}

export async function setActiveRideState(state: StoredRideState): Promise<void> {
  await db.rideState.put(state);
}

export async function clearActiveRideState(): Promise<void> {
  await db.rideState.delete(ACTIVE_RIDE_STATE_ID);
}
