import type { FeatureRelativePosition } from "../../navigation/routeFeatureDetail.ts";
import type { RouteFeature } from "../../navigation/routeFeatures.ts";
import {
  ROUTE_FEATURE_COLOURS,
  ROUTE_FEATURE_LABELS,
} from "../../navigation/routeFeaturePalette.ts";
import { ClearSelectionButton } from "../shared/ClearSelectionButton.tsx";
import { GradientColourSwatch } from "../shared/GradientColourSwatch.tsx";
import {
  formatAscent,
  formatDescentLoss,
  formatDistanceKm,
  formatDistanceKmValue,
  formatGradientPercent,
} from "../shared/routeSummary.ts";

export interface RidingSelectedFeatureSummaryPanelProps {
  /** The explicitly selected feature to summarise, or null to render
   * nothing — a controlled/dumb component, same convention as
   * RouteFeatureDetailsPanel/ElevationChart. Deliberately fed only an
   * explicit selection (never a merely-active one) by RidingScreen. */
  feature: RouteFeature | null;
  /** Pre-computed by the caller via computeFeatureRelativePosition, using
   * the existing frozen/reliable presentation distance — this component
   * does no distance derivation of its own. Null while no presentation
   * distance exists yet (e.g. selection made before the first GPS fix);
   * the relative-position line is simply omitted in that case. */
  relativePosition: FeatureRelativePosition | null;
  onClear?: () => void;
}

/**
 * Compact active-standard-view (Full/2 km/10 km) "Riding summary" for an
 * explicitly selected recognised climb or descent (backlog item 85) —
 * deliberately not RouteFeatureDetailsPanel: that component's full
 * analytical fact set (detail chart, local-gradient disclosure, max/
 * steepest gradient, climb score) is pre-ride/active-Climb-only detail
 * item 85 explicitly excludes from the fixed, glanceable active-Riding
 * pane. Only heading, one relative-position line, length, elevation
 * gain/loss and average gradient survive here, plus a quieter absolute
 * route-position line and the shared Clear-selection action.
 *
 * The heading carries aria-live (identity changes only when the rider
 * makes a new explicit selection); the primary/secondary lines are plain
 * text, never re-announced on every GPS tick — mirrors
 * RidingClimbProgressPanel/RidingClimbCue's own established convention.
 */
export function RidingSelectedFeatureSummaryPanel({
  feature,
  relativePosition,
  onClear,
}: RidingSelectedFeatureSummaryPanelProps) {
  if (feature === null) {
    return null;
  }

  const visualKey = feature.kind === "climb" ? feature.category : feature.band;
  const heading =
    feature.kind === "climb"
      ? ROUTE_FEATURE_LABELS[feature.category]
      : "Recognised descent";

  const relativePositionText =
    relativePosition === null
      ? null
      : relativePosition.kind === "ahead"
        ? `Starts in ${formatDistanceKm(relativePosition.distanceUntilStartMetres)}`
        : relativePosition.kind === "within"
          ? `${formatDistanceKm(relativePosition.distanceRemainingMetres)} remaining`
          : `Passed ${formatDistanceKm(relativePosition.distanceSincePassedMetres)} ago`;

  const elevationText =
    feature.kind === "climb"
      ? formatAscent(feature.elevationGainMetres)
      : formatDescentLoss(feature.elevationLossMetres);

  const primaryLineParts = [
    relativePositionText,
    formatDistanceKm(feature.lengthMetres),
    elevationText,
    `${formatGradientPercent(feature.averageGradientPercent)} average`,
  ].filter((part): part is string => part !== null);

  return (
    <section
      aria-label="Selected feature summary"
      className="riding-selected-feature-summary"
    >
      <h3 aria-live="polite">
        <GradientColourSwatch colour={ROUTE_FEATURE_COLOURS[visualKey]} /> {heading}
      </h3>
      <p className="riding-selected-feature-summary-primary">
        {primaryLineParts.join(" · ")}
      </p>
      <p className="riding-selected-feature-summary-secondary">
        Route position: {formatDistanceKmValue(feature.startDistanceMetres)}–
        {formatDistanceKmValue(feature.endDistanceMetres)} km
      </p>
      {onClear && <ClearSelectionButton onClick={onClear} />}
    </section>
  );
}
