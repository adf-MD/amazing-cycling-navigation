import type { RoutePoint } from "../domain/types.ts";
import type { ElevationWindowMetres } from "./types.ts";

export const DEFAULT_ELEVATION_WINDOW_METRES: ElevationWindowMetres = 5000;

export const ELEVATION_WINDOW_OPTIONS_METRES: readonly ElevationWindowMetres[] = [
  2000, 5000, 10000,
];

export interface UpcomingElevationWindow {
  points: RoutePoint[];
  startDistanceMetres: number;
  endDistanceMetres: number;
}

/**
 * The slice of route points from the rider's current matched distance out
 * to `windowMetres` ahead, clamped to the end of the route when the
 * window would otherwise run past it.
 */
export function selectUpcomingElevationWindow(
  points: readonly RoutePoint[],
  matchedDistanceFromStartMetres: number,
  windowMetres: ElevationWindowMetres,
): UpcomingElevationWindow {
  const routeEndDistanceMetres =
    points.at(-1)?.distanceFromStartMetres ?? matchedDistanceFromStartMetres;
  const endDistanceMetres = Math.min(
    matchedDistanceFromStartMetres + windowMetres,
    routeEndDistanceMetres,
  );

  const windowPoints = points.filter(
    (point) =>
      point.distanceFromStartMetres >= matchedDistanceFromStartMetres &&
      point.distanceFromStartMetres <= endDistanceMetres,
  );

  return {
    points: windowPoints,
    startDistanceMetres: matchedDistanceFromStartMetres,
    endDistanceMetres,
  };
}
