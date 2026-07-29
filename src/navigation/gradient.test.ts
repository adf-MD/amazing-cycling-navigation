import { describe, expect, it } from "vitest";
import {
  analyzeGradient,
  classifyGrade,
  clipGradientSegments,
  MIN_SEGMENT_LENGTH_METRES,
  type GradientSegment,
} from "./gradient.ts";
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

/** Builds a route with a constant grade throughout, long enough to clear
 * every windowing edge effect. */
function buildConstantGradeRoute(
  gradePercent: number,
  pointCount = 60,
  stepMetres = STEP_METRES,
): RoutePoint[] {
  const elevations = Array.from(
    { length: pointCount },
    (_, i) => (i * stepMetres * gradePercent) / 100,
  );
  return buildPoints(elevations, stepMetres);
}

function totalDistanceOf(points: readonly RoutePoint[]): number {
  return points.at(-1)?.distanceFromStartMetres ?? 0;
}

function expectNumber(value: number | null): number {
  expect(value).not.toBeNull();
  if (value === null) {
    throw new Error("expected a non-null number");
  }
  return value;
}

function expectContiguousCoverage(
  segments: readonly GradientSegment[],
  totalDistanceMetres: number,
): void {
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0]?.startDistanceMetres).toBe(0);
  expect(segments.at(-1)?.endDistanceMetres).toBe(totalDistanceMetres);
  for (let i = 0; i < segments.length - 1; i += 1) {
    expect(segments[i]?.endDistanceMetres).toBe(segments[i + 1]?.startDistanceMetres);
  }
  const summedLength = segments.reduce(
    (sum, segment) => sum + (segment.endDistanceMetres - segment.startDistanceMetres),
    0,
  );
  expect(summedLength).toBeCloseTo(totalDistanceMetres, 6);
}

describe("classifyGrade boundaries", () => {
  it.each([
    [-10, "steep-descent"],
    [-6.001, "steep-descent"],
    [-6, "descent"],
    [-4, "descent"],
    [-2.001, "descent"],
    [-2, "flat"],
    [0, "flat"],
    [1.999, "flat"],
    [2, "gentle-climb"],
    [3, "gentle-climb"],
    [3.999, "gentle-climb"],
    [4, "moderate-climb"],
    [5, "moderate-climb"],
    [6.999, "moderate-climb"],
    [7, "hard-climb"],
    [8, "hard-climb"],
    [9.999, "hard-climb"],
    [10, "very-steep-climb"],
    [15, "very-steep-climb"],
  ] as const)("classifies %d%% as %s", (gradePercent, expected) => {
    expect(classifyGrade(gradePercent)).toBe(expected);
  });
});

describe("analyzeGradient: empty and trivial input", () => {
  it("returns an empty array for no points", () => {
    expect(analyzeGradient([])).toEqual([]);
  });

  it("returns an empty array for a single point at the start", () => {
    expect(analyzeGradient(buildPoints([10]))).toEqual([]);
  });

  it("returns a whole-route unknown segment when no point has elevation", () => {
    const points = buildPoints([null, null, null, null, null]);
    const segments = analyzeGradient(points);
    expectContiguousCoverage(segments, totalDistanceOf(points));
    for (const segment of segments) {
      expect(segment.classification).toBe("unknown");
      expect(segment.averageGradientPercent).toBeNull();
    }
  });

  it("stays unknown for a lone known point surrounded by nulls", () => {
    const points = buildPoints([null, null, 10, null, null]);
    const segments = analyzeGradient(points);
    expectContiguousCoverage(segments, totalDistanceOf(points));
    for (const segment of segments) {
      expect(segment.classification).toBe("unknown");
    }
  });
});

describe("analyzeGradient: flat route", () => {
  it("classifies a flat route with small realistic noise as flat throughout", () => {
    const pointCount = 100;
    const elevations = Array.from({ length: pointCount }, (_, i) =>
      i % 2 === 0 ? 0.3 : -0.3,
    );
    const points = buildPoints(elevations);
    const segments = analyzeGradient(points);
    expectContiguousCoverage(segments, totalDistanceOf(points));
    for (const segment of segments) {
      expect(["flat", "unknown"]).toContain(segment.classification);
    }
    expect(segments.some((segment) => segment.classification === "flat")).toBe(true);
  });
});

describe("analyzeGradient: sustained climbs", () => {
  it.each([
    [3, "gentle-climb"],
    [5, "moderate-climb"],
    [8, "hard-climb"],
    [12, "very-steep-climb"],
  ] as const)("classifies a sustained %d%% climb as %s", (gradePercent, expected) => {
    const points = buildConstantGradeRoute(gradePercent);
    const segments = analyzeGradient(points);
    expectContiguousCoverage(segments, totalDistanceOf(points));
    const classified = segments.filter((segment) => segment.classification !== "unknown");
    expect(classified.length).toBeGreaterThan(0);
    for (const segment of classified) {
      expect(segment.classification).toBe(expected);
      expect(expectNumber(segment.averageGradientPercent)).toBeCloseTo(gradePercent, 0);
    }
  });
});

describe("analyzeGradient: sustained descents", () => {
  it.each([
    [-3, "descent"],
    [-8, "steep-descent"],
  ] as const)("classifies a sustained %d%% descent as %s", (gradePercent, expected) => {
    const points = buildConstantGradeRoute(gradePercent);
    const segments = analyzeGradient(points);
    const classified = segments.filter((segment) => segment.classification !== "unknown");
    expect(classified.length).toBeGreaterThan(0);
    for (const segment of classified) {
      expect(segment.classification).toBe(expected);
    }
  });
});

describe("analyzeGradient: noise suppression vs genuine features", () => {
  it("does not let a single-sample 20 m spike form its own short segment", () => {
    const pointCount = 100;
    const elevations = Array.from({ length: pointCount }, (_, i) => (i === 50 ? 5 : 0));
    const points = buildPoints(elevations);
    const segments = analyzeGradient(points);
    expectContiguousCoverage(segments, totalDistanceOf(points));
    const shortNonFlat = segments.filter(
      (segment) =>
        segment.classification !== "flat" &&
        segment.classification !== "unknown" &&
        segment.endDistanceMetres - segment.startDistanceMetres <
          MIN_SEGMENT_LENGTH_METRES,
    );
    expect(shortNonFlat).toEqual([]);
  });

  it("retains a genuine ~100 m steep ramp embedded in a long flat route", () => {
    const pointCount = 150; // 3000 m total
    const rampStart = 1400;
    const rampEnd = 1500;
    const rampRiseMetres = 15;
    const elevations = Array.from({ length: pointCount }, (_, i) => {
      const distance = i * STEP_METRES;
      if (distance <= rampStart) return 0;
      if (distance >= rampEnd) return rampRiseMetres;
      return ((distance - rampStart) / (rampEnd - rampStart)) * rampRiseMetres;
    });
    const points = buildPoints(elevations);
    const segments = analyzeGradient(points);
    expectContiguousCoverage(segments, totalDistanceOf(points));

    const climbBands = [
      "gentle-climb",
      "moderate-climb",
      "hard-climb",
      "very-steep-climb",
    ];
    const overlappingRamp = segments.filter(
      (segment) =>
        climbBands.includes(segment.classification) &&
        segment.startDistanceMetres < rampEnd &&
        segment.endDistanceMetres > rampStart,
    );
    expect(overlappingRamp.length).toBeGreaterThan(0);
    expect(
      overlappingRamp.some((segment) => (segment.averageGradientPercent ?? 0) > 2),
    ).toBe(true);

    // The ramp is a strictly local feature: the route starts and ends flat,
    // and the climb zone doesn't swallow the whole route.
    expect(segments[0]?.classification).toBe("flat");
    expect(segments.at(-1)?.classification).toBe("flat");
    const climbZoneLength = overlappingRamp.reduce(
      (sum, segment) => sum + (segment.endDistanceMetres - segment.startDistanceMetres),
      0,
    );
    expect(climbZoneLength).toBeLessThan(totalDistanceOf(points) / 4);
  });
});

describe("analyzeGradient: robustness", () => {
  it("does not throw and covers the route when distances decrease", () => {
    const points = buildPoints([0, 5, 10, 15, 20]);
    const corrupted = points.map((point, index) =>
      index === 3 ? { ...point, distanceFromStartMetres: 10 } : point,
    );
    expect(() => analyzeGradient(corrupted)).not.toThrow();
    const segments = analyzeGradient(corrupted);
    expectContiguousCoverage(segments, totalDistanceOf(corrupted));
  });

  it("does not spike on repeated-distance points", () => {
    const points = buildPoints([0, 5, 5, 10, 15]);
    const repeated = points.map((point, index) =>
      index === 2
        ? { ...point, distanceFromStartMetres: points[1]?.distanceFromStartMetres ?? 0 }
        : point,
    );
    expect(() => analyzeGradient(repeated)).not.toThrow();
    for (const segment of analyzeGradient(repeated)) {
      if (segment.averageGradientPercent !== null) {
        expect(Number.isFinite(segment.averageGradientPercent)).toBe(true);
      }
    }
  });

  it("leaves a gap greater than the maximum as unknown rather than a measured grade", () => {
    const before = buildPoints([0, 1, 2, 3], STEP_METRES).map((point) => ({
      ...point,
      elevationMetres: point.elevationMetres,
    }));
    const gapStart = totalDistanceOf(before);
    const after: RoutePoint[] = [
      {
        coordinate: [0, 51],
        elevationMetres: 50,
        distanceFromStartMetres: gapStart + 600,
      },
      {
        coordinate: [0, 51],
        elevationMetres: 55,
        distanceFromStartMetres: gapStart + 620,
      },
      {
        coordinate: [0, 51],
        elevationMetres: 60,
        distanceFromStartMetres: gapStart + 640,
      },
      {
        coordinate: [0, 51],
        elevationMetres: 65,
        distanceFromStartMetres: gapStart + 660,
      },
    ];
    const points = [...before, ...after];
    const segments = analyzeGradient(points);
    expectContiguousCoverage(segments, totalDistanceOf(points));

    const gapSegment = segments.find(
      (segment) =>
        segment.startDistanceMetres <= gapStart &&
        segment.endDistanceMetres >= gapStart + 600,
    );
    expect(gapSegment).toBeDefined();
    expect(gapSegment?.classification).toBe("unknown");
  });

  it("leaves leading and trailing null runs unknown rather than flat-extrapolating", () => {
    const points = buildPoints([null, null, 10, 15, 20, null]);
    const segments = analyzeGradient(points);
    expectContiguousCoverage(segments, totalDistanceOf(points));

    const leading = segments.find((segment) => segment.startDistanceMetres === 0);
    expect(leading?.classification).toBe("unknown");
    const trailing = segments.find(
      (segment) => segment.endDistanceMetres === totalDistanceOf(points),
    );
    expect(trailing?.classification).toBe("unknown");
  });
});

describe("analyzeGradient: adjacent segments never share a classification", () => {
  it("never returns two consecutive segments with the same classification", () => {
    const points = buildConstantGradeRoute(8, 200);
    const segments = analyzeGradient(points);
    for (let i = 0; i < segments.length - 1; i += 1) {
      expect(segments[i]?.classification).not.toBe(segments[i + 1]?.classification);
    }
  });
});

describe("clipGradientSegments", () => {
  const segments: GradientSegment[] = [
    {
      startDistanceMetres: 0,
      endDistanceMetres: 1000,
      averageGradientPercent: 0,
      classification: "flat",
    },
    {
      startDistanceMetres: 1000,
      endDistanceMetres: 2000,
      averageGradientPercent: 8,
      classification: "hard-climb",
    },
    {
      startDistanceMetres: 2000,
      endDistanceMetres: 3000,
      averageGradientPercent: -8,
      classification: "steep-descent",
    },
  ];

  it("clamps segment boundaries to the requested range", () => {
    const clipped = clipGradientSegments(segments, 500, 2500);
    expect(clipped[0]).toMatchObject({
      startDistanceMetres: 500,
      endDistanceMetres: 1000,
      classification: "flat",
    });
    expect(clipped[1]).toMatchObject({
      startDistanceMetres: 1000,
      endDistanceMetres: 2000,
      classification: "hard-climb",
    });
    expect(clipped[2]).toMatchObject({
      startDistanceMetres: 2000,
      endDistanceMetres: 2500,
      classification: "steep-descent",
    });
  });

  it("omits segments entirely outside the requested range", () => {
    const clipped = clipGradientSegments(segments, 2100, 2900);
    expect(clipped).toHaveLength(1);
    expect(clipped[0]?.classification).toBe("steep-descent");
  });

  it("agrees with the unclipped analysis at every shared distance (Full vs windowed consistency)", () => {
    const points = buildConstantGradeRoute(5, 200);
    const full = analyzeGradient(points);
    const windowStart = 1000;
    const windowEnd = 2000;
    const clipped = clipGradientSegments(full, windowStart, windowEnd);

    function classificationAt(
      list: readonly GradientSegment[],
      distanceMetres: number,
    ): GradientClassOrUndefined {
      return list.find(
        (segment) =>
          distanceMetres >= segment.startDistanceMetres &&
          distanceMetres < segment.endDistanceMetres,
      )?.classification;
    }
    type GradientClassOrUndefined = GradientSegment["classification"] | undefined;

    for (const distance of [1000, 1250, 1500, 1750, 1999]) {
      expect(classificationAt(clipped, distance)).toBe(classificationAt(full, distance));
    }
  });
});
