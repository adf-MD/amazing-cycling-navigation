import type { GradientClass } from "../../navigation/gradient.ts";
import type { RouteFeatureVisualKey } from "../../navigation/routeFeaturePalette.ts";
import { GradientLegend } from "./GradientLegend.tsx";
import { RouteFeatureLegend } from "./RouteFeatureLegend.tsx";

export interface GradientColoursDisclosureProps {
  presentClasses: ReadonlySet<GradientClass>;
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
 * when both sections would be empty, matching GradientLegend's and
 * RouteFeatureLegend's own "nothing to show yet" convention.
 */
export function GradientColoursDisclosure({
  presentClasses,
  presentVisualKeys,
}: GradientColoursDisclosureProps) {
  if (presentClasses.size === 0 && presentVisualKeys.size === 0) {
    return null;
  }

  return (
    <details className="gradient-colours-disclosure">
      <summary>Gradient colours</summary>
      <section aria-label="Recognised route features">
        <p>
          Overall climb colours consider both length and average gradient. Descent colours
          describe average gradient and are specific to this app.
        </p>
        <RouteFeatureLegend presentVisualKeys={presentVisualKeys} />
      </section>
      <section aria-label="Detailed local gradient">
        <p>
          Detailed colours show local gradient calculated over approximately 100 m. They
          appear for the selected or currently active climb or descent.
        </p>
        <GradientLegend presentClasses={presentClasses} />
      </section>
    </details>
  );
}
