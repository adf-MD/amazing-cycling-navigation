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
  /** Presentation-only latch over `lastMatch`, frozen on any single fix
   * whose *raw* (pre-debounce) classification is "off-route" — deliberately
   * not gated on the debounced `offRouteMachineState.level`, which can take
   * several fixes to escalate and by then the windowed search may already
   * have advanced `lastMatch` to an unrelated nearby section (that debounce
   * exists to avoid flashing the off-route *warning* on noise, a different
   * concern). Resumes from the very next fix that isn't raw "off-route",
   * per "resume from the navigation core's next accepted continuous
   * match". Never read by the map's live position marker, camera or
   * off-route warning — those keep using `lastMatch`/`offRouteMachineState`
   * directly. */
  lastReliableMatch: ProjectionMatch | null;
}

export const INITIAL_RIDE_NAVIGATION_CORE_STATE: RideNavigationCoreState = {
  lastMatch: null,
  offRouteMachineState: INITIAL_OFF_ROUTE_STATE,
  lastReliableMatch: null,
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
  const lastReliableMatch = raw === "off-route" ? previous.lastReliableMatch : projection;

  return {
    coreState: { lastMatch: projection, offRouteMachineState, lastReliableMatch },
    projection,
  };
}
