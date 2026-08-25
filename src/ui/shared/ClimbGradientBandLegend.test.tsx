import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClimbGradientBandLegend } from "./ClimbGradientBandLegend.tsx";
import type { ClimbGradientBand } from "../../navigation/routeFeatures.ts";
import { MICRO_DETAIL_COLOURS } from "../../navigation/routeFeaturePalette.ts";

function bands(...values: ClimbGradientBand[]): ReadonlySet<ClimbGradientBand> {
  return new Set(values);
}

describe("ClimbGradientBandLegend", () => {
  it("renders nothing for an empty band set", () => {
    const { container } = render(<ClimbGradientBandLegend presentClimbBands={bands()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one entry per present band, in a fixed light-to-dark order", () => {
    render(
      <ClimbGradientBandLegend
        presentClimbBands={bands("very-hard-climb", "gentle-or-descending", "hard-climb")}
      />,
    );
    const list = screen.getByRole("list", { name: "Detailed climb gradient legend" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    // gentle-or-descending, then hard-climb, then very-hard-climb — the
    // fixed severity order, not the order bands were passed in.
    expect(items[0]?.textContent).toContain("Gentle, flat or brief descent");
    expect(items[1]?.textContent).toContain("Hard climb");
    expect(items[2]?.textContent).toContain("Very hard climb");
  });

  it("omits bands that are not present", () => {
    render(<ClimbGradientBandLegend presentClimbBands={bands("gentle-or-descending")} />);
    expect(screen.queryByText(/Hard climb/)).toBeNull();
    expect(screen.queryByText(/Extremely steep climb/)).toBeNull();
  });

  it("has no live-region role", () => {
    const { container } = render(
      <ClimbGradientBandLegend presentClimbBands={bands("gentle-or-descending")} />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("has no focusable descendants", () => {
    render(
      <ClimbGradientBandLegend
        presentClimbBands={bands(
          "gentle-or-descending",
          "hard-climb",
          "extremely-steep-climb",
        )}
      />,
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("includes the band name, exact grade range and colour name in each row's text — never 'Category N' wording", () => {
    render(<ClimbGradientBandLegend presentClimbBands={bands("moderate-climb")} />);
    expect(screen.getByText(/Moderate climb/)).toBeInTheDocument();
    expect(screen.getByText(/3% to just below 6%/)).toBeInTheDocument();
    expect(screen.getByText(/yellow/)).toBeInTheDocument();
    expect(screen.queryByText(/Category/)).toBeNull();
  });

  it("renders a visible line sample for each row, coloured with the same token the classifier uses", () => {
    render(<ClimbGradientBandLegend presentClimbBands={bands("hard-climb")} />);
    const swatch = document.querySelector(".gradient-colour-swatch");
    expect(swatch).not.toBeNull();
    expect(swatch).toHaveStyle({
      backgroundColor: MICRO_DETAIL_COLOURS["hard-climb"],
    });
    expect(swatch).toHaveStyle({ width: "32px", height: "8px" });
  });

  describe("compact variant (backlog item 79)", () => {
    it("shows only the swatch and grade range, omitting the band name and colour name", () => {
      render(
        <ClimbGradientBandLegend
          presentClimbBands={bands("moderate-climb")}
          variant="compact"
        />,
      );
      expect(screen.getByText("3% to just below 6%")).toBeInTheDocument();
      expect(screen.queryByText(/Moderate climb/)).toBeNull();
      expect(screen.queryByText(/yellow/)).toBeNull();
    });

    it("still renders a real coloured swatch per present band, in severity order", () => {
      render(
        <ClimbGradientBandLegend
          presentClimbBands={bands("extremely-steep-climb", "gentle-or-descending")}
          variant="compact"
        />,
      );
      const list = screen.getByRole("list", { name: "Detailed climb gradient legend" });
      const items = list.querySelectorAll("li");
      expect(items).toHaveLength(2);
      expect(items[0]?.textContent).toBe("Below 3%");
      expect(items[1]?.textContent).toBe("12% or more");
    });

    it("omitting variant still renders the full row, unchanged from before item 79", () => {
      render(<ClimbGradientBandLegend presentClimbBands={bands("moderate-climb")} />);
      expect(screen.getByText(/Moderate climb/)).toBeInTheDocument();
      expect(screen.getByText(/3% to just below 6%/)).toBeInTheDocument();
      expect(screen.getByText(/yellow/)).toBeInTheDocument();
    });
  });
});
