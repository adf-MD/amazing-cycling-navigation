import {
  CLIMB_CATEGORY_SEVERITY_ORDER,
  type ClimbCategory,
} from "../../navigation/routeFeatures.ts";
import {
  CLIMB_CATEGORY_NAMES,
  ROUTE_FEATURE_COLOURS,
} from "../../navigation/routeFeaturePalette.ts";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";

export interface ClimbCategoriesDisclosureProps {
  /** Which climb categories are actually present on the route currently
   * shown, so the legend only lists entries that mean something right
   * now — never all six regardless of context. */
  presentCategories: ReadonlySet<ClimbCategory>;
}

/**
 * A small, collapsed-by-default "Climb categories" disclosure for the
 * Riding pre-ride full-route elevation overview only (backlog item 77) —
 * unlike GradientColoursDisclosure (used everywhere else the elevation
 * chart appears), this lists only climb categories: no "Ordinary route"
 * row (the pre-ride profile's ordinary line is black, not the map's green
 * route colour), no recognised-descent rows (descents aren't coloured in
 * this one view), no explanatory prose, and no local-gradient detail
 * section. Deliberately does not reuse RouteFeatureLegend/
 * ROUTE_FEATURE_LEGEND_ENTRIES, since that shared legend merges
 * Uncategorised and Category 4 into a single row (they share a colour) —
 * here they must be named as two distinct rows when both genuinely occur.
 * Renders nothing (not even the outer `<details>`) when the route has no
 * recognised climbs, matching this codebase's established "nothing to
 * show yet" convention (GradientColoursDisclosure, RouteFeatureLegend,
 * ClimbGradientBandLegend).
 */
export function ClimbCategoriesDisclosure({
  presentCategories,
}: ClimbCategoriesDisclosureProps) {
  if (presentCategories.size === 0) {
    return null;
  }

  const categories = CLIMB_CATEGORY_SEVERITY_ORDER.filter((category) =>
    presentCategories.has(category),
  );

  return (
    <details className="climb-categories-disclosure">
      <summary>Climb categories</summary>
      <ul aria-label="Climb categories" className="route-feature-legend">
        {categories.map((category) => (
          <li key={category} className="route-feature-legend-entry">
            <GradientColourSwatch colour={ROUTE_FEATURE_COLOURS[category]} />
            {CLIMB_CATEGORY_NAMES[category]}
          </li>
        ))}
      </ul>
    </details>
  );
}
