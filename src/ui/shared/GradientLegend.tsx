import type { GradientClass } from "../../navigation/gradient.ts";
import {
  GRADIENT_CLASS_COLOURS,
  GRADIENT_CLASS_LABELS,
  GRADIENT_CLASS_ORDER,
  GRADIENT_CLASS_SYMBOLS,
} from "../../navigation/gradientPalette.ts";

export interface GradientLegendProps {
  /** Which classes are actually present in the route/window currently
   * shown, so the legend only lists entries that mean something right now
   * — never all eight regardless of context, and never one entry per
   * micro-segment (there are at most eight classes in total). */
  presentClasses: ReadonlySet<GradientClass>;
}

/**
 * A compact, shared gradient legend: colour swatch plus a text label
 * (carrying the exact grade range) plus a plain-glyph symbol per class —
 * the text label is the authoritative, accessible differentiator; colour
 * and glyph are secondary quick-scan cues, so nothing here relies on
 * colour alone. Deliberately static content with no live-region role and
 * no focusable descendants, so it never spams a screen reader or the tab
 * order.
 */
export function GradientLegend({ presentClasses }: GradientLegendProps) {
  const entries = GRADIENT_CLASS_ORDER.filter((gradientClass) =>
    presentClasses.has(gradientClass),
  );
  if (entries.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Gradient legend" className="gradient-legend">
      {entries.map((gradientClass) => (
        <li key={gradientClass} className="gradient-legend-entry">
          <span
            aria-hidden="true"
            className="gradient-legend-swatch"
            style={{ backgroundColor: GRADIENT_CLASS_COLOURS[gradientClass] }}
          />
          <span aria-hidden="true">{GRADIENT_CLASS_SYMBOLS[gradientClass]} </span>
          {GRADIENT_CLASS_LABELS[gradientClass]}
        </li>
      ))}
    </ul>
  );
}
