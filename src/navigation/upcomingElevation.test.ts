import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEVATION_VIEW_MODE,
  DEFAULT_ELEVATION_WINDOW_METRES,
  ELEVATION_VIEW_MODE_OPTIONS,
  ELEVATION_WINDOW_OPTIONS_METRES,
  buildFullProfileMarker,
  interpolateRoutePointAt,
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

describe("elevation view mode options", () => {
  it("defaults to a 5 km upcoming view", () => {
    expect(DEFAULT_ELEVATION_VIEW_MODE).toEqual({ kind: "upcoming", windowMetres: 5000 });
  });

  it("offers Full followed by the 2/5/10 km upcoming options, in that order", () => {
    expect(ELEVATION_VIEW_MODE_OPTIONS).toEqual([
      { kind: "full" },
      { kind: "upcoming", windowMetres: 2000 },
      { kind: "upcoming", windowMetres: 5000 },
      { kind: "upcoming", windowMetres: 10000 },
    ]);
  });
});

describe("interpolateRoutePointAt", () => {
  it("returns null for an empty route", () => {
    expect(interpolateRoutePointAt([], 100)).toBeNull();
  });

  it("returns the exact stored point when the distance already matches one", () => {
    const result = interpolateRoutePointAt(ROUTE_POINTS, 3000);
    expect(result).toEqual(ROUTE_POINTS[3]);
  });

  it("linearly interpolates coordinate and elevation between the bracketing pair", () => {
    const points: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.01, 52], elevationMetres: 20, distanceFromStartMetres: 100 },
    ];
    const result = interpolateRoutePointAt(points, 25);

    expect(result?.distanceFromStartMetres).toBe(25);
    expect(result?.elevationMetres).toBeCloseTo(12.5, 5);
    expect(result?.coordinate[0]).toBeCloseTo(0.0025, 5);
    expect(result?.coordinate[1]).toBeCloseTo(51.25, 5);
  });

  it("interpolates coordinate but returns a null elevation when either bracketing point's elevation is unknown", () => {
    const points: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
      { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 100 },
    ];
    const result = interpolateRoutePointAt(points, 50);

    expect(result?.elevationMetres).toBeNull();
    expect(result?.coordinate[0]).toBeCloseTo(0.005, 5);
  });

  it("clamps a distance before the route start to the first point", () => {
    expect(interpolateRoutePointAt(ROUTE_POINTS, -500)).toEqual(ROUTE_POINTS[0]);
  });

  it("clamps a distance after the route finish to the last point", () => {
    expect(interpolateRoutePointAt(ROUTE_POINTS, 99_999)).toEqual(ROUTE_POINTS.at(-1));
  });

  it("returns the single point verbatim for a single-point route, regardless of requested distance", () => {
    const singlePoint: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 5, distanceFromStartMetres: 500 },
    ];
    expect(interpolateRoutePointAt(singlePoint, 0)).toEqual(singlePoint[0]);
    expect(interpolateRoutePointAt(singlePoint, 999)).toEqual(singlePoint[0]);
  });
});

describe("selectUpcomingElevationWindow boundary interpolation", () => {
  // Spaced 5000 m apart so windowMetres can stay a real ElevationWindowMetres
  // option (2000/5000/10000) while matched/end distances still land
  // strictly mid-segment for the cases that need that.
  const points: RoutePoint[] = [
    { coordinate: [0, 51], elevationMetres: 0, distanceFromStartMetres: 0 },
    { coordinate: [0.01, 51], elevationMetres: 100, distanceFromStartMetres: 5000 },
    { coordinate: [0.02, 51], elevationMetres: 50, distanceFromStartMetres: 10000 },
    { coordinate: [0.03, 51], elevationMetres: 80, distanceFromStartMetres: 15000 },
  ];

  it("interpolates a synthetic start point when the matched distance falls mid-segment", () => {
    const result = selectUpcomingElevationWindow(points, 2500, 2000);

    expect(result.startDistanceMetres).toBe(2500);
    expect(result.points[0]?.distanceFromStartMetres).toBe(2500);
    expect(result.points[0]?.elevationMetres).toBeCloseTo(50, 5);
  });

  it("interpolates a synthetic end point when the window end falls mid-segment", () => {
    const result = selectUpcomingElevationWindow(points, 2000, 5000);

    expect(result.endDistanceMetres).toBe(7000);
    const last = result.points.at(-1);
    expect(last?.distanceFromStartMetres).toBe(7000);
    expect(last?.elevationMetres).toBeCloseTo(80, 5);
  });

  it("does not duplicate a point when a window boundary lands exactly on an existing point", () => {
    const result = selectUpcomingElevationWindow(points, 5000, 5000);
    expect(result.points.map((p) => p.distanceFromStartMetres)).toEqual([5000, 10000]);
  });

  it("keeps elevation null when a boundary interpolates across a point with unknown elevation", () => {
    const pointsWithGap: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.01, 51], elevationMetres: null, distanceFromStartMetres: 5000 },
      { coordinate: [0.02, 51], elevationMetres: 30, distanceFromStartMetres: 10000 },
    ];
    const result = selectUpcomingElevationWindow(pointsWithGap, 2000, 2000);
    expect(result.points[0]?.elevationMetres).toBeNull();
  });
});

describe("buildFullProfileMarker", () => {
  it("returns null for an empty route", () => {
    expect(buildFullProfileMarker([], 100)).toBeNull();
  });

  it("interpolates the marker position mid-route", () => {
    const marker = buildFullProfileMarker(ROUTE_POINTS, 3500);
    expect(marker?.markerDistanceFromStartMetres).toBe(3500);
    expect(marker?.point.distanceFromStartMetres).toBe(3500);
  });

  it("clamps to the route start for a distance before it", () => {
    const marker = buildFullProfileMarker(ROUTE_POINTS, -100);
    expect(marker?.markerDistanceFromStartMetres).toBe(0);
  });

  it("clamps to the route finish for a distance beyond it", () => {
    const marker = buildFullProfileMarker(ROUTE_POINTS, 999_999);
    expect(marker?.markerDistanceFromStartMetres).toBe(20_000);
  });
});
