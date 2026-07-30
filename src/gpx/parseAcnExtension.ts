import type { Manoeuvre, ManoeuvreType } from "../domain/types.ts";
import { MAX_MANOEUVRE_INSTRUCTION_LENGTH } from "../domain/manoeuvreLimits.ts";
import { cumulativeDistancesMetres } from "../navigation/distance.ts";
import { ACN_NAMESPACE, ACN_NAVIGATION_EXTENSION_VERSION } from "./acnNamespace.ts";
import { canonicalizeTrackGeometry, computeGeometryDigestHex } from "./geometryDigest.ts";
import type { RawGpxPoint } from "./parseGpx.ts";

/** A defensive sanity cap on manoeuvre count, well above any plausible real
 * route (a 300 km route with a turn every 50 m is 6,000 manoeuvres) — not
 * this file's primary size defence, which is validateGpxFile's whole-file
 * MAX_GPX_FILE_SIZE_BYTES limit, enforced before any of this code runs. */
export const MAX_ACN_MANOEUVRES = 10_000;

/** Floor for the per-manoeuvre distance-vs-indexed-point-distance sanity
 * check, used when the local point spacing at that index is smaller than
 * this. The check is a structural sanity guard layered on top of the
 * geometry digest (the real binding mechanism) — it exists to catch a
 * hand-edited/corrupted trackPointIndex/distanceMetres pair even when the
 * digest would otherwise pass, not to re-verify geometry integrity. */
const ACN_MANOEUVRE_DISTANCE_TOLERANCE_FLOOR_METRES = 5;

const CANONICAL_MANOEUVRE_TYPES: ReadonlySet<ManoeuvreType> = new Set<ManoeuvreType>([
  "start",
  "continue",
  "slight-left",
  "left",
  "sharp-left",
  "slight-right",
  "right",
  "sharp-right",
  "u-turn",
  "roundabout",
  "waypoint",
  "finish",
  "unknown",
]);

export type AcnExtensionOutcome =
  | { kind: "absent" }
  | { kind: "accepted"; manoeuvres: Manoeuvre[] }
  | { kind: "rejected" };

function findDirectChild(
  parent: Element,
  predicate: (element: Element) => boolean,
): Element | null {
  for (const child of Array.from(parent.children)) {
    if (predicate(child)) {
      return child;
    }
  }
  return null;
}

function isAcnElement(element: Element, localName: string): boolean {
  return element.namespaceURI === ACN_NAMESPACE && element.localName === localName;
}

/**
 * Reads and validates a project-owned <acn:navigation> extension attached
 * to `selectedTrackElement` (the exact <trk> element points was extracted
 * from — never a second, non-selected track, and never an extension
 * nested inside a per-point <extensions>, since only the track's own
 * direct-child <extensions> is ever consulted). Namespace-aware: the
 * `acn:` prefix itself is never trusted, only the namespace URI.
 *
 * All-or-nothing: any single structural or geometry-binding failure
 * discards the entire envelope ("rejected") rather than a partial
 * manoeuvre list. "absent" (no notice needed) is distinct from "rejected"
 * (caller should surface a non-blocking notice) — an ordinary GPX simply
 * has no extension at all.
 */
export async function readAcnNavigationExtension(
  selectedTrackElement: Element,
  points: readonly RawGpxPoint[],
): Promise<AcnExtensionOutcome> {
  const extensionsElement = findDirectChild(
    selectedTrackElement,
    (element) => element.localName === "extensions",
  );
  if (!extensionsElement) {
    return { kind: "absent" };
  }

  const navigationElement = findDirectChild(extensionsElement, (element) =>
    isAcnElement(element, "navigation"),
  );
  if (!navigationElement) {
    return { kind: "absent" };
  }

  if (navigationElement.getAttribute("version") !== ACN_NAVIGATION_EXTENSION_VERSION) {
    return { kind: "rejected" };
  }

  const manoeuvreElements = Array.from(navigationElement.children).filter((element) =>
    isAcnElement(element, "manoeuvre"),
  );
  if (manoeuvreElements.length > MAX_ACN_MANOEUVRES) {
    return { kind: "rejected" };
  }

  const pointCountAttr = navigationElement.getAttribute("pointCount");
  const pointCount = pointCountAttr === null ? NaN : Number(pointCountAttr);
  if (!Number.isInteger(pointCount) || pointCount !== points.length) {
    return { kind: "rejected" };
  }

  const distances = cumulativeDistancesMetres(points.map((point) => point.coordinate));
  const totalDistanceMetres = distances.at(-1) ?? 0;

  const manoeuvres: Manoeuvre[] = [];
  let previousDistanceMetres = -Infinity;

  for (const element of manoeuvreElements) {
    const trackPointIndexAttr = element.getAttribute("trackPointIndex");
    const trackPointIndex =
      trackPointIndexAttr === null ? NaN : Number(trackPointIndexAttr);
    if (
      !Number.isInteger(trackPointIndex) ||
      trackPointIndex < 0 ||
      trackPointIndex >= points.length
    ) {
      return { kind: "rejected" };
    }

    const distanceAttr = element.getAttribute("distanceMetres");
    const distanceMetres = distanceAttr === null ? NaN : Number(distanceAttr);
    if (!Number.isFinite(distanceMetres) || distanceMetres < 0) {
      return { kind: "rejected" };
    }
    if (distanceMetres < previousDistanceMetres) {
      return { kind: "rejected" };
    }
    if (
      distanceMetres >
      totalDistanceMetres + ACN_MANOEUVRE_DISTANCE_TOLERANCE_FLOOR_METRES
    ) {
      return { kind: "rejected" };
    }

    const pointDistanceMetres = distances[trackPointIndex] ?? 0;
    const gapBefore =
      trackPointIndex > 0
        ? pointDistanceMetres - (distances[trackPointIndex - 1] ?? pointDistanceMetres)
        : 0;
    const gapAfter =
      trackPointIndex < points.length - 1
        ? (distances[trackPointIndex + 1] ?? pointDistanceMetres) - pointDistanceMetres
        : 0;
    const tolerance = Math.max(
      ACN_MANOEUVRE_DISTANCE_TOLERANCE_FLOOR_METRES,
      gapBefore,
      gapAfter,
    );
    if (Math.abs(pointDistanceMetres - distanceMetres) > tolerance) {
      return { kind: "rejected" };
    }

    const rawType = element.getAttribute("type");
    const type: ManoeuvreType =
      rawType !== null && CANONICAL_MANOEUVRE_TYPES.has(rawType as ManoeuvreType)
        ? (rawType as ManoeuvreType)
        : "unknown";

    const instructionElement = findDirectChild(element, (child) =>
      isAcnElement(child, "instruction"),
    );
    const instructionText = instructionElement?.textContent.trim();
    const instruction =
      instructionText && instructionText.length > 0
        ? instructionText.slice(0, MAX_MANOEUVRE_INSTRUCTION_LENGTH)
        : undefined;

    manoeuvres.push({
      // The canonical, recomputed distance for this point — not the raw
      // attribute text — so this manoeuvre relates exactly to a real
      // points[] entry, and a subsequent re-export's own nearest-point
      // lookup is exact.
      distanceFromStartMetres: pointDistanceMetres,
      type,
      ...(instruction !== undefined ? { instruction } : {}),
    });

    previousDistanceMetres = distanceMetres;
  }

  const geometrySha256Attr = navigationElement.getAttribute("geometrySha256");
  if (!geometrySha256Attr || !/^[0-9a-f]{64}$/i.test(geometrySha256Attr)) {
    return { kind: "rejected" };
  }

  const canonical = canonicalizeTrackGeometry(points.map((point) => point.coordinate));
  const computedDigest = await computeGeometryDigestHex(canonical);
  if (computedDigest !== geometrySha256Attr.toLowerCase()) {
    return { kind: "rejected" };
  }

  return { kind: "accepted", manoeuvres };
}
