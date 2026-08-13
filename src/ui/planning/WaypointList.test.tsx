import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointList } from "./WaypointList.tsx";
import type { Coordinate, Waypoint } from "../../domain/types.ts";
import type { WaypointRole } from "../../map/mapAdapter.ts";
import type { PlanningInteractionMode } from "./planningInteractionMode.ts";

const WAYPOINTS: Waypoint[] = [
  { id: "a", coordinate: [0, 51] as Coordinate },
  { id: "b", coordinate: [0.001, 51] as Coordinate },
  { id: "c", coordinate: [0.002, 51] as Coordinate },
];

const OPEN_ROUTE_ROLES: WaypointRole[] = ["start", "ordinary", "finish"];

function renderList(
  interactionMode: PlanningInteractionMode,
  waypointRoles: readonly WaypointRole[] = OPEN_ROUTE_ROLES,
) {
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
      waypointRoles={waypointRoles}
      interactionMode={interactionMode}
      {...handlers}
    />,
  );
  return handlers;
}

// A separate, double-digit fixture (12 waypoints) for CLAUDE.md item 34's
// waypoint-row layout coverage — kept independent of WAYPOINTS/OPEN_ROUTE_ROLES
// above so every existing test using those stays untouched. Covers the
// ordinals ("Waypoint 10", the final "Waypoint 12") that exposed the real
// deployed-iPhone-PWA Delete-button-wraps-onto-its-own-line bug: the fix
// itself (.waypoint-row-main becoming a CSS grid) is not observable in
// Vitest's css: false environment, so these tests only extend the existing
// accessible-name/endpoint-disabled coverage to those ordinals — the actual
// no-wrap layout proof lives in e2e/planning.spec.ts's phone-viewport test.
const MANY_WAYPOINTS: Waypoint[] = Array.from({ length: 12 }, (_, index) => ({
  id: `wp-${String(index)}`,
  coordinate: [index * 0.001, 51] as Coordinate,
}));

const MANY_WAYPOINT_ROLES: WaypointRole[] = [
  "start",
  ...Array.from({ length: 10 }, (): WaypointRole => "ordinary"),
  "finish",
];

function renderManyList(interactionMode: PlanningInteractionMode) {
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
      waypoints={MANY_WAYPOINTS}
      waypointRoles={MANY_WAYPOINT_ROLES}
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
        waypointRoles={[]}
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

  describe("ordinal badge role", () => {
    it("applies the map-mirroring role class to each row's badge for an open route", () => {
      renderList({ kind: "append" });

      expect(
        screen
          .getByRole("button", { name: "Start" })
          .querySelector(".waypoint-row-ordinal"),
      ).toHaveClass("waypoint-row-ordinal--start");

      const ordinaryBadge = screen
        .getByRole("button", { name: "Waypoint 2" })
        .querySelector(".waypoint-row-ordinal");
      expect(ordinaryBadge).not.toHaveClass("waypoint-row-ordinal--start");
      expect(ordinaryBadge).not.toHaveClass("waypoint-row-ordinal--finish");
      expect(ordinaryBadge).not.toHaveClass("waypoint-row-ordinal--start-finish");

      expect(
        screen
          .getByRole("button", { name: "Waypoint 3" })
          .querySelector(".waypoint-row-ordinal"),
      ).toHaveClass("waypoint-row-ordinal--finish");
    });

    it("keeps the badge decorative and aria-hidden regardless of role", () => {
      renderList({ kind: "append" });

      const badge = screen
        .getByRole("button", { name: "Start" })
        .querySelector(".waypoint-row-ordinal");
      expect(badge).toHaveAttribute("aria-hidden", "true");
    });

    it("preserves existing text, accessible names, selection and endpoint-disabling behaviour once role classes are applied", () => {
      renderList({ kind: "selected", waypointId: "a" });

      expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("group", { name: "Start actions" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Move Start up" })).toBeDisabled();
      expect(
        screen
          .getByRole("button", { name: "Start" })
          .querySelector(".waypoint-row-ordinal"),
      ).toHaveTextContent("1");
    });

    it("gives both endpoints the combined start-finish role for a closed loop, while each row keeps its own individual ordinal text", () => {
      const loopWaypoints: Waypoint[] = [
        ...WAYPOINTS,
        { id: "d", coordinate: [0, 51] as Coordinate },
      ];
      const loopRoles: WaypointRole[] = [
        "start-finish",
        "ordinary",
        "ordinary",
        "start-finish",
      ];
      render(
        <WaypointList
          waypoints={loopWaypoints}
          waypointRoles={loopRoles}
          interactionMode={{ kind: "append" }}
          onSelect={vi.fn()}
          onStartMove={vi.fn()}
          onStartInsertAfter={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          onDelete={vi.fn()}
        />,
      );

      const startButton = screen.getByRole("button", { name: "Start" });
      const finishButton = screen.getByRole("button", { name: "Waypoint 4" });

      expect(startButton.querySelector(".waypoint-row-ordinal")).toHaveClass(
        "waypoint-row-ordinal--start-finish",
      );
      expect(finishButton.querySelector(".waypoint-row-ordinal")).toHaveClass(
        "waypoint-row-ordinal--start-finish",
      );
      // Each row keeps its own single ordinal — never the map's combined
      // "1/4" label.
      expect(startButton.querySelector(".waypoint-row-ordinal")).toHaveTextContent("1");
      expect(finishButton.querySelector(".waypoint-row-ordinal")).toHaveTextContent("4");
    });
  });

  describe("double-digit waypoint counts (CLAUDE.md item 34)", () => {
    it("shows correct accessible names and Delete buttons at double-digit ordinals, unselected", () => {
      renderManyList({ kind: "append" });

      expect(screen.getByRole("button", { name: "Waypoint 10" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Waypoint 12" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Delete Waypoint 10" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Delete Waypoint 12" }),
      ).toBeInTheDocument();
    });

    it("disables Move up for the first row and Move down for the last row at a double-digit count", () => {
      renderManyList({ kind: "append" });

      expect(screen.getByRole("button", { name: "Move Start up" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Move Waypoint 12 down" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Start down" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Move Waypoint 12 up" })).toBeEnabled();
    });

    it("keeps the final double-digit row's accessible name, pressed state and relocate group correct once selected", () => {
      renderManyList({ kind: "selected", waypointId: "wp-11" });

      const finalRow = screen.getByRole("button", { name: "Waypoint 12" });
      expect(finalRow).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("group", { name: "Waypoint 12 actions" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Delete Waypoint 12" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Move Waypoint 12 down" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByRole("button", { name: "Insert after" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });
});
