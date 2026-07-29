import type { GradientClass } from "../../navigation/gradient.ts";
import {
  GRADIENT_CLASS_COLOUR_NAMES,
  GRADIENT_CLASS_COLOURS,
  GRADIENT_CLASS_NAMES,
  GRADIENT_CLASS_ORDER,
  GRADIENT_CLASS_RANGE_LABELS,
  GRADIENT_CLASS_SYMBOLS,
} from "../../navigation/gradientPalette.ts";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";

export interface GradientLegendProps {
  /** Which classes are actually present in the route/window currently
   * shown, so the legend only lists entries that mean something right now
   * — never all eight regardless of context, and never one entry per
   * micro-segment (there are at most eight classes in total). */
  presentClasses: ReadonlySet<GradientClass>;
}

/**
 * A compact, shared gradient legend: a visible coloured line sample plus
 * a plain-glyph symbol plus three separate text pieces (name, exact grade
 * range, human colour name) per class — the text is the authoritative,
 * accessible differentiator; the swatch and glyph are secondary quick-scan
 * cues, so nothing here relies on colour alone. All four pieces come from
 * gradientPalette.ts's own authoritative maps, never a second copy.
 * Deliberately static content with no live-region role and no focusable
 * descendants, so it never spams a screen reader or the tab order.
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
          <GradientColourSwatch colour={GRADIENT_CLASS_COLOURS[gradientClass]} />
          <span aria-hidden="true">{GRADIENT_CLASS_SYMBOLS[gradientClass]} </span>
          {GRADIENT_CLASS_NAMES[gradientClass]} ·{" "}
          {GRADIENT_CLASS_RANGE_LABELS[gradientClass]} ·{" "}
          {GRADIENT_CLASS_COLOUR_NAMES[gradientClass]}
        </li>
      ))}
    </ul>
  );
}
