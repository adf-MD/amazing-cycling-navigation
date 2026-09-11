import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CrosshairIcon } from "./CrosshairIcon.tsx";

function renderIcon(sizePx?: number): SVGSVGElement {
  const { container } = render(
    sizePx === undefined ? <CrosshairIcon /> : <CrosshairIcon sizePx={sizePx} />,
  );
  const svg = container.querySelector("svg");
  if (!svg) {
    throw new Error("expected CrosshairIcon to render an <svg>");
  }
  return svg;
}

describe("CrosshairIcon", () => {
  it("renders at the agreed 22x22 box", () => {
    const svg = renderIcon();
    expect(svg).toHaveAttribute("width", "22");
    expect(svg).toHaveAttribute("height", "22");
  });

  // The stroke is expressed in user units, derived from the rendered
  // size, so the painted stroke is an exact 2px whatever the box —
  // unlike the text character it replaces, whose weight came from
  // whichever system font happened to carry it.
  it("paints a 2px stroke at its own size, and at any other", () => {
    const strokeAt = (sizePx: number) =>
      Number(renderIcon(sizePx).getAttribute("stroke-width")) * (sizePx / 24);
    expect(strokeAt(22)).toBeCloseTo(2, 6);
    expect(strokeAt(24)).toBeCloseTo(2, 6);
    expect(strokeAt(48)).toBeCloseTo(2, 6);
  });

  it("keeps the crosshair motif: a ring, a centre and four axis ticks", () => {
    const svg = renderIcon();
    // A ring plus a centre dot — not a pin, not a locate-fixed glyph,
    // and emphatically not anything resembling a direction of travel.
    expect(svg.querySelectorAll("circle")).toHaveLength(2);
    const ticks = svg.querySelector("path");
    if (!ticks) {
      throw new Error("expected the axis ticks to render");
    }
    const d = ticks.getAttribute("d") ?? "";
    // Four separate segments, one per axis, each starting a new subpath.
    expect(d.match(/M/g)).toHaveLength(4);
    // Purely vertical and horizontal: no diagonal, so it cannot read as
    // an arrow.
    expect(d).not.toMatch(/[lL]\s*-?\d/);
  });

  it("draws nothing outside its own box, so the round caps cannot clip", () => {
    const svg = renderIcon();
    const ticks = svg.querySelector("path");
    const d = ticks?.getAttribute("d") ?? "";
    const coordinates = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const strokeHalfUnits = Number(svg.getAttribute("stroke-width")) / 2;
    for (const value of coordinates) {
      expect(value - strokeHalfUnits).toBeGreaterThanOrEqual(0);
      expect(value + strokeHalfUnits).toBeLessThanOrEqual(24);
    }
  });

  it("takes the control's foreground colour", () => {
    expect(renderIcon()).toHaveAttribute("stroke", "currentColor");
    expect(renderIcon()).toHaveAttribute("fill", "none");
  });

  it("is hidden from assistive technology and unfocusable", () => {
    const svg = renderIcon();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg.querySelector("title")).toBeNull();
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
  });

  it("contributes no text content of its own", () => {
    expect(renderIcon().textContent).toBe("");
  });
});
