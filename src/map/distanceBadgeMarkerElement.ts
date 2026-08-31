import type { DistanceBadgeMarkerSpec } from "./mapMarkerTypes.ts";

const BASE_CLASS = "distance-badge-marker";

/**
 * A bare, non-interactive DOM element for one route-distance badge —
 * plain HTML styled entirely via CSS (see src/index.css's
 * .distance-badge-marker rules), never a MapLibre symbol/text layer, so
 * the numeric label has no glyph/sprite dependency and still renders
 * under the local fallback style. `role="img"` gives it a concise
 * accessible description (set on every render, see
 * renderDistanceBadgeElement) without making it a tab stop — badges are
 * orientation aids, never an interactive control.
 */
export function createDistanceBadgeElement(): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("role", "img");
  return element;
}

/**
 * Idempotently applies `spec` to a marker element created by
 * createDistanceBadgeElement — called on every setDistanceBadges pass
 * for every matched id, not just on creation, since a badge's label/
 * aria-label can change (a route recalculation shifting an interpolated
 * position, or a coincidence merge gaining/losing a member) without its
 * id changing. Uses classList.add for exactly this module's own class,
 * never a wholesale `className =` assignment — maplibregl's own Marker
 * adds its own classes (e.g. "maplibregl-marker", which supplies the
 * position:absolute this element depends on) once at construction time
 * via classList.add, and re-rendering an already-constructed marker must
 * never wipe those out.
 */
export function renderDistanceBadgeElement(
  element: HTMLElement,
  spec: DistanceBadgeMarkerSpec,
): void {
  element.classList.add(BASE_CLASS);
  element.textContent = `${spec.label} km`;
  element.setAttribute("aria-label", spec.ariaLabel);
}
