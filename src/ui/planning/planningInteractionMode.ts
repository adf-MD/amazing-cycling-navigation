import type { Waypoint } from "../../domain/types.ts";

/**
 * Explicit Planning interaction modes, replacing the old implicit
 * "selection secretly means move on the next map tap" behaviour.
 * Selecting a waypoint alone only ever yields "selected" (inspection —
 * map taps do not change geometry); "move"/"insert-after" require an
 * explicit start action and are one-shot (see PlanningScreen.tsx's
 * handlePlacementAt).
 */
export type PlanningInteractionMode =
  | { kind: "append" }
  | { kind: "selected"; waypointId: string }
  | { kind: "move"; waypointId: string }
  | { kind: "insert-after"; waypointId: string };

/** Which one-shot placement action is pending for the currently selected
 * waypoint, or null if merely selected (or nothing selected). Kept
 * separate from waypointHistoryReducer's own `selectedWaypointId` — that
 * stays the sole ground truth for "which waypoint, if any" (already
 * robustly re-validated across undo/redo/delete by the reducer's own
 * resolveSelection), while this is a thin layer of intent on top. */
export type PendingWaypointAction = "move" | "insert-after" | null;

/** Derives the current mode from the two independent pieces of state
 * above. A null selection always yields "append", regardless of any
 * stale pendingAction — this is what keeps "move with no waypoint
 * selected" unrepresentable in the resulting PlanningInteractionMode
 * value, even though the two source values are tracked separately. */
export function deriveInteractionMode(
  selectedWaypointId: string | null,
  pendingAction: PendingWaypointAction,
): PlanningInteractionMode {
  if (selectedWaypointId === null) return { kind: "append" };
  if (pendingAction === "move") return { kind: "move", waypointId: selectedWaypointId };
  if (pendingAction === "insert-after") {
    return { kind: "insert-after", waypointId: selectedWaypointId };
  }
  return { kind: "selected", waypointId: selectedWaypointId };
}

function describeWaypointPhrase(
  waypoints: readonly Waypoint[],
  waypointId: string,
): string {
  const index = waypoints.findIndex((waypoint) => waypoint.id === waypointId);
  return index === 0 ? "the start" : `waypoint ${String(index + 1)}`;
}

/** The crosshair/placement button's label for the current mode — always
 * describes exactly what a bare tap or button click will do next, never
 * a generic instruction. */
export function describeCrosshairAction(
  mode: PlanningInteractionMode,
  waypoints: readonly Waypoint[],
): string {
  switch (mode.kind) {
    case "append":
    case "selected":
      return "Add waypoint here";
    case "move":
      return `Move ${describeWaypointPhrase(waypoints, mode.waypointId)} here`;
    case "insert-after":
      return `Insert after ${describeWaypointPhrase(waypoints, mode.waypointId)}`;
  }
}
