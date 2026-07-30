import { describe, expect, it } from "vitest";
import {
  cumulativeDistancesMetres,
  haversineDistanceMetres,
  nearestPointIndexForDistance,
  totalDistanceMetres,
} from "./distance.ts";
import type { Coordinate } from "../domain/types.ts";

describe("haversineDistanceMetres", () => {
  it("returns 0 for identical coordinates", () => {
    const point: Coordinate = [-1.5, 53.8];
    expect(haversineDistanceMetres(point, point)).toBe(0);
  });

  it("is symmetric", () => {
    const a: Coordinate = [-1.5, 53.8];
    const b: Coordinate = [-1.4, 53.81];
    expect(haversineDistanceMetres(a, b)).toBeCloseTo(haversineDistanceMetres(b, a), 9);
  });

  it("matches the internationally defined nautical mile for one minute of latitude", () => {
    // One minute of arc of latitude was the historical definition of the
    // nautical mile, standardised at exactly 1852 m — an independently
    // documented figure this formula should reproduce closely on a
    // sphere of the IUGG mean Earth radius.
    const a: Coordinate = [0, 51];
    const b: Coordinate = [0, 51 + 1 / 60];
    const distance = haversineDistanceMetres(a, b);
    expect(Math.abs(distance - 1852)).toBeLessThan(2);
  });

  it("gives the same per-degree distance along the equator as along a meridian", () => {
    const meridian = haversineDistanceMetres([0, 0], [0, 1]);
    const equator = haversineDistanceMetres([0, 0], [1, 0]);
    expect(meridian).toBeCloseTo(equator, 6);
  });
});

describe("cumulativeDistancesMetres", () => {
  it("starts at 0 and accumulates point-to-point haversine distances", () => {
    const [first, second, third]: [Coordinate, Coordinate, Coordinate] = [
      [0, 51],
      [0.001, 51],
      [0.002, 51.001],
    ];

    const cumulative = cumulativeDistancesMetres([first, second, third]);
    const expectedSecond = haversineDistanceMetres(first, second);
    const expectedThird = expectedSecond + haversineDistanceMetres(second, third);

    expect(cumulative).toEqual([0, expectedSecond, expectedThird]);
  });

  it("returns an empty array for no coordinates", () => {
    expect(cumulativeDistancesMetres([])).toEqual([]);
  });

  it("returns [0] for a single coordinate", () => {
    expect(cumulativeDistancesMetres([[0, 51]])).toEqual([0]);
  });
});

describe("totalDistanceMetres", () => {
  it("equals the last cumulative distance", () => {
    const points: Coordinate[] = [
      [0, 51],
      [0.01, 51],
      [0.02, 51.01],
    ];
    expect(totalDistanceMetres(points)).toBe(cumulativeDistancesMetres(points).at(-1));
  });

  it("is 0 for an empty or single-point route", () => {
    expect(totalDistanceMetres([])).toBe(0);
    expect(totalDistanceMetres([[0, 51]])).toBe(0);
  });
});

describe("nearestPointIndexForDistance", () => {
  const DISTANCES = [0, 10, 30, 60, 100];

  it("returns -1 for an empty array", () => {
    expect(nearestPointIndexForDistance([], 50)).toBe(-1);
  });

  it("returns 0 for a single-point array regardless of target", () => {
    expect(nearestPointIndexForDistance([42], 0)).toBe(0);
    expect(nearestPointIndexForDistance([42], 1000)).toBe(0);
  });

  it("returns the exact index for a distance matching a point exactly", () => {
    expect(nearestPointIndexForDistance(DISTANCES, 30)).toBe(2);
  });

  it("returns the nearer neighbour for a distance between two points", () => {
    // Between 10 and 30, closer to 10.
    expect(nearestPointIndexForDistance(DISTANCES, 15)).toBe(1);
    // Between 30 and 60, closer to 60.
    expect(nearestPointIndexForDistance(DISTANCES, 50)).toBe(3);
  });

  it("breaks an exact tie by choosing the earlier index", () => {
    // Exactly midway between 10 (index 1) and 30 (index 2).
    expect(nearestPointIndexForDistance(DISTANCES, 20)).toBe(1);
  });

  it("clamps to the first index for a target below the range", () => {
    expect(nearestPointIndexForDistance(DISTANCES, -50)).toBe(0);
  });

  it("clamps to the last index for a target above the range", () => {
    expect(nearestPointIndexForDistance(DISTANCES, 500)).toBe(4);
  });
});
