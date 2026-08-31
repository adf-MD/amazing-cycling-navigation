import type { MapMarkerSpec } from "./mapMarkerTypes.ts";

const BASE_CLASS = "planning-waypoint-marker";

const ROLE_MODIFIER_CLASS: Readonly<Record<MapMarkerSpec["role"], string | null>> = {
  ordinary: null,
  start: `${BASE_CLASS}--start`,
  finish: `${BASE_CLASS}--finish`,
  "start-finish": `${BASE_CLASS}--start-finish`,
};

/** Every role modifier class this module ever applies — used to clear a
 * stale one on re-render without touching any other class. */
const ALL_ROLE_MODIFIER_CLASSES: readonly string[] = Object.values(
  ROLE_MODIFIER_CLASS,
).filter((value): value is string => value !== null);

const SELECTED_CLASS = `${BASE_CLASS}--selected`;

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
 * its id changing. Uses classList.add/remove for exactly this module's
 * own classes, never a wholesale `className =` assignment — maplibregl's
 * own Marker adds its own classes (e.g. "maplibregl-marker", which
 * supplies the position:absolute this element depends on) once at
 * construction time via classList.add, and re-rendering an
 * already-constructed marker must never wipe those out.
 */
export function renderWaypointMarkerElement(
  element: HTMLElement,
  spec: MapMarkerSpec,
): void {
  element.classList.add(BASE_CLASS);
  element.classList.remove(...ALL_ROLE_MODIFIER_CLASSES, SELECTED_CLASS);
  const roleClass = ROLE_MODIFIER_CLASS[spec.role];
  if (roleClass) element.classList.add(roleClass);
  if (spec.selected) element.classList.add(SELECTED_CLASS);
  element.textContent = spec.label;
  element.setAttribute("aria-label", spec.ariaLabel);
}
