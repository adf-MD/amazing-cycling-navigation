import type { ClimbFeature } from "../../navigation/routeFeatures.ts";
import { CLIMB_CATEGORY_NAMES } from "../../navigation/routeFeaturePalette.ts";
import { formatDistanceKm } from "../shared/routeSummary.ts";

export interface RidingClimbPreviewPanelProps {
  climb: ClimbFeature;
  /** 1-based position among the route's recognised climbs (see
   * listClimbsInRouteOrder), matching RidingClimbProgressPanel's and the
   * pre-ride climb selector's own numbering convention. */
  climbNumber: number;
  /** Distance from the rider's frozen/reliable presentation position to
   * this climb's own detected start — never derived from the raw/live
   * match, mirroring every other Riding presentation value. */
  distanceUntilStartMetres: number;
}

/**
 * Read-only preview of the next recognised climb before it begins
 * (backlog item 71) — shown only while `effectiveElevationView.kind ===
 * "climb-preview"` (see RidingScreen.tsx/climbElevationView.ts). Renders
 * only the climb's identity and how far away it is; length, elevation
 * gain and average gradient are supplied by the existing, reused
 * RouteFeatureDetailsPanel call (fed `upcomingClimb` while previewing),
 * and the full climb profile by a standalone, marker-less ElevationChart
 * — mirroring how RidingClimbProgressPanel itself never repeats
 * RouteFeatureDetailsPanel's own static stat block, so there is never a
 * second, duplicate climb-facts card on screen.
 *
 * Deliberately carries no current-gradient, current-elevation, distance-
 * completed or summit-elevation field — the climb has not begun, so there
 * is no live position to report; inventing any of those here would be a
 * fake value. `distanceUntilStartMetres` is ordinary changing text, not a
 * live region, so it is never announced on every GPS update; only the
 * heading (which changes solely when the previewed climb's own identity
 * changes) carries `aria-live="polite"`, mirroring
 * RidingClimbProgressPanel's identical heading treatment.
 */
export function RidingClimbPreviewPanel({
  climb,
  climbNumber,
  distanceUntilStartMetres,
}: RidingClimbPreviewPanelProps) {
  return (
    <section aria-label="Climb preview" className="riding-climb-preview">
      <h3 aria-live="polite">
        {`Climb ${String(climbNumber)} · ${CLIMB_CATEGORY_NAMES[climb.category]}`}
      </h3>
      <p>{`Starts in ${formatDistanceKm(distanceUntilStartMetres)}`}</p>
    </section>
  );
}
