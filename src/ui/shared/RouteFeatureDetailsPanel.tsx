import type { RouteFeature } from "../../navigation/routeFeatures.ts";
import { ROUTE_FEATURE_LABELS } from "../../navigation/routeFeaturePalette.ts";
import {
  formatDistanceKm,
  formatDistanceKmValue,
  formatGradientPercent,
  formatMetres,
} from "./routeSummary.ts";

export interface RouteFeatureDetailsPanelProps {
  /** The selected-or-active feature to show detail for, or null to render
   * nothing — a controlled/dumb component, same convention as
   * ElevationChart: no internal selection state of its own. */
  feature: RouteFeature | null;
  /** Omit to render no clear control (e.g. Riding might prefer the
   * feature to simply update as the rider progresses, with no explicit
   * "clear" action while merely active-not-selected). */
  onClear?: () => void;
}

/**
 * Shared inline details panel for a selected or currently-active
 * recognised climb/descent, reused by both Riding and Planning rather
 * than each maintaining its own — the exact field set the spec requires:
 * category/"Recognised descent" heading, route position, length,
 * elevation gain/loss, average gradient, maximum/steepest local gradient,
 * climb score (climbs only), and a short explanation that these values
 * derive from available route elevation data.
 */
export function RouteFeatureDetailsPanel({
  feature,
  onClear,
}: RouteFeatureDetailsPanelProps) {
  if (feature === null) {
    return null;
  }

  const heading =
    feature.kind === "climb"
      ? ROUTE_FEATURE_LABELS[feature.category]
      : "Recognised descent";

  return (
    <section aria-label="Route feature details" className="route-feature-details">
      <h3>{heading}</h3>
      <p>
        Route position: {formatDistanceKmValue(feature.startDistanceMetres)}–
        {formatDistanceKmValue(feature.endDistanceMetres)} km
      </p>
      <p>Length: {formatDistanceKm(feature.lengthMetres)}</p>
      {feature.kind === "climb" ? (
        <p>Elevation gain: {formatMetres(feature.elevationGainMetres)}</p>
      ) : (
        <p>Elevation loss: {formatMetres(feature.elevationLossMetres)}</p>
      )}
      <p>Average gradient: {formatGradientPercent(feature.averageGradientPercent)}</p>
      <p>
        {feature.kind === "climb" ? "Maximum" : "Steepest"} local gradient:{" "}
        {formatGradientPercent(feature.maxGradientPercent)}
      </p>
      {feature.kind === "climb" && <p>Climb score: {Math.round(feature.climbScore)}</p>}
      <p>Values are derived from available route elevation data.</p>
      {onClear && (
        <button type="button" onClick={onClear}>
          Clear selection
        </button>
      )}
    </section>
  );
}
