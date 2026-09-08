import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import {
  deleteRoute,
  getRoute,
  listRoutes,
  pinRoute,
  renameRoute,
  saveRoute,
  unpinRoute,
  updateRouteTags,
} from "./routesRepository.ts";
import type { PlannedRoute } from "../domain/types.ts";
import type { Clock } from "../platform/clock.ts";

function buildRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id: crypto.randomUUID(),
    name: "Test route",
    createdAt: new Date(0).toISOString(),
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
    tags: [],
    ...overrides,
  };
}

/** Simulates a route row saved before the `tags` field existed: the key
 * itself is absent, not merely `undefined`, matching how a genuine
 * pre-stage-1 IndexedDB row looks (the same fidelity as this file's
 * existing pinnedAt-absent tests). */
function omitTags<T extends { tags?: unknown }>(route: T): Omit<T, "tags"> {
  const clone = { ...route };
  delete clone.tags;
  return clone;
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

describe("routesRepository", () => {
  it("saves and retrieves a route by id", async () => {
    const route = buildRoute();
    await saveRoute(route);

    await expect(getRoute(route.id)).resolves.toEqual(route);
  });

  it("returns undefined for a missing route id", async () => {
    await expect(getRoute("does-not-exist")).resolves.toBeUndefined();
  });

  it("round-trips a route with steps/ford/ferry/other warnings unchanged", async () => {
    const route = buildRoute({
      warnings: [
        {
          kind: "steps",
          startDistanceMetres: 0,
          endDistanceMetres: 100,
          message: "Route includes steps.",
        },
        {
          kind: "ford",
          startDistanceMetres: 200,
          endDistanceMetres: 300,
          message: "Route includes a ford.",
        },
        {
          kind: "ferry",
          startDistanceMetres: 400,
          endDistanceMetres: 500,
          message: "Route includes a ferry.",
        },
        {
          kind: "other",
          startDistanceMetres: 600,
          endDistanceMetres: 700,
          message: "Route includes a construction-designated way.",
        },
      ],
    });
    await saveRoute(route);

    await expect(getRoute(route.id)).resolves.toEqual(route);
  });

  it("round-trips a route whose surface warnings carry the new surface detail field, alongside an old-shape warning without it", async () => {
    const route = buildRoute({
      warnings: [
        {
          kind: "questionable-surface",
          startDistanceMetres: 0,
          endDistanceMetres: 100,
          message: "Questionable surface for a road bike: compacted gravel.",
          surface: { type: "compacted-gravel", label: "Compacted gravel" },
        },
        // As it would have been saved before this field existed — no
        // `surface` key at all, not `surface: undefined`.
        {
          kind: "unsuitable-surface",
          startDistanceMetres: 200,
          endDistanceMetres: 300,
          message: "Unsuitable surface for a road bike.",
        },
      ],
    });
    await saveRoute(route);

    await expect(getRoute(route.id)).resolves.toEqual(route);
  });

  it("round-trips a route with manoeuvreProvenance unchanged (no schema migration needed)", async () => {
    const route = buildRoute({
      manoeuvres: [
        { distanceFromStartMetres: 100, type: "left", instruction: "Turn left" },
      ],
      manoeuvreProvenance: { kind: "acn-gpx-extension", version: 1 },
    });
    await saveRoute(route);

    await expect(getRoute(route.id)).resolves.toEqual(route);
  });

  it("lists routes newest-first by createdAt", async () => {
    const older = buildRoute({
      id: "older",
      name: "Older",
      createdAt: new Date(1000).toISOString(),
    });
    const newer = buildRoute({
      id: "newer",
      name: "Newer",
      createdAt: new Date(2000).toISOString(),
    });
    await saveRoute(older);
    await saveRoute(newer);

    const routes = await listRoutes();

    expect(routes.map((route) => route.id)).toEqual(["newer", "older"]);
  });

  it("renames a route", async () => {
    const route = buildRoute();
    await saveRoute(route);

    await renameRoute(route.id, "Renamed");

    const updated = await getRoute(route.id);
    expect(updated?.name).toBe("Renamed");
  });

  it("deletes a route", async () => {
    const route = buildRoute();
    await saveRoute(route);

    await deleteRoute(route.id);

    await expect(getRoute(route.id)).resolves.toBeUndefined();
  });

  it("pins a route, writing pinnedAt and leaving every other field untouched", async () => {
    const route = buildRoute();
    await saveRoute(route);
    const fixedClock: Clock = { now: () => Date.parse("2026-02-01T09:00:00.000Z") };

    await pinRoute(route.id, fixedClock);

    await expect(getRoute(route.id)).resolves.toEqual({
      ...route,
      pinnedAt: "2026-02-01T09:00:00.000Z",
    });
  });

  it("unpins a route, clearing only pinnedAt", async () => {
    const route = buildRoute();
    await saveRoute(route);
    const fixedClock: Clock = { now: () => Date.parse("2026-02-01T09:00:00.000Z") };
    await pinRoute(route.id, fixedClock);

    await unpinRoute(route.id);

    await expect(getRoute(route.id)).resolves.toEqual({ ...route, pinnedAt: null });
  });

  it("loads a route saved without pinnedAt with the key absent (unpinned)", async () => {
    const route = buildRoute();
    await saveRoute(route);

    const loaded = await getRoute(route.id);

    expect(loaded).not.toHaveProperty("pinnedAt");
  });

  describe("tags", () => {
    it("defaults a route saved with no tags field at all to an empty array", async () => {
      const routeWithoutTags = omitTags(buildRoute());
      await saveRoute(routeWithoutTags);

      const loaded = await getRoute(routeWithoutTags.id);

      expect(loaded?.tags).toEqual([]);
    });

    it("normalises tags on save: trims, collapses whitespace, dedupes case-insensitively, preserves first-occurrence order", async () => {
      const route = buildRoute({
        tags: [" Commute ", "gravel", "  we  ekend", "GRAVEL", "commute"],
      });

      await saveRoute(route);

      const loaded = await getRoute(route.id);
      expect(loaded?.tags).toEqual(["Commute", "gravel", "we ekend"]);
    });

    it("persists an already-canonical tag collection to storage itself, not only at read time", async () => {
      // getRoute()/listRoutes() also normalise on read, so a test that
      // only reads back through them cannot tell write-time
      // canonicalisation apart from read-time canonicalisation alone.
      // This reads the raw Dexie row directly, bypassing the repository's
      // own read-side normalisation, to prove saveRoute() itself writes
      // canonical data rather than relying entirely on the read side.
      const route = buildRoute({
        tags: [" Commute ", "gravel", "  we  ekend", "GRAVEL", "commute"],
      });

      await saveRoute(route);

      const rawStored = await db.routes.get(route.id);
      expect(rawStored?.tags).toEqual(["Commute", "gravel", "we ekend"]);
    });

    it("loads a legacy row saved before the tags field existed as an empty array (getRoute)", async () => {
      const legacyRow = omitTags(buildRoute());
      await db.routes.put(legacyRow);

      const loaded = await getRoute(legacyRow.id);

      expect(loaded?.tags).toEqual([]);
    });

    it("loads legacy and malformed tags rows as sanitised arrays (listRoutes)", async () => {
      const legacyRow = omitTags(buildRoute({ id: "legacy", name: "Legacy" }));
      const malformedRoute = buildRoute({ id: "malformed", name: "Malformed" });
      const malformedRow = { ...malformedRoute, tags: "not-an-array" };
      const mixedRoute = buildRoute({ id: "mixed", name: "Mixed" });
      const mixedRow = { ...mixedRoute, tags: ["valid", 42, null, "  Valid  "] };

      await db.routes.put(legacyRow);
      await db.routes.put(malformedRow as unknown as PlannedRoute);
      await db.routes.put(mixedRow as unknown as PlannedRoute);

      const loaded = await listRoutes();
      const byId = new Map(loaded.map((route) => [route.id, route]));
      expect(byId.get("legacy")?.tags).toEqual([]);
      expect(byId.get("malformed")?.tags).toEqual([]);
      expect(byId.get("mixed")?.tags).toEqual(["valid"]);
    });

    it("renames a route without changing its tags", async () => {
      const route = buildRoute({ tags: ["commute"] });
      await saveRoute(route);

      await renameRoute(route.id, "Renamed");

      const updated = await getRoute(route.id);
      expect(updated?.tags).toEqual(["commute"]);
    });

    it("pins a route without changing its tags", async () => {
      const route = buildRoute({ tags: ["commute"] });
      await saveRoute(route);
      const fixedClock: Clock = { now: () => Date.parse("2026-02-01T09:00:00.000Z") };

      await pinRoute(route.id, fixedClock);

      const updated = await getRoute(route.id);
      expect(updated?.tags).toEqual(["commute"]);
    });

    it("unpins a route without changing its tags", async () => {
      const route = buildRoute({ tags: ["commute"] });
      await saveRoute(route);
      const fixedClock: Clock = { now: () => Date.parse("2026-02-01T09:00:00.000Z") };
      await pinRoute(route.id, fixedClock);

      await unpinRoute(route.id);

      const updated = await getRoute(route.id);
      expect(updated?.tags).toEqual(["commute"]);
    });

    it("updateRouteTags normalises and persists tags, leaving every other field untouched", async () => {
      const route = buildRoute({ name: "Keep this name", ascentMetres: 42 });
      await saveRoute(route);

      await updateRouteTags(route.id, [" Weekend ", "weekend", "gravel"]);

      const updated = await getRoute(route.id);
      expect(updated?.tags).toEqual(["Weekend", "gravel"]);
      expect(updated?.name).toBe("Keep this name");
      expect(updated?.ascentMetres).toBe(42);

      // As with saveRoute above, getRoute() also normalises on read, so
      // this additionally checks the raw stored row to prove
      // updateRouteTags() itself writes already-canonical data.
      const rawStored = await db.routes.get(route.id);
      expect(rawStored?.tags).toEqual(["Weekend", "gravel"]);
    });
  });
});
