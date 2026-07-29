import { describe, expect, it } from "vitest";
import {
  buildElevationChartGeometry,
  buildElevationChartMarkerGeometry,
  computeDisplayElevationRange,
  distanceToX,
  elevationToY,
  MIN_DISPLAY_ELEVATION_RANGE_METRES,
  pathFromSegment,
  splitSegmentAtX,
  splitSegmentAtXs,
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
    // The true (unpadded) range, as reported in the figcaption.
    expect(geometry?.minElevationMetres).toBe(0);
    expect(geometry?.maxElevationMetres).toBe(100);
    // The display range used for the y-scale adds 10% padding on each
    // side (see computeDisplayElevationRange's own tests for the exact
    // formula) — 100 m true range → 10 m padding each side.
    expect(geometry?.displayMinElevationMetres).toBeCloseTo(-10, 5);
    expect(geometry?.displayMaxElevationMetres).toBeCloseTo(110, 5);

    const segment = geometry?.segments[0] ?? [];
    expect(segment).toHaveLength(3);
    // Lowest elevation sits near, but not exactly at, the bottom of the
    // chart — the padding leaves headroom below it too.
    expect(segment[0]?.y).toBeCloseTo(91.6667, 3);
    // Highest elevation sits near, but not exactly at, the top.
    expect(segment[2]?.y).toBeCloseTo(8.3333, 3);
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

describe("distanceToX / elevationToY (exported for gradient boundary placement)", () => {
  it("distanceToX matches the same formula buildElevationChartGeometry uses internally", () => {
    expect(distanceToX(25, domain(0, 100), 300)).toBeCloseTo(75, 5);
    expect(distanceToX(0, domain(10, 10), 300)).toBe(0); // zero-width domain guarded
  });

  it("elevationToY matches the same formula buildElevationChartGeometry uses internally", () => {
    expect(elevationToY(100, 0, 100, 100)).toBeCloseTo(0, 5);
    expect(elevationToY(0, 0, 100, 100)).toBeCloseTo(100, 5);
    expect(elevationToY(5, 5, 5, 100)).toBe(100); // equal-elevation guarded
  });
});

describe("splitSegmentAtXs", () => {
  const segment = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
    { x: 30, y: 10 },
  ];

  it("with a single split produces the same two runs as splitSegmentAtX", () => {
    const { completed, remaining } = splitSegmentAtX(segment, 15);
    const runs = splitSegmentAtXs(segment, [15]);
    expect(runs).toEqual([completed, remaining]);
  });

  it("splits at multiple boundaries with shared seams and no gaps", () => {
    const runs = splitSegmentAtXs(segment, [10, 25]);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(runs[1]).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 25, y: 5 },
    ]);
    expect(runs[2]).toEqual([
      { x: 25, y: 5 },
      { x: 30, y: 10 },
    ]);
    // Adjacent runs share exactly the same seam point — no gap or overlap.
    expect(runs[0]?.at(-1)).toEqual(runs[1]?.[0]);
    expect(runs[1]?.at(-1)).toEqual(runs[2]?.[0]);
  });

  it("does not duplicate a point when a boundary lands exactly on an existing point", () => {
    const runs = splitSegmentAtXs(segment, [10]);
    expect(runs[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(runs[1]).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
    ]);
  });

  it("returns the whole segment as a single run when there are no split points", () => {
    expect(splitSegmentAtXs(segment, [])).toEqual([segment]);
  });

  it("is order-independent for unsorted split inputs", () => {
    expect(splitSegmentAtXs(segment, [25, 10])).toEqual(
      splitSegmentAtXs(segment, [10, 25]),
    );
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

describe("computeDisplayElevationRange", () => {
  it("pads a large range by the configured fraction on each side", () => {
    const { displayMinElevationMetres, displayMaxElevationMetres } =
      computeDisplayElevationRange(0, 100);
    expect(displayMinElevationMetres).toBeCloseTo(-10, 5);
    expect(displayMaxElevationMetres).toBeCloseTo(110, 5);
  });

  it("enforces the minimum display range for a flat/near-flat true range", () => {
    const { displayMinElevationMetres, displayMaxElevationMetres } =
      computeDisplayElevationRange(10, 12);
    const displaySpan = displayMaxElevationMetres - displayMinElevationMetres;
    expect(displaySpan).toBeCloseTo(MIN_DISPLAY_ELEVATION_RANGE_METRES, 5);
    // Expanded symmetrically around the true range's own centre (11).
    expect(displayMinElevationMetres).toBeCloseTo(1, 5);
    expect(displayMaxElevationMetres).toBeCloseTo(21, 5);
  });

  it("enforces the minimum display range for a perfectly flat (zero-span) route", () => {
    const { displayMinElevationMetres, displayMaxElevationMetres } =
      computeDisplayElevationRange(50, 50);
    expect(displayMaxElevationMetres - displayMinElevationMetres).toBeCloseTo(
      MIN_DISPLAY_ELEVATION_RANGE_METRES,
      5,
    );
    expect(displayMinElevationMetres).toBeCloseTo(40, 5);
    expect(displayMaxElevationMetres).toBeCloseTo(60, 5);
  });

  it("never returns a display range narrower than the true range", () => {
    const { displayMinElevationMetres, displayMaxElevationMetres } =
      computeDisplayElevationRange(0, 500);
    expect(displayMinElevationMetres).toBeLessThanOrEqual(0);
    expect(displayMaxElevationMetres).toBeGreaterThanOrEqual(500);
  });
});
