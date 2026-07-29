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
 * each class also has a plain-text label with its exact grade range and a
 * non-colour glyph, following this codebase's existing icon-font-free
 * convention.
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

export const GRADIENT_CLASS_LABELS: Readonly<Record<GradientClass, string>> = {
  "steep-descent": "Steep descent (< −6%)",
  descent: "Descent (−6% to −2%)",
  flat: "Flat (−2% to 2%)",
  "gentle-climb": "Gentle climb (2% to 4%)",
  "moderate-climb": "Moderate climb (4% to 7%)",
  "hard-climb": "Hard climb (7% to 10%)",
  "very-steep-climb": "Very steep climb (≥ 10%)",
  unknown: "Unknown (no elevation data)",
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
