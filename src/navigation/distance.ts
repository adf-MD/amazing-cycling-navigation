import type { Coordinate } from "../domain/types.ts";

/** IUGG mean Earth radius, in metres. */
const EARTH_RADIUS_METRES = 6_371_008.8;

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
