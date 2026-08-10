import { describe, expect, it, vi } from "vitest";
import {
  canDeriveEditableWaypoints,
  resolveEditableWaypoints,
} from "./editableWaypoints.ts";
import * as deriveModule from "../navigation/deriveWaypointsFromRoute.ts";
import type { Coordinate, PlannedRoute, RoutePoint } from "./types.ts";

function buildPoint(coordinate: Coordinate, distanceFromStartMetres = 0): RoutePoint {
  return { coordinate, elevationMetres: null, distanceFromStartMetres };
}

function buildRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id: "test-route",
    name: "Test route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [buildPoint([0, 51]), buildPoint([0.05, 51.05], 5000)],
    manoeuvres: [],
    distanceMetres: 5000,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-regular" },
    ...overrides,
  };
}

describe("canDeriveEditableWaypoints", () => {
  it("is false for fewer than two points", () => {
    expect(canDeriveEditableWaypoints(buildRoute({ points: [] }))).toBe(false);
    expect(
      canDeriveEditableWaypoints(buildRoute({ points: [buildPoint([0, 51])] })),
    ).toBe(false);
  });

  it("is true for two or more points", () => {
    expect(canDeriveEditableWaypoints(buildRoute())).toBe(true);
  });

  it("never calls the derivation algorithm (must stay cheap for render-time use)", () => {
    const spy = vi.spyOn(deriveModule, "deriveWaypointsFromRoute");
    canDeriveEditableWaypoints(buildRoute());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("resolveEditableWaypoints", () => {
  it("prefers exact planning-session provenance over derivation", () => {
    const waypoints: Coordinate[] = [
      [0, 51],
      [0.02, 51.02],
      [0.05, 51.05],
    ];
    const route = buildRoute({
      planningProvenance: {
        kind: "planning-session",
        waypoints,
        profile: "cycling-regular",
        avoidFerries: false,
      },
    });

    const result = resolveEditableWaypoints(route, { avoidFerries: true });
    expect(result).toEqual({
      waypoints,
      profile: "cycling-regular",
      avoidFerries: false,
      origin: "exact",
    });
  });

  it("prefers exact acn-gpx-extension provenance over derivation", () => {
    const waypoints: Coordinate[] = [
      [0, 51],
      [0.05, 51.05],
    ];
    const route = buildRoute({
      source: { kind: "gpx-import" },
      planningProvenance: {
        kind: "acn-gpx-extension",
        version: 1,
        waypoints,
        profile: "cycling-road",
        avoidFerries: true,
      },
    });

    const result = resolveEditableWaypoints(route, { avoidFerries: false });
    expect(result?.origin).toBe("exact");
    expect(result?.waypoints).toEqual(waypoints);
    expect(result?.profile).toBe("cycling-road");
    expect(result?.avoidFerries).toBe(true);
  });

  it("falls back to derivation when provenance has fewer than two waypoints", () => {
    const route = buildRoute({
      planningProvenance: {
        kind: "planning-session",
        waypoints: [[0, 51]],
        profile: "cycling-road",
        avoidFerries: true,
      },
    });

    const result = resolveEditableWaypoints(route, { avoidFerries: false });
    expect(result?.origin).toBe("derived");
  });

  it("falls back to derivation when no provenance is present", () => {
    const route = buildRoute();
    const result = resolveEditableWaypoints(route, { avoidFerries: true });
    expect(result?.origin).toBe("derived");
    expect(result?.waypoints[0]).toEqual(route.points[0]?.coordinate);
  });

  it("uses DEFAULT_ROUTING_PROFILE, never route.source.profile, in the derived branch", () => {
    const route = buildRoute({
      source: {
        kind: "planner",
        provider: "openrouteservice",
        profile: "cycling-regular",
      },
    });
    const result = resolveEditableWaypoints(route, { avoidFerries: true });
    expect(result?.origin).toBe("derived");
    expect(result?.profile).toBe("cycling-road");
  });

  it("uses the supplied avoidFerries fallback in the derived branch", () => {
    const route = buildRoute();
    const result = resolveEditableWaypoints(route, { avoidFerries: false });
    expect(result?.avoidFerries).toBe(false);
  });

  it("returns null when there is not enough geometry to derive from", () => {
    const route = buildRoute({ points: [buildPoint([0, 51])] });
    expect(resolveEditableWaypoints(route, { avoidFerries: true })).toBeNull();
  });
});
