import { describe, expect, it } from "vitest";
import type { ClassifiedSegment } from "../navigation/gradient.ts";
import type { MicroDetailVisualKey } from "../navigation/routeFeaturePalette.ts";
import {
  ACTIVE_DIRECTION_COLOURS,
  ORDINARY_ROUTE_COLOUR,
} from "../navigation/routeFeaturePalette.ts";
import type { ClimbFeature, DescentFeature } from "../navigation/routeFeatures.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import {
  ACTIVE_DIRECTION_AHEAD_METRES,
  buildActiveDirectionFeatureCollection,
  buildActiveDirectionSpans,
} from "./activeDirectionLayer.ts";

// A straight 4000 m route, densely sampled, so a window's boundary
// distances are always interpolatable.
const POINTS = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.0574, 51],
  ],
  400,
);
const ROUTE_LENGTH_METRES = POINTS.at(-1)?.distanceFromStartMetres ?? 0;

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
    averageGradientPercent: 8,
    elevationGainMetres: 100,
    maxGradientPercent: 12,
    climbScore: 20_000,
    category,
  };
}

function descent(
  startDistanceMetres: number,
  endDistanceMetres: number,
  band: DescentFeature["band"] = "very-steep",
): DescentFeature {
  return {
    id: `descent-${String(startDistanceMetres)}`,
    kind: "descent",
    startDistanceMetres,
    endDistanceMetres,
    lengthMetres: endDistanceMetres - startDistanceMetres,
    averageGradientPercent: -8,
    elevationLossMetres: 100,
    maxGradientPercent: -12,
    band,
  };
}

function micro(
  startDistanceMetres: number,
  endDistanceMetres: number,
  visualKey: MicroDetailVisualKey,
): ClassifiedSegment<MicroDetailVisualKey> {
  return {
    startDistanceMetres,
    endDistanceMetres,
    averageGradientPercent: 8,
    visualKey,
  };
}

function keysOf(spans: { visualKey: string }[]): string[] {
  return spans.map((span) => span.visualKey);
}

describe("buildActiveDirectionSpans (backlog item 98)", () => {
  it("produces nothing for a route with no length", () => {
    expect(
      buildActiveDirectionSpans({
        features: [],
        microSegments: [],
        progressDistanceMetres: 0,
        routeLengthMetres: 0,
      }),
    ).toEqual([]);
  });

  it("produces nothing for a non-finite progress value", () => {
    expect(
      buildActiveDirectionSpans({
        features: [],
        microSegments: [],
        progressDistanceMetres: Number.NaN,
        routeLengthMetres: ROUTE_LENGTH_METRES,
      }),
    ).toEqual([]);
  });

  it("falls back to the ordinary-route key across a wholly unclassified window", () => {
    const spans = buildActiveDirectionSpans({
      features: [],
      microSegments: [],
      progressDistanceMetres: 1000,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });

    expect(spans).toHaveLength(1);
    expect(spans[0]?.visualKey).toBe("ordinary-route");
    expect(spans[0]?.startDistanceMetres).toBe(1000);
    expect(spans[0]?.endDistanceMetres).toBe(1000 + ACTIVE_DIRECTION_AHEAD_METRES);
  });

  it("resolves the ordinary-route key to exactly the existing remaining-route green", () => {
    expect(ACTIVE_DIRECTION_COLOURS["ordinary-route"]).toBe(ORDINARY_ROUTE_COLOUR);
    expect(ACTIVE_DIRECTION_COLOURS["ordinary-route"]).toBe("#0a5f38");
  });

  it("starts exactly at progress, with no look-back behind the rider", () => {
    const spans = buildActiveDirectionSpans({
      features: [],
      microSegments: [],
      progressDistanceMetres: 1234.5,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });

    expect(spans[0]?.startDistanceMetres).toBe(1234.5);
  });

  it("clamps the window at the route end and empties once there is nothing left", () => {
    const nearEnd = buildActiveDirectionSpans({
      features: [],
      microSegments: [],
      progressDistanceMetres: ROUTE_LENGTH_METRES - 40,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });
    expect(nearEnd.at(-1)?.endDistanceMetres).toBe(ROUTE_LENGTH_METRES);

    expect(
      buildActiveDirectionSpans({
        features: [],
        microSegments: [],
        progressDistanceMetres: ROUTE_LENGTH_METRES,
        routeLengthMetres: ROUTE_LENGTH_METRES,
      }),
    ).toEqual([]);
  });

  it("uses a recognised feature's macro key where no micro detail covers it", () => {
    const spans = buildActiveDirectionSpans({
      features: [climb(500, 2000, "category-2")],
      microSegments: [],
      progressDistanceMetres: 1000,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });

    expect(keysOf(spans)).toEqual(["category-2"]);
  });

  it("prefers micro detail over the macro key wherever the detailed feature covers the window", () => {
    const spans = buildActiveDirectionSpans({
      features: [climb(500, 2000)],
      microSegments: [micro(500, 2000, "very-hard-climb")],
      progressDistanceMetres: 1000,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });

    expect(keysOf(spans)).toEqual(["very-hard-climb"]);
  });

  it("uses the containing feature's macro key when the micro detail belongs to a DIFFERENT feature", () => {
    // The rider is climbing, but a return descent is explicitly selected,
    // so microDetailSegments describe the descent, not the road underneath.
    // The window must still resolve to the climb the rider is actually on.
    const spans = buildActiveDirectionSpans({
      features: [climb(500, 2000), descent(2000, 3500)],
      microSegments: [micro(2000, 3500, "very-steep")],
      progressDistanceMetres: 1000,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });

    expect(keysOf(spans)).toEqual(["category-3"]);
  });

  it("splits at feature and micro boundaries, and merges adjacent equal keys", () => {
    const spans = buildActiveDirectionSpans({
      features: [climb(500, 1100), descent(1100, 3000)],
      microSegments: [micro(1100, 1200, "neutral"), micro(1200, 3000, "very-steep")],
      progressDistanceMetres: 1000,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });

    expect(spans.map((span) => [span.startDistanceMetres, span.visualKey])).toEqual([
      [1000, "category-3"],
      [1100, "neutral"],
      [1200, "very-steep"],
    ]);
    // Contiguous: each span starts exactly where the previous one ended.
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index]?.startDistanceMetres).toBe(spans[index - 1]?.endDistanceMetres);
    }
  });

  it("gives the span nearest the rider the highest paint priority", () => {
    const spans = buildActiveDirectionSpans({
      features: [climb(500, 1100), descent(1100, 3000)],
      microSegments: [],
      progressDistanceMetres: 1000,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });

    expect(spans).toHaveLength(2);
    expect(spans[0]?.paintPriority).toBe(0);
    expect(spans[1]?.paintPriority).toBeLessThan(spans[0]?.paintPriority ?? 0);
  });

  it("never mutates the features or micro segments it is given", () => {
    const features = [climb(500, 2000)];
    const microSegments = [micro(500, 2000, "very-hard-climb")];
    const featuresSnapshot = structuredClone(features);
    const microSnapshot = structuredClone(microSegments);

    buildActiveDirectionSpans({
      features,
      microSegments,
      progressDistanceMetres: 1000,
      routeLengthMetres: ROUTE_LENGTH_METRES,
    });

    expect(features).toEqual(featuresSnapshot);
    expect(microSegments).toEqual(microSnapshot);
  });

  describe("the window's exact limit", () => {
    it("includes a feature boundary just below the limit", () => {
      const boundary = 1000 + ACTIVE_DIRECTION_AHEAD_METRES - 1;
      const spans = buildActiveDirectionSpans({
        features: [descent(boundary, 3000)],
        microSegments: [],
        progressDistanceMetres: 1000,
        routeLengthMetres: ROUTE_LENGTH_METRES,
      });
      expect(keysOf(spans)).toEqual(["ordinary-route", "very-steep"]);
    });

    it("excludes a feature starting exactly at the limit", () => {
      const boundary = 1000 + ACTIVE_DIRECTION_AHEAD_METRES;
      const spans = buildActiveDirectionSpans({
        features: [descent(boundary, 3000)],
        microSegments: [],
        progressDistanceMetres: 1000,
        routeLengthMetres: ROUTE_LENGTH_METRES,
      });
      expect(keysOf(spans)).toEqual(["ordinary-route"]);
    });

    it("excludes a feature starting just above the limit", () => {
      const boundary = 1000 + ACTIVE_DIRECTION_AHEAD_METRES + 1;
      const spans = buildActiveDirectionSpans({
        features: [descent(boundary, 3000)],
        microSegments: [],
        progressDistanceMetres: 1000,
        routeLengthMetres: ROUTE_LENGTH_METRES,
      });
      expect(keysOf(spans)).toEqual(["ordinary-route"]);
    });
  });
});

describe("buildActiveDirectionFeatureCollection (backlog item 98)", () => {
  const spans = buildActiveDirectionSpans({
    features: [climb(500, 1100), descent(1100, 3000)],
    microSegments: [],
    progressDistanceMetres: 1000,
    routeLengthMetres: ROUTE_LENGTH_METRES,
  });

  it("stamps both the visual key and the paint priority onto every feature", () => {
    const collection = buildActiveDirectionFeatureCollection(
      POINTS,
      spans,
      0,
      ROUTE_LENGTH_METRES,
    );

    expect(collection.features).toHaveLength(2);
    for (const feature of collection.features) {
      expect(typeof feature.properties.visualKey).toBe("string");
      expect(typeof feature.properties.paintPriority).toBe("number");
    }
  });

  it("emits farthest-first, so the span nearest the rider is last in the source too", () => {
    const collection = buildActiveDirectionFeatureCollection(
      POINTS,
      spans,
      0,
      ROUTE_LENGTH_METRES,
    );

    const priorities = collection.features.map(
      (feature) => feature.properties.paintPriority,
    );
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    expect(collection.features.at(-1)?.properties.visualKey).toBe("category-3");
  });

  it("does not depend on the order the spans arrive in", () => {
    const forwards = buildActiveDirectionFeatureCollection(
      POINTS,
      spans,
      0,
      ROUTE_LENGTH_METRES,
    );
    const backwards = buildActiveDirectionFeatureCollection(
      POINTS,
      [...spans].reverse(),
      0,
      ROUTE_LENGTH_METRES,
    );

    expect(backwards.features.map((feature) => feature.properties)).toEqual(
      forwards.features.map((feature) => feature.properties),
    );
  });

  it("clips to the caller's range and drops anything left with fewer than two points", () => {
    const collection = buildActiveDirectionFeatureCollection(
      POINTS,
      spans,
      1150,
      ROUTE_LENGTH_METRES,
    );

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties.visualKey).toBe("very-steep");
  });

  it("produces a valid empty collection when the clip range excludes everything", () => {
    const collection = buildActiveDirectionFeatureCollection(POINTS, spans, 3900, 4000);
    expect(collection).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("produces a valid empty collection for a route with fewer than two points", () => {
    expect(
      buildActiveDirectionFeatureCollection([], spans, 0, ROUTE_LENGTH_METRES).features,
    ).toEqual([]);
    expect(
      buildActiveDirectionFeatureCollection(
        POINTS.slice(0, 1),
        spans,
        0,
        ROUTE_LENGTH_METRES,
      ).features,
    ).toEqual([]);
  });

  it("gives adjacent spans exactly-shared seam coordinates", () => {
    const collection = buildActiveDirectionFeatureCollection(
      POINTS,
      spans,
      0,
      ROUTE_LENGTH_METRES,
    );
    const nearer = collection.features.at(-1);
    const farther = collection.features.at(-2);

    expect(nearer?.geometry.coordinates.at(-1)).toEqual(
      farther?.geometry.coordinates.at(0),
    );
  });
});
