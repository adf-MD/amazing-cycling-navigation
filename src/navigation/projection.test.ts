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

const STRAIGHT_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
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
  });
});
