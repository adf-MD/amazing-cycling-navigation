import type { ClimbCategory, DescentSeverity } from "./routeFeatures.ts";

/** The combined key space for macro route-feature colouring — climb
 * categories and descent severities are disjoint string unions, so one
 * combined key is safe to use as a single map/MapLibre `match`-expression
 * lookup (see src/map/routeFeatureLayer.ts) without a separate "kind"
 * discriminant. */
export type RouteFeatureVisualKey = ClimbCategory | DescentSeverity;

/**
 * The single authoritative macro route-feature colour/label/short-label
 * mapping, shared by the map (src/map/routeFeatureLayer.ts via
 * MapView.tsx) and the elevation chart/legend
 * (src/ui/shared/ElevationChart.tsx, RouteFeatureLegend.tsx) — mirrors
 * gradientPalette.ts's own pattern exactly (one authoritative module, no
 * second copy of thresholds/colours anywhere else). Climb colours follow
 * Garmin's own light-green-through-dark-red convention; descent colours
 * are an app-specific light-through-dark blue scheme (Garmin publishes no
 * descent classification — see routeFeatures.ts's own doc comments).
 * Colours are checked for distinguishability from every existing
 * warning/route/marker colour and pairwise from each other in
 * routeFeaturePalette.test.ts (the same redmean colour-distance check
 * gradientPalette.test.ts already uses) — deliberately NOT required to be
 * distinguishable from GRADIENT_CLASS_COLOURS, since macro and micro
 * colouring are never shown at the same route point simultaneously (see
 * CLAUDE.md).
 */
export const ROUTE_FEATURE_COLOURS: Readonly<Record<RouteFeatureVisualKey, string>> = {
  uncategorised: "#c5e1a5",
  "category-4": "#7cb342",
  "category-3": "#fdd835",
  "category-2": "#fb8c00",
  "category-1": "#b71c1c",
  hc: "#8e0000",
  gentle: "#4fc3f7",
  steep: "#1565c0",
  "very-steep": "#1a1a4e",
};

/** Human-readable name for each visual key's colour — lets the legend
 * state a colour in words as well as showing the swatch itself, so
 * meaning never depends on perceiving the colour. */
export const ROUTE_FEATURE_COLOUR_NAMES: Readonly<Record<RouteFeatureVisualKey, string>> =
  {
    uncategorised: "light green",
    "category-4": "green",
    "category-3": "yellow",
    "category-2": "orange",
    "category-1": "red",
    hc: "dark red",
    gentle: "light blue",
    steep: "blue",
    "very-steep": "dark blue",
  };

/** Bare climb category name, with no "climb" suffix — used for the
 * pre-ride climb selector's numbered heading ("Climb 2 · Category 3") and
 * dropdown option text, where "Climb N" already establishes it's a climb.
 * Kept as its own map rather than derived from ROUTE_FEATURE_LABELS (or
 * vice versa) to avoid risking the latter's existing tested strings; a
 * consistency test instead asserts the two can never silently drift
 * apart. */
export const CLIMB_CATEGORY_NAMES: Readonly<Record<ClimbCategory, string>> = {
  uncategorised: "Uncategorised",
  "category-4": "Category 4",
  "category-3": "Category 3",
  "category-2": "Category 2",
  "category-1": "Category 1",
  hc: "HC",
};

/** Full text labels for the legend. Descent labels spell out severity so
 * the three descent swatches remain distinguishable by text alone (the
 * details panel instead always shows the exact, severity-independent
 * "Recognised descent" heading required by the spec, plus its own
 * average-gradient figure — see RouteFeatureDetailsPanel.tsx). */
export const ROUTE_FEATURE_LABELS: Readonly<Record<RouteFeatureVisualKey, string>> = {
  uncategorised: "Uncategorised climb",
  "category-4": "Category 4 climb",
  "category-3": "Category 3 climb",
  "category-2": "Category 2 climb",
  "category-1": "Category 1 climb",
  hc: "HC climb",
  // Described by magnitude (steepness), not signed value: "just below"
  // reads confusingly against negative numbers that grow more negative as
  // they steepen. Verified against classifyDescentSeverity's exact
  // thresholds (avg > -6 gentle, avg > -9 steep, else very-steep) and
  // feature eligibility (avg <= -3) — every boundary value (6%, 9%) is
  // unambiguously owned by exactly one entry, unlike the previous
  // "gentle, −3% to −6%" / "steep, −6% to −9%" wording, where both
  // adjacent bands claimed the shared boundary with no inequality cue.
  gentle: "Recognised descent (gentle, 3% to just below 6%)",
  steep: "Recognised descent (steep, 6% to just below 9%)",
  "very-steep": "Recognised descent (very steep, 9% or more)",
};

/** Short codes for space-constrained map labels. Deliberately hollow
 * down-arrow glyphs for descents (▽ rather than GRADIENT_CLASS_SYMBOLS'
 * solid ▼) so a macro descent glyph is never visually confused with a
 * micro "descent"/"steep-descent" local-gradient glyph. */
export const ROUTE_FEATURE_SHORT_LABELS: Readonly<Record<RouteFeatureVisualKey, string>> =
  {
    uncategorised: "UC",
    "category-4": "C4",
    "category-3": "C3",
    "category-2": "C2",
    "category-1": "C1",
    hc: "HC",
    gentle: "▽",
    steep: "▽▽",
    "very-steep": "▽▽▽",
  };

/** Display order for the legend and any other enumeration: climbs light
 * to dark (uncategorised through HC), then descents light to dark
 * (gentle through very-steep). */
export const ROUTE_FEATURE_ORDER: readonly RouteFeatureVisualKey[] = [
  "uncategorised",
  "category-4",
  "category-3",
  "category-2",
  "category-1",
  "hc",
  "gentle",
  "steep",
  "very-steep",
];
