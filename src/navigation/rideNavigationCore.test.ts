import { describe, expect, it } from "vitest";
import {
  INITIAL_RIDE_NAVIGATION_CORE_STATE,
  processFix,
  type RideNavigationCoreState,
} from "./rideNavigationCore.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import { OFF_ROUTE_BASE_METRES, POSSIBLY_OFF_ROUTE_BASE_METRES } from "./offRoute.ts";

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
});
