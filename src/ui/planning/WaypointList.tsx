import type { Waypoint } from "../../domain/types.ts";

export interface WaypointListProps {
  waypoints: readonly Waypoint[];
  selectedWaypointId: string | null;
  onSelect: (waypointId: string) => void;
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
 * precise taps on small features required).
 */
export function WaypointList({
  waypoints,
  selectedWaypointId,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
}: WaypointListProps) {
  if (waypoints.length === 0) {
    return <p>No waypoints placed yet.</p>;
  }

  return (
    <ol aria-label="Waypoints">
      {waypoints.map((waypoint, index) => {
        const isSelected = waypoint.id === selectedWaypointId;
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
