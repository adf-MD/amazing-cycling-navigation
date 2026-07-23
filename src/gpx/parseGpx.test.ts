import { describe, expect, it } from "vitest";
import { extractRoutePoints, parseGpxDocument } from "./parseGpx.ts";
import { GpxParseError } from "./errors.ts";
import {
  malformedGpx,
  multiSegmentTrackGpx,
  multiTrackGpx,
  nonFiniteElevationGpx,
  noTrackOrRouteGpx,
  outOfRangeCoordsGpx,
  routeNoElevationGpx,
  trackWithElevationGpx,
} from "../test/fixtures/gpx.ts";

function expectReason(fn: () => void, reason: string): void {
  try {
    fn();
    expect.fail("expected GpxParseError to be thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(GpxParseError);
    expect((error as GpxParseError).reason).toBe(reason);
  }
}

describe("parseGpxDocument", () => {
  it("parses well-formed GPX/XML", () => {
    const doc = parseGpxDocument(trackWithElevationGpx);
    expect(doc.documentElement.nodeName).toBe("gpx");
  });

  it("throws malformed-xml for broken XML", () => {
    expectReason(() => parseGpxDocument(malformedGpx), "malformed-xml");
  });
});

describe("extractRoutePoints: tracks", () => {
  it("extracts track points with elevation in document order", () => {
    const doc = parseGpxDocument(trackWithElevationGpx);
    const { points, notices } = extractRoutePoints(doc);

    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ coordinate: [0, 51.5], elevationMetres: 10 });
    expect(points[3]).toEqual({ coordinate: [0.003, 51.503], elevationMetres: 11 });
    expect(notices).toEqual([]);
  });

  it("prefers the first track and reports a notice when multiple tracks exist", () => {
    const doc = parseGpxDocument(multiTrackGpx);
    const { points, notices } = extractRoutePoints(doc);

    expect(points).toHaveLength(2);
    expect(points[0]?.coordinate).toEqual([0.2, 51.7]);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe("multiple-tracks-first-used");
    expect(notices[0]?.message).toContain("2 tracks");
  });

  it("concatenates multiple segments within a single track in document order", () => {
    const doc = parseGpxDocument(multiSegmentTrackGpx);
    const { points, notices } = extractRoutePoints(doc);

    expect(points).toHaveLength(4);
    expect(points.map((point) => point.elevationMetres)).toEqual([20, 21, 22, 23]);
    expect(notices).toEqual([]);
  });
});

describe("extractRoutePoints: routes", () => {
  it("extracts route points with explicit missing elevation", () => {
    const doc = parseGpxDocument(routeNoElevationGpx);
    const { points, notices } = extractRoutePoints(doc);

    expect(points).toHaveLength(3);
    expect(points.every((point) => point.elevationMetres === null)).toBe(true);
    expect(notices).toEqual([]);
  });
});

describe("extractRoutePoints: validation failures", () => {
  it("throws invalid-coordinate for an out-of-range latitude", () => {
    const doc = parseGpxDocument(outOfRangeCoordsGpx);
    expectReason(() => extractRoutePoints(doc), "invalid-coordinate");
  });

  it("throws invalid-elevation for non-numeric elevation text", () => {
    const doc = parseGpxDocument(nonFiniteElevationGpx);
    expectReason(() => extractRoutePoints(doc), "invalid-elevation");
  });

  it("throws no-track-or-route when the file has neither", () => {
    const doc = parseGpxDocument(noTrackOrRouteGpx);
    expectReason(() => extractRoutePoints(doc), "no-track-or-route");
  });
});
