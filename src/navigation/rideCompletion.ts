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
}

export const INITIAL_ROUTE_COMPLETION_TRACKER_STATE: RouteCompletionTrackerState = {
  consecutiveEligibleCount: 0,
  isDismissed: false,
};

export type RouteCompletionTrackerEvent =
  { type: "fix-evaluated"; eligible: boolean } | { type: "dismiss" } | { type: "reset" };

/**
 * Tracks consecutive eligible fixes and a per-ride dismissal. Deliberately
 * non-latching: an ineligible fix resets the streak even after previously
 * reaching the required count, so a momentary false positive doesn't leave
 * completion "stuck" confirmed. "dismiss" is sticky until an explicit
 * "reset" (a genuinely new ride, or the same route finalised and started
 * again) — see isRouteCompletionConfirmed.
 */
export function routeCompletionTrackerReducer(
  state: RouteCompletionTrackerState,
  event: RouteCompletionTrackerEvent,
): RouteCompletionTrackerState {
  switch (event.type) {
    case "fix-evaluated":
      return {
        ...state,
        consecutiveEligibleCount: event.eligible ? state.consecutiveEligibleCount + 1 : 0,
      };
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
    !state.isDismissed &&
    state.consecutiveEligibleCount >= ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED
  );
}
