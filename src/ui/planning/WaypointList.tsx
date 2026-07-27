import type { Waypoint } from "../../domain/types.ts";
import type { PlanningInteractionMode } from "./planningInteractionMode.ts";

export interface WaypointListProps {
  waypoints: readonly Waypoint[];
  interactionMode: PlanningInteractionMode;
  onSelect: (waypointId: string) => void;
  onStartMove: (waypointId: string) => void;
  onStartInsertAfter: (waypointId: string) => void;
  onMoveUp: (waypointId: string) => void;
  onMoveDown: (waypointId: string) => void;
  onDelete: (waypointId: string) => void;
}

const TOUCH_TARGET_STYLE = { minWidth: 44, minHeight: 44 };

/**
 * The authoritative, always-reliable place to select, reorder or delete a
 * waypoint — deliberately plain text rows with "move up"/"move down"
 * buttons rather than on-map numeric labels or drag-and-drop, so every
 * interaction here stays a large, unambiguous touch target (CLAUDE.md: no
 * precise taps on small features required). Once a waypoint is selected,
 * its row additionally exposes "Move" and "Insert after" — the explicit
 * one-shot actions that start Planning's move/insert-after interaction
 * mode (see planningInteractionMode.ts) — kept in their own group, apart
 * from "Move up"/"Move down", so the two concepts (relocate vs reorder)
 * are never visually or semantically confused.
 */
export function WaypointList({
  waypoints,
  interactionMode,
  onSelect,
  onStartMove,
  onStartInsertAfter,
  onMoveUp,
  onMoveDown,
  onDelete,
}: WaypointListProps) {
  if (waypoints.length === 0) {
    return <p>No waypoints placed yet.</p>;
  }

  // "append" carries no waypointId; every other mode kind names exactly
  // the one waypoint currently selected/pending, regardless of which of
  // the three non-append kinds it is.
  const activeWaypointId =
    interactionMode.kind === "append" ? null : interactionMode.waypointId;

  return (
    <ol aria-label="Waypoints">
      {waypoints.map((waypoint, index) => {
        const isSelected = waypoint.id === activeWaypointId;
        const isPendingMove = isSelected && interactionMode.kind === "move";
        const isPendingInsertAfter =
          isSelected && interactionMode.kind === "insert-after";
        const label = index === 0 ? "Start" : `Waypoint ${String(index + 1)}`;
        return (
          <li key={waypoint.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              style={TOUCH_TARGET_STYLE}
              onClick={() => {
                onSelect(waypoint.id);
              }}
            >
              {label}
            </button>
            {isSelected ? (
              <span role="group" aria-label={`${label} actions`}>
                <button
                  type="button"
                  aria-pressed={isPendingMove}
                  style={TOUCH_TARGET_STYLE}
                  onClick={() => {
                    onStartMove(waypoint.id);
                  }}
                >
                  Move
                </button>
                <button
                  type="button"
                  aria-pressed={isPendingInsertAfter}
                  style={TOUCH_TARGET_STYLE}
                  onClick={() => {
                    onStartInsertAfter(waypoint.id);
                  }}
                >
                  Insert after
                </button>
              </span>
            ) : null}
            <button
              type="button"
              aria-label={`Move ${label} up`}
              style={TOUCH_TARGET_STYLE}
              disabled={index === 0}
              onClick={() => {
                onMoveUp(waypoint.id);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${label} down`}
              style={TOUCH_TARGET_STYLE}
              disabled={index === waypoints.length - 1}
              onClick={() => {
                onMoveDown(waypoint.id);
              }}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Delete ${label}`}
              style={TOUCH_TARGET_STYLE}
              onClick={() => {
                onDelete(waypoint.id);
              }}
            >
              Delete
            </button>
          </li>
        );
      })}
    </ol>
  );
}
