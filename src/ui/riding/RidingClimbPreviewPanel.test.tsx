import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RidingClimbPreviewPanel } from "./RidingClimbPreviewPanel.tsx";
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

describe("RidingClimbPreviewPanel", () => {
  it("shows a numbered climb heading using the category name", () => {
    render(
      <RidingClimbPreviewPanel
        climb={climb}
        climbNumber={2}
        distanceUntilStartMetres={1200}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Climb 2 · Category 3" }),
    ).toBeInTheDocument();
  });

  it("shows the distance until the climb starts", () => {
    render(
      <RidingClimbPreviewPanel
        climb={climb}
        climbNumber={2}
        distanceUntilStartMetres={1200}
      />,
    );
    expect(screen.getByText("Starts in 1.2 km")).toBeInTheDocument();
  });

  it("never renders a percentage-complete value or a progress bar", () => {
    const { container } = render(
      <RidingClimbPreviewPanel
        climb={climb}
        climbNumber={2}
        distanceUntilStartMetres={1200}
      />,
    );
    expect(container.textContent).not.toMatch(/\d+%\s*(complete|done)/i);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("renders no live-progress content — only the heading and the starts-in line", () => {
    const { container } = render(
      <RidingClimbPreviewPanel
        climb={climb}
        climbNumber={2}
        distanceUntilStartMetres={1200}
      />,
    );
    expect(container.textContent).not.toMatch(/completed|remaining|current|summit/i);
    expect(container.querySelectorAll("h3")).toHaveLength(1);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("updates the starts-in distance as it changes, without changing the heading", () => {
    const { rerender } = render(
      <RidingClimbPreviewPanel
        climb={climb}
        climbNumber={2}
        distanceUntilStartMetres={1200}
      />,
    );
    expect(screen.getByText("Starts in 1.2 km")).toBeInTheDocument();
    rerender(
      <RidingClimbPreviewPanel
        climb={climb}
        climbNumber={2}
        distanceUntilStartMetres={800}
      />,
    );
    expect(screen.getByText("Starts in 0.8 km")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Climb 2 · Category 3" }),
    ).toBeInTheDocument();
  });
});
