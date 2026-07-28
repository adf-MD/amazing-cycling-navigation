import { describe, expect, it } from "vitest";
import type { MapMarkerSpec } from "./mapAdapter.ts";
import {
  createWaypointMarkerElement,
  renderWaypointMarkerElement,
} from "./waypointMarkerElement.ts";

function buildSpec(overrides: Partial<MapMarkerSpec> = {}): MapMarkerSpec {
  return {
    id: "a",
    coordinate: [0, 51],
    label: "1",
    role: "ordinary",
    selected: false,
    ariaLabel: "Waypoint 1",
    ...overrides,
  };
}

describe("createWaypointMarkerElement", () => {
  it("creates a non-focusable, image-role element", () => {
    const element = createWaypointMarkerElement();
    expect(element.tagName).toBe("DIV");
    expect(element.getAttribute("role")).toBe("img");
    expect(element.hasAttribute("tabindex")).toBe(false);
  });
});

describe("renderWaypointMarkerElement", () => {
  it("renders an ordinary waypoint with just the base class", () => {
    const element = createWaypointMarkerElement();
    renderWaypointMarkerElement(
      element,
      buildSpec({ label: "3", ariaLabel: "Waypoint 3" }),
    );
    expect(element.className).toBe("planning-waypoint-marker");
    expect(element.textContent).toBe("3");
    expect(element.getAttribute("aria-label")).toBe("Waypoint 3");
    expect(element.hasAttribute("tabindex")).toBe(false);
  });

  it("renders a start waypoint with the start modifier", () => {
    const element = createWaypointMarkerElement();
    renderWaypointMarkerElement(
      element,
      buildSpec({ role: "start", label: "1", ariaLabel: "Start waypoint 1" }),
    );
    expect(element.className).toBe(
      "planning-waypoint-marker planning-waypoint-marker--start",
    );
  });

  it("renders a finish waypoint with the finish modifier", () => {
    const element = createWaypointMarkerElement();
    renderWaypointMarkerElement(
      element,
      buildSpec({ role: "finish", label: "6", ariaLabel: "Finish waypoint 6" }),
    );
    expect(element.className).toBe(
      "planning-waypoint-marker planning-waypoint-marker--finish",
    );
  });

  it("renders a combined start-finish waypoint with the start-finish modifier", () => {
    const element = createWaypointMarkerElement();
    renderWaypointMarkerElement(
      element,
      buildSpec({
        role: "start-finish",
        label: "1/6",
        ariaLabel: "Start and finish waypoints 1 and 6",
      }),
    );
    expect(element.className).toBe(
      "planning-waypoint-marker planning-waypoint-marker--start-finish",
    );
    expect(element.textContent).toBe("1/6");
  });

  it("adds the selected modifier alongside any role", () => {
    const element = createWaypointMarkerElement();
    renderWaypointMarkerElement(element, buildSpec({ role: "start", selected: true }));
    expect(element.className).toBe(
      "planning-waypoint-marker planning-waypoint-marker--start planning-waypoint-marker--selected",
    );
  });

  it("re-renders in place, updating class/text/aria-label without recreating the element", () => {
    const element = createWaypointMarkerElement();
    renderWaypointMarkerElement(element, buildSpec({ role: "ordinary", label: "2" }));
    renderWaypointMarkerElement(
      element,
      buildSpec({
        role: "finish",
        label: "6",
        selected: true,
        ariaLabel: "Finish waypoint 6",
      }),
    );
    expect(element.className).toBe(
      "planning-waypoint-marker planning-waypoint-marker--finish planning-waypoint-marker--selected",
    );
    expect(element.textContent).toBe("6");
    expect(element.getAttribute("aria-label")).toBe("Finish waypoint 6");
  });
});
