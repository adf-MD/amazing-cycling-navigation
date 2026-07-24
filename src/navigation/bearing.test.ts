import { describe, expect, it } from "vitest";
import {
  geographicBearingDegrees,
  normaliseBearingDegrees,
  routeTangentBearingDegrees,
  shortestAngularDifferenceDegrees,
} from "./bearing.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import type { RoutePoint } from "../domain/types.ts";

describe("geographicBearingDegrees", () => {
  // North/south use a shared longitude (any latitude): the forward-azimuth
  // formula reduces exactly to 0/180 in that case, regardless of latitude.
  it("is 0 for due north", () => {
    expect(geographicBearingDegrees([0, 10], [0, 20])).toBeCloseTo(0, 6);
  });

  it("is 180 for due south", () => {
    expect(geographicBearingDegrees([0, 20], [0, 10])).toBeCloseTo(180, 6);
  });

  // East/west use the equator (any longitude delta): the formula reduces
  // exactly to 90/270 there, avoiding latitude-distortion tolerance issues.
  it("is 90 for due east", () => {
    expect(geographicBearingDegrees([0, 0], [10, 0])).toBeCloseTo(90, 6);
  });

  it("is 270 for due west", () => {
    expect(geographicBearingDegrees([10, 0], [0, 0])).toBeCloseTo(270, 6);
  });
});

describe("normaliseBearingDegrees", () => {
  it("leaves an in-range bearing unchanged", () => {
    expect(normaliseBearingDegrees(90)).toBe(90);
  });

  it("wraps a bearing at or above 360", () => {
    expect(normaliseBearingDegrees(370)).toBe(10);
    expect(normaliseBearingDegrees(360)).toBe(0);
  });

  it("wraps a negative bearing", () => {
    expect(normaliseBearingDegrees(-10)).toBe(350);
  });
});

describe("shortestAngularDifferenceDegrees", () => {
  it("crossing the 0/360 boundary forward is a small positive change", () => {
    expect(shortestAngularDifferenceDegrees(359, 1)).toBe(2);
  });

  it("crossing the 0/360 boundary backward is a small negative change", () => {
    expect(shortestAngularDifferenceDegrees(1, 359)).toBe(-2);
  });

  it("wrapping the other way also takes the short path", () => {
    expect(shortestAngularDifferenceDegrees(350, 10)).toBe(20);
    expect(shortestAngularDifferenceDegrees(10, 350)).toBe(-20);
  });

  it("a plain in-range difference is unaffected by wrapping", () => {
    expect(shortestAngularDifferenceDegrees(10, 25)).toBe(15);
  });

  it("no change is zero", () => {
    expect(shortestAngularDifferenceDegrees(45, 45)).toBe(0);
  });
});

describe("routeTangentBearingDegrees", () => {
  it("follows a straight due-north route", () => {
    // 0.01 degrees latitude at the equator/mid-latitude is ~1.1km — far
    // more than the 30m default window, so a matched distance well inside
    // the route keeps the sampled window entirely on this one straight
    // segment.
    const points = buildRoutePointsFromWaypoints(
      [
        [0, 51],
        [0, 51.01],
      ],
      50,
    );
    const routeLength = points.at(-1)?.distanceFromStartMetres ?? 0;
    expect(routeTangentBearingDegrees(points, routeLength / 2)).toBeCloseTo(0, 0);
  });

  it("follows the local tangent through a curved (bent) route", () => {
    // North for the first leg, then east for the second — both legs built
    // at the equator so each leg's own bearing is mathematically exact
    // (0 then 90), and each leg is long enough that a matched distance
    // safely inside it keeps the whole sampling window on that one leg.
    const points = buildRoutePointsFromWaypoints(
      [
        [0, 0],
        [0, 0.01],
        [0.01, 0.01],
      ],
      50,
    );
    const bendDistanceMetres =
      points.find((point) => point.coordinate[1] >= 0.01)?.distanceFromStartMetres ?? 0;
    const routeLength = points.at(-1)?.distanceFromStartMetres ?? 0;

    expect(routeTangentBearingDegrees(points, bendDistanceMetres / 2)).toBeCloseTo(0, 0);
    expect(
      routeTangentBearingDegrees(points, (bendDistanceMetres + routeLength) / 2),
    ).toBeCloseTo(90, 0);
  });

  it("returns null for insufficient geometry (fewer than 2 points)", () => {
    const single: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
    ];
    expect(routeTangentBearingDegrees(single, 0)).toBeNull();
    expect(routeTangentBearingDegrees([], 0)).toBeNull();
  });

  it("returns null for a degenerate route with duplicate coordinates", () => {
    const duplicate: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
    ];
    expect(routeTangentBearingDegrees(duplicate, 0)).toBeNull();
  });
});
