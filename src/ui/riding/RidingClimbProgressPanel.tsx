import { useTranslate } from "../../i18n/useTranslate.ts";
import type { ClimbProgressMetrics } from "../../navigation/climbElevationView.ts";
import type { ClimbFeature } from "../../navigation/routeFeatures.ts";
import { CLIMB_CATEGORY_NAME_KEYS } from "../../navigation/routeFeaturePalette.ts";
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
 *
 * Card hierarchy (backlog item 71): distance to summit and positive
 * elevation remaining are the two values a rider needs at a glance, so
 * they render as a strongly-weighted primary pair (plain `<span>`s, not
 * `<p>`, so the shared quieter `.riding-climb-progress p` styling below
 * never applies to them). Current gradient, current elevation, summit
 * elevation and distance completed remain fully present but move into a
 * quieter secondary row — every one of them omitted (not replaced by a
 * placeholder) exactly as before when its own value is unavailable,
 * preserving the existing null-vs-zero distinction unchanged. Distance to
 * summit (`distanceRemainingMetres`) is never null (it is already floored
 * at 0 at the climb finish by `computeClimbProgressMetrics`), so its tile
 * always renders; elevation remaining's tile is simply omitted when null,
 * the same convention every other optional field here already uses.
 */
export function RidingClimbProgressPanel({
  climb,
  climbNumber,
  metrics,
}: RidingClimbProgressPanelProps) {
  const translator = useTranslate();
  const { t } = translator;
  return (
    <section aria-label={t("climb.progressLabel")} className="riding-climb-progress">
      <h3 aria-live="polite">
        {t("climb.heading", {
          number: climbNumber,
          category: t(CLIMB_CATEGORY_NAME_KEYS[climb.category]),
        })}
      </h3>
      <div className="riding-climb-progress-primary">
        <span className="riding-climb-progress-metric">
          <span className="riding-climb-progress-metric-label">
            {t("climb.distanceToSummit")}
          </span>
          <span className="riding-climb-progress-metric-value">
            {formatDistanceKm(translator, metrics.distanceRemainingMetres)}
          </span>
        </span>
        {metrics.elevationRemainingMetres !== null ? (
          <span className="riding-climb-progress-metric">
            <span className="riding-climb-progress-metric-label">
              {t("climb.elevationRemaining")}
            </span>
            <span className="riding-climb-progress-metric-value">
              {formatMetres(translator, metrics.elevationRemainingMetres)}
            </span>
          </span>
        ) : null}
      </div>
      <div className="riding-climb-progress-secondary">
        {metrics.currentGradientPercent !== null ? (
          <p>
            {t("climb.currentGradient", {
              gradient: formatGradientPercent(translator, metrics.currentGradientPercent),
            })}
          </p>
        ) : null}
        {metrics.currentElevationMetres !== null ? (
          <p>
            {t("climb.currentElevation", {
              elevation: formatMetres(translator, metrics.currentElevationMetres),
            })}
          </p>
        ) : null}
        {metrics.finishElevationMetres !== null ? (
          <p>
            {t("climb.summitElevation", {
              elevation: formatMetres(translator, metrics.finishElevationMetres),
            })}
          </p>
        ) : null}
        <p>
          {t("climb.distanceCompleted", {
            distance: formatDistanceKm(translator, metrics.distanceCompletedMetres),
          })}
        </p>
      </div>
    </section>
  );
}
