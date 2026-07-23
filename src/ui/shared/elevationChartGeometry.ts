import type { RoutePoint } from "../../domain/types.ts";

export interface ElevationChartPoint {
  x: number;
  y: number;
}

export interface ElevationChartGeometry {
  /** One array per contiguous run of known-elevation points; a gap in
   * elevation data breaks the line rather than being interpolated across. */
  segments: ElevationChartPoint[][];
  minElevationMetres: number;
  maxElevationMetres: number;
  maxDistanceMetres: number;
}

export function buildElevationChartGeometry(
  points: readonly RoutePoint[],
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
  const maxDistanceMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
  const elevationRange = maxElevationMetres - minElevationMetres || 1;

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

    const x =
      maxDistanceMetres === 0
        ? 0
        : (point.distanceFromStartMetres / maxDistanceMetres) * width;
    const y =
      height - ((point.elevationMetres - minElevationMetres) / elevationRange) * height;
    currentSegment.push({ x, y });
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return { segments, minElevationMetres, maxElevationMetres, maxDistanceMetres };
}

export function pathFromSegment(segment: readonly ElevationChartPoint[]): string {
  return segment
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");
}
