import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteListItem } from "./RouteListItem.tsx";
import type { PlannedRoute } from "../../domain/types.ts";

function buildRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id: "route-1",
    name: "Evening loop",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [],
    manoeuvres: [],
    distanceMetres: 12345,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "gpx-import" },
    ...overrides,
  };
}

describe("RouteListItem", () => {
  it("shows the route name and distance in km", () => {
    render(
      <RouteListItem
        route={buildRoute()}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onExport={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Evening loop" })).toBeInTheDocument();
    expect(screen.getByText("12.3 km")).toBeInTheDocument();
  });

  it("opens the route when its name is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const route = buildRoute();
    render(
      <RouteListItem
        route={route}
        onOpen={onOpen}
        onRename={vi.fn()}
        onExport={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Evening loop" }));
    expect(onOpen).toHaveBeenCalledWith(route);
  });

  it("renames via the inline form and calls onRename with the trimmed name", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <RouteListItem
        route={buildRoute()}
        onOpen={vi.fn()}
        onRename={onRename}
        onExport={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Route name");
    await user.clear(input);
    await user.type(input, "  Morning climb  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onRename).toHaveBeenCalledWith("route-1", "Morning climb");
    // The parent owns the route data; until it passes an updated route
    // (e.g. once the live query refires), the item just leaves edit mode.
    expect(screen.queryByLabelText("Route name")).toBeNull();
  });

  it("does not call onRename when the name is unchanged or empty", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <RouteListItem
        route={buildRoute()}
        onOpen={vi.fn()}
        onRename={onRename}
        onExport={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onRename).not.toHaveBeenCalled();
  });

  it("cancelling rename discards the draft", async () => {
    const user = userEvent.setup();
    render(
      <RouteListItem
        route={buildRoute()}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onExport={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.type(screen.getByLabelText("Route name"), " extra");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Evening loop" })).toBeInTheDocument();
  });

  it("triggers export and delete-request callbacks", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const onDeleteRequest = vi.fn();
    const route = buildRoute();
    render(
      <RouteListItem
        route={route}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onExport={onExport}
        onDeleteRequest={onDeleteRequest}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledWith(route);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteRequest).toHaveBeenCalledWith("route-1");
  });
});
