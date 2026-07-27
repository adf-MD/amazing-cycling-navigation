import { describe, expect, it } from "vitest";
import {
  buildSelectedWarningFeatureCollection,
  buildWarningFeatureCollectionsByCategory,
  computeSelectedWarningBounds,
  resolveWarningIndexHit,
  WARNING_CATEGORIES_IN_PAINT_ORDER,
  type WarningCategory,
} from "./warningLayer.ts";
import type { RoutePoint, RouteWarning, RouteWarningKind } from "../domain/types.ts";

const POINTS: RoutePoint[] = Array.from({ length: 11 }, (_, index) => ({
  coordinate: [index * 0.001, 51],
  elevationMetres: null,
  distanceFromStartMetres: index * 100,
}));

function buildWarning(
  kind: RouteWarningKind,
  startDistanceMetres: number,
  endDistanceMetres: number,
): RouteWarning {
  return { kind, startDistanceMetres, endDistanceMetres, message: `${kind} warning` };
}

describe("buildWarningFeatureCollectionsByCategory", () => {
  it("maps every warning kind to its documented category", () => {
    const expected: Record<RouteWarningKind, WarningCategory> = {
      "unknown-surface": "unknown-surface",
      "questionable-surface": "questionable-surface",
      "unsuitable-surface": "unsuitable-surface",
      access: "obstacle",
      steps: "obstacle",
      ford: "obstacle",
      ferry: "ferry",
      other: "other",
    };

    for (const [kind, category] of Object.entries(expected) as [
      RouteWarningKind,
      WarningCategory,
    ][]) {
      const warning = buildWarning(kind, 0, 300);
      const collections = buildWarningFeatureCollectionsByCategory(POINTS, [warning]);
      expect(collections[category].features).toHaveLength(1);
      for (const otherCategory of WARNING_CATEGORIES_IN_PAINT_ORDER) {
        if (otherCategory === category) continue;
        expect(collections[otherCategory].features).toHaveLength(0);
      }
    }
  });

  it("renders one separate Feature per warning within a category, never a joined line", () => {
    const warnings = [buildWarning("ford", 0, 100), buildWarning("ford", 500, 600)];
    const collections = buildWarningFeatureCollectionsByCategory(POINTS, warnings);

    expect(collections.obstacle.features).toHaveLength(2);
    const firstCoordinates = collections.obstacle.features[0]?.geometry.coordinates;
    const secondCoordinates = collections.obstacle.features[1]?.geometry.coordinates;
    // Each feature's own coordinates stay within its own warning's range —
    // never bridged across the gap between the two fords.
    expect(firstCoordinates?.at(-1)?.[0]).toBeCloseTo(0.001, 6);
    expect(secondCoordinates?.[0]?.[0]).toBeCloseTo(0.005, 6);
  });

  it("omits a warning whose sliced geometry is too short to draw", () => {
    const warning = buildWarning("questionable-surface", 50, 50); // zero-length
    const collections = buildWarningFeatureCollectionsByCategory(POINTS, [warning]);

    expect(collections["questionable-surface"].features).toHaveLength(0);
  });

  it("returns every category empty for an empty warnings list", () => {
    const collections = buildWarningFeatureCollectionsByCategory(POINTS, []);

    for (const category of WARNING_CATEGORIES_IN_PAINT_ORDER) {
      expect(collections[category].features).toEqual([]);
    }
  });

  it("stamps each feature's warningIndex from its position in the flat warnings array, across mixed categories", () => {
    const warnings = [
      buildWarning("unknown-surface", 0, 100), // index 0
      buildWarning("ford", 100, 200), // index 1 -> obstacle
      buildWarning("questionable-surface", 200, 300), // index 2
    ];
    const collections = buildWarningFeatureCollectionsByCategory(POINTS, warnings);

    expect(collections["unknown-surface"].features[0]?.properties.warningIndex).toBe(0);
    expect(collections.obstacle.features[0]?.properties.warningIndex).toBe(1);
    expect(collections["questionable-surface"].features[0]?.properties.warningIndex).toBe(
      2,
    );
  });

  it("keeps later warningIndex values aligned when an earlier warning is skipped as undrawable", () => {
    const warnings = [
      buildWarning("questionable-surface", 50, 50), // index 0, zero-length, skipped
      buildWarning("unsuitable-surface", 100, 300), // index 1
    ];
    const collections = buildWarningFeatureCollectionsByCategory(POINTS, warnings);

    expect(collections["questionable-surface"].features).toHaveLength(0);
    expect(collections["unsuitable-surface"].features).toHaveLength(1);
    expect(collections["unsuitable-surface"].features[0]?.properties.warningIndex).toBe(
      1,
    );
  });
});

describe("buildSelectedWarningFeatureCollection", () => {
  const warnings = [buildWarning("unsuitable-surface", 100, 300)];

  it("returns empty when no warning is selected", () => {
    expect(
      buildSelectedWarningFeatureCollection(POINTS, warnings, null).features,
    ).toEqual([]);
  });

  it("returns empty for an out-of-range selected index", () => {
    expect(buildSelectedWarningFeatureCollection(POINTS, warnings, 5).features).toEqual(
      [],
    );
  });

  it("returns the selected warning's own line", () => {
    const result = buildSelectedWarningFeatureCollection(POINTS, warnings, 0);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.geometry.coordinates).toEqual([
      [0.001, 51],
      [0.002, 51],
      [0.003, 51],
    ]);
  });

  it("stamps the selected feature's own warningIndex", () => {
    const result = buildSelectedWarningFeatureCollection(POINTS, warnings, 0);
    expect(result.features[0]?.properties?.warningIndex).toBe(0);
  });
});

describe("resolveWarningIndexHit", () => {
  it("accepts a valid in-range integer", () => {
    expect(resolveWarningIndexHit(2, 5)).toBe(2);
    expect(resolveWarningIndexHit(0, 5)).toBe(0);
  });

  it("rejects a non-number", () => {
    expect(resolveWarningIndexHit("2", 5)).toBeNull();
    expect(resolveWarningIndexHit(undefined, 5)).toBeNull();
    expect(resolveWarningIndexHit(null, 5)).toBeNull();
  });

  it("rejects NaN", () => {
    expect(resolveWarningIndexHit(NaN, 5)).toBeNull();
  });

  it("rejects a fractional value", () => {
    expect(resolveWarningIndexHit(1.5, 5)).toBeNull();
  });

  it("rejects a negative value", () => {
    expect(resolveWarningIndexHit(-1, 5)).toBeNull();
  });

  it("rejects an index exactly equal to warningsLength (off-by-one boundary)", () => {
    expect(resolveWarningIndexHit(5, 5)).toBeNull();
  });
});

describe("computeSelectedWarningBounds", () => {
  const warnings = [buildWarning("unsuitable-surface", 100, 300)];

  it("returns null when nothing is selected", () => {
    expect(computeSelectedWarningBounds(POINTS, warnings, null)).toBeNull();
  });

  it("returns null for an out-of-range selected index", () => {
    expect(computeSelectedWarningBounds(POINTS, warnings, 5)).toBeNull();
  });

  it("returns the narrower bounds of just the selected warning's segment", () => {
    const bounds = computeSelectedWarningBounds(POINTS, warnings, 0);
    expect(bounds).toEqual({ southWest: [0.001, 51], northEast: [0.003, 51] });
  });
});
