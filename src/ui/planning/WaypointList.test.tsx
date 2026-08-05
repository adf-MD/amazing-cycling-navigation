import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointList } from "./WaypointList.tsx";
import type { Coordinate, Waypoint } from "../../domain/types.ts";
import type { PlanningInteractionMode } from "./planningInteractionMode.ts";

const WAYPOINTS: Waypoint[] = [
  { id: "a", coordinate: [0, 51] as Coordinate },
  { id: "b", coordinate: [0.001, 51] as Coordinate },
  { id: "c", coordinate: [0.002, 51] as Coordinate },
];

function renderList(interactionMode: PlanningInteractionMode) {
  const handlers = {
    onSelect: vi.fn<(waypointId: string) => void>(),
    onStartMove: vi.fn<(waypointId: string) => void>(),
    onStartInsertAfter: vi.fn<(waypointId: string) => void>(),
    onMoveUp: vi.fn<(waypointId: string) => void>(),
    onMoveDown: vi.fn<(waypointId: string) => void>(),
    onDelete: vi.fn<(waypointId: string) => void>(),
  };
  render(
    <WaypointList
      waypoints={WAYPOINTS}
      interactionMode={interactionMode}
      {...handlers}
    />,
  );
  return handlers;
}

describe("WaypointList", () => {
  it("shows an empty-state message with no waypoints", () => {
    render(
      <WaypointList
        waypoints={[]}
        interactionMode={{ kind: "append" }}
        onSelect={vi.fn()}
        onStartMove={vi.fn()}
        onStartInsertAfter={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "No waypoints yet. Tap the map or use the crosshair button below to add one.",
      ),
    ).toBeInTheDocument();
  });

  it("marks no waypoint as pressed in append mode", () => {
    renderList({ kind: "append" });

    expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks the selected waypoint as pressed, with no Move/Insert-after group on other rows", () => {
    renderList({ kind: "selected", waypointId: "b" });

    expect(screen.getByRole("button", { name: "Waypoint 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("group", { name: "Waypoint 2 actions" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Start actions" })).toBeNull();
  });

  it("shows Move and Insert-after both unpressed in selected mode", () => {
    renderList({ kind: "selected", waypointId: "b" });

    const group = screen.getByRole("group", { name: "Waypoint 2 actions" });
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Insert after" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(group).toBeInTheDocument();
  });

  it("marks Move as pressed in move mode", () => {
    renderList({ kind: "move", waypointId: "b" });

    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Insert after" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks Insert after as pressed in insert-after mode", () => {
    renderList({ kind: "insert-after", waypointId: "b" });

    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Insert after" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onStartMove/onStartInsertAfter with the row's waypoint id", async () => {
    const user = userEvent.setup();
    const handlers = renderList({ kind: "selected", waypointId: "b" });

    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(handlers.onStartMove).toHaveBeenCalledWith("b");

    await user.click(screen.getByRole("button", { name: "Insert after" }));
    expect(handlers.onStartInsertAfter).toHaveBeenCalledWith("b");
  });

  it("calls onSelect with the tapped row's id", async () => {
    const user = userEvent.setup();
    const handlers = renderList({ kind: "append" });

    await user.click(screen.getByRole("button", { name: "Waypoint 2" }));

    expect(handlers.onSelect).toHaveBeenCalledWith("b");
  });

  it("disables Move up for the first row and Move down for the last row", () => {
    renderList({ kind: "append" });

    expect(screen.getByRole("button", { name: "Move Start up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Waypoint 3 down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Start down" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Waypoint 3 up" })).toBeEnabled();
  });

  it("calls onMoveUp/onMoveDown/onDelete with the correct waypoint id", async () => {
    const user = userEvent.setup();
    const handlers = renderList({ kind: "append" });

    await user.click(screen.getByRole("button", { name: "Move Waypoint 2 up" }));
    expect(handlers.onMoveUp).toHaveBeenCalledWith("b");

    await user.click(screen.getByRole("button", { name: "Move Waypoint 2 down" }));
    expect(handlers.onMoveDown).toHaveBeenCalledWith("b");

    await user.click(screen.getByRole("button", { name: "Delete Waypoint 2" }));
    expect(handlers.onDelete).toHaveBeenCalledWith("b");
  });
});
