import { describe, expect, it } from "vitest";
import { canSaveOrExportPlan } from "./canSaveOrExportPlan.ts";
import type { PlanningRouteState } from "./usePlanningRoute.ts";
import type { PlannedRoute, Waypoint } from "../../domain/types.ts";

const waypoints: Waypoint[] = [
  { id: "a", coordinate: [0, 51] },
  { id: "b", coordinate: [0.01, 51] },
];

function buildRoute(pointCount: number): PlannedRoute {
  return {
    id: "route-1",
    name: "Test route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: Array.from({ length: pointCount }, (_, i) => ({
      coordinate: [i * 0.001, 51] as const,
      elevationMetres: null,
      distanceFromStartMetres: i * 100,
    })),
    manoeuvres: [],
    distanceMetres: pointCount * 100,
    ascentMetres: 0,
    descentMetres: 0,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

describe("canSaveOrExportPlan", () => {
  it("is false for no-waypoints", () => {
    const state: PlanningRouteState = { kind: "no-waypoints" };
    expect(canSaveOrExportPlan(state, false)).toBe(false);
  });

  it("is false for insufficient-waypoints", () => {
    const state: PlanningRouteState = { kind: "insufficient-waypoints" };
    expect(canSaveOrExportPlan(state, false)).toBe(false);
  });

  it("is false for unrouted-preview", () => {
    const state: PlanningRouteState = { kind: "unrouted-preview", waypoints };
    expect(canSaveOrExportPlan(state, false)).toBe(false);
  });

  it("is true when routed with materially denser geometry than the waypoints, and not stale", () => {
    const state: PlanningRouteState = {
      kind: "routed",
      route: buildRoute(20),
      waypoints,
      isFirstRouteForDraft: true,
    };
    expect(canSaveOrExportPlan(state, false)).toBe(true);
  });

  it("is false when routed but the geometry is no denser than the raw waypoints", () => {
    const state: PlanningRouteState = {
      kind: "routed",
      route: buildRoute(2),
      waypoints,
      isFirstRouteForDraft: true,
    };
    expect(canSaveOrExportPlan(state, false)).toBe(false);
  });

  it("is false when routed and otherwise eligible, but stale", () => {
    const state: PlanningRouteState = {
      kind: "routed",
      route: buildRoute(20),
      waypoints,
      isFirstRouteForDraft: true,
    };
    expect(canSaveOrExportPlan(state, true)).toBe(false);
  });
});
