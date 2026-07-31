import type { MicroDetailVisualKey } from "../../navigation/routeFeaturePalette.ts";
import type { FeatureDetailChartRun } from "./elevationChartGradient.ts";
import { splitSegmentAtX, type ElevationChartPoint } from "./elevationChartGeometry.ts";

/** One piece of the Climb view's filled area — a contiguous, already
 * gradient-band-coloured stroke run (see `buildFeatureDetailChartRuns`)
 * further split at the rider's current progress. `completed` drives the
 * caller's visual-subordination treatment (e.g. lower fill opacity); it
 * carries no colour information of its own. */
export interface ClimbFillRun {
  visualKey: MicroDetailVisualKey | null;
  completed: boolean;
  points: ElevationChartPoint[];
}

/**
 * Further splits each already gradient-band-boundary-split detail run (see
 * `buildFeatureDetailChartRuns`) at the rider's current progress pixel
 * x-coordinate, tagging each resulting sub-run as ridden ("completed") or
 * still ahead — reusing the existing `splitSegmentAtX` (the same seam-
 * interpolating split the chart's own completed/remaining stroke treatment
 * already relies on) rather than a new splitting implementation. Preserves
 * the outer per-geometry-segment shape of `detailRuns`. A run entirely
 * before or after `markerX` yields only one non-empty half; `splitSegmentAtX`
 * itself already guarantees no empty run is ever produced on either side.
 */
export function buildClimbFillRuns(
  detailRuns: readonly FeatureDetailChartRun[][],
  markerX: number,
): ClimbFillRun[][] {
  return detailRuns.map((segmentRuns) =>
    segmentRuns.flatMap((run): ClimbFillRun[] => {
      const { completed, remaining } = splitSegmentAtX(run.points, markerX);
      const out: ClimbFillRun[] = [];
      if (completed.length > 0) {
        out.push({ visualKey: run.visualKey, completed: true, points: completed });
      }
      if (remaining.length > 0) {
        out.push({ visualKey: run.visualKey, completed: false, points: remaining });
      }
      return out;
    }),
  );
}

/**
 * A closed SVG path for the filled area under one run's profile points,
 * down to `baselineY` — a standard area-under-curve construction: trace
 * the profile left to right, drop straight down to the baseline at the
 * last point's x, run back along the baseline to the first point's x, and
 * close. Returns an empty string for fewer than two points (a degenerate
 * "area" with no width, e.g. a run reduced to a single point by a split
 * landing exactly on it) — callers must skip rendering a `<path>` for it.
 */
export function areaPathFromRun(
  points: readonly ElevationChartPoint[],
  baselineY: number,
): string {
  const first = points[0];
  const last = points.at(-1);
  if (points.length < 2 || first === undefined || last === undefined) {
    return "";
  }

  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");

  return `${line} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}
