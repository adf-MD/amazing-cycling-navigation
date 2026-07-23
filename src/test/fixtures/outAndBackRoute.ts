import type { Coordinate } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "./routeGeometry.ts";

/**
 * An out-and-back route: east to a turnaround, then back west along a
 * path offset by only ~11 m in latitude — geographically almost
 * coincident with the outbound leg, but a distinct, later part of the
 * route.
 */
const OUT_AND_BACK_WAYPOINTS: readonly Coordinate[] = [
  [0.0, 51.0],
  [0.01, 51.0],
  [0.02, 51.0],
  [0.01, 51.0001],
  [0.0, 51.0001],
];

export const OUT_AND_BACK_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  OUT_AND_BACK_WAYPOINTS,
  10,
);

export const OUT_AND_BACK_TURNAROUND_INDEX = 20;
