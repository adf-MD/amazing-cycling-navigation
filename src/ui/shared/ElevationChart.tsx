import type { RoutePoint } from "../../domain/types.ts";
import { hasAnyElevation } from "../../navigation/elevation.ts";
import {
  buildElevationChartGeometry,
  pathFromSegment,
} from "./elevationChartGeometry.ts";

export interface ElevationChartProps {
  points: readonly RoutePoint[];
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 96;

/**
 * Always plots the route's raw imported elevations — never a smoothed
 * series — so what's shown matches what the file actually contains. A gap
 * where elevation is missing breaks the line rather than interpolating
 * across it.
 */
export function ElevationChart({
  points,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: ElevationChartProps) {
  if (points.length === 0) {
    return <p>No route loaded.</p>;
  }

  if (!hasAnyElevation(points)) {
    return <p role="status">Elevation data is not available for this route.</p>;
  }

  const geometry = buildElevationChartGeometry(points, width, height);
  if (!geometry) {
    return <p role="status">Elevation data is not available for this route.</p>;
  }

  const hasGaps = points.some((point) => point.elevationMetres === null);

  return (
    <figure aria-label="Elevation profile">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Elevation profile chart"
      >
        {geometry.segments.map((segment, index) => (
          <path
            key={index}
            d={pathFromSegment(segment)}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          />
        ))}
      </svg>
      <figcaption>
        {Math.round(geometry.minElevationMetres)}–
        {Math.round(geometry.maxElevationMetres)} m
        {hasGaps ? " (some sections have no elevation data)" : ""}
      </figcaption>
    </figure>
  );
}
