import type { PlanningRouteState } from "./usePlanningRoute.ts";

/**
 * Whether a routed plan is complete enough to save/export. "Dense
 * geometry" isn't numerically defined by the product brief — comparing
 * point count against the raw waypoint count is the simplest
 * correct-by-construction proxy: a real routed road has materially more
 * points than the handful of waypoints that produced it, whereas a
 * degenerate or echoed response would not.
 */
export function canSaveOrExportPlan(state: PlanningRouteState): boolean {
  return state.kind === "routed" && state.route.points.length > state.waypoints.length;
}
