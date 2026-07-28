import type { Coordinate } from "../domain/types.ts";
import { EARTH_RADIUS_METRES } from "../navigation/distance.ts";
import type { BoundingBox } from "./routeLayer.ts";

/** Full edge length of the box computeLocalAreaBounds frames by default —
 * an approximate local planning area for a genuinely fresh Planning
 * session or an explicit Locate-me tap, deliberately not a street-level
 * or regional/country scale (see PlanningScreen.tsx). */
export const LOCAL_AREA_BOX_SIZE_METRES = 50_000;

/** Web Mercator's standard supported latitude limit (matches MapLibre/
 * Mapbox GL's own projection limit) — the box's north/south edges, and
 * the latitude used to narrow its east/west edges, are clamped to this
 * rather than left to exceed it or divide by a near-zero cosine near a
 * true pole. */
const MAX_WEB_MERCATOR_LATITUDE_DEGREES = 85.0511;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * A bounding box of edge length `boxSizeMetres` (default
 * LOCAL_AREA_BOX_SIZE_METRES) centred on `centre` — used to frame a
 * genuinely fresh Planning session and an explicit Locate-me request
 * around the rider's approximate location. Distinct from routeLayer.ts's
 * computeBoundingBox, which is a coordinate-array envelope for real route
 * geometry, never a metric box around one point.
 *
 * Longitude is deliberately left unwrapped past ±180° near the
 * antimeridian rather than reordered into [-180, 180]: a small local box
 * straddling the antimeridian is still correctly west < east and of the
 * intended size in that raw, unwrapped form, and MapLibre's own
 * fitBounds/Mercator maths accept out-of-range longitude values for a box
 * this small. Wrapping and reordering risks silently picking the
 * complementary ~310°+ arc instead of the intended ~50 km one.
 *
 * Returns null for non-finite input, a centre latitude outside [-90, 90],
 * or a non-positive box size.
 */
export function computeLocalAreaBounds(
  centre: Coordinate,
  boxSizeMetres: number = LOCAL_AREA_BOX_SIZE_METRES,
): BoundingBox | null {
  const [lon, lat] = centre;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90) return null;
  if (!Number.isFinite(boxSizeMetres) || boxSizeMetres <= 0) return null;

  const halfExtentMetres = boxSizeMetres / 2;
  const deltaLatDegrees = (halfExtentMetres / EARTH_RADIUS_METRES) * (180 / Math.PI);

  // cos(lat) is evaluated at the same Web-Mercator-clamped latitude used
  // for the north/south clamp below, so a centre requested at/near a true
  // pole (outside where Web Mercator represents anything meaningfully)
  // can never divide by a near-zero cosine and produce a degenerate,
  // near-global east-west span.
  const clampedLat = Math.max(
    -MAX_WEB_MERCATOR_LATITUDE_DEGREES,
    Math.min(MAX_WEB_MERCATOR_LATITUDE_DEGREES, lat),
  );
  const deltaLonDegrees =
    (halfExtentMetres / (EARTH_RADIUS_METRES * Math.cos(toRadians(clampedLat)))) *
    (180 / Math.PI);

  const south = Math.max(-MAX_WEB_MERCATOR_LATITUDE_DEGREES, lat - deltaLatDegrees);
  const north = Math.min(MAX_WEB_MERCATOR_LATITUDE_DEGREES, lat + deltaLatDegrees);

  return {
    southWest: [lon - deltaLonDegrees, south],
    northEast: [lon + deltaLonDegrees, north],
  };
}
