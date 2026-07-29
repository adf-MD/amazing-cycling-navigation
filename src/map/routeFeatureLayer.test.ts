import { describe, expect, it } from "vitest";
import {
  buildRouteFeatureFeatureCollection,
  buildSelectedRouteFeatureFeatureCollection,
  resolveRouteFeatureIdHit,
} from "./routeFeatureLayer.ts";
import type { RoutePoint } from "../domain/types.ts";
import type {
  ClimbFeature,
  DescentFeature,
  RouteFeature,
} from "../navigation/routeFeatures.ts";

const POINTS: RoutePoint[] = Array.from({ length: 11 }, (_, index) => ({
  coordinate: [index * 0.001, 51],
  elevationMetres: null,
  distanceFromStartMetres: index * 100,
}));

function climb(
  startDistanceMetres: number,
  endDistanceMetres: number,
  category: ClimbFeature["category"] = "category-3",
): ClimbFeature {
  return {
    id: `climb-${String(startDistanceMetres)}`,
    kind: "climb",
    startDistanceMetres,
    endDistanceMetres,
    lengthMetres: endDistanceMetres - startDistanceMetres,
    elevationGainMetres: 50,
    averageGradientPercent: 5,
    maxGradientPercent: 7,
    climbScore: 5000,
    category,
  };
}

function descent(
  startDistanceMetres: number,
  endDistanceMetres: number,
  severity: DescentFeature["severity"] = "steep",
): DescentFeature {
  return {
    id: `descent-${String(startDistanceMetres)}`,
    kind: "descent",
    startDistanceMetres,
    endDistanceMetres,
    lengthMetres: endDistanceMetres - startDistanceMetres,
    elevationLossMetres: 50,
    averageGradientPercent: -7,
    maxGradientPercent: -9,
    severity,
  };
}

describe("buildRouteFeatureFeatureCollection", () => {
  it("builds one feature per route feature, each carrying its own routeFeatureId and visualKey", () => {
    const collection = buildRouteFeatureFeatureCollection(
      POINTS,
      [climb(0, 400, "category-2"), descent(400, 1000, "very-steep")],
      0,
      1000,
    );

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]?.properties.routeFeatureId).toBe("climb-0");
    expect(collection.features[0]?.properties.visualKey).toBe("category-2");
    expect(collection.features[1]?.properties.routeFeatureId).toBe("descent-400");
    expect(collection.features[1]?.properties.visualKey).toBe("very-steep");
  });

  it("clips a feature straddling the clip boundary, truncating its geometry", () => {
    const collection = buildRouteFeatureFeatureCollection(
      POINTS,
      [climb(0, 1000)],
      200,
      600,
    );

    expect(collection.features).toHaveLength(1);
    const coordinates = collection.features[0]?.geometry.coordinates ?? [];
    expect(coordinates[0]).toEqual([0.002, 51]);
    expect(coordinates.at(-1)).toEqual([0.006, 51]);
  });

  it("omits a feature entirely outside the clip range", () => {
    const collection = buildRouteFeatureFeatureCollection(
      POINTS,
      [climb(0, 300), descent(300, 600)],
      700,
      1000,
    );
    expect(collection.features).toHaveLength(0);
  });

  it("omits a degenerate slice shorter than two points", () => {
    const collection = buildRouteFeatureFeatureCollection(
      POINTS,
      [climb(995, 1000)],
      0,
      1000,
    );
    expect(
      collection.features.every((feature) => feature.geometry.coordinates.length >= 2),
    ).toBe(true);
  });

  it("returns an empty collection for no features", () => {
    const collection = buildRouteFeatureFeatureCollection(POINTS, [], 0, 1000);
    expect(collection).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("never mutates points or features", () => {
    const features: RouteFeature[] = [climb(0, 400)];
    const pointsSnapshot = JSON.parse(JSON.stringify(POINTS)) as RoutePoint[];
    const featuresSnapshot = JSON.parse(JSON.stringify(features)) as RouteFeature[];
    buildRouteFeatureFeatureCollection(POINTS, features, 0, 1000);
    expect(POINTS).toEqual(pointsSnapshot);
    expect(features).toEqual(featuresSnapshot);
  });
});

describe("buildSelectedRouteFeatureFeatureCollection", () => {
  const features: RouteFeature[] = [climb(0, 400), descent(400, 1000)];

  it("returns the selected feature's own complete line, unclipped by any remaining-portion window", () => {
    const collection = buildSelectedRouteFeatureFeatureCollection(
      POINTS,
      features,
      "climb-0",
    );
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties.routeFeatureId).toBe("climb-0");
    const coordinates = collection.features[0]?.geometry.coordinates ?? [];
    expect(coordinates[0]).toEqual([0, 51]);
    expect(coordinates.at(-1)).toEqual([0.004, 51]);
  });

  it("returns an empty collection when nothing is selected", () => {
    const collection = buildSelectedRouteFeatureFeatureCollection(POINTS, features, null);
    expect(collection).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("returns an empty collection for a stale id that matches no current feature", () => {
    const collection = buildSelectedRouteFeatureFeatureCollection(
      POINTS,
      features,
      "climb-9999",
    );
    expect(collection).toEqual({ type: "FeatureCollection", features: [] });
  });
});

describe("resolveRouteFeatureIdHit", () => {
  const features: RouteFeature[] = [climb(0, 400), descent(400, 1000)];

  it("accepts a raw id that matches a current feature", () => {
    expect(resolveRouteFeatureIdHit("descent-400", features)).toBe("descent-400");
  });

  it("rejects a non-string value", () => {
    expect(resolveRouteFeatureIdHit(42, features)).toBeNull();
    expect(resolveRouteFeatureIdHit(undefined, features)).toBeNull();
    expect(resolveRouteFeatureIdHit(null, features)).toBeNull();
  });

  it("rejects a string that matches no current feature (a stale hit)", () => {
    expect(resolveRouteFeatureIdHit("climb-9999", features)).toBeNull();
  });
});
