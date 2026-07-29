import { describe, expect, it } from "vitest";
import type { DistanceBadgeMarkerSpec } from "./mapAdapter.ts";
import {
  createDistanceBadgeElement,
  renderDistanceBadgeElement,
} from "./distanceBadgeMarkerElement.ts";

function buildSpec(
  overrides: Partial<DistanceBadgeMarkerSpec> = {},
): DistanceBadgeMarkerSpec {
  return {
    id: "distance-badge-5",
    coordinate: [0, 51],
    label: "5",
    ariaLabel: "5 kilometres from route start",
    ...overrides,
  };
}

describe("createDistanceBadgeElement", () => {
  it("creates a non-focusable, image-role element", () => {
    const element = createDistanceBadgeElement();
    expect(element.tagName).toBe("DIV");
    expect(element.getAttribute("role")).toBe("img");
    expect(element.hasAttribute("tabindex")).toBe(false);
  });
});

describe("renderDistanceBadgeElement", () => {
  it("renders the base class, a 'X km' label and the full aria-label", () => {
    const element = createDistanceBadgeElement();
    renderDistanceBadgeElement(element, buildSpec());
    expect(element.className).toBe("distance-badge-marker");
    expect(element.textContent).toBe("5 km");
    expect(element.getAttribute("aria-label")).toBe("5 kilometres from route start");
    expect(element.hasAttribute("tabindex")).toBe(false);
  });

  it("renders a merged multi-value label unchanged (the caller supplies the joined text)", () => {
    const element = createDistanceBadgeElement();
    renderDistanceBadgeElement(
      element,
      buildSpec({
        id: "distance-badge-10-30",
        label: "10 / 30",
        ariaLabel: "10 and 30 kilometres from route start",
      }),
    );
    expect(element.textContent).toBe("10 / 30 km");
    expect(element.getAttribute("aria-label")).toBe(
      "10 and 30 kilometres from route start",
    );
  });

  it("re-renders in place, updating text/aria-label without recreating the element", () => {
    const element = createDistanceBadgeElement();
    renderDistanceBadgeElement(element, buildSpec({ label: "5" }));
    renderDistanceBadgeElement(
      element,
      buildSpec({ label: "10", ariaLabel: "10 kilometres from route start" }),
    );
    expect(element.textContent).toBe("10 km");
    expect(element.getAttribute("aria-label")).toBe("10 kilometres from route start");
  });

  // Regression test: maplibregl.Marker's own constructor adds classes
  // (e.g. "maplibregl-marker", which supplies the position: absolute this
  // element depends on) once via classList.add, before/around this
  // module's own rendering. A re-render must never wipe those out via a
  // wholesale `className =` assignment.
  it("preserves classes it did not itself add across a re-render", () => {
    const element = createDistanceBadgeElement();
    renderDistanceBadgeElement(element, buildSpec());
    element.classList.add("maplibregl-marker", "maplibregl-marker-anchor-center");

    renderDistanceBadgeElement(element, buildSpec({ label: "10" }));

    expect(element.classList.contains("maplibregl-marker")).toBe(true);
    expect(element.classList.contains("maplibregl-marker-anchor-center")).toBe(true);
    expect(element.classList.contains("distance-badge-marker")).toBe(true);
    expect(element.textContent).toBe("10 km");
  });
});
