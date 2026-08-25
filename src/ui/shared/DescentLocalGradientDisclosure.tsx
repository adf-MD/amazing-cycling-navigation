import type { DescentLocalKey } from "../../navigation/routeFeatures.ts";
import { DescentLocalLegend } from "./DescentLocalLegend.tsx";

export interface DescentLocalGradientDisclosureProps {
  /** Which of the 3 descent local bands plus "neutral" are actually
   * present in the selected descent, so the legend only lists entries
   * that mean something right now. */
  presentDescentLocalKeys: ReadonlySet<DescentLocalKey>;
}

/**
 * The selected-descent-scoped counterpart of ClimbLocalGradientDisclosure
 * (backlog item 78) — a small, collapsed-by-default disclosure rendered
 * next to the one descent it actually describes. Renders nothing (not
 * even the outer `<details>`) when presentDescentLocalKeys is empty,
 * matching this codebase's established "nothing to show yet" convention.
 */
export function DescentLocalGradientDisclosure({
  presentDescentLocalKeys,
}: DescentLocalGradientDisclosureProps) {
  if (presentDescentLocalKeys.size === 0) {
    return null;
  }

  return (
    <details className="local-gradient-disclosure">
      <summary>Gradient colours on this descent</summary>
      <p>
        Detailed colours show local gradient over approximately 100 m within this descent,
        using the same three blues as a recognised descent generally, applied to short
        local sections rather than the descent&apos;s whole length. Any locally shallow
        stretch shows the plain route colour instead. Blue intensity reflects gradient
        steepness only, not surface, bends, traffic or other conditions.
      </p>
      <DescentLocalLegend presentDescentLocalKeys={presentDescentLocalKeys} />
    </details>
  );
}
