import { describe, expect, it } from "vitest";
import { buildGradientChartRuns } from "./elevationChartGradient.ts";
import type {
  ElevationChartDomain,
  ElevationChartPoint,
} from "./elevationChartGeometry.ts";
import type { GradientSegment } from "../../navigation/gradient.ts";

function domain(
  startDistanceMetres: number,
  endDistanceMetres: number,
): ElevationChartDomain {
  return { startDistanceMetres, endDistanceMetres };
}

function gradientSegment(
  startDistanceMetres: number,
  endDistanceMetres: number,
  classification: GradientSegment["classification"],
): GradientSegment {
  return {
    startDistanceMetres,
    endDistanceMetres,
    averageGradientPercent: null,
    classification,
  };
}

const WIDTH = 100;

describe("buildGradientChartRuns", () => {
  it("returns one run per chart segment when a single gradient class covers it entirely", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 10 },
      { x: 50, y: 5 },
      { x: 100, y: 0 },
    ];
    const runs = buildGradientChartRuns(
      [segment],
      [gradientSegment(0, 100, "flat")],
      domain(0, 100),
      WIDTH,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual([{ gradientClass: "flat", points: segment }]);
  });

  it("splits a chart segment at gradient boundaries with correct classes and shared seams", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 60, y: 20 },
      { x: 100, y: 0 },
    ];
    const runs = buildGradientChartRuns(
      [segment],
      [gradientSegment(0, 40, "flat"), gradientSegment(40, 100, "hard-climb")],
      domain(0, 100),
      WIDTH,
    );
    expect(runs).toHaveLength(1);
    const [segmentRuns] = runs;
    expect(segmentRuns).toHaveLength(2);
    expect(segmentRuns?.[0]?.gradientClass).toBe("flat");
    expect(segmentRuns?.[1]?.gradientClass).toBe("hard-climb");
    // Seam shared exactly between the two runs — no gap or overlap.
    expect(segmentRuns?.[0]?.points.at(-1)).toEqual(segmentRuns?.[1]?.points[0]);
  });

  it("does not duplicate a point when a gradient boundary lands exactly on an existing point", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 100, y: 0 },
    ];
    const runs = buildGradientChartRuns(
      [segment],
      [gradientSegment(0, 40, "flat"), gradientSegment(40, 100, "hard-climb")],
      domain(0, 100),
      WIDTH,
    );
    const [segmentRuns] = runs;
    expect(segmentRuns?.[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 10 },
    ]);
    expect(segmentRuns?.[1]?.points).toEqual([
      { x: 40, y: 10 },
      { x: 100, y: 0 },
    ]);
  });

  it("preserves the outer segment count and order, including empty segments", () => {
    const segmentA: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 20, y: 5 },
    ];
    const segmentB: ElevationChartPoint[] = [
      { x: 60, y: 0 },
      { x: 100, y: 5 },
    ];
    const runs = buildGradientChartRuns(
      [segmentA, [], segmentB],
      [gradientSegment(0, 20, "flat"), gradientSegment(60, 100, "descent")],
      domain(0, 100),
      WIDTH,
    );
    expect(runs).toHaveLength(3);
    expect(runs[1]).toEqual([]);
    expect(runs[0]?.[0]?.gradientClass).toBe("flat");
    expect(runs[2]?.[0]?.gradientClass).toBe("descent");
  });

  it("falls back to unknown when no gradient segment overlaps the chart segment", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 5 },
    ];
    const runs = buildGradientChartRuns([segment], [], domain(0, 100), WIDTH);
    expect(runs).toEqual([[{ gradientClass: "unknown", points: segment }]]);
  });

  it("clips gradient boundaries outside the chart segment's own x-span", () => {
    const segment: ElevationChartPoint[] = [
      { x: 30, y: 0 },
      { x: 70, y: 5 },
    ];
    const runs = buildGradientChartRuns(
      [segment],
      [gradientSegment(0, 100, "moderate-climb")],
      domain(0, 100),
      WIDTH,
    );
    expect(runs).toEqual([[{ gradientClass: "moderate-climb", points: segment }]]);
  });
});
