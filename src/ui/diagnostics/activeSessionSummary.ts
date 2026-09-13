import type { StoredRideState } from "../../storage/db.ts";
import {
  isStoredFreeRoamRideState,
  isStoredRouteRideState,
} from "../../storage/mapping.ts";

/**
 * A route-name lookup result, tagged with the id it was resolved for.
 *
 * The tag is load-bearing, not bookkeeping. `useLiveQuery` resubscribes when
 * its querier's identity changes but does **not** reset the value it is
 * already holding, so between one session being replaced by another and the
 * new lookup resolving, the hook still returns the *previous* route's
 * result. Carrying `routeId` back is what lets the caller recognise that
 * and show a placeholder instead of the wrong route's name.
 *
 * `name` is `null` specifically when the lookup completed and found no such
 * route — a deleted route, which is genuinely reachable because no delete
 * path clears the active ride state. That is distinct from the hook
 * returning `undefined`, which here means only "still resolving": the
 * querier always produces an object once a route id exists.
 */
export interface ResolvedActiveRoute {
  routeId: string;
  name: string | null;
}

/**
 * The rider-facing `Active session` value for the Status screen (backlog
 * item 117). Pure, so every branch — including the superseded-result guard,
 * which is otherwise a race to reproduce — is directly testable.
 *
 * A route-backed session shows the route's own name and never its internal
 * identifier. The identifier stays in application state; it is simply not
 * something to put in front of a rider.
 */
export function describeActiveSession(
  rideState: StoredRideState | undefined,
  resolvedRoute: ResolvedActiveRoute | undefined,
): string {
  if (!rideState) return "None";
  if (isStoredFreeRoamRideState(rideState)) return "Free roam";

  // Neither guard is true for a session whose stored `kind` this build does
  // not recognise — a row a newer build could have written. getActiveRideState
  // is a raw read with no parsing, so such a row genuinely reaches this
  // screen, and calling it "Free roam" would be a plain misstatement.
  if (!isStoredRouteRideState(rideState)) return "Session unavailable";

  // Still resolving, or holding a result for a session that has since been
  // replaced. Never the identifier, and never "None" — a route-backed
  // session does exist.
  if (resolvedRoute?.routeId !== rideState.routeId) return "Checking…";

  // Storage never validates `name`, and this screen's own contract is that
  // no field renders blank, so a whitespace-only name falls back too.
  const name = resolvedRoute.name?.trim() ?? "";
  return name.length > 0 ? name : "Route unavailable";
}
