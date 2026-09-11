import { describe, expect, it } from "vitest";
import {
  geographicBearingDegrees,
  normaliseBearingDegrees,
  routeTangentBearingDegrees,
  shortestAngularDifferenceDegrees,
  toDisplayBearingDegrees,
} from "./bearing.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import type { RoutePoint } from "../domain/types.ts";

describe("geographicBearingDegrees", () => {
  // North/south use a shared longitude (any latitude): the forward-azimuth
  // formula reduces exactly to 0/180 in that case, regardless of latitude.
  it("is 0 for due north", () => {
    expect(geographicBearingDegrees([0, 10], [0, 20])).toBeCloseTo(0, 6);
  });

  it("is 180 for due south", () => {
    expect(geographicBearingDegrees([0, 20], [0, 10])).toBeCloseTo(180, 6);
  });

  // East/west use the equator (any longitude delta): the formula reduces
  // exactly to 90/270 there, avoiding latitude-distortion tolerance issues.
  it("is 90 for due east", () => {
    expect(geographicBearingDegrees([0, 0], [10, 0])).toBeCloseTo(90, 6);
  });

  it("is 270 for due west", () => {
    expect(geographicBearingDegrees([10, 0], [0, 0])).toBeCloseTo(270, 6);
  });
});

describe("normaliseBearingDegrees", () => {
  it("leaves an in-range bearing unchanged", () => {
    expect(normaliseBearingDegrees(90)).toBe(90);
  });

  it("wraps a bearing at or above 360", () => {
    expect(normaliseBearingDegrees(370)).toBe(10);
    expect(normaliseBearingDegrees(360)).toBe(0);
  });

  it("wraps a negative bearing", () => {
    expect(normaliseBearingDegrees(-10)).toBe(350);
  });
});

describe("toDisplayBearingDegrees", () => {
  // Backlog item 110. These are the exact cardinal cases the north-up
  // control's arrow is specified against — 0 up, 90 left, 180 down,
  // 270/-90 right — expressed here in the one canonical domain the
  // presentation layer is allowed to see.
  it("leaves the cardinal bearings in [0, 360)", () => {
    expect(toDisplayBearingDegrees(0)).toBe(0);
    expect(toDisplayBearingDegrees(90)).toBe(90);
    expect(toDisplayBearingDegrees(180)).toBe(180);
    expect(toDisplayBearingDegrees(270)).toBe(270);
  });

  // MapLibre's own getBearing() reports a signed [-180, 180) value (its
  // setBearing wraps before converting to radians), while a
  // RideCameraCommand reports [0, 360) for the same orientation. Both
  // reach this boundary, so they must come out identical.
  it("maps MapLibre's signed readback onto the same value as a command", () => {
    expect(toDisplayBearingDegrees(-90)).toBe(270);
    expect(toDisplayBearingDegrees(-90)).toBe(toDisplayBearingDegrees(270));
    expect(toDisplayBearingDegrees(-180)).toBe(180);
    expect(toDisplayBearingDegrees(-1)).toBe(359);
  });

  it("wraps values at or beyond one full revolution", () => {
    expect(toDisplayBearingDegrees(360)).toBe(0);
    expect(toDisplayBearingDegrees(370)).toBe(10);
    expect(toDisplayBearingDegrees(725)).toBe(5);
    expect(toDisplayBearingDegrees(-725)).toBe(355);
  });

  // Rounding happens inside the wrap, so a bearing just short of a full
  // revolution must come out as 0 rather than 360.
  it("rounds to whole degrees, wrapping again if rounding reaches 360", () => {
    expect(toDisplayBearingDegrees(44.4)).toBe(44);
    expect(toDisplayBearingDegrees(44.6)).toBe(45);
    expect(toDisplayBearingDegrees(359.7)).toBe(0);
    expect(toDisplayBearingDegrees(-0.2)).toBe(0);
  });

  // The reason the rounding exists at all: MapLibre stores bearing as
  // radians, so a byte-identical commanded bearing reads back as a
  // neighbouring float. Without quantisation an exact equality guard
  // would treat that as a real change on every single settle.
  it("collapses a degrees-radians-degrees round trip to one value", () => {
    // 13 is one of the 105 whole degrees in [0, 360) that do not survive
    // MapLibre's own degrees -> radians -> degrees storage exactly, so an
    // exact equality guard on the raw readback really would see a change
    // where the map did not move at all.
    const commanded = 13;
    const roundTripped = (((commanded * Math.PI) / 180) * 180) / Math.PI;
    expect(roundTripped).not.toBe(commanded);
    expect(toDisplayBearingDegrees(roundTripped)).toBe(
      toDisplayBearingDegrees(commanded),
    );
  });

  // normaliseBearingDegrees propagates NaN, and rotate(NaNdeg) is an
  // invalid CSS declaration browsers drop silently. A restored camera row
  // is only defended with `?? 0`, which does not catch a structured-cloned
  // NaN, so this boundary must reject it explicitly.
  it("returns null for a non-finite bearing rather than propagating NaN", () => {
    expect(toDisplayBearingDegrees(Number.NaN)).toBeNull();
    expect(toDisplayBearingDegrees(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toDisplayBearingDegrees(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(Number.isNaN(normaliseBearingDegrees(Number.NaN))).toBe(true);
  });
});

describe("shortestAngularDifferenceDegrees", () => {
  it("crossing the 0/360 boundary forward is a small positive change", () => {
    expect(shortestAngularDifferenceDegrees(359, 1)).toBe(2);
  });

  it("crossing the 0/360 boundary backward is a small negative change", () => {
    expect(shortestAngularDifferenceDegrees(1, 359)).toBe(-2);
  });

  it("wrapping the other way also takes the short path", () => {
    expect(shortestAngularDifferenceDegrees(350, 10)).toBe(20);
    expect(shortestAngularDifferenceDegrees(10, 350)).toBe(-20);
  });

  it("a plain in-range difference is unaffected by wrapping", () => {
    expect(shortestAngularDifferenceDegrees(10, 25)).toBe(15);
  });

  it("no change is zero", () => {
    expect(shortestAngularDifferenceDegrees(45, 45)).toBe(0);
  });
});

describe("routeTangentBearingDegrees", () => {
  it("follows a straight due-north route", () => {
    // 0.01 degrees latitude at the equator/mid-latitude is ~1.1km — far
    // more than the 30m default window, so a matched distance well inside
    // the route keeps the sampled window entirely on this one straight
    // segment.
    const points = buildRoutePointsFromWaypoints(
      [
        [0, 51],
        [0, 51.01],
      ],
      50,
    );
    const routeLength = points.at(-1)?.distanceFromStartMetres ?? 0;
    expect(routeTangentBearingDegrees(points, routeLength / 2)).toBeCloseTo(0, 0);
  });

  it("follows the local tangent through a curved (bent) route", () => {
    // North for the first leg, then east for the second — both legs built
    // at the equator so each leg's own bearing is mathematically exact
    // (0 then 90), and each leg is long enough that a matched distance
    // safely inside it keeps the whole sampling window on that one leg.
    const points = buildRoutePointsFromWaypoints(
      [
        [0, 0],
        [0, 0.01],
        [0.01, 0.01],
      ],
      50,
    );
    const bendDistanceMetres =
      points.find((point) => point.coordinate[1] >= 0.01)?.distanceFromStartMetres ?? 0;
    const routeLength = points.at(-1)?.distanceFromStartMetres ?? 0;

    expect(routeTangentBearingDegrees(points, bendDistanceMetres / 2)).toBeCloseTo(0, 0);
    expect(
      routeTangentBearingDegrees(points, (bendDistanceMetres + routeLength) / 2),
    ).toBeCloseTo(90, 0);
  });

  it("returns null for insufficient geometry (fewer than 2 points)", () => {
    const single: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
    ];
    expect(routeTangentBearingDegrees(single, 0)).toBeNull();
    expect(routeTangentBearingDegrees([], 0)).toBeNull();
  });

  it("returns null for a degenerate route with duplicate coordinates", () => {
    const duplicate: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
    ];
    expect(routeTangentBearingDegrees(duplicate, 0)).toBeNull();
  });
});
