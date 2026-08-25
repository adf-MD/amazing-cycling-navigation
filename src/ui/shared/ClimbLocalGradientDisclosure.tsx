import type { ClimbGradientBand } from "../../navigation/routeFeatures.ts";
import { ClimbGradientBandLegend } from "./ClimbGradientBandLegend.tsx";

export interface ClimbLocalGradientDisclosureProps {
  /** Which of the 5 Garmin-style local climb bands are actually present in
   * the selected climb, so the legend only lists entries that mean
   * something right now. */
  presentClimbBands: ReadonlySet<ClimbGradientBand>;
}

/**
 * The selected-climb-scoped counterpart of GradientColoursDisclosure's old
 * combined "Detailed local gradient" section (backlog item 78) — a small,
 * collapsed-by-default disclosure rendered next to the one climb it
 * actually describes, rather than in a shared overview legend. Renders
 * nothing (not even the outer `<details>`) when presentClimbBands is
 * empty, matching this codebase's established "nothing to show yet"
 * convention (GradientColoursDisclosure, ClimbCategoriesDisclosure,
 * ClimbGradientBandLegend).
 */
export function ClimbLocalGradientDisclosure({
  presentClimbBands,
}: ClimbLocalGradientDisclosureProps) {
  if (presentClimbBands.size === 0) {
    return null;
  }

  return (
    <details className="local-gradient-disclosure">
      <summary>Gradient colours on this climb</summary>
      <p>
        Detailed colours show local gradient over approximately 100 m within this climb.
        Brief flat or descending sections are green.
      </p>
      <ClimbGradientBandLegend presentClimbBands={presentClimbBands} />
    </details>
  );
}
