import type { AppLanguage } from "../i18n/language.ts";
import type { Coordinate, PlannedRoute, RoutingProfile } from "../domain/types.ts";

// RoutingProfile is defined in domain/types.ts (not here) so gpx/ can
// reference it without depending on routing/ — see that type's own doc
// comment. Re-exported here so every existing import site in routing/ and
// ui/ keeps working unchanged.
export type { RoutingProfile } from "../domain/types.ts";

export interface RoutingOptions {
  profile: RoutingProfile;
  avoidFerries?: boolean;
  /**
   * The interface language at the moment the calculation started, used to
   * ask the provider for instructions in that language.
   *
   * Backlog item 113 stage 6b. Captured once per calculation and passed
   * down, so a language change mid-calculation cannot split one route
   * across two languages. The caller resolves it; the adapter only
   * forwards it, which keeps the adapter's "never imports storage"
   * property intact. Omitted entirely for English, so the English request
   * body stays byte-for-byte what it always was.
   */
  language?: AppLanguage;
}

export interface RoutingProvider {
  calculateRoute(
    waypoints: Coordinate[],
    options: RoutingOptions,
    signal?: AbortSignal,
  ): Promise<PlannedRoute>;
}
