import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { AcnDatabase } from "./db.ts";
import type { PlannedRoute } from "../domain/types.ts";

const TEST_DB_NAME = "acn-migration-test";

const route: PlannedRoute = {
  id: "route-1",
  name: "Pre-existing route",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: [
    { coordinate: [-1.5, 53.8], elevationMetres: 10, distanceFromStartMetres: 0 },
    { coordinate: [-1.4, 53.8], elevationMetres: 12, distanceFromStartMetres: 800 },
  ],
  manoeuvres: [],
  distanceMetres: 800,
  ascentMetres: 2,
  descentMetres: 0,
  warnings: [],
  source: { kind: "gpx-import" },
};

const rideState = {
  id: "active" as const,
  routeId: "route-1",
  startedAt: "2026-01-01T08:00:00.000Z",
  lastFix: null,
  lastMatchedPointIndex: 0,
  matchedDistanceFromStartMetres: 0,
  offRouteMachineState: { level: "on-route" as const, candidateLevel: null, streak: 0 },
  elevationWindowMetres: 5000 as const,
};

afterEach(async () => {
  await Dexie.delete(TEST_DB_NAME);
});

describe("AcnDatabase schema migration (v1 -> v2)", () => {
  it("preserves existing routes and ride state, and adds the new v2 tables empty", async () => {
    // Simulates a real browser that only ever saw the v1 schema: a bare
    // Dexie instance with just the v1 stores(), seeded and closed.
    const v1Db = new Dexie(TEST_DB_NAME);
    v1Db.version(1).stores({ routes: "id, name, createdAt", rideState: "id" });
    await v1Db.open();
    await v1Db.table("routes").put(route);
    await v1Db.table("rideState").put(rideState);
    v1Db.close();

    // The real, current (v2) database opening against that same name is
    // exactly what happens when an existing installation upgrades.
    const upgraded = new AcnDatabase(TEST_DB_NAME);
    await upgraded.open();

    expect(upgraded.verno).toBe(2);
    await expect(upgraded.routes.get("route-1")).resolves.toEqual(route);
    await expect(upgraded.rideState.get("active")).resolves.toEqual(rideState);

    await expect(upgraded.providerKeys.toArray()).resolves.toEqual([]);
    await expect(upgraded.providerKeyVerifications.toArray()).resolves.toEqual([]);
    await expect(upgraded.planningDrafts.toArray()).resolves.toEqual([]);

    upgraded.close();
  });

  it("a fresh install (no prior database) opens directly at v2 with all tables usable", async () => {
    const fresh = new AcnDatabase(TEST_DB_NAME);
    await fresh.open();

    expect(fresh.verno).toBe(2);
    await expect(fresh.routes.toArray()).resolves.toEqual([]);
    await fresh.providerKeys.put({
      id: "openrouteservice",
      apiKey: "dummy-test-key",
      savedAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(fresh.providerKeys.get("openrouteservice")).resolves.toMatchObject({
      apiKey: "dummy-test-key",
    });

    fresh.close();
  });
});
