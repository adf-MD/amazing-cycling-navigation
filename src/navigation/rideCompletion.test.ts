import { describe, expect, it } from "vitest";
import type { Coordinate } from "../domain/types.ts";
import {
  INITIAL_ROUTE_COMPLETION_TRACKER_STATE,
  ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED,
  ROUTE_COMPLETION_ENDPOINT_MAX_ACCURACY_ALLOWANCE_METRES,
  isRouteCompletionCandidateEligible,
  isRouteCompletionConfirmed,
  routeCompletionTrackerReducer,
  type RouteCompletionCandidateInput,
  type RouteCompletionTrackerState,
} from "./rideCompletion.ts";
import { MAX_TRUSTED_ACCURACY_METRES } from "./offRoute.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import {
  OUT_AND_BACK_ROUTE_POINTS,
  OUT_AND_BACK_TURNAROUND_INDEX,
} from "../test/fixtures/outAndBackRoute.ts";
import { SELF_INTERSECTING_ROUTE_POINTS } from "../test/fixtures/selfIntersectingRoute.ts";

const OPEN_ROUTE_WAYPOINTS: readonly Coordinate[] = [
  [0, 51],
  [0.02, 51],
];
const OPEN_ROUTE_POINTS = buildRoutePointsFromWaypoints(OPEN_ROUTE_WAYPOINTS, 20);
const OPEN_ROUTE_FINAL = OPEN_ROUTE_POINTS.at(-1)?.coordinate ?? [0, 51];
const OPEN_ROUTE_TOTAL = OPEN_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0;

const CLOSED_LOOP_WAYPOINTS: readonly Coordinate[] = [
  [0, 51],
  [0.01, 51],
  [0.01, 51.01],
  [0, 51.01],
  [0, 51],
];
const CLOSED_LOOP_POINTS = buildRoutePointsFromWaypoints(CLOSED_LOOP_WAYPOINTS, 20);
const CLOSED_LOOP_FINAL = CLOSED_LOOP_POINTS.at(-1)?.coordinate ?? [0, 51];
const CLOSED_LOOP_START = CLOSED_LOOP_POINTS[0]?.coordinate ?? [0, 51];
const CLOSED_LOOP_TOTAL = CLOSED_LOOP_POINTS.at(-1)?.distanceFromStartMetres ?? 0;

function baseInput(
  overrides: Partial<RouteCompletionCandidateInput> = {},
): RouteCompletionCandidateInput {
  return {
    isRideActive: true,
    isStale: false,
    offRouteLevel: "on-route",
    currentCoordinate: OPEN_ROUTE_FINAL,
    currentAccuracyMetres: 8,
    reliableDistanceFromStartMetres: OPEN_ROUTE_TOTAL,
    routeTotalDistanceMetres: OPEN_ROUTE_TOTAL,
    routeFinalCoordinate: OPEN_ROUTE_FINAL,
    ...overrides,
  };
}

describe("isRouteCompletionCandidateEligible", () => {
  it("is eligible with near-total progress, endpoint proximity and a fresh on-route fix", () => {
    expect(isRouteCompletionCandidateEligible(baseInput())).toBe(true);
  });

  it("is not eligible when endpoint proximity is satisfied but progress is incomplete", () => {
    expect(
      isRouteCompletionCandidateEligible(
        baseInput({ reliableDistanceFromStartMetres: OPEN_ROUTE_TOTAL / 2 }),
      ),
    ).toBe(false);
  });

  it("is not eligible with near-total progress but geographically far from the endpoint", () => {
    expect(
      isRouteCompletionCandidateEligible(
        baseInput({ currentCoordinate: OPEN_ROUTE_POINTS[0]?.coordinate }),
      ),
    ).toBe(false);
  });

  it("is not eligible for a stale fix", () => {
    expect(isRouteCompletionCandidateEligible(baseInput({ isStale: true }))).toBe(false);
  });

  it("is not eligible while strongly off route", () => {
    expect(
      isRouteCompletionCandidateEligible(baseInput({ offRouteLevel: "off-route" })),
    ).toBe(false);
  });

  it("is not eligible when the ride isn't actively tracking", () => {
    expect(isRouteCompletionCandidateEligible(baseInput({ isRideActive: false }))).toBe(
      false,
    );
  });

  it("is not eligible for an invalid coordinate or non-finite distance", () => {
    expect(
      isRouteCompletionCandidateEligible(baseInput({ currentCoordinate: null })),
    ).toBe(false);
    expect(
      isRouteCompletionCandidateEligible(baseInput({ routeFinalCoordinate: null })),
    ).toBe(false);
    expect(
      isRouteCompletionCandidateEligible(
        baseInput({ reliableDistanceFromStartMetres: null }),
      ),
    ).toBe(false);
    expect(
      isRouteCompletionCandidateEligible(baseInput({ routeTotalDistanceMetres: NaN })),
    ).toBe(false);
    expect(
      isRouteCompletionCandidateEligible(baseInput({ routeTotalDistanceMetres: 0 })),
    ).toBe(false);
    expect(
      isRouteCompletionCandidateEligible(baseInput({ routeTotalDistanceMetres: -10 })),
    ).toBe(false);
    expect(
      isRouteCompletionCandidateEligible(
        baseInput({ currentCoordinate: [NaN, NaN] as Coordinate }),
      ),
    ).toBe(false);
  });

  it("does not qualify a closed loop merely for being beside the shared start/finish early in the ride", () => {
    expect(
      isRouteCompletionCandidateEligible(
        baseInput({
          currentCoordinate: CLOSED_LOOP_START,
          currentAccuracyMetres: 8,
          reliableDistanceFromStartMetres: 0,
          routeTotalDistanceMetres: CLOSED_LOOP_TOTAL,
          routeFinalCoordinate: CLOSED_LOOP_FINAL,
        }),
      ),
    ).toBe(false);
  });

  it("does not qualify an out-and-back route at an early geographic crossing near the turnaround", () => {
    const turnaround = OUT_AND_BACK_ROUTE_POINTS[OUT_AND_BACK_TURNAROUND_INDEX];
    const final = OUT_AND_BACK_ROUTE_POINTS.at(-1);
    expect(turnaround).toBeDefined();
    expect(final).toBeDefined();
    expect(
      isRouteCompletionCandidateEligible(
        baseInput({
          currentCoordinate: turnaround?.coordinate,
          reliableDistanceFromStartMetres: turnaround?.distanceFromStartMetres,
          routeTotalDistanceMetres: final?.distanceFromStartMetres ?? 0,
          routeFinalCoordinate: final?.coordinate,
        }),
      ),
    ).toBe(false);
  });

  it("does not qualify a self-intersecting route at its early geometric crossing", () => {
    // The route crosses itself near the midpoint of its first segment;
    // pick an early point (low reliable progress) that sits geographically
    // close to a much-later part of the route.
    const earlyPoint = SELF_INTERSECTING_ROUTE_POINTS[5];
    const final = SELF_INTERSECTING_ROUTE_POINTS.at(-1);
    expect(earlyPoint).toBeDefined();
    expect(final).toBeDefined();
    expect(
      isRouteCompletionCandidateEligible(
        baseInput({
          currentCoordinate: earlyPoint?.coordinate,
          reliableDistanceFromStartMetres: earlyPoint?.distanceFromStartMetres,
          routeTotalDistanceMetres: final?.distanceFromStartMetres ?? 0,
          routeFinalCoordinate: final?.coordinate,
        }),
      ),
    ).toBe(false);
  });

  it("rejects an untrusted fix outright regardless of endpoint distance", () => {
    expect(
      isRouteCompletionCandidateEligible(
        baseInput({ currentAccuracyMetres: MAX_TRUSTED_ACCURACY_METRES + 1 }),
      ),
    ).toBe(false);
  });

  it("caps how much a poor-but-trusted accuracy reading can expand the endpoint radius", () => {
    // Accuracy of 90 m is <= MAX_TRUSTED_ACCURACY_METRES (100) so it isn't
    // rejected outright, but a naive uncapped `base + accuracy` radius
    // (25 + 90 = 115m) would wrongly admit a fix this far away; the actual
    // cap limits the allowance to ROUTE_COMPLETION_ENDPOINT_MAX_ACCURACY_ALLOWANCE_METRES.
    const uncappedRadius = 25 + 90;
    const cappedRadius = 25 + ROUTE_COMPLETION_ENDPOINT_MAX_ACCURACY_ALLOWANCE_METRES;
    expect(cappedRadius).toBeLessThan(uncappedRadius);

    // Move ~70m east of the final point along the route's own line — inside
    // the naive uncapped radius but outside the correctly capped one.
    const offsetPoints = buildRoutePointsFromWaypoints(
      [OPEN_ROUTE_FINAL, [OPEN_ROUTE_FINAL[0] + 0.001, OPEN_ROUTE_FINAL[1]]],
      1,
    );
    const farCoordinate = offsetPoints.at(-1)?.coordinate ?? [0, 51];

    expect(
      isRouteCompletionCandidateEligible(
        baseInput({ currentCoordinate: farCoordinate, currentAccuracyMetres: 90 }),
      ),
    ).toBe(false);
  });
});

describe("routeCompletionTrackerReducer / isRouteCompletionConfirmed", () => {
  it("does not confirm after a single eligible fix", () => {
    const state = routeCompletionTrackerReducer(INITIAL_ROUTE_COMPLETION_TRACKER_STATE, {
      type: "fix-evaluated",
      eligible: true,
    });
    expect(isRouteCompletionConfirmed(state)).toBe(false);
  });

  it("confirms after the required consecutive eligible fixes", () => {
    let state: RouteCompletionTrackerState = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
    for (let i = 0; i < ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        eligible: true,
      });
    }
    expect(isRouteCompletionConfirmed(state)).toBe(true);
  });

  it("resets the candidate count on an ineligible fix", () => {
    let state: RouteCompletionTrackerState = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
    state = routeCompletionTrackerReducer(state, {
      type: "fix-evaluated",
      eligible: true,
    });
    state = routeCompletionTrackerReducer(state, {
      type: "fix-evaluated",
      eligible: false,
    });
    expect(state.consecutiveEligibleCount).toBe(0);
    expect(isRouteCompletionConfirmed(state)).toBe(false);
  });

  it("dismiss suppresses confirmation even once the count is satisfied", () => {
    let state: RouteCompletionTrackerState = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
    for (let i = 0; i < ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        eligible: true,
      });
    }
    state = routeCompletionTrackerReducer(state, { type: "dismiss" });
    expect(isRouteCompletionConfirmed(state)).toBe(false);
    expect(state.consecutiveEligibleCount).toBe(
      ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED,
    );
  });

  it("reset clears both the count and the dismissal", () => {
    let state: RouteCompletionTrackerState = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
    state = routeCompletionTrackerReducer(state, {
      type: "fix-evaluated",
      eligible: true,
    });
    state = routeCompletionTrackerReducer(state, { type: "dismiss" });
    state = routeCompletionTrackerReducer(state, { type: "reset" });
    expect(state).toEqual(INITIAL_ROUTE_COMPLETION_TRACKER_STATE);
    expect(isRouteCompletionConfirmed(state)).toBe(false);
  });
});
