import type { ClimbGradientBand } from "../../navigation/routeFeatures.ts";
import { ClimbGradientBandLegend } from "./ClimbGradientBandLegend.tsx";

export interface ClimbLocalGradientDisclosureProps {
  /** Which of the 5 Garmin-style local climb bands are actually present in
   * the selected climb, so the legend only lists entries that mean
   * something right now. */
  presentClimbBands: ReadonlySet<ClimbGradientBand>;
}

/**
 * The selected-climb-scoped compact local-gradient key (backlog item 79,
 * replacing item 78's fuller per-feature explanation) — a small,
 * collapsed-by-default disclosure rendered next to the one climb it
 * actually describes, showing only a swatch and the exact grade range per
 * present band (the range text is itself the non-colour semantic
 * information a glance needs). The complete educational explanation, with
 * band names and colour names, lives only in Settings' "Local gradient
 * colours" disclosure now. Renders nothing (not even the outer
 * `<details>`) when presentClimbBands is empty, matching this codebase's
 * established "nothing to show yet" convention (GradientColoursDisclosure,
 * ClimbCategoriesDisclosure, ClimbGradientBandLegend).
 */
export function ClimbLocalGradientDisclosure({
  presentClimbBands,
}: ClimbLocalGradientDisclosureProps) {
  if (presentClimbBands.size === 0) {
    return null;
  }

  return (
    <details className="local-gradient-disclosure">
      <summary>Local gradient colours on this climb</summary>
      <ClimbGradientBandLegend presentClimbBands={presentClimbBands} variant="compact" />
    </details>
  );
}
