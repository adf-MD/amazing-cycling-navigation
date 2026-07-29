import {
  ROUTE_FEATURE_COLOURS,
  ROUTE_FEATURE_LABELS,
  ROUTE_FEATURE_ORDER,
  ROUTE_FEATURE_SHORT_LABELS,
  type RouteFeatureVisualKey,
} from "../../navigation/routeFeaturePalette.ts";

export interface RouteFeatureLegendProps {
  /** Which climb categories/descent severities are actually present in
   * the route currently shown, so the legend only lists entries that
   * mean something right now — never all nine regardless of context. */
  presentVisualKeys: ReadonlySet<RouteFeatureVisualKey>;
}

/**
 * A compact, shared macro route-feature legend — mirrors GradientLegend's
 * exact shape and accessibility posture (colour swatch plus a text label
 * plus a plain-glyph short code per entry; the text label is the
 * authoritative, accessible differentiator; deliberately static content
 * with no live-region role and no focusable descendants).
 */
export function RouteFeatureLegend({ presentVisualKeys }: RouteFeatureLegendProps) {
  const entries = ROUTE_FEATURE_ORDER.filter((visualKey) =>
    presentVisualKeys.has(visualKey),
  );
  if (entries.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Recognised route features legend" className="route-feature-legend">
      {entries.map((visualKey) => (
        <li key={visualKey} className="route-feature-legend-entry">
          <span
            aria-hidden="true"
            className="route-feature-legend-swatch"
            style={{ backgroundColor: ROUTE_FEATURE_COLOURS[visualKey] }}
          />
          <span aria-hidden="true">{ROUTE_FEATURE_SHORT_LABELS[visualKey]} </span>
          {ROUTE_FEATURE_LABELS[visualKey]}
        </li>
      ))}
    </ul>
  );
}
