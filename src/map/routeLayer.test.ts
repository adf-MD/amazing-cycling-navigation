import { describe, expect, it } from "vitest";
import {
  buildPositionFeatureCollection,
  buildRouteLineFeatureCollection,
  computeBoundingBox,
  EMPTY_FEATURE_COLLECTION,
  isLoopRoute,
  splitRouteAtDistance,
} from "./routeLayer.ts";
import type { Coordinate, RoutePoint } from "../domain/types.ts";

const firstPoint: RoutePoint = {
  coordinate: [0, 51],
  elevationMetres: 10,
  distanceFromStartMetres: 0,
};
const points: RoutePoint[] = [
  firstPoint,
  { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 100 },
  { coordinate: [0.002, 51.001], elevationMetres: 14, distanceFromStartMetres: 200 },
];

describe("buildRouteLineFeatureCollection", () => {
  it("builds a single LineString feature from route points", () => {
    const collection = buildRouteLineFeatureCollection(points);

    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);
    const [feature] = collection.features;
    expect(feature?.geometry.type).toBe("LineString");
    expect(feature?.geometry).toMatchObject({
      coordinates: [
        [0, 51],
        [0.001, 51],
        [0.002, 51.001],
      ],
    });
  });

  it("returns no features for fewer than 2 points", () => {
    expect(buildRouteLineFeatureCollection([]).features).toEqual([]);
    expect(buildRouteLineFeatureCollection([firstPoint]).features).toEqual([]);
  });
});

describe("buildPositionFeatureCollection", () => {
  it("builds a single Point feature at the given coordinate", () => {
    const collection = buildPositionFeatureCollection([-1.5, 53.8]);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [-1.5, 53.8],
    });
  });
});

describe("EMPTY_FEATURE_COLLECTION", () => {
  it("has no features", () => {
    expect(EMPTY_FEATURE_COLLECTION.features).toEqual([]);
  });
});

describe("computeBoundingBox", () => {
  it("returns null for no coordinates", () => {
    expect(computeBoundingBox([])).toBeNull();
  });

  it("returns the single point as both corners for one coordinate", () => {
    const coordinate: Coordinate = [-1.5, 53.8];
    expect(computeBoundingBox([coordinate])).toEqual({
      southWest: coordinate,
      northEast: coordinate,
    });
  });

  it("computes the min/max envelope across many coordinates", () => {
    const coordinates: Coordinate[] = [
      [0, 51],
      [0.002, 51.001],
      [-0.001, 50.999],
      [0.001, 51.0005],
    ];
    expect(computeBoundingBox(coordinates)).toEqual({
      southWest: [-0.001, 50.999],
      northEast: [0.002, 51.001],
    });
  });
});

describe("isLoopRoute", () => {
  it("returns false for a clear point-to-point route", () => {
    expect(isLoopRoute(points)).toBe(false);
  });

  it("returns true when the first and last points coincide exactly", () => {
    const loop: RoutePoint[] = [
      firstPoint,
      { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 100 },
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 200 },
    ];
    expect(isLoopRoute(loop)).toBe(true);
  });

  it("returns true when the first and last points are within the threshold (GPS drift)", () => {
    const nearLoop: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 100 },
      // ~30m east of the start at this latitude — within the 50m default.
      { coordinate: [0.0004, 51], elevationMetres: 10, distanceFromStartMetres: 200 },
    ];
    expect(isLoopRoute(nearLoop)).toBe(true);
  });

  it("returns false when the first and last points are further apart than the threshold", () => {
    const nearLoop: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 100 },
      { coordinate: [0.0004, 51], elevationMetres: 10, distanceFromStartMetres: 200 },
    ];
    expect(isLoopRoute(nearLoop, 10)).toBe(false);
  });

  it("returns false for degenerate 0- or 1-point input", () => {
    expect(isLoopRoute([])).toBe(false);
    expect(isLoopRoute([firstPoint])).toBe(false);
  });
});

describe("splitRouteAtDistance", () => {
  it("splits into completed/remaining with an interpolated midpoint", () => {
    const { completed, remaining } = splitRouteAtDistance(points, 150);

    const completedCoords = completed.features[0]?.geometry.coordinates;
    const remainingCoords = remaining.features[0]?.geometry.coordinates;

    expect(completedCoords).toEqual([
      [0, 51],
      [0.001, 51],
      [0.0015, 51.0005],
    ]);
    expect(remainingCoords).toEqual([
      [0.0015, 51.0005],
      [0.002, 51.001],
    ]);
  });

  it("puts everything in remaining when matched distance is 0 (completed has <2 points so renders no line)", () => {
    const { completed, remaining } = splitRouteAtDistance(points, 0);
    expect(completed.features).toEqual([]);
    expect(remaining.features[0]?.geometry.coordinates).toEqual([
      [0, 51],
      [0.001, 51],
      [0.002, 51.001],
    ]);
  });

  it("puts everything in completed when matched distance is at or beyond the end", () => {
    const { completed, remaining } = splitRouteAtDistance(points, 1000);
    expect(completed.features[0]?.geometry.coordinates).toEqual([
      [0, 51],
      [0.001, 51],
      [0.002, 51.001],
    ]);
    expect(remaining.features).toEqual([]);
  });
});
