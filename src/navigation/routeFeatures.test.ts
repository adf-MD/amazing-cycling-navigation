import { describe, expect, it } from "vitest";
import { analyzeRouteElevationProfile } from "./gradient.ts";
import type { GradientSegment } from "./gradient.ts";
import {
  classifyClimbScore,
  classifyDescentSeverity,
  detectRouteFeatures,
  findFeatureAtDistance,
  listClimbsInRouteOrder,
  MIN_CLIMB_SCORE,
  resolveElevationChartTap,
  type ClimbFeature,
  type DescentFeature,
  type RouteFeature,
} from "./routeFeatures.ts";
import type { RoutePoint } from "../domain/types.ts";

const STEP_METRES = 20;

function buildPoints(
  elevations: readonly (number | null)[],
  stepMetres = STEP_METRES,
): RoutePoint[] {
  return elevations.map((elevationMetres, index) => ({
    coordinate: [0, 51] as const,
    elevationMetres,
    distanceFromStartMetres: index * stepMetres,
  }));
}

/** A single monotonic leg of `lengthMetres` at a constant `gradePercent`,
 * starting from `startElevationMetres`. Concatenating several of these
 * (each starting where the previous ended) builds a multi-leg fixture. */
function buildLeg(
  startElevationMetres: number,
  lengthMetres: number,
  gradePercent: number,
  stepMetres = STEP_METRES,
): { elevationMetres: number }[] {
  const pointCount = Math.round(lengthMetres / stepMetres) + 1;
  return Array.from({ length: pointCount }, (_, i) => ({
    elevationMetres: startElevationMetres + (i * stepMetres * gradePercent) / 100,
  }));
}

/** Chains legs end-to-end into one route (each leg's first point is the
 * previous leg's last point, deduplicated) and returns RoutePoint[]. */
function buildLeggedRoute(
  legs: readonly { lengthMetres: number; gradePercent: number }[],
  stepMetres = STEP_METRES,
): RoutePoint[] {
  const elevations: number[] = [0];
  let elevation = 0;
  for (const leg of legs) {
    const legPoints = buildLeg(elevation, leg.lengthMetres, leg.gradePercent, stepMetres);
    // Skip the first point of each leg after the first — it duplicates
    // the previous leg's own last point.
    for (const point of legPoints.slice(1)) {
      elevations.push(point.elevationMetres);
    }
    elevation = legPoints.at(-1)?.elevationMetres ?? elevation;
  }
  return buildPoints(elevations, stepMetres);
}

function detect(points: readonly RoutePoint[]): RouteFeature[] {
  return detectRouteFeatures(analyzeRouteElevationProfile(points));
}

function isClimb(feature: RouteFeature): feature is ClimbFeature {
  return feature.kind === "climb";
}
function isDescent(feature: RouteFeature): feature is DescentFeature {
  return feature.kind === "descent";
}

describe("detectRouteFeatures: eligibility", () => {
  it("detects and classifies a qualifying climb", () => {
    const points = buildLeggedRoute([{ lengthMetres: 4000, gradePercent: 8 }]);
    const features = detect(points);
    expect(features).toHaveLength(1);
    const feature = features[0];
    if (!feature || !isClimb(feature)) throw new Error("expected one climb feature");
    expect(feature.startDistanceMetres).toBeCloseTo(0, 0);
    expect(feature.endDistanceMetres).toBeCloseTo(4000, 0);
    expect(feature.lengthMetres).toBeCloseTo(4000, 0);
    expect(feature.averageGradientPercent).toBeCloseTo(8, 0);
    expect(feature.climbScore).toBeCloseTo(4000 * 8, -2);
    // score ~32000 -> category-2 (32000 to below 64000)
    expect(feature.category).toBe("category-2");
    expect(feature.elevationGainMetres).toBeGreaterThan(0);
  });

  it("does not recognise a rise shorter than 500 m", () => {
    const points = buildLeggedRoute([{ lengthMetres: 400, gradePercent: 10 }]);
    expect(detect(points)).toEqual([]);
  });

  it("does not recognise a climb averaging below 3%", () => {
    const points = buildLeggedRoute([{ lengthMetres: 2000, gradePercent: 2 }]);
    expect(detect(points)).toEqual([]);
  });

  it("detects a qualifying descent", () => {
    const points = buildLeggedRoute([{ lengthMetres: 3000, gradePercent: -7 }]);
    const features = detect(points);
    expect(features).toHaveLength(1);
    const feature = features[0];
    if (!feature || !isDescent(feature)) throw new Error("expected one descent feature");
    expect(feature.averageGradientPercent).toBeCloseTo(-7, 0);
    expect(feature.severity).toBe("steep");
    expect(feature.elevationLossMetres).toBeGreaterThan(0);
  });

  it("does not recognise a descent shorter than 500 m", () => {
    const points = buildLeggedRoute([{ lengthMetres: 400, gradePercent: -10 }]);
    expect(detect(points)).toEqual([]);
  });

  it("does not recognise a descent averaging above -3%", () => {
    const points = buildLeggedRoute([{ lengthMetres: 2000, gradePercent: -2 }]);
    expect(detect(points)).toEqual([]);
  });

  it("proves MIN_CLIMB_SCORE is always satisfied once length/gradient eligibility passes", () => {
    // Exactly at both other boundaries: length=500, grade=3 -> score=1500.
    const points = buildLeggedRoute([{ lengthMetres: 500, gradePercent: 3 }]);
    const features = detect(points);
    expect(features).toHaveLength(1);
    const feature = features[0];
    if (!feature || !isClimb(feature)) throw new Error("expected one climb feature");
    expect(feature.climbScore).toBeGreaterThanOrEqual(MIN_CLIMB_SCORE);
  });
});

describe("classifyClimbScore: boundaries", () => {
  it.each([
    [1499, "uncategorised"],
    [1500, "uncategorised"],
    [7999, "uncategorised"],
    [8000, "category-4"],
    [15999, "category-4"],
    [16000, "category-3"],
    [31999, "category-3"],
    [32000, "category-2"],
    [63999, "category-2"],
    [64000, "category-1"],
    [79999, "category-1"],
    [80000, "hc"],
    [200000, "hc"],
  ] as const)("classifies a score of %d as %s", (score, expected) => {
    expect(classifyClimbScore(score)).toBe(expected);
  });
});

describe("classifyDescentSeverity: boundaries", () => {
  it.each([
    [-3, "gentle"],
    [-5.99, "gentle"],
    [-6, "steep"],
    [-8.99, "steep"],
    [-9, "very-steep"],
    [-20, "very-steep"],
  ] as const)(
    "classifies an average gradient of %d%% as %s",
    (gradePercent, expected) => {
      expect(classifyDescentSeverity(gradePercent)).toBe(expected);
    },
  );
});

describe("detectRouteFeatures: reversal bridging", () => {
  it("does not split one climb across a short, shallow interruption", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 1500, gradePercent: 8 }, // climbs to 120 m
      { lengthMetres: 100, gradePercent: -6 }, // dips 6 m over 100 m: both under threshold
      { lengthMetres: 1500, gradePercent: 8 }, // resumes past the pre-dip peak
    ]);
    const features = detect(points);
    const climbs = features.filter(isClimb);
    expect(climbs).toHaveLength(1);
    expect(climbs[0]?.startDistanceMetres).toBeCloseTo(0, 0);
    expect(climbs[0]?.endDistanceMetres).toBeCloseTo(3100, -1);
  });

  it("splits when the reversal's elevation loss meets the threshold, even over a short distance", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 1500, gradePercent: 8 },
      { lengthMetres: 100, gradePercent: -15 }, // 15 m loss over 100 m: elevation threshold tripped
      { lengthMetres: 1500, gradePercent: 8 },
    ]);
    const features = detect(points);
    const climbs = features.filter(isClimb);
    expect(climbs.length).toBeGreaterThanOrEqual(2);
  });

  it("splits when the reversal's distance meets the threshold, even if shallow", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 1500, gradePercent: 8 },
      { lengthMetres: 250, gradePercent: -3 }, // only ~7.5 m loss, but over 250 m
      { lengthMetres: 1500, gradePercent: 8 },
    ]);
    const features = detect(points);
    const climbs = features.filter(isClimb);
    expect(climbs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("detectRouteFeatures: missing elevation", () => {
  it("never bridges a >500 m elevation gap into one feature", () => {
    const before = buildLeggedRoute([{ lengthMetres: 600, gradePercent: 5 }]); // ~30 m gain, qualifies
    const gapStart = before.at(-1)?.distanceFromStartMetres ?? 0;
    const afterPoints = buildLeggedRoute([{ lengthMetres: 600, gradePercent: 5 }]);
    const after: RoutePoint[] = afterPoints.map((point) => ({
      ...point,
      distanceFromStartMetres: point.distanceFromStartMetres + gapStart + 600,
    }));
    const points = [...before, ...after];
    const features = detect(points);
    const climbs = features.filter(isClimb);
    expect(climbs).toHaveLength(2);
    expect(climbs[0]?.endDistanceMetres).toBeLessThan(gapStart + 1);
    expect(climbs[1]?.startDistanceMetres).toBeGreaterThan(gapStart + 600 - 1);
  });
});

describe("detectRouteFeatures: flat plateaus adjacent to a climb", () => {
  it("does not absorb a flat lead-in into the following climb — the climb starts at the plateau's own end, not the run's start", () => {
    // A flat plateau immediately followed by a climb never reverses (it
    // only ever goes up or stays level), so there is no confirmed
    // direction change anywhere before the climb starts — the boundary
    // detector must still anchor the climb's own start at the plateau's
    // end, not silently include the whole flat stretch in the climb.
    const points = buildLeggedRoute([
      { lengthMetres: 1000, gradePercent: 0 },
      { lengthMetres: 1000, gradePercent: 20 },
    ]);
    const features = detect(points);
    const climbs = features.filter(isClimb);
    expect(climbs).toHaveLength(1);
    const climb = climbs[0];
    if (!climb) throw new Error("expected one climb feature");
    expect(climb.startDistanceMetres).toBeGreaterThan(900);
    expect(climb.endDistanceMetres).toBeCloseTo(2000, -1);
    // The true climb averages 20%; a lead-in-diluted average would be
    // roughly half that (~10%) — confirms the flat stretch is excluded,
    // not just checked via boundaries alone.
    expect(climb.averageGradientPercent).toBeGreaterThan(15);
  });

  it("does not extend a climb's end through a trailing flat plateau", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 1000, gradePercent: 20 },
      { lengthMetres: 1000, gradePercent: 0 },
    ]);
    const features = detect(points);
    const climbs = features.filter(isClimb);
    expect(climbs).toHaveLength(1);
    const climb = climbs[0];
    if (!climb) throw new Error("expected one climb feature");
    expect(climb.startDistanceMetres).toBeCloseTo(0, -1);
    expect(climb.endDistanceMetres).toBeLessThan(1100);
    expect(climb.averageGradientPercent).toBeGreaterThan(15);
  });
});

describe("detectRouteFeatures: invariants", () => {
  it("returns non-overlapping, ascending features across multiple climbs and descents", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 1500, gradePercent: 8 },
      { lengthMetres: 1500, gradePercent: -8 },
      { lengthMetres: 1500, gradePercent: 6 },
      { lengthMetres: 1500, gradePercent: -6 },
    ]);
    const features = detect(points);
    expect(features.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < features.length - 1; i += 1) {
      const current = features[i];
      const next = features[i + 1];
      expect(current?.endDistanceMetres).toBeLessThanOrEqual(
        next?.startDistanceMetres ?? Infinity,
      );
      expect(current?.startDistanceMetres).toBeLessThan(
        current?.endDistanceMetres ?? -Infinity,
      );
    }
  });

  describe("listClimbsInRouteOrder", () => {
    it("returns only climbs, in ascending start-distance order, excluding descents", () => {
      const points = buildLeggedRoute([
        { lengthMetres: 1500, gradePercent: 8 },
        { lengthMetres: 1500, gradePercent: -8 },
        { lengthMetres: 1500, gradePercent: 6 },
        { lengthMetres: 1500, gradePercent: -6 },
      ]);
      const features = detect(points);
      const climbs = listClimbsInRouteOrder(features);

      expect(climbs.length).toBeGreaterThanOrEqual(2);
      // Descents are present in the source fixture but excluded here.
      expect(features.some((feature) => feature.kind === "descent")).toBe(true);
      expect(climbs.length).toBeLessThan(features.length);
      for (let i = 0; i < climbs.length - 1; i += 1) {
        expect(climbs[i]?.startDistanceMetres).toBeLessThan(
          climbs[i + 1]?.startDistanceMetres ?? Infinity,
        );
      }
    });

    it("returns an empty array when there are no climbs", () => {
      const points = buildLeggedRoute([{ lengthMetres: 1500, gradePercent: -8 }]);
      const features = detect(points);
      expect(listClimbsInRouteOrder(features)).toEqual([]);
    });
  });

  it("uses the smoothed local grade (not a raw single-sample spike) for maxGradientPercent", () => {
    const spikeMetres = 80;
    const points = buildLeggedRoute([{ lengthMetres: 4000, gradePercent: 5 }]);
    // Inject one raw elevation spike well inside the climb.
    const spiked = points.map((point, index) =>
      index === 100
        ? { ...point, elevationMetres: (point.elevationMetres ?? 0) + spikeMetres }
        : point,
    );
    const features = detect(spiked);
    const climb = features.find(isClimb);
    if (!climb) throw new Error("expected a climb feature");
    // A raw two-point slope straight across the spike would be enormous
    // (80 m over the 20 m resample step => 400%); the regression-fitted
    // grade (averaged over a ~100 m window of mostly unaffected points)
    // must dilute that dramatically rather than reflect it near-verbatim.
    const rawTwoPointSlopePercent = (spikeMetres / STEP_METRES) * 100;
    expect(climb.maxGradientPercent).toBeLessThan(rawTwoPointSlopePercent * 0.5);
  });

  it("never mutates the input points", () => {
    const points = buildLeggedRoute([{ lengthMetres: 2000, gradePercent: 6 }]);
    const snapshot = JSON.parse(JSON.stringify(points)) as RoutePoint[];
    detect(points);
    expect(points).toEqual(snapshot);
  });

  it("produces identical results across repeated calls on the same profile (stable ids, no windowing dependency)", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 2000, gradePercent: 6 },
      { lengthMetres: 2000, gradePercent: -6 },
    ]);
    const profile = analyzeRouteElevationProfile(points);
    const first = detectRouteFeatures(profile);
    const second = detectRouteFeatures(profile);
    expect(first).toEqual(second);
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id));
  });
});

describe("findFeatureAtDistance", () => {
  const points = buildLeggedRoute([
    { lengthMetres: 2000, gradePercent: 6 },
    { lengthMetres: 500, gradePercent: 0.1 }, // ordinary/flat gap between features
    { lengthMetres: 2000, gradePercent: -6 },
  ]);
  const features = detect(points);

  it("returns the feature containing a distance inside its range", () => {
    const climb = features.find(isClimb);
    if (!climb) throw new Error("expected a climb feature");
    const midpoint = (climb.startDistanceMetres + climb.endDistanceMetres) / 2;
    expect(findFeatureAtDistance(features, midpoint)).toBe(climb);
  });

  it("returns null for a distance in an ordinary (non-feature) section", () => {
    expect(features.length).toBeGreaterThanOrEqual(2);
    // Somewhere between the end of the first feature and the start of the
    // next is ordinary route.
    const sorted = [...features].sort(
      (a, b) => a.startDistanceMetres - b.startDistanceMetres,
    );
    const gapMidpoint =
      ((sorted[0]?.endDistanceMetres ?? 0) + (sorted[1]?.startDistanceMetres ?? 0)) / 2;
    if (gapMidpoint > (sorted[0]?.endDistanceMetres ?? 0)) {
      expect(findFeatureAtDistance(features, gapMidpoint)).toBeNull();
    }
  });

  it("returns null outside every feature", () => {
    expect(findFeatureAtDistance(features, -1000)).toBeNull();
    expect(findFeatureAtDistance([], 500)).toBeNull();
  });
});

describe("resolveElevationChartTap", () => {
  const climb: ClimbFeature = {
    id: "climb-0",
    kind: "climb",
    startDistanceMetres: 0,
    endDistanceMetres: 1000,
    lengthMetres: 1000,
    elevationGainMetres: 60,
    averageGradientPercent: 6,
    maxGradientPercent: 8,
    climbScore: 6000,
    category: "category-4",
  };
  const otherClimb: ClimbFeature = {
    ...climb,
    id: "climb-2000",
    startDistanceMetres: 2000,
    endDistanceMetres: 3000,
  };
  const segment: GradientSegment = {
    startDistanceMetres: 200,
    endDistanceMetres: 400,
    averageGradientPercent: 7,
    classification: "moderate-climb",
  };
  const microSegments: GradientSegment[] = [segment];

  it("resolves to the micro segment when the tap falls inside the detail feature and a matching segment exists", () => {
    const result = resolveElevationChartTap(
      300,
      [climb, otherClimb],
      climb,
      microSegments,
    );
    expect(result).toEqual({ kind: "segment", segment });
  });

  it("resolves to the macro feature when the tap falls outside the detail feature", () => {
    const result = resolveElevationChartTap(
      2500,
      [climb, otherClimb],
      climb,
      microSegments,
    );
    expect(result).toEqual({ kind: "feature", feature: otherClimb });
  });

  it("resolves to the macro feature when the tap is inside the detail feature but no micro segment covers it", () => {
    const result = resolveElevationChartTap(
      900,
      [climb, otherClimb],
      climb,
      microSegments,
    );
    expect(result).toEqual({ kind: "feature", feature: climb });
  });

  it("resolves to null on an ordinary (non-feature) section with no detail feature active", () => {
    const result = resolveElevationChartTap(1500, [climb, otherClimb], null, []);
    expect(result).toBeNull();
  });
});
