import {
  DESCENT_LOCAL_KEY_SEVERITY_ORDER,
  type DescentLocalKey,
} from "../../navigation/routeFeatures.ts";
import {
  DESCENT_LOCAL_COLOUR_NAMES,
  DESCENT_LOCAL_LABELS,
  DESCENT_LOCAL_RANGE_LABELS,
  MICRO_DETAIL_COLOURS,
} from "../../navigation/routeFeaturePalette.ts";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";

export interface DescentLocalLegendProps {
  /** Which of the 3 descent local bands plus "neutral" are actually
   * present in the currently-shown selected/active descent, so the legend
   * only lists entries that mean something right now. */
  presentDescentLocalKeys: ReadonlySet<DescentLocalKey>;
}

/**
 * The detailed local-gradient legend for a selected or currently active
 * descent — the DescentLocalKey counterpart of ClimbGradientBandLegend.
 * A visible coloured line sample plus three separate text pieces (name,
 * exact grade range, human colour name) per key, so nothing here relies on
 * colour alone. All three pieces come from routeFeaturePalette.ts's own
 * authoritative maps, never a second copy. Deliberately static content
 * with no live-region role and no focusable descendants.
 */
export function DescentLocalLegend({ presentDescentLocalKeys }: DescentLocalLegendProps) {
  const entries = DESCENT_LOCAL_KEY_SEVERITY_ORDER.filter((key) =>
    presentDescentLocalKeys.has(key),
  );
  if (entries.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Detailed descent gradient legend" className="gradient-legend">
      {entries.map((key) => (
        <li key={key} className="gradient-legend-entry">
          <GradientColourSwatch colour={MICRO_DETAIL_COLOURS[key]} />
          {DESCENT_LOCAL_LABELS[key]} · {DESCENT_LOCAL_RANGE_LABELS[key]} ·{" "}
          {DESCENT_LOCAL_COLOUR_NAMES[key]}
        </li>
      ))}
    </ul>
  );
}
