import type { Coordinate } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "./routeGeometry.ts";

/**
 * A closed-loop route: a roughly 3.6 km square whose first and final
 * waypoints coincide exactly. Long enough that a WINDOW_RADIUS_METRES
 * (400 m) window centred near the finish excludes the route's own start
 * by route distance (and vice versa near the start) — the precondition
 * for exercising a windowed match at one genuine, un-clipped edge while
 * the opposite edge of the same window is genuinely clipped.
 */
const CLOSED_LOOP_WAYPOINTS: readonly Coordinate[] = [
  [0, 51],
  [0.01, 51],
  [0.01, 51.01],
  [0, 51.01],
  [0, 51],
];

export const CLOSED_LOOP_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  CLOSED_LOOP_WAYPOINTS,
  20,
);
