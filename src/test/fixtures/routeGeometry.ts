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

  const distances = cumulativeDistancesMetres(coordinates);

  return coordinates.map((coordinate, index) => ({
    coordinate,
    elevationMetres: null,
    distanceFromStartMetres: distances[index] ?? 0,
  }));
}
