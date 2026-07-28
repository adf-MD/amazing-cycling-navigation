import { describe, expect, it } from "vitest";
import {
  buildElevationChartGeometry,
  buildElevationChartMarkerGeometry,
  pathFromSegment,
  splitSegmentAtX,
  type ElevationChartDomain,
} from "./elevationChartGeometry.ts";
import type { RoutePoint } from "../../domain/types.ts";

function buildPoints(entries: readonly [number, number | null][]): RoutePoint[] {
  return entries.map(([distanceFromStartMetres, elevationMetres]) => ({
    coordinate: [0, 51],
    elevationMetres,
    distanceFromStartMetres,
  }));
}

function domain(
  startDistanceMetres: number,
  endDistanceMetres: number,
): ElevationChartDomain {
  return { startDistanceMetres, endDistanceMetres };
}

describe("buildElevationChartGeometry", () => {
  it("returns null when no point has elevation", () => {
    const points = buildPoints([
      [0, null],
      [100, null],
    ]);
    expect(buildElevationChartGeometry(points, domain(0, 100), 300, 100)).toBeNull();
  });

  it("maps a single continuous run of elevations into one segment", () => {
    const points = buildPoints([
      [0, 0],
      [50, 50],
      [100, 100],
    ]);
    const geometry = buildElevationChartGeometry(points, domain(0, 100), 300, 100);

    expect(geometry?.segments).toHaveLength(1);
    expect(geometry?.minElevationMetres).toBe(0);
    expect(geometry?.maxElevationMetres).toBe(100);

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
    const geometry = buildElevationChartGeometry(points, domain(0, 100), 300, 100);

    expect(geometry?.segments).toHaveLength(2);
    expect(geometry?.segments[0]).toHaveLength(1);
    expect(geometry?.segments[1]).toHaveLength(1);
  });

  it("does not divide by zero when every known elevation is equal", () => {
    const points = buildPoints([
      [0, 10],
      [100, 10],
    ]);
    const geometry = buildElevationChartGeometry(points, domain(0, 100), 300, 100);
    expect(geometry?.segments[0]?.every((point) => Number.isFinite(point.y))).toBe(true);
  });

  it("does not divide by zero when the domain has zero width", () => {
    const points = buildPoints([[0, 10]]);
    const geometry = buildElevationChartGeometry(points, domain(0, 0), 300, 100);
    expect(geometry?.segments[0]?.every((point) => Number.isFinite(point.x))).toBe(true);
    expect(geometry?.segments[0]?.[0]?.x).toBe(0);
  });

  it("computes x from the explicit domain rather than the last plotted point's own distance", () => {
    // A rolling window deep into a long route: points only run from 40000
    // to 42000 m, but the requested (nominal) window domain runs to 45000 m
    // because the finish is still 3 km further down the route than the
    // window's actual data. This is the literal regression case for the
    // rebasing bug: dividing by the last plotted point's own distance
    // (42000) would put the finish at x = width instead of 40% of it.
    const points = buildPoints([
      [40000, 100],
      [41000, 110],
      [42000, 105],
    ]);
    const geometry = buildElevationChartGeometry(points, domain(40000, 45000), 300, 100);
    const segment = geometry?.segments[0] ?? [];

    expect(segment[0]?.x).toBeCloseTo(0, 5); // rider's position: exact left edge
    expect(segment[2]?.x).toBeCloseTo((2000 / 5000) * 300, 5); // finish at 40% of width
  });

  it("places the rider's matched distance at x = 0 in an upcoming-window domain", () => {
    const points = buildPoints([
      [42000, 50],
      [44000, 60],
      [47000, 55],
    ]);
    const geometry = buildElevationChartGeometry(points, domain(42000, 47000), 300, 100);
    const segment = geometry?.segments[0] ?? [];

    expect(segment[0]?.x).toBe(0);
    expect(segment[2]?.x).toBeCloseTo(300, 5);
  });
});

describe("buildElevationChartMarkerGeometry", () => {
  it("computes the marker's x from the same domain formula as the profile", () => {
    const marker = buildElevationChartMarkerGeometry(
      domain(0, 100),
      25,
      50,
      0,
      100,
      300,
      100,
    );
    expect(marker.x).toBeCloseTo(75, 5);
  });

  it("computes y from the given elevation range when elevation is known", () => {
    const marker = buildElevationChartMarkerGeometry(
      domain(0, 100),
      50,
      100,
      0,
      100,
      300,
      100,
    );
    expect(marker.y).toBeCloseTo(0, 5); // max elevation maps to the top
  });

  it("returns a null y when the marker's elevation is unknown", () => {
    const marker = buildElevationChartMarkerGeometry(
      domain(0, 100),
      50,
      null,
      0,
      100,
      300,
      100,
    );
    expect(marker.y).toBeNull();
  });

  it("does not divide by zero for a zero-width domain", () => {
    const marker = buildElevationChartMarkerGeometry(
      domain(10, 10),
      10,
      50,
      0,
      100,
      300,
      100,
    );
    expect(Number.isFinite(marker.x)).toBe(true);
  });
});

describe("splitSegmentAtX", () => {
  const segment = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ];

  it("interpolates a seam point when the split falls strictly inside the segment", () => {
    const { completed, remaining } = splitSegmentAtX(segment, 15);

    expect(completed).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 15, y: 5 },
    ]);
    expect(remaining).toEqual([
      { x: 15, y: 5 },
      { x: 20, y: 0 },
    ]);
    // Both halves meet at exactly the same point — no gap or overlap.
    expect(completed.at(-1)).toEqual(remaining[0]);
  });

  it("puts everything in remaining when the split is before the segment starts", () => {
    const { completed, remaining } = splitSegmentAtX(segment, -5);
    expect(completed).toEqual([]);
    expect(remaining).toEqual(segment);
  });

  it("puts everything in completed when the split is after the segment ends", () => {
    const { completed, remaining } = splitSegmentAtX(segment, 25);
    expect(completed).toEqual(segment);
    expect(remaining).toEqual([]);
  });

  it("does not insert a synthetic point when the split lands exactly on an existing point", () => {
    const { completed, remaining } = splitSegmentAtX(segment, 10);
    expect(completed).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(remaining).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
  });

  it("returns two empty runs for an empty segment", () => {
    expect(splitSegmentAtX([], 10)).toEqual({ completed: [], remaining: [] });
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
