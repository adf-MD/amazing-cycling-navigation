import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ZoomIcon } from "./ZoomIcon.tsx";

function renderIcon(direction: "in" | "out", sizePx?: number): SVGSVGElement {
  const { container } = render(
    sizePx === undefined ? (
      <ZoomIcon direction={direction} />
    ) : (
      <ZoomIcon direction={direction} sizePx={sizePx} />
    ),
  );
  const svg = container.querySelector("svg");
  if (!svg) {
    throw new Error("expected ZoomIcon to render an <svg>");
  }
  return svg;
}

function pathOf(direction: "in" | "out"): string {
  return renderIcon(direction).querySelector("path")?.getAttribute("d") ?? "";
}

describe("ZoomIcon", () => {
  it("renders both directions at the agreed 24x24 box", () => {
    for (const direction of ["in", "out"] as const) {
      const svg = renderIcon(direction);
      expect(svg).toHaveAttribute("width", "24");
      expect(svg).toHaveAttribute("height", "24");
    }
  });

  it("keeps the plus and minus shapes", () => {
    // Minus: the horizontal bar alone. Plus: that same bar and a
    // vertical one.
    expect(pathOf("out")).toBe("M4 12 H20");
    expect(pathOf("in")).toBe("M4 12 H20 M12 4 V20");
  });

  // The whole reason these are one component: as text characters, "+"
  // and "−" (U+2212) are drawn to different weights in most system
  // fonts, and differently again between platforms.
  it("matches the two glyphs by construction, not by eye", () => {
    const plus = renderIcon("in");
    const minus = renderIcon("out");
    for (const attribute of ["stroke-width", "stroke-linecap", "stroke", "fill"]) {
      expect(plus.getAttribute(attribute)).toBe(minus.getAttribute(attribute));
    }
    // The plus is literally the minus with one more identical bar: its
    // path contains the minus's path verbatim, and the extra subpath
    // spans the same distance along its own axis.
    expect(pathOf("in").startsWith(pathOf("out"))).toBe(true);
    const spans = (d: string) =>
      (d.match(/M(-?[\d.]+) (-?[\d.]+) ([HV])(-?[\d.]+)/g) ?? []).map((segment) => {
        const parts = /M(-?[\d.]+) (-?[\d.]+) ([HV])(-?[\d.]+)/.exec(segment);
        if (!parts) throw new Error(`unparsed segment ${segment}`);
        const axis = parts[3];
        const from = Number(axis === "H" ? parts[1] : parts[2]);
        return Math.abs(Number(parts[4]) - from);
      });
    expect(spans(pathOf("in"))).toEqual([16, 16]);
    expect(spans(pathOf("out"))).toEqual([16]);
  });

  it("paints a constant stroke width at any rendered size", () => {
    const strokeAt = (sizePx: number) =>
      Number(renderIcon("in", sizePx).getAttribute("stroke-width")) * (sizePx / 24);
    expect(strokeAt(24)).toBeCloseTo(2.5, 6);
    expect(strokeAt(48)).toBeCloseTo(2.5, 6);
  });

  it("draws nothing outside its own box, so the round caps cannot clip", () => {
    const svg = renderIcon("in");
    const strokeHalfUnits = Number(svg.getAttribute("stroke-width")) / 2;
    for (const value of [4, 20]) {
      expect(value - strokeHalfUnits).toBeGreaterThanOrEqual(0);
      expect(value + strokeHalfUnits).toBeLessThanOrEqual(24);
    }
  });

  it("takes the control's foreground colour", () => {
    expect(renderIcon("in")).toHaveAttribute("stroke", "currentColor");
    expect(renderIcon("in")).toHaveAttribute("fill", "none");
  });

  it("is hidden from assistive technology and unfocusable", () => {
    for (const direction of ["in", "out"] as const) {
      const svg = renderIcon(direction);
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      expect(svg.querySelector("title")).toBeNull();
      expect(svg.getAttribute("aria-label")).toBeNull();
    }
  });

  it("contributes no text content of its own", () => {
    expect(renderIcon("in").textContent).toBe("");
    expect(renderIcon("out").textContent).toBe("");
  });
});
