import { describe, expect, it } from "vitest";
import {
  deriveWaypointsFromRoute,
  MAX_DERIVED_WAYPOINTS,
} from "./deriveWaypointsFromRoute.ts";
import { cumulativeDistancesMetres, haversineDistanceMetres } from "./distance.ts";
import type { Coordinate, RoutePoint } from "../domain/types.ts";

function buildRoutePoints(coordinates: readonly Coordinate[]): RoutePoint[] {
  const distances = cumulativeDistancesMetres(coordinates);
  return coordinates.map((coordinate, index) => ({
    coordinate,
    elevationMetres: null,
    distanceFromStartMetres: distances[index] ?? 0,
  }));
}

/** Interpolates `count` evenly-spaced coordinates between two endpoints. */
function interpolateLine(
  start: Coordinate,
  end: Coordinate,
  count: number,
): Coordinate[] {
  const points: Coordinate[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    points.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
  }
  return points;
}

function expectNonNull<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a non-null, defined value");
  }
  return value;
}

function deriveOrThrow(points: readonly RoutePoint[]): Coordinate[] {
  return expectNonNull(deriveWaypointsFromRoute(points));
}

describe("deriveWaypointsFromRoute", () => {
  it("returns null for fewer than two points", () => {
    expect(deriveWaypointsFromRoute([])).toBeNull();
    expect(deriveWaypointsFromRoute(buildRoutePoints([[0, 51]]))).toBeNull();
  });

  it("returns null when every point is at the same coordinate", () => {
    const points = buildRoutePoints([
      [0, 51],
      [0, 51],
      [0, 51],
    ]);
    expect(deriveWaypointsFromRoute(points)).toBeNull();
  });

  it("returns null when coordinates are non-finite and fewer than two valid points remain", () => {
    const points: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
      { coordinate: [NaN, 51], elevationMetres: null, distanceFromStartMetres: 10 },
    ];
    expect(deriveWaypointsFromRoute(points)).toBeNull();
  });

  it("collapses a short straight route to its two endpoints", () => {
    const coordinates = interpolateLine([0, 51], [0.01, 51], 50);
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(coordinates[0]);
    expect(result[result.length - 1]).toEqual(coordinates[coordinates.length - 1]);
  });

  it("returns exactly the two endpoints for a very short valid route", () => {
    const coordinates: Coordinate[] = [
      [0, 51],
      [0.005, 51.003], // ~480m away — short, but well outside the loop-closure threshold
    ];
    const points = buildRoutePoints(coordinates);
    const result = deriveWaypointsFromRoute(points);
    expect(result).toEqual(coordinates);
  });

  it("inserts gap-fill anchors along a long, straight route", () => {
    // ~80km straight line: RDP alone would keep only the two endpoints, but
    // gap-filling should add intermediate anchors since consecutive
    // waypoints would otherwise be roughly 80km apart.
    const coordinates = interpolateLine([0, 51], [0.9, 51], 400);
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);

    expect(result.length).toBeGreaterThan(2);
    expect(result.length).toBeLessThanOrEqual(MAX_DERIVED_WAYPOINTS);
    expect(result[0]).toEqual(coordinates[0]);
    expect(result[result.length - 1]).toEqual(coordinates[coordinates.length - 1]);

    // No consecutive pair should be drastically farther apart than the
    // gap-fill target once filling has run.
    for (let i = 0; i < result.length - 1; i += 1) {
      const gap = haversineDistanceMetres(
        expectNonNull(result[i]),
        expectNonNull(result[i + 1]),
      );
      expect(gap).toBeLessThan(15_000);
    }
  });

  it("preserves several major bends as distinct waypoints", () => {
    const coordinates: Coordinate[] = [
      [0, 51],
      [0.05, 51],
      [0.05, 51.05],
      [0.1, 51.05],
      [0.1, 51],
      [0.15, 51],
    ];
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);

    expect(result[0]).toEqual(coordinates[0]);
    expect(result[result.length - 1]).toEqual(coordinates[coordinates.length - 1]);
    // Every genuine corner should survive simplification at this scale.
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result.length).toBeLessThanOrEqual(MAX_DERIVED_WAYPOINTS);
  });

  it("handles a dense route of thousands of points within the cap and a generous time bound", () => {
    const coordinates: Coordinate[] = [];
    for (let i = 0; i < 6000; i += 1) {
      const t = i / 6000;
      coordinates.push([
        t * 0.5 + Math.sin(t * 40) * 0.01,
        51 + t * 0.3 + Math.cos(t * 55) * 0.008,
      ]);
    }
    const points = buildRoutePoints(coordinates);

    const start = Date.now();
    const result = deriveOrThrow(points);
    const elapsedMs = Date.now() - start;

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(MAX_DERIVED_WAYPOINTS);
    expect(result[0]).toEqual(coordinates[0]);
    expect(result[result.length - 1]).toEqual(coordinates[coordinates.length - 1]);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("closes a detected loop exactly, not merely approximately", () => {
    const coordinates: Coordinate[] = [
      [0, 51],
      [0.05, 51],
      [0.05, 51.05],
      [0, 51.05],
      [0.0001, 51.0002], // ends a few metres from the start — a routed loop's snap
    ];
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);

    expect(result[0]).toEqual(coordinates[0]);
    expect(result[result.length - 1]).toEqual(result[0]);
  });

  it("does not force closure for a route whose start and finish are genuinely far apart", () => {
    const coordinates = interpolateLine([0, 51], [0.2, 51.1], 20);
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);
    expect(result[result.length - 1]).not.toEqual(result[0]);
  });

  it("collapses consecutive near-duplicate samples", () => {
    const coordinates: Coordinate[] = [
      [0, 51],
      [0, 51.00001], // ~1m away — near-duplicate of the start
      [0, 51.00002], // ~1m further — near-duplicate cluster
      [0.05, 51.05],
      [0.1, 51.1],
    ];
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);
    const start = expectNonNull(coordinates[0]);

    // The tight cluster at the start should collapse to a single waypoint.
    const startClusterCount = result.filter(
      (coordinate) => haversineDistanceMetres(coordinate, start) < 50,
    ).length;
    expect(startClusterCount).toBe(1);
  });

  it("is deterministic for identical input", () => {
    const coordinates: Coordinate[] = [];
    for (let i = 0; i < 500; i += 1) {
      const t = i / 500;
      coordinates.push([t * 0.3 + Math.sin(t * 20) * 0.005, 51 + t * 0.2]);
    }
    const points = buildRoutePoints(coordinates);

    const first = deriveWaypointsFromRoute(points);
    const second = deriveWaypointsFromRoute(points);
    expect(second).toEqual(first);
  });

  it("preserves original route order", () => {
    const coordinates: Coordinate[] = [
      [0, 51],
      [0.02, 51.01],
      [0.03, 51.05],
      [0.01, 51.08],
      [0.06, 51.09],
      [0.08, 51.1],
    ];
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);

    const originalIndices = result.map((coordinate) =>
      coordinates.findIndex(
        ([lon, lat]) => lon === coordinate[0] && lat === coordinate[1],
      ),
    );
    for (let i = 1; i < originalIndices.length; i += 1) {
      expect(expectNonNull(originalIndices[i])).toBeGreaterThan(
        expectNonNull(originalIndices[i - 1]),
      );
    }
  });

  it("never exceeds the 20-waypoint cap even under heavy forced gap-filling, and keeps the finish", () => {
    // A very long, perfectly straight route with no genuine bends at all —
    // RDP alone converges to [first, last], forcing gap-filling to do all
    // the work of populating intermediate anchors up to the cap.
    const coordinates = interpolateLine([0, 51], [3, 51], 3000);
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);

    expect(result.length).toBeLessThanOrEqual(MAX_DERIVED_WAYPOINTS);
    expect(result[result.length - 1]).toEqual(coordinates[coordinates.length - 1]);
    expect(result[0]).toEqual(coordinates[0]);
  });

  it("never shares coordinate tuple references with the source points", () => {
    const coordinates: Coordinate[] = [
      [0, 51],
      [0.02, 51.02],
      [0.05, 51.05],
    ];
    const points = buildRoutePoints(coordinates);
    const result = deriveOrThrow(points);
    expect(result[0]).not.toBe(expectNonNull(points[0]).coordinate);
  });
});
