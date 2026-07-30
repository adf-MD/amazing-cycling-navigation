import type { ClassifiedSegment } from "../../navigation/gradient.ts";
import {
  MICRO_DETAIL_LABELS,
  type MicroDetailVisualKey,
} from "../../navigation/routeFeaturePalette.ts";
import { formatDistanceKmValue, formatGradientPercent } from "./routeSummary.ts";

export interface GradientSegmentDetailsPanelProps {
  /** The selected local-gradient segment to show detail for, or null to
   * render nothing — a controlled/dumb component, same convention as
   * ElevationChart and RouteFeatureDetailsPanel. */
  segment: ClassifiedSegment<MicroDetailVisualKey> | null;
  /** Elevation at the segment's own start/end distance, already
   * interpolated by the caller from the shared smoothed displayPoints
   * series (see upcomingElevation.ts's interpolateRoutePointAt) — this
   * component does no interpolation of its own. Either may be null when
   * elevation is unknown there. */
  startElevationMetres: number | null;
  endElevationMetres: number | null;
  onClear?: () => void;
}

/**
 * Shared inline details panel for a selected detailed local-gradient
 * segment — a finer-grained selection than RouteFeatureDetailsPanel's own
 * (a segment lives *within* a selected/active climb or descent). Uses the
 * segment boundaries the route analysis already produced, never a new
 * boundary invented from a tap coordinate.
 */
export function GradientSegmentDetailsPanel({
  segment,
  startElevationMetres,
  endElevationMetres,
  onClear,
}: GradientSegmentDetailsPanelProps) {
  if (segment === null) {
    return null;
  }

  return (
    <section aria-label="Gradient segment details" className="gradient-segment-details">
      <h3>
        {MICRO_DETAIL_LABELS[segment.visualKey]}
        {segment.averageGradientPercent !== null
          ? ` · ${formatGradientPercent(segment.averageGradientPercent)}`
          : ""}
      </h3>
      <p>
        Route position: {formatDistanceKmValue(segment.startDistanceMetres)}–
        {formatDistanceKmValue(segment.endDistanceMetres)} km
      </p>
      {startElevationMetres !== null && endElevationMetres !== null ? (
        <p>
          Elevation: {Math.round(startElevationMetres)} m to{" "}
          {Math.round(endElevationMetres)} m
        </p>
      ) : null}
      {onClear && (
        <button type="button" onClick={onClear}>
          Clear selection
        </button>
      )}
    </section>
  );
}
