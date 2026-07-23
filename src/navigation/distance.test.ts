import { describe, expect, it } from "vitest";
import {
  cumulativeDistancesMetres,
  haversineDistanceMetres,
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
