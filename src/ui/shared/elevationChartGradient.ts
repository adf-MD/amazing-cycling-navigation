import type { GradientClass, GradientSegment } from "../../navigation/gradient.ts";
import {
  distanceToX,
  splitSegmentAtXs,
  type ElevationChartDomain,
  type ElevationChartPoint,
} from "./elevationChartGeometry.ts";

export interface GradientChartRun {
  gradientClass: GradientClass;
  points: ElevationChartPoint[];
}

/**
 * Splits each raw chart geometry segment (one per contiguous known-
 * elevation run — see buildElevationChartGeometry) at the pixel positions
 * of every overlapping GradientSegment boundary, producing one coloured
 * sub-run per gradient class along that segment. Returns the same outer
 * length and order as `segments`, so callers can still zip the result back
 * against the segment they came from. `gradientSegments` should already be
 * the domain-relevant analysis (the full route for a Full-mode chart, or
 * clipGradientSegments' output for a windowed one) — this function only
 * places boundaries, it never re-analyses or re-classifies anything.
 */
export function buildGradientChartRuns(
  segments: readonly ElevationChartPoint[][],
  gradientSegments: readonly GradientSegment[],
  domain: ElevationChartDomain,
  width: number,
): GradientChartRun[][] {
  return segments.map((segment) =>
    buildRunsForSegment(segment, gradientSegments, domain, width),
  );
}

function buildRunsForSegment(
  segment: readonly ElevationChartPoint[],
  gradientSegments: readonly GradientSegment[],
  domain: ElevationChartDomain,
  width: number,
): GradientChartRun[] {
  if (segment.length === 0) return [];

  const segmentStartX = segment[0]?.x ?? 0;
  const segmentEndX = segment.at(-1)?.x ?? 0;
  const minX = Math.min(segmentStartX, segmentEndX);
  const maxX = Math.max(segmentStartX, segmentEndX);

  const overlapping = gradientSegments
    .map((gradientSegment) => ({
      gradientClass: gradientSegment.classification,
      startX: distanceToX(gradientSegment.startDistanceMetres, domain, width),
      endX: distanceToX(gradientSegment.endDistanceMetres, domain, width),
    }))
    .filter((entry) => entry.endX > minX && entry.startX < maxX)
    .sort((a, b) => a.startX - b.startX);

  if (overlapping.length === 0) {
    return [{ gradientClass: "unknown", points: [...segment] }];
  }

  // Deduplicated: two adjacent gradient segments share exactly one boundary
  // x (one's end equals the next's start), which would otherwise produce a
  // spurious zero-length extra split at that shared position.
  const boundaries = [
    ...new Set(
      overlapping
        .flatMap((entry) => [entry.startX, entry.endX])
        .filter((x) => x > minX && x < maxX),
    ),
  ];

  return splitSegmentAtXs(segment, boundaries).map((points) => {
    if (points.length === 0) return { gradientClass: "unknown", points };
    const runStartX = points[0]?.x ?? 0;
    const runEndX = points.at(-1)?.x ?? 0;
    const runMidX = (runStartX + runEndX) / 2;
    const matching = overlapping.find(
      (entry) => runMidX >= entry.startX && runMidX <= entry.endX,
    );
    return { gradientClass: matching?.gradientClass ?? "unknown", points };
  });
}
