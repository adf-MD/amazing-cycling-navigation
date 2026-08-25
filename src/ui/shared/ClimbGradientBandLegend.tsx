import {
  CLIMB_GRADIENT_BAND_SEVERITY_ORDER,
  type ClimbGradientBand,
} from "../../navigation/routeFeatures.ts";
import {
  CLIMB_GRADIENT_BAND_COLOUR_NAMES,
  CLIMB_GRADIENT_BAND_LABELS,
  CLIMB_GRADIENT_BAND_RANGE_LABELS,
  MICRO_DETAIL_COLOURS,
} from "../../navigation/routeFeaturePalette.ts";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";

export interface ClimbGradientBandLegendProps {
  /** Which of the 5 Garmin-style local climb bands are actually present
   * in the currently-shown selected/active climb, so the legend only
   * lists entries that mean something right now. */
  presentClimbBands: ReadonlySet<ClimbGradientBand>;
  /** "full" (default) shows swatch + band name + exact grade range + human
   * colour name, for Settings' complete educational palette. "compact"
   * shows only the swatch + grade range — the range text is itself the
   * non-colour semantic information a glance needs (backlog item 79) —
   * for a selected-feature card that doesn't need the full explanation. */
  variant?: "full" | "compact";
}

/**
 * The detailed, Garmin-ClimbPro-inspired green-to-dark-red local-gradient
 * legend for a selected or currently active climb — a visible coloured
 * line sample plus, in "full" variant, two further text pieces (name,
 * human colour name) alongside the exact grade range, so nothing here
 * relies on colour alone. All text comes from routeFeaturePalette.ts's own
 * authoritative maps, never a second copy. Deliberately static content
 * with no live-region role and no focusable descendants. Descents reuse
 * the same three macro descent colours locally (see RouteFeatureLegend.tsx)
 * rather than a second set of rows here — see GradientColoursDisclosure.tsx's
 * own explanatory text.
 */
export function ClimbGradientBandLegend({
  presentClimbBands,
  variant = "full",
}: ClimbGradientBandLegendProps) {
  const entries = CLIMB_GRADIENT_BAND_SEVERITY_ORDER.filter((band) =>
    presentClimbBands.has(band),
  );
  if (entries.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Detailed climb gradient legend" className="gradient-legend">
      {entries.map((band) => (
        <li key={band} className="gradient-legend-entry">
          <GradientColourSwatch colour={MICRO_DETAIL_COLOURS[band]} />
          {variant === "full" ? (
            <>
              {CLIMB_GRADIENT_BAND_LABELS[band]} ·{" "}
              {CLIMB_GRADIENT_BAND_RANGE_LABELS[band]} ·{" "}
              {CLIMB_GRADIENT_BAND_COLOUR_NAMES[band]}
            </>
          ) : (
            CLIMB_GRADIENT_BAND_RANGE_LABELS[band]
          )}
        </li>
      ))}
    </ul>
  );
}
