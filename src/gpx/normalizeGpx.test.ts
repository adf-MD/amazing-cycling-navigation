import { describe, expect, it } from "vitest";
import { buildPlannedRouteFromGpx, normalizeGpxPoints } from "./normalizeGpx.ts";
import { haversineDistanceMetres } from "../navigation/distance.ts";
import type { RawGpxPoint } from "./parseGpx.ts";

const firstRawPoint: RawGpxPoint = { coordinate: [0, 51], elevationMetres: 10 };
const rawPoints: RawGpxPoint[] = [
  firstRawPoint,
  { coordinate: [0.001, 51], elevationMetres: 12 },
  { coordinate: [0.002, 51.001], elevationMetres: null },
];

describe("normalizeGpxPoints", () => {
  it("assigns cumulative distanceFromStartMetres and preserves elevation", () => {
    const { points, distanceMetres } = normalizeGpxPoints(rawPoints);

    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({
      coordinate: [0, 51],
      elevationMetres: 10,
      distanceFromStartMetres: 0,
    });

    const expectedSecondDistance = haversineDistanceMetres([0, 51], [0.001, 51]);
    expect(points[1]?.distanceFromStartMetres).toBeCloseTo(expectedSecondDistance, 6);
    expect(points[1]?.elevationMetres).toBe(12);
    expect(points[2]?.elevationMetres).toBeNull();

    expect(distanceMetres).toBe(points.at(-1)?.distanceFromStartMetres);
  });

  it("handles a single point route with zero distance", () => {
    const { points, distanceMetres } = normalizeGpxPoints([firstRawPoint]);
    expect(points[0]?.distanceFromStartMetres).toBe(0);
    expect(distanceMetres).toBe(0);
  });
});

describe("buildPlannedRouteFromGpx", () => {
  it("builds a PlannedRoute and computes ascent/descent when elevation exists", () => {
    const route = buildPlannedRouteFromGpx(rawPoints, {
      name: "Evening loop",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(route.name).toBe("Evening loop");
    expect(route.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(route.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(route.points).toHaveLength(3);
    expect(route.manoeuvres).toEqual([]);
    expect(route.warnings).toEqual([]);
    expect(route.surfaceSummary).toBeUndefined();
    expect(route.ascentMetres).not.toBeNull();
    expect(route.descentMetres).not.toBeNull();
    expect(route.source).toEqual({ kind: "gpx-import" });
  });

  it("leaves ascent/descent null when no point has elevation", () => {
    const pointsWithoutElevation: RawGpxPoint[] = [
      { coordinate: [0, 51], elevationMetres: null },
      { coordinate: [0.001, 51], elevationMetres: null },
    ];

    const route = buildPlannedRouteFromGpx(pointsWithoutElevation, {
      name: "No elevation route",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(route.ascentMetres).toBeNull();
    expect(route.descentMetres).toBeNull();
  });
});
