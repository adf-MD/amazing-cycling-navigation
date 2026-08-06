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
    ...overrides,
  };
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
});
