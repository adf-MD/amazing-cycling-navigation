import { afterEach, describe, expect, it, vi } from "vitest";
import { exportRouteToGpx } from "./exportGpx.ts";
import { GpxExportError } from "./exportErrors.ts";
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

/** A route with a trusted, non-empty manoeuvre list — the shape that
 * triggers the <acn:navigation> extension. */
function buildTrustedRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  return buildRoute({
    manoeuvres: [{ distanceFromStartMetres: 50, type: "left", instruction: "Turn left" }],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
    manoeuvreProvenance: { kind: "routing-provider", provider: "openrouteservice" },
    ...overrides,
  });
}

describe("exportRouteToGpx", () => {
  it("produces well-formed GPX with the route name, points and elevation", async () => {
    const xml = await exportRouteToGpx(buildRoute());
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

  it("escapes special characters in the route name", async () => {
    const xml = await exportRouteToGpx(buildRoute({ name: 'Loop & "Climb" <fast>' }));
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const name = doc.getElementsByTagNameNS("*", "name")[0];
    expect(name?.textContent).toBe('Loop & "Climb" <fast>');
  });

  it("writes a geometry-bound acn:navigation envelope for a trusted route", async () => {
    const route = buildTrustedRoute();
    const xml = await exportRouteToGpx(route);
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const navigationElements = doc.getElementsByTagNameNS("*", "navigation");
    expect(navigationElements).toHaveLength(1);
    const navigation = navigationElements[0];
    expect(navigation?.getAttribute("version")).toBe("1");
    expect(navigation?.getAttribute("pointCount")).toBe("3");
    expect(navigation?.getAttribute("geometrySha256")).toMatch(/^[0-9a-f]{64}$/);

    const manoeuvreElements = doc.getElementsByTagNameNS("*", "manoeuvre");
    expect(manoeuvreElements).toHaveLength(1);
    const manoeuvre = manoeuvreElements[0];
    expect(manoeuvre?.getAttribute("type")).toBe("left");
    expect(manoeuvre?.getAttribute("distanceMetres")).toBe("50");
    expect(manoeuvre?.getAttribute("trackPointIndex")).not.toBeNull();
    expect(manoeuvre?.getAttribute("instruction")).toBeNull();
    expect(manoeuvre?.getElementsByTagNameNS("*", "instruction")[0]?.textContent).toBe(
      "Turn left",
    );

    // A plain-GPX reader ignoring unknown extensions still sees exactly
    // the track points, nothing from the extension.
    const { points } = extractRoutePoints(doc);
    expect(points).toHaveLength(3);
  });

  it("computes trackPointIndex as the nearest point when a manoeuvre's distance falls between two points", async () => {
    // Points are at distances 0, 111, 230; a manoeuvre at 120 is nearer to
    // point 1 (111) than point 0 or point 2.
    const route = buildTrustedRoute({
      manoeuvres: [{ distanceFromStartMetres: 120, type: "right" }],
      manoeuvreProvenance: { kind: "routing-provider", provider: "openrouteservice" },
    });
    const xml = await exportRouteToGpx(route);
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    const manoeuvre = doc.getElementsByTagNameNS("*", "manoeuvre")[0];
    expect(manoeuvre?.getAttribute("trackPointIndex")).toBe("1");
  });

  it("omits the instruction child when the manoeuvre has no instruction text", async () => {
    const route = buildTrustedRoute({
      manoeuvres: [{ distanceFromStartMetres: 50, type: "left" }],
      manoeuvreProvenance: { kind: "routing-provider", provider: "openrouteservice" },
    });
    const xml = await exportRouteToGpx(route);
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    const manoeuvre = doc.getElementsByTagNameNS("*", "manoeuvre")[0];
    expect(manoeuvre?.getElementsByTagNameNS("*", "instruction")).toHaveLength(0);
  });

  it("omits the extensions element entirely when there are no manoeuvres", async () => {
    const xml = await exportRouteToGpx(buildRoute());
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagNameNS("*", "extensions")).toHaveLength(0);
  });

  it("does not write the navigation extension for a route with non-empty but untrusted manoeuvres", async () => {
    // Non-empty manoeuvres, but no manoeuvreProvenance and a gpx-import
    // source — the legacy-fallback trust rule requires a planner source.
    const route = buildRoute({
      manoeuvres: [{ distanceFromStartMetres: 50, type: "left" }],
      source: { kind: "gpx-import" },
    });
    const xml = await exportRouteToGpx(route);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagNameNS("*", "navigation")).toHaveLength(0);
  });

  it("writes routing provenance as a namespaced extension for a planner-sourced route", async () => {
    const xml = await exportRouteToGpx(
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

  it("never writes routing provenance for a gpx-import route", async () => {
    const xml = await exportRouteToGpx(buildRoute({ source: { kind: "gpx-import" } }));
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagNameNS("*", "source")).toHaveLength(0);
  });

  it("writes only a profile attribute, no provider, for a gpx-import route that recovered a profile from an earlier reimport", async () => {
    const xml = await exportRouteToGpx(
      buildRoute({ source: { kind: "gpx-import", profile: "cycling-regular" } }),
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    const sourceElements = doc.getElementsByTagNameNS("*", "source");
    expect(sourceElements).toHaveLength(1);
    expect(sourceElements[0]?.getAttribute("profile")).toBe("cycling-regular");
    expect(sourceElements[0]?.getAttribute("provider")).toBeNull();
  });

  it("nests the navigation envelope and provenance under one shared extensions element", async () => {
    const xml = await exportRouteToGpx(buildTrustedRoute());
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    const extensionsElements = doc.getElementsByTagNameNS("*", "extensions");
    expect(extensionsElements).toHaveLength(1);
    expect(extensionsElements[0]?.getElementsByTagNameNS("*", "navigation")).toHaveLength(
      1,
    );
    expect(extensionsElements[0]?.getElementsByTagNameNS("*", "source")).toHaveLength(1);
  });

  describe("Web Crypto unavailability", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("throws GpxExportError when trusted manoeuvres exist but crypto.subtle is unavailable", async () => {
      vi.stubGlobal("crypto", {});
      await expect(exportRouteToGpx(buildTrustedRoute())).rejects.toThrow(GpxExportError);
    });

    it("exports geometry-only without throwing when crypto is unavailable and there are no manoeuvres", async () => {
      vi.stubGlobal("crypto", {});
      const xml = await exportRouteToGpx(buildRoute());
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    });
  });
});

describe("GPX round-trip", () => {
  it("preserves point count and total distance through import -> export -> reimport", async () => {
    const file = new File([trackWithElevationGpx], "track.gpx", {
      type: "application/gpx+xml",
    });
    const { route: imported } = await importGpxFile(file);

    const exportedXml = await exportRouteToGpx(imported);
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

  it("preserves trusted manoeuvres through import -> export -> reimport", async () => {
    const original = buildTrustedRoute({
      manoeuvres: [
        { distanceFromStartMetres: 50, type: "left", instruction: "Turn left" },
        { distanceFromStartMetres: 200, type: "finish", instruction: "Arrive" },
      ],
    });

    const exportedXml = await exportRouteToGpx(original);
    const file = new File([exportedXml], "trusted.gpx", { type: "application/gpx+xml" });
    const { route: reimported } = await importGpxFile(file);

    expect(reimported.manoeuvreProvenance).toEqual({
      kind: "acn-gpx-extension",
      version: 1,
    });
    expect(reimported.manoeuvres).toHaveLength(2);
    expect(reimported.manoeuvres.map((m) => m.type)).toEqual(["left", "finish"]);
    expect(reimported.manoeuvres.map((m) => m.instruction)).toEqual([
      "Turn left",
      "Arrive",
    ]);
  });

  it("re-export of an ACN-imported route reproduces the same trusted manoeuvres", async () => {
    const original = buildTrustedRoute({
      manoeuvres: [
        { distanceFromStartMetres: 50, type: "left", instruction: "Turn left" },
      ],
    });
    const firstExportXml = await exportRouteToGpx(original);
    const file = new File([firstExportXml], "trusted.gpx", {
      type: "application/gpx+xml",
    });
    const { route: reimported } = await importGpxFile(file);

    const secondExportXml = await exportRouteToGpx(reimported);
    const doc = new DOMParser().parseFromString(secondExportXml, "application/xml");
    const manoeuvreElements = doc.getElementsByTagNameNS("*", "manoeuvre");

    expect(manoeuvreElements).toHaveLength(1);
    expect(manoeuvreElements[0]?.getAttribute("type")).toBe("left");
    expect(
      manoeuvreElements[0]?.getElementsByTagNameNS("*", "instruction")[0]?.textContent,
    ).toBe("Turn left");
  });

  it("does not serialise pinnedAt, and a reimported route is unpinned", async () => {
    const original = buildRoute({ pinnedAt: "2026-02-01T09:00:00.000Z" });

    const exportedXml = await exportRouteToGpx(original);
    expect(exportedXml).not.toContain("pinnedAt");
    expect(exportedXml).not.toContain("2026-02-01T09:00:00.000Z");

    const file = new File([exportedXml], "pinned.gpx", { type: "application/gpx+xml" });
    const { route: reimported } = await importGpxFile(file);
    expect(reimported.pinnedAt).toBeUndefined();
  });

  it("preserves the routing profile through import -> export -> reimport -> export again", async () => {
    const original = buildRoute({
      source: {
        kind: "planner",
        provider: "openrouteservice",
        profile: "cycling-regular",
      },
    });
    const firstExportXml = await exportRouteToGpx(original);
    const file = new File([firstExportXml], "planned.gpx", {
      type: "application/gpx+xml",
    });
    const { route: reimported } = await importGpxFile(file);

    // source.kind is "gpx-import" (this route entered the app via a GPX
    // file), but the profile that originally produced it survives.
    expect(reimported.source).toEqual({ kind: "gpx-import", profile: "cycling-regular" });

    const secondExportXml = await exportRouteToGpx(reimported);
    const doc = new DOMParser().parseFromString(secondExportXml, "application/xml");
    const sourceElements = doc.getElementsByTagNameNS("*", "source");

    expect(sourceElements).toHaveLength(1);
    expect(sourceElements[0]?.getAttribute("profile")).toBe("cycling-regular");
    expect(sourceElements[0]?.getAttribute("provider")).toBeNull();
  });
});
