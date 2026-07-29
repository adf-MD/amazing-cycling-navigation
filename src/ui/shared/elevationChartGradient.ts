import type { GradientClass, GradientSegment } from "../../navigation/gradient.ts";
import type { RouteFeature } from "../../navigation/routeFeatures.ts";
import type { RouteFeatureVisualKey } from "../../navigation/routeFeaturePalette.ts";
import {
  distanceToX,
  splitSegmentAtXs,
  type ElevationChartDomain,
  type ElevationChartPoint,
} from "./elevationChartGeometry.ts";

/** One distance range to colour on the chart, tagged with an opaque
 * lookup key the caller resolves to an actual colour — shared shape for
 * both local-gradient segments (key = GradientClass) and macro route
 * features (key = ClimbCategory | DescentSeverity). */
export interface ChartColourRange {
  startDistanceMetres: number;
  endDistanceMetres: number;
  key: string;
}

export interface ChartColourRun {
  /** null when no supplied range overlaps this run — the caller decides
   * what that means for its own use case (gradient.ts: an "unknown"
   * grey; route features: no macro colouring, fall back to plain
   * currentColor — see buildGradientChartRuns/buildRouteFeatureChartRuns's
   * own wrapping). */
  key: string | null;
  points: ElevationChartPoint[];
}

/**
 * Splits each raw chart geometry segment (one per contiguous known-
 * elevation run — see buildElevationChartGeometry) at the pixel positions
 * of every overlapping range boundary, producing one coloured sub-run per
 * range along that segment. Returns the same outer length and order as
 * `segments`, so callers can still zip the result back against the
 * segment they came from. `ranges` should already be the domain-relevant
 * analysis (the full route for a Full-mode chart, or a clipped subset for
 * a windowed one) — this function only places boundaries, it never
 * re-analyses or re-classifies anything. Generic over the range's own
 * `key` type so both local-gradient classification and macro route
 * features can reuse this one splitting implementation rather than each
 * maintaining their own — see buildGradientChartRuns/buildRouteFeatureChartRuns.
 */
export function buildChartColourRuns(
  segments: readonly ElevationChartPoint[][],
  ranges: readonly ChartColourRange[],
  domain: ElevationChartDomain,
  width: number,
): ChartColourRun[][] {
  return segments.map((segment) => buildRunsForSegment(segment, ranges, domain, width));
}

function buildRunsForSegment(
  segment: readonly ElevationChartPoint[],
  ranges: readonly ChartColourRange[],
  domain: ElevationChartDomain,
  width: number,
): ChartColourRun[] {
  if (segment.length === 0) return [];

  const segmentStartX = segment[0]?.x ?? 0;
  const segmentEndX = segment.at(-1)?.x ?? 0;
  const minX = Math.min(segmentStartX, segmentEndX);
  const maxX = Math.max(segmentStartX, segmentEndX);

  const overlapping = ranges
    .map((range) => ({
      key: range.key,
      startX: distanceToX(range.startDistanceMetres, domain, width),
      endX: distanceToX(range.endDistanceMetres, domain, width),
    }))
    .filter((entry) => entry.endX > minX && entry.startX < maxX)
    .sort((a, b) => a.startX - b.startX);

  if (overlapping.length === 0) {
    return [{ key: null, points: [...segment] }];
  }

  // Deduplicated: two adjacent ranges share exactly one boundary x (one's
  // end equals the next's start), which would otherwise produce a
  // spurious zero-length extra split at that shared position.
  const boundaries = [
    ...new Set(
      overlapping
        .flatMap((entry) => [entry.startX, entry.endX])
        .filter((x) => x > minX && x < maxX),
    ),
  ];

  return splitSegmentAtXs(segment, boundaries).map((points) => {
    if (points.length === 0) return { key: null, points };
    const runStartX = points[0]?.x ?? 0;
    const runEndX = points.at(-1)?.x ?? 0;
    const runMidX = (runStartX + runEndX) / 2;
    const matching = overlapping.find(
      (entry) => runMidX >= entry.startX && runMidX <= entry.endX,
    );
    return { key: matching?.key ?? null, points };
  });
}

export interface GradientChartRun {
  gradientClass: GradientClass;
  points: ElevationChartPoint[];
}

/**
 * Local-gradient-specific view of buildChartColourRuns: a range with no
 * overlap becomes `"unknown"`, matching this module's original (pre-
 * generalisation) behaviour exactly — existing callers/tests are
 * unaffected by the shared implementation underneath.
 */
export function buildGradientChartRuns(
  segments: readonly ElevationChartPoint[][],
  gradientSegments: readonly GradientSegment[],
  domain: ElevationChartDomain,
  width: number,
): GradientChartRun[][] {
  const ranges: ChartColourRange[] = gradientSegments.map((segment) => ({
    startDistanceMetres: segment.startDistanceMetres,
    endDistanceMetres: segment.endDistanceMetres,
    key: segment.classification,
  }));
  return buildChartColourRuns(segments, ranges, domain, width).map((runs) =>
    runs.map((run) => ({
      gradientClass: (run.key ?? "unknown") as GradientClass,
      points: run.points,
    })),
  );
}

export interface RouteFeatureChartRun {
  /** null where no recognised climb/descent covers this run — the caller
   * (ElevationChart) renders plain currentColor there, matching the map's
   * own "ordinary route stays the base colour" macro presentation. */
  visualKey: RouteFeatureVisualKey | null;
  points: ElevationChartPoint[];
}

/**
 * Macro-route-feature-specific view of buildChartColourRuns: an ordinary
 * (non-feature) run is left `visualKey: null` rather than substituting a
 * placeholder class — unlike local-gradient classification, "no
 * recognised climb/descent here" is a legitimate, common, non-exceptional
 * outcome, not a data gap.
 */
export function buildRouteFeatureChartRuns(
  segments: readonly ElevationChartPoint[][],
  features: readonly RouteFeature[],
  domain: ElevationChartDomain,
  width: number,
): RouteFeatureChartRun[][] {
  const ranges: ChartColourRange[] = features.map((feature) => ({
    startDistanceMetres: feature.startDistanceMetres,
    endDistanceMetres: feature.endDistanceMetres,
    key: feature.kind === "climb" ? feature.category : feature.severity,
  }));
  return buildChartColourRuns(segments, ranges, domain, width).map((runs) =>
    runs.map((run) => ({
      visualKey: run.key as RouteFeatureVisualKey | null,
      points: run.points,
    })),
  );
}
