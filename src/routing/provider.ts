import type { Coordinate, PlannedRoute, RoutingProfile } from "../domain/types.ts";

// RoutingProfile is defined in domain/types.ts (not here) so gpx/ can
// reference it without depending on routing/ — see that type's own doc
// comment. Re-exported here so every existing import site in routing/ and
// ui/ keeps working unchanged.
export type { RoutingProfile } from "../domain/types.ts";

export interface RoutingOptions {
  profile: RoutingProfile;
  avoidFerries?: boolean;
}

export interface RoutingProvider {
  calculateRoute(
    waypoints: Coordinate[],
    options: RoutingOptions,
    signal?: AbortSignal,
  ): Promise<PlannedRoute>;
}
