import { describe, expect, it } from "vitest";
import {
  analyzeElevation,
  hasAnyElevation,
  MIN_ASCENT_DELTA_METRES,
  remainingAscentMetres,
  RESAMPLE_STEP_METRES,
  type ElevationAnalysis,
} from "./elevation.ts";
import type { RoutePoint } from "../domain/types.ts";

function buildPoints(
  elevations: readonly (number | null)[],
  stepMetres = RESAMPLE_STEP_METRES,
): RoutePoint[] {
  return elevations.map((elevationMetres, index) => ({
    coordinate: [0, 51] as const,
    elevationMetres,
    distanceFromStartMetres: index * stepMetres,
  }));
}

function expectNumber(value: number | null): number {
  expect(value).not.toBeNull();
  if (value === null) {
    throw new Error("expected a non-null number");
  }
  return value;
}

function naiveRawAscent(elevations: readonly number[]): number {
  let total = 0;
  let previous: number | undefined;
  for (const elevation of elevations) {
    if (previous !== undefined) {
      const delta = elevation - previous;
      if (delta > 0) total += delta;
    }
    previous = elevation;
  }
  return total;
}

describe("hasAnyElevation", () => {
  it("is true when at least one point has elevation", () => {
    expect(hasAnyElevation(buildPoints([null, 10, null]))).toBe(true);
  });

  it("is false when no point has elevation", () => {
    expect(hasAnyElevation(buildPoints([null, null, null]))).toBe(false);
  });
});

describe("analyzeElevation: missing elevation", () => {
  it("returns null ascent/descent when no point has elevation", () => {
    const analysis: ElevationAnalysis = analyzeElevation(buildPoints([null, null, null]));
    expect(analysis).toEqual({ ascentMetres: null, descentMetres: null });
  });
});

describe("analyzeElevation: gentle sustained climb", () => {
  it("accumulates a long gentle climb whose individual steps are below the threshold", () => {
    // 0.1 m every 20 m step is far below MIN_ASCENT_DELTA_METRES on its
    // own; a naive per-sample delta filter would discard every step and
    // report 0 m of ascent. The reversal-based algorithm should still
    // recover the true ~4.9 m climb.
    const stepClimbMetres = 0.1;
    expect(stepClimbMetres).toBeLessThan(MIN_ASCENT_DELTA_METRES);

    const elevations = Array.from({ length: 50 }, (_, i) => i * stepClimbMetres);
    const analysis = analyzeElevation(buildPoints(elevations));
    const ascent = expectNumber(analysis.ascentMetres);

    expect(ascent).toBeGreaterThan(4);
    expect(analysis.descentMetres).toBeLessThan(1);
  });
});

describe("analyzeElevation: noisy signal", () => {
  it("recovers close to the true climb and stays well below the naive raw-noise sum", () => {
    const trueClimbPerStep = 0.4; // 2% grade at a 20 m step
    const stepCount = 51;
    const rawElevations = Array.from({ length: stepCount }, (_, i) => {
      const trueElevation = i * trueClimbPerStep;
      const noise = i % 2 === 0 ? 0.5 : -0.5;
      return trueElevation + noise;
    });
    const trueTotalClimb = (stepCount - 1) * trueClimbPerStep;

    const analysis = analyzeElevation(buildPoints(rawElevations));
    const ascent = expectNumber(analysis.ascentMetres);

    expect(Math.abs(ascent - trueTotalClimb)).toBeLessThan(5);
    expect(ascent).toBeLessThan(naiveRawAscent(rawElevations));
  });
});

describe("analyzeElevation: partial missing elevation", () => {
  it("bridges interior nulls by interpolation and still reports a climb", () => {
    // A longer series keeps the moving average's fixed edge bias (a
    // constant, window-sized effect) a small fraction of the total climb,
    // so the interior null-bridging behaviour isn't swamped by it.
    const totalPoints = 30;
    const totalClimb = 30;
    const elevations: (number | null)[] = Array.from({ length: totalPoints }, (_, i) =>
      i === 14 || i === 15 ? null : (i * totalClimb) / (totalPoints - 1),
    );

    const analysis = analyzeElevation(buildPoints(elevations));
    const ascent = expectNumber(analysis.ascentMetres);

    expect(ascent).toBeGreaterThan(totalClimb * 0.8);
    expect(analysis.descentMetres).toBeLessThan(1);
  });

  it("flat-extrapolates a leading or trailing null run", () => {
    const elevations: (number | null)[] = [null, null, 10, 15, 20, null];
    const analysis = analyzeElevation(buildPoints(elevations));
    const ascent = expectNumber(analysis.ascentMetres);

    expect(ascent).toBeGreaterThan(5);
  });
});

describe("analyzeElevation: descent", () => {
  it("reports descent for a downhill route", () => {
    const totalPoints = 30;
    const totalDrop = 100;
    const elevations = Array.from(
      { length: totalPoints },
      (_, i) => totalDrop - (i * totalDrop) / (totalPoints - 1),
    );

    const analysis = analyzeElevation(buildPoints(elevations));
    const descent = expectNumber(analysis.descentMetres);

    expect(descent).toBeGreaterThan(totalDrop * 0.8);
    expect(analysis.ascentMetres).toBeLessThan(1);
  });
});

describe("remainingAscentMetres", () => {
  it("agrees exactly (not approximately) with analyzeElevation's ascent at progress zero", () => {
    const elevations = Array.from({ length: 50 }, (_, i) => i * 0.1);
    const points = buildPoints(elevations);
    expect(remainingAscentMetres(points, 0)).toBe(analyzeElevation(points).ascentMetres);
  });

  it("agrees exactly with analyzeElevation's ascent at progress zero for a noisy signal", () => {
    const trueClimbPerStep = 0.4;
    const stepCount = 51;
    const rawElevations = Array.from({ length: stepCount }, (_, i) => {
      const trueElevation = i * trueClimbPerStep;
      const noise = i % 2 === 0 ? 0.5 : -0.5;
      return trueElevation + noise;
    });
    const points = buildPoints(rawElevations);
    expect(remainingAscentMetres(points, 0)).toBe(analyzeElevation(points).ascentMetres);
  });

  it("sums every future climb, decreasing across multiple progress points, rather than a net delta to the finish", () => {
    // climb1: 0 -> 30 over indices 0-10; descent: 30 -> 10 over indices
    // 11-15; climb2: 10 -> 50 over indices 16-25; flat 50 over 26-30. A
    // net-elevation-delta implementation (current position vs finish)
    // would report ~20 m at the climb1 peak (50 - 30); the correct
    // sum-of-future-climbs answer is ~40 m (the still-ahead descent-then-
    // climb2), so these fixtures and bounds are chosen to fail a net-delta
    // implementation, not just a raw-noise-summing one.
    const climb1 = Array.from({ length: 11 }, (_, i) => i * 3); // 0..30
    const descent = Array.from({ length: 5 }, (_, i) => 30 - (i + 1) * 4); // 26..10
    const climb2 = Array.from({ length: 10 }, (_, i) => 10 + (i + 1) * 4); // 14..50
    const flat = Array.from({ length: 5 }, () => 50);
    const elevations = [...climb1, ...descent, ...climb2, ...flat];
    const points = buildPoints(elevations);

    const atStart = expectNumber(remainingAscentMetres(points, 0));
    const atClimb1Peak = expectNumber(
      remainingAscentMetres(points, 10 * RESAMPLE_STEP_METRES),
    );
    const midClimb2 = expectNumber(
      remainingAscentMetres(points, 20 * RESAMPLE_STEP_METRES),
    );
    const atClimb2Top = expectNumber(
      remainingAscentMetres(points, 25 * RESAMPLE_STEP_METRES),
    );

    // Sum of both future climbs (raw ~30 + 40 = 70, reduced somewhat by
    // smoothing across the intervening reversals), clearly more than
    // either climb alone.
    expect(atStart).toBeGreaterThan(50);
    expect(atStart).toBeLessThan(65);

    // Only climb2 remains; a net-delta implementation (current position
    // vs. finish) would report ~20 m here (50 - 30), so the lower bound
    // is set safely above that to fail such an implementation.
    expect(atClimb1Peak).toBeGreaterThan(30);
    expect(atClimb1Peak).toBeLessThan(40);
    expect(atClimb1Peak).toBeLessThan(atStart);

    // Partway up climb2: less remains than at its base.
    expect(midClimb2).toBeGreaterThan(15);
    expect(midClimb2).toBeLessThan(atClimb1Peak);

    // At climb2's own summit, essentially nothing climbs remain.
    expect(atClimb2Top).toBeLessThan(midClimb2);
    expect(atClimb2Top).toBeLessThan(5);
  });

  it("preserves the existing interior-gap bridging policy, and still matches analyzeElevation exactly at progress zero", () => {
    const totalPoints = 30;
    const totalClimb = 30;
    const elevations: (number | null)[] = Array.from({ length: totalPoints }, (_, i) =>
      i === 14 || i === 15 ? null : (i * totalClimb) / (totalPoints - 1),
    );
    const points = buildPoints(elevations);

    const atStart = expectNumber(remainingAscentMetres(points, 0));
    expect(atStart).toBe(analyzeElevation(points).ascentMetres);
    expect(atStart).toBeGreaterThan(totalClimb * 0.8);

    const afterGap = expectNumber(
      remainingAscentMetres(points, 20 * RESAMPLE_STEP_METRES),
    );
    expect(afterGap).toBeGreaterThan(0);
    expect(afterGap).toBeLessThan(atStart);
  });

  it("returns null, never zero, when the route has no known elevation anywhere", () => {
    const points = buildPoints([null, null, null]);
    expect(remainingAscentMetres(points, 0)).toBeNull();
    expect(remainingAscentMetres(points, 20)).toBeNull();
    expect(remainingAscentMetres(points, 1000)).toBeNull();
  });

  it("returns numeric 0, not null, for a known flat remainder", () => {
    const points = buildPoints(Array.from({ length: 20 }, () => 42));
    expect(remainingAscentMetres(points, 0)).toBe(0);
  });

  it("returns 0 at and beyond the route finish when elevation is known, clamping past-the-end progress", () => {
    const elevations = Array.from({ length: 50 }, (_, i) => i * 0.1);
    const points = buildPoints(elevations);
    const totalDistance = points.at(-1)?.distanceFromStartMetres ?? 0;

    expect(remainingAscentMetres(points, totalDistance)).toBe(0);
    expect(remainingAscentMetres(points, totalDistance + 500)).toBe(0);
  });

  it("returns null, not 0, at and beyond the finish when no elevation is known", () => {
    const points = buildPoints([null, null, null]);
    const totalDistance = points.at(-1)?.distanceFromStartMetres ?? 0;
    expect(remainingAscentMetres(points, totalDistance)).toBeNull();
    expect(remainingAscentMetres(points, totalDistance + 500)).toBeNull();
  });

  it("genuinely interpolates between resample grid points rather than snapping to the nearest one", () => {
    // A clean 1 m-per-20 m linear climb (5% grade) over indices 0-80,
    // then a flat plateau at the summit for the remaining indices. Both
    // the query point and the summit sit on fully in-bounds moving-average
    // windows (a window of identical plateau values, or a window entirely
    // inside the linear run, averages back to the exact underlying value,
    // with no edge-clipping bias) — so the expected remaining ascent from
    // the query to the summit is exactly computable, and the trailing
    // plateau avoids the whole-route edge bias that a climb-to-the-very-
    // last-sample fixture would otherwise introduce at the finish.
    const summitElevation = 80;
    const climb = Array.from({ length: summitElevation + 1 }, (_, i) => i);
    const plateau = Array.from({ length: 20 }, () => summitElevation);
    const points = buildPoints([...climb, ...plateau]);

    const grade = 1 / RESAMPLE_STEP_METRES;
    const summitDistanceMetres = summitElevation * RESAMPLE_STEP_METRES;
    const fromDistanceMetres = 1007; // deliberately not a multiple of 20
    const expected = summitElevation - grade * fromDistanceMetres;
    expect(fromDistanceMetres).toBeLessThan(summitDistanceMetres);

    const result = expectNumber(remainingAscentMetres(points, fromDistanceMetres));
    expect(result).toBeCloseTo(expected, 6);

    // Snapping to either neighbouring grid sample would be off by far more
    // than the tolerance above (0.35 m / 0.65 m vs. the grid's own step).
    expect(Math.abs(result - expected)).toBeLessThan(0.01);
  });

  it("does not mutate the input points", () => {
    const elevations = Array.from({ length: 20 }, (_, i) => i * 2);
    const points = Object.freeze(
      buildPoints(elevations).map((point) => Object.freeze(point)),
    );
    expect(() => remainingAscentMetres(points, 150)).not.toThrow();
    expect(remainingAscentMetres(points, 150)).not.toBeNull();
  });
});
