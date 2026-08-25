import type {
  ClimbCategory,
  ClimbGradientBand,
  DescentBand,
  DescentLocalKey,
} from "./routeFeatures.ts";

/** The combined key space for macro route-feature colouring — climb
 * categories and descent bands are disjoint string unions, so one
 * combined key is safe to use as a single map/MapLibre `match`-expression
 * lookup (see src/map/routeFeatureLayer.ts) without a separate "kind"
 * discriminant. */
export type RouteFeatureVisualKey = ClimbCategory | DescentBand;

/** The combined key space for *detailed* local-gradient colouring within a
 * selected or currently active climb/descent — 5 Garmin-style climb bands
 * plus the 3 descent bands plus "neutral" (a descent-only local stretch
 * shallower than the descent eligibility threshold). Disjoint from
 * RouteFeatureVisualKey's own key strings (different concept, different
 * scale — see routeFeatures.ts), so both can share one MapLibre layer
 * property space if ever needed without collision, though today each has
 * its own dedicated property. */
export type MicroDetailVisualKey = ClimbGradientBand | DescentLocalKey;

/** The five Garmin-ClimbPro-style severity tiers, shared by a climb's
 * macro category colouring AND its local-gradient band colouring — "where
 * practical, use the same authoritative colour token for corresponding
 * macro and micro meanings" (see CLAUDE.md). Uncategorised and Category 4
 * climbs intentionally share the same "green" tier (there are 6 climb
 * categories but only 5 Garmin bands), while the underlying ClimbCategory
 * data keeps all 6 distinct values for text elsewhere (details panel,
 * pre-ride selector). */
type ClimbColourTier = "green" | "yellow" | "orange" | "red" | "dark-red";

const CLIMB_TIER_COLOURS: Readonly<Record<ClimbColourTier, string>> = {
  green: "#7cb342",
  yellow: "#fdd835",
  orange: "#fb8c00",
  red: "#b71c1c",
  "dark-red": "#8e0000",
};

const CLIMB_TIER_COLOUR_NAMES: Readonly<Record<ClimbColourTier, string>> = {
  green: "green",
  yellow: "yellow",
  orange: "orange",
  red: "red",
  "dark-red": "dark red",
};

const CLIMB_CATEGORY_TIER: Readonly<Record<ClimbCategory, ClimbColourTier>> = {
  uncategorised: "green",
  "category-4": "green",
  "category-3": "yellow",
  "category-2": "orange",
  "category-1": "red",
  hc: "dark-red",
};

const CLIMB_GRADIENT_BAND_TIER: Readonly<Record<ClimbGradientBand, ClimbColourTier>> = {
  "gentle-or-descending": "green",
  "moderate-climb": "yellow",
  "hard-climb": "orange",
  "very-hard-climb": "red",
  "extremely-steep-climb": "dark-red",
};

/** The three descent bands' colours — unchanged hexes from this app's
 * earlier three-descent-severity scheme, reused identically at both the
 * macro (whole-descent, by average gradient) and local (selected/active,
 * by smoothed local gradient) level, since descent macro and local
 * classification are the exact same scheme (unlike climbs). */
export const DESCENT_BAND_COLOURS: Readonly<Record<DescentBand, string>> = {
  moderate: "#4fc3f7",
  steep: "#1565c0",
  "very-steep": "#1a1a4e",
};

const DESCENT_BAND_COLOUR_NAMES: Readonly<Record<DescentBand, string>> = {
  moderate: "light blue",
  steep: "blue",
  "very-steep": "dark blue",
};

/** Mirrors MapView.tsx's own REMAINING_LAYER colour (#0a5f38) — kept as a
 * literal snapshot, not imported, matching this codebase's existing
 * cross-module colour-reference precedent (see this module's own
 * colour-distance test). Used both by the legend's "ordinary route" row
 * and by a descent's local-detail rendering wherever the smoothed local
 * gradient is shallower than the descent eligibility threshold — a
 * deliberate visual "this bit is just ordinary route", not a fourth
 * descent-severity colour. */
export const ORDINARY_ROUTE_COLOUR = "#0a5f38";
export const ORDINARY_ROUTE_LABEL =
  "Ordinary route (including sections with missing or insufficient elevation data, and any locally shallow stretch within a selected descent) · green";

/** Defensive fallback for the map's DataDrivenLineColor.fallback slots
 * (macro and micro layers) — genuinely unreachable in normal operation,
 * since every stamped visualKey is always one of the known cases. Never a
 * substitute for real presentation. Reuses the descent "steep" blue rather
 * than introducing a new literal. */
export const UNREACHABLE_FALLBACK_COLOUR = DESCENT_BAND_COLOURS.steep;

export const ROUTE_FEATURE_COLOURS: Readonly<Record<RouteFeatureVisualKey, string>> = {
  uncategorised: CLIMB_TIER_COLOURS[CLIMB_CATEGORY_TIER.uncategorised],
  "category-4": CLIMB_TIER_COLOURS[CLIMB_CATEGORY_TIER["category-4"]],
  "category-3": CLIMB_TIER_COLOURS[CLIMB_CATEGORY_TIER["category-3"]],
  "category-2": CLIMB_TIER_COLOURS[CLIMB_CATEGORY_TIER["category-2"]],
  "category-1": CLIMB_TIER_COLOURS[CLIMB_CATEGORY_TIER["category-1"]],
  hc: CLIMB_TIER_COLOURS[CLIMB_CATEGORY_TIER.hc],
  moderate: DESCENT_BAND_COLOURS.moderate,
  steep: DESCENT_BAND_COLOURS.steep,
  "very-steep": DESCENT_BAND_COLOURS["very-steep"],
};

/** Human-readable name for each visual key's colour — lets the legend
 * state a colour in words as well as showing the swatch itself, so
 * meaning never depends on perceiving the colour. Uncategorised and
 * Category 4 intentionally share "green", matching their shared colour. */
export const ROUTE_FEATURE_COLOUR_NAMES: Readonly<Record<RouteFeatureVisualKey, string>> =
  {
    uncategorised: CLIMB_TIER_COLOUR_NAMES[CLIMB_CATEGORY_TIER.uncategorised],
    "category-4": CLIMB_TIER_COLOUR_NAMES[CLIMB_CATEGORY_TIER["category-4"]],
    "category-3": CLIMB_TIER_COLOUR_NAMES[CLIMB_CATEGORY_TIER["category-3"]],
    "category-2": CLIMB_TIER_COLOUR_NAMES[CLIMB_CATEGORY_TIER["category-2"]],
    "category-1": CLIMB_TIER_COLOUR_NAMES[CLIMB_CATEGORY_TIER["category-1"]],
    hc: CLIMB_TIER_COLOUR_NAMES[CLIMB_CATEGORY_TIER.hc],
    moderate: DESCENT_BAND_COLOUR_NAMES.moderate,
    steep: DESCENT_BAND_COLOUR_NAMES.steep,
    "very-steep": DESCENT_BAND_COLOUR_NAMES["very-steep"],
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

/** Full text labels for the macro legend. Descent labels spell out the
 * band so the three descent swatches remain distinguishable by text alone
 * (the details panel instead always shows the exact, band-independent
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
  // they steepen. Every boundary value (6%, 9%) is unambiguously owned by
  // exactly one entry.
  moderate: "Recognised descent (moderate, 3% to just below 6%)",
  steep: "Recognised descent (steep, 6% to just below 9%)",
  "very-steep": "Recognised descent (very steep, 9% or more)",
};

/** Short codes for space-constrained map labels. Deliberately hollow
 * down-arrow glyphs for descents (▽ rather than an up-arrow) so a macro
 * descent glyph is never visually confused with a climb glyph. */
export const ROUTE_FEATURE_SHORT_LABELS: Readonly<Record<RouteFeatureVisualKey, string>> =
  {
    uncategorised: "UC",
    "category-4": "C4",
    "category-3": "C3",
    "category-2": "C2",
    "category-1": "C1",
    hc: "HC",
    moderate: "▽",
    steep: "▽▽",
    "very-steep": "▽▽▽",
  };

/** One legend row per distinguishable macro colour: Uncategorised and
 * Category 4 climbs are combined into a single row (they render with an
 * *identical* swatch — two rows with the same colour would read as a
 * bug), while every other category/descent band gets its own row. Feeds
 * RouteFeatureLegend.tsx; the underlying flat maps above remain the
 * source MapView's real MapLibre paint expression and the details panel
 * use. */
export interface RouteFeatureLegendEntry {
  visualKeys: readonly RouteFeatureVisualKey[];
  colour: string;
  colourName: string;
  label: string;
  shortLabel: string;
}

export const ROUTE_FEATURE_LEGEND_ENTRIES: readonly RouteFeatureLegendEntry[] = [
  {
    visualKeys: ["uncategorised", "category-4"],
    colour: ROUTE_FEATURE_COLOURS["category-4"],
    colourName: ROUTE_FEATURE_COLOUR_NAMES["category-4"],
    label: "Uncategorised or Category 4 climb",
    shortLabel: "UC/C4",
  },
  {
    visualKeys: ["category-3"],
    colour: ROUTE_FEATURE_COLOURS["category-3"],
    colourName: ROUTE_FEATURE_COLOUR_NAMES["category-3"],
    label: ROUTE_FEATURE_LABELS["category-3"],
    shortLabel: ROUTE_FEATURE_SHORT_LABELS["category-3"],
  },
  {
    visualKeys: ["category-2"],
    colour: ROUTE_FEATURE_COLOURS["category-2"],
    colourName: ROUTE_FEATURE_COLOUR_NAMES["category-2"],
    label: ROUTE_FEATURE_LABELS["category-2"],
    shortLabel: ROUTE_FEATURE_SHORT_LABELS["category-2"],
  },
  {
    visualKeys: ["category-1"],
    colour: ROUTE_FEATURE_COLOURS["category-1"],
    colourName: ROUTE_FEATURE_COLOUR_NAMES["category-1"],
    label: ROUTE_FEATURE_LABELS["category-1"],
    shortLabel: ROUTE_FEATURE_SHORT_LABELS["category-1"],
  },
  {
    visualKeys: ["hc"],
    colour: ROUTE_FEATURE_COLOURS.hc,
    colourName: ROUTE_FEATURE_COLOUR_NAMES.hc,
    label: ROUTE_FEATURE_LABELS.hc,
    shortLabel: ROUTE_FEATURE_SHORT_LABELS.hc,
  },
  {
    visualKeys: ["moderate"],
    colour: ROUTE_FEATURE_COLOURS.moderate,
    colourName: ROUTE_FEATURE_COLOUR_NAMES.moderate,
    label: ROUTE_FEATURE_LABELS.moderate,
    shortLabel: ROUTE_FEATURE_SHORT_LABELS.moderate,
  },
  {
    visualKeys: ["steep"],
    colour: ROUTE_FEATURE_COLOURS.steep,
    colourName: ROUTE_FEATURE_COLOUR_NAMES.steep,
    label: ROUTE_FEATURE_LABELS.steep,
    shortLabel: ROUTE_FEATURE_SHORT_LABELS.steep,
  },
  {
    visualKeys: ["very-steep"],
    colour: ROUTE_FEATURE_COLOURS["very-steep"],
    colourName: ROUTE_FEATURE_COLOUR_NAMES["very-steep"],
    label: ROUTE_FEATURE_LABELS["very-steep"],
    shortLabel: ROUTE_FEATURE_SHORT_LABELS["very-steep"],
  },
];

/** Detailed (Garmin-inspired) climb local-gradient colours — see
 * routeFeatures.ts's classifyClimbGradientBand for the exact thresholds.
 * Shares its five colour tokens with the corresponding macro climb
 * category wherever practical (see CLIMB_GRADIENT_BAND_TIER above); the
 * macro and local classifications remain mathematically different despite
 * sharing colours (a climb's overall category depends on length and
 * average gradient, a local band only on the smoothed gradient at that
 * point) — see CLIMB_GRADIENT_BAND_LABELS' own wording, which deliberately
 * never uses "Category N" for a local band. */
const CLIMB_GRADIENT_BAND_COLOURS: Readonly<Record<ClimbGradientBand, string>> = {
  "gentle-or-descending":
    CLIMB_TIER_COLOURS[CLIMB_GRADIENT_BAND_TIER["gentle-or-descending"]],
  "moderate-climb": CLIMB_TIER_COLOURS[CLIMB_GRADIENT_BAND_TIER["moderate-climb"]],
  "hard-climb": CLIMB_TIER_COLOURS[CLIMB_GRADIENT_BAND_TIER["hard-climb"]],
  "very-hard-climb": CLIMB_TIER_COLOURS[CLIMB_GRADIENT_BAND_TIER["very-hard-climb"]],
  "extremely-steep-climb":
    CLIMB_TIER_COLOURS[CLIMB_GRADIENT_BAND_TIER["extremely-steep-climb"]],
};

export const CLIMB_GRADIENT_BAND_COLOUR_NAMES: Readonly<
  Record<ClimbGradientBand, string>
> = {
  "gentle-or-descending":
    CLIMB_TIER_COLOUR_NAMES[CLIMB_GRADIENT_BAND_TIER["gentle-or-descending"]],
  "moderate-climb": CLIMB_TIER_COLOUR_NAMES[CLIMB_GRADIENT_BAND_TIER["moderate-climb"]],
  "hard-climb": CLIMB_TIER_COLOUR_NAMES[CLIMB_GRADIENT_BAND_TIER["hard-climb"]],
  "very-hard-climb": CLIMB_TIER_COLOUR_NAMES[CLIMB_GRADIENT_BAND_TIER["very-hard-climb"]],
  "extremely-steep-climb":
    CLIMB_TIER_COLOUR_NAMES[CLIMB_GRADIENT_BAND_TIER["extremely-steep-climb"]],
};

/** Local-gradient-only wording — deliberately never "Category N": a local
 * band describes only the smoothed gradient at one point within a climb,
 * not the climb's own overall length+average-gradient score. */
export const CLIMB_GRADIENT_BAND_LABELS: Readonly<Record<ClimbGradientBand, string>> = {
  "gentle-or-descending": "Gentle, flat or brief descent",
  "moderate-climb": "Moderate climb",
  "hard-climb": "Hard climb",
  "very-hard-climb": "Very hard climb",
  "extremely-steep-climb": "Extremely steep climb",
};

export const CLIMB_GRADIENT_BAND_RANGE_LABELS: Readonly<
  Record<ClimbGradientBand, string>
> = {
  "gentle-or-descending": "Below 3%",
  "moderate-climb": "3% to just below 6%",
  "hard-climb": "6% to just below 9%",
  "very-hard-climb": "9% to just below 12%",
  "extremely-steep-climb": "12% or more",
};

/** Short local-detail heading for a selected micro segment within a
 * descent (see GradientSegmentDetailsPanel.tsx) — distinct from
 * ROUTE_FEATURE_LABELS' longer legend sentences, the same granularity
 * relationship CLIMB_CATEGORY_NAMES already has to ROUTE_FEATURE_LABELS. */
export const DESCENT_LOCAL_LABELS: Readonly<Record<DescentLocalKey, string>> = {
  moderate: "Moderate descent",
  steep: "Steep descent",
  "very-steep": "Very steep descent",
  neutral: "Shallower than the descent threshold",
};

/** Grade ranges for a selected/active descent's local legend (backlog item
 * 78) — mirrors CLIMB_GRADIENT_BAND_RANGE_LABELS' shape. Boundaries match
 * descentBandFromGradient/classifyDescentLocalKey in routeFeatures.ts
 * (-6%/-9% band edges, -3% neutral threshold), expressed as positive
 * percentages for display. */
export const DESCENT_LOCAL_RANGE_LABELS: Readonly<Record<DescentLocalKey, string>> = {
  neutral: "Below 3%",
  moderate: "3% to just below 6%",
  steep: "6% to just below 9%",
  "very-steep": "9% or more",
};

/** Colour names for a selected/active descent's local legend (backlog item
 * 78) — mirrors CLIMB_GRADIENT_BAND_COLOUR_NAMES' shape, reusing
 * DESCENT_BAND_COLOUR_NAMES' own wording for the three descent bands
 * (identical local colours, see MICRO_DETAIL_COLOURS below) plus "green"
 * for the plain ordinary-route neutral colour. */
export const DESCENT_LOCAL_COLOUR_NAMES: Readonly<Record<DescentLocalKey, string>> = {
  ...DESCENT_BAND_COLOUR_NAMES,
  neutral: "green",
};

/** The colours actually painted for a selected/active climb or descent's
 * local detail — climb bands share their macro tier's colour; descent
 * bands are identical to their macro DESCENT_BAND_COLOURS entry (the same
 * scheme, applied locally); "neutral" is the plain ordinary-route colour. */
export const MICRO_DETAIL_COLOURS: Readonly<Record<MicroDetailVisualKey, string>> = {
  ...CLIMB_GRADIENT_BAND_COLOURS,
  moderate: DESCENT_BAND_COLOURS.moderate,
  steep: DESCENT_BAND_COLOURS.steep,
  "very-steep": DESCENT_BAND_COLOURS["very-steep"],
  neutral: ORDINARY_ROUTE_COLOUR,
};

/** One combined lookup for GradientSegmentDetailsPanel's heading — safe
 * since ClimbGradientBand and DescentLocalKey are disjoint string unions
 * (no shared key, so the spread below can never silently overwrite an
 * entry). */
export const MICRO_DETAIL_LABELS: Readonly<Record<MicroDetailVisualKey, string>> = {
  ...CLIMB_GRADIENT_BAND_LABELS,
  ...DESCENT_LOCAL_LABELS,
};
