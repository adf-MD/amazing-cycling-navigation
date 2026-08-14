import { deriveWaypointsFromRoute } from "../navigation/deriveWaypointsFromRoute.ts";
import { DEFAULT_ROUTING_PROFILE } from "./routingProfile.ts";
import type { Coordinate, PlannedRoute, RoutingProfile } from "./types.ts";

/**
 * Cheap, render-safe check for whether "Edit copy" should be offered for a
 * route at all. Deliberately does not run derivation:
 * deriveWaypointsFromRoute can always succeed for two or more points (worst
 * case it converges to the route's own first and last coordinate), so the
 * only real failure mode is too little geometry to begin with. The actual,
 * possibly-expensive resolution only happens once, at the moment the rider
 * presses the action — see resolveEditableWaypoints.
 */
export function canDeriveEditableWaypoints(route: PlannedRoute): boolean {
  return route.points.length >= 2;
}

export interface EditableWaypointsResult {
  waypoints: readonly Coordinate[];
  profile: RoutingProfile;
  avoidFerries: boolean;
  /** "exact" covers both PlanningProvenance kinds (planning-session and
   * acn-gpx-extension) — both are equally trustworthy authored waypoint
   * data, differing only in where they were recovered from. "derived" means
   * no provenance was available and the waypoints were approximated from
   * the route's own geometry. */
  origin: "exact" | "derived";
}

/**
 * Resolves the waypoints an "Edit copy" draft should be seeded with,
 * following the app's documented priority: exact recovered
 * PlanningProvenance first (whichever of its two kinds — see
 * domain/types.ts), otherwise a deterministic, capped derivation from the
 * route's calculated geometry. Returns null only when the route has too
 * little geometry to derive from at all — canDeriveEditableWaypoints should
 * already have ruled this out before a caller reaches this point.
 *
 * The derived branch always uses DEFAULT_ROUTING_PROFILE, never
 * route.source.profile — that field's own doc comment states it "never
 * gates behaviour... its only consumer is a display label," so it must not
 * be used to seed actual routing behaviour for a route with no real
 * planning-waypoint provenance.
 */
export function resolveEditableWaypoints(
  route: PlannedRoute,
  fallbackDefaults: { avoidFerries: boolean },
): EditableWaypointsResult | null {
  if (route.planningProvenance && route.planningProvenance.waypoints.length >= 2) {
    const { waypoints, profile, avoidFerries } = route.planningProvenance;
    return { waypoints, profile, avoidFerries, origin: "exact" };
  }

  const derived = deriveWaypointsFromRoute(route.points);
  if (!derived) {
    return null;
  }

  return {
    waypoints: derived,
    profile: DEFAULT_ROUTING_PROFILE,
    avoidFerries: fallbackDefaults.avoidFerries,
    origin: "derived",
  };
}

/**
 * Returns a new array holding the same coordinates in reverse order, for
 * the "Reverse route" action. Never mutates `waypoints`, and every output
 * tuple is a freshly constructed [lon, lat] pair — no shared references
 * with the input.
 *
 * A plain positional reversal, with no loop-aware special-casing, is
 * already correct for a closed loop: deriveWaypointsFromRoute's own
 * loop-closure step produces a *value*-equal (not reference-equal) final
 * waypoint when it detects one, so for [A, B, C, A] a positional reversal
 * (swap index 0<->3, 1<->2) yields [A, C, B, A] exactly, understood the
 * only way any code in this app ever compares a coordinate — by value,
 * never by object identity.
 */
export function reverseEditableWaypoints(waypoints: readonly Coordinate[]): Coordinate[] {
  return waypoints
    .map(([longitude, latitude]): Coordinate => [longitude, latitude])
    .reverse();
}
