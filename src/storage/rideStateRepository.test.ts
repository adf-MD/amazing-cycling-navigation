import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type StoredFreeRoamRideState, type StoredRouteRideState } from "./db.ts";
import { isStoredRouteRideState } from "./mapping.ts";
import {
  clearActiveRideState,
  clearActiveRideStateIfSession,
  getActiveRideState,
  getActiveRideStateWithSessionId,
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

function buildFreeRoamState(
  overrides: Partial<StoredFreeRoamRideState> = {},
): StoredFreeRoamRideState {
  return {
    id: "active",
    kind: "free-roam",
    startedAt: new Date(60_000).toISOString(),
    lastFix: null,
    ...overrides,
  };
}

describe("getActiveRideStateWithSessionId (item 140)", () => {
  it("returns undefined, storing nothing, when no ride is active", async () => {
    await expect(getActiveRideStateWithSessionId()).resolves.toBeUndefined();
    await expect(getActiveRideState()).resolves.toBeUndefined();
  });

  it("returns a row that already has an identity as stored, without writing", async () => {
    const identified = buildRideState({ sessionId: "session-1" });
    await setActiveRideState(identified);
    const putSpy = vi.spyOn(db.rideState, "put");

    await expect(getActiveRideStateWithSessionId()).resolves.toEqual(identified);
    await expect(getActiveRideStateWithSessionId()).resolves.toEqual(identified);

    expect(putSpy).not.toHaveBeenCalled();
    await expect(getActiveRideState()).resolves.toEqual(identified);
  });

  it("gives a row without an identity one, stored with every other field kept", async () => {
    const legacy = buildRideState();
    await setActiveRideState(legacy);

    const read = await getActiveRideStateWithSessionId();

    if (!read) throw new Error("expected the stored row");
    const { sessionId, ...rest } = read;
    expect(typeof sessionId).toBe("string");
    expect(sessionId).not.toBe("");
    expect(rest).toEqual(legacy);
    await expect(getActiveRideState()).resolves.toEqual(read);
    // A second read keeps that identity and writes nothing more.
    const putSpy = vi.spyOn(db.rideState, "put");
    await expect(getActiveRideStateWithSessionId()).resolves.toEqual(read);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("keeps an unsupported row's unknown fields when giving it an identity", async () => {
    const unsupported = {
      ...buildRideState(),
      kind: "training-session",
      trainingZones: [{ name: "Z2", minutes: 40 }],
    };
    await db.rideState.put(unsupported);

    const read = await getActiveRideStateWithSessionId();

    if (!read) throw new Error("expected the stored row");
    const { sessionId, ...rest } = read;
    expect(typeof sessionId).toBe("string");
    expect(rest).toEqual(unsupported);
    await expect(getActiveRideState()).resolves.toEqual(read);
  });

  it("gives two rows without an identity, stored one after the other, different identities", async () => {
    await setActiveRideState(buildRideState());
    const first = await getActiveRideStateWithSessionId();
    await setActiveRideState(buildRideState());
    const second = await getActiveRideStateWithSessionId();

    expect(first?.sessionId).toEqual(expect.any(String));
    expect(second?.sessionId).toEqual(expect.any(String));
    expect(second?.sessionId).not.toBe(first?.sessionId);
  });
});

describe("clearActiveRideStateIfSession (item 140)", () => {
  afterEach(() => {
    delete window.__acnE2eRideStateClearFailure;
  });

  it("clears the session it is given", async () => {
    await setActiveRideState(buildRideState({ sessionId: "session-1" }));

    await expect(clearActiveRideStateIfSession("session-1")).resolves.toBe("cleared");

    await expect(getActiveRideState()).resolves.toBeUndefined();
  });

  it("reports a missing session, deleting nothing", async () => {
    await expect(clearActiveRideStateIfSession("session-1")).resolves.toBe("missing");
  });

  it("leaves a newer session on the same route untouched", async () => {
    const newer = buildRideState({
      sessionId: "session-2",
      matchedDistanceFromStartMetres: 0,
    });
    await setActiveRideState(newer);

    await expect(clearActiveRideStateIfSession("session-1")).resolves.toBe("changed");

    await expect(getActiveRideState()).resolves.toEqual(newer);
  });

  it("leaves a row without an identity untouched, even one identical in every other field to the session asked for", async () => {
    const legacy = buildRideState();
    await setActiveRideState(legacy);
    const presented = await getActiveRideStateWithSessionId();
    if (!presented) throw new Error("expected the presented row");
    // Another window replaces it with a row that has no identity and
    // shares the presented row's route, start time and everything else.
    await db.rideState.put(legacy);

    await expect(clearActiveRideStateIfSession(presented.sessionId)).resolves.toBe(
      "changed",
    );

    await expect(getActiveRideState()).resolves.toEqual(legacy);
  });

  it("fails through the existing clear-failure seam, leaving the row stored", async () => {
    const stored = buildRideState({ sessionId: "session-1" });
    await setActiveRideState(stored);
    const failure = new Error("synthetic clear failure");
    window.__acnE2eRideStateClearFailure = () => failure;

    await expect(clearActiveRideStateIfSession("session-1")).rejects.toBe(failure);

    await expect(getActiveRideState()).resolves.toEqual(stored);
  });

  it("checks and deletes in one transaction: a write started after its read lands after its delete", async () => {
    await setActiveRideState(buildRideState({ sessionId: "session-1" }));
    const newer = buildFreeRoamState({ sessionId: "session-2" });
    // When the clear's own read of the store succeeds, start a competing
    // write outside its transaction and keep the promise, never awaiting it
    // there: overlapping read-write transactions are serialised, so the
    // competing write can only run before the clear's transaction or after
    // it — never between its check and its delete.
    const competing: { write: Promise<unknown> | null } = { write: null };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGet = IDBObjectStore.prototype.get;
    const getSpy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
      this: IDBObjectStore,
      query,
    ) {
      const request = originalGet.call(this, query);
      if (this.name === "rideState" && competing.write === null) {
        request.addEventListener("success", () => {
          competing.write = Dexie.ignoreTransaction(() => db.rideState.put(newer));
        });
      }
      return request;
    });

    try {
      await expect(clearActiveRideStateIfSession("session-1")).resolves.toBe("cleared");
    } finally {
      getSpy.mockRestore();
    }
    if (competing.write === null) throw new Error("expected the competing write");
    await competing.write;

    await expect(getActiveRideState()).resolves.toEqual(newer);
  });
});
