import { beforeEach, describe, expect, it } from "vitest";
import { db, type StoredRouteRideState } from "./db.ts";
import { isStoredRouteRideState } from "./mapping.ts";
import {
  clearActiveRideState,
  getActiveRideState,
  setActiveRideState,
} from "./rideStateRepository.ts";

// Typed as Partial<StoredRouteRideState>, not Partial<StoredRideState> —
// TypeScript's Partial<> doesn't distribute over a union, so it would only
// allow overriding fields common to both StoredRouteRideState and
// StoredFreeRoamRideState (see src/storage/db.ts), silently rejecting e.g.
// matchedDistanceFromStartMetres below.
function buildRideState(
  overrides: Partial<StoredRouteRideState> = {},
): StoredRouteRideState {
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
    expect(
      state && isStoredRouteRideState(state)
        ? state.matchedDistanceFromStartMetres
        : null,
    ).toBe(250);
  });

  it("clears the active ride state", async () => {
    await setActiveRideState(buildRideState());

    await clearActiveRideState();

    await expect(getActiveRideState()).resolves.toBeUndefined();
  });
});
