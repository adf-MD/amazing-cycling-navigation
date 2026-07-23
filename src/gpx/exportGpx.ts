import type { PlannedRoute } from "../domain/types.ts";

const GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1";
const ACN_NAMESPACE =
  "https://adf-md.github.io/amazing-cycling-navigation/gpx-extensions/v1";

/**
 * Serialises a PlannedRoute as a standards-compatible GPX 1.1 track,
 * including full geometry and elevation. Manoeuvres, if present, are
 * written as an optional namespaced <acn:manoeuvre> extension that other
 * GPX readers can safely ignore. Built via the DOM/XMLSerializer rather
 * than string templating so text content and attribute values are always
 * escaped correctly.
 */
export function exportRouteToGpx(route: PlannedRoute): string {
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

  if (route.manoeuvres.length > 0) {
    const extensions = doc.createElementNS(GPX_NAMESPACE, "extensions");
    for (const manoeuvre of route.manoeuvres) {
      const manoeuvreElement = doc.createElementNS(ACN_NAMESPACE, "acn:manoeuvre");
      manoeuvreElement.setAttribute(
        "distanceFromStartMetres",
        String(manoeuvre.distanceFromStartMetres),
      );
      manoeuvreElement.setAttribute("type", manoeuvre.type);
      if (manoeuvre.instruction !== undefined) {
        manoeuvreElement.setAttribute("instruction", manoeuvre.instruction);
      }
      extensions.appendChild(manoeuvreElement);
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
