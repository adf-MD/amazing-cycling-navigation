import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

interface RenderOverrides {
  route?: PlannedRoute;
  onOpen?: ReturnType<typeof vi.fn<(route: PlannedRoute) => void>>;
  onRename?: ReturnType<typeof vi.fn<(id: string, name: string) => void>>;
  onExport?: ReturnType<typeof vi.fn<(route: PlannedRoute) => void>>;
  onDeleteRequest?: ReturnType<typeof vi.fn<(id: string) => void>>;
  onDeleteCancel?: ReturnType<typeof vi.fn<(id: string) => void>>;
  onDeleteConfirm?: ReturnType<typeof vi.fn<(id: string) => void>>;
  isDeletePending?: boolean;
  isDeleting?: boolean;
  deleteError?: string | null;
}

function renderItem(overrides: RenderOverrides = {}) {
  const route = overrides.route ?? buildRoute();
  const onOpen = overrides.onOpen ?? vi.fn<(route: PlannedRoute) => void>();
  const onRename = overrides.onRename ?? vi.fn<(id: string, name: string) => void>();
  const onExport = overrides.onExport ?? vi.fn<(route: PlannedRoute) => void>();
  const onDeleteRequest = overrides.onDeleteRequest ?? vi.fn<(id: string) => void>();
  const onDeleteCancel = overrides.onDeleteCancel ?? vi.fn<(id: string) => void>();
  const onDeleteConfirm = overrides.onDeleteConfirm ?? vi.fn<(id: string) => void>();

  render(
    <RouteListItem
      route={route}
      onOpen={onOpen}
      onRename={onRename}
      onExport={onExport}
      onDeleteRequest={onDeleteRequest}
      onDeleteCancel={onDeleteCancel}
      onDeleteConfirm={onDeleteConfirm}
      isDeletePending={overrides.isDeletePending ?? false}
      isDeleting={overrides.isDeleting ?? false}
      deleteError={overrides.deleteError ?? null}
      nameButtonRef={vi.fn()}
    />,
  );

  return {
    route,
    onOpen,
    onRename,
    onExport,
    onDeleteRequest,
    onDeleteCancel,
    onDeleteConfirm,
  };
}

describe("RouteListItem", () => {
  it("shows the route name, distance and ascent not available when there's no elevation data", () => {
    renderItem();

    expect(screen.getByRole("button", { name: "Evening loop" })).toBeInTheDocument();
    expect(screen.getByText("12.3 km · ascent not available")).toBeInTheDocument();
  });

  it("shows the ascent in metres when available", () => {
    renderItem({ route: buildRoute({ ascentMetres: 144.6 }) });

    expect(screen.getByText("12.3 km · 145 m ascent")).toBeInTheDocument();
  });

  it("opens the route when its name is clicked", async () => {
    const user = userEvent.setup();
    const { route, onOpen } = renderItem();

    await user.click(screen.getByRole("button", { name: "Evening loop" }));
    expect(onOpen).toHaveBeenCalledWith(route);
  });

  it("renames via the inline form and calls onRename with the trimmed name", async () => {
    const user = userEvent.setup();
    const { onRename } = renderItem();

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
    const { onRename } = renderItem();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onRename).not.toHaveBeenCalled();
  });

  it("cancelling rename discards the draft", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.type(screen.getByLabelText("Route name"), " extra");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Evening loop" })).toBeInTheDocument();
  });

  it("triggers export and delete-request callbacks", async () => {
    const user = userEvent.setup();
    const { route, onExport, onDeleteRequest } = renderItem();

    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledWith(route);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteRequest).toHaveBeenCalledWith(route.id);
  });

  it("renders no inline confirmation when isDeletePending is false", () => {
    renderItem({ isDeletePending: false });

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders the inline confirmation with the route's name, the explanation and both actions when isDeletePending is true", () => {
    renderItem({ isDeletePending: true });

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delete “Evening loop”?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This route will be permanently deleted from this device. This cannot be undone.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Delete route" }),
    ).toBeInTheDocument();
  });

  it("gives the confirmation route-scoped labelling and no aria-modal", () => {
    renderItem({ isDeletePending: true });

    const dialog = screen.getByRole("alertdialog", { name: "Delete “Evening loop”?" });
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(dialog).toHaveAccessibleDescription(
      "This route will be permanently deleted from this device. This cannot be undone.",
    );
  });

  it("moves focus to the Cancel button when the confirmation opens", () => {
    renderItem({ isDeletePending: true });

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("clicking Cancel calls onDeleteCancel with the route id and returns focus to the Delete button", async () => {
    const user = userEvent.setup();
    const { route, onDeleteCancel } = renderItem({ isDeletePending: true });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDeleteCancel).toHaveBeenCalledWith(route.id);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
  });

  it("pressing Escape while focus is inside the confirmation cancels and returns focus to the Delete button", async () => {
    const user = userEvent.setup();
    const { route, onDeleteCancel } = renderItem({ isDeletePending: true });

    await user.keyboard("{Escape}");

    expect(onDeleteCancel).toHaveBeenCalledWith(route.id);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
  });

  it("clicking Delete route calls onDeleteConfirm with the route id", async () => {
    const user = userEvent.setup();
    const { route, onDeleteConfirm } = renderItem({ isDeletePending: true });

    await user.click(screen.getByRole("button", { name: "Delete route" }));

    expect(onDeleteConfirm).toHaveBeenCalledWith(route.id);
  });

  it("disables Cancel and Delete route and shows Deleting… while isDeleting is true", () => {
    renderItem({ isDeletePending: true, isDeleting: true });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  });

  it("shows the delete error as an alert without dismissing the confirmation", () => {
    renderItem({
      isDeletePending: true,
      deleteError: "That route could not be deleted.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That route could not be deleted.",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("clicking Rename while this route's delete confirmation is open cancels the pending delete first, then enters rename mode", async () => {
    const user = userEvent.setup();
    const { route, onDeleteCancel } = renderItem({ isDeletePending: true });

    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onDeleteCancel).toHaveBeenCalledWith(route.id);
    expect(screen.getByLabelText("Route name")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("clicking Rename does not call onDeleteCancel when isDeletePending is false", async () => {
    const user = userEvent.setup();
    const { onDeleteCancel } = renderItem({ isDeletePending: false });

    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onDeleteCancel).not.toHaveBeenCalled();
  });
});
