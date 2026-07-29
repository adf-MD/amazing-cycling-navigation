import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteFeatureDetailsPanel } from "./RouteFeatureDetailsPanel.tsx";
import type { ClimbFeature, DescentFeature } from "../../navigation/routeFeatures.ts";

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
  severity: "steep",
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
});
