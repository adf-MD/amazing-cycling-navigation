import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ElevationChart } from "./ElevationChart.tsx";
import type { RoutePoint } from "../../domain/types.ts";

function buildPoints(entries: readonly [number, number | null][]): RoutePoint[] {
  return entries.map(([distanceFromStartMetres, elevationMetres]) => ({
    coordinate: [0, 51],
    elevationMetres,
    distanceFromStartMetres,
  }));
}

describe("ElevationChart", () => {
  it("shows an explicit empty state for no route", () => {
    render(<ElevationChart points={[]} />);
    expect(screen.getByText("No route loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows an explicit missing-elevation state when no point has elevation", () => {
    const points = buildPoints([
      [0, null],
      [100, null],
    ]);
    render(<ElevationChart points={points} />);

    expect(
      screen.getByText("Elevation data is not available for this route."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders a chart with a min/max caption when elevation is present", () => {
    const points = buildPoints([
      [0, 10],
      [500, 40],
      [1000, 25],
    ]);
    render(<ElevationChart points={points} />);

    expect(
      screen.getByRole("img", { name: "Elevation profile chart" }),
    ).toBeInTheDocument();
    expect(screen.getByText("10–40 m")).toBeInTheDocument();
  });

  it("notes that some sections have no elevation data for a partial route", () => {
    const points = buildPoints([
      [0, 10],
      [500, null],
      [1000, 25],
    ]);
    render(<ElevationChart points={points} />);

    expect(screen.getByText(/some sections have no elevation data/)).toBeInTheDocument();
  });

  it("preserves the original inferred whole-route domain when domain is omitted", () => {
    const points = buildPoints([
      [1000, 0],
      [1500, 100],
      [2000, 0],
    ]);
    const { container } = render(<ElevationChart points={points} />);
    const path = container.querySelector("path");

    // Domain defaults to [1000, 2000] (the points' own bounds), so the
    // first point maps to x = 0 and the last to x = width (320).
    expect(path?.getAttribute("d")).toMatch(/^M 0\.00 /);
    expect(path?.getAttribute("d")).toMatch(/L 320\.00 /);
  });

  it("renders a marker line and dot when a marker is given", () => {
    const points = buildPoints([
      [0, 10],
      [500, 40],
      [1000, 25],
    ]);
    const { container } = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: 40, stale: false }}
      />,
    );

    expect(container.querySelector("line.elevation-chart-marker")).not.toBeNull();
    expect(container.querySelector("circle.elevation-chart-marker-dot")).not.toBeNull();
  });

  it("omits the marker dot when elevation at the marker is unknown", () => {
    const points = buildPoints([
      [0, 10],
      [500, null],
      [1000, 25],
    ]);
    const { container } = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: null, stale: false }}
      />,
    );

    expect(container.querySelector("line.elevation-chart-marker")).not.toBeNull();
    expect(container.querySelector("circle.elevation-chart-marker-dot")).toBeNull();
  });

  it("gives a stale marker a dashed, non-colour-only distinction from a fresh one", () => {
    const points = buildPoints([
      [0, 10],
      [1000, 25],
    ]);

    const fresh = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: 20, stale: false }}
      />,
    );
    const freshLine = fresh.container.querySelector("line.elevation-chart-marker");
    expect(freshLine?.getAttribute("stroke-dasharray")).toBeNull();
    fresh.unmount();

    const stale = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: 20, stale: true }}
      />,
    );
    const staleLine = stale.container.querySelector("line.elevation-chart-marker");
    expect(staleLine?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("splits the profile into a dashed completed run and a solid remaining run", () => {
    const points = buildPoints([
      [0, 10],
      [500, 40],
      [1000, 25],
    ]);
    const { container } = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: 40, stale: false }}
      />,
    );

    expect(container.querySelector("path.elevation-chart-completed")).not.toBeNull();
    expect(container.querySelector("path.elevation-chart-remaining")).not.toBeNull();
    expect(
      container
        .querySelector("path.elevation-chart-completed")
        ?.getAttribute("stroke-dasharray"),
    ).not.toBeNull();
    expect(
      container
        .querySelector("path.elevation-chart-remaining")
        ?.getAttribute("stroke-dasharray"),
    ).toBeNull();
  });

  it("shows accessible position text, distinguishing fresh from stale", () => {
    const points = buildPoints([
      [0, 10],
      [80000, 25],
    ]);

    render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 42300, elevationMetres: 20, stale: false }}
      />,
    );
    expect(
      screen.getByText(/Current route position: 42\.3 km of 80\.0 km\./),
    ).toBeInTheDocument();
  });

  it("labels a stale marker's accessible text as a last known position", () => {
    const points = buildPoints([
      [0, 10],
      [80000, 25],
    ]);

    render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 42300, elevationMetres: 20, stale: true }}
      />,
    );
    expect(
      screen.getByText(/Last known position: 42\.3 km of 80\.0 km\./),
    ).toBeInTheDocument();
  });

  it("renders no marker or position text when marker is omitted", () => {
    const points = buildPoints([
      [0, 10],
      [1000, 25],
    ]);
    const { container } = render(<ElevationChart points={points} />);

    expect(container.querySelector("line.elevation-chart-marker")).toBeNull();
    expect(screen.queryByText(/route position/)).toBeNull();
  });
});
