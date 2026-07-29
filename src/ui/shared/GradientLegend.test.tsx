import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GradientLegend } from "./GradientLegend.tsx";
import type { GradientClass } from "../../navigation/gradient.ts";
import { GRADIENT_CLASS_COLOURS } from "../../navigation/gradientPalette.ts";

function classes(...values: GradientClass[]): ReadonlySet<GradientClass> {
  return new Set(values);
}

describe("GradientLegend", () => {
  it("renders nothing for an empty class set", () => {
    const { container } = render(<GradientLegend presentClasses={classes()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one entry per present class, in a fixed band order", () => {
    render(
      <GradientLegend presentClasses={classes("hard-climb", "flat", "steep-descent")} />,
    );
    const list = screen.getByRole("list", { name: "Gradient legend" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    // steep-descent, then flat, then hard-climb — the fixed severity order,
    // not the order classes were passed in.
    expect(items[0]?.textContent).toContain("Steep descent");
    expect(items[1]?.textContent).toContain("Flat");
    expect(items[2]?.textContent).toContain("Hard climb");
  });

  it("omits classes that are not present", () => {
    render(<GradientLegend presentClasses={classes("flat")} />);
    expect(screen.queryByText(/Hard climb/)).toBeNull();
    expect(screen.queryByText(/Unknown/)).toBeNull();
  });

  it("has no live-region role", () => {
    const { container } = render(<GradientLegend presentClasses={classes("flat")} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("has no focusable descendants", () => {
    render(<GradientLegend presentClasses={classes("flat", "hard-climb", "unknown")} />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("includes the category name, exact grade range and colour name in each row's text", () => {
    render(<GradientLegend presentClasses={classes("moderate-climb")} />);
    expect(screen.getByText(/Moderate climb/)).toBeInTheDocument();
    expect(screen.getByText(/4% to just below 7%/)).toBeInTheDocument();
    expect(screen.getByText(/brown/)).toBeInTheDocument();
  });

  it("renders a visible line sample for each row, coloured with the same token the classifier uses", () => {
    render(<GradientLegend presentClasses={classes("hard-climb")} />);
    const swatch = document.querySelector(".gradient-colour-swatch");
    expect(swatch).not.toBeNull();
    expect(swatch).toHaveStyle({ backgroundColor: GRADIENT_CLASS_COLOURS["hard-climb"] });
    expect(swatch).toHaveStyle({ width: "32px", height: "8px" });
  });
});
