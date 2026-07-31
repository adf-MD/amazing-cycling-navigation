import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RidingClimbProgressPanel } from "./RidingClimbProgressPanel.tsx";
import type { ClimbProgressMetrics } from "../../navigation/climbElevationView.ts";
import type { ClimbFeature } from "../../navigation/routeFeatures.ts";

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

const fullMetrics: ClimbProgressMetrics = {
  clampedPresentationDistanceMetres: 13400,
  distanceCompletedMetres: 1000,
  distanceRemainingMetres: 1700,
  currentElevationMetres: 150,
  finishElevationMetres: 189,
  elevationRemainingMetres: 39,
  currentGradientPercent: 6.5,
};

describe("RidingClimbProgressPanel", () => {
  it("shows a numbered climb heading using the category name, not the category climb label", () => {
    render(
      <RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={fullMetrics} />,
    );
    expect(
      screen.getByRole("heading", { name: "Climb 2 · Category 3" }),
    ).toBeInTheDocument();
  });

  it("shows distance completed and remaining", () => {
    render(
      <RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={fullMetrics} />,
    );
    expect(screen.getByText(/1\.0 km completed/)).toBeInTheDocument();
    expect(screen.getByText(/1\.7 km remaining/)).toBeInTheDocument();
  });

  it("shows current elevation, summit elevation, elevation remaining and current gradient", () => {
    render(
      <RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={fullMetrics} />,
    );
    expect(screen.getByText(/Current elevation: 150 m/)).toBeInTheDocument();
    expect(screen.getByText(/Summit elevation: 189 m/)).toBeInTheDocument();
    expect(screen.getByText(/Elevation remaining: 39 m/)).toBeInTheDocument();
    expect(screen.getByText(/Current gradient: \+6\.5%/)).toBeInTheDocument();
  });

  it("never renders a percentage-complete value", () => {
    const { container } = render(
      <RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={fullMetrics} />,
    );
    expect(container.textContent).not.toMatch(/\d+%\s*(complete|done)/i);
    expect(container.textContent).not.toMatch(/complete[d]?\s*[:]?\s*\d+%/i);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("omits current elevation when unavailable, without affecting other fields", () => {
    const metrics: ClimbProgressMetrics = {
      ...fullMetrics,
      currentElevationMetres: null,
      elevationRemainingMetres: null,
    };
    render(<RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={metrics} />);
    expect(screen.queryByText(/Current elevation:/)).toBeNull();
    expect(screen.queryByText(/Elevation remaining:/)).toBeNull();
    expect(screen.getByText(/Summit elevation: 189 m/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 km completed/)).toBeInTheDocument();
  });

  it("omits summit elevation when unavailable", () => {
    const metrics: ClimbProgressMetrics = {
      ...fullMetrics,
      finishElevationMetres: null,
      elevationRemainingMetres: null,
    };
    render(<RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={metrics} />);
    expect(screen.queryByText(/Summit elevation:/)).toBeNull();
    expect(screen.getByText(/Current elevation: 150 m/)).toBeInTheDocument();
  });

  it("omits current gradient when no classified segment is available", () => {
    const metrics: ClimbProgressMetrics = {
      ...fullMetrics,
      currentGradientPercent: null,
    };
    render(<RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={metrics} />);
    expect(screen.queryByText(/Current gradient:/)).toBeNull();
  });

  it("renders the distance summary at the finish (0 remaining)", () => {
    const metrics: ClimbProgressMetrics = {
      ...fullMetrics,
      distanceCompletedMetres: 2700,
      distanceRemainingMetres: 0,
      elevationRemainingMetres: 0,
    };
    render(<RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={metrics} />);
    expect(screen.getByText(/2\.7 km completed/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0 km remaining/)).toBeInTheDocument();
    expect(screen.getByText(/Elevation remaining: 0 m/)).toBeInTheDocument();
  });
});
