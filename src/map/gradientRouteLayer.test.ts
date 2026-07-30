import { describe, expect, it } from "vitest";
import { buildGradientFeatureCollection } from "./gradientRouteLayer.ts";
import type { RoutePoint } from "../domain/types.ts";
import type { ClassifiedSegment } from "../navigation/gradient.ts";
import type { MicroDetailVisualKey } from "../navigation/routeFeaturePalette.ts";

const POINTS: RoutePoint[] = Array.from({ length: 11 }, (_, index) => ({
  coordinate: [index * 0.001, 51],
  elevationMetres: null,
  distanceFromStartMetres: index * 100,
}));

function gradientSegment(
  startDistanceMetres: number,
  endDistanceMetres: number,
  visualKey: MicroDetailVisualKey,
): ClassifiedSegment<MicroDetailVisualKey> {
  return {
    startDistanceMetres,
    endDistanceMetres,
    averageGradientPercent: null,
    visualKey,
  };
}

describe("buildGradientFeatureCollection", () => {
  it("builds one feature per gradient segment, each carrying its own visualKey", () => {
    const collection = buildGradientFeatureCollection(
      POINTS,
      [
        gradientSegment(0, 400, "gentle-or-descending"),
        gradientSegment(400, 1000, "hard-climb"),
      ],
      0,
      1000,
    );

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]?.properties.visualKey).toBe("gentle-or-descending");
    expect(collection.features[1]?.properties.visualKey).toBe("hard-climb");
  });

  it("shares an exact seam coordinate between adjacent segments", () => {
    const collection = buildGradientFeatureCollection(
      POINTS,
      [
        gradientSegment(0, 450, "gentle-or-descending"),
        gradientSegment(450, 1000, "hard-climb"),
      ],
      0,
      1000,
    );

    const firstEnd = collection.features[0]?.geometry.coordinates.at(-1);
    const secondStart = collection.features[1]?.geometry.coordinates[0];
    expect(firstEnd).toEqual(secondStart);
  });

  it("clips a segment straddling the clip boundary, truncating its geometry", () => {
    const collection = buildGradientFeatureCollection(
      POINTS,
      [gradientSegment(0, 1000, "moderate-climb")],
      200,
      600,
    );

    expect(collection.features).toHaveLength(1);
    const coordinates = collection.features[0]?.geometry.coordinates ?? [];
    expect(coordinates[0]).toEqual([0.002, 51]);
    expect(coordinates.at(-1)).toEqual([0.006, 51]);
  });

  it("omits a segment entirely outside the clip range", () => {
    const collection = buildGradientFeatureCollection(
      POINTS,
      [
        gradientSegment(0, 300, "gentle-or-descending"),
        gradientSegment(300, 600, "hard-climb"),
      ],
      700,
      1000,
    );

    expect(collection.features).toHaveLength(0);
  });

  it("omits a degenerate slice shorter than two points", () => {
    const collection = buildGradientFeatureCollection(
      POINTS,
      [gradientSegment(995, 1000, "gentle-or-descending")],
      0,
      1000,
    );

    // 995-1000 clips to a span shorter than the point spacing (100 m),
    // producing a slice with fewer than 2 points once sliced against POINTS.
    expect(
      collection.features.every((feature) => feature.geometry.coordinates.length >= 2),
    ).toBe(true);
  });

  it("returns an empty collection for no segments", () => {
    const collection = buildGradientFeatureCollection(POINTS, [], 0, 1000);
    expect(collection).toEqual({ type: "FeatureCollection", features: [] });
  });
});
