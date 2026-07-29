import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";

describe("GradientColourSwatch", () => {
  it("renders the exact given colour", () => {
    const { container } = render(<GradientColourSwatch colour="#d55e00" />);
    const swatch = container.querySelector(".gradient-colour-swatch");
    expect(swatch).toHaveStyle({ backgroundColor: "#d55e00" });
  });

  it("declares a non-zero, line-like width and height", () => {
    const { container } = render(<GradientColourSwatch colour="#5b3fa6" />);
    const swatch = container.querySelector(".gradient-colour-swatch");
    expect(swatch).toHaveStyle({ width: "32px", height: "8px" });
  });

  it("always carries a border, even for a very light colour", () => {
    const { container } = render(<GradientColourSwatch colour="#c5e1a5" />);
    const swatch = container.querySelector(".gradient-colour-swatch");
    // jsdom does not expand a `border` shorthand containing var() into
    // borderWidth/borderStyle sub-properties, so the shorthand itself is
    // what's actually testable here.
    expect(swatch?.getAttribute("style")).toContain(
      "border: 1px solid var(--colour-border)",
    );
  });

  it("is decorative, not part of the accessible tree", () => {
    const { container } = render(<GradientColourSwatch colour="#fdd835" />);
    const swatch = container.querySelector(".gradient-colour-swatch");
    expect(swatch).toHaveAttribute("aria-hidden", "true");
  });
});
