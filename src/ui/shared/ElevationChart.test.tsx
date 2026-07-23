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
});
