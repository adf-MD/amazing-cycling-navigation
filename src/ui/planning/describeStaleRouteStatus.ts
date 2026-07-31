import { formatRoutingProfileLabel } from "../../routing/routingProfiles.ts";
import type { RoutingProfile } from "../../domain/types.ts";

export interface StaleRouteStatusParams {
  /** The profile that actually produced the currently displayed retained
   * route — always read from route.source.profile, never from live
   * selector state, so this never relabels an old result under a profile
   * it wasn't calculated with. Undefined for a legacy/imported route with
   * no recorded profile. */
  previousProfile: RoutingProfile | undefined;
  /** The profile the next calculation will use — the live selector
   * state. */
  currentProfile: RoutingProfile;
  isCalculating: boolean;
}

/**
 * The explanatory text shown while a Planning route is stale (its
 * displayed result no longer matches the live waypoints/profile/
 * avoidFerries that would produce it). Distinguishes a genuine profile
 * change, naming both profiles, from an ordinary waypoint- or
 * avoidFerries-triggered recalculation, which uses generic wording since
 * no profile changed.
 */
export function describeStaleRouteStatus({
  previousProfile,
  currentProfile,
  isCalculating,
}: StaleRouteStatusParams): string {
  const profileChanged =
    previousProfile !== undefined && previousProfile !== currentProfile;

  if (profileChanged) {
    const currentLabel = formatRoutingProfileLabel(currentProfile);
    const previousLabel = formatRoutingProfileLabel(previousProfile);
    return isCalculating
      ? `Recalculating for ${currentLabel}; showing the previous ${previousLabel} result below.`
      : `Waiting to recalculate for ${currentLabel}; showing the previous ${previousLabel} result below.`;
  }

  return isCalculating
    ? "Recalculating your latest changes; showing the previous result below."
    : "Waiting to recalculate your latest changes; showing the previous result below.";
}
