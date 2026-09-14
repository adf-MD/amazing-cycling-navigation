import { useTranslate } from "../../i18n/useTranslate.ts";
import type { ClimbGradientBand } from "../../navigation/routeFeatures.ts";
import type { RouteFeatureVisualKey } from "../../navigation/routeFeaturePalette.ts";
import { ClimbGradientBandLegend } from "./ClimbGradientBandLegend.tsx";
import { RouteFeatureLegend } from "./RouteFeatureLegend.tsx";

export interface GradientColoursDisclosureProps {
  presentClimbBands: ReadonlySet<ClimbGradientBand>;
  presentVisualKeys: ReadonlySet<RouteFeatureVisualKey>;
}

/**
 * A shared, collapsed-by-default "Gradient colours" disclosure, shown
 * immediately below the elevation chart in both Planning and Riding —
 * explains both presentation levels (see CLAUDE.md): the default macro
 * climb/descent colouring, and the detailed local-gradient colouring
 * shown only for a selected or currently-occupied feature. The first
 * `<details>` disclosure in this codebase — the native element is used
 * deliberately rather than a custom `aria-expanded` button, since it
 * gives correct collapsed-by-default state, keyboard operation, and a
 * clearly associated panel for free, with no risk of reimplementing any
 * of that incorrectly. Renders nothing (not even the outer `<details>`)
 * when both sections would be empty, matching ClimbGradientBandLegend's
 * and RouteFeatureLegend's own "nothing to show yet" convention. Only
 * climb bands are shown in the "Detailed local gradient" section — a
 * selected/active descent reuses the exact same three blues already
 * shown in the macro section above, applied locally (see routeFeatures.ts
 * — descent macro and local classification are literally the same
 * scheme, unlike a climb's macro category and local band, which are
 * mathematically different despite sharing colour tokens), so a second,
 * duplicate set of descent rows here would read as a copy-paste bug.
 */
export function GradientColoursDisclosure({
  presentClimbBands,
  presentVisualKeys,
}: GradientColoursDisclosureProps) {
  const { t } = useTranslate();
  if (presentClimbBands.size === 0 && presentVisualKeys.size === 0) {
    return null;
  }

  return (
    <details className="gradient-colours-disclosure">
      <summary>{t("legend.gradientColours")}</summary>
      <section aria-label={t("legend.recognisedRouteFeatures")}>
        <p>{t("legend.macroExplanation")}</p>
        <RouteFeatureLegend presentVisualKeys={presentVisualKeys} />
      </section>
      <section aria-label={t("legend.detailedLocalGradient")}>
        <p>{t("legend.localExplanation")}</p>
        <ClimbGradientBandLegend presentClimbBands={presentClimbBands} />
      </section>
    </details>
  );
}
