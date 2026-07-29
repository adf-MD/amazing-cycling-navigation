import type { RoutePoint } from "../../domain/types.ts";
import { hasAnyElevation } from "../../navigation/elevation.ts";
import type { GradientSegment } from "../../navigation/gradient.ts";
import { GRADIENT_CLASS_COLOURS } from "../../navigation/gradientPalette.ts";
import { formatDistanceKm } from "./routeSummary.ts";
import {
  buildElevationChartGeometry,
  buildElevationChartMarkerGeometry,
  pathFromSegment,
  splitSegmentAtX,
  type ElevationChartDomain,
} from "./elevationChartGeometry.ts";
import { buildGradientChartRuns } from "./elevationChartGradient.ts";

/** The rider's current (or last known) position to plot as a vertical
 * marker, already resolved to an exact route distance and elevation by the
 * caller (see `interpolateRoutePointAt`/`buildFullProfileMarker` in
 * `src/navigation/upcomingElevation.ts`) — this component does no
 * interpolation of its own. */
export interface ElevationChartMarkerInput {
  distanceFromStartMetres: number;
  elevationMetres: number | null;
  stale: boolean;
}

export interface ElevationChartProps {
  points: readonly RoutePoint[];
  /** Horizontal axis bounds, in route-global metres. Defaults to the
   * plotted points' own first/last distance, matching this component's
   * original whole-route-only behaviour, so existing callers that don't
   * pass a windowed/rolling domain are unaffected. */
  domain?: ElevationChartDomain;
  marker?: ElevationChartMarkerInput | null;
  /** Already domain-relevant (the full route for a Full-mode/whole-route
   * chart, or clipGradientSegments' output for a windowed one) — this
   * component only colours and splits the existing raw geometry by these
   * boundaries, it never re-runs gradient analysis itself. Omitting this
   * prop reproduces today's exact currentColor rendering. */
  gradientSegments?: readonly GradientSegment[];
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 96;
const STALE_MARKER_DASHARRAY = "4 3";
const COMPLETED_DASHARRAY = "5 4";

/**
 * Always plots the route's raw imported elevations — never a smoothed
 * series — so what's shown matches what the file actually contains. A gap
 * where elevation is missing breaks the line rather than interpolating
 * across it.
 */
export function ElevationChart({
  points,
  domain,
  marker = null,
  gradientSegments,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: ElevationChartProps) {
  if (points.length === 0) {
    return <p>No route loaded.</p>;
  }

  if (!hasAnyElevation(points)) {
    return <p role="status">Elevation data is not available for this route.</p>;
  }

  const resolvedDomain: ElevationChartDomain = domain ?? {
    startDistanceMetres: points[0]?.distanceFromStartMetres ?? 0,
    endDistanceMetres: points.at(-1)?.distanceFromStartMetres ?? 0,
  };

  const geometry = buildElevationChartGeometry(points, resolvedDomain, width, height);
  if (!geometry) {
    return <p role="status">Elevation data is not available for this route.</p>;
  }

  const hasGaps = points.some((point) => point.elevationMetres === null);

  // Same outer length/order as geometry.segments — index-aligned below, so
  // omitting gradientSegments (gradientRuns stays undefined) falls straight
  // through to the original plain-path rendering, unchanged.
  const gradientRuns = gradientSegments
    ? buildGradientChartRuns(geometry.segments, gradientSegments, resolvedDomain, width)
    : undefined;

  const markerGeometry = marker
    ? buildElevationChartMarkerGeometry(
        resolvedDomain,
        marker.distanceFromStartMetres,
        marker.elevationMetres,
        geometry.minElevationMetres,
        geometry.maxElevationMetres,
        width,
        height,
      )
    : null;

  return (
    <figure aria-label="Elevation profile">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Elevation profile chart"
      >
        {geometry.segments.map((segment, index) => {
          const runs = gradientRuns?.[index];
          if (runs) {
            // Gradient colouring: colour (climb/descent class) and
            // dash/opacity (ridden-status) are two independent visual
            // channels on the same path, mirroring the map's colour
            // (gradient)/pattern (warning) independence.
            return (
              <g key={index}>
                {runs.map((run, runIndex) => {
                  const stroke = GRADIENT_CLASS_COLOURS[run.gradientClass];
                  if (!markerGeometry) {
                    return (
                      <path
                        key={runIndex}
                        d={pathFromSegment(run.points)}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={2}
                      />
                    );
                  }
                  const { completed, remaining } = splitSegmentAtX(
                    run.points,
                    markerGeometry.x,
                  );
                  return (
                    <g key={runIndex}>
                      {completed.length > 0 && (
                        <path
                          d={pathFromSegment(completed)}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={2}
                          strokeDasharray={COMPLETED_DASHARRAY}
                          className="elevation-chart-completed"
                        />
                      )}
                      {remaining.length > 0 && (
                        <path
                          d={pathFromSegment(remaining)}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={2}
                          className="elevation-chart-remaining"
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          }

          if (!markerGeometry) {
            return (
              <path
                key={index}
                d={pathFromSegment(segment)}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              />
            );
          }

          // Full-mode split: the ridden (completed) portion is dashed and
          // de-emphasised, the remaining portion stays solid/prominent —
          // a non-colour distinction that survives light/dark and any
          // colour-vision difference.
          const { completed, remaining } = splitSegmentAtX(segment, markerGeometry.x);
          return (
            <g key={index}>
              {completed.length > 0 && (
                <path
                  d={pathFromSegment(completed)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray={COMPLETED_DASHARRAY}
                  className="elevation-chart-completed"
                />
              )}
              {remaining.length > 0 && (
                <path
                  d={pathFromSegment(remaining)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="elevation-chart-remaining"
                />
              )}
            </g>
          );
        })}
        {markerGeometry && (
          <>
            <line
              x1={markerGeometry.x}
              x2={markerGeometry.x}
              y1={0}
              y2={height}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray={marker?.stale ? STALE_MARKER_DASHARRAY : undefined}
              className="elevation-chart-marker"
            />
            {markerGeometry.y !== null && (
              <circle
                cx={markerGeometry.x}
                cy={markerGeometry.y}
                r={4}
                fill="currentColor"
                className="elevation-chart-marker-dot"
              />
            )}
          </>
        )}
      </svg>
      <figcaption>
        {Math.round(geometry.minElevationMetres)}–
        {Math.round(geometry.maxElevationMetres)} m
        {hasGaps ? " (some sections have no elevation data)" : ""}
      </figcaption>
      {marker && (
        <p>
          {marker.stale ? "Last known position: " : "Current route position: "}
          {formatDistanceKm(marker.distanceFromStartMetres)} of{" "}
          {formatDistanceKm(resolvedDomain.endDistanceMetres)}.
        </p>
      )}
    </figure>
  );
}
