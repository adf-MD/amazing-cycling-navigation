import { describe, expect, it } from "vitest";
import {
  analyzeRouteElevationProfile,
  classifyRunGrades,
  clipClassifiedSegments,
  findClassifiedSegmentAtDistance,
  MIN_SEGMENT_LENGTH_METRES,
  type ClassifiedSegment,
  type ElevationRun,
} from "./gradient.ts";
import {
  interpolateRoutePointAt,
  selectUpcomingElevationWindow,
} from "./upcomingElevation.ts";
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

function expectNumber(value: number | null | undefined): number {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  if (value === null || value === undefined) {
    throw new Error("expected a non-null number");
  }
  return value;
}

/** A minimal synthetic classification scheme, independent of any real
 * domain (climb/descent), used only to prove classifyRunGrades/
 * clipClassifiedSegments/findClassifiedSegmentAtDistance behave correctly
 * in general — the real climb/descent boundary tables live in
 * routeFeatures.test.ts. */
type TestBand = "low" | "mid" | "high";
const TEST_BAND_ORDER: readonly TestBand[] = ["low", "mid", "high"];
function classifyTestBand(gradePercent: number): TestBand {
  if (gradePercent < 5) return "low";
  if (gradePercent < 10) return "mid";
  return "high";
}

/** Builds a fixture ElevationRun directly from a chosen gradesPercent
 * sequence, with arbitrary-but-monotonic elevations/smoothed values — the
 * merge/flicker-suppression pipeline under test only reads distances and
 * gradesPercent to build segments, and elevations/distances only to
 * compute each merged segment's own averageGradientPercent (not to
 * re-derive gradesPercent), so this fixture need not be internally
 * "physically consistent" the way a real analysis would be. */
function buildTestRun(gradesPercent: readonly number[]): ElevationRun {
  const distances = gradesPercent.map((_, i) => i * STEP_METRES);
  const elevations = gradesPercent.map((_, i) => i);
  return { distances, smoothed: [...elevations], elevations, gradesPercent };
}

function expectContiguousCoverage<Class extends string>(
  segments: readonly ClassifiedSegment<Class>[],
  startDistanceMetres: number,
  endDistanceMetres: number,
): void {
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0]?.startDistanceMetres).toBe(startDistanceMetres);
  expect(segments.at(-1)?.endDistanceMetres).toBe(endDistanceMetres);
  for (let i = 0; i < segments.length - 1; i += 1) {
    expect(segments[i]?.endDistanceMetres).toBe(segments[i + 1]?.startDistanceMetres);
  }
}

describe("classifyRunGrades", () => {
  it("classifies a sustained grade run as one contiguous band covering the whole run", () => {
    const points = buildConstantGradeRoute(6, 100);
    const { runs } = analyzeRouteElevationProfile(points);
    const run = runs[0];
    if (!run) throw new Error("expected a run");
    const segments = classifyRunGrades(run, classifyTestBand, "low", TEST_BAND_ORDER);
    expectContiguousCoverage(segments, run.distances[0] ?? 0, run.distances.at(-1) ?? 0);
    for (const segment of segments) {
      expect(segment.visualKey).toBe("mid");
      expect(expectNumber(segment.averageGradientPercent)).toBeCloseTo(6, 0);
    }
  });

  it("never returns two consecutive segments with the same visualKey", () => {
    const points = buildConstantGradeRoute(8, 200);
    const { runs } = analyzeRouteElevationProfile(points);
    const run = runs[0];
    if (!run) throw new Error("expected a run");
    const segments = classifyRunGrades(run, classifyTestBand, "low", TEST_BAND_ORDER);
    for (let i = 0; i < segments.length - 1; i += 1) {
      expect(segments[i]?.visualKey).not.toBe(segments[i + 1]?.visualKey);
    }
  });

  it("does not let a single-sample spike form its own short segment (flicker suppression)", () => {
    const grades = Array.from({ length: 100 }, (_, i) => (i === 50 ? 15 : 2));
    const run = buildTestRun(grades);
    const segments = classifyRunGrades(run, classifyTestBand, "low", TEST_BAND_ORDER);
    expectContiguousCoverage(segments, 0, run.distances.at(-1) ?? 0);
    const shortNonLow = segments.filter(
      (segment) =>
        segment.visualKey !== "low" &&
        segment.endDistanceMetres - segment.startDistanceMetres <
          MIN_SEGMENT_LENGTH_METRES,
    );
    expect(shortNonLow).toEqual([]);
  });

  it("retains a genuine sustained band change embedded in a longer run", () => {
    const grades = Array.from({ length: 100 }, (_, i) => (i >= 40 && i < 50 ? 15 : 2));
    const run = buildTestRun(grades);
    const segments = classifyRunGrades(run, classifyTestBand, "low", TEST_BAND_ORDER);
    const highSegments = segments.filter((segment) => segment.visualKey === "high");
    expect(highSegments.length).toBeGreaterThan(0);
  });
});

describe("clipClassifiedSegments", () => {
  const segments: ClassifiedSegment<TestBand>[] = [
    {
      startDistanceMetres: 0,
      endDistanceMetres: 1000,
      averageGradientPercent: 0,
      visualKey: "low",
    },
    {
      startDistanceMetres: 1000,
      endDistanceMetres: 2000,
      averageGradientPercent: 8,
      visualKey: "mid",
    },
    {
      startDistanceMetres: 2000,
      endDistanceMetres: 3000,
      averageGradientPercent: 15,
      visualKey: "high",
    },
  ];

  it("clamps segment boundaries to the requested range", () => {
    const clipped = clipClassifiedSegments(segments, 500, 2500);
    expect(clipped[0]).toMatchObject({
      startDistanceMetres: 500,
      endDistanceMetres: 1000,
      visualKey: "low",
    });
    expect(clipped[1]).toMatchObject({
      startDistanceMetres: 1000,
      endDistanceMetres: 2000,
      visualKey: "mid",
    });
    expect(clipped[2]).toMatchObject({
      startDistanceMetres: 2000,
      endDistanceMetres: 2500,
      visualKey: "high",
    });
  });

  it("omits segments entirely outside the requested range", () => {
    const clipped = clipClassifiedSegments(segments, 2100, 2900);
    expect(clipped).toHaveLength(1);
    expect(clipped[0]?.visualKey).toBe("high");
  });

  it("agrees with the unclipped analysis at every shared distance (Full vs windowed consistency)", () => {
    const points = buildConstantGradeRoute(6, 200);
    const { runs } = analyzeRouteElevationProfile(points);
    const run = runs[0];
    if (!run) throw new Error("expected a run");
    const full = classifyRunGrades(run, classifyTestBand, "low", TEST_BAND_ORDER);
    const windowStart = 1000;
    const windowEnd = 2000;
    const clipped = clipClassifiedSegments(full, windowStart, windowEnd);

    function visualKeyAt(
      list: readonly ClassifiedSegment<TestBand>[],
      distanceMetres: number,
    ): TestBand | undefined {
      return list.find(
        (segment) =>
          distanceMetres >= segment.startDistanceMetres &&
          distanceMetres < segment.endDistanceMetres,
      )?.visualKey;
    }

    for (const distance of [1000, 1250, 1500, 1750, 1999]) {
      expect(visualKeyAt(clipped, distance)).toBe(visualKeyAt(full, distance));
    }
  });
});

describe("findClassifiedSegmentAtDistance", () => {
  const segments: ClassifiedSegment<TestBand>[] = [
    {
      startDistanceMetres: 0,
      endDistanceMetres: 1000,
      averageGradientPercent: 0,
      visualKey: "low",
    },
    {
      startDistanceMetres: 1000,
      endDistanceMetres: 2000,
      averageGradientPercent: 8,
      visualKey: "mid",
    },
  ];

  it("returns the segment containing a distance strictly inside it", () => {
    const segment = findClassifiedSegmentAtDistance(segments, 500);
    expect(segment?.visualKey).toBe("low");
  });

  it("resolves a distance exactly on a shared boundary to a segment (inclusive both ends)", () => {
    const segment = findClassifiedSegmentAtDistance(segments, 1000);
    expect(segment?.visualKey).toBe("low");
  });

  it("returns null outside every segment's range", () => {
    expect(findClassifiedSegmentAtDistance(segments, -100)).toBeNull();
    expect(findClassifiedSegmentAtDistance(segments, 3000)).toBeNull();
  });

  it("returns null for an empty segment list", () => {
    expect(findClassifiedSegmentAtDistance([], 100)).toBeNull();
  });
});

describe("analyzeRouteElevationProfile", () => {
  it("gives displayPoints close to the true line away from the edges for a constant incline", () => {
    const gradePercent = 6;
    const points = buildConstantGradeRoute(gradePercent, 100);
    const { displayPoints } = analyzeRouteElevationProfile(points);

    expect(displayPoints).toHaveLength(points.length);
    // Away from the very first/last few points, the smoothed display
    // series should sit close to the true linear elevation.
    for (const point of displayPoints.slice(10, -10)) {
      const trueElevationMetres = (point.distanceFromStartMetres * gradePercent) / 100;
      expect(expectNumber(point.elevationMetres)).toBeCloseTo(trueElevationMetres, 1);
    }
  });

  it("visibly smooths small alternating elevation noise in the display series", () => {
    const pointCount = 100;
    const rawElevations = Array.from({ length: pointCount }, (_, i) =>
      i % 2 === 0 ? 0.3 : -0.3,
    );
    const points = buildPoints(rawElevations);
    const { displayPoints } = analyzeRouteElevationProfile(points);

    const interior = displayPoints.slice(5, -5);
    expect(interior.length).toBeGreaterThan(0);
    for (let i = 1; i < interior.length; i += 1) {
      const previous = interior[i - 1]?.elevationMetres;
      const current = interior[i]?.elevationMetres;
      if (previous === null || previous === undefined) continue;
      if (current === null || current === undefined) continue;
      // Raw alternation has a 0.6 m step-to-step swing; smoothing must
      // visibly reduce it.
      expect(Math.abs(current - previous)).toBeLessThan(0.3);
    }
  });

  it("handles a route close to the minimum grade window safely, with no throw or non-finite value", () => {
    const points = buildPoints([0, 2, 4], 20); // 40 m total, exactly MIN_GRADE_WINDOW_METRES
    expect(() => analyzeRouteElevationProfile(points)).not.toThrow();
    const { displayPoints } = analyzeRouteElevationProfile(points);
    for (const point of displayPoints) {
      if (point.elevationMetres !== null) {
        expect(Number.isFinite(point.elevationMetres)).toBe(true);
      }
    }
  });

  it("leaves displayPoints null through leading/trailing null runs, non-null within a covered run", () => {
    const points = buildPoints([null, null, 10, 15, 20, null]);
    const { displayPoints } = analyzeRouteElevationProfile(points);
    expect(displayPoints).toHaveLength(points.length);
    expect(displayPoints[0]?.elevationMetres).toBeNull();
    expect(displayPoints[1]?.elevationMetres).toBeNull();
    expect(displayPoints[5]?.elevationMetres).toBeNull();
    expect(displayPoints[2]?.elevationMetres).not.toBeNull();
    expect(displayPoints[3]?.elevationMetres).not.toBeNull();
    expect(displayPoints[4]?.elevationMetres).not.toBeNull();
  });

  it("leaves displayPoints null through a gap greater than the maximum, not interpolated across", () => {
    const before = buildPoints([0, 1, 2, 3], STEP_METRES);
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
    const { displayPoints } = analyzeRouteElevationProfile(points);
    const beforeLastElevation = expectNumber(
      displayPoints[before.length - 1]?.elevationMetres,
    );
    const afterFirstElevation = expectNumber(
      displayPoints[before.length]?.elevationMetres,
    );
    expect(beforeLastElevation).toBeGreaterThanOrEqual(0);
    expect(beforeLastElevation).toBeLessThan(10);
    expect(afterFirstElevation).toBeGreaterThan(40);
    expect(afterFirstElevation).toBeLessThanOrEqual(65);
  });

  it("produces no NaN/Infinity display values for duplicate/near-duplicate distances", () => {
    const points = buildPoints([0, 5, 5, 10, 15]);
    const repeated = points.map((point, index) =>
      index === 2
        ? { ...point, distanceFromStartMetres: points[1]?.distanceFromStartMetres ?? 0 }
        : point,
    );
    expect(() => analyzeRouteElevationProfile(repeated)).not.toThrow();
    const { displayPoints } = analyzeRouteElevationProfile(repeated);
    for (const point of displayPoints) {
      if (point.elevationMetres !== null) {
        expect(Number.isFinite(point.elevationMetres)).toBe(true);
      }
    }
  });

  it("keeps display-point elevation consistent between the Full series and a windowed slice of it", () => {
    const points = buildConstantGradeRoute(5, 200);
    const { displayPoints } = analyzeRouteElevationProfile(points);
    const window = selectUpcomingElevationWindow(displayPoints, 1000, 2000);
    expect(window.points.length).toBeGreaterThan(0);
    for (const point of window.points) {
      const direct = interpolateRoutePointAt(
        displayPoints,
        point.distanceFromStartMetres,
      );
      expect(point.elevationMetres).toBe(direct?.elevationMetres);
    }
  });

  it("never mutates the input points array or its elevation values", () => {
    const points = buildConstantGradeRoute(8, 60);
    const snapshot = JSON.parse(JSON.stringify(points)) as RoutePoint[];
    analyzeRouteElevationProfile(points);
    expect(points).toEqual(snapshot);
  });

  it("returns displayPoints with the exact same length, order and coordinates as the input", () => {
    const points = buildConstantGradeRoute(8, 60);
    const { displayPoints } = analyzeRouteElevationProfile(points);
    expect(displayPoints).toHaveLength(points.length);
    for (let i = 0; i < points.length; i += 1) {
      expect(displayPoints[i]?.coordinate).toEqual(points[i]?.coordinate);
      expect(displayPoints[i]?.distanceFromStartMetres).toBe(
        points[i]?.distanceFromStartMetres,
      );
    }
    // A genuinely new array, not the same object/array identity.
    expect(displayPoints).not.toBe(points);
  });
});

describe("analyzeRouteElevationProfile: runs", () => {
  it("returns one run with distances/smoothed/gradesPercent of equal length for a single continuous route", () => {
    const points = buildConstantGradeRoute(5, 60);
    const { runs } = analyzeRouteElevationProfile(points);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    if (run === undefined) throw new Error("expected a run");
    expect(run.distances.length).toBeGreaterThan(1);
    expect(run.smoothed).toHaveLength(run.distances.length);
    expect(run.gradesPercent).toHaveLength(run.distances.length);
    // Every distance in the run's own resampled grid produces a smoothed
    // elevation matching the same value analyzeRouteElevationProfile
    // already interpolated onto displayPoints — the two must agree since
    // they are the same underlying series.
    const { displayPoints } = analyzeRouteElevationProfile(points);
    for (let i = 0; i < run.distances.length; i += 1) {
      const distance = run.distances[i];
      if (distance === undefined) continue;
      const displayed = displayPoints.find(
        (point) => point.distanceFromStartMetres === distance,
      );
      if (displayed?.elevationMetres != null) {
        expect(displayed.elevationMetres).toBeCloseTo(expectNumber(run.smoothed[i]), 5);
      }
    }
    // Well inside a long constant-grade run, the regression-fitted local
    // grade should closely match the true constant grade.
    for (const grade of run.gradesPercent.slice(10, -10)) {
      expect(expectNumber(grade)).toBeCloseTo(5, 0);
    }
  });

  it("returns one run per contiguous known-elevation run, in ascending distance order, skipping gaps", () => {
    const first = buildPoints([0, 1, 2, 3, 4], STEP_METRES);
    const gapStart = totalDistanceOf(first);
    const second: RoutePoint[] = [0, 1, 2, 3, 4].map((elevationMetres, i) => ({
      coordinate: [0, 51] as const,
      elevationMetres,
      distanceFromStartMetres: gapStart + 600 + i * STEP_METRES,
    }));
    const { runs } = analyzeRouteElevationProfile([...first, ...second]);
    expect(runs).toHaveLength(2);
    const [firstRun, secondRun] = runs;
    expect(firstRun?.distances.at(-1)).toBeLessThan(secondRun?.distances[0] ?? Infinity);
  });

  it("returns no runs for a route with no usable elevation", () => {
    const points = buildPoints([null, null, null]);
    const { runs } = analyzeRouteElevationProfile(points);
    expect(runs).toEqual([]);
  });

  it("never mutates the input points while building runs", () => {
    const points = buildConstantGradeRoute(6, 40);
    const snapshot = JSON.parse(JSON.stringify(points)) as RoutePoint[];
    analyzeRouteElevationProfile(points);
    expect(points).toEqual(snapshot);
  });
});
