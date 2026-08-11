import { describe, expect, it } from "vitest";
import type { Coordinate, RoutePoint } from "../domain/types.ts";
import {
  INITIAL_ROUTE_COMPLETION_TRACKER_STATE,
  ROUTE_COMPLETION_ARMING_CONSECUTIVE_FIXES_REQUIRED,
  ROUTE_COMPLETION_ARMING_DEPARTURE_MAX_ACCURACY_ALLOWANCE_METRES,
  ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED,
  ROUTE_COMPLETION_ENDPOINT_MAX_ACCURACY_ALLOWANCE_METRES,
  isRouteArmingFixEligible,
  isRouteCompletionCandidateEligible,
  isRouteCompletionConfirmed,
  routeCompletionTrackerReducer,
  type RouteArmingFixInput,
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
const OPEN_ROUTE_START = OPEN_ROUTE_POINTS[0]?.coordinate ?? [0, 51];
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

/** The route point whose own distanceFromStartMetres is closest to
 * `total * fraction` — used to pick a genuinely interior point on a
 * fixture without hand-deriving coordinates. */
function pointNearFraction(
  points: readonly RoutePoint[],
  total: number,
  fraction: number,
): RoutePoint {
  const target = total * fraction;
  return points.reduce((closest, point) =>
    Math.abs(point.distanceFromStartMetres - target) <
    Math.abs(closest.distanceFromStartMetres - target)
      ? point
      : closest,
  );
}

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

function baseArmingInput(
  overrides: Partial<RouteArmingFixInput> = {},
): RouteArmingFixInput {
  return {
    isRideActive: true,
    isStale: false,
    currentCoordinate: OPEN_ROUTE_START,
    currentAccuracyMetres: 8,
    reliableDistanceFromStartMetres: OPEN_ROUTE_TOTAL * 0.5,
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

describe("isRouteArmingFixEligible", () => {
  it("is eligible when genuinely departed and at credible interior progress", () => {
    expect(isRouteArmingFixEligible(baseArmingInput())).toBe(true);
  });

  it("is not eligible when still near the finish (departure fails)", () => {
    expect(
      isRouteArmingFixEligible(baseArmingInput({ currentCoordinate: OPEN_ROUTE_FINAL })),
    ).toBe(false);
  });

  it("is not eligible when progress is below the interior minimum fraction", () => {
    expect(
      isRouteArmingFixEligible(
        baseArmingInput({ reliableDistanceFromStartMetres: OPEN_ROUTE_TOTAL * 0.05 }),
      ),
    ).toBe(false);
  });

  it("is not eligible when progress is above the interior maximum fraction — a direct jump to near-total progress is never credible interior progress", () => {
    expect(
      isRouteArmingFixEligible(
        baseArmingInput({ reliableDistanceFromStartMetres: OPEN_ROUTE_TOTAL * 0.95 }),
      ),
    ).toBe(false);
  });

  it("is not eligible for a stale fix", () => {
    expect(isRouteArmingFixEligible(baseArmingInput({ isStale: true }))).toBe(false);
  });

  it("is not eligible when the ride isn't actively tracking", () => {
    expect(isRouteArmingFixEligible(baseArmingInput({ isRideActive: false }))).toBe(
      false,
    );
  });

  it("rejects an untrusted fix outright regardless of departure distance", () => {
    expect(
      isRouteArmingFixEligible(
        baseArmingInput({ currentAccuracyMetres: MAX_TRUSTED_ACCURACY_METRES + 1 }),
      ),
    ).toBe(false);
  });

  it("is not eligible for an invalid coordinate or non-finite distance", () => {
    expect(isRouteArmingFixEligible(baseArmingInput({ currentCoordinate: null }))).toBe(
      false,
    );
    expect(
      isRouteArmingFixEligible(baseArmingInput({ routeFinalCoordinate: null })),
    ).toBe(false);
    expect(
      isRouteArmingFixEligible(
        baseArmingInput({ reliableDistanceFromStartMetres: null }),
      ),
    ).toBe(false);
    expect(
      isRouteArmingFixEligible(baseArmingInput({ routeTotalDistanceMetres: NaN })),
    ).toBe(false);
    expect(
      isRouteArmingFixEligible(baseArmingInput({ routeTotalDistanceMetres: 0 })),
    ).toBe(false);
    expect(
      isRouteArmingFixEligible(
        baseArmingInput({ currentCoordinate: [NaN, NaN] as Coordinate }),
      ),
    ).toBe(false);
  });

  it("caps how much a poor-but-trusted accuracy reading can shrink the effective departure radius — the OPPOSITE direction from completion's own cap", () => {
    // Unlike completion's cap (which stops a poor-accuracy fix being
    // wrongly ADMITTED from too far away), this cap stops a poor-accuracy
    // fix facing an unreasonably INFLATED exclusion zone: with accuracy
    // capped at ROUTE_COMPLETION_ARMING_DEPARTURE_MAX_ACCURACY_ALLOWANCE_METRES
    // (50m) rather than the raw 90m, a fix ~140m from the finish clears the
    // capped radius (75+50=125m) even though it would NOT have cleared an
    // uncapped one (75+90=165m).
    const cappedRadius =
      75 + ROUTE_COMPLETION_ARMING_DEPARTURE_MAX_ACCURACY_ALLOWANCE_METRES;
    const uncappedRadius = 75 + 90;
    expect(cappedRadius).toBeLessThan(uncappedRadius);

    const offsetPoints = buildRoutePointsFromWaypoints(
      [OPEN_ROUTE_FINAL, [OPEN_ROUTE_FINAL[0] + 0.002, OPEN_ROUTE_FINAL[1]]],
      1,
    );
    const nearlyFarCoordinate = offsetPoints.at(-1)?.coordinate ?? [0, 51];
    const departureDistance = Math.abs(nearlyFarCoordinate[0] - OPEN_ROUTE_FINAL[0]);
    expect(departureDistance).toBeGreaterThan(0); // sanity: coordinates actually differ

    expect(
      isRouteArmingFixEligible(
        baseArmingInput({
          currentCoordinate: nearlyFarCoordinate,
          currentAccuracyMetres: 90,
        }),
      ),
    ).toBe(true);
  });
});

/** Dispatches enough genuinely arming-eligible fix-evaluated events to a
 * fresh tracker state to arm it, isolating completion-streak/dismiss
 * behaviour from the arming gate itself. */
function armedState(): RouteCompletionTrackerState {
  let state = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
  for (let i = 0; i < ROUTE_COMPLETION_ARMING_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
    state = routeCompletionTrackerReducer(state, {
      type: "fix-evaluated",
      armingEligible: true,
      completionEligible: false,
    });
  }
  return state;
}

describe("routeCompletionTrackerReducer / isRouteCompletionConfirmed", () => {
  it("armedState() helper is actually armed with no completion evidence yet", () => {
    const state = armedState();
    expect(state.isArmed).toBe(true);
    expect(state.consecutiveEligibleCount).toBe(0);
  });

  describe("completion streak (once armed)", () => {
    it("does not confirm after a single eligible fix", () => {
      const state = routeCompletionTrackerReducer(armedState(), {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: true,
      });
      expect(isRouteCompletionConfirmed(state)).toBe(false);
    });

    it("confirms after the required consecutive eligible fixes", () => {
      let state = armedState();
      for (let i = 0; i < ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
        state = routeCompletionTrackerReducer(state, {
          type: "fix-evaluated",
          armingEligible: false,
          completionEligible: true,
        });
      }
      expect(isRouteCompletionConfirmed(state)).toBe(true);
    });

    it("resets the candidate count on an ineligible fix", () => {
      let state = armedState();
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: true,
      });
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: false,
      });
      expect(state.consecutiveEligibleCount).toBe(0);
      expect(isRouteCompletionConfirmed(state)).toBe(false);
    });

    it("dismiss suppresses confirmation even once the count is satisfied", () => {
      let state = armedState();
      for (let i = 0; i < ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
        state = routeCompletionTrackerReducer(state, {
          type: "fix-evaluated",
          armingEligible: false,
          completionEligible: true,
        });
      }
      state = routeCompletionTrackerReducer(state, { type: "dismiss" });
      expect(isRouteCompletionConfirmed(state)).toBe(false);
      expect(state.consecutiveEligibleCount).toBe(
        ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED,
      );
    });

    it("reset clears the count, the dismissal AND the armed state", () => {
      let state = armedState();
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: true,
      });
      state = routeCompletionTrackerReducer(state, { type: "dismiss" });
      state = routeCompletionTrackerReducer(state, { type: "reset" });
      expect(state).toEqual(INITIAL_ROUTE_COMPLETION_TRACKER_STATE);
      expect(state.isArmed).toBe(false);
      expect(state.consecutiveArmingEligibleCount).toBe(0);
      expect(isRouteCompletionConfirmed(state)).toBe(false);
    });
  });

  describe("arming gate", () => {
    it("a hostile closed-loop start projection stays unarmed and never confirms, regardless of how many fixes arrive", () => {
      const hostileInput = {
        currentCoordinate: CLOSED_LOOP_START,
        currentAccuracyMetres: 8,
        // Deliberately misreported near-total progress — the exact
        // whole-route-reacquire-on-first-fix hostile scenario this gate
        // exists to guard against.
        reliableDistanceFromStartMetres: CLOSED_LOOP_TOTAL,
        routeTotalDistanceMetres: CLOSED_LOOP_TOTAL,
        routeFinalCoordinate: CLOSED_LOOP_FINAL,
      };
      const armingEligible = isRouteArmingFixEligible({
        isRideActive: true,
        isStale: false,
        ...hostileInput,
      });
      const completionEligible = isRouteCompletionCandidateEligible({
        isRideActive: true,
        isStale: false,
        offRouteLevel: "on-route",
        ...hostileInput,
      });
      // The completion predicate alone WOULD consider this eligible (the
      // exact hole this gate closes) — confirmed directly, not assumed.
      expect(completionEligible).toBe(true);
      expect(armingEligible).toBe(false);

      let state = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
      for (let i = 0; i < 5; i += 1) {
        state = routeCompletionTrackerReducer(state, {
          type: "fix-evaluated",
          armingEligible,
          completionEligible,
        });
      }
      expect(state.isArmed).toBe(false);
      expect(state.consecutiveEligibleCount).toBe(0);
      expect(isRouteCompletionConfirmed(state)).toBe(false);
    });

    it("stationary jitter around the endpoint with misleading near-total progress never arms", () => {
      let state = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
      const jitterOffsets: Coordinate[] = [
        [0.00001, 0],
        [-0.00001, 0.00001],
        [0, -0.00001],
      ];
      for (const [dLon, dLat] of jitterOffsets) {
        const coordinate: Coordinate = [
          CLOSED_LOOP_START[0] + dLon,
          CLOSED_LOOP_START[1] + dLat,
        ];
        const armingEligible = isRouteArmingFixEligible({
          isRideActive: true,
          isStale: false,
          currentCoordinate: coordinate,
          currentAccuracyMetres: 8,
          reliableDistanceFromStartMetres: CLOSED_LOOP_TOTAL,
          routeTotalDistanceMetres: CLOSED_LOOP_TOTAL,
          routeFinalCoordinate: CLOSED_LOOP_FINAL,
        });
        state = routeCompletionTrackerReducer(state, {
          type: "fix-evaluated",
          armingEligible,
          completionEligible: false,
        });
      }
      expect(state.isArmed).toBe(false);
    });

    it("a single false departure fix followed by an ineligible fix resets the arming streak", () => {
      const interiorPoint = pointNearFraction(CLOSED_LOOP_POINTS, CLOSED_LOOP_TOTAL, 0.5);
      const genuineArmingEligible = isRouteArmingFixEligible({
        isRideActive: true,
        isStale: false,
        currentCoordinate: interiorPoint.coordinate,
        currentAccuracyMetres: 8,
        reliableDistanceFromStartMetres: interiorPoint.distanceFromStartMetres,
        routeTotalDistanceMetres: CLOSED_LOOP_TOTAL,
        routeFinalCoordinate: CLOSED_LOOP_FINAL,
      });
      expect(genuineArmingEligible).toBe(true);

      let state = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        armingEligible: true,
        completionEligible: false,
      });
      expect(state.consecutiveArmingEligibleCount).toBe(1);
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: false,
      });
      expect(state.consecutiveArmingEligibleCount).toBe(0);
      expect(state.isArmed).toBe(false);
    });

    it("legitimate arming flips isArmed exactly once and it never flips back", () => {
      let state = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
      for (let i = 0; i < ROUTE_COMPLETION_ARMING_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
        state = routeCompletionTrackerReducer(state, {
          type: "fix-evaluated",
          armingEligible: true,
          completionEligible: false,
        });
      }
      expect(state.isArmed).toBe(true);

      // Further ineligible or eligible arming evidence never un-arms.
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: false,
      });
      expect(state.isArmed).toBe(true);
      state = routeCompletionTrackerReducer(state, {
        type: "fix-evaluated",
        armingEligible: true,
        completionEligible: false,
      });
      expect(state.isArmed).toBe(true);
    });

    it("completion still requires every existing gate once armed", () => {
      const base = armedState();

      // Near-total progress without endpoint proximity.
      let state = routeCompletionTrackerReducer(base, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: isRouteCompletionCandidateEligible(
          baseInput({ currentCoordinate: OPEN_ROUTE_START }),
        ),
      });
      expect(isRouteCompletionConfirmed(state)).toBe(false);

      // Endpoint proximity without near-total progress.
      state = routeCompletionTrackerReducer(base, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: isRouteCompletionCandidateEligible(
          baseInput({ reliableDistanceFromStartMetres: OPEN_ROUTE_TOTAL / 2 }),
        ),
      });
      expect(isRouteCompletionConfirmed(state)).toBe(false);

      // Stale fix.
      state = routeCompletionTrackerReducer(base, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: isRouteCompletionCandidateEligible(
          baseInput({ isStale: true }),
        ),
      });
      expect(isRouteCompletionConfirmed(state)).toBe(false);

      // Untrusted accuracy.
      state = routeCompletionTrackerReducer(base, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: isRouteCompletionCandidateEligible(
          baseInput({ currentAccuracyMetres: MAX_TRUSTED_ACCURACY_METRES + 1 }),
        ),
      });
      expect(isRouteCompletionConfirmed(state)).toBe(false);

      // Only one of the required consecutive completion fixes.
      state = routeCompletionTrackerReducer(base, {
        type: "fix-evaluated",
        armingEligible: false,
        completionEligible: true,
      });
      expect(isRouteCompletionConfirmed(state)).toBe(false);
    });

    it("legitimate closed-loop completion: arm via interior progress, then complete at the endpoint", () => {
      const interiorPoint = pointNearFraction(CLOSED_LOOP_POINTS, CLOSED_LOOP_TOTAL, 0.5);
      let state = INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
      for (let i = 0; i < ROUTE_COMPLETION_ARMING_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
        const armingEligible = isRouteArmingFixEligible({
          isRideActive: true,
          isStale: false,
          currentCoordinate: interiorPoint.coordinate,
          currentAccuracyMetres: 8,
          reliableDistanceFromStartMetres: interiorPoint.distanceFromStartMetres,
          routeTotalDistanceMetres: CLOSED_LOOP_TOTAL,
          routeFinalCoordinate: CLOSED_LOOP_FINAL,
        });
        state = routeCompletionTrackerReducer(state, {
          type: "fix-evaluated",
          armingEligible,
          completionEligible: false,
        });
      }
      expect(state.isArmed).toBe(true);

      for (let i = 0; i < ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
        const completionEligible = isRouteCompletionCandidateEligible({
          isRideActive: true,
          isStale: false,
          offRouteLevel: "on-route",
          currentCoordinate: CLOSED_LOOP_FINAL,
          currentAccuracyMetres: 8,
          reliableDistanceFromStartMetres: CLOSED_LOOP_TOTAL,
          routeTotalDistanceMetres: CLOSED_LOOP_TOTAL,
          routeFinalCoordinate: CLOSED_LOOP_FINAL,
        });
        state = routeCompletionTrackerReducer(state, {
          type: "fix-evaluated",
          armingEligible: false,
          completionEligible,
        });
      }
      expect(isRouteCompletionConfirmed(state)).toBe(true);
      // This pure module has no side effects — nothing here ever calls
      // storage; confirmation is purely a derived boolean.
    });

    it("overlapping geometry: an out-and-back route neither arms nor completes at an early pass near the shared start/finish, but does arm at the genuine turnaround", () => {
      const start = OUT_AND_BACK_ROUTE_POINTS[0];
      const final = OUT_AND_BACK_ROUTE_POINTS.at(-1);
      const turnaround = OUT_AND_BACK_ROUTE_POINTS[OUT_AND_BACK_TURNAROUND_INDEX];
      expect(start).toBeDefined();
      expect(final).toBeDefined();
      expect(turnaround).toBeDefined();
      if (!start || !final || !turnaround) return;

      const earlyArmingEligible = isRouteArmingFixEligible({
        isRideActive: true,
        isStale: false,
        currentCoordinate: start.coordinate,
        currentAccuracyMetres: 8,
        reliableDistanceFromStartMetres: start.distanceFromStartMetres,
        routeTotalDistanceMetres: final.distanceFromStartMetres,
        routeFinalCoordinate: final.coordinate,
      });
      expect(earlyArmingEligible).toBe(false);

      let state = routeCompletionTrackerReducer(INITIAL_ROUTE_COMPLETION_TRACKER_STATE, {
        type: "fix-evaluated",
        armingEligible: earlyArmingEligible,
        completionEligible: false,
      });
      expect(state.isArmed).toBe(false);

      const turnaroundArmingEligible = isRouteArmingFixEligible({
        isRideActive: true,
        isStale: false,
        currentCoordinate: turnaround.coordinate,
        currentAccuracyMetres: 8,
        reliableDistanceFromStartMetres: turnaround.distanceFromStartMetres,
        routeTotalDistanceMetres: final.distanceFromStartMetres,
        routeFinalCoordinate: final.coordinate,
      });
      expect(turnaroundArmingEligible).toBe(true);

      for (let i = 0; i < ROUTE_COMPLETION_ARMING_CONSECUTIVE_FIXES_REQUIRED; i += 1) {
        state = routeCompletionTrackerReducer(state, {
          type: "fix-evaluated",
          armingEligible: turnaroundArmingEligible,
          completionEligible: false,
        });
      }
      expect(state.isArmed).toBe(true);
    });

    it("overlapping geometry: a self-intersecting route's early crossing satisfies neither arming nor completion", () => {
      const earlyPoint = SELF_INTERSECTING_ROUTE_POINTS[5];
      const final = SELF_INTERSECTING_ROUTE_POINTS.at(-1);
      expect(earlyPoint).toBeDefined();
      expect(final).toBeDefined();
      if (!earlyPoint || !final) return;

      const armingEligible = isRouteArmingFixEligible({
        isRideActive: true,
        isStale: false,
        currentCoordinate: earlyPoint.coordinate,
        currentAccuracyMetres: 8,
        reliableDistanceFromStartMetres: earlyPoint.distanceFromStartMetres,
        routeTotalDistanceMetres: final.distanceFromStartMetres,
        routeFinalCoordinate: final.coordinate,
      });
      const completionEligible = isRouteCompletionCandidateEligible({
        isRideActive: true,
        isStale: false,
        offRouteLevel: "on-route",
        currentCoordinate: earlyPoint.coordinate,
        currentAccuracyMetres: 8,
        reliableDistanceFromStartMetres: earlyPoint.distanceFromStartMetres,
        routeTotalDistanceMetres: final.distanceFromStartMetres,
        routeFinalCoordinate: final.coordinate,
      });
      expect(armingEligible).toBe(false);
      expect(completionEligible).toBe(false);
    });
  });
});
