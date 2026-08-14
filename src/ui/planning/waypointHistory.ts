import { createWaypointId } from "../../domain/id.ts";
import { reverseEditableWaypoints } from "../../domain/editableWaypoints.ts";
import { suggestReversedRouteName } from "../../domain/routeNaming.ts";
import type { Coordinate, Waypoint } from "../../domain/types.ts";

/**
 * One point-in-time snapshot of the whole Planning draft that undo/redo
 * needs to restore together. Introduced by backlog item 38 ("Reverse the
 * current draft inside Planning") to close a real architecture gap:
 * routeName used to live entirely outside this reducer as a separate
 * PlanningScreen useState, so a reversal that changes both waypoint order
 * and the route name (appending " (reversed)") had no way to make Undo
 * restore both together atomically — the two would desync. Bundling them
 * into one snapshot object, rather than a second parallel history array,
 * means anything that must be undoable has exactly one reducer that owns
 * it — see the "reverse" case below and its own doc comment.
 */
export interface WaypointDraftSnapshot {
  waypoints: readonly Waypoint[];
  routeName: string;
}

export interface WaypointHistoryState {
  past: readonly WaypointDraftSnapshot[];
  present: WaypointDraftSnapshot;
  future: readonly WaypointDraftSnapshot[];
  /** Deliberately outside past/future — undo/redo restore which
   * waypoints (and route name) exist, not what was selected at the time,
   * so they never fight the rider's current selection. */
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
  // Renames the draft without creating a history entry — mirrors
  // "select"'s existing precedent that not every action needs to be
  // undoable. This is what keeps ordinary route-name *typing* out of
  // undo/redo: only a "reverse" action's own name change is ever undoable,
  // never a rider's keystrokes. Deliberately reuses the same
  // present.waypoints array reference (see the case body) so a rename
  // never looks like a waypoint change to any effect keyed on waypoint
  // identity.
  | { type: "rename"; routeName: string }
  // Reverses waypoint order and the route name together as exactly one
  // undoable history entry — see the case body and reverseDraftWaypoints
  // below for why this can't be built from "reset" plus a separate rename.
  | { type: "reverse" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; waypoints: readonly Waypoint[]; routeName: string };

export const INITIAL_WAYPOINT_HISTORY_STATE: WaypointHistoryState = {
  past: [],
  present: { waypoints: [], routeName: "Planned route" },
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
 * Reverses a live draft's waypoints for the "reverse" action, reusing
 * domain/editableWaypoints.ts's reverseEditableWaypoints for the actual
 * coordinate-level reversal — this app's single source of truth that a
 * plain positional reversal is already correct, including a closed loop's
 * value-equal (not reference-equal) start/finish. Ids are reversed in
 * lockstep with coordinates rather than re-minted with createWaypointId:
 * unlike every *new*-waypoint case above (append/insertAfter/
 * returnToStart), these are pre-existing, possibly-referenced live
 * waypoints, so preserving identity (merely reordered) is the more
 * conservative choice. Never mutates `waypoints` or its elements.
 *
 * Zips the independently-reversed ids and coordinates back together by
 * index rather than a non-null assertion (forbidden by this project's
 * lint config): both arrays are always exactly `waypoints.length` long by
 * construction, so `reversedCoordinates[index]`'s fallback to the
 * reversed waypoint's own already-reversed-position coordinate is
 * permanently unreachable, never a behavioural difference.
 */
function reverseDraftWaypoints(waypoints: readonly Waypoint[]): Waypoint[] {
  const reversedCoordinates = reverseEditableWaypoints(
    waypoints.map((waypoint) => waypoint.coordinate),
  );
  const reversedWaypoints = [...waypoints].reverse();
  return reversedWaypoints.map((waypoint, index) => ({
    id: waypoint.id,
    coordinate: reversedCoordinates[index] ?? waypoint.coordinate,
  }));
}

/**
 * Whole-array-snapshot undo/redo over the rider's Planning waypoints (and,
 * since backlog item 38, the route name). Waypoint counts are small (tens,
 * not thousands), so this is simpler and more robust than diff-based undo —
 * consistent with this project's existing preference for small, explicit
 * state machines (see src/navigation/offRoute.ts). Pure, no React, no
 * map/provider dependency — see usePlanningRoute.ts and PlanningScreen.tsx
 * for how this drives the rest of Planning.
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
        present: {
          waypoints: [...state.present.waypoints, newWaypoint],
          routeName: state.present.routeName,
        },
        future: [],
        selectedWaypointId: null,
      };
    }

    case "insertAfter": {
      const anchorIndex = state.present.waypoints.findIndex(
        (waypoint) => waypoint.id === action.afterWaypointId,
      );
      if (anchorIndex === -1) return state;
      const newWaypoint: Waypoint = {
        id: createWaypointId(),
        coordinate: action.coordinate,
      };
      const waypoints = [
        ...state.present.waypoints.slice(0, anchorIndex + 1),
        newWaypoint,
        ...state.present.waypoints.slice(anchorIndex + 1),
      ];
      return {
        past: [...state.past, state.present],
        present: { waypoints, routeName: state.present.routeName },
        future: [],
        // The rider lands on the just-inserted point, not the anchor, so
        // repeated "insert after" calls chain forward along the route
        // being built rather than reversing order.
        selectedWaypointId: newWaypoint.id,
      };
    }

    case "move": {
      const index = state.present.waypoints.findIndex(
        (waypoint) => waypoint.id === action.waypointId,
      );
      if (index === -1) return state;
      const waypoints = state.present.waypoints.map((waypoint, i) =>
        i === index ? { ...waypoint, coordinate: action.coordinate } : waypoint,
      );
      return {
        past: [...state.past, state.present],
        present: { waypoints, routeName: state.present.routeName },
        future: [],
        selectedWaypointId: state.selectedWaypointId,
      };
    }

    case "reorder": {
      const fromIndex = state.present.waypoints.findIndex(
        (waypoint) => waypoint.id === action.waypointId,
      );
      if (fromIndex === -1) return state;
      const toIndex = Math.max(
        0,
        Math.min(action.toIndex, state.present.waypoints.length - 1),
      );
      if (toIndex === fromIndex) return state;
      const waypoints = [...state.present.waypoints];
      const [moved] = waypoints.splice(fromIndex, 1);
      if (!moved) return state;
      waypoints.splice(toIndex, 0, moved);
      return {
        past: [...state.past, state.present],
        present: { waypoints, routeName: state.present.routeName },
        future: [],
        selectedWaypointId: state.selectedWaypointId,
      };
    }

    case "delete": {
      if (!state.present.waypoints.some((waypoint) => waypoint.id === action.waypointId))
        return state;
      const waypoints = state.present.waypoints.filter(
        (waypoint) => waypoint.id !== action.waypointId,
      );
      return {
        past: [...state.past, state.present],
        present: { waypoints, routeName: state.present.routeName },
        future: [],
        selectedWaypointId:
          state.selectedWaypointId === action.waypointId
            ? null
            : state.selectedWaypointId,
      };
    }

    case "returnToStart": {
      const first = state.present.waypoints[0];
      const last = state.present.waypoints.at(-1);
      if (!first || !last || state.present.waypoints.length < 2) return state;
      if (sameCoordinate(first.coordinate, last.coordinate)) return state;
      const closingWaypoint: Waypoint = {
        id: createWaypointId(),
        coordinate: first.coordinate,
      };
      return {
        past: [...state.past, state.present],
        present: {
          waypoints: [...state.present.waypoints, closingWaypoint],
          routeName: state.present.routeName,
        },
        future: [],
        selectedWaypointId: state.selectedWaypointId,
      };
    }

    case "select":
      return {
        ...state,
        selectedWaypointId: resolveSelection(state.present.waypoints, action.waypointId),
      };

    case "rename":
      // No history entry — reuses the same present.waypoints array
      // reference (the object spread copies the reference, not the array
      // contents), so anything keyed on waypoint identity (in particular
      // usePlanningRoute's debounced-recalculation effect) never treats a
      // rename as a waypoint change.
      return { ...state, present: { ...state.present, routeName: action.routeName } };

    case "reverse": {
      // Defensive only — PlanningScreen disables the triggering button
      // below 2 waypoints, mirroring returnToStart's own precondition
      // guard above.
      if (state.present.waypoints.length < 2) return state;
      const trimmedName = state.present.routeName.trim();
      const newRouteName =
        trimmedName.length === 0
          ? // A blank/whitespace-only draft name stays exactly as-is —
            // there is nothing meaningful to suffix.
            state.present.routeName
          : suggestReversedRouteName(state.present.routeName);
      return {
        past: [...state.past, state.present],
        present: {
          waypoints: reverseDraftWaypoints(state.present.waypoints),
          routeName: newRouteName,
        },
        future: [],
        // A reversed waypoint's ordinal role (start/finish/ordinary) may
        // have changed, so leaving a selection active could be
        // misleading — clears it, mirroring the requirement that
        // reversing also ends any active Move/Insert-after relocation
        // (PlanningScreen's own effectivePendingAction already derives
        // from selectedWaypointId, so this alone invalidates it there).
        selectedWaypointId: null,
      };
    }

    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        selectedWaypointId: resolveSelection(
          previous.waypoints,
          state.selectedWaypointId,
        ),
      };
    }

    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        selectedWaypointId: resolveSelection(next.waypoints, state.selectedWaypointId),
      };
    }

    case "reset":
      return {
        past: [],
        present: { waypoints: action.waypoints, routeName: action.routeName },
        future: [],
        selectedWaypointId: null,
      };
  }
}
