import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteFeatureDetailsPanel } from "./RouteFeatureDetailsPanel.tsx";
import type { ClimbFeature, DescentFeature } from "../../navigation/routeFeatures.ts";
import { ROUTE_FEATURE_COLOURS } from "../../navigation/routeFeaturePalette.ts";

const climb: ClimbFeature = {
  id: "climb-12400",
  kind: "climb",
  startDistanceMetres: 12400,
  endDistanceMetres: 15100,
  lengthMetres: 2700,
  elevationGainMetres: 189,
  averageGradientPercent: 7,
  maxGradientPercent: 11.2,
  climbScore: 18900,
  category: "category-3",
};

const descent: DescentFeature = {
  id: "descent-20000",
  kind: "descent",
  startDistanceMetres: 20000,
  endDistanceMetres: 22700,
  lengthMetres: 2700,
  elevationLossMetres: 197,
  averageGradientPercent: -7.3,
  maxGradientPercent: -11.5,
  band: "steep",
};

describe("RouteFeatureDetailsPanel", () => {
  it("renders nothing when feature is null", () => {
    const { container } = render(<RouteFeatureDetailsPanel feature={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the exact category heading and all required climb fields", () => {
    render(<RouteFeatureDetailsPanel feature={climb} />);
    expect(screen.getByText("Category 3 climb")).toBeInTheDocument();
    expect(screen.getByText(/Route position: 12\.4–15\.1 km/)).toBeInTheDocument();
    expect(screen.getByText(/Length: 2\.7 km/)).toBeInTheDocument();
    expect(screen.getByText(/Elevation gain: 189 m/)).toBeInTheDocument();
    expect(screen.getByText(/Average gradient: \+7\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/Maximum local gradient: \+11\.2%/)).toBeInTheDocument();
    expect(screen.getByText(/Climb score: 18900/)).toBeInTheDocument();
    expect(
      screen.getByText(/Values are derived from available route elevation data\./),
    ).toBeInTheDocument();
  });

  it("shows the literal 'Recognised descent' heading and all required descent fields, with no climb score", () => {
    render(<RouteFeatureDetailsPanel feature={descent} />);
    expect(screen.getByText("Recognised descent")).toBeInTheDocument();
    expect(screen.getByText(/Route position: 20\.0–22\.7 km/)).toBeInTheDocument();
    expect(screen.getByText(/Length: 2\.7 km/)).toBeInTheDocument();
    expect(screen.getByText(/Elevation loss: 197 m/)).toBeInTheDocument();
    expect(screen.getByText(/Average gradient: -7\.3%/)).toBeInTheDocument();
    expect(screen.getByText(/Steepest local gradient: -11\.5%/)).toBeInTheDocument();
    expect(screen.queryByText(/Climb score/)).toBeNull();
    expect(
      screen.getByText(
        /Blue intensity reflects gradient steepness only, not surface, bends, traffic or other conditions\./,
      ),
    ).toBeInTheDocument();
  });

  it("does not show the descent safety disclaimer for a climb", () => {
    render(<RouteFeatureDetailsPanel feature={climb} />);
    expect(screen.queryByText(/Blue intensity reflects/)).toBeNull();
  });

  it("renders a clear-selection control only when onClear is supplied, and calls it on click", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const { rerender } = render(<RouteFeatureDetailsPanel feature={climb} />);
    expect(screen.queryByRole("button", { name: "Clear selection" })).toBeNull();

    rerender(<RouteFeatureDetailsPanel feature={climb} onClear={onClear} />);
    const button = screen.getByRole("button", { name: "Clear selection" });
    await user.click(button);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("numbers the heading when climbNumber is supplied, using the bare category name", () => {
    render(<RouteFeatureDetailsPanel feature={climb} climbNumber={2} />);
    expect(
      screen.getByRole("heading", { name: "Climb 2 · Category 3" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Category 3 climb")).toBeNull();
  });

  it("ignores climbNumber for a descent", () => {
    render(<RouteFeatureDetailsPanel feature={descent} climbNumber={1} />);
    expect(
      screen.getByRole("heading", { name: "Recognised descent" }),
    ).toBeInTheDocument();
  });

  it("renders detailChart directly between the heading and the fact list when supplied", () => {
    const { container } = render(
      <RouteFeatureDetailsPanel
        feature={climb}
        detailChart={<div data-testid="detail-chart">chart</div>}
      />,
    );
    const section = container.querySelector("section.route-feature-details");
    const children = Array.from(section?.children ?? []);
    const headingIndex = children.findIndex((child) => child.tagName === "H3");
    const chartIndex = children.findIndex(
      (child) => child.getAttribute("data-testid") === "detail-chart",
    );
    const firstFactIndex = children.findIndex(
      (child) => child.tagName === "P" && child.textContent.includes("Route position"),
    );
    expect(headingIndex).toBeGreaterThanOrEqual(0);
    expect(chartIndex).toBe(headingIndex + 1);
    expect(firstFactIndex).toBe(chartIndex + 1);
  });

  it("renders no extra chart element when detailChart is omitted", () => {
    render(<RouteFeatureDetailsPanel feature={climb} />);
    expect(screen.queryByTestId("detail-chart")).toBeNull();
  });

  it("renders a visible category-colour line sample next to the heading", () => {
    render(<RouteFeatureDetailsPanel feature={climb} />);
    const swatch = document.querySelector(".gradient-colour-swatch");
    expect(swatch).not.toBeNull();
    expect(swatch).toHaveStyle({ backgroundColor: ROUTE_FEATURE_COLOURS["category-3"] });
  });
});
