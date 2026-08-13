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

describe("AcnDatabase schema migration (v1 -> v4)", () => {
  it("preserves existing routes and ride state, and adds the later empty tables", async () => {
    // Simulates a real browser that only ever saw the v1 schema: a bare
    // Dexie instance with just the v1 stores(), seeded and closed.
    const v1Db = new Dexie(TEST_DB_NAME);
    v1Db.version(1).stores({ routes: "id, name, createdAt", rideState: "id" });
    await v1Db.open();
    await v1Db.table("routes").put(route);
    await v1Db.table("rideState").put(rideState);
    v1Db.close();

    // The real, current (v4) database opening against that same name is
    // exactly what happens when an existing installation upgrades.
    const upgraded = new AcnDatabase(TEST_DB_NAME);
    await upgraded.open();

    expect(upgraded.verno).toBe(4);
    const upgradedRoute = await upgraded.routes.get("route-1");
    expect(upgradedRoute).toEqual(route);
    // pinnedAt is a plain, non-indexed field added after this fixture was
    // written (no version(5) bump) — a legacy route simply lacks the key,
    // and is therefore treated as unpinned (see routeLibraryView.ts's
    // isPinnedRoute).
    expect(upgradedRoute).not.toHaveProperty("pinnedAt");
    await expect(upgraded.rideState.get("active")).resolves.toEqual(rideState);

    await expect(upgraded.providerKeys.toArray()).resolves.toEqual([]);
    await expect(upgraded.providerKeyVerifications.toArray()).resolves.toEqual([]);
    await expect(upgraded.planningDrafts.toArray()).resolves.toEqual([]);
    await expect(upgraded.planningPreferences.toArray()).resolves.toEqual([]);
    await expect(upgraded.routeLibraryPreferences.toArray()).resolves.toEqual([]);

    upgraded.close();
  });

  it("a fresh install (no prior database) opens directly at v4 with all tables usable", async () => {
    const fresh = new AcnDatabase(TEST_DB_NAME);
    await fresh.open();

    expect(fresh.verno).toBe(4);
    await expect(fresh.routes.toArray()).resolves.toEqual([]);
    await fresh.providerKeys.put({
      id: "openrouteservice",
      apiKey: "dummy-test-key",
      savedAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(fresh.providerKeys.get("openrouteservice")).resolves.toMatchObject({
      apiKey: "dummy-test-key",
    });

    await fresh.planningPreferences.put({ id: "planning", avoidFerriesByDefault: false });
    await expect(fresh.planningPreferences.get("planning")).resolves.toMatchObject({
      avoidFerriesByDefault: false,
    });

    await fresh.routeLibraryPreferences.put({
      id: "route-library",
      sortOrder: "name-asc",
    });
    await expect(
      fresh.routeLibraryPreferences.get("route-library"),
    ).resolves.toMatchObject({
      sortOrder: "name-asc",
    });

    fresh.close();
  });
});

describe("AcnDatabase schema migration (v2 -> v4)", () => {
  it("preserves all existing v2 tables and records, and adds later tables empty", async () => {
    // Simulates a real browser that only ever saw the v2 schema (i.e. an
    // installation from before this slice): a bare Dexie instance with
    // just the v1+v2 stores(), seeded across every v2 table, and closed.
    const v2Db = new Dexie(TEST_DB_NAME);
    v2Db.version(1).stores({ routes: "id, name, createdAt", rideState: "id" });
    v2Db.version(2).stores({
      routes: "id, name, createdAt",
      rideState: "id",
      providerKeys: "id",
      providerKeyVerifications: "id",
      planningDrafts: "id",
    });
    await v2Db.open();
    await v2Db.table("routes").put(route);
    await v2Db.table("rideState").put(rideState);
    await v2Db.table("providerKeys").put({
      id: "openrouteservice",
      apiKey: "dummy-test-key",
      savedAt: "2026-01-01T00:00:00.000Z",
    });
    await v2Db.table("providerKeyVerifications").put({
      id: "openrouteservice",
      outcome: "verified",
      checkedAt: "2026-01-01T00:00:00.000Z",
      rateLimitResetAt: null,
    });
    await v2Db.table("planningDrafts").put({
      id: "draft",
      waypoints: [{ id: "wp-1", coordinate: [-1.5, 53.8] }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    v2Db.close();

    // The real, current (v4) database opening against that same name is
    // exactly what happens when a v2 installation upgrades.
    const upgraded = new AcnDatabase(TEST_DB_NAME);
    await upgraded.open();

    expect(upgraded.verno).toBe(4);
    await expect(upgraded.routes.get("route-1")).resolves.toEqual(route);
    await expect(upgraded.rideState.get("active")).resolves.toEqual(rideState);
    await expect(upgraded.providerKeys.get("openrouteservice")).resolves.toMatchObject({
      apiKey: "dummy-test-key",
    });
    await expect(
      upgraded.providerKeyVerifications.get("openrouteservice"),
    ).resolves.toMatchObject({ outcome: "verified" });
    await expect(upgraded.planningDrafts.get("draft")).resolves.toMatchObject({
      waypoints: [{ id: "wp-1", coordinate: [-1.5, 53.8] }],
    });

    await expect(upgraded.planningPreferences.toArray()).resolves.toEqual([]);
    await expect(upgraded.routeLibraryPreferences.toArray()).resolves.toEqual([]);

    upgraded.close();
  });
});

describe("AcnDatabase schema migration (v3 -> v4)", () => {
  it("preserves all existing v3 tables and records, and adds routeLibraryPreferences empty", async () => {
    // Simulates a real browser that only ever saw the v3 schema (i.e. an
    // installation from before the Route Library search/sort slice): a
    // bare Dexie instance with the v1+v2+v3 stores(), seeded across every
    // v3 table, and closed.
    const v3Db = new Dexie(TEST_DB_NAME);
    v3Db.version(1).stores({ routes: "id, name, createdAt", rideState: "id" });
    v3Db.version(2).stores({
      routes: "id, name, createdAt",
      rideState: "id",
      providerKeys: "id",
      providerKeyVerifications: "id",
      planningDrafts: "id",
    });
    v3Db.version(3).stores({
      routes: "id, name, createdAt",
      rideState: "id",
      providerKeys: "id",
      providerKeyVerifications: "id",
      planningDrafts: "id",
      planningPreferences: "id",
    });
    await v3Db.open();
    await v3Db.table("routes").put(route);
    await v3Db.table("rideState").put(rideState);
    await v3Db.table("providerKeys").put({
      id: "openrouteservice",
      apiKey: "dummy-test-key",
      savedAt: "2026-01-01T00:00:00.000Z",
    });
    await v3Db.table("providerKeyVerifications").put({
      id: "openrouteservice",
      outcome: "verified",
      checkedAt: "2026-01-01T00:00:00.000Z",
      rateLimitResetAt: null,
    });
    await v3Db.table("planningDrafts").put({
      id: "draft",
      waypoints: [{ id: "wp-1", coordinate: [-1.5, 53.8] }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await v3Db.table("planningPreferences").put({
      id: "planning",
      avoidFerriesByDefault: false,
    });
    v3Db.close();

    // The real, current (v4) database opening against that same name is
    // exactly what happens when a v3 installation upgrades.
    const upgraded = new AcnDatabase(TEST_DB_NAME);
    await upgraded.open();

    expect(upgraded.verno).toBe(4);
    await expect(upgraded.routes.get("route-1")).resolves.toEqual(route);
    await expect(upgraded.rideState.get("active")).resolves.toEqual(rideState);
    await expect(upgraded.providerKeys.get("openrouteservice")).resolves.toMatchObject({
      apiKey: "dummy-test-key",
    });
    await expect(
      upgraded.providerKeyVerifications.get("openrouteservice"),
    ).resolves.toMatchObject({ outcome: "verified" });
    await expect(upgraded.planningDrafts.get("draft")).resolves.toMatchObject({
      waypoints: [{ id: "wp-1", coordinate: [-1.5, 53.8] }],
    });
    await expect(upgraded.planningPreferences.get("planning")).resolves.toMatchObject({
      avoidFerriesByDefault: false,
    });

    await expect(upgraded.routeLibraryPreferences.toArray()).resolves.toEqual([]);

    upgraded.close();
  });
});

describe("planningDrafts editCopySourceRouteId/editCopyWaypointsOrigin (no schema version bump)", () => {
  it("a legacy v4 planningDrafts row written before these fields existed loads cleanly", async () => {
    // Simulates a real installation already on v4 before the "Edit copy in
    // Planning" slice — the schema itself (planningDrafts: "id") is
    // unchanged, so this is a plain field addition, not a new Dexie
    // version; no upgrade path is exercised here at all.
    const db = new AcnDatabase(TEST_DB_NAME);
    await db.open();
    await db.planningDrafts.put({
      id: "draft",
      waypoints: [{ id: "wp-1", coordinate: [-1.5, 53.8] }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const stored = await db.planningDrafts.get("draft");
    expect(stored).not.toHaveProperty("editCopySourceRouteId");
    expect(stored).not.toHaveProperty("editCopyWaypointsOrigin");

    db.close();
  });

  it("round-trips a planningDrafts row with the new edit-copy fields set", async () => {
    const db = new AcnDatabase(TEST_DB_NAME);
    await db.open();
    await db.planningDrafts.put({
      id: "draft",
      waypoints: [{ id: "wp-1", coordinate: [-1.5, 53.8] }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      editCopySourceRouteId: "route-1",
      editCopyWaypointsOrigin: "exact",
    });

    await expect(db.planningDrafts.get("draft")).resolves.toMatchObject({
      editCopySourceRouteId: "route-1",
      editCopyWaypointsOrigin: "exact",
    });

    db.close();
  });
});

describe("planningPreferences profileByDefault (no schema version bump)", () => {
  it("a legacy planningPreferences row written before profileByDefault existed loads cleanly", async () => {
    // Simulates a real installation whose planningPreferences row predates
    // backlog item 36 — the schema itself (planningPreferences: "id") is
    // unchanged, so this is a plain field addition, not a new Dexie
    // version; no upgrade path is exercised here at all.
    const db = new AcnDatabase(TEST_DB_NAME);
    await db.open();
    await db.planningPreferences.put({ id: "planning", avoidFerriesByDefault: false });

    const stored = await db.planningPreferences.get("planning");
    expect(stored).not.toHaveProperty("profileByDefault");

    db.close();
  });

  it("round-trips a planningPreferences row with profileByDefault set", async () => {
    const db = new AcnDatabase(TEST_DB_NAME);
    await db.open();
    await db.planningPreferences.put({
      id: "planning",
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-regular",
    });

    await expect(db.planningPreferences.get("planning")).resolves.toMatchObject({
      profileByDefault: "cycling-regular",
    });

    db.close();
  });
});
