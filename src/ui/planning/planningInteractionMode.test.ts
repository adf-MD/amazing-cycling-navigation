import { describe, expect, it } from "vitest";
import {
  deriveInteractionMode,
  describeCrosshairAction,
} from "./planningInteractionMode.ts";
import type { Coordinate, Waypoint } from "../../domain/types.ts";

const A: Coordinate = [0, 51];
const B: Coordinate = [0.001, 51];
const C: Coordinate = [0.002, 51];

const WAYPOINTS: Waypoint[] = [
  { id: "a", coordinate: A },
  { id: "b", coordinate: B },
  { id: "c", coordinate: C },
];

describe("deriveInteractionMode", () => {
  it("yields append when nothing is selected, regardless of a stale pendingAction", () => {
    expect(deriveInteractionMode(null, null)).toEqual({ kind: "append" });
    expect(deriveInteractionMode(null, "move")).toEqual({ kind: "append" });
    expect(deriveInteractionMode(null, "insert-after")).toEqual({ kind: "append" });
  });

  it("yields selected when a waypoint is selected with no pending action", () => {
    expect(deriveInteractionMode("b", null)).toEqual({
      kind: "selected",
      waypointId: "b",
    });
  });

  it("yields move when a waypoint is selected with a pending move", () => {
    expect(deriveInteractionMode("b", "move")).toEqual({ kind: "move", waypointId: "b" });
  });

  it("yields insert-after when a waypoint is selected with a pending insert", () => {
    expect(deriveInteractionMode("b", "insert-after")).toEqual({
      kind: "insert-after",
      waypointId: "b",
    });
  });
});

describe("describeCrosshairAction", () => {
  it("describes append and selected modes identically as Add waypoint here", () => {
    expect(describeCrosshairAction({ kind: "append" }, WAYPOINTS)).toBe(
      "Add waypoint here",
    );
    expect(
      describeCrosshairAction({ kind: "selected", waypointId: "b" }, WAYPOINTS),
    ).toBe("Add waypoint here");
  });

  it("describes move mode by the waypoint's position", () => {
    expect(describeCrosshairAction({ kind: "move", waypointId: "b" }, WAYPOINTS)).toBe(
      "Move waypoint 2 here",
    );
  });

  it("describes move mode for the start waypoint distinctly", () => {
    expect(describeCrosshairAction({ kind: "move", waypointId: "a" }, WAYPOINTS)).toBe(
      "Move the start here",
    );
  });

  it("describes insert-after mode by the anchor's position, with no trailing 'here'", () => {
    expect(
      describeCrosshairAction({ kind: "insert-after", waypointId: "b" }, WAYPOINTS),
    ).toBe("Insert after waypoint 2");
  });

  it("describes insert-after mode for the start waypoint distinctly", () => {
    expect(
      describeCrosshairAction({ kind: "insert-after", waypointId: "a" }, WAYPOINTS),
    ).toBe("Insert after the start");
  });
});
