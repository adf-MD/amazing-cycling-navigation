import type { Coordinate, RoutePoint } from "../domain/types.ts";
import { haversineDistanceMetres } from "../navigation/distance.ts";

export const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function toGeoJsonCoordinate(coordinate: Coordinate): [number, number] {
  return [coordinate[0], coordinate[1]];
}

export interface BoundingBox {
  southWest: Coordinate;
  northEast: Coordinate;
}

/** The bounding box of a set of coordinates, or null for an empty route. */
export function computeBoundingBox(
  coordinates: readonly Coordinate[],
): BoundingBox | null {
  if (coordinates.length === 0) {
    return null;
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of coordinates) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return { southWest: [minLon, minLat], northEast: [maxLon, maxLat] };
}

/**
 * Whether a route's first and last points are close enough to treat as a
 * closed loop, rather than genuinely distinct start/finish points. Real
 * GPX loops rarely have byte-identical first/last coordinates — GPS drift
 * when starting/stopping a recording "at the same spot" is normal — so
 * this uses a distance threshold rather than exact equality.
 */
export function isLoopRoute(
  points: readonly RoutePoint[],
  thresholdMetres = 50,
): boolean {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || first === last) return false;
  return haversineDistanceMetres(first.coordinate, last.coordinate) <= thresholdMetres;
}

/** A GeoJSON LineString needs at least 2 positions; fewer than that renders as no line rather than invalid geometry. */
function lineFeatureCollection(
  coordinates: readonly [number, number][],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [...coordinates] },
      },
    ],
  };
}

export function buildRouteLineFeatureCollection(
  points: readonly RoutePoint[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return lineFeatureCollection(
    points.map((point) => toGeoJsonCoordinate(point.coordinate)),
  );
}

export function buildPositionFeatureCollection(
  coordinate: Coordinate,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: toGeoJsonCoordinate(coordinate) },
      },
    ],
  };
}

export interface CompletedRemainingSplit {
  completed: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  remaining: GeoJSON.FeatureCollection<GeoJSON.LineString>;
}

/**
 * Splits the route line at `matchedDistanceMetres`, inserting one
 * interpolated coordinate exactly at the split so the completed and
 * remaining segments meet cleanly instead of jumping between the
 * surrounding original points.
 */
export function splitRouteAtDistance(
  points: readonly RoutePoint[],
  matchedDistanceMetres: number,
): CompletedRemainingSplit {
  const completed: [number, number][] = [];
  const remaining: [number, number][] = [];
  let splitInserted = false;
  let previous: RoutePoint | undefined;

  for (const point of points) {
    if (point.distanceFromStartMetres <= matchedDistanceMetres) {
      completed.push(toGeoJsonCoordinate(point.coordinate));
    } else {
      if (!splitInserted) {
        const splitCoordinate = interpolateSplitCoordinate(
          previous,
          point,
          matchedDistanceMetres,
        );
        const lastCompleted = completed.at(-1);
        const isDuplicateOfLastCompleted =
          lastCompleted?.[0] === splitCoordinate[0] &&
          lastCompleted[1] === splitCoordinate[1];
        if (!isDuplicateOfLastCompleted) {
          completed.push(splitCoordinate);
        }
        remaining.push(splitCoordinate);
        splitInserted = true;
      }
      remaining.push(toGeoJsonCoordinate(point.coordinate));
    }
    previous = point;
  }

  return {
    completed: lineFeatureCollection(completed),
    remaining: lineFeatureCollection(remaining),
  };
}

function interpolateSplitCoordinate(
  previous: RoutePoint | undefined,
  next: RoutePoint,
  matchedDistanceMetres: number,
): [number, number] {
  if (!previous) {
    return toGeoJsonCoordinate(next.coordinate);
  }

  const span = next.distanceFromStartMetres - previous.distanceFromStartMetres;
  const t =
    span === 0 ? 0 : (matchedDistanceMetres - previous.distanceFromStartMetres) / span;
  const [prevLon, prevLat] = previous.coordinate;
  const [nextLon, nextLat] = next.coordinate;

  return [prevLon + t * (nextLon - prevLon), prevLat + t * (nextLat - prevLat)];
}
