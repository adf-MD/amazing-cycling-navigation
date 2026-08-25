import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DescentLocalLegend } from "./DescentLocalLegend.tsx";
import type { DescentLocalKey } from "../../navigation/routeFeatures.ts";
import { MICRO_DETAIL_COLOURS } from "../../navigation/routeFeaturePalette.ts";

function keys(...values: DescentLocalKey[]): ReadonlySet<DescentLocalKey> {
  return new Set(values);
}

describe("DescentLocalLegend", () => {
  it("renders nothing for an empty key set", () => {
    const { container } = render(<DescentLocalLegend presentDescentLocalKeys={keys()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one entry per present key, in a fixed neutral-then-light-to-dark order", () => {
    render(
      <DescentLocalLegend
        presentDescentLocalKeys={keys("very-steep", "neutral", "steep")}
      />,
    );
    const list = screen.getByRole("list", { name: "Detailed descent gradient legend" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    // neutral, then steep, then very-steep — the fixed severity order,
    // not the order keys were passed in.
    expect(items[0]?.textContent).toContain("Shallower than the descent threshold");
    expect(items[1]?.textContent).toContain("Steep descent");
    expect(items[2]?.textContent).toContain("Very steep descent");
  });

  it("omits keys that are not present", () => {
    render(<DescentLocalLegend presentDescentLocalKeys={keys("neutral")} />);
    expect(screen.queryByText(/Steep descent/)).toBeNull();
    expect(screen.queryByText(/Very steep descent/)).toBeNull();
  });

  it("has no live-region role", () => {
    const { container } = render(
      <DescentLocalLegend presentDescentLocalKeys={keys("neutral")} />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("has no focusable descendants", () => {
    render(
      <DescentLocalLegend
        presentDescentLocalKeys={keys("neutral", "moderate", "very-steep")}
      />,
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("includes the key name, exact grade range and colour name in each row's text", () => {
    render(<DescentLocalLegend presentDescentLocalKeys={keys("moderate")} />);
    expect(screen.getByText(/Moderate descent/)).toBeInTheDocument();
    expect(screen.getByText(/3% to just below 6%/)).toBeInTheDocument();
    expect(screen.getByText(/light blue/)).toBeInTheDocument();
  });

  it("renders a visible line sample for each row, coloured with the same token the classifier uses", () => {
    render(<DescentLocalLegend presentDescentLocalKeys={keys("steep")} />);
    const swatch = document.querySelector(".gradient-colour-swatch");
    expect(swatch).not.toBeNull();
    expect(swatch).toHaveStyle({
      backgroundColor: MICRO_DETAIL_COLOURS.steep,
    });
    expect(swatch).toHaveStyle({ width: "32px", height: "8px" });
  });

  describe("compact variant (backlog item 79)", () => {
    it("shows only the swatch and grade range, omitting the key name and colour name", () => {
      render(
        <DescentLocalLegend
          presentDescentLocalKeys={keys("moderate")}
          variant="compact"
        />,
      );
      expect(screen.getByText("3% to just below 6%")).toBeInTheDocument();
      expect(screen.queryByText(/Moderate descent/)).toBeNull();
      expect(screen.queryByText(/light blue/)).toBeNull();
    });

    it("shows the neutral row's range only, when present", () => {
      render(
        <DescentLocalLegend
          presentDescentLocalKeys={keys("neutral")}
          variant="compact"
        />,
      );
      expect(screen.getByText("Below 3%")).toBeInTheDocument();
      expect(screen.queryByText(/Shallower than/)).toBeNull();
    });

    it("omitting variant still renders the full row, unchanged from before item 79", () => {
      render(<DescentLocalLegend presentDescentLocalKeys={keys("moderate")} />);
      expect(screen.getByText(/Moderate descent/)).toBeInTheDocument();
      expect(screen.getByText(/3% to just below 6%/)).toBeInTheDocument();
      expect(screen.getByText(/light blue/)).toBeInTheDocument();
    });
  });
});
