import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingSelectedFeatureSummaryPanel } from "./RidingSelectedFeatureSummaryPanel.tsx";
import type { ClimbFeature, DescentFeature } from "../../navigation/routeFeatures.ts";

const climb: ClimbFeature = {
  id: "climb-2400",
  kind: "climb",
  startDistanceMetres: 2400,
  endDistanceMetres: 5100,
  lengthMetres: 2700,
  elevationGainMetres: 373,
  averageGradientPercent: 7.3,
  maxGradientPercent: 11.2,
  climbScore: 19710,
  category: "category-2",
};

const descent: DescentFeature = {
  id: "descent-8000",
  kind: "descent",
  startDistanceMetres: 8000,
  endDistanceMetres: 9500,
  lengthMetres: 1500,
  elevationLossMetres: 197,
  averageGradientPercent: -7.3,
  maxGradientPercent: -11.5,
  band: "steep",
};

describe("RidingSelectedFeatureSummaryPanel", () => {
  it("renders nothing when feature is null", () => {
    const { container } = render(
      <RidingSelectedFeatureSummaryPanel feature={null} relativePosition={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the exact category heading, length, elevation gain and average gradient for a climb", () => {
    render(
      <RidingSelectedFeatureSummaryPanel
        feature={climb}
        relativePosition={{ kind: "ahead", distanceUntilStartMetres: 2400 }}
      />,
    );
    expect(screen.getByRole("heading", { name: /Category 2 climb/ })).toBeInTheDocument();
    expect(screen.getByText(/Starts in 2\.4 km/)).toBeInTheDocument();
    expect(screen.getByText(/2\.7 km/)).toBeInTheDocument();
    expect(screen.getByText(/373 m ascent/)).toBeInTheDocument();
    expect(screen.getByText(/\+7\.3% average/)).toBeInTheDocument();
    expect(screen.getByText(/Route position: 2\.4–5\.1 km/)).toBeInTheDocument();
  });

  it("shows the literal 'Recognised descent' heading and elevation loss for a descent", () => {
    render(
      <RidingSelectedFeatureSummaryPanel
        feature={descent}
        relativePosition={{ kind: "within", distanceRemainingMetres: 500 }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Recognised descent/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/0\.5 km remaining/)).toBeInTheDocument();
    expect(screen.getByText(/197 m loss/)).toBeInTheDocument();
    expect(screen.getByText(/-7\.3% average/)).toBeInTheDocument();
  });

  it("shows an honest passed state", () => {
    render(
      <RidingSelectedFeatureSummaryPanel
        feature={climb}
        relativePosition={{ kind: "passed", distanceSincePassedMetres: 1200 }}
      />,
    );
    expect(screen.getByText(/Passed 1\.2 km ago/)).toBeInTheDocument();
  });

  it("omits the relative-position clause entirely when relativePosition is null, rather than fabricating one", () => {
    render(<RidingSelectedFeatureSummaryPanel feature={climb} relativePosition={null} />);
    expect(screen.queryByText(/Starts in/)).toBeNull();
    expect(screen.queryByText(/remaining/)).toBeNull();
    expect(screen.queryByText(/Passed/)).toBeNull();
    expect(screen.getByText(/^2\.7 km/)).toBeInTheDocument();
  });

  it("shows no detail chart, local-gradient disclosure, max/steepest gradient or climb score", () => {
    render(
      <RidingSelectedFeatureSummaryPanel
        feature={climb}
        relativePosition={{ kind: "within", distanceRemainingMetres: 100 }}
      />,
    );
    expect(screen.queryByText(/Local gradient colours/)).toBeNull();
    expect(screen.queryByText(/Maximum local gradient/)).toBeNull();
    expect(screen.queryByText(/Climb score/)).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders a clear-selection control only when onClear is supplied, and calls it on click", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const { rerender } = render(
      <RidingSelectedFeatureSummaryPanel feature={climb} relativePosition={null} />,
    );
    expect(screen.queryByRole("button", { name: "Clear selection" })).toBeNull();

    rerender(
      <RidingSelectedFeatureSummaryPanel
        feature={climb}
        relativePosition={null}
        onClear={onClear}
      />,
    );
    const button = screen.getByRole("button", { name: "Clear selection" });
    expect(button).toHaveClass("clear-selection-button");
    await user.click(button);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
