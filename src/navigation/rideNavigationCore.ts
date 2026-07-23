import type { Coordinate, RoutePoint } from "../domain/types.ts";
import {
  classifyFix,
  INITIAL_OFF_ROUTE_STATE,
  nextOffRouteState,
  type OffRouteMachineState,
} from "./offRoute.ts";
import { projectFixOntoRoute } from "./projection.ts";
import type { ProjectionMatch, ProjectionResult } from "./types.ts";

export interface RideNavigationCoreState {
  lastMatch: ProjectionMatch | null;
  offRouteMachineState: OffRouteMachineState;
}

export const INITIAL_RIDE_NAVIGATION_CORE_STATE: RideNavigationCoreState = {
  lastMatch: null,
  offRouteMachineState: INITIAL_OFF_ROUTE_STATE,
};

export interface FixProcessingResult {
  coreState: RideNavigationCoreState;
  projection: ProjectionResult | null;
}

/**
 * Combines projection and off-route classification for one accepted GPS
 * fix. Pure and side-effect free, so it can compose and be tested
 * independently of geolocation, storage or React.
 */
export function processFix(
  points: readonly RoutePoint[],
  fixCoordinate: Coordinate,
  accuracyMetres: number,
  previous: RideNavigationCoreState,
): FixProcessingResult {
  const projection = projectFixOntoRoute(fixCoordinate, points, previous.lastMatch);
  if (!projection) {
    return { coreState: previous, projection: null };
  }

  const raw = classifyFix(
    projection.lateralDistanceMetres,
    accuracyMetres,
    projection.reacquired,
  );
  const offRouteMachineState = nextOffRouteState(previous.offRouteMachineState, raw);

  return {
    coreState: { lastMatch: projection, offRouteMachineState },
    projection,
  };
}
