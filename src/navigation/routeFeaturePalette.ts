import type { ParameterlessMessageKey } from "../i18n/translate.ts";
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

const CLIMB_TIER_COLOUR_NAME_KEYS: Readonly<
  Record<ClimbColourTier, ParameterlessMessageKey>
> = {
  green: "feature.colour.green",
  yellow: "feature.colour.yellow",
  orange: "feature.colour.orange",
  red: "feature.colour.red",
  "dark-red": "feature.colour.darkRed",
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

const DESCENT_BAND_COLOUR_NAME_KEYS: Readonly<
  Record<DescentBand, ParameterlessMessageKey>
> = {
  moderate: "feature.colour.lightBlue",
  steep: "feature.colour.blue",
  "very-steep": "feature.colour.darkBlue",
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
export const ORDINARY_ROUTE_LABEL_KEY: ParameterlessMessageKey = "feature.ordinaryRoute";

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
export const ROUTE_FEATURE_COLOUR_NAME_KEYS: Readonly<
  Record<RouteFeatureVisualKey, ParameterlessMessageKey>
> = {
  uncategorised: CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_CATEGORY_TIER.uncategorised],
  "category-4": CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_CATEGORY_TIER["category-4"]],
  "category-3": CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_CATEGORY_TIER["category-3"]],
  "category-2": CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_CATEGORY_TIER["category-2"]],
  "category-1": CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_CATEGORY_TIER["category-1"]],
  hc: CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_CATEGORY_TIER.hc],
  moderate: DESCENT_BAND_COLOUR_NAME_KEYS.moderate,
  steep: DESCENT_BAND_COLOUR_NAME_KEYS.steep,
  "very-steep": DESCENT_BAND_COLOUR_NAME_KEYS["very-steep"],
};

/** Bare climb category name, with no "climb" suffix — used for the
 * pre-ride climb selector's numbered heading ("Climb 2 · Category 3") and
 * dropdown option text, where "Climb N" already establishes it's a climb.
 * Kept as its own map rather than derived from ROUTE_FEATURE_LABELS (or
 * vice versa) to avoid risking the latter's existing tested strings; a
 * consistency test instead asserts the two can never silently drift
 * apart. */
export const CLIMB_CATEGORY_NAME_KEYS: Readonly<
  Record<ClimbCategory, ParameterlessMessageKey>
> = {
  uncategorised: "feature.category.uncategorised",
  "category-4": "feature.category.category4",
  "category-3": "feature.category.category3",
  "category-2": "feature.category.category2",
  "category-1": "feature.category.category1",
  hc: "feature.category.hc",
};

/** Full text labels for the macro legend. Descent labels spell out the
 * band so the three descent swatches remain distinguishable by text alone
 * (the details panel instead always shows the exact, band-independent
 * "Recognised descent" heading required by the spec, plus its own
 * average-gradient figure — see RouteFeatureDetailsPanel.tsx). */
export const ROUTE_FEATURE_LABEL_KEYS: Readonly<
  Record<RouteFeatureVisualKey, ParameterlessMessageKey>
> = {
  uncategorised: "feature.label.uncategorised",
  "category-4": "feature.label.category4",
  "category-3": "feature.label.category3",
  "category-2": "feature.label.category2",
  "category-1": "feature.label.category1",
  hc: "feature.label.hc",
  moderate: "feature.label.moderate",
  steep: "feature.label.steep",
  "very-steep": "feature.label.verySteep",
};

/** Short codes for space-constrained map labels. Deliberately hollow
 * down-arrow glyphs for descents (▽ rather than an up-arrow) so a macro
 * descent glyph is never visually confused with a climb glyph. */
export const ROUTE_FEATURE_SHORT_LABEL_KEYS: Readonly<
  Record<RouteFeatureVisualKey, ParameterlessMessageKey>
> = {
  uncategorised: "feature.shortLabel.uncategorised",
  "category-4": "feature.shortLabel.category4",
  "category-3": "feature.shortLabel.category3",
  "category-2": "feature.shortLabel.category2",
  "category-1": "feature.shortLabel.category1",
  hc: "feature.shortLabel.hc",
  moderate: "feature.shortLabel.moderate",
  steep: "feature.shortLabel.steep",
  "very-steep": "feature.shortLabel.verySteep",
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
  colourNameKey: ParameterlessMessageKey;
  labelKey: ParameterlessMessageKey;
  shortLabelKey: ParameterlessMessageKey;
}

export const ROUTE_FEATURE_LEGEND_ENTRIES: readonly RouteFeatureLegendEntry[] = [
  {
    visualKeys: ["uncategorised", "category-4"],
    colour: ROUTE_FEATURE_COLOURS["category-4"],
    colourNameKey: ROUTE_FEATURE_COLOUR_NAME_KEYS["category-4"],
    labelKey: "feature.label.uncategorisedOrCategory4",
    shortLabelKey: "feature.shortLabel.uncategorisedOrCategory4",
  },
  {
    visualKeys: ["category-3"],
    colour: ROUTE_FEATURE_COLOURS["category-3"],
    colourNameKey: ROUTE_FEATURE_COLOUR_NAME_KEYS["category-3"],
    labelKey: ROUTE_FEATURE_LABEL_KEYS["category-3"],
    shortLabelKey: ROUTE_FEATURE_SHORT_LABEL_KEYS["category-3"],
  },
  {
    visualKeys: ["category-2"],
    colour: ROUTE_FEATURE_COLOURS["category-2"],
    colourNameKey: ROUTE_FEATURE_COLOUR_NAME_KEYS["category-2"],
    labelKey: ROUTE_FEATURE_LABEL_KEYS["category-2"],
    shortLabelKey: ROUTE_FEATURE_SHORT_LABEL_KEYS["category-2"],
  },
  {
    visualKeys: ["category-1"],
    colour: ROUTE_FEATURE_COLOURS["category-1"],
    colourNameKey: ROUTE_FEATURE_COLOUR_NAME_KEYS["category-1"],
    labelKey: ROUTE_FEATURE_LABEL_KEYS["category-1"],
    shortLabelKey: ROUTE_FEATURE_SHORT_LABEL_KEYS["category-1"],
  },
  {
    visualKeys: ["hc"],
    colour: ROUTE_FEATURE_COLOURS.hc,
    colourNameKey: ROUTE_FEATURE_COLOUR_NAME_KEYS.hc,
    labelKey: ROUTE_FEATURE_LABEL_KEYS.hc,
    shortLabelKey: ROUTE_FEATURE_SHORT_LABEL_KEYS.hc,
  },
  {
    visualKeys: ["moderate"],
    colour: ROUTE_FEATURE_COLOURS.moderate,
    colourNameKey: ROUTE_FEATURE_COLOUR_NAME_KEYS.moderate,
    labelKey: ROUTE_FEATURE_LABEL_KEYS.moderate,
    shortLabelKey: ROUTE_FEATURE_SHORT_LABEL_KEYS.moderate,
  },
  {
    visualKeys: ["steep"],
    colour: ROUTE_FEATURE_COLOURS.steep,
    colourNameKey: ROUTE_FEATURE_COLOUR_NAME_KEYS.steep,
    labelKey: ROUTE_FEATURE_LABEL_KEYS.steep,
    shortLabelKey: ROUTE_FEATURE_SHORT_LABEL_KEYS.steep,
  },
  {
    visualKeys: ["very-steep"],
    colour: ROUTE_FEATURE_COLOURS["very-steep"],
    colourNameKey: ROUTE_FEATURE_COLOUR_NAME_KEYS["very-steep"],
    labelKey: ROUTE_FEATURE_LABEL_KEYS["very-steep"],
    shortLabelKey: ROUTE_FEATURE_SHORT_LABEL_KEYS["very-steep"],
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

export const CLIMB_GRADIENT_BAND_COLOUR_NAME_KEYS: Readonly<
  Record<ClimbGradientBand, ParameterlessMessageKey>
> = {
  "gentle-or-descending":
    CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_GRADIENT_BAND_TIER["gentle-or-descending"]],
  "moderate-climb":
    CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_GRADIENT_BAND_TIER["moderate-climb"]],
  "hard-climb": CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_GRADIENT_BAND_TIER["hard-climb"]],
  "very-hard-climb":
    CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_GRADIENT_BAND_TIER["very-hard-climb"]],
  "extremely-steep-climb":
    CLIMB_TIER_COLOUR_NAME_KEYS[CLIMB_GRADIENT_BAND_TIER["extremely-steep-climb"]],
};

/** Local-gradient-only wording — deliberately never "Category N": a local
 * band describes only the smoothed gradient at one point within a climb,
 * not the climb's own overall length+average-gradient score. */
export const CLIMB_GRADIENT_BAND_LABEL_KEYS: Readonly<
  Record<ClimbGradientBand, ParameterlessMessageKey>
> = {
  "gentle-or-descending": "feature.band.gentleOrDescending",
  "moderate-climb": "feature.band.moderateClimb",
  "hard-climb": "feature.band.hardClimb",
  "very-hard-climb": "feature.band.veryHardClimb",
  "extremely-steep-climb": "feature.band.extremelySteepClimb",
};

export const CLIMB_GRADIENT_BAND_RANGE_LABEL_KEYS: Readonly<
  Record<ClimbGradientBand, ParameterlessMessageKey>
> = {
  "gentle-or-descending": "feature.bandRange.gentleOrDescending",
  "moderate-climb": "feature.bandRange.moderateClimb",
  "hard-climb": "feature.bandRange.hardClimb",
  "very-hard-climb": "feature.bandRange.veryHardClimb",
  "extremely-steep-climb": "feature.bandRange.extremelySteepClimb",
};

/** Short local-detail heading for a selected micro segment within a
 * descent (see GradientSegmentDetailsPanel.tsx) — distinct from
 * ROUTE_FEATURE_LABELS' longer legend sentences, the same granularity
 * relationship CLIMB_CATEGORY_NAMES already has to ROUTE_FEATURE_LABELS. */
export const DESCENT_LOCAL_LABEL_KEYS: Readonly<
  Record<DescentLocalKey, ParameterlessMessageKey>
> = {
  moderate: "feature.descentLocal.moderate",
  steep: "feature.descentLocal.steep",
  "very-steep": "feature.descentLocal.verySteep",
  neutral: "feature.descentLocal.neutral",
};

/** Grade ranges for a selected/active descent's local legend (backlog item
 * 78) — mirrors CLIMB_GRADIENT_BAND_RANGE_LABELS' shape. Boundaries match
 * descentBandFromGradient/classifyDescentLocalKey in routeFeatures.ts
 * (-6%/-9% band edges, -3% neutral threshold), expressed as positive
 * percentages for display. */
export const DESCENT_LOCAL_RANGE_LABEL_KEYS: Readonly<
  Record<DescentLocalKey, ParameterlessMessageKey>
> = {
  neutral: "feature.descentLocalRange.neutral",
  moderate: "feature.descentLocalRange.moderate",
  steep: "feature.descentLocalRange.steep",
  "very-steep": "feature.descentLocalRange.verySteep",
};

/** Colour names for a selected/active descent's local legend (backlog item
 * 78) — mirrors CLIMB_GRADIENT_BAND_COLOUR_NAMES' shape, reusing
 * DESCENT_BAND_COLOUR_NAMES' own wording for the three descent bands
 * (identical local colours, see MICRO_DETAIL_COLOURS below) plus "green"
 * for the plain ordinary-route neutral colour. */
export const DESCENT_LOCAL_COLOUR_NAME_KEYS: Readonly<
  Record<DescentLocalKey, ParameterlessMessageKey>
> = {
  ...DESCENT_BAND_COLOUR_NAME_KEYS,
  neutral: "feature.colour.green",
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

/** The keys the active-Riding direction overlay stamps (backlog item 98).
 * It reproduces, for a short current/near-ahead route interval, exactly the
 * colour the existing stack would paint for that route occurrence — a micro
 * detail key where the currently-detailed feature covers it, otherwise the
 * containing recognised feature's macro key, otherwise plain route. The
 * third case gets its OWN key rather than reusing MicroDetailVisualKey's
 * "neutral": "neutral" specifically means "a locally shallow stretch within
 * a recognised descent" (see DESCENT_LOCAL_LABELS), which is not what
 * "outside every recognised feature" means, even though the two
 * deliberately share a colour. */
export type ActiveDirectionVisualKey =
  RouteFeatureVisualKey | MicroDetailVisualKey | "ordinary-route";

/** The active-direction overlay's own colour lookup. Every entry is reused
 * from the two authoritative maps above — no new shade is introduced — plus
 * ORDINARY_ROUTE_COLOUR for spans outside every recognised feature, which is
 * byte-identical to MapView's own remaining-route green so an unclassified
 * span is invisible except where it wins a geographic overlap.
 *
 * The three keys ROUTE_FEATURE_COLOURS and MICRO_DETAIL_COLOURS share
 * ("moderate"/"steep"/"very-steep") hold identical values in both, so the
 * spread order below cannot change any colour; this module's own test pins
 * that. Deliberately NOT added to MICRO_DETAIL_COLOURS itself, whose
 * pairwise-distinguishability test would rightly reject an intentional
 * duplicate of "neutral". */
export const ACTIVE_DIRECTION_COLOURS: Readonly<
  Record<ActiveDirectionVisualKey, string>
> = {
  ...ROUTE_FEATURE_COLOURS,
  ...MICRO_DETAIL_COLOURS,
  "ordinary-route": ORDINARY_ROUTE_COLOUR,
};

/** One combined lookup for GradientSegmentDetailsPanel's heading — safe
 * since ClimbGradientBand and DescentLocalKey are disjoint string unions
 * (no shared key, so the spread below can never silently overwrite an
 * entry). */
export const MICRO_DETAIL_LABEL_KEYS: Readonly<
  Record<MicroDetailVisualKey, ParameterlessMessageKey>
> = {
  ...CLIMB_GRADIENT_BAND_LABEL_KEYS,
  ...DESCENT_LOCAL_LABEL_KEYS,
};
