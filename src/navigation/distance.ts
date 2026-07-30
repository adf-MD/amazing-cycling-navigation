import type { Coordinate } from "../domain/types.ts";

/** IUGG mean Earth radius, in metres. */
export const EARTH_RADIUS_METRES = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two coordinates using the haversine formula
 * on a sphere of the IUGG mean Earth radius. This is a small, accepted
 * approximation of the true WGS84 ellipsoid geodesic distance (within a
 * fraction of a percent for recreational route lengths), chosen so every
 * distance figure in the app — point-to-point deltas, cumulative distance,
 * distance remaining — comes from one consistent formula.
 */
export function haversineDistanceMetres(a: Coordinate, b: Coordinate): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;

  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);
  const halfDeltaLat = toRadians(lat2 - lat1) / 2;
  const halfDeltaLon = toRadians(lon2 - lon1) / 2;

  const h =
    Math.sin(halfDeltaLat) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(halfDeltaLon) ** 2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_METRES * centralAngle;
}

/**
 * Cumulative distance from the first coordinate to each coordinate, in
 * order. Returns an array the same length as `coordinates`; the first
 * entry is always 0.
 */
export function cumulativeDistancesMetres(coordinates: readonly Coordinate[]): number[] {
  const distances: number[] = [];
  let total = 0;
  let previous: Coordinate | undefined;

  for (const coordinate of coordinates) {
    if (previous) {
      total += haversineDistanceMetres(previous, coordinate);
    }
    distances.push(total);
    previous = coordinate;
  }

  return distances;
}

export function totalDistanceMetres(coordinates: readonly Coordinate[]): number {
  return cumulativeDistancesMetres(coordinates).at(-1) ?? 0;
}

/**
 * The index into a sorted-ascending array of per-point cumulative
 * distances whose own distance is closest to `targetDistanceMetres`. Used
 * to anchor a manoeuvre (which only stores a distance) to a concrete track
 * point for GPX export — needed because a stitched multi-leg route's
 * manoeuvre distance can legitimately fall between two points, not exactly
 * on one. A target outside the array's range clamps to the nearest end. On
 * an exact tie between two neighbouring points, the earlier index wins,
 * deterministically. Returns -1 for an empty array.
 */
export function nearestPointIndexForDistance(
  distances: readonly number[],
  targetDistanceMetres: number,
): number {
  if (distances.length === 0) {
    return -1;
  }

  let low = 0;
  let high = distances.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((distances[mid] ?? 0) < targetDistanceMetres) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  if (low === 0) {
    return 0;
  }
  const before = distances[low - 1] ?? 0;
  const at = distances[low] ?? 0;
  return targetDistanceMetres - before <= at - targetDistanceMetres ? low - 1 : low;
}
