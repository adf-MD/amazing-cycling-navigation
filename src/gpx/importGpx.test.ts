import { describe, expect, it } from "vitest";
import { importGpxFile } from "./importGpx.ts";
import { GpxParseError } from "./errors.ts";
import type { Clock } from "../platform/clock.ts";
import {
  malformedGpx,
  multiSegmentTrackGpx,
  multiTrackGpx,
  routeNoElevationGpx,
  trackWithElevationGpx,
} from "../test/fixtures/gpx.ts";

const fixedClock: Clock = { now: () => Date.parse("2026-02-01T09:00:00.000Z") };

function buildGpxFile(name: string, content: string): File {
  return new File([content], name, { type: "application/gpx+xml" });
}

describe("importGpxFile", () => {
  it("imports a track with elevation into a PlannedRoute", async () => {
    const { route, notices } = await importGpxFile(
      buildGpxFile("Evening Ride.gpx", trackWithElevationGpx),
      fixedClock,
    );

    expect(route.name).toBe("Evening Ride");
    expect(route.createdAt).toBe("2026-02-01T09:00:00.000Z");
    expect(route.points).toHaveLength(4);
    expect(route.points[0]?.elevationMetres).toBe(10);
    expect(route.distanceMetres).toBeGreaterThan(0);
    expect(route.ascentMetres).toBeGreaterThan(0);
    expect(route.descentMetres).toBeGreaterThan(0);
    expect(route.source).toEqual({ kind: "gpx-import" });
    expect(notices).toEqual([]);
  });

  it("imports a route without elevation, preserving explicit missing elevation", async () => {
    const { route } = await importGpxFile(
      buildGpxFile("no-elevation.gpx", routeNoElevationGpx),
      fixedClock,
    );

    expect(route.points).toHaveLength(3);
    expect(route.points.every((point) => point.elevationMetres === null)).toBe(true);
  });

  it("prefers the first track and surfaces a notice for a multi-track file", async () => {
    const { route, notices } = await importGpxFile(
      buildGpxFile("multi-track.gpx", multiTrackGpx),
      fixedClock,
    );

    expect(route.points).toHaveLength(2);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe("multiple-tracks-first-used");
  });

  it("concatenates multiple segments within a single track", async () => {
    const { route, notices } = await importGpxFile(
      buildGpxFile("multi-segment.gpx", multiSegmentTrackGpx),
      fixedClock,
    );

    expect(route.points).toHaveLength(4);
    expect(notices).toEqual([]);
  });

  it("derives the route name from the file name, stripping the extension", async () => {
    const { route } = await importGpxFile(
      buildGpxFile("Sunday_Loop.gpx", trackWithElevationGpx),
      fixedClock,
    );

    expect(route.name).toBe("Sunday_Loop");
  });

  it("rejects a malformed file before producing a route", async () => {
    await expect(
      importGpxFile(buildGpxFile("broken.gpx", malformedGpx), fixedClock),
    ).rejects.toBeInstanceOf(GpxParseError);
  });

  it("rejects a non-.gpx file without reading its contents", async () => {
    await expect(
      importGpxFile(buildGpxFile("notes.txt", trackWithElevationGpx), fixedClock),
    ).rejects.toMatchObject({ reason: "unsupported-type" });
  });
});
