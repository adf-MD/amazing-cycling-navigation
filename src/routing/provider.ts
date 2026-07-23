import type { Coordinate, PlannedRoute } from "../domain/types.ts";

// Only the "cycling-road" profile is defined until Milestone 3 introduces
// the openrouteservice adapter; the union exists so provider code doesn't
// need widening later.
export type RoutingProfile = "cycling-road";

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
