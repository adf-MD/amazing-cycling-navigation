import { describe, expect, it } from "vitest";
import { coalesceAdjacentWarnings, sliceRoutePointsForRange } from "./warningGeometry.ts";
import type { RoutePoint, RouteWarning } from "../domain/types.ts";
import {
  OUT_AND_BACK_ROUTE_POINTS,
  OUT_AND_BACK_TURNAROUND_INDEX,
} from "../test/fixtures/outAndBackRoute.ts";
import { SELF_INTERSECTING_ROUTE_POINTS } from "../test/fixtures/selfIntersectingRoute.ts";

const POINTS: RoutePoint[] = [
  { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
  { coordinate: [0.001, 51], elevationMetres: 20, distanceFromStartMetres: 100 },
  { coordinate: [0.002, 51], elevationMetres: null, distanceFromStartMetres: 200 },
  { coordinate: [0.003, 51], elevationMetres: 40, distanceFromStartMetres: 300 },
];

function snapshot(points: readonly RoutePoint[]): RoutePoint[] {
  return points.map((point) => ({ ...point }));
}

describe("sliceRoutePointsForRange", () => {
  it("returns the whole route unchanged when the range covers it exactly", () => {
    const result = sliceRoutePointsForRange(POINTS, 0, 300);
    expect(result).toEqual(POINTS);
    expect(result).toHaveLength(4);
  });

  it("clamps a start before the route to zero", () => {
    const result = sliceRoutePointsForRange(POINTS, -50, 100);
    expect(result).toEqual([POINTS[0], POINTS[1]]);
  });

  it("clamps an end beyond the route to the total distance", () => {
    const result = sliceRoutePointsForRange(POINTS, 200, 500);
    expect(result).toEqual([POINTS[2], POINTS[3]]);
  });

  it("ignores a range entirely beyond the route bounds", () => {
    expect(sliceRoutePointsForRange(POINTS, 400, 500)).toEqual([]);
  });

  it("ignores a range entirely before the route bounds", () => {
    expect(sliceRoutePointsForRange(POINTS, -500, -400)).toEqual([]);
  });

  it("ignores a zero-length range", () => {
    expect(sliceRoutePointsForRange(POINTS, 150, 150)).toEqual([]);
  });

  it("normalises an inverted range by treating it as [end, start]", () => {
    const inverted = sliceRoutePointsForRange(POINTS, 200, 100);
    const ordered = sliceRoutePointsForRange(POINTS, 100, 200);
    expect(inverted).toEqual(ordered);
    expect(inverted).toEqual([POINTS[1], POINTS[2]]);
  });

  it("returns an empty array for fewer than two route points", () => {
    const singlePoint: RoutePoint = {
      coordinate: [0, 51],
      elevationMetres: 10,
      distanceFromStartMetres: 0,
    };
    expect(sliceRoutePointsForRange([singlePoint], 0, 100)).toEqual([]);
    expect(sliceRoutePointsForRange([], 0, 100)).toEqual([]);
  });

  it("interpolates a boundary that falls strictly between two points, with correctly interpolated elevation", () => {
    const result = sliceRoutePointsForRange(POINTS, 50, 150);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      coordinate: [0.0005, 51],
      elevationMetres: 15,
      distanceFromStartMetres: 50,
    });
    expect(result[1]).toEqual(POINTS[1]);
    // The boundary at 150 sits between p1 (elevation 20) and p2 (elevation
    // null) — elevation must not be invented from only one known side.
    expect(result[2]).toEqual({
      coordinate: [0.0015, 51],
      elevationMetres: null,
      distanceFromStartMetres: 150,
    });
  });

  it("does not duplicate or re-interpolate a point when a boundary lands exactly on it", () => {
    const result = sliceRoutePointsForRange(POINTS, 100, 200);

    expect(result).toEqual([POINTS[1], POINTS[2]]);
    // Exact-match boundaries reuse the original point, not a copy.
    expect(result[0]).toBe(POINTS[1]);
    expect(result[1]).toBe(POINTS[2]);
  });

  it("works for sparse (two-point) geometry", () => {
    const sparse: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.001, 51], elevationMetres: 20, distanceFromStartMetres: 100 },
    ];
    const result = sliceRoutePointsForRange(sparse, 25, 75);

    expect(result).toHaveLength(2);
    expect(result[0]?.distanceFromStartMetres).toBe(25);
    expect(result[1]?.distanceFromStartMetres).toBe(75);
  });

  it("never mutates the input points", () => {
    const before = snapshot(POINTS);
    sliceRoutePointsForRange(POINTS, 50, 250);
    expect(POINTS).toEqual(before);
  });

  it("resolves a warning on an out-and-back's return leg by distance, not coordinate proximity to the near-coincident outbound leg", () => {
    const turnaroundDistance =
      OUT_AND_BACK_ROUTE_POINTS[OUT_AND_BACK_TURNAROUND_INDEX]?.distanceFromStartMetres ??
      0;
    const total = OUT_AND_BACK_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0;
    const rangeStart = turnaroundDistance + (total - turnaroundDistance) * 0.3;
    const rangeEnd = turnaroundDistance + (total - turnaroundDistance) * 0.5;

    const result = sliceRoutePointsForRange(
      OUT_AND_BACK_ROUTE_POINTS,
      rangeStart,
      rangeEnd,
    );

    expect(result.length).toBeGreaterThan(0);
    // The return leg is offset ~0.0001 degrees north of the outbound leg —
    // every resolved point must come from that leg, never the outbound one.
    for (const point of result) {
      expect(point.coordinate[1]).toBeGreaterThan(51.00005);
      expect(point.distanceFromStartMetres).toBeGreaterThanOrEqual(turnaroundDistance);
    }
  });

  it("resolves a range on a self-intersecting route as one contiguous, monotonically-increasing-by-distance slice", () => {
    const total = SELF_INTERSECTING_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0;
    const result = sliceRoutePointsForRange(
      SELF_INTERSECTING_ROUTE_POINTS,
      total * 0.6,
      total * 0.8,
    );

    expect(result.length).toBeGreaterThan(0);
    const distances = result.map((point) => point.distanceFromStartMetres);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(result[0]?.distanceFromStartMetres).toBeCloseTo(total * 0.6, 6);
    expect(result.at(-1)?.distanceFromStartMetres).toBeCloseTo(total * 0.8, 6);
  });
});

const QUESTIONABLE_MESSAGE = "Questionable surface for a road bike.";
const UNSUITABLE_MESSAGE = "Unsuitable surface for a road bike.";

function buildWarning(overrides: Partial<RouteWarning> = {}): RouteWarning {
  return {
    kind: "questionable-surface",
    startDistanceMetres: 0,
    endDistanceMetres: 100,
    message: QUESTIONABLE_MESSAGE,
    ...overrides,
  };
}

describe("coalesceAdjacentWarnings", () => {
  it("merges two same-kind-and-message warnings separated by a gap within tolerance", () => {
    const a = buildWarning({ startDistanceMetres: 0, endDistanceMetres: 100 });
    const b = buildWarning({ startDistanceMetres: 100.5, endDistanceMetres: 200 });

    const result = coalesceAdjacentWarnings([a, b], 1);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startDistanceMetres: 0, endDistanceMetres: 200 });
  });

  it("merges overlapping same-kind-and-message warnings", () => {
    const a = buildWarning({ startDistanceMetres: 0, endDistanceMetres: 100 });
    const b = buildWarning({ startDistanceMetres: 90, endDistanceMetres: 150 });

    const result = coalesceAdjacentWarnings([a, b], 1);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startDistanceMetres: 0, endDistanceMetres: 150 });
  });

  it("does not merge warnings whose gap exceeds the tolerance", () => {
    const a = buildWarning({ startDistanceMetres: 0, endDistanceMetres: 100 });
    const b = buildWarning({ startDistanceMetres: 105, endDistanceMetres: 200 });

    const result = coalesceAdjacentWarnings([a, b], 1);

    expect(result).toHaveLength(2);
  });

  it("does not merge adjacent warnings of a different kind", () => {
    const a = buildWarning({ kind: "questionable-surface", endDistanceMetres: 100 });
    const b = buildWarning({
      kind: "unsuitable-surface",
      startDistanceMetres: 100.2,
      endDistanceMetres: 200,
      message: UNSUITABLE_MESSAGE,
    });

    const result = coalesceAdjacentWarnings([a, b], 1);

    expect(result).toHaveLength(2);
  });

  it("does not merge adjacent warnings with a different message", () => {
    const a = buildWarning({ endDistanceMetres: 100, message: "First message." });
    const b = buildWarning({
      startDistanceMetres: 100.2,
      endDistanceMetres: 200,
      message: "Second message.",
    });

    const result = coalesceAdjacentWarnings([a, b], 1);

    expect(result).toHaveLength(2);
  });

  it("sorts by start distance regardless of input order", () => {
    const early = buildWarning({ startDistanceMetres: 0, endDistanceMetres: 50 });
    const late = buildWarning({ startDistanceMetres: 500, endDistanceMetres: 550 });

    const result = coalesceAdjacentWarnings([late, early], 1);

    expect(result.map((w) => w.startDistanceMetres)).toEqual([0, 500]);
  });

  it("drops zero and negative-length warnings", () => {
    const zeroLength = buildWarning({ startDistanceMetres: 50, endDistanceMetres: 50 });
    const negativeLength = buildWarning({
      startDistanceMetres: 80,
      endDistanceMetres: 70,
    });
    const valid = buildWarning({ startDistanceMetres: 0, endDistanceMetres: 20 });

    const result = coalesceAdjacentWarnings([zeroLength, negativeLength, valid], 1);

    expect(result).toEqual([valid]);
  });

  it("never mutates the input array or its warnings", () => {
    const a = buildWarning({ startDistanceMetres: 0, endDistanceMetres: 100 });
    const b = buildWarning({ startDistanceMetres: 100.5, endDistanceMetres: 200 });
    const input = [a, b];
    const before = input.map((w) => ({ ...w }));

    coalesceAdjacentWarnings(input, 1);

    expect(input).toEqual(before);
  });
});
