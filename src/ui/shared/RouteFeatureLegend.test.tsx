import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteFeatureLegend } from "./RouteFeatureLegend.tsx";
import type { RouteFeatureVisualKey } from "../../navigation/routeFeaturePalette.ts";

function keys(...values: RouteFeatureVisualKey[]): ReadonlySet<RouteFeatureVisualKey> {
  return new Set(values);
}

describe("RouteFeatureLegend", () => {
  it("renders nothing for an empty key set", () => {
    const { container } = render(<RouteFeatureLegend presentVisualKeys={keys()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one entry per present key, in a fixed order (climbs light-to-dark, then descents light-to-dark)", () => {
    render(
      <RouteFeatureLegend
        presentVisualKeys={keys("hc", "uncategorised", "very-steep")}
      />,
    );
    const list = screen.getByRole("list", { name: "Recognised route features legend" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("Uncategorised climb");
    expect(items[1]?.textContent).toContain("HC climb");
    expect(items[2]?.textContent).toContain("very steep");
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
    render(<RouteFeatureLegend presentVisualKeys={keys("category-3", "gentle", "hc")} />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("labels a climb as 'Category N climb', not colour alone", () => {
    render(<RouteFeatureLegend presentVisualKeys={keys("category-2")} />);
    expect(screen.getByText(/Category 2 climb/)).toBeInTheDocument();
  });

  it("labels a descent as 'Recognised descent', with its severity called out in text", () => {
    render(<RouteFeatureLegend presentVisualKeys={keys("steep")} />);
    expect(screen.getByText(/Recognised descent \(steep/)).toBeInTheDocument();
  });
});
