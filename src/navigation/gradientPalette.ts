import type { GradientClass } from "./gradient.ts";

/**
 * The single authoritative gradient colour/label/symbol mapping, shared by
 * the map (src/map/MapView.tsx via gradientRouteLayer.ts) and the
 * elevation chart (src/ui/shared/ElevationChart.tsx, GradientLegend.tsx) —
 * both import from here rather than from each other, since src/map/ and
 * src/ui/ never import from one another. Colours were chosen to stay
 * distinguishable from the existing warning-category and route colours
 * defined in src/map/MapView.tsx (verified in gradientPalette.test.ts via
 * an automated colour-distance check) and to avoid relying on hue alone —
 * each class also has a plain-text name, exact grade range, human colour
 * name and non-colour glyph, following this codebase's existing
 * icon-font-free convention. Name/range/colour-name are three separate
 * maps rather than one combined label string, so a legend row can render
 * (and a test can assert) each piece independently.
 */
export const GRADIENT_CLASS_COLOURS: Readonly<Record<GradientClass, string>> = {
  "steep-descent": "#08306b",
  descent: "#6baed6",
  flat: "#2e7d63",
  "gentle-climb": "#a8b400",
  "moderate-climb": "#8a5a00",
  "hard-climb": "#d55e00",
  "very-steep-climb": "#5b3fa6",
  unknown: "#b3aa9c",
};

/** Bare class name, with no range or colour information — the single
 * authoritative source for "what is this class called" (e.g. the pre-ride
 * climb heading and GradientSegmentDetailsPanel both use this directly,
 * rather than deriving it from a combined label string). */
export const GRADIENT_CLASS_NAMES: Readonly<Record<GradientClass, string>> = {
  "steep-descent": "Steep descent",
  descent: "Descent",
  flat: "Flat",
  "gentle-climb": "Gentle climb",
  "moderate-climb": "Moderate climb",
  "hard-climb": "Hard climb",
  "very-steep-climb": "Very steep climb",
  unknown: "Unknown",
};

/** Exact classification range, in a form where every boundary value is
 * unambiguously owned by exactly one entry — e.g. "−6% to just below −2%"
 * followed by "−2% to just below 2%" never leaves a reader unsure which
 * band a boundary value itself (here, −2%) belongs to. Matches
 * classifyGrade's own exact thresholds in gradient.ts. */
export const GRADIENT_CLASS_RANGE_LABELS: Readonly<Record<GradientClass, string>> = {
  "steep-descent": "Below −6%",
  descent: "−6% to just below −2%",
  flat: "−2% to just below 2%",
  "gentle-climb": "2% to just below 4%",
  "moderate-climb": "4% to just below 7%",
  "hard-climb": "7% to just below 10%",
  "very-steep-climb": "10% or more",
  unknown: "No elevation data",
};

/** Human-readable name for each class's colour — lets the legend state a
 * colour in words as well as showing the swatch itself, so meaning never
 * depends on perceiving the colour. */
export const GRADIENT_CLASS_COLOUR_NAMES: Readonly<Record<GradientClass, string>> = {
  "steep-descent": "dark blue",
  descent: "blue",
  flat: "teal green",
  "gentle-climb": "olive",
  "moderate-climb": "brown",
  "hard-climb": "orange",
  "very-steep-climb": "purple",
  unknown: "grey",
};

export const GRADIENT_CLASS_SYMBOLS: Readonly<Record<GradientClass, string>> = {
  "steep-descent": "▼▼",
  descent: "▼",
  flat: "–",
  "gentle-climb": "▲",
  "moderate-climb": "▲▲",
  "hard-climb": "▲▲▲",
  "very-steep-climb": "▲▲▲▲",
  unknown: "?",
};

/** Display order for the legend and any other class enumeration: steepest
 * descent through steepest climb, with unknown last. */
export const GRADIENT_CLASS_ORDER: readonly GradientClass[] = [
  "steep-descent",
  "descent",
  "flat",
  "gentle-climb",
  "moderate-climb",
  "hard-climb",
  "very-steep-climb",
  "unknown",
];
