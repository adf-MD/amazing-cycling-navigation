import { describe, expect, it } from "vitest";
import {
  classifyRideTransition,
  type RideSessionTarget,
} from "./rideSessionTransition.ts";
import type {
  StoredFreeRoamRideState,
  StoredRideState,
  StoredRouteRideState,
} from "../../storage/db.ts";
import type { PlannedRoute } from "../../domain/types.ts";

const routeA: PlannedRoute = {
  id: "route-a",
  name: "Route A",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: [
    { coordinate: [-1.5, 53.8], elevationMetres: 10, distanceFromStartMetres: 0 },
    { coordinate: [-1.4, 53.8], elevationMetres: 12, distanceFromStartMetres: 12_500 },
  ],
  manoeuvres: [],
  distanceMetres: 12_500,
  ascentMetres: 120,
  descentMetres: 80,
  warnings: [],
  source: { kind: "gpx-import" },
};

const routeB: PlannedRoute = { ...routeA, id: "route-b", name: "Route B" };

const routeTargetA: RideSessionTarget = { kind: "route", route: routeA };
const routeTargetB: RideSessionTarget = { kind: "route", route: routeB };
const freeRoamTarget: RideSessionTarget = { kind: "free-roam" };

function buildStoredRoute(
  overrides: Partial<StoredRouteRideState> = {},
): StoredRouteRideState {
  return {
    id: "active",
    routeId: routeA.id,
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: { coordinate: [-1.45, 53.8], accuracyMetres: 6, timestampMs: 1000 },
    lastMatchedPointIndex: 1,
    matchedDistanceFromStartMetres: 6000,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    ...overrides,
  };
}

function buildStoredFreeRoam(
  overrides: Partial<StoredFreeRoamRideState> = {},
): StoredFreeRoamRideState {
  return {
    id: "active",
    kind: "free-roam",
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: null,
    ...overrides,
  };
}

describe("classifyRideTransition", () => {
  it("no stored session + route target => proceed", () => {
    expect(classifyRideTransition(undefined, routeTargetA)).toEqual({ kind: "proceed" });
  });

  it("no stored session + free-roam target => proceed", () => {
    expect(classifyRideTransition(undefined, freeRoamTarget)).toEqual({
      kind: "proceed",
    });
  });

  it("stored route A + target route A => resume (exact same session)", () => {
    expect(classifyRideTransition(buildStoredRoute(), routeTargetA)).toEqual({
      kind: "resume",
    });
  });

  it("stored route A + target route B => conflict/route", () => {
    expect(classifyRideTransition(buildStoredRoute(), routeTargetB)).toEqual({
      kind: "conflict",
      existing: "route",
    });
  });

  it("stored route A + target free-roam => conflict/route", () => {
    expect(classifyRideTransition(buildStoredRoute(), freeRoamTarget)).toEqual({
      kind: "conflict",
      existing: "route",
    });
  });

  it("stored free-roam + target route A => conflict/free-roam", () => {
    expect(classifyRideTransition(buildStoredFreeRoam(), routeTargetA)).toEqual({
      kind: "conflict",
      existing: "free-roam",
    });
  });

  it("stored free-roam + target free-roam => resume (no distinguishing id, always the same session)", () => {
    expect(classifyRideTransition(buildStoredFreeRoam(), freeRoamTarget)).toEqual({
      kind: "resume",
    });
  });

  it("stored row with an unrecognised kind + route target => conflict/unsupported", () => {
    const stored = {
      id: "active",
      kind: "totally-unknown",
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: null,
    } as unknown as StoredRideState;
    expect(classifyRideTransition(stored, routeTargetA)).toEqual({
      kind: "conflict",
      existing: "unsupported",
    });
  });

  it("stored row with an unrecognised kind + free-roam target => conflict/unsupported", () => {
    const stored = {
      id: "active",
      kind: "totally-unknown",
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: null,
    } as unknown as StoredRideState;
    expect(classifyRideTransition(stored, freeRoamTarget)).toEqual({
      kind: "conflict",
      existing: "unsupported",
    });
  });

  it("a legacy row with no kind field and a matching routeId still resumes (legacy-absence defaults to route)", () => {
    const legacyStored = buildStoredRoute();
    // kind is already absent from buildStoredRoute's own defaults — assert
    // that directly, so this test fails loudly if the fixture ever changes
    // to include one by default.
    expect(legacyStored.kind).toBeUndefined();
    expect(classifyRideTransition(legacyStored, routeTargetA)).toEqual({
      kind: "resume",
    });
  });

  it("a legacy row with no kind field and a different routeId is still a route conflict", () => {
    const legacyStored = buildStoredRoute();
    expect(classifyRideTransition(legacyStored, routeTargetB)).toEqual({
      kind: "conflict",
      existing: "route",
    });
  });
});
