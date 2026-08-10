import { hasTrustedManoeuvres } from "../domain/manoeuvreTrust.ts";
import type { PlannedRoute } from "../domain/types.ts";
import { nearestPointIndexForDistance } from "../navigation/distance.ts";
import {
  ACN_NAMESPACE,
  ACN_NAVIGATION_EXTENSION_VERSION,
  ACN_PLANNING_EXTENSION_VERSION,
} from "./acnNamespace.ts";
import { GpxExportError } from "./exportErrors.ts";
import { canonicalizeTrackGeometry, computeGeometryDigestHex } from "./geometryDigest.ts";

const GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1";

/**
 * Serialises a PlannedRoute as a standards-compatible GPX 1.1 track,
 * including full geometry and elevation. When the route has trusted
 * manoeuvres (hasTrustedManoeuvres), they are written as a namespaced
 * <acn:navigation> extension; when it has recovered planning-waypoint
 * provenance (route.planningProvenance), the original Planning waypoints
 * are written as a namespaced <acn:planning> extension. Both are
 * geometry-bound via a point/waypoint count and a shared SHA-256 digest, so
 * a re-import can detect whether the file's track was modified since
 * export — that other GPX readers can safely ignore. Built via the
 * DOM/XMLSerializer rather than string templating so text content and
 * attribute values are always escaped correctly.
 *
 * Async only because computing the geometry digest requires
 * crypto.subtle.digest, which has no synchronous form. A route with neither
 * trusted manoeuvres nor planning provenance never touches Web Crypto and
 * always resolves.
 */
export async function exportRouteToGpx(route: PlannedRoute): Promise<string> {
  const doc = document.implementation.createDocument(GPX_NAMESPACE, "gpx", null);
  const gpxElement = doc.documentElement;
  gpxElement.setAttribute("version", "1.1");
  gpxElement.setAttribute("creator", "Amazing Cycling Navigation");
  gpxElement.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:acn", ACN_NAMESPACE);

  const trk = doc.createElementNS(GPX_NAMESPACE, "trk");
  gpxElement.appendChild(trk);

  const nameElement = doc.createElementNS(GPX_NAMESPACE, "name");
  nameElement.textContent = route.name;
  trk.appendChild(nameElement);

  // Manoeuvres, planning-waypoint provenance and routing provenance share
  // one <extensions> element rather than risking multiple sibling
  // <extensions> blocks, which some readers tolerate poorly. Collected as
  // plain child elements first, so the wrapping <extensions> element itself
  // is only created (and only appended to the document) when there's
  // genuinely something to hold.
  const extensionChildren: Element[] = [];

  const needsGeometryDigest =
    hasTrustedManoeuvres(route) || route.planningProvenance !== undefined;
  let geometrySha256: string | undefined;
  if (needsGeometryDigest) {
    if (typeof crypto === "undefined" || typeof crypto.subtle === "undefined") {
      throw new GpxExportError(
        "crypto-unavailable",
        "This route's turn information and/or planning waypoints could not be preserved " +
          "in the GPX export because this browser does not support the cryptography " +
          "needed to bind them to the route geometry. Export was cancelled rather than " +
          "silently dropping that data.",
      );
    }

    const canonical = canonicalizeTrackGeometry(
      route.points.map((point) => point.coordinate),
    );
    // Computed once and reused by both <acn:navigation> and <acn:planning>
    // below when both are present — they bind to the same route.points
    // geometry, so hashing it twice would be redundant.
    geometrySha256 = await computeGeometryDigestHex(canonical);
  }

  if (hasTrustedManoeuvres(route) && geometrySha256 !== undefined) {
    const pointDistances = route.points.map((point) => point.distanceFromStartMetres);

    const navigationElement = doc.createElementNS(ACN_NAMESPACE, "acn:navigation");
    navigationElement.setAttribute("version", ACN_NAVIGATION_EXTENSION_VERSION);
    navigationElement.setAttribute("pointCount", String(route.points.length));
    navigationElement.setAttribute("geometrySha256", geometrySha256);

    for (const manoeuvre of route.manoeuvres) {
      const trackPointIndex = nearestPointIndexForDistance(
        pointDistances,
        manoeuvre.distanceFromStartMetres,
      );
      const manoeuvreElement = doc.createElementNS(ACN_NAMESPACE, "acn:manoeuvre");
      manoeuvreElement.setAttribute("trackPointIndex", String(trackPointIndex));
      manoeuvreElement.setAttribute(
        "distanceMetres",
        String(manoeuvre.distanceFromStartMetres),
      );
      manoeuvreElement.setAttribute("type", manoeuvre.type);
      if (manoeuvre.instruction !== undefined) {
        const instructionElement = doc.createElementNS(ACN_NAMESPACE, "acn:instruction");
        instructionElement.textContent = manoeuvre.instruction;
        manoeuvreElement.appendChild(instructionElement);
      }
      navigationElement.appendChild(manoeuvreElement);
    }

    extensionChildren.push(navigationElement);
  }

  if (route.planningProvenance && geometrySha256 !== undefined) {
    const { waypoints, profile, avoidFerries } = route.planningProvenance;

    const planningElement = doc.createElementNS(ACN_NAMESPACE, "acn:planning");
    planningElement.setAttribute("version", ACN_PLANNING_EXTENSION_VERSION);
    planningElement.setAttribute("profile", profile);
    planningElement.setAttribute("avoidFerries", String(avoidFerries));
    planningElement.setAttribute("waypointCount", String(waypoints.length));
    planningElement.setAttribute("geometrySha256", geometrySha256);

    for (const [longitude, latitude] of waypoints) {
      const waypointElement = doc.createElementNS(ACN_NAMESPACE, "acn:waypoint");
      waypointElement.setAttribute("lon", String(longitude));
      waypointElement.setAttribute("lat", String(latitude));
      planningElement.appendChild(waypointElement);
    }

    extensionChildren.push(planningElement);
  }

  // provider is only ever meaningful for a planner-sourced route (only
  // that arm of PlannedRouteSource has it); profile is read independently
  // of kind, since a gpx-import route can itself legitimately carry a
  // profile recovered from an earlier <acn:source> reimport (see
  // parseAcnExtension.ts's readAcnSourceProfile) — without this, a
  // re-exported reimport would silently lose the profile it had just
  // recovered.
  const sourceProvider =
    route.source.kind === "planner" ? route.source.provider : undefined;
  const sourceProfile = route.source.profile;
  if (sourceProvider !== undefined || sourceProfile !== undefined) {
    const sourceElement = doc.createElementNS(ACN_NAMESPACE, "acn:source");
    if (sourceProvider !== undefined) {
      sourceElement.setAttribute("provider", sourceProvider);
    }
    if (sourceProfile !== undefined) {
      sourceElement.setAttribute("profile", sourceProfile);
    }
    extensionChildren.push(sourceElement);
  }

  if (extensionChildren.length > 0) {
    const extensions = doc.createElementNS(GPX_NAMESPACE, "extensions");
    for (const child of extensionChildren) {
      extensions.appendChild(child);
    }
    trk.appendChild(extensions);
  }

  const trkseg = doc.createElementNS(GPX_NAMESPACE, "trkseg");
  trk.appendChild(trkseg);

  for (const point of route.points) {
    const [longitude, latitude] = point.coordinate;
    const trkpt = doc.createElementNS(GPX_NAMESPACE, "trkpt");
    trkpt.setAttribute("lat", String(latitude));
    trkpt.setAttribute("lon", String(longitude));
    if (point.elevationMetres !== null) {
      const eleElement = doc.createElementNS(GPX_NAMESPACE, "ele");
      eleElement.textContent = String(point.elevationMetres);
      trkpt.appendChild(eleElement);
    }
    trkseg.appendChild(trkpt);
  }

  const serialized = new XMLSerializer().serializeToString(doc);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}
