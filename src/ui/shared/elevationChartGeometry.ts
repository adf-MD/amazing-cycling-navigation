import type { RoutePoint } from "../../domain/types.ts";

export interface ElevationChartPoint {
  x: number;
  y: number;
}

/** The horizontal axis's route-distance bounds, in route-global metres.
 * Explicit rather than inferred from the plotted points themselves, since a
 * windowed (non-zero-start) point array must still map its first point to
 * x = 0 and its nominal window end to the right edge, even when the actual
 * data stops short of that end near the finish. */
export interface ElevationChartDomain {
  startDistanceMetres: number;
  endDistanceMetres: number;
}

export interface ElevationChartGeometry {
  /** One array per contiguous run of known-elevation points; a gap in
   * elevation data breaks the line rather than being interpolated across. */
  segments: ElevationChartPoint[][];
  minElevationMetres: number;
  maxElevationMetres: number;
}

export interface ElevationChartMarkerGeometry {
  x: number;
  /** `null` when the marker's elevation is unknown (e.g. inside a gap), so
   * callers can still draw the vertical line without a dot. */
  y: number | null;
}

/** Exported so gradient-segment boundaries (a route-distance concept) can
 * be converted to the same pixel x-coordinates as the plotted profile —
 * see elevationChartGradient.ts. */
export function distanceToX(
  distanceFromStartMetres: number,
  domain: ElevationChartDomain,
  width: number,
): number {
  const domainSpan = domain.endDistanceMetres - domain.startDistanceMetres;
  return domainSpan === 0
    ? 0
    : ((distanceFromStartMetres - domain.startDistanceMetres) / domainSpan) * width;
}

export function elevationToY(
  elevationMetres: number,
  minElevationMetres: number,
  maxElevationMetres: number,
  height: number,
): number {
  const elevationRange = maxElevationMetres - minElevationMetres || 1;
  return height - ((elevationMetres - minElevationMetres) / elevationRange) * height;
}

export function buildElevationChartGeometry(
  points: readonly RoutePoint[],
  domain: ElevationChartDomain,
  width: number,
  height: number,
): ElevationChartGeometry | null {
  const knownElevations = points
    .map((point) => point.elevationMetres)
    .filter((elevation): elevation is number => elevation !== null);

  if (knownElevations.length === 0) {
    return null;
  }

  const minElevationMetres = Math.min(...knownElevations);
  const maxElevationMetres = Math.max(...knownElevations);

  const segments: ElevationChartPoint[][] = [];
  let currentSegment: ElevationChartPoint[] = [];

  for (const point of points) {
    if (point.elevationMetres === null) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
      continue;
    }

    const x = distanceToX(point.distanceFromStartMetres, domain, width);
    const y = elevationToY(
      point.elevationMetres,
      minElevationMetres,
      maxElevationMetres,
      height,
    );
    currentSegment.push({ x, y });
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return { segments, minElevationMetres, maxElevationMetres };
}

/**
 * The marker's pixel position, using the same domain/elevation-range as
 * `buildElevationChartGeometry` so it lines up with the plotted profile.
 */
export function buildElevationChartMarkerGeometry(
  domain: ElevationChartDomain,
  markerDistanceFromStartMetres: number,
  markerElevationMetres: number | null,
  minElevationMetres: number,
  maxElevationMetres: number,
  width: number,
  height: number,
): ElevationChartMarkerGeometry {
  const x = distanceToX(markerDistanceFromStartMetres, domain, width);
  const y =
    markerElevationMetres === null
      ? null
      : elevationToY(
          markerElevationMetres,
          minElevationMetres,
          maxElevationMetres,
          height,
        );
  return { x, y };
}

/**
 * Splits one geometry segment at the pixel x-coordinate `splitX` into a
 * "completed" (up to and including the split) and "remaining" (from the
 * split onward) run, inserting one interpolated seam point when the split
 * falls strictly inside the segment so both halves meet with no gap or
 * overlap. A split at or beyond either end of the segment yields an empty
 * "remaining" or "completed" run respectively, with no synthetic point.
 */
export function splitSegmentAtX(
  segment: readonly ElevationChartPoint[],
  splitX: number,
): { completed: ElevationChartPoint[]; remaining: ElevationChartPoint[] } {
  const completed: ElevationChartPoint[] = [];
  const remaining: ElevationChartPoint[] = [];

  for (let i = 0; i < segment.length; i += 1) {
    const point = segment[i];
    if (point === undefined) {
      continue;
    }

    if (point.x <= splitX) {
      completed.push(point);
    }
    if (point.x >= splitX) {
      remaining.push(point);
    }

    if (point.x < splitX) {
      const next = segment[i + 1];
      if (next !== undefined && next.x > splitX) {
        const t = (splitX - point.x) / (next.x - point.x);
        const seam: ElevationChartPoint = {
          x: splitX,
          y: point.y + t * (next.y - point.y),
        };
        completed.push(seam);
        remaining.push(seam);
      }
    }
  }

  return { completed, remaining };
}

/**
 * Splits one geometry segment at every pixel x-coordinate in `splitXs`,
 * returning `splitXs.length + 1` runs in left-to-right order. Implemented
 * as repeated application of the existing, unmodified `splitSegmentAtX`
 * (ascending split order, each call's "remaining" feeding the next split),
 * so every single-split seam-continuity guarantee it already provides
 * (an interpolated seam shared by both halves, no duplicate point when a
 * split lands exactly on an existing point) holds at every boundary here
 * too, rather than being reimplemented.
 */
export function splitSegmentAtXs(
  segment: readonly ElevationChartPoint[],
  splitXs: readonly number[],
): ElevationChartPoint[][] {
  const sortedSplitXs = [...splitXs].sort((a, b) => a - b);
  const runs: ElevationChartPoint[][] = [];
  let remainder: readonly ElevationChartPoint[] = segment;
  for (const splitX of sortedSplitXs) {
    const { completed, remaining } = splitSegmentAtX(remainder, splitX);
    runs.push(completed);
    remainder = remaining;
  }
  runs.push([...remainder]);
  return runs;
}

export function pathFromSegment(segment: readonly ElevationChartPoint[]): string {
  return segment
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");
}
