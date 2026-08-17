import { describe, expect, it } from "vitest";
import { projectFixOntoRoute } from "./projection.ts";
import type { ProjectionMatch, ProjectionResult } from "./types.ts";
import type { Coordinate, RoutePoint } from "../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import {
  OUT_AND_BACK_ROUTE_POINTS,
  OUT_AND_BACK_TURNAROUND_INDEX,
} from "../test/fixtures/outAndBackRoute.ts";
import { SELF_INTERSECTING_ROUTE_POINTS } from "../test/fixtures/selfIntersectingRoute.ts";
import { CLOSED_LOOP_ROUTE_POINTS } from "../test/fixtures/closedLoopRoute.ts";

const STRAIGHT_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
);

/** A longer straight route (~3.5 km) — long enough that a lastMatch placed
 * mid-route produces a WINDOW_RADIUS_METRES (400 m) window genuinely
 * clipped on BOTH sides, for exercising isClippedAtEdge's two edges
 * independently of one another. */
const LONG_STRAIGHT_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.05, 51],
  ],
  100,
);

function expectResult(result: ProjectionResult | null): ProjectionResult {
  if (result === null) {
    throw new Error("expected a projection result");
  }
  return result;
}

/** Walks fixes (exactly at each route point) through the whole route in
 * order, feeding each result's match back in as the next lastMatch, and
 * returns every result in sequence. */
function walkRoute(points: readonly RoutePoint[]): ProjectionResult[] {
  const results: ProjectionResult[] = [];
  let lastMatch: ProjectionMatch | null = null;

  for (const routePoint of points) {
    const result = expectResult(
      projectFixOntoRoute(routePoint.coordinate, points, lastMatch),
    );
    results.push(result);
    lastMatch = result;
  }

  return results;
}

describe("projectFixOntoRoute", () => {
  it("returns null for a route with fewer than 2 points", () => {
    expect(projectFixOntoRoute([0, 51], [], null)).toBeNull();
    expect(
      projectFixOntoRoute(
        [0, 51],
        [{ coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 }],
        null,
      ),
    ).toBeNull();
  });

  it("matches a fix exactly on the route with ~0 lateral distance", () => {
    const midpoint = STRAIGHT_ROUTE_POINTS[10];
    if (!midpoint) throw new Error("fixture missing expected point");

    const result = expectResult(
      projectFixOntoRoute(midpoint.coordinate, STRAIGHT_ROUTE_POINTS, null),
    );

    expect(result.lateralDistanceMetres).toBeLessThan(0.01);
    expect(result.distanceFromStartMetres).toBeCloseTo(
      midpoint.distanceFromStartMetres,
      1,
    );
    expect(result.reacquired).toBe(true); // no lastMatch => whole-route search
  });

  it("finds a fix offset a small distance to the side of the route", () => {
    const fixCoordinate: Coordinate = [0.005, 51.0005];
    const result = expectResult(
      projectFixOntoRoute(fixCoordinate, STRAIGHT_ROUTE_POINTS, null),
    );

    expect(result.lateralDistanceMetres).toBeGreaterThan(0);
    expect(result.lateralDistanceMetres).toBeLessThan(100);
  });

  describe("continuity", () => {
    it("keeps distanceFromStartMetres monotonically increasing through a self-intersection", () => {
      const results = walkRoute(SELF_INTERSECTING_ROUTE_POINTS);

      for (let i = 1; i < results.length; i += 1) {
        const previous = results[i - 1];
        const current = results[i];
        expect(current?.distanceFromStartMetres).toBeGreaterThanOrEqual(
          previous?.distanceFromStartMetres ?? 0,
        );
      }
    });

    it("stays locked to each pass near the self-intersection rather than jumping to the other one", () => {
      const results = walkRoute(SELF_INTERSECTING_ROUTE_POINTS);

      // Walking forward, the matched point index should never regress by
      // more than a small amount (no snapping back to the earlier pass).
      for (let i = 1; i < results.length; i += 1) {
        const previous = results[i - 1];
        const current = results[i];
        expect(current?.pointIndex ?? 0).toBeGreaterThanOrEqual(
          (previous?.pointIndex ?? 0) - 1,
        );
      }
    });

    it("keeps distanceFromStartMetres monotonically increasing on an out-and-back route", () => {
      const results = walkRoute(OUT_AND_BACK_ROUTE_POINTS);

      for (let i = 1; i < results.length; i += 1) {
        const previous = results[i - 1];
        const current = results[i];
        expect(current?.distanceFromStartMetres).toBeGreaterThanOrEqual(
          previous?.distanceFromStartMetres ?? 0,
        );
      }
    });

    it("stays on the return leg after the turnaround despite the outbound leg being geographically close", () => {
      const results = walkRoute(OUT_AND_BACK_ROUTE_POINTS);

      for (let i = OUT_AND_BACK_TURNAROUND_INDEX; i < results.length; i += 1) {
        expect(results[i]?.pointIndex ?? 0).toBeGreaterThanOrEqual(
          OUT_AND_BACK_TURNAROUND_INDEX - 1,
        );
      }
    });

    it("keeps distanceFromStartMetres monotonically increasing around a closed loop, including at the shared start/finish coordinate", () => {
      const results = walkRoute(CLOSED_LOOP_ROUTE_POINTS);

      for (let i = 1; i < results.length; i += 1) {
        const previous = results[i - 1];
        const current = results[i];
        expect(current?.distanceFromStartMetres).toBeGreaterThanOrEqual(
          previous?.distanceFromStartMetres ?? 0,
        );
      }
    });
  });

  describe("windowing and reacquire", () => {
    it("does not reacquire when the fix is a normal small step from the last match", () => {
      const first = expectResult(
        projectFixOntoRoute(
          STRAIGHT_ROUTE_POINTS[5]?.coordinate ?? [0, 51],
          STRAIGHT_ROUTE_POINTS,
          null,
        ),
      );
      const second = expectResult(
        projectFixOntoRoute(
          STRAIGHT_ROUTE_POINTS[6]?.coordinate ?? [0, 51],
          STRAIGHT_ROUTE_POINTS,
          first,
        ),
      );

      expect(second.reacquired).toBe(false);
    });

    it("reacquires via a whole-route search when the last match is far from the new fix", () => {
      const farAwayLastMatch: ProjectionMatch = {
        pointIndex: 0,
        distanceFromStartMetres: 0,
      };
      const farFixCoordinate = STRAIGHT_ROUTE_POINTS.at(-1)?.coordinate ?? [0, 51];

      const result = expectResult(
        projectFixOntoRoute(farFixCoordinate, STRAIGHT_ROUTE_POINTS, farAwayLastMatch),
      );

      expect(result.reacquired).toBe(true);
      expect(result.lateralDistanceMetres).toBeLessThan(1);
    });

    // Regression coverage for a real field defect: near a closed loop's
    // finish, the search window is clipped only on its lower (start) side
    // (there's nothing beyond the route's own total distance to clip on
    // the upper side). A windowed match sitting at the route's genuine,
    // un-clipped final boundary must not be rejected on the strength of
    // the unrelated lower-side clip — see isClippedAtEdge's own doc
    // comment in projection.ts.
    describe("closed-loop start/finish coincidence", () => {
      const lastMatchNearFinish: ProjectionMatch = {
        pointIndex: 79,
        distanceFromStartMetres:
          CLOSED_LOOP_ROUTE_POINTS[79]?.distanceFromStartMetres ?? 0,
      };
      const routeTotalDistanceMetres =
        CLOSED_LOOP_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0;

      it("does not fall back to a whole-route reacquire when the fix is exactly at the shared finish coordinate", () => {
        const finishCoordinate = CLOSED_LOOP_ROUTE_POINTS.at(-1)?.coordinate ?? [0, 51];

        const result = expectResult(
          projectFixOntoRoute(
            finishCoordinate,
            CLOSED_LOOP_ROUTE_POINTS,
            lastMatchNearFinish,
          ),
        );

        expect(result.reacquired).toBe(false);
        expect(result.distanceFromStartMetres).toBeCloseTo(routeTotalDistanceMetres, 0);
      });

      it("does not fall back to a whole-route reacquire when the fix is a few metres past the shared finish coordinate", () => {
        // ~16.7 m past [0, 51] continuing in the closing segment's own
        // direction of travel (decreasing latitude at longitude 0) — the
        // "rider continued a few metres past the finish looking for
        // parking" field scenario.
        const pastFinishCoordinate: Coordinate = [0, 50.99985];

        const result = expectResult(
          projectFixOntoRoute(
            pastFinishCoordinate,
            CLOSED_LOOP_ROUTE_POINTS,
            lastMatchNearFinish,
          ),
        );

        expect(result.reacquired).toBe(false);
        expect(result.distanceFromStartMetres).toBeCloseTo(routeTotalDistanceMetres, 0);
      });

      it("resolves a fresh ride's first fix at the shared coordinate to the start, not the finish", () => {
        // With no lastMatch, projectFixOntoRoute always does a whole-route
        // search — isClippedAtEdge is never reached, so this is unaffected
        // by the fix above and must keep working exactly as before. It
        // depends on @turf/nearest-point-on-line's own internal (strict
        // less-than) tie-break resolving an exact geometric coincidence to
        // the first-encountered vertex, i.e. the route's start — an
        // undocumented implementation detail, not a public contract, so a
        // future turf version bump (package.json pins it via a caret
        // range) that changes this result is a legible, expected flag
        // point for this test, not a mystery regression.
        const startCoordinate = CLOSED_LOOP_ROUTE_POINTS[0]?.coordinate ?? [0, 51];

        const result = expectResult(
          projectFixOntoRoute(startCoordinate, CLOSED_LOOP_ROUTE_POINTS, null),
        );

        expect(result.distanceFromStartMetres).toBeCloseTo(0, 0);
      });
    });

    describe("genuine window-edge clipping", () => {
      const lastMatchMidRoute: ProjectionMatch = {
        pointIndex: 50,
        distanceFromStartMetres:
          LONG_STRAIGHT_ROUTE_POINTS[50]?.distanceFromStartMetres ?? 0,
      };

      it("still reacquires when the windowed match sits at a genuinely clipped start edge", () => {
        const fixCoordinate = LONG_STRAIGHT_ROUTE_POINTS[36]?.coordinate ?? [0, 51];

        const result = expectResult(
          projectFixOntoRoute(
            fixCoordinate,
            LONG_STRAIGHT_ROUTE_POINTS,
            lastMatchMidRoute,
          ),
        );

        expect(result.reacquired).toBe(true);
      });

      it("still reacquires when the windowed match sits at a genuinely clipped end edge", () => {
        const fixCoordinate = LONG_STRAIGHT_ROUTE_POINTS[64]?.coordinate ?? [0, 51];

        const result = expectResult(
          projectFixOntoRoute(
            fixCoordinate,
            LONG_STRAIGHT_ROUTE_POINTS,
            lastMatchMidRoute,
          ),
        );

        expect(result.reacquired).toBe(true);
      });
    });
  });
});
