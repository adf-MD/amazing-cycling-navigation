import type { Coordinate } from "../domain/types.ts";

/** A waypoint's role in its route — distinguishes visual treatment
 * (shape/border, never colour alone) and drives the map marker's
 * accessible label. Shared by the map marker (see MapMarkerSpec below)
 * and the Planning list's ordinal badge (WaypointList.tsx, via
 * planningLayer.ts's deriveWaypointRoles) — one vocabulary, not two
 * independently-guessed role concepts. "start-finish" is the map's
 * single combined marker for a closed loop where the first and final
 * waypoint coincide (see planningLayer.ts's buildWaypointMarkerSpecs) —
 * the final waypoint gets no marker of its own in that case, though the
 * list still shows both endpoints with this same role. */
export type WaypointRole = "ordinary" | "start" | "finish" | "start-finish";

/** A Planning waypoint marker to render — plain structured data, never
 * raw HTML, so the adapter builds the DOM node itself (see
 * waypointMarkerElement.ts) rather than trusting a caller-supplied
 * string. `label` is the ordinal text ("3", or "1/6" for a combined
 * start-finish marker); `ariaLabel` is the fuller accessible description
 * ("Waypoint 3", "Start and finish waypoints 1 and 6"). */
export interface MapMarkerSpec {
  id: string;
  coordinate: Coordinate;
  label: string;
  role: WaypointRole;
  selected: boolean;
  ariaLabel: string;
}

/** A route-distance kilometre badge to render — plain structured data,
 * like MapMarkerSpec, but for an entirely independent DOM marker
 * collection (see mapAdapter.ts's setDistanceBadges) so the two groups
 * can never delete each other. `label` is the abbreviated numeric text
 * the caller has already formatted ("5", or "10 / 30" for a merged
 * loop/out-and-back coincidence — see distanceBadgeLayer.ts); `ariaLabel`
 * is the fuller accessible description ("5 kilometres from route
 * start"). `id` is derived from the badge's absolute distance(s), never
 * array index, so it stays stable across a route recalculation that
 * doesn't move this particular badge. */
export interface DistanceBadgeMarkerSpec {
  id: string;
  coordinate: Coordinate;
  label: string;
  ariaLabel: string;
}
