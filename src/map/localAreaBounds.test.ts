import { describe, expect, it } from "vitest";
import { computeLocalAreaBounds, LOCAL_AREA_BOX_SIZE_METRES } from "./localAreaBounds.ts";
import { haversineDistanceMetres } from "../navigation/distance.ts";
import type { Coordinate } from "../domain/types.ts";

// Web Mercator's standard supported latitude limit (matches MapLibre/
// Mapbox GL's own projection limit) — mirrors the module's own internal
// (unexported) constant, used here only to assert the clamp behaviour.
const MAX_WEB_MERCATOR_LATITUDE_DEGREES = 85.0511;

describe("computeLocalAreaBounds", () => {
  it("pins the default box size at 50 km", () => {
    expect(LOCAL_AREA_BOX_SIZE_METRES).toBe(50_000);
  });

  it("frames approximately 50 km north-south and east-west at a typical mid-latitude", () => {
    const centre: Coordinate = [-1.5, 53.8];
    const bounds = computeLocalAreaBounds(centre);
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    const northSouthMetres = haversineDistanceMetres(
      [centre[0], bounds.southWest[1]],
      [centre[0], bounds.northEast[1]],
    );
    const eastWestMetres = haversineDistanceMetres(
      [bounds.southWest[0], centre[1]],
      [bounds.northEast[0], centre[1]],
    );
    expect(northSouthMetres).toBeCloseTo(LOCAL_AREA_BOX_SIZE_METRES, -2);
    expect(eastWestMetres).toBeCloseTo(LOCAL_AREA_BOX_SIZE_METRES, -2);
  });

  it("keeps the centre correct (the box is symmetric around the input coordinate)", () => {
    const centre: Coordinate = [10, 45];
    const bounds = computeLocalAreaBounds(centre);
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    const midLon = (bounds.southWest[0] + bounds.northEast[0]) / 2;
    const midLat = (bounds.southWest[1] + bounds.northEast[1]) / 2;
    expect(midLon).toBeCloseTo(centre[0], 9);
    expect(midLat).toBeCloseTo(centre[1], 9);
  });

  it("produces an equal north-south and east-west degree span at the equator", () => {
    const bounds = computeLocalAreaBounds([0, 0]);
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    const deltaLat = bounds.northEast[1] - 0;
    const deltaLon = bounds.northEast[0] - 0;
    expect(deltaLon).toBeCloseTo(deltaLat, 9);
  });

  it("widens the east-west degree span at a high but supported latitude, versus the equator", () => {
    const equatorBounds = computeLocalAreaBounds([0, 0]);
    const highLatitudeBounds = computeLocalAreaBounds([0, 70]);
    expect(equatorBounds).not.toBeNull();
    expect(highLatitudeBounds).not.toBeNull();
    if (!equatorBounds || !highLatitudeBounds) return;

    const equatorLonSpan = equatorBounds.northEast[0] - equatorBounds.southWest[0];
    const highLatitudeLonSpan =
      highLatitudeBounds.northEast[0] - highLatitudeBounds.southWest[0];
    expect(highLatitudeLonSpan).toBeGreaterThan(equatorLonSpan);
  });

  it("handles a centre near +180° without choosing a near-global span", () => {
    const bounds = computeLocalAreaBounds([179.9, 0]);
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    expect(bounds.southWest[0]).toBeLessThan(bounds.northEast[0]);
    // Deliberately unwrapped past 180°, not reordered — see the module's
    // own doc comment on why wrapping risks a near-global span instead.
    expect(bounds.northEast[0]).toBeGreaterThan(180);
    const lonSpanDegrees = bounds.northEast[0] - bounds.southWest[0];
    expect(lonSpanDegrees).toBeGreaterThan(0.3);
    expect(lonSpanDegrees).toBeLessThan(1);
  });

  it("handles a centre near -180° without choosing a near-global span", () => {
    const bounds = computeLocalAreaBounds([-179.9, 0]);
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    expect(bounds.southWest[0]).toBeLessThan(bounds.northEast[0]);
    expect(bounds.southWest[0]).toBeLessThan(-180);
    const lonSpanDegrees = bounds.northEast[0] - bounds.southWest[0];
    expect(lonSpanDegrees).toBeGreaterThan(0.3);
    expect(lonSpanDegrees).toBeLessThan(1);
  });

  it("clamps the north edge to the Web Mercator latitude limit near the north pole", () => {
    const bounds = computeLocalAreaBounds([0, 84.95]);
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    expect(bounds.northEast[1]).toBe(MAX_WEB_MERCATOR_LATITUDE_DEGREES);
  });

  it("clamps the south edge to the Web Mercator latitude limit near the south pole", () => {
    const bounds = computeLocalAreaBounds([0, -84.95]);
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    expect(bounds.southWest[1]).toBe(-MAX_WEB_MERCATOR_LATITUDE_DEGREES);
  });

  it.each([
    ["non-finite longitude", [Number.NaN, 51] as Coordinate],
    ["non-finite latitude", [0, Number.POSITIVE_INFINITY] as Coordinate],
    ["latitude above 90", [0, 91] as Coordinate],
    ["latitude below -90", [0, -91] as Coordinate],
  ])("returns null for %s", (_label, centre) => {
    expect(computeLocalAreaBounds(centre)).toBeNull();
  });

  it.each([
    ["a zero box size", 0],
    ["a negative box size", -10_000],
    ["a non-finite box size", Number.NaN],
  ])("returns null for %s", (_label, boxSizeMetres) => {
    expect(computeLocalAreaBounds([0, 51], boxSizeMetres)).toBeNull();
  });

  it("scales proportionally with a custom box size", () => {
    const centre: Coordinate = [0, 51];
    const defaultBounds = computeLocalAreaBounds(centre, 50_000);
    const smallerBounds = computeLocalAreaBounds(centre, 10_000);
    expect(defaultBounds).not.toBeNull();
    expect(smallerBounds).not.toBeNull();
    if (!defaultBounds || !smallerBounds) return;

    const defaultDeltaLat = defaultBounds.northEast[1] - centre[1];
    const smallerDeltaLat = smallerBounds.northEast[1] - centre[1];
    expect(smallerDeltaLat * 5).toBeCloseTo(defaultDeltaLat, 9);
  });
});
