import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteFeatureLegend } from "./RouteFeatureLegend.tsx";
import {
  ROUTE_FEATURE_COLOURS,
  type RouteFeatureVisualKey,
} from "../../navigation/routeFeaturePalette.ts";

function keys(...values: RouteFeatureVisualKey[]): ReadonlySet<RouteFeatureVisualKey> {
  return new Set(values);
}

describe("RouteFeatureLegend", () => {
  it("renders only the ordinary-route entry for an empty key set", () => {
    render(<RouteFeatureLegend presentVisualKeys={keys()} />);
    const list = screen.getByRole("list", { name: "Recognised route features legend" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("Ordinary route");
  });

  it("always includes the ordinary-route entry first, then one entry per present key, in a fixed order (climbs light-to-dark, then descents light-to-dark)", () => {
    render(
      <RouteFeatureLegend
        presentVisualKeys={keys("hc", "uncategorised", "very-steep")}
      />,
    );
    const list = screen.getByRole("list", { name: "Recognised route features legend" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toContain("Ordinary route");
    expect(items[1]?.textContent).toContain("Uncategorised or Category 4 climb");
    expect(items[2]?.textContent).toContain("HC climb");
    expect(items[3]?.textContent).toContain("very steep");
  });

  it("combines Uncategorised and Category 4 into a single row even when both are present", () => {
    render(
      <RouteFeatureLegend presentVisualKeys={keys("uncategorised", "category-4")} />,
    );
    const list = screen.getByRole("list", { name: "Recognised route features legend" });
    const items = list.querySelectorAll("li");
    // Ordinary route + one combined climb row, not two.
    expect(items).toHaveLength(2);
    expect(items[1]?.textContent).toContain("Uncategorised or Category 4 climb");
  });

  it("omits keys that are not present", () => {
    render(<RouteFeatureLegend presentVisualKeys={keys("category-3")} />);
    expect(screen.queryByText(/HC climb/)).toBeNull();
    expect(screen.queryByText(/Recognised descent/)).toBeNull();
  });

  it("has no live-region role", () => {
    const { container } = render(
      <RouteFeatureLegend presentVisualKeys={keys("category-3")} />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("has no focusable descendants", () => {
    render(
      <RouteFeatureLegend presentVisualKeys={keys("category-3", "moderate", "hc")} />,
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("labels a climb as 'Category N climb', not colour alone", () => {
    render(<RouteFeatureLegend presentVisualKeys={keys("category-2")} />);
    expect(screen.getByText(/Category 2 climb/)).toBeInTheDocument();
  });

  it("labels a descent as 'Recognised descent', with its band called out in text", () => {
    render(<RouteFeatureLegend presentVisualKeys={keys("steep")} />);
    expect(screen.getByText(/Recognised descent \(steep/)).toBeInTheDocument();
  });

  it("renders three distinct descent rows when all three bands are present, never a single merged blue", () => {
    render(
      <RouteFeatureLegend presentVisualKeys={keys("moderate", "steep", "very-steep")} />,
    );
    expect(screen.getByText(/Recognised descent \(moderate/)).toBeInTheDocument();
    expect(screen.getByText(/Recognised descent \(steep/)).toBeInTheDocument();
    expect(screen.getByText(/Recognised descent \(very steep/)).toBeInTheDocument();
  });

  it("renders a visible line sample for a present key, coloured with the same token the map layer uses", () => {
    render(<RouteFeatureLegend presentVisualKeys={keys("category-2")} />);
    const swatches = document.querySelectorAll(".gradient-colour-swatch");
    // The first swatch is the always-present ordinary-route entry.
    expect(swatches).toHaveLength(2);
    expect(swatches[1]).toHaveStyle({
      backgroundColor: ROUTE_FEATURE_COLOURS["category-2"],
    });
    expect(swatches[1]).toHaveStyle({ width: "32px", height: "8px" });
  });
});
