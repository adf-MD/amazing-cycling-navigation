import type { Coordinate, RoutePoint } from "../domain/types.ts";
import type { ElevationViewMode, ElevationWindowMetres } from "./types.ts";

/**
 * Builds the elevation-profile view for either display mode: a rolling
 * forward-looking window ("upcoming") rebased so the rider's position is
 * the exact left edge, or a marker onto the whole route ("full").
 */

export const DEFAULT_ELEVATION_WINDOW_METRES: ElevationWindowMetres = 5000;

export const ELEVATION_WINDOW_OPTIONS_METRES: readonly ElevationWindowMetres[] = [
  2000, 5000, 10000,
];

export const DEFAULT_ELEVATION_VIEW_MODE: ElevationViewMode = {
  kind: "upcoming",
  windowMetres: DEFAULT_ELEVATION_WINDOW_METRES,
};

export const ELEVATION_VIEW_MODE_OPTIONS: readonly ElevationViewMode[] = [
  { kind: "full" },
  ...ELEVATION_WINDOW_OPTIONS_METRES.map((windowMetres): ElevationViewMode => ({
    kind: "upcoming",
    windowMetres,
  })),
];

export interface UpcomingElevationWindow {
  points: RoutePoint[];
  startDistanceMetres: number;
  endDistanceMetres: number;
}

export interface FullProfileMarker {
  markerDistanceFromStartMetres: number;
  point: RoutePoint;
}

/**
 * The route point at `distanceFromStartMetres`, clamped to the route's own
 * bounds. Returns the exact stored point when one already sits at that
 * distance (no synthetic duplicate at window seams). Otherwise linearly
 * interpolates coordinate between the bracketing pair; elevation is only
 * interpolated when both bracketing points have known elevation, so a gap
 * is never bridged with an invented value.
 */
export function interpolateRoutePointAt(
  points: readonly RoutePoint[],
  distanceFromStartMetres: number,
): RoutePoint | null {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }

  const clamped = Math.min(
    Math.max(distanceFromStartMetres, first.distanceFromStartMetres),
    last.distanceFromStartMetres,
  );

  const afterIndex = points.findIndex(
    (point) => point.distanceFromStartMetres >= clamped,
  );
  const after = points[afterIndex];
  if (after === undefined) {
    throw new Error("unreachable: clamped distance must be <= the last point's distance");
  }
  if (after.distanceFromStartMetres === clamped) {
    return after;
  }

  const before = points[afterIndex - 1];
  if (before === undefined) {
    throw new Error(
      "unreachable: a point strictly after the clamped distance implies an earlier point exists",
    );
  }

  const span = after.distanceFromStartMetres - before.distanceFromStartMetres;
  const t = span === 0 ? 0 : (clamped - before.distanceFromStartMetres) / span;

  const elevationMetres =
    before.elevationMetres !== null && after.elevationMetres !== null
      ? before.elevationMetres + t * (after.elevationMetres - before.elevationMetres)
      : null;

  const coordinate: Coordinate = [
    before.coordinate[0] + t * (after.coordinate[0] - before.coordinate[0]),
    before.coordinate[1] + t * (after.coordinate[1] - before.coordinate[1]),
  ];

  return { coordinate, elevationMetres, distanceFromStartMetres: clamped };
}

/**
 * The slice of route points from the rider's current matched distance out
 * to `windowMetres` ahead, clamped to the end of the route when the window
 * would otherwise run past it. Boundary samples are interpolated so the
 * window's `distanceFromStartMetres` values run from the exact matched
 * distance to the exact (possibly clamped) end distance — callers rebase
 * these against `startDistanceMetres`/`endDistanceMetres` for display.
 */
export function selectUpcomingElevationWindow(
  points: readonly RoutePoint[],
  matchedDistanceFromStartMetres: number,
  windowMetres: ElevationWindowMetres,
): UpcomingElevationWindow {
  const last = points.at(-1);
  if (last === undefined) {
    return { points: [], startDistanceMetres: 0, endDistanceMetres: 0 };
  }

  const startPoint = interpolateRoutePointAt(points, matchedDistanceFromStartMetres);
  if (startPoint === null) {
    throw new Error(
      "unreachable: interpolateRoutePointAt returns null only for an empty route",
    );
  }
  const startDistanceMetres = startPoint.distanceFromStartMetres;
  const endDistanceMetres = Math.min(
    startDistanceMetres + windowMetres,
    last.distanceFromStartMetres,
  );

  if (startDistanceMetres === endDistanceMetres) {
    return { points: [startPoint], startDistanceMetres, endDistanceMetres };
  }

  const endPoint = interpolateRoutePointAt(points, endDistanceMetres);
  if (endPoint === null) {
    throw new Error(
      "unreachable: interpolateRoutePointAt returns null only for an empty route",
    );
  }

  const interiorPoints = points.filter(
    (point) =>
      point.distanceFromStartMetres > startDistanceMetres &&
      point.distanceFromStartMetres < endDistanceMetres,
  );

  return {
    points: [startPoint, ...interiorPoints, endPoint],
    startDistanceMetres,
    endDistanceMetres,
  };
}

/**
 * The marker position for the "full" profile view: the rider's matched
 * distance interpolated onto the whole route. `null` only for an empty
 * route.
 */
export function buildFullProfileMarker(
  points: readonly RoutePoint[],
  matchedDistanceFromStartMetres: number,
): FullProfileMarker | null {
  const point = interpolateRoutePointAt(points, matchedDistanceFromStartMetres);
  if (point === null) {
    return null;
  }
  return { markerDistanceFromStartMetres: point.distanceFromStartMetres, point };
}
