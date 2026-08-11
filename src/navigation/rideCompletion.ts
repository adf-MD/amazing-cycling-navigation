import type { Coordinate } from "../domain/types.ts";
import { haversineDistanceMetres } from "./distance.ts";
import { MAX_TRUSTED_ACCURACY_METRES } from "./offRoute.ts";
import type { OffRouteLevel } from "./types.ts";

/** Base radius, in metres, a raw GPS fix must be within of the route's own
 * final coordinate to count as "physically near the endpoint" — comparable
 * to offRoute.ts's own POSSIBLY_OFF_ROUTE_BASE_METRES (20 m), since both are
 * conservative near-route proximity judgements. */
export const ROUTE_COMPLETION_ENDPOINT_BASE_RADIUS_METRES = 25;

/** How much a fix's own reported accuracy inflates the endpoint radius,
 * mirroring offRoute.ts's identical ACCURACY_MULTIPLIER. */
export const ROUTE_COMPLETION_ENDPOINT_ACCURACY_MULTIPLIER = 1.0;

/** Caps the accuracy-derived radius allowance so one very inaccurate (but
 * still trusted, i.e. at or below MAX_TRUSTED_ACCURACY_METRES) fix can never
 * qualify from an unreasonable distance. */
export const ROUTE_COMPLETION_ENDPOINT_MAX_ACCURACY_ALLOWANCE_METRES = 40;

/** How close the rider's reliable route progress must be to the route's
 * total distance, in metres, before endpoint proximity is even considered —
 * matches offRoute.ts's own OFF_ROUTE_BASE_METRES order of magnitude. This
 * is what makes a closed loop or an out-and-back/self-crossing route safe
 * with no special-casing: being geographically near the endpoint early
 * (the shared start/finish, or an early crossing) always fails this gate
 * first, since reliable progress is far from the total there regardless of
 * raw proximity. */
export const ROUTE_COMPLETION_REMAINING_DISTANCE_THRESHOLD_METRES = 50;

/** Consecutive accepted, eligible fixes required before completion is
 * confirmed — matches offRoute.ts's own CONSECUTIVE_TO_DEESCALATE, so a
 * single noisy sample can never suggest completion. */
export const ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED = 2;

/** Base radius, in metres, a raw GPS fix must be OUTSIDE of the route's own
 * final coordinate before it counts as evidence of genuine departure —
 * deliberately much larger than ROUTE_COMPLETION_ENDPOINT_BASE_RADIUS_METRES
 * (25 m), so a rider has to have travelled meaningfully further away than
 * "near the finish" before departure evidence starts accruing. This
 * hysteresis is what stops a ride that merely lingers near a shared
 * start/finish coordinate from ever looking "departed". */
export const ROUTE_COMPLETION_ARMING_DEPARTURE_BASE_RADIUS_METRES = 75;

/** Mirrors offRoute.ts's/the completion module's own identical multiplier. */
export const ROUTE_COMPLETION_ARMING_DEPARTURE_ACCURACY_MULTIPLIER = 1.0;

/** Caps how much a poor-but-trusted accuracy reading can inflate the
 * departure exclusion radius. Note this cap works in the OPPOSITE sense
 * from ROUTE_COMPLETION_ENDPOINT_MAX_ACCURACY_ALLOWANCE_METRES: the
 * completion cap stops a poor-accuracy fix being wrongly admitted from too
 * far away, whereas this cap stops a poor-accuracy fix from facing an
 * unreasonably inflated exclusion zone it could never practically clear. */
export const ROUTE_COMPLETION_ARMING_DEPARTURE_MAX_ACCURACY_ALLOWANCE_METRES = 50;

/** The reliable route-progress fraction (0-1) a rider must have covered
 * before their position counts as credible interior progress — i.e. "has
 * genuinely gone somewhere", not "is still essentially at the start". */
export const ROUTE_COMPLETION_ARMING_INTERIOR_MIN_FRACTION = 0.1;

/** The reliable route-progress fraction (0-1) a rider must still be short
 * of — i.e. "has not already jumped to essentially the finish". Using
 * route-relative fractions, rather than fixed metre thresholds, keeps both
 * short and long routes practical. Deliberately well short of 1.0 so a
 * fix that misreports near-total progress (the exact hostile scenario this
 * module exists to guard against) can never itself count as interior
 * progress. */
export const ROUTE_COMPLETION_ARMING_INTERIOR_MAX_FRACTION = 0.8;

/** Consecutive arming-eligible fixes required before a ride is armed —
 * matches ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED, so a single noisy
 * sample can never arm a ride either. */
export const ROUTE_COMPLETION_ARMING_CONSECUTIVE_FIXES_REQUIRED = 2;

export interface RouteArmingFixInput {
  isRideActive: boolean;
  isStale: boolean;
  currentCoordinate: Coordinate | null;
  currentAccuracyMetres: number | null;
  reliableDistanceFromStartMetres: number | null;
  routeTotalDistanceMetres: number;
  routeFinalCoordinate: Coordinate | null;
}

/**
 * Conservatively decides whether one accepted navigation snapshot is
 * evidence that the rider has genuinely departed the finish area AND made
 * credible interior progress — the prerequisite this module requires
 * before any fix can count towards route completion at all (see
 * RouteCompletionTrackerState.isArmed). Both the departure and interior
 * checks must hold. Deliberately independent of, and stricter/wider than,
 * isRouteCompletionCandidateEligible's own endpoint-proximity/remaining-
 * distance checks — arming is about proving the ride has actually
 * happened, not about detecting the finish.
 */
export function isRouteArmingFixEligible(input: RouteArmingFixInput): boolean {
  if (!input.isRideActive) return false;
  if (input.isStale) return false;
  if (input.currentCoordinate === null || input.routeFinalCoordinate === null) {
    return false;
  }
  if (input.reliableDistanceFromStartMetres === null) return false;
  if (
    !Number.isFinite(input.routeTotalDistanceMetres) ||
    input.routeTotalDistanceMetres <= 0
  ) {
    return false;
  }
  if (
    input.currentAccuracyMetres === null ||
    !Number.isFinite(input.currentAccuracyMetres) ||
    input.currentAccuracyMetres > MAX_TRUSTED_ACCURACY_METRES
  ) {
    return false;
  }

  const departureDistanceMetres = haversineDistanceMetres(
    input.currentCoordinate,
    input.routeFinalCoordinate,
  );
  if (!Number.isFinite(departureDistanceMetres)) return false;

  const departureAccuracyAllowanceMetres = Math.min(
    input.currentAccuracyMetres * ROUTE_COMPLETION_ARMING_DEPARTURE_ACCURACY_MULTIPLIER,
    ROUTE_COMPLETION_ARMING_DEPARTURE_MAX_ACCURACY_ALLOWANCE_METRES,
  );
  const departureRadiusMetres =
    ROUTE_COMPLETION_ARMING_DEPARTURE_BASE_RADIUS_METRES +
    departureAccuracyAllowanceMetres;
  if (departureDistanceMetres <= departureRadiusMetres) return false;

  const progressFraction =
    input.reliableDistanceFromStartMetres / input.routeTotalDistanceMetres;
  if (!Number.isFinite(progressFraction)) return false;
  if (progressFraction < ROUTE_COMPLETION_ARMING_INTERIOR_MIN_FRACTION) return false;
  if (progressFraction > ROUTE_COMPLETION_ARMING_INTERIOR_MAX_FRACTION) return false;

  return true;
}

export interface RouteCompletionCandidateInput {
  /** Whether the ride is actively tracking (a live geolocation watch),
   * never merely a pre-ride or Resume-riding screen. */
  isRideActive: boolean;
  isStale: boolean;
  offRouteLevel: OffRouteLevel;
  /** The raw GPS fix coordinate — deliberately not the matched/projected
   * point, since endpoint proximity is a real-world physical-position
   * judgement, not a route-matching one. */
  currentCoordinate: Coordinate | null;
  currentAccuracyMetres: number | null;
  /** The frozen/reliable presentation distance (see
   * RideNavigationCoreState.lastReliableMatch) — never the live/raw matched
   * distance, per this app's existing presentation-progress policy. */
  reliableDistanceFromStartMetres: number | null;
  routeTotalDistanceMetres: number;
  routeFinalCoordinate: Coordinate | null;
}

/**
 * Conservatively decides whether one accepted navigation snapshot is
 * eligible to count towards route completion. Pure and side-effect free.
 * Requires, together: active tracking, a fresh fix, not strongly off
 * route, a trusted fix accuracy, reliable progress near the route's total
 * distance, and the raw fix physically near the route's own final
 * coordinate (within a radius that a poor accuracy reading can inflate
 * only up to a conservative cap). See this module's own constants for the
 * exact thresholds and their relationship to offRoute.ts's existing ones.
 */
export function isRouteCompletionCandidateEligible(
  input: RouteCompletionCandidateInput,
): boolean {
  if (!input.isRideActive) return false;
  if (input.isStale) return false;
  if (input.offRouteLevel === "off-route") return false;
  if (input.currentCoordinate === null || input.routeFinalCoordinate === null) {
    return false;
  }
  if (input.reliableDistanceFromStartMetres === null) return false;
  if (
    !Number.isFinite(input.routeTotalDistanceMetres) ||
    input.routeTotalDistanceMetres <= 0
  ) {
    return false;
  }
  if (
    input.currentAccuracyMetres === null ||
    !Number.isFinite(input.currentAccuracyMetres) ||
    input.currentAccuracyMetres > MAX_TRUSTED_ACCURACY_METRES
  ) {
    return false;
  }

  const remainingMetres =
    input.routeTotalDistanceMetres - input.reliableDistanceFromStartMetres;
  if (
    !Number.isFinite(remainingMetres) ||
    remainingMetres > ROUTE_COMPLETION_REMAINING_DISTANCE_THRESHOLD_METRES
  ) {
    return false;
  }

  const endpointDistanceMetres = haversineDistanceMetres(
    input.currentCoordinate,
    input.routeFinalCoordinate,
  );
  if (!Number.isFinite(endpointDistanceMetres)) return false;

  const accuracyAllowanceMetres = Math.min(
    input.currentAccuracyMetres * ROUTE_COMPLETION_ENDPOINT_ACCURACY_MULTIPLIER,
    ROUTE_COMPLETION_ENDPOINT_MAX_ACCURACY_ALLOWANCE_METRES,
  );
  const radiusMetres =
    ROUTE_COMPLETION_ENDPOINT_BASE_RADIUS_METRES + accuracyAllowanceMetres;

  return endpointDistanceMetres <= radiusMetres;
}

export interface RouteCompletionTrackerState {
  consecutiveEligibleCount: number;
  isDismissed: boolean;
  /** True once this ride has demonstrated genuine departure and interior
   * progress (see isRouteArmingFixEligible) — either from fresh evidence
   * accrued this session, or adopted from a persisted, previously-armed
   * ride (see the "external-armed" event). One-way: never reset back to
   * false except by "reset" (a genuinely new ride, or the same route
   * restarted after End/Finish). completionEligible evidence is ignored
   * entirely while this is false — see the "fix-evaluated" case below. */
  isArmed: boolean;
  consecutiveArmingEligibleCount: number;
}

export const INITIAL_ROUTE_COMPLETION_TRACKER_STATE: RouteCompletionTrackerState = {
  consecutiveEligibleCount: 0,
  isDismissed: false,
  isArmed: false,
  consecutiveArmingEligibleCount: 0,
};

export type RouteCompletionTrackerEvent =
  | { type: "fix-evaluated"; armingEligible: boolean; completionEligible: boolean }
  | { type: "external-armed" }
  | { type: "dismiss" }
  | { type: "reset" };

/**
 * Tracks consecutive eligible fixes, arming and a per-ride dismissal.
 * Deliberately non-latching for the completion streak: an ineligible fix
 * resets it even after previously reaching the required count, so a
 * momentary false positive doesn't leave completion "stuck" confirmed.
 * "dismiss" is sticky until an explicit "reset" (a genuinely new ride, or
 * the same route finalised and started again) — see
 * isRouteCompletionConfirmed.
 *
 * "fix-evaluated" carries both dimensions in one event (rather than two
 * separate dispatches) and branches on the CURRENT isArmed: while unarmed,
 * only arming evidence progresses and completionEligible is ignored
 * outright, regardless of its value — this is the literal mechanism behind
 * "no fix can count towards route completion until armed", not merely an
 * incidental consequence of arming-interior and completion ranges never
 * overlapping (they can, on a route short enough that its remaining-
 * distance completion threshold falls within the interior fraction — the
 * ignore-while-unarmed rule holds regardless). Once armed, only the
 * completion streak progresses; arming fields are frozen.
 */
export function routeCompletionTrackerReducer(
  state: RouteCompletionTrackerState,
  event: RouteCompletionTrackerEvent,
): RouteCompletionTrackerState {
  switch (event.type) {
    case "fix-evaluated": {
      if (!state.isArmed) {
        const consecutiveArmingEligibleCount = event.armingEligible
          ? state.consecutiveArmingEligibleCount + 1
          : 0;
        const isArmed =
          consecutiveArmingEligibleCount >=
          ROUTE_COMPLETION_ARMING_CONSECUTIVE_FIXES_REQUIRED;
        return { ...state, consecutiveArmingEligibleCount, isArmed };
      }
      return {
        ...state,
        consecutiveEligibleCount: event.completionEligible
          ? state.consecutiveEligibleCount + 1
          : 0,
      };
    }
    case "external-armed":
      return state.isArmed ? state : { ...state, isArmed: true };
    case "dismiss":
      return { ...state, isDismissed: true };
    case "reset":
      return INITIAL_ROUTE_COMPLETION_TRACKER_STATE;
    default:
      return state;
  }
}

export function isRouteCompletionConfirmed(state: RouteCompletionTrackerState): boolean {
  return (
    state.isArmed &&
    !state.isDismissed &&
    state.consecutiveEligibleCount >= ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED
  );
}
