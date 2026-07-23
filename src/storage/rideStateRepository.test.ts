import { beforeEach, describe, expect, it } from "vitest";
import { db, type StoredRideState } from "./db.ts";
import {
  clearActiveRideState,
  getActiveRideState,
  setActiveRideState,
} from "./rideStateRepository.ts";

function buildRideState(overrides: Partial<StoredRideState> = {}): StoredRideState {
  return {
    id: "active",
    routeId: "route-1",
    startedAt: new Date(0).toISOString(),
    lastFix: {
      coordinate: [-1.5, 53.8],
      accuracyMetres: 8,
      timestampMs: 0,
    },
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    elevationWindowMetres: 5000,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

describe("rideStateRepository", () => {
  it("returns undefined when no ride is active", async () => {
    await expect(getActiveRideState()).resolves.toBeUndefined();
  });

  it("stores and retrieves the active ride state", async () => {
    const state = buildRideState();
    await setActiveRideState(state);

    await expect(getActiveRideState()).resolves.toEqual(state);
  });

  it("overwrites the previous active ride state on a subsequent set", async () => {
    await setActiveRideState(buildRideState({ matchedDistanceFromStartMetres: 100 }));
    await setActiveRideState(buildRideState({ matchedDistanceFromStartMetres: 250 }));

    const state = await getActiveRideState();
    expect(state?.matchedDistanceFromStartMetres).toBe(250);
  });

  it("clears the active ride state", async () => {
    await setActiveRideState(buildRideState());

    await clearActiveRideState();

    await expect(getActiveRideState()).resolves.toBeUndefined();
  });
});
