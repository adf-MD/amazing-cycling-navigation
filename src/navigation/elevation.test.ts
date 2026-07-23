import { describe, expect, it } from "vitest";
import {
  analyzeElevation,
  hasAnyElevation,
  MIN_ASCENT_DELTA_METRES,
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
