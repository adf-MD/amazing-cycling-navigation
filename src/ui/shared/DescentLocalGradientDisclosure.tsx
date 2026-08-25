import type { DescentLocalKey } from "../../navigation/routeFeatures.ts";
import { DescentLocalLegend } from "./DescentLocalLegend.tsx";

export interface DescentLocalGradientDisclosureProps {
  /** Which of the 3 descent local bands plus "neutral" are actually
   * present in the selected descent, so the legend only lists entries
   * that mean something right now. */
  presentDescentLocalKeys: ReadonlySet<DescentLocalKey>;
}

/**
 * The selected-descent-scoped compact local-gradient key (backlog item 79,
 * replacing item 78's fuller per-feature explanation) — the DescentLocalKey
 * counterpart of ClimbLocalGradientDisclosure, showing only a swatch and
 * the exact grade range per present key. The complete educational
 * explanation (band names, colour names, and the blue-intensity safety
 * limitation) lives only in Settings' "Local gradient colours" disclosure
 * now. Renders nothing (not even the outer `<details>`) when
 * presentDescentLocalKeys is empty, matching this codebase's established
 * "nothing to show yet" convention.
 */
export function DescentLocalGradientDisclosure({
  presentDescentLocalKeys,
}: DescentLocalGradientDisclosureProps) {
  if (presentDescentLocalKeys.size === 0) {
    return null;
  }

  return (
    <details className="local-gradient-disclosure">
      <summary>Local gradient colours on this descent</summary>
      <DescentLocalLegend
        presentDescentLocalKeys={presentDescentLocalKeys}
        variant="compact"
      />
    </details>
  );
}
