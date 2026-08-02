import { describe, expect, it } from "vitest";
import { computeFocusRouteIdAfterDelete } from "./routeDeleteFocus.ts";
import type { PlannedRoute } from "../../domain/types.ts";

function buildRoute(id: string): PlannedRoute {
  return {
    id,
    name: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [],
    manoeuvres: [],
    distanceMetres: 0,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "gpx-import" },
  };
}

describe("computeFocusRouteIdAfterDelete", () => {
  it("returns the next route's id when a route in the middle of the list is deleted", () => {
    const routes = [buildRoute("a"), buildRoute("b"), buildRoute("c")];
    expect(computeFocusRouteIdAfterDelete(routes, "b")).toBe("c");
  });

  it("returns the next route's id when the first route is deleted and later routes remain", () => {
    const routes = [buildRoute("a"), buildRoute("b"), buildRoute("c")];
    expect(computeFocusRouteIdAfterDelete(routes, "a")).toBe("b");
  });

  it("returns the previous route's id when the last route is deleted", () => {
    const routes = [buildRoute("a"), buildRoute("b"), buildRoute("c")];
    expect(computeFocusRouteIdAfterDelete(routes, "c")).toBe("b");
  });

  it("returns null when the only route in the list is deleted", () => {
    const routes = [buildRoute("a")];
    expect(computeFocusRouteIdAfterDelete(routes, "a")).toBeNull();
  });

  it("returns null when the deleted id is not present in the routes array", () => {
    const routes = [buildRoute("a"), buildRoute("b")];
    expect(computeFocusRouteIdAfterDelete(routes, "missing")).toBeNull();
  });
});
