import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEVATION_WINDOW_METRES,
  ELEVATION_WINDOW_OPTIONS_METRES,
  selectUpcomingElevationWindow,
} from "./upcomingElevation.ts";
import type { RoutePoint } from "../domain/types.ts";

function buildPoints(distances: readonly number[]): RoutePoint[] {
  return distances.map((distanceFromStartMetres) => ({
    coordinate: [0, 51],
    elevationMetres: distanceFromStartMetres / 10,
    distanceFromStartMetres,
  }));
}

const ROUTE_POINTS = buildPoints(
  Array.from({ length: 21 }, (_, i) => i * 1000), // 0, 1000, ..., 20000 m
);

describe("elevation window options", () => {
  it("defaults to 5 km", () => {
    expect(DEFAULT_ELEVATION_WINDOW_METRES).toBe(5000);
  });

  it("offers exactly 2 km, 5 km and 10 km", () => {
    expect(ELEVATION_WINDOW_OPTIONS_METRES).toEqual([2000, 5000, 10000]);
  });
});

describe("selectUpcomingElevationWindow", () => {
  it("selects only points within [matched, matched + window]", () => {
    const result = selectUpcomingElevationWindow(ROUTE_POINTS, 3000, 2000);

    expect(result.startDistanceMetres).toBe(3000);
    expect(result.endDistanceMetres).toBe(5000);
    expect(result.points.map((p) => p.distanceFromStartMetres)).toEqual([
      3000, 4000, 5000,
    ]);
  });

  it("uses the 5 km default window", () => {
    const result = selectUpcomingElevationWindow(
      ROUTE_POINTS,
      0,
      DEFAULT_ELEVATION_WINDOW_METRES,
    );
    expect(result.endDistanceMetres).toBe(5000);
    expect(result.points).toHaveLength(6);
  });

  it("selects the full 10 km window when the route is long enough", () => {
    const result = selectUpcomingElevationWindow(ROUTE_POINTS, 0, 10000);
    expect(result.endDistanceMetres).toBe(10000);
    expect(result.points).toHaveLength(11);
  });

  it("clamps the window to the end of the route", () => {
    const result = selectUpcomingElevationWindow(ROUTE_POINTS, 18000, 10000);
    expect(result.endDistanceMetres).toBe(20000);
    expect(result.points.map((p) => p.distanceFromStartMetres)).toEqual([
      18000, 19000, 20000,
    ]);
  });

  it("returns a single point when the rider is at the very end of the route", () => {
    const result = selectUpcomingElevationWindow(ROUTE_POINTS, 20000, 5000);
    expect(result.startDistanceMetres).toBe(20000);
    expect(result.endDistanceMetres).toBe(20000);
    expect(result.points.map((p) => p.distanceFromStartMetres)).toEqual([20000]);
  });

  it("returns an empty window for an empty route", () => {
    const result = selectUpcomingElevationWindow([], 0, 5000);
    expect(result.points).toEqual([]);
    expect(result.endDistanceMetres).toBe(0);
  });
});
