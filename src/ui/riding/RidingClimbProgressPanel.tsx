import type { ClimbProgressMetrics } from "../../navigation/climbElevationView.ts";
import type { ClimbFeature } from "../../navigation/routeFeatures.ts";
import { CLIMB_CATEGORY_NAMES } from "../../navigation/routeFeaturePalette.ts";
import {
  formatDistanceKm,
  formatGradientPercent,
  formatMetres,
} from "../shared/routeSummary.ts";

export interface RidingClimbProgressPanelProps {
  climb: ClimbFeature;
  /** 1-based position among the route's recognised climbs (see
   * listClimbsInRouteOrder), matching the pre-ride climb selector's own
   * numbering convention. */
  climbNumber: number;
  metrics: ClimbProgressMetrics;
}

/**
 * Compact live-progress panel shown only while active Climb elevation view
 * is showing (see RidingScreen.tsx's activeClimb/effectiveElevationView).
 * Deliberately does not repeat RouteFeatureDetailsPanel's own static stat
 * block (length/gain/average gradient/climb score) — that panel already
 * renders for the same climb whenever nothing else is explicitly selected
 * elsewhere, so duplicating it here would recreate the "two competing
 * panels" problem RidingClimbSelector.tsx's own doc comment warns against.
 * This panel's heading text ("Climb N · Category") is deliberately
 * distinct from RouteFeatureDetailsPanel's own heading text, to avoid an
 * accessible-name collision when both are on screen. No percentage-
 * complete value anywhere, per product requirements. `role="status"` sits
 * only on the heading (via `aria-live`, not `role="status"` — an explicit
 * `role` would override the element's implicit heading role, which this
 * panel deliberately keeps for document structure/screen-reader
 * navigation), which changes only on entering a different recognised
 * climb — the continuously-updating numeric metrics below it are plain
 * text, not a live region, so they are never announced on every GPS tick.
 */
export function RidingClimbProgressPanel({
  climb,
  climbNumber,
  metrics,
}: RidingClimbProgressPanelProps) {
  return (
    <section aria-label="Climb progress" className="riding-climb-progress">
      <h3 aria-live="polite">
        {`Climb ${String(climbNumber)} · ${CLIMB_CATEGORY_NAMES[climb.category]}`}
      </h3>
      <p>
        {formatDistanceKm(metrics.distanceCompletedMetres)} completed ·{" "}
        {formatDistanceKm(metrics.distanceRemainingMetres)} remaining
      </p>
      {metrics.currentElevationMetres !== null ? (
        <p>Current elevation: {formatMetres(metrics.currentElevationMetres)}</p>
      ) : null}
      {metrics.finishElevationMetres !== null ? (
        <p>Summit elevation: {formatMetres(metrics.finishElevationMetres)}</p>
      ) : null}
      {metrics.elevationRemainingMetres !== null ? (
        <p>Elevation remaining: {formatMetres(metrics.elevationRemainingMetres)}</p>
      ) : null}
      {metrics.currentGradientPercent !== null ? (
        <p>Current gradient: {formatGradientPercent(metrics.currentGradientPercent)}</p>
      ) : null}
    </section>
  );
}
