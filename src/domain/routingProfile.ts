import type { RoutingProfile } from "./types.ts";

/** Single source of truth for which values RoutingProfile currently has —
 * routing/routingProfiles.ts's UI metadata table iterates this same list
 * rather than repeating the two literal values a second time. */
export const ROUTING_PROFILE_VALUES: readonly RoutingProfile[] = [
  "cycling-road",
  "cycling-regular",
];

/** The profile every new Planning draft starts with, and the safe fallback
 * for any legacy or unrecognised stored value that represents an
 * OpenRouteService-planned route. */
export const DEFAULT_ROUTING_PROFILE: RoutingProfile = "cycling-road";

const ROUTING_PROFILE_VALUE_SET: ReadonlySet<string> = new Set(ROUTING_PROFILE_VALUES);

/** A real Set-membership check, not a cast — the guard a corrupt/legacy/
 * future-unknown stored or imported value must pass before it is ever used
 * as a RoutingProfile (e.g. inserted into a routing endpoint path). */
export function isRoutingProfile(value: unknown): value is RoutingProfile {
  return typeof value === "string" && ROUTING_PROFILE_VALUE_SET.has(value);
}
