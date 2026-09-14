import type { Coordinate } from "../domain/types.ts";
import { GpxParseError } from "./errors.ts";
import { isValidLatitude, isValidLongitude } from "./validateGpx.ts";

export interface RawGpxPoint {
  coordinate: Coordinate;
  elevationMetres: number | null;
}

/**
 * Something worth telling the rider about an otherwise successful import.
 *
 * Backlog item 113 stage 3: a discriminated union carrying its own typed
 * parameters, so the count in "this file contains N tracks" survives as a
 * number instead of only as part of an English sentence. `message` is
 * retained and still English — it is what the diagnostics log records —
 * but the rider-facing text is now chosen from `kind` and `count`.
 */
export type GpxImportNotice =
  | {
      readonly kind: "multiple-tracks-first-used";
      readonly count: number;
      readonly message: string;
    }
  | {
      readonly kind: "multiple-routes-first-used";
      readonly count: number;
      readonly message: string;
    }
  | { readonly kind: "acn-extension-rejected"; readonly message: string }
  | { readonly kind: "acn-planning-extension-rejected"; readonly message: string };

export interface GpxExtractionResult {
  points: RawGpxPoint[];
  notices: GpxImportNotice[];
  /** The specific <trk> element points was extracted from, so a caller can
   * scope an ACN navigation-extension lookup to exactly this element —
   * never a second, non-selected track. Null when a <rte> was used
   * instead: GPX routes never carry the ACN navigation extension, since
   * this project's own exporter never writes <rte> at all. */
  selectedTrackElement: Element | null;
}

export function parseGpxDocument(xmlText: string): Document {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");

  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError || doc.documentElement.nodeName !== "gpx") {
    throw new GpxParseError(
      { kind: "malformed-xml" },
      "The file is not well-formed GPX/XML.",
    );
  }

  return doc;
}

function readChildText(parent: Element, localName: string): string | null {
  const child = parent.getElementsByTagNameNS("*", localName)[0];
  if (child === undefined) {
    return null;
  }
  const text = child.textContent.trim();
  return text === "" ? null : text;
}

function extractPoint(pointElement: Element): RawGpxPoint {
  const lonAttr = pointElement.getAttribute("lon");
  const latAttr = pointElement.getAttribute("lat");
  const longitude = lonAttr === null ? NaN : Number(lonAttr);
  const latitude = latAttr === null ? NaN : Number(latAttr);

  if (!isValidLongitude(longitude) || !isValidLatitude(latitude)) {
    throw new GpxParseError(
      { kind: "invalid-coordinate", longitude: lonAttr, latitude: latAttr },
      `Point has an invalid or out-of-range coordinate (lon=${lonAttr ?? "missing"}, lat=${latAttr ?? "missing"}).`,
    );
  }

  const elevationText = readChildText(pointElement, "ele");
  let elevationMetres: number | null = null;
  if (elevationText !== null) {
    const elevation = Number(elevationText);
    if (!Number.isFinite(elevation)) {
      throw new GpxParseError(
        { kind: "invalid-elevation", elevation: elevationText },
        `Point has a non-numeric elevation value "${elevationText}".`,
      );
    }
    elevationMetres = elevation;
  }

  const coordinate: Coordinate = [longitude, latitude];
  return { coordinate, elevationMetres };
}

/**
 * Tracks are preferred over routes. When a file has more than one <trk> or
 * <rte>, only the first is imported (in document order) and a notice is
 * returned so nothing is silently dropped. getElementsByTagNameNS returns
 * descendants in document order, so reading every <trkpt> under the chosen
 * <trk> already concatenates its <trkseg> segments correctly without
 * walking them individually.
 */
export function extractRoutePoints(doc: Document): GpxExtractionResult {
  const tracks = Array.from(doc.getElementsByTagNameNS("*", "trk"));
  const firstTrack = tracks[0];

  if (firstTrack) {
    const points = Array.from(firstTrack.getElementsByTagNameNS("*", "trkpt")).map(
      extractPoint,
    );
    if (points.length === 0) {
      throw new GpxParseError(
        { kind: "no-usable-points" },
        "The file has no usable track or route points.",
      );
    }

    const notices: GpxImportNotice[] =
      tracks.length > 1
        ? [
            {
              kind: "multiple-tracks-first-used",
              count: tracks.length,
              message: `This file contains ${String(tracks.length)} tracks; only the first was imported.`,
            },
          ]
        : [];

    return { points, notices, selectedTrackElement: firstTrack };
  }

  const routes = Array.from(doc.getElementsByTagNameNS("*", "rte"));
  const firstRoute = routes[0];

  if (firstRoute) {
    const points = Array.from(firstRoute.getElementsByTagNameNS("*", "rtept")).map(
      extractPoint,
    );
    if (points.length === 0) {
      throw new GpxParseError(
        { kind: "no-usable-points" },
        "The file has no usable track or route points.",
      );
    }

    const notices: GpxImportNotice[] =
      routes.length > 1
        ? [
            {
              kind: "multiple-routes-first-used",
              count: routes.length,
              message: `This file contains ${String(routes.length)} routes; only the first was imported.`,
            },
          ]
        : [];

    return { points, notices, selectedTrackElement: null };
  }

  throw new GpxParseError(
    { kind: "no-track-or-route" },
    "The file has no track or route to import.",
  );
}
