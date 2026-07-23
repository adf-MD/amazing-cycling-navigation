import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import {
  deleteRoute,
  getRoute,
  listRoutes,
  renameRoute,
  saveRoute,
} from "./routesRepository.ts";
import type { PlannedRoute } from "../domain/types.ts";

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
});
