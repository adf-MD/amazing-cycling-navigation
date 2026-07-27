import { createWaypointId } from "../../domain/id.ts";
import type { Coordinate, Waypoint } from "../../domain/types.ts";

export interface WaypointHistoryState {
  past: readonly (readonly Waypoint[])[];
  present: readonly Waypoint[];
  future: readonly (readonly Waypoint[])[];
  /** Deliberately outside past/future — undo/redo restore which
   * waypoints exist, not what was selected at the time, so they never
   * fight the rider's current selection. */
  selectedWaypointId: string | null;
}

export type WaypointAction =
  | { type: "append"; coordinate: Coordinate }
  | { type: "insertAfter"; afterWaypointId: string; coordinate: Coordinate }
  | { type: "move"; waypointId: string; coordinate: Coordinate }
  | { type: "reorder"; waypointId: string; toIndex: number }
  | { type: "delete"; waypointId: string }
  | { type: "returnToStart" }
  | { type: "select"; waypointId: string | null }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; waypoints: readonly Waypoint[] };

export const INITIAL_WAYPOINT_HISTORY_STATE: WaypointHistoryState = {
  past: [],
  present: [],
  future: [],
  selectedWaypointId: null,
};

function resolveSelection(
  waypoints: readonly Waypoint[],
  selectedWaypointId: string | null,
): string | null {
  if (selectedWaypointId === null) return null;
  return waypoints.some((waypoint) => waypoint.id === selectedWaypointId)
    ? selectedWaypointId
    : null;
}

export function sameCoordinate(a: Coordinate, b: Coordinate): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Whole-array-snapshot undo/redo over the rider's Planning waypoints.
 * Waypoint counts are small (tens, not thousands), so this is simpler and
 * more robust than diff-based undo — consistent with this project's
 * existing preference for small, explicit state machines (see
 * src/navigation/offRoute.ts). Pure, no React, no map/provider
 * dependency — see usePlanningRoute.ts and PlanningScreen.tsx for how
 * this drives the rest of Planning.
 */
export function waypointHistoryReducer(
  state: WaypointHistoryState,
  action: WaypointAction,
): WaypointHistoryState {
  switch (action.type) {
    case "append": {
      // Always appends at the end, regardless of any existing selection —
      // deliberately never reads state.selectedWaypointId, so "which
      // behaviour happens" is never hidden inside the reducer. Callers
      // (PlanningScreen's interaction mode) decide append vs insertAfter
      // explicitly before dispatching.
      const newWaypoint: Waypoint = {
        id: createWaypointId(),
        coordinate: action.coordinate,
      };
      return {
        past: [...state.past, state.present],
        present: [...state.present, newWaypoint],
        future: [],
        selectedWaypointId: null,
      };
    }

    case "insertAfter": {
      const anchorIndex = state.present.findIndex(
        (waypoint) => waypoint.id === action.afterWaypointId,
      );
      if (anchorIndex === -1) return state;
      const newWaypoint: Waypoint = {
        id: createWaypointId(),
        coordinate: action.coordinate,
      };
      const present = [
        ...state.present.slice(0, anchorIndex + 1),
        newWaypoint,
        ...state.present.slice(anchorIndex + 1),
      ];
      return {
        past: [...state.past, state.present],
        present,
        future: [],
        // The rider lands on the just-inserted point, not the anchor, so
        // repeated "insert after" calls chain forward along the route
        // being built rather than reversing order.
        selectedWaypointId: newWaypoint.id,
      };
    }

    case "move": {
      const index = state.present.findIndex(
        (waypoint) => waypoint.id === action.waypointId,
      );
      if (index === -1) return state;
      const present = state.present.map((waypoint, i) =>
        i === index ? { ...waypoint, coordinate: action.coordinate } : waypoint,
      );
      return {
        past: [...state.past, state.present],
        present,
        future: [],
        selectedWaypointId: state.selectedWaypointId,
      };
    }

    case "reorder": {
      const fromIndex = state.present.findIndex(
        (waypoint) => waypoint.id === action.waypointId,
      );
      if (fromIndex === -1) return state;
      const toIndex = Math.max(0, Math.min(action.toIndex, state.present.length - 1));
      if (toIndex === fromIndex) return state;
      const present = [...state.present];
      const [moved] = present.splice(fromIndex, 1);
      if (!moved) return state;
      present.splice(toIndex, 0, moved);
      return {
        past: [...state.past, state.present],
        present,
        future: [],
        selectedWaypointId: state.selectedWaypointId,
      };
    }

    case "delete": {
      if (!state.present.some((waypoint) => waypoint.id === action.waypointId))
        return state;
      const present = state.present.filter(
        (waypoint) => waypoint.id !== action.waypointId,
      );
      return {
        past: [...state.past, state.present],
        present,
        future: [],
        selectedWaypointId:
          state.selectedWaypointId === action.waypointId
            ? null
            : state.selectedWaypointId,
      };
    }

    case "returnToStart": {
      const first = state.present[0];
      const last = state.present.at(-1);
      if (!first || !last || state.present.length < 2) return state;
      if (sameCoordinate(first.coordinate, last.coordinate)) return state;
      const closingWaypoint: Waypoint = {
        id: createWaypointId(),
        coordinate: first.coordinate,
      };
      return {
        past: [...state.past, state.present],
        present: [...state.present, closingWaypoint],
        future: [],
        selectedWaypointId: state.selectedWaypointId,
      };
    }

    case "select":
      return {
        ...state,
        selectedWaypointId: resolveSelection(state.present, action.waypointId),
      };

    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        selectedWaypointId: resolveSelection(previous, state.selectedWaypointId),
      };
    }

    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        selectedWaypointId: resolveSelection(next, state.selectedWaypointId),
      };
    }

    case "reset":
      return {
        past: [],
        present: action.waypoints,
        future: [],
        selectedWaypointId: null,
      };
  }
}
