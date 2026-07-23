import { lineString, point } from "@turf/helpers";
import { nearestPointOnLine } from "@turf/nearest-point-on-line";
import type { Coordinate, RoutePoint } from "../domain/types.ts";
import type { ProjectionMatch, ProjectionResult } from "./types.ts";

/** Half-width of the route-distance search window around the last match. */
export const WINDOW_RADIUS_METRES = 400;
/** A windowed match farther than this from the fix is distrusted and triggers a whole-route reacquire. */
export const MAX_ACCEPTABLE_LATERAL_METRES = 300;

interface IndexRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Finds the index range of points within `radiusMetres` of
 * `centreDistanceMetres` along the route. Searching in route-distance
 * space (not geographic space) is what keeps self-intersections and
 * out-and-back sections from snapping to the wrong pass: a geographically
 * close point on a different part of the route usually has a very
 * different distanceFromStartMetres, so it falls outside the window.
 */
function findWindowRange(
  points: readonly RoutePoint[],
  centreDistanceMetres: number,
  radiusMetres: number,
): IndexRange {
  const loDistance = centreDistanceMetres - radiusMetres;
  const hiDistance = centreDistanceMetres + radiusMetres;

  let startIndex = 0;
  while (startIndex < points.length - 1) {
    const current = points[startIndex];
    if (current === undefined || current.distanceFromStartMetres >= loDistance) break;
    startIndex += 1;
  }

  let endIndex = points.length - 1;
  while (endIndex > startIndex) {
    const current = points[endIndex];
    if (current === undefined || current.distanceFromStartMetres <= hiDistance) break;
    endIndex -= 1;
  }

  return { startIndex, endIndex };
}

interface NearestMatch {
  pointIndex: number;
  distanceFromStartMetres: number;
  matchedCoordinate: Coordinate;
  lateralDistanceMetres: number;
}

function nearestWithinRange(
  points: readonly RoutePoint[],
  range: IndexRange,
  fixCoordinate: Coordinate,
): NearestMatch | null {
  const slice = points.slice(range.startIndex, range.endIndex + 1);
  const sliceStart = slice[0];
  if (slice.length < 2 || sliceStart === undefined) {
    return null;
  }

  const line = lineString(slice.map((routePoint) => [...routePoint.coordinate]));
  const fixPoint = point([...fixCoordinate]);
  const nearest = nearestPointOnLine(line, fixPoint, { units: "metres" });

  const [longitude, latitude] = nearest.geometry.coordinates;

  return {
    pointIndex: range.startIndex + nearest.properties.segmentIndex,
    distanceFromStartMetres:
      sliceStart.distanceFromStartMetres + nearest.properties.totalDistance,
    matchedCoordinate: [longitude ?? fixCoordinate[0], latitude ?? fixCoordinate[1]],
    lateralDistanceMetres: nearest.properties.pointDistance,
  };
}

function isClippedAtEdge(
  match: NearestMatch,
  range: IndexRange,
  pointCount: number,
): boolean {
  const windowWasClipped = range.startIndex > 0 || range.endIndex < pointCount - 1;
  if (!windowWasClipped) return false;
  return match.pointIndex <= range.startIndex || match.pointIndex >= range.endIndex - 1;
}

/**
 * Projects a GPS fix onto the route. When `lastMatch` is available, only a
 * window of the route around it is searched first; if that windowed match
 * looks unreliable (too far away, or sitting at the edge of a window that
 * was actually clipped), a whole-route search is used instead and the
 * result is flagged `reacquired`.
 */
export function projectFixOntoRoute(
  fixCoordinate: Coordinate,
  points: readonly RoutePoint[],
  lastMatch: ProjectionMatch | null,
): ProjectionResult | null {
  if (points.length < 2) {
    return null;
  }

  if (lastMatch) {
    const windowRange = findWindowRange(
      points,
      lastMatch.distanceFromStartMetres,
      WINDOW_RADIUS_METRES,
    );
    const windowed = nearestWithinRange(points, windowRange, fixCoordinate);

    if (
      windowed &&
      windowed.lateralDistanceMetres <= MAX_ACCEPTABLE_LATERAL_METRES &&
      !isClippedAtEdge(windowed, windowRange, points.length)
    ) {
      return { ...windowed, reacquired: false };
    }
  }

  const wholeRoute = nearestWithinRange(
    points,
    { startIndex: 0, endIndex: points.length - 1 },
    fixCoordinate,
  );
  if (!wholeRoute) {
    return null;
  }
  return { ...wholeRoute, reacquired: true };
}
