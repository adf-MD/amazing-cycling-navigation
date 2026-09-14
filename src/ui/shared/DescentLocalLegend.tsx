import { useTranslate } from "../../i18n/useTranslate.ts";
import {
  DESCENT_LOCAL_KEY_SEVERITY_ORDER,
  type DescentLocalKey,
} from "../../navigation/routeFeatures.ts";
import {
  DESCENT_LOCAL_COLOUR_NAME_KEYS,
  DESCENT_LOCAL_LABEL_KEYS,
  DESCENT_LOCAL_RANGE_LABEL_KEYS,
  MICRO_DETAIL_COLOURS,
} from "../../navigation/routeFeaturePalette.ts";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";

export interface DescentLocalLegendProps {
  /** Which of the 3 descent local bands plus "neutral" are actually
   * present in the currently-shown selected/active descent, so the legend
   * only lists entries that mean something right now. */
  presentDescentLocalKeys: ReadonlySet<DescentLocalKey>;
  /** "full" (default) shows swatch + band name + exact grade range + human
   * colour name, for Settings' complete educational palette. "compact"
   * shows only the swatch + grade range — the range text is itself the
   * non-colour semantic information a glance needs (backlog item 79) —
   * for a selected-feature card that doesn't need the full explanation. */
  variant?: "full" | "compact";
}

/**
 * The detailed local-gradient legend for a selected or currently active
 * descent — the DescentLocalKey counterpart of ClimbGradientBandLegend.
 * A visible coloured line sample plus, in "full" variant, two further text
 * pieces (name, human colour name) alongside the exact grade range, so
 * nothing here relies on colour alone. All text comes from
 * routeFeaturePalette.ts's own authoritative maps, never a second copy.
 * Deliberately static content with no live-region role and no focusable
 * descendants.
 */
export function DescentLocalLegend({
  presentDescentLocalKeys,
  variant = "full",
}: DescentLocalLegendProps) {
  const { t } = useTranslate();
  const entries = DESCENT_LOCAL_KEY_SEVERITY_ORDER.filter((key) =>
    presentDescentLocalKeys.has(key),
  );
  if (entries.length === 0) {
    return null;
  }

  return (
    <ul aria-label={t("legend.descentGradient")} className="gradient-legend">
      {entries.map((key) => (
        <li key={key} className="gradient-legend-entry">
          <GradientColourSwatch colour={MICRO_DETAIL_COLOURS[key]} />
          {variant === "full" ? (
            <>
              {t(DESCENT_LOCAL_LABEL_KEYS[key])} ·{" "}
              {t(DESCENT_LOCAL_RANGE_LABEL_KEYS[key])} ·{" "}
              {t(DESCENT_LOCAL_COLOUR_NAME_KEYS[key])}
            </>
          ) : (
            t(DESCENT_LOCAL_RANGE_LABEL_KEYS[key])
          )}
        </li>
      ))}
    </ul>
  );
}
