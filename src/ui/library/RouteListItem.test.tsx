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
  isPinned?: boolean;
  isPinPending?: boolean;
  pinError?: string | null;
  onPinToggle?: ReturnType<typeof vi.fn<(route: PlannedRoute) => void>>;
}

function renderItem(overrides: RenderOverrides = {}) {
  const route = overrides.route ?? buildRoute();
  const onOpen = overrides.onOpen ?? vi.fn<(route: PlannedRoute) => void>();
  const onRename = overrides.onRename ?? vi.fn<(id: string, name: string) => void>();
  const onExport = overrides.onExport ?? vi.fn<(route: PlannedRoute) => void>();
  const onDeleteRequest = overrides.onDeleteRequest ?? vi.fn<(id: string) => void>();
  const onDeleteCancel = overrides.onDeleteCancel ?? vi.fn<(id: string) => void>();
  const onDeleteConfirm = overrides.onDeleteConfirm ?? vi.fn<(id: string) => void>();
  const onPinToggle = overrides.onPinToggle ?? vi.fn<(route: PlannedRoute) => void>();

  const { unmount } = render(
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
      isPinned={overrides.isPinned ?? false}
      isPinPending={overrides.isPinPending ?? false}
      pinError={overrides.pinError ?? null}
      onPinToggle={onPinToggle}
      nameButtonRef={vi.fn()}
      pinButtonRef={vi.fn()}
    />,
  );

  return {
    route,
    onOpen,
    onRename,
    onExport,
    unmount,
    onDeleteRequest,
    onDeleteCancel,
    onDeleteConfirm,
    onPinToggle,
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

  it("pressing Escape while renaming discards the draft, does not call onRename, and restores the ordinary card", async () => {
    const user = userEvent.setup();
    const { onRename } = renderItem();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.type(screen.getByLabelText("Route name"), " extra");
    await user.keyboard("{Escape}");

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Evening loop" })).toBeInTheDocument();
  });

  it("keeps the same route-card element mounted, with distance and ascent still visible, while renaming", async () => {
    const user = userEvent.setup();
    renderItem({ route: buildRoute({ ascentMetres: 144.6 }) });

    const card = document.querySelector('[data-route-id="route-1"]');
    expect(card).toHaveClass("route-card", "stack");

    await user.click(screen.getByRole("button", { name: "Rename" }));

    const cardWhileRenaming = document.querySelector('[data-route-id="route-1"]');
    expect(cardWhileRenaming).toBe(card);
    expect(cardWhileRenaming).toHaveClass("route-card", "stack");
    expect(screen.getByText("12.3 km · 145 m ascent")).toBeInTheDocument();
  });

  it("removes Export and Delete from the document while renaming, rather than merely disabling them", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("focuses the name input and selects its existing text on entering rename mode", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByRole("button", { name: "Rename" }));

    const input = screen.getByLabelText<HTMLInputElement>("Route name");
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("returns focus to the Rename button after saving", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Rename" })).toHaveFocus();
  });

  it("returns focus to the Rename button after cancelling", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Rename" })).toHaveFocus();
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

  it("renders a very long route name in full, in both the card title and the delete confirmation heading, rather than truncating it", () => {
    const longName =
      "The full loop around the reservoir via the old railway path and back through the woods and the village and the church and the bridge";
    renderItem({
      route: buildRoute({ name: longName }),
      isDeletePending: true,
    });

    expect(screen.getByRole("button", { name: longName })).toBeInTheDocument();
    expect(
      within(screen.getByRole("alertdialog")).getByText(`Delete “${longName}”?`),
    ).toBeInTheDocument();
  });

  describe("pin toggle", () => {
    it("shows an unpinned toggle with a route-scoped Pin label and aria-pressed false", () => {
      renderItem({ isPinned: false });

      const button = screen.getByRole("button", { name: "Pin Evening loop" });
      expect(button).toHaveAttribute("aria-pressed", "false");
      expect(button).not.toHaveClass("is-pinned");
    });

    it("shows a pinned toggle with a route-scoped Unpin label and aria-pressed true", () => {
      renderItem({ isPinned: true });

      const button = screen.getByRole("button", { name: "Unpin Evening loop" });
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(button).toHaveClass("is-pinned");
    });

    it("is a real <button>, so it inherits the shared global button rule's 44x44 CSS pixel minimum touch target and focus-visible ring (index.css is not loaded in this test environment, so the touch-target size itself is verified by e2e/routeLibraryPinning.spec.ts instead)", () => {
      renderItem({ isPinned: false });

      const button = screen.getByRole("button", { name: "Pin Evening loop" });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveClass("route-pin-toggle");
    });

    it("clicking the toggle calls onPinToggle with the route", async () => {
      const user = userEvent.setup();
      const { route, onPinToggle } = renderItem({ isPinned: false });

      await user.click(screen.getByRole("button", { name: "Pin Evening loop" }));

      expect(onPinToggle).toHaveBeenCalledWith(route);
    });

    it("clicking the toggle while this route's delete confirmation is open cancels the pending delete first, then still calls onPinToggle", async () => {
      const user = userEvent.setup();
      const { route, onDeleteCancel, onPinToggle } = renderItem({
        isDeletePending: true,
        isPinned: false,
      });

      await user.click(screen.getByRole("button", { name: "Pin Evening loop" }));

      expect(onDeleteCancel).toHaveBeenCalledWith(route.id);
      expect(onPinToggle).toHaveBeenCalledWith(route);
    });

    it("is not disabled merely because a delete confirmation is open", () => {
      renderItem({ isDeletePending: true, isPinned: false });

      expect(screen.getByRole("button", { name: "Pin Evening loop" })).not.toBeDisabled();
    });

    it("is disabled while a pin write is pending or while deleting", () => {
      const { unmount } = renderItem({ isPinPending: true, isPinned: false });
      expect(screen.getByRole("button", { name: "Pin Evening loop" })).toBeDisabled();
      unmount();

      renderItem({ isDeletePending: true, isDeleting: true, isPinned: false });
      expect(screen.getByRole("button", { name: "Pin Evening loop" })).toBeDisabled();
    });

    it("shows an inline pin error as an alert", () => {
      renderItem({ pinError: "This route could not be pinned. Try again." });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "This route could not be pinned. Try again.",
      );
    });

    it("is hidden while renaming, alongside the rest of the title row", async () => {
      const user = userEvent.setup();
      renderItem({ isPinned: false });

      await user.click(screen.getByRole("button", { name: "Rename" }));

      expect(screen.queryByRole("button", { name: "Pin Evening loop" })).toBeNull();
    });

    it("wraps a very long route name without the title colliding with the pin toggle", () => {
      const longName =
        "The full loop around the reservoir via the old railway path and back through the woods and the village and the church and the bridge";
      renderItem({ route: buildRoute({ name: longName }), isPinned: false });

      const titleButton = screen.getByRole("button", { name: longName });
      const pinButton = screen.getByRole("button", { name: `Pin ${longName}` });
      expect(titleButton.parentElement).toHaveClass("route-card-title-row");
      expect(pinButton.parentElement).toBe(titleButton.parentElement);
    });
  });
});
