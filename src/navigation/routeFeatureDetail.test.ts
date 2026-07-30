import { describe, expect, it } from "vitest";
import { analyzeRouteElevationProfile } from "./gradient.ts";
import { buildFeatureDetailSegments } from "./routeFeatureDetail.ts";
import {
  detectRouteFeatures,
  type ClimbFeature,
  type DescentFeature,
} from "./routeFeatures.ts";
import type { RoutePoint } from "../domain/types.ts";

const STEP_METRES = 20;

function buildPoints(
  elevations: readonly number[],
  stepMetres = STEP_METRES,
): RoutePoint[] {
  return elevations.map((elevationMetres, index) => ({
    coordinate: [0, 51] as const,
    elevationMetres,
    distanceFromStartMetres: index * stepMetres,
  }));
}

function buildLeg(
  startElevationMetres: number,
  lengthMetres: number,
  gradePercent: number,
  stepMetres = STEP_METRES,
): { elevationMetres: number }[] {
  const pointCount = Math.round(lengthMetres / stepMetres) + 1;
  return Array.from({ length: pointCount }, (_, i) => ({
    elevationMetres: startElevationMetres + (i * stepMetres * gradePercent) / 100,
  }));
}

function buildLeggedRoute(
  legs: readonly { lengthMetres: number; gradePercent: number }[],
  stepMetres = STEP_METRES,
): RoutePoint[] {
  const elevations: number[] = [0];
  let elevation = 0;
  for (const leg of legs) {
    const legPoints = buildLeg(elevation, leg.lengthMetres, leg.gradePercent, stepMetres);
    for (const point of legPoints.slice(1)) {
      elevations.push(point.elevationMetres);
    }
    elevation = legPoints.at(-1)?.elevationMetres ?? elevation;
  }
  return buildPoints(elevations, stepMetres);
}

describe("buildFeatureDetailSegments: climb", () => {
  it("crosses multiple Garmin-style bands within one steepening climb", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 1000, gradePercent: 2 }, // gentle-or-descending
      { lengthMetres: 1000, gradePercent: 7 }, // hard-climb
      { lengthMetres: 1000, gradePercent: 13 }, // extremely-steep-climb
    ]);
    const profile = analyzeRouteElevationProfile(points);
    const [climb] = detectRouteFeatures(profile).filter(
      (feature): feature is ClimbFeature => feature.kind === "climb",
    );
    if (!climb) throw new Error("expected a climb feature");

    const segments = buildFeatureDetailSegments(climb, profile.runs);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.startDistanceMetres).toBeCloseTo(climb.startDistanceMetres, 0);
    expect(segments.at(-1)?.endDistanceMetres).toBeCloseTo(climb.endDistanceMetres, 0);

    const bands = new Set(segments.map((segment) => segment.visualKey));
    expect(bands.has("hard-climb")).toBe(true);
    expect(bands.has("extremely-steep-climb")).toBe(true);
  });

  it("classifies a brief flat/descending dip inside a climb as the lowest (green) band, not a gap", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 1500, gradePercent: 10 },
      { lengthMetres: 200, gradePercent: -2 }, // shallow dip, bridged by reversal logic into the same climb
      { lengthMetres: 1500, gradePercent: 10 },
    ]);
    const profile = analyzeRouteElevationProfile(points);
    const [climb] = detectRouteFeatures(profile).filter(
      (feature): feature is ClimbFeature => feature.kind === "climb",
    );
    if (!climb) throw new Error("expected a climb feature");

    const segments = buildFeatureDetailSegments(climb, profile.runs);
    const dipDistance = 1600;
    const covering = segments.find(
      (segment) =>
        segment.startDistanceMetres <= dipDistance &&
        segment.endDistanceMetres >= dipDistance,
    );
    expect(covering?.visualKey).toBe("gentle-or-descending");
  });
});

describe("buildFeatureDetailSegments: descent", () => {
  it("classifies steep local sections into descent bands, clipped to the descent's own bounds", () => {
    const points = buildLeggedRoute([{ lengthMetres: 2000, gradePercent: -8 }]);
    const profile = analyzeRouteElevationProfile(points);
    const [descent] = detectRouteFeatures(profile).filter(
      (feature): feature is DescentFeature => feature.kind === "descent",
    );
    if (!descent) throw new Error("expected a descent feature");

    const segments = buildFeatureDetailSegments(descent, profile.runs);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.startDistanceMetres).toBeCloseTo(descent.startDistanceMetres, 0);
    expect(segments.at(-1)?.endDistanceMetres).toBeCloseTo(descent.endDistanceMetres, 0);
    for (const segment of segments) {
      expect(segment.visualKey).toBe("steep");
    }
  });

  it("classifies a shallow/flat section inside a descent as neutral, not a blue band", () => {
    const points = buildLeggedRoute([
      { lengthMetres: 1500, gradePercent: -10 },
      { lengthMetres: 250, gradePercent: -1 }, // shallow, bridged into the same descent
      { lengthMetres: 1500, gradePercent: -10 },
    ]);
    const profile = analyzeRouteElevationProfile(points);
    const [descent] = detectRouteFeatures(profile).filter(
      (feature): feature is DescentFeature => feature.kind === "descent",
    );
    if (!descent) throw new Error("expected a descent feature");

    const segments = buildFeatureDetailSegments(descent, profile.runs);
    const shallowDistance = 1600;
    const covering = segments.find(
      (segment) =>
        segment.startDistanceMetres <= shallowDistance &&
        segment.endDistanceMetres >= shallowDistance,
    );
    expect(covering?.visualKey).toBe("neutral");
  });
});

describe("buildFeatureDetailSegments: defensive cases", () => {
  it("returns an empty array when no run owns the feature (stale feature/run pairing)", () => {
    const climb: ClimbFeature = {
      id: "climb-0",
      kind: "climb",
      startDistanceMetres: 0,
      endDistanceMetres: 1000,
      lengthMetres: 1000,
      elevationGainMetres: 60,
      averageGradientPercent: 6,
      maxGradientPercent: 8,
      climbScore: 6000,
      category: "category-4",
    };
    expect(buildFeatureDetailSegments(climb, [])).toEqual([]);
  });
});
