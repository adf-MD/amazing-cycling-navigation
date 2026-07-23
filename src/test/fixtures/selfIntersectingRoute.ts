import type { Coordinate } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "./routeGeometry.ts";

/**
 * A route that crosses itself once: out east, north, west, then a
 * diagonal leg back down and further east that crosses the very first
 * (eastward) segment near its midpoint.
 */
const SELF_INTERSECTING_WAYPOINTS: readonly Coordinate[] = [
  [0.0, 51.0],
  [0.01, 51.0],
  [0.01, 51.01],
  [0.0, 51.01],
  [0.005, 50.995],
  [0.01, 50.995],
];

export const SELF_INTERSECTING_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  SELF_INTERSECTING_WAYPOINTS,
  10,
);
