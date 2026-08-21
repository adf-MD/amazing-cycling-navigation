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

  it("shows distance to summit and distance completed", () => {
    render(
      <RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={fullMetrics} />,
    );
    expect(screen.getByText("Distance to summit")).toBeInTheDocument();
    expect(screen.getByText("1.7 km")).toBeInTheDocument();
    expect(screen.getByText(/Distance completed: 1\.0 km/)).toBeInTheDocument();
  });

  it("shows current elevation, summit elevation, elevation remaining and current gradient", () => {
    render(
      <RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={fullMetrics} />,
    );
    expect(screen.getByText(/Current elevation: 150 m/)).toBeInTheDocument();
    expect(screen.getByText(/Summit elevation: 189 m/)).toBeInTheDocument();
    expect(screen.getByText("Elevation remaining")).toBeInTheDocument();
    expect(screen.getByText("39 m")).toBeInTheDocument();
    expect(screen.getByText(/Current gradient: \+6\.5%/)).toBeInTheDocument();
  });

  it("gives distance to summit and elevation remaining the primary hierarchy, distinct from the secondary metrics", () => {
    const { container } = render(
      <RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={fullMetrics} />,
    );
    const primary = container.querySelector(".riding-climb-progress-primary");
    const secondary = container.querySelector(".riding-climb-progress-secondary");
    expect(primary).not.toBeNull();
    expect(secondary).not.toBeNull();
    expect(primary?.textContent).toContain("Distance to summit");
    expect(primary?.textContent).toContain("Elevation remaining");
    expect(primary?.textContent).not.toContain("Distance completed");
    expect(secondary?.textContent).toContain("Distance completed");
    expect(secondary?.textContent).not.toContain("Distance to summit");
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
    expect(screen.queryByText("Elevation remaining")).toBeNull();
    expect(screen.getByText(/Summit elevation: 189 m/)).toBeInTheDocument();
    expect(screen.getByText(/Distance completed: 1\.0 km/)).toBeInTheDocument();
    // Distance to summit is never omitted — it is unaffected by these
    // unrelated elevation fields going unavailable.
    expect(screen.getByText("Distance to summit")).toBeInTheDocument();
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
    expect(screen.getByText(/Distance completed: 2\.7 km/)).toBeInTheDocument();
    expect(screen.getByText("Distance to summit")).toBeInTheDocument();
    expect(screen.getByText("0.0 km")).toBeInTheDocument();
    // Genuine numeric zero for elevation remaining is shown, not omitted
    // or conflated with "unavailable".
    expect(screen.getByText("Elevation remaining")).toBeInTheDocument();
    expect(screen.getByText("0 m")).toBeInTheDocument();
  });

  it("omits the elevation-remaining primary tile (not just its value) when unavailable, without omitting distance to summit", () => {
    const metrics: ClimbProgressMetrics = {
      ...fullMetrics,
      currentElevationMetres: null,
      finishElevationMetres: null,
      elevationRemainingMetres: null,
    };
    const { container } = render(
      <RidingClimbProgressPanel climb={climb} climbNumber={2} metrics={metrics} />,
    );
    expect(screen.queryByText("Elevation remaining")).toBeNull();
    const primary = container.querySelector(".riding-climb-progress-primary");
    expect(primary).not.toBeNull();
    expect(primary?.textContent).toContain("Distance to summit");
  });
});
