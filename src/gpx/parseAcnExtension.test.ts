import { describe, expect, it } from "vitest";
import {
  MAX_ACN_MANOEUVRES,
  MAX_ACN_PLANNING_WAYPOINTS,
  readAcnNavigationExtension,
  readAcnPlanningExtension,
  readAcnSourceProfile,
} from "./parseAcnExtension.ts";
import { exportRouteToGpx } from "./exportGpx.ts";
import { ACN_NAMESPACE } from "./acnNamespace.ts";
import { canonicalizeTrackGeometry, computeGeometryDigestHex } from "./geometryDigest.ts";
import { extractRoutePoints, parseGpxDocument } from "./parseGpx.ts";
import type { Coordinate, PlannedRoute } from "../domain/types.ts";
import {
  acnExtensionOnSecondTrackGpx,
  acnLookalikeWrongNamespaceGpx,
} from "../test/fixtures/gpx.ts";

function buildTrustedRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id: "test-route",
    name: "Trusted route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 111 },
      {
        coordinate: [0.002, 51.001],
        elevationMetres: null,
        distanceFromStartMetres: 230,
      },
      { coordinate: [0.003, 51.002], elevationMetres: 9, distanceFromStartMetres: 340 },
    ],
    manoeuvres: [
      { distanceFromStartMetres: 111, type: "left", instruction: "Turn left" },
      { distanceFromStartMetres: 230, type: "finish" },
    ],
    distanceMetres: 340,
    ascentMetres: 2,
    descentMetres: 3,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
    manoeuvreProvenance: { kind: "routing-provider", provider: "openrouteservice" },
    ...overrides,
  };
}

async function buildValidDoc(route: PlannedRoute = buildTrustedRoute()) {
  const xml = await exportRouteToGpx(route);
  const doc = parseGpxDocument(xml);
  const { points, selectedTrackElement } = extractRoutePoints(doc);
  if (!selectedTrackElement) {
    throw new Error("test fixture must produce a selected track element");
  }
  return { doc, points, selectedTrackElement };
}

function getNavigationElement(selectedTrackElement: Element): Element {
  const element = selectedTrackElement.getElementsByTagNameNS(
    ACN_NAMESPACE,
    "navigation",
  )[0];
  if (!element) {
    throw new Error("expected a valid doc to contain an acn:navigation element");
  }
  return element;
}

function getManoeuvreElements(selectedTrackElement: Element): Element[] {
  return Array.from(
    selectedTrackElement.getElementsByTagNameNS(ACN_NAMESPACE, "manoeuvre"),
  );
}

function getSourceElement(selectedTrackElement: Element): Element {
  const element = selectedTrackElement.getElementsByTagNameNS(ACN_NAMESPACE, "source")[0];
  if (!element) {
    throw new Error("expected a valid doc to contain an acn:source element");
  }
  return element;
}

function getPlanningElement(selectedTrackElement: Element): Element {
  const element = selectedTrackElement.getElementsByTagNameNS(
    ACN_NAMESPACE,
    "planning",
  )[0];
  if (!element) {
    throw new Error("expected a valid doc to contain an acn:planning element");
  }
  return element;
}

function getWaypointElements(selectedTrackElement: Element): Element[] {
  return Array.from(
    selectedTrackElement.getElementsByTagNameNS(ACN_NAMESPACE, "waypoint"),
  );
}

const PLANNING_PROVENANCE: PlannedRoute["planningProvenance"] = {
  kind: "planning-session",
  waypoints: [
    [0, 51],
    [0.0015, 51.0005],
    [0.003, 51.002],
  ],
  profile: "cycling-regular",
  avoidFerries: false,
};

// Approximate metres-per-degree of longitude at latitude 51.5, matching
// the conversion used by e2e fixtures elsewhere in this repo — only
// needed to construct roughly-spaced coordinates, so approximation is
// fine for the coarse boundaries these tests check.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
function lonAtMetres(distanceMetres: number): number {
  return distanceMetres / METRES_PER_DEGREE_LON;
}

/** A hand-built doc with one large (~300 m) gap between points 1 and 2,
 * and a single manoeuvre at the given index/distance — used to prove the
 * adaptive local-gap tolerance (not a flat constant) governs the
 * distance-vs-indexed-point sanity check. */
async function buildSparseGeometryDoc(manoeuvre: {
  trackPointIndex: number;
  distanceMetres: number;
}) {
  const coordinates: Coordinate[] = [
    [0, 51.5],
    [lonAtMetres(5), 51.5],
    [lonAtMetres(305), 51.5],
    [lonAtMetres(310), 51.5],
  ];
  const digest = await computeGeometryDigestHex(canonicalizeTrackGeometry(coordinates));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:acn="${ACN_NAMESPACE}">
  <trk>
    <name>Sparse geometry</name>
    <extensions>
      <acn:navigation version="1" pointCount="4" geometrySha256="${digest}">
        <acn:manoeuvre trackPointIndex="${String(manoeuvre.trackPointIndex)}" distanceMetres="${String(manoeuvre.distanceMetres)}" type="left"/>
      </acn:navigation>
    </extensions>
    <trkseg>
${coordinates.map(([lon, lat]) => `      <trkpt lat="${String(lat)}" lon="${String(lon)}"></trkpt>`).join("\n")}
    </trkseg>
  </trk>
</gpx>`;
  const doc = parseGpxDocument(xml);
  const { points, selectedTrackElement } = extractRoutePoints(doc);
  if (!selectedTrackElement) {
    throw new Error("test fixture must produce a selected track element");
  }
  return { points, selectedTrackElement };
}

describe("readAcnNavigationExtension", () => {
  it("accepts a valid extension and returns the encoded manoeuvres", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);

    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") return;
    expect(outcome.manoeuvres).toHaveLength(2);
    expect(outcome.manoeuvres[0]?.type).toBe("left");
    expect(outcome.manoeuvres[0]?.instruction).toBe("Turn left");
    expect(outcome.manoeuvres[1]?.type).toBe("finish");
    expect(outcome.manoeuvres[1]?.instruction).toBeUndefined();
  });

  it("returns absent when the route has no extension at all", async () => {
    const route = buildTrustedRoute({
      manoeuvres: [],
      manoeuvreProvenance: undefined,
      source: { kind: "gpx-import" },
    });
    const { points, selectedTrackElement } = await buildValidDoc(route);
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "absent" });
  });

  it("rejects when the version attribute does not match", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getNavigationElement(selectedTrackElement).setAttribute("version", "2");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when the version attribute is missing", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getNavigationElement(selectedTrackElement).removeAttribute("version");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("ignores a namespace lookalike using the same local element/attribute names", async () => {
    const doc = parseGpxDocument(acnLookalikeWrongNamespaceGpx);
    const { points, selectedTrackElement } = extractRoutePoints(doc);
    if (!selectedTrackElement) throw new Error("test fixture must select a track");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "absent" });
  });

  it("never applies an extension attached to a non-selected track", async () => {
    const doc = parseGpxDocument(acnExtensionOnSecondTrackGpx);
    const { points, selectedTrackElement } = extractRoutePoints(doc);
    if (!selectedTrackElement) throw new Error("test fixture must select a track");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "absent" });
  });

  it("ignores an extension nested inside a trkpt's own extensions rather than the track's own", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const navigationElement = getNavigationElement(selectedTrackElement);
    const trackExtensions = navigationElement.parentElement;
    if (!trackExtensions) throw new Error("expected navigation element to have a parent");

    // Move the whole <extensions> block from the track down into the
    // first <trkpt>'s own extensions instead — still namespace-correct,
    // but no longer a direct child of the selected track.
    trackExtensions.remove();
    const firstTrkpt = selectedTrackElement.getElementsByTagNameNS("*", "trkpt")[0];
    firstTrkpt?.appendChild(trackExtensions);

    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "absent" });
  });

  it("rejects on a pointCount mismatch", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getNavigationElement(selectedTrackElement).setAttribute("pointCount", "999");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when trackPointIndex is negative", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getManoeuvreElements(selectedTrackElement)[0]?.setAttribute("trackPointIndex", "-1");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when trackPointIndex is out of bounds", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getManoeuvreElements(selectedTrackElement)[0]?.setAttribute("trackPointIndex", "999");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when trackPointIndex is not an integer", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getManoeuvreElements(selectedTrackElement)[0]?.setAttribute("trackPointIndex", "1.5");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when distanceMetres is negative", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getManoeuvreElements(selectedTrackElement)[0]?.setAttribute("distanceMetres", "-5");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when distanceMetres is non-finite or missing", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getManoeuvreElements(selectedTrackElement)[0]?.removeAttribute("distanceMetres");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when distanceMetres decreases between successive manoeuvres", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const manoeuvres = getManoeuvreElements(selectedTrackElement);
    // Second manoeuvre's distance (230) is pushed before the first's (111).
    manoeuvres[1]?.setAttribute("distanceMetres", "10");
    manoeuvres[1]?.setAttribute("trackPointIndex", "0");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("accepts two manoeuvres with identical distanceMetres (non-strict monotonicity)", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const manoeuvres = getManoeuvreElements(selectedTrackElement);
    manoeuvres[1]?.setAttribute(
      "distanceMetres",
      manoeuvres[0]?.getAttribute("distanceMetres") ?? "0",
    );
    manoeuvres[1]?.setAttribute(
      "trackPointIndex",
      manoeuvres[0]?.getAttribute("trackPointIndex") ?? "0",
    );
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome.kind).toBe("accepted");
  });

  it("rejects when distanceMetres exceeds the route's total distance beyond tolerance", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getManoeuvreElements(selectedTrackElement)[1]?.setAttribute(
      "distanceMetres",
      "99999",
    );
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("coerces an unrecognised type to unknown without rejecting the envelope", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getManoeuvreElements(selectedTrackElement)[0]?.setAttribute(
      "type",
      "some-future-type",
    );
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") return;
    expect(outcome.manoeuvres[0]?.type).toBe("unknown");
  });

  it("truncates an overlong instruction rather than rejecting the envelope", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const instructionElement = getManoeuvreElements(
      selectedTrackElement,
    )[0]?.getElementsByTagNameNS(ACN_NAMESPACE, "instruction")[0];
    const overlong = "x".repeat(500);
    if (instructionElement) instructionElement.textContent = overlong;
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") return;
    expect(outcome.manoeuvres[0]?.instruction?.length).toBe(200);
  });

  it("returns undefined instruction when there is no instruction child", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") return;
    // The fixture's second manoeuvre ("finish") has no instruction.
    expect(outcome.manoeuvres[1]?.instruction).toBeUndefined();
  });

  it("rejects when the manoeuvre count exceeds MAX_ACN_MANOEUVRES", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const navigationElement = getNavigationElement(selectedTrackElement);
    const template = getManoeuvreElements(selectedTrackElement)[0];
    if (!template) throw new Error("expected at least one manoeuvre element");
    for (let i = 0; i < MAX_ACN_MANOEUVRES; i += 1) {
      navigationElement.appendChild(template.cloneNode(true));
    }
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  }, 20_000);

  it("rejects a malformed geometrySha256 without computing a real digest", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getNavigationElement(selectedTrackElement).setAttribute("geometrySha256", "not-hex");
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects a well-formed but incorrect geometrySha256", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    getNavigationElement(selectedTrackElement).setAttribute(
      "geometrySha256",
      "a".repeat(64),
    );
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("accepts a geometrySha256 given in upper-case hex", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const navigationElement = getNavigationElement(selectedTrackElement);
    const original = navigationElement.getAttribute("geometrySha256") ?? "";
    navigationElement.setAttribute("geometrySha256", original.toUpperCase());
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome.kind).toBe("accepted");
  });

  it("rejects a distance mismatch beyond the adaptive local-gap tolerance", async () => {
    // Point 2 sits ~305 m in; a manoeuvre with distanceMetres 0 mismatches
    // by ~305 m, exceeding the ~300 m local gap tolerance at that index.
    const { points, selectedTrackElement } = await buildSparseGeometryDoc({
      trackPointIndex: 2,
      distanceMetres: 0,
    });
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("accepts a distance mismatch within the adaptive local-gap tolerance on sparse geometry", async () => {
    // Same sparse geometry, but distanceMetres 155 mismatches point 2
    // (~305 m) by only ~150 m — comfortably inside the ~300 m local gap,
    // even though it exceeds a flat few-metre tolerance.
    const { points, selectedTrackElement } = await buildSparseGeometryDoc({
      trackPointIndex: 2,
      distanceMetres: 155,
    });
    const outcome = await readAcnNavigationExtension(selectedTrackElement, points);
    expect(outcome.kind).toBe("accepted");
  });
});

describe("readAcnSourceProfile", () => {
  it("reads a valid profile attribute from a planner-sourced route's acn:source", async () => {
    const { selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({
        source: {
          kind: "planner",
          provider: "openrouteservice",
          profile: "cycling-regular",
        },
      }),
    );
    expect(readAcnSourceProfile(selectedTrackElement)).toBe("cycling-regular");
  });

  it("returns undefined when there is no extensions element at all", async () => {
    const route = buildTrustedRoute({
      manoeuvres: [],
      manoeuvreProvenance: undefined,
      source: { kind: "gpx-import" },
    });
    const { selectedTrackElement } = await buildValidDoc(route);
    expect(readAcnSourceProfile(selectedTrackElement)).toBeUndefined();
  });

  it("returns undefined when extensions exist but there is no acn:source child", async () => {
    // A trusted route (writes <acn:navigation>) with a gpx-import source
    // and no recovered profile — no <acn:source> is written at all.
    const route = buildTrustedRoute({ source: { kind: "gpx-import" } });
    const { selectedTrackElement } = await buildValidDoc(route);
    expect(readAcnSourceProfile(selectedTrackElement)).toBeUndefined();
  });

  it("returns undefined when acn:source exists but has no profile attribute", async () => {
    // provider-only provenance (e.g. a route saved before profile
    // selection existed) still writes <acn:source provider="..."> with no
    // profile attribute.
    const route = buildTrustedRoute({
      source: { kind: "planner", provider: "openrouteservice" },
    });
    const { selectedTrackElement } = await buildValidDoc(route);
    expect(readAcnSourceProfile(selectedTrackElement)).toBeUndefined();
  });

  it("returns undefined for a malformed or unrecognised profile value, without throwing", async () => {
    const { selectedTrackElement } = await buildValidDoc();
    getSourceElement(selectedTrackElement).setAttribute("profile", "cycling-mountain");
    expect(readAcnSourceProfile(selectedTrackElement)).toBeUndefined();
  });

  it("ignores a namespace lookalike using the same local element/attribute names", () => {
    const doc = parseGpxDocument(acnLookalikeWrongNamespaceGpx);
    const { selectedTrackElement } = extractRoutePoints(doc);
    if (!selectedTrackElement) throw new Error("test fixture must select a track");
    expect(readAcnSourceProfile(selectedTrackElement)).toBeUndefined();
  });

  it("never applies an extension attached to a non-selected track", () => {
    const doc = parseGpxDocument(acnExtensionOnSecondTrackGpx);
    const { selectedTrackElement } = extractRoutePoints(doc);
    if (!selectedTrackElement) throw new Error("test fixture must select a track");
    expect(readAcnSourceProfile(selectedTrackElement)).toBeUndefined();
  });

  it("still reads a valid profile even when the sibling acn:navigation envelope is corrupted/rejected", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({
        source: {
          kind: "planner",
          provider: "openrouteservice",
          profile: "cycling-road",
        },
      }),
    );
    // Corrupt the sibling <acn:navigation> envelope's digest, so
    // readAcnNavigationExtension itself would reject it...
    getNavigationElement(selectedTrackElement).setAttribute(
      "geometrySha256",
      "a".repeat(64),
    );
    const navigationOutcome = await readAcnNavigationExtension(
      selectedTrackElement,
      points,
    );
    expect(navigationOutcome).toEqual({ kind: "rejected" });

    // ...but the unrelated, non-digest-bound <acn:source> sibling is
    // unaffected.
    expect(readAcnSourceProfile(selectedTrackElement)).toBe("cycling-road");
  });
});

describe("readAcnPlanningExtension", () => {
  it("accepts a valid extension and returns the encoded waypoints/options", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);

    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") return;
    expect(outcome.waypoints).toEqual(PLANNING_PROVENANCE.waypoints);
    expect(outcome.profile).toBe("cycling-regular");
    expect(outcome.avoidFerries).toBe(false);
  });

  it("returns absent when the route has no planning provenance at all", async () => {
    const { points, selectedTrackElement } = await buildValidDoc();
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "absent" });
  });

  it("returns absent when the route has no extensions element at all", async () => {
    const route = buildTrustedRoute({
      manoeuvres: [],
      manoeuvreProvenance: undefined,
      source: { kind: "gpx-import" },
    });
    const { points, selectedTrackElement } = await buildValidDoc(route);
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "absent" });
  });

  it("rejects when the version attribute does not match", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    getPlanningElement(selectedTrackElement).setAttribute("version", "2");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when the profile attribute is invalid", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    getPlanningElement(selectedTrackElement).setAttribute("profile", "cycling-mountain");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when the avoidFerries attribute is not a literal true/false", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    getPlanningElement(selectedTrackElement).setAttribute("avoidFerries", "yes");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when the waypointCount attribute does not match the actual number of waypoint elements", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    getPlanningElement(selectedTrackElement).setAttribute("waypointCount", "99");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when fewer than two waypoints are present", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({
        planningProvenance: {
          ...PLANNING_PROVENANCE,
          waypoints: [[0, 51]],
        },
      }),
    );
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when the waypoint count exceeds MAX_ACN_PLANNING_WAYPOINTS", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    const planningElement = getPlanningElement(selectedTrackElement);
    const template = getWaypointElements(selectedTrackElement)[0];
    if (!template) throw new Error("expected at least one waypoint element");
    for (let i = 0; i < MAX_ACN_PLANNING_WAYPOINTS; i += 1) {
      planningElement.appendChild(template.cloneNode(true));
    }
    planningElement.setAttribute(
      "waypointCount",
      String(getWaypointElements(selectedTrackElement).length),
    );
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects an out-of-range waypoint coordinate", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    getWaypointElements(selectedTrackElement)[0]?.setAttribute("lat", "999");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects a missing waypoint coordinate attribute", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    getWaypointElements(selectedTrackElement)[0]?.removeAttribute("lon");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects a malformed geometrySha256 without computing a real digest", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    getPlanningElement(selectedTrackElement).setAttribute("geometrySha256", "not-hex");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("rejects when the track geometry has been tampered with since export", async () => {
    const xml = await exportRouteToGpx(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    const doc = parseGpxDocument(xml);
    // Move one track point in the raw doc, then re-extract points from the
    // tampered doc — the <acn:planning> digest attribute still reflects
    // the original, now-mismatched geometry.
    const trkpt = doc.getElementsByTagNameNS("*", "trkpt")[1];
    trkpt?.setAttribute("lat", "52");
    const { points, selectedTrackElement } = extractRoutePoints(doc);
    if (!selectedTrackElement) throw new Error("test fixture must select a track");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "rejected" });
  });

  it("accepts a geometrySha256 given in upper-case hex", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    const planningElement = getPlanningElement(selectedTrackElement);
    const original = planningElement.getAttribute("geometrySha256") ?? "";
    planningElement.setAttribute("geometrySha256", original.toUpperCase());
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome.kind).toBe("accepted");
  });

  it("is independent of a rejected sibling acn:navigation outcome", async () => {
    const { points, selectedTrackElement } = await buildValidDoc(
      buildTrustedRoute({ planningProvenance: PLANNING_PROVENANCE }),
    );
    // Corrupt the sibling <acn:navigation> envelope so it would reject...
    getNavigationElement(selectedTrackElement).setAttribute(
      "geometrySha256",
      "a".repeat(64),
    );
    const navigationOutcome = await readAcnNavigationExtension(
      selectedTrackElement,
      points,
    );
    expect(navigationOutcome).toEqual({ kind: "rejected" });

    // ...but the unrelated <acn:planning> sibling, with its own separately
    // computed digest, is unaffected.
    const planningOutcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(planningOutcome.kind).toBe("accepted");
  });

  it("ignores a namespace lookalike using the same local element/attribute names", async () => {
    const doc = parseGpxDocument(acnLookalikeWrongNamespaceGpx);
    const { points, selectedTrackElement } = extractRoutePoints(doc);
    if (!selectedTrackElement) throw new Error("test fixture must select a track");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "absent" });
  });

  it("never applies an extension attached to a non-selected track", async () => {
    const doc = parseGpxDocument(acnExtensionOnSecondTrackGpx);
    const { points, selectedTrackElement } = extractRoutePoints(doc);
    if (!selectedTrackElement) throw new Error("test fixture must select a track");
    const outcome = await readAcnPlanningExtension(selectedTrackElement, points);
    expect(outcome).toEqual({ kind: "absent" });
  });
});
