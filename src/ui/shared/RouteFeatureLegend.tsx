import { useTranslate } from "../../i18n/useTranslate.ts";
import {
  ORDINARY_ROUTE_COLOUR,
  ORDINARY_ROUTE_LABEL_KEY,
  ROUTE_FEATURE_LEGEND_ENTRIES,
  type RouteFeatureVisualKey,
} from "../../navigation/routeFeaturePalette.ts";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";

export interface RouteFeatureLegendProps {
  /** Which climb categories/descent bands are actually present in
   * the route currently shown, so the legend only lists entries that
   * mean something right now — never all nine regardless of context. */
  presentVisualKeys: ReadonlySet<RouteFeatureVisualKey>;
}

/**
 * A compact, shared macro route-feature legend — mirrors
 * ClimbGradientBandLegend's exact shape and accessibility posture (colour
 * swatch plus a text label plus a plain-glyph short code per entry; the
 * text label is the authoritative, accessible differentiator; deliberately
 * static content with no live-region role and no focusable descendants).
 * Always shows one "ordinary route" row first, since that colour is
 * meaningful whenever this legend renders at all, followed by whichever
 * ROUTE_FEATURE_LEGEND_ENTRIES row has at least one of its visualKeys
 * actually present — Uncategorised and Category 4 climbs share one row
 * (and one swatch), since they render with an identical colour.
 */
export function RouteFeatureLegend({ presentVisualKeys }: RouteFeatureLegendProps) {
  const { t } = useTranslate();
  const entries = ROUTE_FEATURE_LEGEND_ENTRIES.filter((entry) =>
    entry.visualKeys.some((visualKey) => presentVisualKeys.has(visualKey)),
  );

  return (
    <ul aria-label={t("legend.routeFeatures")} className="route-feature-legend">
      <li className="route-feature-legend-entry">
        <GradientColourSwatch colour={ORDINARY_ROUTE_COLOUR} />
        {t(ORDINARY_ROUTE_LABEL_KEY)}
      </li>
      {entries.map((entry) => (
        <li key={entry.visualKeys.join("-")} className="route-feature-legend-entry">
          <GradientColourSwatch colour={entry.colour} />
          <span aria-hidden="true">{t(entry.shortLabelKey)} </span>
          {t(entry.labelKey)} · {t(entry.colourNameKey)}
        </li>
      ))}
    </ul>
  );
}
