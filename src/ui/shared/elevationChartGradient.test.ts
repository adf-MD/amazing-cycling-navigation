import { describe, expect, it } from "vitest";
import {
  buildChartColourRuns,
  buildFeatureDetailChartRuns,
  buildRouteFeatureChartRuns,
} from "./elevationChartGradient.ts";
import type {
  ElevationChartDomain,
  ElevationChartPoint,
} from "./elevationChartGeometry.ts";
import type { ClassifiedSegment } from "../../navigation/gradient.ts";
import type {
  ClimbFeature,
  DescentFeature,
  RouteFeature,
} from "../../navigation/routeFeatures.ts";
import type { MicroDetailVisualKey } from "../../navigation/routeFeaturePalette.ts";

function domain(
  startDistanceMetres: number,
  endDistanceMetres: number,
): ElevationChartDomain {
  return { startDistanceMetres, endDistanceMetres };
}

function gradientSegment(
  startDistanceMetres: number,
  endDistanceMetres: number,
  visualKey: MicroDetailVisualKey,
): ClassifiedSegment<MicroDetailVisualKey> {
  return {
    startDistanceMetres,
    endDistanceMetres,
    averageGradientPercent: null,
    visualKey,
  };
}

const WIDTH = 100;

describe("buildFeatureDetailChartRuns", () => {
  it("returns one run per chart segment when a single band covers it entirely", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 10 },
      { x: 50, y: 5 },
      { x: 100, y: 0 },
    ];
    const runs = buildFeatureDetailChartRuns(
      [segment],
      [gradientSegment(0, 100, "gentle-or-descending")],
      domain(0, 100),
      WIDTH,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual([{ visualKey: "gentle-or-descending", points: segment }]);
  });

  it("splits a chart segment at boundaries with correct bands and shared seams", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 60, y: 20 },
      { x: 100, y: 0 },
    ];
    const runs = buildFeatureDetailChartRuns(
      [segment],
      [
        gradientSegment(0, 40, "gentle-or-descending"),
        gradientSegment(40, 100, "hard-climb"),
      ],
      domain(0, 100),
      WIDTH,
    );
    expect(runs).toHaveLength(1);
    const [segmentRuns] = runs;
    expect(segmentRuns).toHaveLength(2);
    expect(segmentRuns?.[0]?.visualKey).toBe("gentle-or-descending");
    expect(segmentRuns?.[1]?.visualKey).toBe("hard-climb");
    // Seam shared exactly between the two runs — no gap or overlap.
    expect(segmentRuns?.[0]?.points.at(-1)).toEqual(segmentRuns?.[1]?.points[0]);
  });

  it("does not duplicate a point when a boundary lands exactly on an existing point", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 100, y: 0 },
    ];
    const runs = buildFeatureDetailChartRuns(
      [segment],
      [
        gradientSegment(0, 40, "gentle-or-descending"),
        gradientSegment(40, 100, "hard-climb"),
      ],
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
    const runs = buildFeatureDetailChartRuns(
      [segmentA, [], segmentB],
      [gradientSegment(0, 20, "gentle-or-descending"), gradientSegment(60, 100, "steep")],
      domain(0, 100),
      WIDTH,
    );
    expect(runs).toHaveLength(3);
    expect(runs[1]).toEqual([]);
    expect(runs[0]?.[0]?.visualKey).toBe("gentle-or-descending");
    expect(runs[2]?.[0]?.visualKey).toBe("steep");
  });

  it("regression: preserves visualKey: null (not a synthetic placeholder) when no detail segment overlaps the chart segment", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 5 },
    ];
    const runs = buildFeatureDetailChartRuns([segment], [], domain(0, 100), WIDTH);
    expect(runs).toEqual([[{ visualKey: null, points: segment }]]);
  });

  it("clips boundaries outside the chart segment's own x-span", () => {
    const segment: ElevationChartPoint[] = [
      { x: 30, y: 0 },
      { x: 70, y: 5 },
    ];
    const runs = buildFeatureDetailChartRuns(
      [segment],
      [gradientSegment(0, 100, "moderate-climb")],
      domain(0, 100),
      WIDTH,
    );
    expect(runs).toEqual([[{ visualKey: "moderate-climb", points: segment }]]);
  });
});

describe("buildChartColourRuns", () => {
  it("produces identical splitting/labelling to buildFeatureDetailChartRuns's own logic when fed detail-segment-shaped ranges", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 60, y: 20 },
      { x: 100, y: 0 },
    ];
    const runs = buildChartColourRuns(
      [segment],
      [
        { startDistanceMetres: 0, endDistanceMetres: 40, key: "gentle-or-descending" },
        { startDistanceMetres: 40, endDistanceMetres: 100, key: "hard-climb" },
      ],
      domain(0, 100),
      WIDTH,
    );
    const [segmentRuns] = runs;
    expect(segmentRuns).toHaveLength(2);
    expect(segmentRuns?.[0]?.key).toBe("gentle-or-descending");
    expect(segmentRuns?.[1]?.key).toBe("hard-climb");
    expect(segmentRuns?.[0]?.points.at(-1)).toEqual(segmentRuns?.[1]?.points[0]);
  });

  it("returns key: null (not a placeholder string) when no range overlaps", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 5 },
    ];
    const runs = buildChartColourRuns([segment], [], domain(0, 100), WIDTH);
    expect(runs).toEqual([[{ key: null, points: segment }]]);
  });
});

function climbFeature(
  startDistanceMetres: number,
  endDistanceMetres: number,
  category: ClimbFeature["category"] = "category-3",
): ClimbFeature {
  return {
    id: `climb-${String(startDistanceMetres)}`,
    kind: "climb",
    startDistanceMetres,
    endDistanceMetres,
    lengthMetres: endDistanceMetres - startDistanceMetres,
    elevationGainMetres: 40,
    averageGradientPercent: 6,
    maxGradientPercent: 8,
    climbScore: 20000,
    category,
  };
}

function descentFeature(
  startDistanceMetres: number,
  endDistanceMetres: number,
  band: DescentFeature["band"] = "steep",
): DescentFeature {
  return {
    id: `descent-${String(startDistanceMetres)}`,
    kind: "descent",
    startDistanceMetres,
    endDistanceMetres,
    lengthMetres: endDistanceMetres - startDistanceMetres,
    elevationLossMetres: 40,
    averageGradientPercent: -7,
    maxGradientPercent: -9,
    band,
  };
}

describe("buildRouteFeatureChartRuns", () => {
  it("splits a chart segment at feature boundaries, labelling by visualKey (climb category or descent band)", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 60, y: 20 },
      { x: 100, y: 0 },
    ];
    const features: RouteFeature[] = [
      climbFeature(0, 40, "category-2"),
      descentFeature(40, 100, "very-steep"),
    ];
    const runs = buildRouteFeatureChartRuns([segment], features, domain(0, 100), WIDTH);
    const [segmentRuns] = runs;
    expect(segmentRuns).toHaveLength(2);
    expect(segmentRuns?.[0]?.visualKey).toBe("category-2");
    expect(segmentRuns?.[1]?.visualKey).toBe("very-steep");
  });

  it("leaves an ordinary (non-feature) gap as visualKey: null, not a placeholder", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 5 },
      { x: 70, y: 5 },
      { x: 100, y: 0 },
    ];
    const features: RouteFeature[] = [climbFeature(0, 30)];
    const runs = buildRouteFeatureChartRuns([segment], features, domain(0, 100), WIDTH);
    const [segmentRuns] = runs;
    expect(segmentRuns?.[0]?.visualKey).toBe("category-3");
    expect(segmentRuns?.[1]?.visualKey).toBeNull();
  });

  it("falls back to visualKey: null for the whole segment when no feature overlaps at all", () => {
    const segment: ElevationChartPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 5 },
    ];
    const runs = buildRouteFeatureChartRuns([segment], [], domain(0, 100), WIDTH);
    expect(runs).toEqual([[{ visualKey: null, points: segment }]]);
  });
});
