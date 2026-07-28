import type { MapMarkerSpec } from "./mapAdapter.ts";

const BASE_CLASS = "planning-waypoint-marker";

const ROLE_MODIFIER_CLASS: Readonly<Record<MapMarkerSpec["role"], string | null>> = {
  ordinary: null,
  start: `${BASE_CLASS}--start`,
  finish: `${BASE_CLASS}--finish`,
  "start-finish": `${BASE_CLASS}--start-finish`,
};

/**
 * A bare, non-interactive DOM element for one Planning waypoint marker —
 * plain HTML styled entirely via CSS (see src/index.css's
 * .planning-waypoint-marker rules), never a MapLibre symbol/text layer, so
 * the ordinal label has no glyph/sprite dependency and still renders under
 * the local fallback style. `role="img"` gives it a concise accessible
 * description (set on every render, see renderWaypointMarkerElement)
 * without making it a tab stop — waypoint selection stays a
 * WaypointList-only action (see PlanningScreen.tsx's documented map-tap
 * policy), so markers never need to be focusable or hit-testable.
 */
export function createWaypointMarkerElement(): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("role", "img");
  return element;
}

/**
 * Idempotently applies `spec` to a marker element created by
 * createWaypointMarkerElement — called on every setMarkers pass for every
 * matched id, not just on creation, since a waypoint's label/role/selected
 * state can change (reorder, selection, opening/closing a loop) without
 * its id changing.
 */
export function renderWaypointMarkerElement(
  element: HTMLElement,
  spec: MapMarkerSpec,
): void {
  const roleClass = ROLE_MODIFIER_CLASS[spec.role];
  element.className = [
    BASE_CLASS,
    roleClass,
    spec.selected ? `${BASE_CLASS}--selected` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");
  element.textContent = spec.label;
  element.setAttribute("aria-label", spec.ariaLabel);
}
