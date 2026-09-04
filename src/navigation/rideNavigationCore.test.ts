import { describe, expect, it } from "vitest";
import {
  INITIAL_RIDE_NAVIGATION_CORE_STATE,
  processFix,
  type RideNavigationCoreState,
} from "./rideNavigationCore.ts";
import type { ProjectionResult } from "./types.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import { CLOSED_LOOP_ROUTE_POINTS } from "../test/fixtures/closedLoopRoute.ts";
import { OFF_ROUTE_BASE_METRES, POSSIBLY_OFF_ROUTE_BASE_METRES } from "./offRoute.ts";
import {
  OUT_AND_BACK_COINCIDENT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX,
} from "../test/fixtures/outAndBackCoincidentRoute.ts";
import type { ProjectionMatch } from "./types.ts";

const ROUTE_POINTS = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
);

describe("processFix", () => {
  it("returns the input state unchanged when the route has fewer than 2 points", () => {
    const result = processFix([], [0, 51], 5, INITIAL_RIDE_NAVIGATION_CORE_STATE);
    expect(result.coreState).toBe(INITIAL_RIDE_NAVIGATION_CORE_STATE);
    expect(result.projection).toBeNull();
  });

  it("projects the fix and starts on-route for a fix directly on the route", () => {
    const firstPoint = ROUTE_POINTS[0];
    if (!firstPoint) throw new Error("fixture missing point");

    const result = processFix(
      ROUTE_POINTS,
      firstPoint.coordinate,
      5,
      INITIAL_RIDE_NAVIGATION_CORE_STATE,
    );

    expect(result.projection?.lateralDistanceMetres).toBeLessThan(1);
    expect(result.coreState.offRouteMachineState.level).toBe("on-route");
    expect(result.coreState.lastMatch).not.toBeNull();
  });

  it("escalates to off-route only after enough consecutive far fixes", () => {
    const onRoutePoint = ROUTE_POINTS[5];
    if (!onRoutePoint) throw new Error("fixture missing point");
    const farCoordinate: [number, number] = [
      0.005,
      51 + OFF_ROUTE_BASE_METRES / 111_000 + 0.001,
    ];

    // Prime lastMatch with an on-route fix first: a fix with no prior
    // match always does a whole-route reacquire search, which is itself
    // always treated as untrusted and so wouldn't count toward a streak.
    let state: RideNavigationCoreState = processFix(
      ROUTE_POINTS,
      onRoutePoint.coordinate,
      5,
      INITIAL_RIDE_NAVIGATION_CORE_STATE,
    ).coreState;

    for (let i = 0; i < 2; i += 1) {
      state = processFix(ROUTE_POINTS, farCoordinate, 5, state).coreState;
      expect(state.offRouteMachineState.level).toBe("on-route");
    }
    state = processFix(ROUTE_POINTS, farCoordinate, 5, state).coreState;
    expect(state.offRouteMachineState.level).toBe("off-route");
  });

  it("carries the matched distance forward across consecutive fixes", () => {
    const first = ROUTE_POINTS[5];
    const second = ROUTE_POINTS[6];
    if (!first || !second) throw new Error("fixture missing points");

    const afterFirst = processFix(
      ROUTE_POINTS,
      first.coordinate,
      5,
      INITIAL_RIDE_NAVIGATION_CORE_STATE,
    );
    const afterSecond = processFix(
      ROUTE_POINTS,
      second.coordinate,
      5,
      afterFirst.coreState,
    );

    expect(afterSecond.coreState.lastMatch?.distanceFromStartMetres ?? 0).toBeGreaterThan(
      afterFirst.coreState.lastMatch?.distanceFromStartMetres ?? 0,
    );
  });

  describe("lastReliableMatch", () => {
    const onRoutePoint = ROUTE_POINTS[5];
    if (!onRoutePoint) throw new Error("fixture missing point");
    const farCoordinate: [number, number] = [
      0.005,
      51 + OFF_ROUTE_BASE_METRES / 111_000 + 0.001,
    ];

    it("advances alongside lastMatch while on-route", () => {
      const result = processFix(
        ROUTE_POINTS,
        onRoutePoint.coordinate,
        5,
        INITIAL_RIDE_NAVIGATION_CORE_STATE,
      );

      expect(result.coreState.offRouteMachineState.level).toBe("on-route");
      expect(result.coreState.lastReliableMatch).toEqual(result.coreState.lastMatch);
    });

    it("freezes from the first raw off-route fix, before the debounced warning escalates, then resumes on the very next good fix", () => {
      // Prime with an on-route fix so lastReliableMatch has a known value.
      let state: RideNavigationCoreState = processFix(
        ROUTE_POINTS,
        onRoutePoint.coordinate,
        5,
        INITIAL_RIDE_NAVIGATION_CORE_STATE,
      ).coreState;
      const reliableWhileOnRoute = state.lastReliableMatch;
      expect(reliableWhileOnRoute).not.toBeNull();

      // First far fix: raw classification is already "off-route" (that's
      // how this fixture is constructed), even though the *debounced*
      // offRouteMachineState.level needs 3 consecutive fixes to escalate
      // and still reads "on-route" here. lastReliableMatch freezes
      // immediately rather than waiting for the debounce, since by the
      // time the debounce catches up lastMatch may already have advanced
      // to an unrelated nearby section.
      state = processFix(ROUTE_POINTS, farCoordinate, 5, state).coreState;
      expect(state.offRouteMachineState.level).toBe("on-route");
      expect(state.lastReliableMatch).toEqual(reliableWhileOnRoute);
      expect(state.lastMatch).not.toEqual(reliableWhileOnRoute);

      // Two more far fixes complete the escalation to a displayed
      // off-route warning; lastReliableMatch stays pinned throughout.
      for (let i = 0; i < 2; i += 1) {
        state = processFix(ROUTE_POINTS, farCoordinate, 5, state).coreState;
      }
      expect(state.offRouteMachineState.level).toBe("off-route");
      expect(state.lastReliableMatch).toEqual(reliableWhileOnRoute);

      // Recover: the very next fix whose raw classification isn't
      // "off-route" immediately resumes lastReliableMatch, ahead of the
      // debounced level (which still needs 2 consecutive fixes to flip the
      // displayed warning back to "on-route").
      state = processFix(ROUTE_POINTS, onRoutePoint.coordinate, 5, state).coreState;
      expect(state.lastReliableMatch).toEqual(state.lastMatch);
      expect(state.lastReliableMatch).not.toEqual(reliableWhileOnRoute);
    });

    it("does not freeze while only possibly-off-route", () => {
      // Comfortably between the possibly (20 m) and off-route (50 m)
      // thresholds at 5 m reported accuracy.
      const possiblyFarCoordinate: [number, number] = [
        0.005,
        51 + (POSSIBLY_OFF_ROUTE_BASE_METRES + OFF_ROUTE_BASE_METRES) / 2 / 111_000,
      ];

      const state: RideNavigationCoreState = processFix(
        ROUTE_POINTS,
        onRoutePoint.coordinate,
        5,
        INITIAL_RIDE_NAVIGATION_CORE_STATE,
      ).coreState;

      const result = processFix(ROUTE_POINTS, possiblyFarCoordinate, 5, state);
      expect(result.coreState.offRouteMachineState.level).not.toBe("off-route");
      expect(result.coreState.lastReliableMatch).toEqual(result.coreState.lastMatch);
    });
  });

  describe("closed loop", () => {
    it("keeps lastMatch and lastReliableMatch advancing near the shared start/finish coordinate, with no reacquire at the finish", () => {
      // Regression coverage one layer above projection.test.ts's own
      // direct proof: walks every fixture point through processFix in
      // sequence (mirroring how real fixes arrive), confirming the fixed
      // projection layer's correctness survives into the values Riding
      // actually presents. Deliberately does NOT assert on
      // offRouteMachineState staying "on-route" as a proxy for "no false
      // reacquire" — a reacquired fix classifies as "untrusted", not
      // "off-route", and nextOffRouteState leaves the machine's state
      // completely unchanged on "untrusted" either way, so that assertion
      // would not have caught the original bug (it's exactly why the
      // field defect produced no off-route warning at all).
      let state: RideNavigationCoreState = INITIAL_RIDE_NAVIGATION_CORE_STATE;
      let lastProjection: ProjectionResult | null = null;

      for (const routePoint of CLOSED_LOOP_ROUTE_POINTS) {
        const previousMatchDistance = state.lastMatch?.distanceFromStartMetres ?? 0;
        const previousReliableDistance =
          state.lastReliableMatch?.distanceFromStartMetres ?? 0;

        const result = processFix(
          CLOSED_LOOP_ROUTE_POINTS,
          routePoint.coordinate,
          5,
          state,
        );

        expect(
          result.coreState.lastMatch?.distanceFromStartMetres ?? 0,
        ).toBeGreaterThanOrEqual(previousMatchDistance);
        expect(
          result.coreState.lastReliableMatch?.distanceFromStartMetres ?? 0,
        ).toBeGreaterThanOrEqual(previousReliableDistance);

        state = result.coreState;
        lastProjection = result.projection;
      }

      const routeTotalDistanceMetres =
        CLOSED_LOOP_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0;

      expect(lastProjection?.reacquired).toBe(false);
      expect(state.lastMatch?.distanceFromStartMetres).toBeCloseTo(
        routeTotalDistanceMetres,
        0,
      );
      expect(state.lastReliableMatch?.distanceFromStartMetres).toBeCloseTo(
        routeTotalDistanceMetres,
        0,
      );
    });
  });

  describe("out-and-back with an exactly coincident return leg (backlog item 104)", () => {
    const POINTS = OUT_AND_BACK_COINCIDENT_ROUTE_POINTS;
    const TURNAROUND_INDEX = OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX;
    const T = POINTS[TURNAROUND_INDEX]?.distanceFromStartMetres ?? 0;

    it("keeps lastMatch and lastReliableMatch advancing through approach, the turnaround and the return leg, with no false reacquire", () => {
      let state: RideNavigationCoreState = INITIAL_RIDE_NAVIGATION_CORE_STATE;

      for (const routePoint of POINTS) {
        const previousMatchDistance = state.lastMatch?.distanceFromStartMetres ?? 0;
        const previousReliableDistance =
          state.lastReliableMatch?.distanceFromStartMetres ?? 0;

        const result = processFix(POINTS, routePoint.coordinate, 5, state);

        expect(
          result.coreState.lastMatch?.distanceFromStartMetres ?? 0,
        ).toBeGreaterThanOrEqual(previousMatchDistance);
        expect(
          result.coreState.lastReliableMatch?.distanceFromStartMetres ?? 0,
        ).toBeGreaterThanOrEqual(previousReliableDistance);

        state = result.coreState;
      }

      const routeTotalDistanceMetres = POINTS.at(-1)?.distanceFromStartMetres ?? 0;
      expect(state.lastMatch?.distanceFromStartMetres).toBeCloseTo(
        routeTotalDistanceMetres,
        0,
      );
      expect(state.lastReliableMatch?.distanceFromStartMetres).toBeCloseTo(
        routeTotalDistanceMetres,
        0,
      );
    });

    it("distinguishes raw classification from the debounced level through a beyond-turn excursion, and resumes reliable progress on the return leg", () => {
      // Seeded directly (not via a fresh reacquire, which is itself
      // ambiguous on this exactly-coincident fixture — see
      // outAndBackCoincidentRoute.ts's own module comment) at a known
      // point 5 m short of the turnaround, already on-route.
      const seedMatch: ProjectionMatch = {
        pointIndex: TURNAROUND_INDEX - 1,
        distanceFromStartMetres: T - 5,
      };
      let state: RideNavigationCoreState = {
        lastMatch: seedMatch,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatch: seedMatch,
      };

      // Reach the turnaround exactly.
      const atTurnaround = processFix(
        POINTS,
        POINTS[TURNAROUND_INDEX]?.coordinate ?? [0, 51],
        5,
        state,
      );
      state = atTurnaround.coreState;
      expect(state.offRouteMachineState.level).toBe("on-route");
      expect(state.lastMatch?.distanceFromStartMetres).toBeCloseTo(T, 0);

      // Continue ~100 m past the turnaround in the original outbound
      // direction — off the route entirely. CONSECUTIVE_TO_ESCALATE (3)
      // consecutive raw off-route fixes are required before the
      // debounced, displayed level flips; lastReliableMatch freezes from
      // the FIRST one regardless (existing, unrelated behaviour).
      const overshootCoordinate: [number, number] = [
        0.03 + 100 / (111_320 * Math.cos((51 * Math.PI) / 180)),
        51,
      ];
      const reliableAtTurnaround = state.lastReliableMatch;

      for (let i = 0; i < 2; i += 1) {
        const step = processFix(POINTS, overshootCoordinate, 5, state);
        state = step.coreState;
        expect(state.offRouteMachineState.level).toBe("on-route");
        expect(state.lastReliableMatch).toEqual(reliableAtTurnaround);
      }
      const thirdOvershoot = processFix(POINTS, overshootCoordinate, 5, state);
      state = thirdOvershoot.coreState;
      expect(state.offRouteMachineState.level).toBe("off-route");
      expect(state.lastReliableMatch).toEqual(reliableAtTurnaround);

      // Turn back for real: a genuine return-leg fix clears the debounced
      // warning (per the existing, unmodified off-route recovery rules)
      // and lastMatch/lastReliableMatch both resume, advancing beyond the
      // turnaround on the return leg rather than reverting to the
      // outbound occurrence.
      const backOnReturn = processFix(
        POINTS,
        POINTS[TURNAROUND_INDEX + 3]?.coordinate ?? [0, 51],
        5,
        state,
      );
      state = backOnReturn.coreState;
      expect(state.lastMatch?.distanceFromStartMetres ?? 0).toBeGreaterThan(T);
      expect(state.lastReliableMatch?.distanceFromStartMetres ?? 0).toBeGreaterThan(
        reliableAtTurnaround?.distanceFromStartMetres ?? 0,
      );
    });
  });
});
