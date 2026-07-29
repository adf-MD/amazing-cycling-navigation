import {
  ROUTE_FEATURE_COLOUR_NAMES,
  ROUTE_FEATURE_COLOURS,
  ROUTE_FEATURE_LABELS,
  ROUTE_FEATURE_ORDER,
  ROUTE_FEATURE_SHORT_LABELS,
  type RouteFeatureVisualKey,
} from "../../navigation/routeFeaturePalette.ts";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";

export interface RouteFeatureLegendProps {
  /** Which climb categories/descent severities are actually present in
   * the route currently shown, so the legend only lists entries that
   * mean something right now — never all nine regardless of context. */
  presentVisualKeys: ReadonlySet<RouteFeatureVisualKey>;
}

/** Mirrors MapView.tsx's own REMAINING_LAYER colour (#0a5f38) — kept as a
 * literal snapshot, not imported, matching this codebase's existing
 * cross-module colour-reference precedent (see gradientPalette.test.ts's
 * EXISTING_MAP_COLOURS comment). Deliberately NOT a RouteFeatureVisualKey/
 * ROUTE_FEATURE_COLOURS entry: that map feeds MapView's real MapLibre
 * paint expression for actual GeoJSON features, and routeFeaturePalette.
 * test.ts colour-distance-checks every entry against this exact hex value
 * — adding it there would both fail that check (distance 0 against
 * itself) and pollute the map's real lookup table with a fake feature
 * key. This is a UI-only legend row: a route section that is not part of
 * any recognised climb or descent — including one with missing or
 * insufficient elevation data, which today has no distinct macro
 * treatment of its own and simply falls through to this same base
 * colour — is truthfully described by one combined entry rather than a
 * second, fabricated "unknown" colour that doesn't actually render
 * anywhere. */
const ORDINARY_ROUTE_COLOUR = "#0a5f38";
const ORDINARY_ROUTE_LABEL =
  "Ordinary route (including sections with missing or insufficient elevation data) · green";

/**
 * A compact, shared macro route-feature legend — mirrors GradientLegend's
 * exact shape and accessibility posture (colour swatch plus a text label
 * plus a plain-glyph short code per entry; the text label is the
 * authoritative, accessible differentiator; deliberately static content
 * with no live-region role and no focusable descendants). Always shows
 * one "ordinary route" row first, since that colour is meaningful
 * whenever this legend renders at all, followed by whichever recognised
 * climb categories/descent severities are actually present.
 */
export function RouteFeatureLegend({ presentVisualKeys }: RouteFeatureLegendProps) {
  const entries = ROUTE_FEATURE_ORDER.filter((visualKey) =>
    presentVisualKeys.has(visualKey),
  );

  return (
    <ul aria-label="Recognised route features legend" className="route-feature-legend">
      <li className="route-feature-legend-entry">
        <GradientColourSwatch colour={ORDINARY_ROUTE_COLOUR} />
        {ORDINARY_ROUTE_LABEL}
      </li>
      {entries.map((visualKey) => (
        <li key={visualKey} className="route-feature-legend-entry">
          <GradientColourSwatch colour={ROUTE_FEATURE_COLOURS[visualKey]} />
          <span aria-hidden="true">{ROUTE_FEATURE_SHORT_LABELS[visualKey]} </span>
          {ROUTE_FEATURE_LABELS[visualKey]} · {ROUTE_FEATURE_COLOUR_NAMES[visualKey]}
        </li>
      ))}
    </ul>
  );
}
