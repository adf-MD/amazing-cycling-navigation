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

const DEFAULT_NAME = "Planned route";

function stateWith(
  waypoints: Waypoint[],
  selectedWaypointId: string | null = null,
  routeName: string = DEFAULT_NAME,
): WaypointHistoryState {
  return {
    past: [],
    present: { waypoints, routeName },
    future: [],
    selectedWaypointId,
  };
}

describe("waypointHistoryReducer", () => {
  describe("append", () => {
    it("appends a waypoint when nothing is selected", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, { type: "append", coordinate: B });

      expect(result.present.waypoints.map((w) => w.coordinate)).toEqual([A, B]);
      expect(result.selectedWaypointId).toBeNull();
    });

    it("always appends at the end even when a waypoint is selected, and clears selection", () => {
      // The reducer must be correct independent of caller discipline: it
      // never reads selectedWaypointId at all, unlike the old "add" action.
      const state = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "c", coordinate: C },
        ],
        "a",
      );
      const result = waypointHistoryReducer(state, { type: "append", coordinate: B });

      expect(result.present.waypoints.map((w) => w.coordinate)).toEqual([A, C, B]);
      expect(result.selectedWaypointId).toBeNull();
    });

    it("pushes the previous state onto history and clears future", () => {
      const state: WaypointHistoryState = {
        past: [],
        present: { waypoints: [{ id: "a", coordinate: A }], routeName: DEFAULT_NAME },
        future: [{ waypoints: [{ id: "stale", coordinate: C }], routeName: "Stale" }],
        selectedWaypointId: null,
      };
      const result = waypointHistoryReducer(state, { type: "append", coordinate: B });

      expect(result.past).toHaveLength(1);
      expect(result.future).toEqual([]);
    });

    it("carries the route name forward unchanged", () => {
      const state = stateWith([{ id: "a", coordinate: A }], null, "Evening loop");
      const result = waypointHistoryReducer(state, { type: "append", coordinate: B });

      expect(result.present.routeName).toBe("Evening loop");
    });
  });

  describe("insertAfter", () => {
    it("inserts a waypoint immediately after the given anchor", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "c", coordinate: C },
      ]);
      const result = waypointHistoryReducer(state, {
        type: "insertAfter",
        afterWaypointId: "a",
        coordinate: B,
      });

      expect(result.present.waypoints.map((w) => w.coordinate)).toEqual([A, B, C]);
    });

    it("creates a new waypoint ID, distinct from the anchor's", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, {
        type: "insertAfter",
        afterWaypointId: "a",
        coordinate: B,
      });

      const insertedId = result.present.waypoints[1]?.id;
      expect(insertedId).toBeDefined();
      expect(insertedId).not.toBe("a");
    });

    it("selects the newly inserted waypoint, not the anchor", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, {
        type: "insertAfter",
        afterWaypointId: "a",
        coordinate: B,
      });

      expect(result.selectedWaypointId).toBe(result.present.waypoints[1]?.id);
      expect(result.selectedWaypointId).not.toBe("a");
    });

    it("is a no-op for an unknown anchor id", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, {
        type: "insertAfter",
        afterWaypointId: "missing",
        coordinate: B,
      });

      expect(result).toBe(state);
    });

    it("pushes the previous state onto history and clears future", () => {
      const state: WaypointHistoryState = {
        past: [],
        present: { waypoints: [{ id: "a", coordinate: A }], routeName: DEFAULT_NAME },
        future: [{ waypoints: [{ id: "stale", coordinate: C }], routeName: "Stale" }],
        selectedWaypointId: null,
      };
      const result = waypointHistoryReducer(state, {
        type: "insertAfter",
        afterWaypointId: "a",
        coordinate: B,
      });

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

      expect(result.present.waypoints[0]?.coordinate).toEqual(C);
      expect(result.selectedWaypointId).toBe("a");
    });

    it("retains the waypoint's original ID after moving it", () => {
      const state = stateWith([{ id: "a", coordinate: A }], "a");
      const result = waypointHistoryReducer(state, {
        type: "move",
        waypointId: "a",
        coordinate: C,
      });

      expect(result.present.waypoints[0]?.id).toBe("a");
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

      expect(result.present.waypoints.map((w) => w.id)).toEqual(["b", "c", "a"]);
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

      expect(result.present.waypoints.map((w) => w.id)).toEqual(["b", "a"]);
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

      expect(result.present.waypoints.map((w) => w.id)).toEqual(["b"]);
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

      expect(result.present.waypoints).toHaveLength(3);
      expect(result.present.waypoints.at(-1)?.coordinate).toEqual(A);
      expect(result.present.waypoints.at(-1)?.id).not.toBe("a"); // a genuinely new, distinct, deletable waypoint
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

  describe("rename", () => {
    it("sets the route name only, with no history entry", () => {
      const state = stateWith([{ id: "a", coordinate: A }], null, "Old name");
      const result = waypointHistoryReducer(state, {
        type: "rename",
        routeName: "New name",
      });

      expect(result.present.routeName).toBe("New name");
      expect(result.past).toEqual(state.past);
      expect(result.future).toEqual(state.future);
      expect(result.selectedWaypointId).toBe(state.selectedWaypointId);
    });

    it("keeps the same waypoints array reference, so a rename never looks like a waypoint change", () => {
      const state = stateWith([{ id: "a", coordinate: A }], null, "Old name");
      const result = waypointHistoryReducer(state, {
        type: "rename",
        routeName: "New name",
      });

      expect(result.present.waypoints).toBe(state.present.waypoints);
    });

    it("does not disturb an existing selection", () => {
      const state = stateWith([{ id: "a", coordinate: A }], "a", "Old name");
      const result = waypointHistoryReducer(state, {
        type: "rename",
        routeName: "New name",
      });

      expect(result.selectedWaypointId).toBe("a");
    });
  });

  describe("reverse", () => {
    function closedLoopState(routeName = DEFAULT_NAME) {
      return stateWith(
        [
          { id: "w1", coordinate: A },
          { id: "w2", coordinate: B },
          { id: "w3", coordinate: C },
          { id: "w4", coordinate: A },
        ],
        null,
        routeName,
      );
    }

    it("reverses the order of two waypoints", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
      ]);
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.present.waypoints.map((w) => w.coordinate)).toEqual([B, A]);
    });

    it("reverses the order of three or more waypoints", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
        { id: "c", coordinate: C },
      ]);
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.present.waypoints.map((w) => w.coordinate)).toEqual([C, B, A]);
    });

    it("reverses ids in lockstep with coordinates, rather than minting fresh ones", () => {
      const state = stateWith([
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
        { id: "c", coordinate: C },
      ]);
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.present.waypoints.map((w) => w.id)).toEqual(["c", "b", "a"]);
    });

    it("reverses a closed loop, keeping the same value-equal start/finish coordinate", () => {
      const state = closedLoopState();
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.present.waypoints.map((w) => w.coordinate)).toEqual([A, C, B, A]);
      // Value-equal, not id-equal: the reversed final waypoint is "w1" by
      // id (positionally reversed), even though its coordinate matches
      // the reversed first waypoint "w4" — exactly mirroring
      // reverseEditableWaypoints's own documented closed-loop contract.
      expect(result.present.waypoints[0]?.coordinate).toEqual(
        result.present.waypoints.at(-1)?.coordinate,
      );
      expect(result.present.waypoints.map((w) => w.id)).toEqual(["w4", "w3", "w2", "w1"]);
    });

    it("does not mutate the input waypoints array or its elements", () => {
      const original: Waypoint[] = [
        { id: "a", coordinate: A },
        { id: "b", coordinate: B },
      ];
      const state = stateWith(original);
      waypointHistoryReducer(state, { type: "reverse" });

      expect(original.map((w) => w.coordinate)).toEqual([A, B]);
      expect(original.map((w) => w.id)).toEqual(["a", "b"]);
    });

    it("appends the reversed suffix to a named draft", () => {
      const state = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        null,
        "Evening loop",
      );
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.present.routeName).toBe("Evening loop (reversed)");
    });

    it("leaves a blank route name blank", () => {
      const state = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        null,
        "",
      );
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.present.routeName).toBe("");
    });

    it("leaves a whitespace-only route name unchanged", () => {
      const state = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        null,
        "   ",
      );
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.present.routeName).toBe("   ");
    });

    it("appends a second suffix to an already-suffixed name", () => {
      const state = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        null,
        "Loop (reversed)",
      );
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.present.routeName).toBe("Loop (reversed) (reversed)");
    });

    it("pushes exactly one history entry and clears future", () => {
      const state: WaypointHistoryState = {
        ...stateWith([
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ]),
        future: [{ waypoints: [{ id: "stale", coordinate: C }], routeName: "Stale" }],
      };
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.past).toHaveLength(1);
      expect(result.past[0]).toEqual(state.present);
      expect(result.future).toEqual([]);
    });

    it("clears the current selection", () => {
      const state = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        "a",
      );
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result.selectedWaypointId).toBeNull();
    });

    it("is a no-op below two waypoints", () => {
      const state = stateWith([{ id: "a", coordinate: A }]);
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result).toBe(state);
    });

    it("is a no-op with zero waypoints", () => {
      const state = stateWith([]);
      const result = waypointHistoryReducer(state, { type: "reverse" });

      expect(result).toBe(state);
    });

    it("reverse then undo then redo restores both waypoint order and name together, atomically", () => {
      const original = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        null,
        "Evening loop",
      );
      const reversed = waypointHistoryReducer(original, { type: "reverse" });
      expect(reversed.present.waypoints.map((w) => w.coordinate)).toEqual([B, A]);
      expect(reversed.present.routeName).toBe("Evening loop (reversed)");

      const undone = waypointHistoryReducer(reversed, { type: "undo" });
      expect(undone.present.waypoints.map((w) => w.coordinate)).toEqual([A, B]);
      expect(undone.present.routeName).toBe("Evening loop");

      const redone = waypointHistoryReducer(undone, { type: "redo" });
      expect(redone.present.waypoints.map((w) => w.coordinate)).toEqual([B, A]);
      expect(redone.present.routeName).toBe("Evening loop (reversed)");
    });

    it("an ordinary edit after reversal, followed by two undos, crosses the reversal boundary correctly", () => {
      const original = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        null,
        "Evening loop",
      );
      const reversed = waypointHistoryReducer(original, { type: "reverse" });
      const edited = waypointHistoryReducer(reversed, { type: "append", coordinate: C });
      expect(edited.present.waypoints.map((w) => w.coordinate)).toEqual([B, A, C]);
      expect(edited.present.routeName).toBe("Evening loop (reversed)");

      const firstUndo = waypointHistoryReducer(edited, { type: "undo" });
      // First undo reverts only the append, keeping the reversed order and name.
      expect(firstUndo.present.waypoints.map((w) => w.coordinate)).toEqual([B, A]);
      expect(firstUndo.present.routeName).toBe("Evening loop (reversed)");

      const secondUndo = waypointHistoryReducer(firstUndo, { type: "undo" });
      // Second undo crosses the reversal boundary, restoring the original order and name.
      expect(secondUndo.present.waypoints.map((w) => w.coordinate)).toEqual([A, B]);
      expect(secondUndo.present.routeName).toBe("Evening loop");
    });

    it("a new action after undoing a reversal clears the redo stack coherently", () => {
      const original = stateWith(
        [
          { id: "a", coordinate: A },
          { id: "b", coordinate: B },
        ],
        null,
        "Evening loop",
      );
      const reversed = waypointHistoryReducer(original, { type: "reverse" });
      const undone = waypointHistoryReducer(reversed, { type: "undo" });
      expect(undone.future).toHaveLength(1);

      const afterNewAction = waypointHistoryReducer(undone, {
        type: "append",
        coordinate: C,
      });

      expect(afterNewAction.future).toEqual([]);
    });
  });

  describe("undo / redo", () => {
    it("undo restores the previous present and pushes the current one onto future", () => {
      const afterAdd = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "append",
        coordinate: A,
      });
      const undone = waypointHistoryReducer(afterAdd, { type: "undo" });

      expect(undone.present.waypoints).toEqual([]);
      expect(undone.future).toHaveLength(1);
    });

    it("redo re-applies the undone change", () => {
      const afterAdd = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "append",
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
        type: "append",
        coordinate: A,
      });
      const undone = waypointHistoryReducer(afterAdd, { type: "undo" });
      const afterAnotherAdd = waypointHistoryReducer(undone, {
        type: "append",
        coordinate: B,
      });

      expect(afterAnotherAdd.future).toEqual([]);
    });

    it("undo clears a selection that no longer exists in the restored state", () => {
      const afterAdd = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "append",
        coordinate: A,
      });
      const addedId = afterAdd.present.waypoints[0]?.id ?? "";
      const selected = waypointHistoryReducer(afterAdd, {
        type: "select",
        waypointId: addedId,
      });

      const undone = waypointHistoryReducer(selected, { type: "undo" });

      expect(undone.selectedWaypointId).toBeNull();
    });

    it("undo/redo work correctly across a chain of append, insertAfter, move, reorder and delete", () => {
      const afterAppendA = waypointHistoryReducer(INITIAL_WAYPOINT_HISTORY_STATE, {
        type: "append",
        coordinate: A,
      });
      const afterAppendC = waypointHistoryReducer(afterAppendA, {
        type: "append",
        coordinate: C,
      });
      const aId = afterAppendC.present.waypoints[0]?.id ?? "";
      const cId = afterAppendC.present.waypoints[1]?.id ?? "";
      const afterInsert = waypointHistoryReducer(afterAppendC, {
        type: "insertAfter",
        afterWaypointId: aId,
        coordinate: B,
      });
      const bId = afterInsert.present.waypoints[1]?.id ?? "";
      const afterMove = waypointHistoryReducer(afterInsert, {
        type: "move",
        waypointId: bId,
        coordinate: [0.005, 51],
      });
      const afterReorder = waypointHistoryReducer(afterMove, {
        type: "reorder",
        waypointId: bId,
        toIndex: 0,
      });
      const afterDelete = waypointHistoryReducer(afterReorder, {
        type: "delete",
        waypointId: aId,
      });
      expect(afterDelete.present.waypoints.map((w) => w.id)).toEqual([bId, cId]);

      // Six state-changing actions were dispatched above (append x2,
      // insertAfter, move, reorder, delete) — six undos should walk all
      // the way back to the initial empty state.
      let undone = afterDelete;
      for (let i = 0; i < 6; i += 1) {
        undone = waypointHistoryReducer(undone, { type: "undo" });
      }
      expect(undone.present.waypoints).toEqual([]);
      expect(undone.past).toEqual([]);

      // Six redos should walk all the way back to the final state.
      let redone = undone;
      for (let i = 0; i < 6; i += 1) {
        redone = waypointHistoryReducer(redone, { type: "redo" });
      }
      expect(redone.present).toEqual(afterDelete.present);
      expect(redone.future).toEqual([]);
    });
  });

  describe("reset", () => {
    it("replaces present (waypoints and route name) and clears history and selection", () => {
      const waypoints: Waypoint[] = [{ id: "a", coordinate: A }];
      const state: WaypointHistoryState = {
        past: [{ waypoints: [{ id: "x", coordinate: B }], routeName: "Old" }],
        present: { waypoints: [], routeName: "Old" },
        future: [{ waypoints: [{ id: "y", coordinate: C }], routeName: "Stale" }],
        selectedWaypointId: "x",
      };

      const result = waypointHistoryReducer(state, {
        type: "reset",
        waypoints,
        routeName: "Planned route",
      });

      expect(result).toEqual({
        past: [],
        present: { waypoints, routeName: "Planned route" },
        future: [],
        selectedWaypointId: null,
      });
    });
  });
});
