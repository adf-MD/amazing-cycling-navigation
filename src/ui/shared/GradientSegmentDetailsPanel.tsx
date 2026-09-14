import type { ClassifiedSegment } from "../../navigation/gradient.ts";
import {
  MICRO_DETAIL_LABEL_KEYS,
  type MicroDetailVisualKey,
} from "../../navigation/routeFeaturePalette.ts";
import { useTranslate } from "../../i18n/useTranslate.ts";
import { ClearSelectionButton } from "./ClearSelectionButton.tsx";
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
  const translator = useTranslate();
  const { t } = translator;
  if (segment === null) {
    return null;
  }

  return (
    <section
      aria-label={t("segmentDetails.landmarkLabel")}
      className="gradient-segment-details"
    >
      <h3>
        {segment.averageGradientPercent !== null
          ? t("segmentDetails.heading", {
              band: t(MICRO_DETAIL_LABEL_KEYS[segment.visualKey]),
              gradient: formatGradientPercent(translator, segment.averageGradientPercent),
            })
          : t(MICRO_DETAIL_LABEL_KEYS[segment.visualKey])}
      </h3>
      <p>
        {t("featureDetails.routePosition", {
          start: formatDistanceKmValue(translator, segment.startDistanceMetres),
          end: formatDistanceKmValue(translator, segment.endDistanceMetres),
        })}
      </p>
      {startElevationMetres !== null && endElevationMetres !== null ? (
        <p>
          {t("segmentDetails.elevation", {
            start: Math.round(startElevationMetres),
            end: Math.round(endElevationMetres),
          })}
        </p>
      ) : null}
      {onClear && <ClearSelectionButton onClick={onClear} />}
    </section>
  );
}
