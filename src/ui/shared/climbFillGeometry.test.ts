import { describe, expect, it } from "vitest";
import { areaPathFromRun, buildClimbFillRuns } from "./climbFillGeometry.ts";
import type { FeatureDetailChartRun } from "./elevationChartGradient.ts";
import type { ElevationChartPoint } from "./elevationChartGeometry.ts";

function points(...xs: number[]): ElevationChartPoint[] {
  return xs.map((x) => ({ x, y: 100 - x }));
}

describe("buildClimbFillRuns", () => {
  it("splits a single detail run into completed and remaining halves at the marker x", () => {
    const detailRuns: FeatureDetailChartRun[][] = [
      [{ visualKey: "moderate-climb", points: points(0, 50, 100) }],
    ];

    const result = buildClimbFillRuns(detailRuns, 50);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([
      { visualKey: "moderate-climb", completed: true, points: points(0, 50) },
      { visualKey: "moderate-climb", completed: false, points: points(50, 100) },
    ]);
  });

  it("preserves gradient-band boundaries already present before splitting at the marker", () => {
    const detailRuns: FeatureDetailChartRun[][] = [
      [
        { visualKey: "moderate-climb", points: points(0, 30) },
        { visualKey: "hard-climb", points: points(30, 60) },
        { visualKey: "very-hard-climb", points: points(60, 100) },
      ],
    ];

    const result = buildClimbFillRuns(detailRuns, 45);

    expect(result[0]).toEqual([
      { visualKey: "moderate-climb", completed: true, points: points(0, 30) },
      { visualKey: "hard-climb", completed: true, points: points(30, 45) },
      { visualKey: "hard-climb", completed: false, points: points(45, 60) },
      { visualKey: "very-hard-climb", completed: false, points: points(60, 100) },
    ]);
  });

  it("produces only a completed run when the marker is beyond the run's own x-range", () => {
    const detailRuns: FeatureDetailChartRun[][] = [
      [{ visualKey: "moderate-climb", points: points(0, 50, 100) }],
    ];

    const result = buildClimbFillRuns(detailRuns, 150);

    expect(result[0]).toEqual([
      { visualKey: "moderate-climb", completed: true, points: points(0, 50, 100) },
    ]);
  });

  it("produces only a remaining run when the marker is before the run's own x-range", () => {
    const detailRuns: FeatureDetailChartRun[][] = [
      [{ visualKey: "moderate-climb", points: points(0, 50, 100) }],
    ];

    const result = buildClimbFillRuns(detailRuns, -50);

    expect(result[0]).toEqual([
      { visualKey: "moderate-climb", completed: false, points: points(0, 50, 100) },
    ]);
  });

  it("produces a degenerate single-point run (no area) when the marker lands exactly on the run's last point", () => {
    const detailRuns: FeatureDetailChartRun[][] = [
      [{ visualKey: "moderate-climb", points: points(0, 50, 100) }],
    ];

    const result = buildClimbFillRuns(detailRuns, 100);

    expect(result[0]).toEqual([
      { visualKey: "moderate-climb", completed: true, points: points(0, 50, 100) },
      { visualKey: "moderate-climb", completed: false, points: points(100) },
    ]);
    // A single-point run has no width and must render no fill path.
    expect(areaPathFromRun(result[0]?.at(-1)?.points ?? [], 200)).toBe("");
  });

  it("treats every run as not-yet-completed and leaves points unsplit when markerX is null (no progress to split against)", () => {
    const detailRuns: FeatureDetailChartRun[][] = [
      [
        { visualKey: "moderate-climb", points: points(0, 30) },
        { visualKey: "hard-climb", points: points(30, 100) },
      ],
    ];

    const result = buildClimbFillRuns(detailRuns, null);

    expect(result[0]).toEqual([
      { visualKey: "moderate-climb", completed: false, points: points(0, 30) },
      { visualKey: "hard-climb", completed: false, points: points(30, 100) },
    ]);
  });

  it("preserves the outer per-geometry-segment shape and a null visualKey", () => {
    const detailRuns: FeatureDetailChartRun[][] = [
      [{ visualKey: null, points: points(0, 20) }],
      [{ visualKey: "hard-climb", points: points(50, 80) }],
    ];

    const result = buildClimbFillRuns(detailRuns, 10);

    expect(result).toHaveLength(2);
    expect(result[0]?.every((run) => run.visualKey === null)).toBe(true);
    expect(result[1]?.every((run) => run.visualKey === "hard-climb")).toBe(true);
  });
});

describe("areaPathFromRun", () => {
  it("returns an empty string for fewer than two points", () => {
    expect(areaPathFromRun([], 100)).toBe("");
    expect(areaPathFromRun(points(10), 100)).toBe("");
  });

  it("closes the profile down to the baseline on both ends", () => {
    const path = areaPathFromRun(points(0, 20, 50), 96);

    expect(path.startsWith("M 0.00 100.00")).toBe(true);
    expect(path).toContain("L 20.00 80.00");
    expect(path).toContain("L 50.00 50.00");
    // Drops down to the baseline at the last point's own x...
    expect(path).toContain("L 50.00 96.00");
    // ...then back along the baseline to the first point's own x, closed.
    expect(path.endsWith("L 0.00 96.00 Z")).toBe(true);
  });
});
