import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NorthArrowIcon } from "./NorthArrowIcon.tsx";

/** The rendered glyph, located the same way a screen-level test would —
 * by role-independent structure rather than a test id, since the icon is
 * deliberately invisible to assistive technology. */
function renderArrow(bearingDegrees: number | null): SVGSVGElement {
  const { container } = render(<NorthArrowIcon bearingDegrees={bearingDegrees} />);
  const svg = container.querySelector("svg");
  if (!svg) {
    throw new Error("expected NorthArrowIcon to render an <svg>");
  }
  return svg;
}

function rotationOf(bearingDegrees: number | null): string {
  return renderArrow(bearingDegrees).style.transform;
}

describe("NorthArrowIcon", () => {
  // The four screen-relative cardinal cases item 110 is specified
  // against. The arrow art points up at 0 degrees and CSS rotation is
  // clockwise-positive, while a map bearing names the compass direction
  // drawn at the top of the screen — so the rotation is the negation.
  describe("screen-relative cardinal directions", () => {
    it("points up when the map is north-up", () => {
      expect(rotationOf(0)).toBe("rotate(0deg)");
    });

    it("points left when the map bearing is 90 (east is up)", () => {
      expect(rotationOf(90)).toBe("rotate(-90deg)");
    });

    it("points down when the map bearing is 180 (south is up)", () => {
      expect(rotationOf(180)).toBe("rotate(-180deg)");
    });

    it("points right for both 270 and -90 (west is up)", () => {
      expect(rotationOf(270)).toBe("rotate(-270deg)");
      expect(rotationOf(-90)).toBe("rotate(-270deg)");
      expect(rotationOf(-90)).toBe(rotationOf(270));
    });
  });

  it("normalises a bearing beyond one full revolution", () => {
    expect(rotationOf(360)).toBe("rotate(0deg)");
    expect(rotationOf(450)).toBe(rotationOf(90));
    expect(rotationOf(-450)).toBe(rotationOf(270));
  });

  // The defensive boundary, not the first line of defence — the camera
  // hooks already normalise at their own reducer boundary. A missing or
  // non-finite value must still produce a valid declaration rather than
  // rotate(NaNdeg), which browsers drop silently.
  describe("the safe north-up fallback", () => {
    it("renders unrotated, not hidden, when no bearing is known", () => {
      const svg = renderArrow(null);
      expect(svg.style.transform).toBe("rotate(0deg)");
      expect(svg).toBeInTheDocument();
    });

    it("renders unrotated for a non-finite bearing", () => {
      expect(rotationOf(Number.NaN)).toBe("rotate(0deg)");
      expect(rotationOf(Number.POSITIVE_INFINITY)).toBe("rotate(0deg)");
      expect(rotationOf(Number.NEGATIVE_INFINITY)).toBe("rotate(0deg)");
    });

    it("never emits a NaN rotation", () => {
      for (const bearing of [Number.NaN, Number.POSITIVE_INFINITY, null]) {
        expect(rotationOf(bearing)).not.toContain("NaN");
      }
    });
  });

  it("is hidden from assistive technology and unfocusable", () => {
    const svg = renderArrow(45);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    // Nothing inside it may carry an accessible name of its own — the
    // hosting button's aria-label is the only accessible name.
    expect(svg.querySelector("title")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
    expect(svg.getAttribute("role")).toBeNull();
  });

  // Item 110 negative control 5. A 48px circular control is rotationally
  // symmetric, so a bounding-box or border assertion would look identical
  // whether the svg or the whole button were rotated. Asserting BOTH
  // halves — that the wrapper carries no transform and the svg carries
  // the expected one — is what makes moving the transform onto the button
  // fail reliably rather than silently pass.
  it("puts the rotation on the glyph alone, never on its host", () => {
    const { container } = render(
      <button type="button" aria-label="North-up, top-down view" aria-pressed={false}>
        <NorthArrowIcon bearingDegrees={90} />
      </button>,
    );
    const button = container.querySelector("button");
    const svg = container.querySelector("svg");
    if (!button || !svg) {
      throw new Error("expected both the host button and the glyph to render");
    }
    expect(button.style.transform).toBe("");
    expect(svg.style.transform).toBe("rotate(-90deg)");
  });

  it("inherits the control's colour so the pressed state needs no second rule", () => {
    const svg = renderArrow(0);
    expect(svg).toHaveAttribute("fill", "currentColor");
  });

  it("renders at the default size, overridable for a different control", () => {
    expect(renderArrow(0)).toHaveAttribute("width", "22");
    const { container } = render(<NorthArrowIcon bearingDegrees={0} sizePx={30} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "30");
  });
});
