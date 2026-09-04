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

  // Classification is deliberately computed BEFORE the hold decision
  // below, and always from this fix's own lateral distance. On exactly
  // overlapping geometry both tied occurrences sit on the same line, so
  // lateral distance is identical whichever one was selected — holding
  // progress must therefore never hold off-route classification with it.
  // A rider drifting sideways while progress is held still escalates
  // through the unchanged debounce exactly as they otherwise would.
  const raw = classifyFix(
    projection.lateralDistanceMetres,
    accuracyMetres,
    projection.reacquired,
  );
  const offRouteMachineState = nextOffRouteState(previous.offRouteMachineState, raw);

  // Backlog item 104 follow-up. An unresolved tied regression (see
  // ProjectionDisposition) is not yet evidence of anything: it is a step
  // too small for the projection layer's own forward override to consider,
  // on geometry where the same coordinate legitimately means two different
  // route distances. Adopting it would make it the next fix's anchor, and
  // a slow rider's repeated sub-epsilon steps would then walk progress
  // backwards down an exactly retraced leg indefinitely, never once
  // accumulating a regression large enough to be examined.
  //
  // So both anchors are held at their previous values — lastMatch because
  // it is the comparison basis the next fix's regression is measured
  // against, and lastReliableMatch because it is what the rider actually
  // sees as remaining distance, remaining ascent and the trusted
  // next-manoeuvre cue. The hold lasts until cumulative regression from
  // that stable anchor passes PROGRESS_EPSILON_METRES, at which point the
  // unchanged selector resolves it — either onto the return occurrence, or
  // (when the advancing alternative is further away than
  // CONTINUITY_PREFERENCE_METRES allows) onto genuine outbound
  // backtracking. Nothing here is a monotonic clamp: outside a tie,
  // progress still moves backwards whenever the rider does.
  if (projection.disposition === "tied-sub-epsilon-regression") {
    return {
      coreState: {
        lastMatch: previous.lastMatch,
        offRouteMachineState,
        lastReliableMatch: previous.lastReliableMatch,
      },
      projection,
    };
  }

  const lastReliableMatch = raw === "off-route" ? previous.lastReliableMatch : projection;

  return {
    coreState: { lastMatch: projection, offRouteMachineState, lastReliableMatch },
    projection,
  };
}
