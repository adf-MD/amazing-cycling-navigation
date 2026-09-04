import type { Coordinate, RoutePoint } from "../../domain/types.ts";
import { cumulativeDistancesMetres } from "../../navigation/distance.ts";

function interpolateSegment(
  from: Coordinate,
  to: Coordinate,
  steps: number,
): Coordinate[] {
  const points: Coordinate[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]);
  }
  return points;
}

/**
 * Builds RoutePoints from an already-final coordinate sequence, with no
 * interpolation of any kind. Use this (rather than
 * buildRoutePointsFromWaypoints with stepsPerSegment = 1) whenever a
 * fixture needs two of its points to be BYTE-IDENTICAL: interpolation
 * computes an endpoint as `from + 1 * (to - from)`, which is not
 * guaranteed to reproduce `to` exactly in IEEE-754, so the same physical
 * vertex reached from two different predecessors can differ in its last
 * unit in the last place. Reusing one coordinate value in the input array
 * sidesteps that entirely.
 */
export function buildRoutePointsFromCoordinates(
  coordinates: readonly Coordinate[],
): RoutePoint[] {
  const distances = cumulativeDistancesMetres(coordinates);

  return coordinates.map((coordinate, index) => ({
    coordinate,
    elevationMetres: null,
    distanceFromStartMetres: distances[index] ?? 0,
  }));
}

/** Builds densely-interpolated RoutePoints from a small set of waypoints, matching the shape a real imported route has. */
export function buildRoutePointsFromWaypoints(
  waypoints: readonly Coordinate[],
  stepsPerSegment: number,
): RoutePoint[] {
  const coordinates: Coordinate[] = [];

  for (let i = 0; i < waypoints.length; i += 1) {
    const current = waypoints[i];
    if (current === undefined) continue;

    if (i === 0) {
      coordinates.push(current);
      continue;
    }

    const previous = waypoints[i - 1];
    if (previous === undefined) continue;

    coordinates.push(...interpolateSegment(previous, current, stepsPerSegment).slice(1));
  }

  return buildRoutePointsFromCoordinates(coordinates);
}
