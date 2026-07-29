import type { RoutePoint } from "../../domain/types.ts";
import { hasAnyElevation } from "../../navigation/elevation.ts";
import type { GradientSegment } from "../../navigation/gradient.ts";
import { GRADIENT_CLASS_COLOURS } from "../../navigation/gradientPalette.ts";
import type { RouteFeature } from "../../navigation/routeFeatures.ts";
import { ROUTE_FEATURE_COLOURS } from "../../navigation/routeFeaturePalette.ts";
import { formatDistanceKm } from "./routeSummary.ts";
import {
  buildElevationChartGeometry,
  buildElevationChartMarkerGeometry,
  pathFromSegment,
  splitSegmentAtX,
  xPixelToDistanceMetres,
  type ElevationChartDomain,
  type ElevationChartPoint,
} from "./elevationChartGeometry.ts";
import {
  buildGradientChartRuns,
  buildRouteFeatureChartRuns,
} from "./elevationChartGradient.ts";

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

/** A route-distance range to visually emphasise beyond its own base
 * colouring — whichever macro feature or micro local-gradient segment is
 * currently "selected" (as opposed to merely shown in detail because it's
 * selected/active), rendered with an additional stroke-width bump. Purely
 * a rendering instruction: this component does no feature/segment lookup
 * of its own, the caller resolves which range this is (see
 * routeFeatures.ts's resolveElevationChartTap). */
export interface ElevationChartSelectedRange {
  startDistanceMetres: number;
  endDistanceMetres: number;
}

export interface ElevationChartProps {
  points: readonly RoutePoint[];
  /** Horizontal axis bounds, in route-global metres. Defaults to the
   * plotted points' own first/last distance, matching this component's
   * original whole-route-only behaviour, so existing callers that don't
   * pass a windowed/rolling domain are unaffected. */
  domain?: ElevationChartDomain;
  marker?: ElevationChartMarkerInput | null;
  /** Macro climb/descent feature colouring — the default presentation
   * when supplied: ordinary (non-feature) sections stay `currentColor`,
   * a recognised climb/descent is coloured by its category/severity (see
   * routeFeaturePalette.ts). Omitting this prop reproduces today's exact
   * currentColor rendering, matching gradientSegments' own existing
   * opt-in convention. Drawn beneath `gradientSegments`, which — when
   * also supplied — is expected to already be narrowed by the caller to
   * only the currently selected-or-active feature's own range (see
   * RidingScreen.tsx/PlanningScreen.tsx), so it renders as a thicker
   * "detail" overlay inside that one feature rather than across the
   * whole route. */
  routeFeatures?: readonly RouteFeature[];
  /** Detailed local-gradient colouring — see routeFeatures' own doc
   * comment above for how the two compose. This component only colours
   * and splits the existing raw geometry by these boundaries, it never
   * re-runs gradient analysis itself. */
  gradientSegments?: readonly GradientSegment[];
  /** Visually emphasises whichever specific range (a selected macro
   * feature, or a further-selected micro segment within it) the caller
   * currently considers "selected", independent of `marker`. */
  selectedRangeMetres?: ElevationChartSelectedRange | null;
  /** Fired with the route-global distance (metres) corresponding to a tap
   * anywhere on the chart's plot area — converted from the tap's pixel
   * position via the same domain/width this component itself uses, so
   * the caller can resolve it against whichever GradientSegment/
   * RouteFeature boundaries the route analysis already produced (see
   * routeFeatures.ts's resolveElevationChartTap). This component does no
   * resolution of its own and holds no selection state — every tap
   * resolves to a distance, even one that lands on an ordinary section;
   * it is the caller's job to decide that means no selection change. */
  onTapDistance?: (distanceMetres: number) => void;
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 96;
const STALE_MARKER_DASHARRAY = "4 3";
const COMPLETED_DASHARRAY = "5 4";
/** Base stroke width for the plain/macro-coloured line — unchanged from
 * this component's original single width, so ordinary and macro-feature
 * sections read as the same visual weight (colour is what distinguishes
 * them, not thickness). */
const BASE_STROKE_WIDTH = 2;
/** The detailed local-gradient overlay renders thicker than the base
 * layer it sits on top of — a non-colour-only cue that "you are looking
 * at zoomed-in detail here", independent of and in addition to its own
 * colour. */
const DETAIL_STROKE_WIDTH = 3;
/** Added on top of whichever base width already applies (BASE or DETAIL)
 * when a run matches `selectedRangeMetres` — a further non-colour-only
 * "this one is selected" cue, satisfying the requirement that a selected
 * range never rely on colour alone even against its own unselected
 * siblings at the same level. */
const SELECTED_STROKE_WIDTH_BONUS = 1;

/**
 * Plots whatever elevation series the caller provides — normally the
 * shared, noise-resistant smoothed analysis (see
 * `analyzeRouteElevationProfile` in `src/navigation/gradient.ts`), not the
 * raw imported samples, so the line reads as a genuine profile rather than
 * GPS/barometric jitter. A gap where elevation is missing breaks the line
 * rather than interpolating across it. Raw route elevations are never
 * altered by this component or its callers — only the array passed via
 * `points` is (optionally) a smoothed derivative, kept entirely separate
 * from the stored/exported route data.
 */
export function ElevationChart({
  points,
  domain,
  marker = null,
  routeFeatures,
  gradientSegments,
  selectedRangeMetres = null,
  onTapDistance,
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

  // Same outer length/order as geometry.segments — index-aligned below.
  const featureRuns = routeFeatures
    ? buildRouteFeatureChartRuns(geometry.segments, routeFeatures, resolvedDomain, width)
    : undefined;
  const detailRuns = gradientSegments
    ? buildGradientChartRuns(geometry.segments, gradientSegments, resolvedDomain, width)
    : undefined;

  const markerGeometry = marker
    ? buildElevationChartMarkerGeometry(
        resolvedDomain,
        marker.distanceFromStartMetres,
        marker.elevationMetres,
        geometry.displayMinElevationMetres,
        geometry.displayMaxElevationMetres,
        width,
        height,
      )
    : null;

  function isSelected(runPoints: readonly ElevationChartPoint[]): boolean {
    if (!selectedRangeMetres || runPoints.length === 0) return false;
    const firstX = runPoints[0]?.x ?? 0;
    const lastX = runPoints.at(-1)?.x ?? 0;
    const midDistance = xPixelToDistanceMetres(
      (firstX + lastX) / 2,
      resolvedDomain,
      width,
    );
    return (
      midDistance >= selectedRangeMetres.startDistanceMetres &&
      midDistance <= selectedRangeMetres.endDistanceMetres
    );
  }

  function renderColouredRun(
    runPoints: ElevationChartPoint[],
    stroke: string,
    baseStrokeWidth: number,
    key: string,
  ) {
    const strokeWidth =
      baseStrokeWidth + (isSelected(runPoints) ? SELECTED_STROKE_WIDTH_BONUS : 0);
    if (!markerGeometry) {
      return (
        <path
          key={key}
          d={pathFromSegment(runPoints)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    }
    // Ridden (completed) is dashed and de-emphasised, remaining stays
    // solid/prominent — a non-colour distinction that survives light/dark
    // and any colour-vision difference.
    const { completed, remaining } = splitSegmentAtX(runPoints, markerGeometry.x);
    return (
      <g key={key}>
        {completed.length > 0 && (
          <path
            d={pathFromSegment(completed)}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={COMPLETED_DASHARRAY}
            className="elevation-chart-completed"
          />
        )}
        {remaining.length > 0 && (
          <path
            d={pathFromSegment(remaining)}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            className="elevation-chart-remaining"
          />
        )}
      </g>
    );
  }

  function handleChartClick(event: React.MouseEvent<SVGRectElement>): void {
    if (!onTapDistance) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const localX = ((event.clientX - rect.left) / rect.width) * width;
    onTapDistance(xPixelToDistanceMetres(localX, resolvedDomain, width));
  }

  return (
    <figure aria-label="Elevation profile">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Elevation profile chart"
      >
        {onTapDistance && (
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onClick={handleChartClick}
            className="elevation-chart-tap-target"
          />
        )}
        {geometry.segments.map((segment, index) => {
          const features = featureRuns?.[index];
          const details = detailRuns?.[index];

          // The BASE layer is macro colouring when routeFeatures is
          // supplied; otherwise, for backward compatibility with a
          // gradientSegments-only caller, the detailed local-gradient
          // colouring itself becomes the base (no macro data to overlay
          // it onto — avoids drawing a pointless invisible plain path
          // underneath); otherwise the original plain currentColor line.
          const baseRuns: {
            points: ElevationChartPoint[];
            stroke: string;
            strokeWidth: number;
          }[] = features
            ? features.map((run) => ({
                points: run.points,
                stroke: run.visualKey
                  ? ROUTE_FEATURE_COLOURS[run.visualKey]
                  : "currentColor",
                strokeWidth: BASE_STROKE_WIDTH,
              }))
            : details
              ? details.map((run) => ({
                  points: run.points,
                  stroke: GRADIENT_CLASS_COLOURS[run.gradientClass],
                  strokeWidth: DETAIL_STROKE_WIDTH,
                }))
              : [
                  {
                    points: [...segment],
                    stroke: "currentColor",
                    strokeWidth: BASE_STROKE_WIDTH,
                  },
                ];

          // The OVERLAY layer only exists when BOTH macro and detail data
          // are supplied — detail then draws on top of (not instead of)
          // the macro base, covering only its own narrower range.
          const overlayRuns =
            features && details
              ? details.map((run) => ({
                  points: run.points,
                  stroke: GRADIENT_CLASS_COLOURS[run.gradientClass],
                  strokeWidth: DETAIL_STROKE_WIDTH,
                }))
              : [];

          return (
            <g key={index} pointerEvents="none">
              {baseRuns.map((run, runIndex) =>
                renderColouredRun(
                  run.points,
                  run.stroke,
                  run.strokeWidth,
                  `base-${String(runIndex)}`,
                ),
              )}
              {overlayRuns.map((run, runIndex) =>
                renderColouredRun(
                  run.points,
                  run.stroke,
                  run.strokeWidth,
                  `overlay-${String(runIndex)}`,
                ),
              )}
            </g>
          );
        })}
        {markerGeometry && (
          <g pointerEvents="none">
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
          </g>
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
