import { describe, expect, it } from "vitest";
import {
  INITIAL_WAYPOINT_HISTORY_STATE,
  waypointHistoryReducer,
  type WaypointHistoryState,
} from "./waypointHistory.ts";
import type { Coordinate, Waypoint } from "../../domain/types.ts";

const A: Coordinate = [0, 51];
const B: Coordinate = [0.001, 51];
const C: Coordinate = [0.002, 51];

function stateWith(
  waypoints: Waypoint[],
  selectedWaypointId: string | null = null,
): WaypointHistoryState {
  return { past: [], present: waypoints, future: [], selectedWaypointId };
}

describe("waypointHistoryReducer", () => {
  describe("add", () => {
    it("appends a waypoint when nothing is selected", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, { type: "add", coordinate: B });

      expect(result.present.map((w) => w.coordinate)).toEqual([A, B]);
      expect(result.selectedWaypointId).toBeNull();
    });

    it("inserts immediately after the selected waypoint", () => {
      const state = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "c", coordinate: C },
        ],
        "a",
      );
      const result = waypointHistoryReducer(state, { type: "add", coordinate: B });

      expect(result.present.map((w) => w.coordinate)).toEqual([A, B, C]);
    });

    it("pushes the previous state onto history and clears future", () => {
      const state: WaypointHistoryState = {
        past: [],
        present: [{ id: "a", coordinate: A }],
        future: [[{ id: "stale", coordinate: C }]],
        selectedWaypointId: null,
      };
      const result = waypointHistoryReducer(state, { type: "add", coordinate: B });

      expect(result.past).toHaveLength(1);
      expect(result.future).toEqual([]);
    });
  });

  describe("move", () => {
    it("updates the coordinate of the given waypoint, keeping selection", () => {
      const state = stateWith([{ id: "a", coordinate: A }], "a");
      const result = waypointHistoryReducer(state, {
        type: "move",
        waypointId: "a",
        coordinate: C,
      });

      expect(result.present[0]?.coordinate).toEqual(C);
      expect(result.selectedWaypointId).toBe("a");
    });

    it("is a no-op for an unknown waypoint id", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, {
        type: "move",
        waypointId: "missing",
        coordinate: C,
      });

      expect(result).toBe(state);
    });
  });

  describe("reorder", () => {
    it("moves a waypoint to a new index", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
        { id: "c", coordinate: C },
      ]);
      const result = waypointHistoryReducer(state, {
        type: "reorder",
        waypointId: "a",
        toIndex: 2,
      });

      expect(result.present.map((w) => w.id)).toEqual(["b", "c", "a"]);
    });

    it("clamps an out-of-range target index", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
      ]);
      const result = waypointHistoryReducer(state, {
        type: "reorder",
        waypointId: "a",
        toIndex: 99,
      });

      expect(result.present.map((w) => w.id)).toEqual(["b", "a"]);
    });

    it("is a no-op when the target index equals the current one", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
      ]);
      const result = waypointHistoryReducer(state, {
        type: "reorder",
        waypointId: "a",
        toIndex: 0,
      });

      expect(result).toBe(state);
    });
  });

  describe("delete", () => {
    it("removes the waypoint", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
      ]);
      const result = waypointHistoryReducer(state, { type: "delete", waypointId: "a" });

      expect(result.present.map((w) => w.id)).toEqual(["b"]);
    });

    it("clears selection when the deleted waypoint was selected", () => {
      const state = stateWith([{ id: "a", coordinate: A }], "a");
      const result = waypointHistoryReducer(state, { type: "delete", waypointId: "a" });

      expect(result.selectedWaypointId).toBeNull();
    });

    it("leaves a different selection untouched", () => {
      const state = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        "b",
      );
      const result = waypointHistoryReducer(state, { type: "delete", waypointId: "a" });

      expect(result.selectedWaypointId).toBe("b");
    });
  });

  describe("returnToStart", () => {
    it("appends a new waypoint at the first waypoint's coordinate", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
      ]);
      const result = waypointHistoryReducer(state, { type: "returnToStart" });

      expect(result.present).toHaveLength(3);
      expect(result.present.at(-1)?.coordinate).toEqual(A);
      expect(result.present.at(-1)?.id).not.toBe("a"); // a genuinely new, distinct, deletable waypoint
    });

    it("is a no-op with fewer than two waypoints", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, { type: "returnToStart" });

      expect(result).toBe(state);
    });

    it("is a no-op when the route is already closed", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
        { id: "c", coordinate: A },
      ]);
      const result = waypointHistoryReducer(state, { type: "returnToStart" });

      expect(result).toBe(state);
    });
  });

  describe("select", () => {
    it("sets the selection, with no history entry", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, { type: "select", waypointId: "a" });

      expect(result.selectedWaypointId).toBe("a");
      expect(result.past).toEqual(state.past);
    });

    it("ignores a selection for a waypoint id that does not exist", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, {
        type: "select",
        waypointId: "ghost",
      });

      expect(result.selectedWaypointId).toBeNull();
    });

    it("clears the selection", () => {
      const state = stateWith([{ id: "a", coordinate: A }], "a");
      const result = waypointHistoryReducer(state, { type: "select", waypointId: null });

      expect(result.selectedWaypointId).toBeNull();
    });
  });

  describe("undo / redo", () => {
    it("undo restores the previous present and pushes the current one onto future", () => {
      const afterAdd = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "add",
        coordinate: A,
      });
      const undone = waypointHistoryReducer(afterAdd, { type: "undo" });

      expect(undone.present).toEqual([]);
      expect(undone.future).toHaveLength(1);
    });

    it("redo re-applies the undone change", () => {
      const afterAdd = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "add",
        coordinate: A,
      });
      const undone = waypointHistoryReducer(afterAdd, { type: "undo" });
      const redone = waypointHistoryReducer(undone, { type: "redo" });

      expect(redone.present).toEqual(afterAdd.present);
      expect(redone.future).toEqual([]);
    });

    it("undo is a no-op with empty history", () => {
      const result = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "undo",
      });
      expect(result).toBe(INITIAL_WAYPOINT_HISTORY_STATE);
    });

    it("redo is a no-op with nothing to redo", () => {
      const result = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "redo",
      });
      expect(result).toBe(INITIAL_WAYPOINT_HISTORY_STATE);
    });

    it("a new action after undo clears the redo stack (future)", () => {
      const afterAdd = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "add",
        coordinate: A,
      });
      const undone = waypointHistoryReducer(afterAdd, { type: "undo" });
      const afterAnotherAdd = waypointHistoryReducer(undone, {
        type: "add",
        coordinate: B,
      });

      expect(afterAnotherAdd.future).toEqual([]);
    });

    it("undo clears a selection that no longer exists in the restored state", () => {
      const afterAdd = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "add",
        coordinate: A,
      });
      const addedId = afterAdd.present[0]?.id ?? "";
      const selected = waypointHistoryReducer(afterAdd, {
        type: "select",
        waypointId: addedId,
      });

      const undone = waypointHistoryReducer(selected, { type: "undo" });

      expect(undone.selectedWaypointId).toBeNull();
    });
  });

  describe("reset", () => {
    it("replaces present and clears history and selection", () => {
      const waypoints: Waypoint[] = [{ id: "a", coordinate: A }];
      const state: WaypointHistoryState = {
        past: [[{ id: "x", coordinate: B }]],
        present: [],
        future: [[{ id: "y", coordinate: C }]],
        selectedWaypointId: "x",
      };

      const result = waypointHistoryReducer(state, { type: "reset", waypoints });

      expect(result).toEqual({
        past: [],
        present: waypoints,
        future: [],
        selectedWaypointId: null,
      });
    });
  });
});
