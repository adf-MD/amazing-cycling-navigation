import { describe, expect, it } from "vitest";
import { exportRouteToGpx } from "./exportGpx.ts";
import { extractRoutePoints, parseGpxDocument } from "./parseGpx.ts";
import { importGpxFile } from "./importGpx.ts";
import { totalDistanceMetres } from "../navigation/distance.ts";
import type { PlannedRoute } from "../domain/types.ts";
import { trackWithElevationGpx } from "../test/fixtures/gpx.ts";

function buildRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id: "test-route",
    name: "Evening loop",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 111 },
      {
        coordinate: [0.002, 51.001],
        elevationMetres: null,
        distanceFromStartMetres: 230,
      },
    ],
    manoeuvres: [],
    distanceMetres: 230,
    ascentMetres: 2,
    descentMetres: 0,
    warnings: [],
    source: { kind: "gpx-import" },
    ...overrides,
  };
}

describe("exportRouteToGpx", () => {
  it("produces well-formed GPX with the route name, points and elevation", () => {
    const xml = exportRouteToGpx(buildRoute());
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.nodeName).toBe("gpx");

    const name = doc.getElementsByTagNameNS("*", "name")[0];
    expect(name?.textContent).toBe("Evening loop");

    const trkpts = Array.from(doc.getElementsByTagNameNS("*", "trkpt"));
    expect(trkpts).toHaveLength(3);
    expect(trkpts[0]?.getAttribute("lat")).toBe("51");
    expect(trkpts[0]?.getAttribute("lon")).toBe("0");
    expect(trkpts[0]?.getElementsByTagNameNS("*", "ele")[0]?.textContent).toBe("10");
    expect(trkpts[2]?.getElementsByTagNameNS("*", "ele")).toHaveLength(0);
  });

  it("escapes special characters in the route name", () => {
    const xml = exportRouteToGpx(buildRoute({ name: 'Loop & "Climb" <fast>' }));
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const name = doc.getElementsByTagNameNS("*", "name")[0];
    expect(name?.textContent).toBe('Loop & "Climb" <fast>');
  });

  it("writes manoeuvres as a namespaced extension that a plain GPX reader can ignore", () => {
    const xml = exportRouteToGpx(
      buildRoute({
        manoeuvres: [
          { distanceFromStartMetres: 50, type: "left", instruction: "Turn left" },
        ],
      }),
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const manoeuvreElements = doc.getElementsByTagNameNS("*", "manoeuvre");
    expect(manoeuvreElements).toHaveLength(1);
    expect(manoeuvreElements[0]?.getAttribute("type")).toBe("left");

    // A plain-GPX reader ignoring unknown extensions still sees exactly
    // the track points, nothing from the extension.
    const { points } = extractRoutePoints(doc);
    expect(points).toHaveLength(3);
  });

  it("omits the extensions element entirely when there are no manoeuvres", () => {
    const xml = exportRouteToGpx(buildRoute());
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagNameNS("*", "extensions")).toHaveLength(0);
  });

  it("writes routing provenance as a namespaced extension for a planner-sourced route", () => {
    const xml = exportRouteToGpx(
      buildRoute({
        source: {
          kind: "planner",
          provider: "openrouteservice",
          profile: "cycling-road",
        },
      }),
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const sourceElements = doc.getElementsByTagNameNS("*", "source");
    expect(sourceElements).toHaveLength(1);
    expect(sourceElements[0]?.getAttribute("provider")).toBe("openrouteservice");
    expect(sourceElements[0]?.getAttribute("profile")).toBe("cycling-road");

    // A plain-GPX reader ignoring unknown extensions still sees exactly
    // the track points, nothing from the extension.
    const { points } = extractRoutePoints(doc);
    expect(points).toHaveLength(3);
  });

  it("never writes routing provenance for a gpx-import route", () => {
    const xml = exportRouteToGpx(buildRoute({ source: { kind: "gpx-import" } }));
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagNameNS("*", "source")).toHaveLength(0);
  });

  it("nests manoeuvres and provenance under one shared extensions element", () => {
    const xml = exportRouteToGpx(
      buildRoute({
        manoeuvres: [{ distanceFromStartMetres: 50, type: "left" }],
        source: {
          kind: "planner",
          provider: "openrouteservice",
          profile: "cycling-road",
        },
      }),
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    const extensionsElements = doc.getElementsByTagNameNS("*", "extensions");
    expect(extensionsElements).toHaveLength(1);
    expect(extensionsElements[0]?.getElementsByTagNameNS("*", "manoeuvre")).toHaveLength(
      1,
    );
    expect(extensionsElements[0]?.getElementsByTagNameNS("*", "source")).toHaveLength(1);
  });
});

describe("GPX round-trip", () => {
  it("preserves point count and total distance through import -> export -> reimport", async () => {
    const file = new File([trackWithElevationGpx], "track.gpx", {
      type: "application/gpx+xml",
    });
    const { route: imported } = await importGpxFile(file);

    const exportedXml = exportRouteToGpx(imported);
    const reparsedDoc = parseGpxDocument(exportedXml);
    const { points: reimportedPoints } = extractRoutePoints(reparsedDoc);

    expect(reimportedPoints).toHaveLength(imported.points.length);

    const reimportedDistance = totalDistanceMetres(
      reimportedPoints.map((point) => point.coordinate),
    );
    expect(Math.abs(reimportedDistance - imported.distanceMetres)).toBeLessThan(0.01);

    expect(reimportedPoints.map((point) => point.elevationMetres)).toEqual(
      imported.points.map((point) => point.elevationMetres),
    );
  });
});
