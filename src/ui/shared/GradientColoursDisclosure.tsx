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
  if (presentClimbBands.size === 0 && presentVisualKeys.size === 0) {
    return null;
  }

  return (
    <details className="gradient-colours-disclosure">
      <summary>Gradient colours</summary>
      <section aria-label="Recognised route features">
        <p>
          Overall climb colours depend on climb length and average gradient. Recognised
          descents use one of three blues based on average gradient and are specific to
          this app.
        </p>
        <RouteFeatureLegend presentVisualKeys={presentVisualKeys} />
      </section>
      <section aria-label="Detailed local gradient">
        <p>
          Detailed colours show local gradient over approximately 100 m within the
          selected or currently active climb. Brief flat or descending sections inside a
          climb are green. A selected or currently active descent reuses the same three
          blues shown above, applied to its local sections instead of its whole length —
          any locally shallow stretch there shows the plain route colour instead.
        </p>
        <ClimbGradientBandLegend presentClimbBands={presentClimbBands} />
      </section>
    </details>
  );
}
