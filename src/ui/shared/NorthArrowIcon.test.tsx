import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NorthArrowIcon } from "./NorthArrowIcon.tsx";
import { DART_PATH, NORTH_LETTER_PATH } from "./northArrowGeometry.ts";

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
    // 38px, not item 110's original 22px: the upright letter must fit the
    // largest disc inside the dart, which is what the box size buys.
    expect(renderArrow(0)).toHaveAttribute("width", "38");
    expect(renderArrow(0)).toHaveAttribute("height", "38");
    const { container } = render(<NorthArrowIcon bearingDegrees={0} sizePx={30} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "30");
  });
  // ---- item 110 presentation follow-up ----

  /** The two drawn shapes, located by role in the markup rather than by
   * index, so a reordering cannot silently swap what is asserted. */
  function shapesOf(bearingDegrees: number | null, isPressed = false) {
    const { container } = render(
      <NorthArrowIcon bearingDegrees={bearingDegrees} isPressed={isPressed} />,
    );
    const svg = container.querySelector("svg");
    const dart = container.querySelector(`path[d="${DART_PATH}"]`);
    const letter = container.querySelector(`path[d="${NORTH_LETTER_PATH}"]`);
    if (!svg || !dart || !letter) {
      throw new Error("expected the icon to render both the dart and the letter");
    }
    const letterGroup = letter.parentElement;
    if (letterGroup?.tagName.toLowerCase() !== "g") {
      throw new Error("expected the letter to sit in its own <g>");
    }
    return { svg, dart, letter, letterGroup };
  }

  describe("the upright N (item 110 presentation follow-up)", () => {
    it("keeps the shipped dart silhouette exactly", () => {
      // Asserted against the literal shape, not against the constant the
      // component draws from — comparing a constant with itself would
      // follow any edit to it and catch nothing. The follow-up may
      // enlarge and annotate the pointer; it may not reshape it.
      expect(shapesOf(0).dart).toHaveAttribute("d", "M12 3 L19 20.5 L12 16 L5 20.5 Z");
    });

    it("draws the letter, rather than setting it as text", () => {
      const { svg, letter } = shapesOf(0);
      // Text would be font-dependent — the very inconsistency this
      // follow-up removes — and would also show up as button text.
      expect(letter.tagName.toLowerCase()).toBe("path");
      expect(svg.querySelector("text")).toBeNull();
      expect(svg.textContent).toBe("");
    });

    it("counter-rotates the letter so it stays upright as the dart turns", () => {
      for (const bearing of [45, 90, 137, 180, 270, 359]) {
        const { svg, letterGroup } = shapesOf(bearing);
        // The outer svg still carries item 110's own rotation, unchanged...
        expect(svg.style.transform).toBe(`rotate(-${String(bearing)}deg)`);
        // ...and the group cancels it about the identical centre.
        expect(letterGroup).toHaveAttribute(
          "transform",
          `rotate(${String(bearing)} 12 12)`,
        );
      }
    });

    it("normalises a negative bearing into the same cancelling pair", () => {
      const { svg, letterGroup } = shapesOf(-90);
      expect(svg.style.transform).toBe("rotate(-270deg)");
      expect(letterGroup).toHaveAttribute("transform", "rotate(270 12 12)");
    });

    it("applies no rotation at all when the bearing is unknown or north-up", () => {
      for (const bearing of [0, null, Number.NaN]) {
        const { svg, letterGroup } = shapesOf(bearing);
        expect(svg.style.transform).toBe("rotate(0deg)");
        expect(letterGroup).toHaveAttribute("transform", "rotate(0 12 12)");
      }
    });

    it("inverts the colour pairing with the control's pressed state", () => {
      // Idle: dark pointer (currentColor) with a light letter.
      const idle = shapesOf(0, false);
      expect(idle.svg).toHaveAttribute("fill", "currentColor");
      expect(idle.letter).toHaveAttribute("fill", "var(--colour-bg)");

      // Pressed: the control paints white on accent, so the pointer
      // becomes light and the letter takes the accent.
      const pressed = shapesOf(0, true);
      expect(pressed.svg).toHaveAttribute("fill", "currentColor");
      expect(pressed.letter).toHaveAttribute("fill", "var(--colour-accent)");
    });

    it("resolves its own colours, so no call site passes one", () => {
      // The component takes a semantic flag only. Guards against the
      // three screens drifting apart on colour.
      const pressed = shapesOf(0, true);
      const idle = shapesOf(0, false);
      expect(pressed.letter.getAttribute("fill")).not.toBe(
        idle.letter.getAttribute("fill"),
      );
    });

    it("gives the letter no background shape of its own", () => {
      const { svg, letterGroup } = shapesOf(90);
      // No badge, disc or halo: the letter's group holds exactly the
      // one letter path and nothing else.
      expect(letterGroup.children).toHaveLength(1);
      expect(svg.querySelectorAll("circle")).toHaveLength(0);
      expect(svg.querySelectorAll("rect")).toHaveLength(0);
    });

    it("stays a single svg, which the browser locators depend on", () => {
      const { container } = render(<NorthArrowIcon bearingDegrees={90} />);
      expect(container.querySelectorAll("svg")).toHaveLength(1);
    });

    it("defaults to not pressed, so existing call sites keep the idle pairing", () => {
      const { container } = render(<NorthArrowIcon bearingDegrees={0} />);
      expect(container.querySelector(`path[d="${NORTH_LETTER_PATH}"]`)).toHaveAttribute(
        "fill",
        "var(--colour-bg)",
      );
    });
  });
});
