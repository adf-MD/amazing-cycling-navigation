import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db.ts";
import * as routeTags from "../domain/routeTags.ts";
import {
  applyRouteTagLifecycle,
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

describe("routesRepository tag lifecycle (backlog item 100 stage 4A)", () => {
  beforeEach(async () => {
    await db.routes.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seed(...tagSets: readonly (readonly unknown[])[]): Promise<string[]> {
    const ids: string[] = [];
    for (const tags of tagSets) {
      const route = buildRoute();
      ids.push(route.id);
      // Written with a raw put so a deliberately malformed or
      // non-canonical stored value survives to the assertion — saveRoute
      // would canonicalise it on the way in.
      await db.routes.put({ ...route, tags } as unknown as PlannedRoute);
    }
    return ids;
  }

  async function rawTags(id: string): Promise<unknown> {
    const stored = await db.routes.get(id);
    return stored?.tags;
  }

  it("renames a tag across every route carrying it, matching by identity not spelling", async () => {
    const [a, b, c] = await seed(["Gravel"], ["  gravel  "], ["GRAVEL", "Road"]);

    const outcome = await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "Trail",
    });

    expect(outcome).toEqual({
      status: "applied",
      sourceRouteCount: 3,
      writtenRouteCount: 3,
    });
    await expect(rawTags(a ?? "")).resolves.toEqual(["Trail"]);
    await expect(rawTags(b ?? "")).resolves.toEqual(["Trail"]);
    await expect(rawTags(c ?? "")).resolves.toEqual(["Trail", "Road"]);
  });

  it("leaves a route carrying only the target identity byte-identical", async () => {
    // Candidate rows are selected by the SOURCE identity alone. This row
    // never carried "gravel", so a merge must not rewrite it — not even
    // to settle its spelling against the target's.
    const [source, targetOnly] = await seed(["Gravel"], ["trail"]);

    const outcome = await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "Trail",
    });

    expect(outcome).toEqual({
      status: "applied",
      sourceRouteCount: 1,
      writtenRouteCount: 1,
    });
    await expect(rawTags(source ?? "")).resolves.toEqual(["Trail"]);
    await expect(rawTags(targetOnly ?? "")).resolves.toEqual(["trail"]);
  });

  it("merges into an existing tag, leaving exactly one entry at the earlier position", async () => {
    const [sourceFirst, targetFirst, neither] = await seed(
      ["Gravel", "Road", "Trail"],
      ["Trail", "Road", "Gravel"],
      ["Road"],
    );

    await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "Trail",
    });

    await expect(rawTags(sourceFirst ?? "")).resolves.toEqual(["Trail", "Road"]);
    await expect(rawTags(targetFirst ?? "")).resolves.toEqual(["Trail", "Road"]);
    await expect(rawTags(neither ?? "")).resolves.toEqual(["Road"]);
  });

  it("converges an affected row's own target spelling on the operation's target spelling", async () => {
    // The discriminating case for applyTagRename's target mapping. Plain
    // dedup is NOT what that mapping buys: normalizeRouteTags already
    // collapses two identity-equal entries on its own. What it buys is
    // the surviving SPELLING when an affected row happens to carry the
    // target first, under a different spelling — without it, that row's
    // own older spelling would win and the library would show two
    // spellings of one tag.
    const [targetFirst] = await seed(["TRAIL", "Gravel"]);

    await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "Trail",
    });

    await expect(rawTags(targetFirst ?? "")).resolves.toEqual(["Trail"]);
  });

  it("applies a display-only respelling to every carrying route", async () => {
    const [a, b] = await seed(["Gravel"], ["GRAVEL", "Road"]);

    const outcome = await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "gravel",
    });

    expect(outcome).toEqual({
      status: "applied",
      sourceRouteCount: 2,
      writtenRouteCount: 2,
    });
    await expect(rawTags(a ?? "")).resolves.toEqual(["gravel"]);
    await expect(rawTags(b ?? "")).resolves.toEqual(["gravel", "Road"]);
  });

  it("reports sourceRouteCount without writing when the stored rows are already canonical", async () => {
    await seed(["Gravel"], ["Gravel"], ["Gravel"]);
    const update = vi.spyOn(db.routes, "update");

    const outcome = await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "Gravel",
    });

    expect(outcome).toEqual({
      status: "applied",
      sourceRouteCount: 3,
      writtenRouteCount: 0,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("canonicalises a malformed legacy row that carries the source, without crashing", async () => {
    const [malformedSource] = await seed(["  Gravel  ", "gravel", 42, null]);

    await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "Trail",
    });

    await expect(rawTags(malformedSource ?? "")).resolves.toEqual(["Trail"]);
  });

  it("leaves a malformed legacy row that does not carry the source untouched", async () => {
    const [malformedOther] = await seed(["  Road  ", 42, null]);

    await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "Trail",
    });

    await expect(rawTags(malformedOther ?? "")).resolves.toEqual(["  Road  ", 42, null]);
  });

  it("never touches a non-tag field of an affected route", async () => {
    const route = buildRoute({ name: "Alpine", pinnedAt: "2026-01-01T00:00:00.000Z" });
    await db.routes.put({ ...route, tags: ["Gravel"] });

    await applyRouteTagLifecycle({
      kind: "rename",
      sourceKey: "gravel",
      targetSpelling: "Trail",
    });

    const stored = await db.routes.get(route.id);
    expect(stored).toEqual({ ...route, tags: ["Trail"] });
  });

  it("rejects an empty or whitespace-only target without opening a transaction", async () => {
    const [only] = await seed(["Gravel"]);
    const update = vi.spyOn(db.routes, "update");

    for (const targetSpelling of ["", "   ", "\t\n"]) {
      await expect(
        applyRouteTagLifecycle({ kind: "rename", sourceKey: "gravel", targetSpelling }),
      ).resolves.toEqual({ status: "invalid-target" });
    }

    expect(update).not.toHaveBeenCalled();
    await expect(rawTags(only ?? "")).resolves.toEqual(["Gravel"]);
  });

  it("reports a zero sourceRouteCount, and writes nothing, when no route carries the tag", async () => {
    const [other] = await seed(["Road"]);
    const update = vi.spyOn(db.routes, "update");

    await expect(
      applyRouteTagLifecycle({
        kind: "rename",
        sourceKey: "gravel",
        targetSpelling: "Trail",
      }),
    ).resolves.toEqual({ status: "applied", sourceRouteCount: 0, writtenRouteCount: 0 });
    await expect(
      applyRouteTagLifecycle({ kind: "delete", sourceKey: "gravel" }),
    ).resolves.toEqual({ status: "applied", sourceRouteCount: 0, writtenRouteCount: 0 });

    expect(update).not.toHaveBeenCalled();
    await expect(rawTags(other ?? "")).resolves.toEqual(["Road"]);
  });

  it("deletes a tag from every route without deleting any route", async () => {
    const [a, b, c] = await seed(["Gravel", "Road"], ["  GRAVEL  "], ["Road"]);

    const outcome = await applyRouteTagLifecycle({
      kind: "delete",
      sourceKey: "gravel",
    });

    expect(outcome).toEqual({
      status: "applied",
      sourceRouteCount: 2,
      writtenRouteCount: 2,
    });
    await expect(rawTags(a ?? "")).resolves.toEqual(["Road"]);
    await expect(rawTags(b ?? "")).resolves.toEqual([]);
    await expect(rawTags(c ?? "")).resolves.toEqual(["Road"]);
    await expect(db.routes.count()).resolves.toBe(3);
  });

  it("stores an empty array, never a missing key, when the last tag is deleted", async () => {
    const [only] = await seed(["Gravel"]);

    await applyRouteTagLifecycle({ kind: "delete", sourceKey: "gravel" });

    const stored = await db.routes.get(only ?? "");
    expect(stored).toHaveProperty("tags");
    expect(stored?.tags).toEqual([]);
  });

  it("leaves every route unchanged when the operation fails part-way through", async () => {
    // The atomicity proof. applyTagRename is called through the module
    // namespace by routesRepository precisely so a failure can be injected
    // mid-transaction here without any production test seam, and without
    // weakening the transaction itself. The first row's own db.routes
    // .update() has genuinely been issued and awaited before the second
    // row's computation throws, so a plain loop of independent writes
    // would leave route A renamed — only a real transaction rolls it back.
    const ids = await seed(["Gravel"], ["Gravel"], ["Gravel"]);
    const realApplyTagRename = routeTags.applyTagRename;
    const spy = vi
      .spyOn(routeTags, "applyTagRename")
      .mockImplementationOnce(realApplyTagRename)
      .mockImplementationOnce(() => {
        throw new Error("injected mid-transaction failure");
      });

    await expect(
      applyRouteTagLifecycle({
        kind: "rename",
        sourceKey: "gravel",
        targetSpelling: "Trail",
      }),
    ).rejects.toThrow("injected mid-transaction failure");

    // Guards the control itself: if the namespace spy silently failed to
    // intercept, every assertion below would pass for the wrong reason.
    expect(spy).toHaveBeenCalledTimes(2);
    for (const id of ids) {
      await expect(rawTags(id)).resolves.toEqual(["Gravel"]);
    }
  });
});
