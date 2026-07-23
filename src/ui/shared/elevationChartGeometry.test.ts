import { describe, expect, it } from "vitest";
import {
  buildElevationChartGeometry,
  pathFromSegment,
} from "./elevationChartGeometry.ts";
import type { RoutePoint } from "../../domain/types.ts";

function buildPoints(entries: readonly [number, number | null][]): RoutePoint[] {
  return entries.map(([distanceFromStartMetres, elevationMetres]) => ({
    coordinate: [0, 51],
    elevationMetres,
    distanceFromStartMetres,
  }));
}

describe("buildElevationChartGeometry", () => {
  it("returns null when no point has elevation", () => {
    const points = buildPoints([
      [0, null],
      [100, null],
    ]);
    expect(buildElevationChartGeometry(points, 300, 100)).toBeNull();
  });

  it("maps a single continuous run of elevations into one segment", () => {
    const points = buildPoints([
      [0, 0],
      [50, 50],
      [100, 100],
    ]);
    const geometry = buildElevationChartGeometry(points, 300, 100);

    expect(geometry?.segments).toHaveLength(1);
    expect(geometry?.minElevationMetres).toBe(0);
    expect(geometry?.maxElevationMetres).toBe(100);
    expect(geometry?.maxDistanceMetres).toBe(100);

    const segment = geometry?.segments[0] ?? [];
    expect(segment).toHaveLength(3);
    // Lowest elevation maps to the bottom of the chart (y = height).
    expect(segment[0]?.y).toBeCloseTo(100, 5);
    // Highest elevation maps to the top of the chart (y = 0).
    expect(segment[2]?.y).toBeCloseTo(0, 5);
  });

  it("breaks the line into separate segments across a gap in elevation data", () => {
    const points = buildPoints([
      [0, 10],
      [50, null],
      [100, 20],
    ]);
    const geometry = buildElevationChartGeometry(points, 300, 100);

    expect(geometry?.segments).toHaveLength(2);
    expect(geometry?.segments[0]).toHaveLength(1);
    expect(geometry?.segments[1]).toHaveLength(1);
  });

  it("does not divide by zero when every known elevation is equal", () => {
    const points = buildPoints([
      [0, 10],
      [100, 10],
    ]);
    const geometry = buildElevationChartGeometry(points, 300, 100);
    expect(geometry?.segments[0]?.every((point) => Number.isFinite(point.y))).toBe(true);
  });

  it("does not divide by zero when the route has zero total distance", () => {
    const points = buildPoints([[0, 10]]);
    const geometry = buildElevationChartGeometry(points, 300, 100);
    expect(geometry?.segments[0]?.every((point) => Number.isFinite(point.x))).toBe(true);
  });
});

describe("pathFromSegment", () => {
  it("builds an SVG path starting with M and continuing with L commands", () => {
    const path = pathFromSegment([
      { x: 0, y: 10 },
      { x: 5, y: 20 },
      { x: 10, y: 0 },
    ]);
    expect(path).toBe("M 0.00 10.00 L 5.00 20.00 L 10.00 0.00");
  });

  it("returns an empty string for an empty segment", () => {
    expect(pathFromSegment([])).toBe("");
  });
});
