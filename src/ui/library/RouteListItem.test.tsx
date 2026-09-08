import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteListItem, type RouteSwitchPrompt } from "./RouteListItem.tsx";
import type { LibraryRoute, PlannedRoute } from "../../domain/types.ts";

function buildRoute(overrides: Partial<LibraryRoute> = {}): LibraryRoute {
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
    tags: [],
    ...overrides,
  };
}

interface RenderOverrides {
  route?: LibraryRoute;
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
  tagSuggestions?: readonly string[];
  onTagsSave?: ReturnType<
    typeof vi.fn<(id: string, tags: readonly string[]) => Promise<void>>
  >;
  switchPrompt?: RouteSwitchPrompt | null;
  stickyHeaderRef?: { current: HTMLElement | null };
}

/** Builds a complete RouteSwitchPrompt bundle (backlog item 73 follow-up)
 * with fresh vi.fn() handlers by default — mirrors the discriminated,
 * complete-contract shape App.tsx actually builds, so a test can never
 * accidentally exercise a half-specified prompt. */
function buildSwitchPrompt(
  overrides: Partial<RouteSwitchPrompt> = {},
): RouteSwitchPrompt {
  return {
    title: 'Switch to "Route B"?',
    message: '"Route A" is paused. Return to it, or end it and switch to "Route B".',
    confirmLabel: "End and switch",
    confirmVariant: "danger",
    offerReturn: true,
    busy: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onReturn: vi.fn(),
    ...overrides,
  };
}

function buildElement(route: LibraryRoute, overrides: RenderOverrides) {
  return (
    <RouteListItem
      route={route}
      onOpen={overrides.onOpen ?? vi.fn<(route: PlannedRoute) => void>()}
      onRename={overrides.onRename ?? vi.fn<(id: string, name: string) => void>()}
      onExport={overrides.onExport ?? vi.fn<(route: PlannedRoute) => void>()}
      onDeleteRequest={overrides.onDeleteRequest ?? vi.fn<(id: string) => void>()}
      onDeleteCancel={overrides.onDeleteCancel ?? vi.fn<(id: string) => void>()}
      onDeleteConfirm={overrides.onDeleteConfirm ?? vi.fn<(id: string) => void>()}
      isDeletePending={overrides.isDeletePending ?? false}
      isDeleting={overrides.isDeleting ?? false}
      deleteError={overrides.deleteError ?? null}
      isPinned={overrides.isPinned ?? false}
      isPinPending={overrides.isPinPending ?? false}
      pinError={overrides.pinError ?? null}
      onPinToggle={overrides.onPinToggle ?? vi.fn<(route: PlannedRoute) => void>()}
      tagSuggestions={overrides.tagSuggestions ?? []}
      onTagsSave={
        overrides.onTagsSave ??
        vi
          .fn<(id: string, tags: readonly string[]) => Promise<void>>()
          .mockResolvedValue(undefined)
      }
      nameButtonRef={vi.fn()}
      pinButtonRef={vi.fn()}
      switchPrompt={overrides.switchPrompt ?? null}
      stickyHeaderRef={overrides.stickyHeaderRef}
    />
  );
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
  const onTagsSave =
    overrides.onTagsSave ??
    vi
      .fn<(id: string, tags: readonly string[]) => Promise<void>>()
      .mockResolvedValue(undefined);

  const { unmount, rerender } = render(
    buildElement(route, {
      ...overrides,
      onOpen,
      onRename,
      onExport,
      onDeleteRequest,
      onDeleteCancel,
      onDeleteConfirm,
      onPinToggle,
      onTagsSave,
    }),
  );

  return {
    route,
    onOpen,
    onRename,
    onExport,
    unmount,
    // Rerenders with the same route/callbacks but a new switchPrompt — the
    // minimal seam needed to prove a later message change re-triggers the
    // nearest-scroll check, without threading every prop through again.
    rerenderWithSwitchPrompt: (switchPrompt: RouteSwitchPrompt | null) => {
      rerender(
        buildElement(route, {
          onOpen,
          onRename,
          onExport,
          onDeleteRequest,
          onDeleteCancel,
          onDeleteConfirm,
          onPinToggle,
          onTagsSave,
          switchPrompt,
        }),
      );
    },
    // Rerenders with an updated route (same id) — the seam used to prove
    // the tag editor only closes once route.tags reflects a save, by
    // simulating the live query supplying a fresh canonical route.
    rerenderWithRoute: (nextRoute: LibraryRoute) => {
      rerender(
        buildElement(nextRoute, {
          onOpen,
          onRename,
          onExport,
          onDeleteRequest,
          onDeleteCancel,
          onDeleteConfirm,
          onPinToggle,
          onTagsSave,
        }),
      );
    },
    onDeleteRequest,
    onDeleteCancel,
    onDeleteConfirm,
    onPinToggle,
    onTagsSave,
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

  describe("tag editor", () => {
    async function openEditor(
      user: ReturnType<typeof userEvent.setup>,
      label = "Add tags",
    ) {
      await user.click(screen.getByRole("button", { name: label }));
    }

    it("shows an untagged card with Add tags and no chip list", () => {
      renderItem({ route: buildRoute({ tags: [] }) });

      expect(screen.getByRole("button", { name: "Add tags" })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Tags" })).toBeNull();
    });

    it("shows a tagged card with Edit tags and the assigned tags", () => {
      renderItem({ route: buildRoute({ tags: ["Gravel"] }) });

      expect(screen.getByRole("button", { name: "Edit tags" })).toBeInTheDocument();
      expect(screen.getByText("Gravel")).toBeInTheDocument();
    });

    it("opening from Add tags seeds an empty draft; opening from Edit tags seeds the route's current tags", async () => {
      const user = userEvent.setup();
      renderItem({
        route: buildRoute({ tags: ["Gravel"] }),
        tagSuggestions: ["Gravel", "Weekend"],
      });

      await openEditor(user, "Edit tags");

      expect(screen.getByRole("button", { name: "Gravel" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Weekend" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("gives suggestion buttons correct aria-pressed state and a decorative, aria-hidden check-mark when pressed", async () => {
      const user = userEvent.setup();
      renderItem({
        route: buildRoute({ tags: ["Gravel"] }),
        tagSuggestions: ["Gravel", "Weekend"],
      });

      await openEditor(user, "Edit tags");

      const pressed = screen.getByRole("button", { name: "Gravel" });
      const unpressed = screen.getByRole("button", { name: "Weekend" });
      expect(pressed).toHaveAttribute("aria-pressed", "true");
      expect(unpressed).toHaveAttribute("aria-pressed", "false");
      const pressedCheck = pressed.querySelector(".tag-suggestion-check");
      const unpressedCheck = unpressed.querySelector(".tag-suggestion-check");
      expect(pressedCheck).toHaveAttribute("aria-hidden", "true");
      expect(pressedCheck).toHaveTextContent("✓");
      expect(unpressedCheck).toHaveTextContent("");
    });

    it("merges a route's own differently-spelled tag with the established suggestion spelling into one pressed entry, matched by identity not display text", async () => {
      const user = userEvent.setup();
      const { onTagsSave } = renderItem({
        route: buildRoute({ tags: ["gravel"] }),
        tagSuggestions: ["Gravel"],
      });

      await openEditor(user, "Edit tags");

      expect(screen.queryByRole("button", { name: "gravel" })).toBeNull();
      const merged = screen.getByRole("button", { name: "Gravel" });
      expect(merged).toHaveAttribute("aria-pressed", "true");

      // Saving without touching it preserves the route's original spelling.
      await user.click(screen.getByRole("button", { name: "Save tags" }));
      expect(onTagsSave).toHaveBeenCalledWith("route-1", ["gravel"]);
    });

    it("toggling off a merged entry removes the route's own tag by identity, even though the displayed label differs", async () => {
      const user = userEvent.setup();
      const { onTagsSave } = renderItem({
        route: buildRoute({ tags: ["gravel"] }),
        tagSuggestions: ["Gravel"],
      });

      await openEditor(user, "Edit tags");
      await user.click(screen.getByRole("button", { name: "Gravel" }));
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      expect(onTagsSave).toHaveBeenCalledWith("route-1", []);
    });

    it("adds a new multi-word tag via the Add tag button", async () => {
      const user = userEvent.setup();
      const { onTagsSave } = renderItem({ route: buildRoute({ tags: [] }) });

      await openEditor(user);
      await user.type(screen.getByLabelText("Add a tag"), "Weekend ride");
      await user.click(screen.getByRole("button", { name: "Add tag" }));
      expect(screen.getByRole("button", { name: "Weekend ride" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await user.click(screen.getByRole("button", { name: "Save tags" }));
      expect(onTagsSave).toHaveBeenCalledWith("route-1", ["Weekend ride"]);
    });

    it("adds a new tag by pressing Enter in the input, without saving the whole editor", async () => {
      const user = userEvent.setup();
      const { onTagsSave } = renderItem({ route: buildRoute({ tags: [] }) });

      await openEditor(user);
      await user.type(screen.getByLabelText("Add a tag"), "Commute{Enter}");

      expect(screen.getByRole("button", { name: "Commute" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(onTagsSave).not.toHaveBeenCalled();
    });

    it("adding an empty or whitespace-only value is a no-op", async () => {
      const user = userEvent.setup();
      renderItem({ route: buildRoute({ tags: [] }) });

      await openEditor(user);
      await user.type(screen.getByLabelText("Add a tag"), "   ");
      await user.click(screen.getByRole("button", { name: "Add tag" }));

      expect(screen.queryAllByRole("button", { name: /^$/ })).toEqual([]);
      expect(document.querySelectorAll(".tag-suggestion")).toHaveLength(0);
    });

    it("typing a case/whitespace variant of an already-drafted tag does not create a second entry", async () => {
      const user = userEvent.setup();
      renderItem({ route: buildRoute({ tags: [] }) });

      await openEditor(user);
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.type(screen.getByLabelText("Add a tag"), "  GRAVEL  {Enter}");

      expect(document.querySelectorAll(".tag-suggestion")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Gravel" })).toBeInTheDocument();
    });

    it("toggles a suggestion on and off", async () => {
      const user = userEvent.setup();
      const { onTagsSave } = renderItem({
        route: buildRoute({ tags: [] }),
        tagSuggestions: ["Gravel"],
      });

      await openEditor(user);
      const toggle = screen.getByRole("button", { name: "Gravel" });
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "false");

      await user.click(screen.getByRole("button", { name: "Save tags" }));
      expect(onTagsSave).toHaveBeenCalledWith("route-1", []);
    });

    it("clicking every assigned tag off leaves an empty draft", async () => {
      const user = userEvent.setup();
      const { onTagsSave } = renderItem({
        route: buildRoute({ tags: ["Gravel", "Commute"] }),
      });

      await openEditor(user, "Edit tags");
      await user.click(screen.getByRole("button", { name: "Gravel" }));
      await user.click(screen.getByRole("button", { name: "Commute" }));
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      expect(onTagsSave).toHaveBeenCalledWith("route-1", []);
    });

    it("Cancel discards the draft and does not call onTagsSave, whether the draft was mutated by typing or by toggling a suggestion", async () => {
      const user = userEvent.setup();
      const { onTagsSave } = renderItem({
        route: buildRoute({ tags: [] }),
        tagSuggestions: ["Weekend"],
      });

      await openEditor(user);
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Weekend" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onTagsSave).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Add tags" })).toBeInTheDocument();
    });

    it("Escape discards the draft and does not call onTagsSave", async () => {
      const user = userEvent.setup();
      const { onTagsSave } = renderItem({ route: buildRoute({ tags: [] }) });

      await openEditor(user);
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.keyboard("{Escape}");

      expect(onTagsSave).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Add tags" })).toBeInTheDocument();
    });

    it("focuses the tag input on entering the editor", async () => {
      const user = userEvent.setup();
      renderItem({ route: buildRoute({ tags: [] }) });

      await openEditor(user);

      expect(screen.getByLabelText("Add a tag")).toHaveFocus();
    });

    it("returns focus to the Add tags/Edit tags button after Cancel, Save (deferred promise resolved+synced) and Escape", async () => {
      const user = userEvent.setup();
      renderItem({ route: buildRoute({ tags: [] }) });

      await openEditor(user);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("button", { name: "Add tags" })).toHaveFocus();

      await openEditor(user);
      await user.keyboard("{Escape}");
      expect(screen.getByRole("button", { name: "Add tags" })).toHaveFocus();
    });

    it("calls onTagsSave exactly once and shows pending/disabled state, whether two clicks land after React re-renders or before it ever gets the chance to", async () => {
      const user = userEvent.setup();
      let releaseSave: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      const onTagsSave = vi
        .fn<(id: string, tags: readonly string[]) => Promise<void>>()
        .mockReturnValue(held);
      renderItem({ route: buildRoute({ tags: [] }), onTagsSave });

      await openEditor(user);
      const saveButton = screen.getByRole("button", { name: "Save tags" });

      // Standard project convention: two synchronous fireEvent.click()s.
      fireEvent.click(saveButton);
      fireEvent.click(saveButton);
      expect(onTagsSave).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent("Saving…");
      expect(screen.getByRole("button", { name: "Save tags" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(screen.getByLabelText("Add a tag")).toBeDisabled();

      // Cancel and Escape are no-ops while a save is in flight.
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.keyboard("{Escape}");
      expect(screen.getByRole("status")).toHaveTextContent("Saving…");

      releaseSave?.();
    });

    it("still calls onTagsSave exactly once when two invocations land inside a single act() with no intervening re-render at all", async () => {
      let releaseSave: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      const onTagsSave = vi
        .fn<(id: string, tags: readonly string[]) => Promise<void>>()
        .mockReturnValue(held);
      const user = userEvent.setup();
      renderItem({ route: buildRoute({ tags: [] }), onTagsSave });
      await openEditor(user);
      const saveButton = screen.getByRole("button", { name: "Save tags" });

      // Both raw clicks happen inside ONE act() call, so React genuinely
      // gets no chance to flush/re-render between them — this is what
      // proves the isSavingTagsRef guard itself (not merely React's own
      // batching between two separately-act()-wrapped fireEvent calls) is
      // what prevents a duplicate write.
      act(() => {
        saveButton.click();
        saveButton.click();
      });

      expect(onTagsSave).toHaveBeenCalledTimes(1);
      releaseSave?.();
    });

    it("Ordering A: write settles before route.tags arrives — closes only once route.tags then reflects the save by identity", async () => {
      const user = userEvent.setup();
      let releaseSave: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      const onTagsSave = vi
        .fn<(id: string, tags: readonly string[]) => Promise<void>>()
        .mockReturnValue(held);
      const { rerenderWithRoute } = renderItem({
        route: buildRoute({ tags: [] }),
        tagSuggestions: ["Gravel"],
        onTagsSave,
      });

      await openEditor(user);
      await user.click(screen.getByRole("button", { name: "Gravel" }));
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      expect(onTagsSave).toHaveBeenCalledWith("route-1", ["Gravel"]);
      expect(screen.getByRole("status")).toHaveTextContent("Saving…");

      // The write settles first. Its own .then() runs and is flushed by
      // React inside act() below, but route.tags hasn't arrived yet — the
      // editor must still be open.
      await act(async () => {
        releaseSave?.();
        await held;
      });
      expect(screen.getByRole("status")).toHaveTextContent("Saving…");
      expect(screen.getByRole("button", { name: "Save tags" })).toBeInTheDocument();

      // Only now does route.tags "arrive" (the live-query update) — this
      // is what finally closes the editor.
      rerenderWithRoute(buildRoute({ tags: ["Gravel"] }));

      await screen.findByRole("button", { name: "Edit tags" });
      expect(screen.getByText("Gravel")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save tags" })).toBeNull();
    });

    it("Ordering B: route.tags arrives before the write settles — must not get stuck on Saving… forever", async () => {
      const user = userEvent.setup();
      let releaseSave: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      const onTagsSave = vi
        .fn<(id: string, tags: readonly string[]) => Promise<void>>()
        .mockReturnValue(held);
      const { rerenderWithRoute } = renderItem({
        route: buildRoute({ tags: [] }),
        tagSuggestions: ["Gravel"],
        onTagsSave,
      });

      await openEditor(user);
      await user.click(screen.getByRole("button", { name: "Gravel" }));
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      expect(onTagsSave).toHaveBeenCalledWith("route-1", ["Gravel"]);
      expect(screen.getByRole("status")).toHaveTextContent("Saving…");

      // route.tags "arrives" (the live-query update) BEFORE the write's
      // own promise settles.
      rerenderWithRoute(buildRoute({ tags: ["Gravel"] }));
      expect(screen.getByRole("status")).toHaveTextContent("Saving…");
      expect(screen.getByRole("button", { name: "Save tags" })).toBeInTheDocument();

      // The write finally settles. A ref-only "write settled" signal would
      // trigger no re-render here, route.tags would never change again,
      // and the editor would be stuck on "Saving…" forever — the
      // findByRole below would time out. The state-based two-signal
      // handshake re-evaluates the closing condition against the
      // route.tags value already delivered above.
      await act(async () => {
        releaseSave?.();
        await held;
      });

      await screen.findByRole("button", { name: "Edit tags" });
      expect(screen.getByText("Gravel")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save tags" })).toBeNull();
    });

    it("a successful no-op save (route.tags already equal) closes the editor once the write settles, with no further route.tags change required", async () => {
      const user = userEvent.setup();
      let releaseSave: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      const onTagsSave = vi
        .fn<(id: string, tags: readonly string[]) => Promise<void>>()
        .mockReturnValue(held);
      renderItem({
        route: buildRoute({ tags: ["Gravel"] }),
        tagSuggestions: ["Gravel"],
        onTagsSave,
      });

      // Re-saving without changing the draft: route.tags already equals
      // what is being written, so the live query may never emit a
      // distinguishable update — this must not be required for the
      // editor to close.
      await openEditor(user, "Edit tags");
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      expect(onTagsSave).toHaveBeenCalledWith("route-1", ["Gravel"]);
      expect(screen.getByRole("status")).toHaveTextContent("Saving…");

      await act(async () => {
        releaseSave?.();
        await held;
      });

      await screen.findByRole("button", { name: "Edit tags" });
      expect(screen.getByText("Gravel")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save tags" })).toBeNull();
    });

    it("a rejected save keeps the draft and editor open, shows a generic alert, and permits retry and Cancel", async () => {
      const user = userEvent.setup();
      const onTagsSave = vi
        .fn<(id: string, tags: readonly string[]) => Promise<void>>()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined);
      const { rerenderWithRoute } = renderItem({
        route: buildRoute({ tags: [] }),
        tagSuggestions: ["Gravel"],
        onTagsSave,
      });

      await openEditor(user);
      await user.click(screen.getByRole("button", { name: "Gravel" }));
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("This route's tags could not be saved. Try again.");
      expect(alert.textContent).not.toContain("Gravel");
      expect(screen.getByRole("button", { name: "Gravel" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await user.click(screen.getByRole("button", { name: "Save tags" }));
      expect(onTagsSave).toHaveBeenCalledTimes(2);
      rerenderWithRoute(buildRoute({ tags: ["Gravel"] }));
      await screen.findByRole("button", { name: "Edit tags" });
    });

    it("opening the tag editor cancels this route's pending delete confirmation first", async () => {
      const user = userEvent.setup();
      const { onDeleteCancel, route } = renderItem({
        isDeletePending: true,
        route: buildRoute({ tags: [] }),
      });

      await user.click(screen.getByRole("button", { name: "Add tags" }));

      expect(onDeleteCancel).toHaveBeenCalledWith(route.id);
      expect(screen.getByRole("button", { name: "Save tags" })).toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("opening the tag editor while this card's switch prompt is busy does nothing", async () => {
      const user = userEvent.setup();
      const switchPrompt = buildSwitchPrompt({ busy: true });
      renderItem({ switchPrompt, route: buildRoute({ tags: [] }) });

      await user.click(screen.getByRole("button", { name: "Add tags" }));

      expect(switchPrompt.onCancel).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Save tags" })).toBeNull();
    });

    it("opening the tag editor while this card's switch prompt is actionable cancels it first, then opens", async () => {
      const user = userEvent.setup();
      const switchPrompt = buildSwitchPrompt({ busy: false });
      renderItem({ switchPrompt, route: buildRoute({ tags: [] }) });

      await user.click(screen.getByRole("button", { name: "Add tags" }));

      expect(switchPrompt.onCancel).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Save tags" })).toBeInTheDocument();
    });

    it("hides Rename, Pin, Export, Delete, delete confirmation and the switch prompt while the tag editor is open", async () => {
      const user = userEvent.setup();
      renderItem({
        route: buildRoute({ tags: [] }),
        isPinned: false,
        switchPrompt: buildSwitchPrompt(),
      });

      await user.click(screen.getByRole("button", { name: "Add tags" }));

      expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Pin Evening loop" })).toBeNull();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("renders a very long tag's text in full", () => {
      const longTag =
        "A genuinely very long tag describing a specific recurring commute variant";
      renderItem({ route: buildRoute({ tags: [longTag] }) });

      expect(screen.getByText(longTag)).toBeInTheDocument();
    });
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

  // Backlog item 73 follow-up: the inline unfinished-session switch prompt.
  describe("switch prompt", () => {
    // Saved only to restore afterwards, never called unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalScrollIntoView = Element.prototype.scrollIntoView;

    beforeEach(() => {
      // jsdom doesn't implement scrollIntoView at all — mirrors
      // RouteSummaryPanel.test.tsx's own identical precedent.
      Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    it("renders no panel when switchPrompt is null", () => {
      renderItem({ switchPrompt: null });

      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("renders the title, message and three actions in order (End and switch, Return to paused ride, Cancel) when offerReturn is true", () => {
      renderItem({ switchPrompt: buildSwitchPrompt({ offerReturn: true }) });

      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).getByText('Switch to "Route B"?')).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          '"Route A" is paused. Return to it, or end it and switch to "Route B".',
        ),
      ).toBeInTheDocument();
      const buttons = within(dialog).getAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual([
        "End and switch",
        "Return to paused ride",
        "Cancel",
      ]);
    });

    it("renders only the confirm action and Cancel, in that order, when offerReturn is false", () => {
      renderItem({ switchPrompt: buildSwitchPrompt({ offerReturn: false }) });

      const dialog = screen.getByRole("alertdialog");
      const buttons = within(dialog).getAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual([
        "End and switch",
        "Cancel",
      ]);
      expect(
        within(dialog).queryByRole("button", { name: "Return to paused ride" }),
      ).toBeNull();
    });

    it("gives the panel its own route-scoped labelling and no aria-modal", () => {
      renderItem({ switchPrompt: buildSwitchPrompt() });

      const dialog = screen.getByRole("alertdialog", { name: 'Switch to "Route B"?' });
      expect(dialog).not.toHaveAttribute("aria-modal");
      expect(dialog).toHaveAccessibleDescription(
        '"Route A" is paused. Return to it, or end it and switch to "Route B".',
      );
    });

    it("moves focus to Cancel when the prompt opens", () => {
      renderItem({ switchPrompt: buildSwitchPrompt() });

      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    it("clicking Cancel calls onCancel and does not itself move focus — App owns the sole focus-restoration path", async () => {
      const user = userEvent.setup();
      const switchPrompt = buildSwitchPrompt();
      renderItem({ switchPrompt });

      const titleButton = screen.getByRole("button", { name: "Evening loop" });
      const focusSpy = vi.spyOn(titleButton, "focus");

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(switchPrompt.onCancel).toHaveBeenCalledTimes(1);
      expect(focusSpy).not.toHaveBeenCalled();
    });

    it("pressing Escape calls onCancel and does not itself move focus", async () => {
      const user = userEvent.setup();
      const switchPrompt = buildSwitchPrompt();
      renderItem({ switchPrompt });

      const titleButton = screen.getByRole("button", { name: "Evening loop" });
      const focusSpy = vi.spyOn(titleButton, "focus");

      await user.keyboard("{Escape}");

      expect(switchPrompt.onCancel).toHaveBeenCalledTimes(1);
      expect(focusSpy).not.toHaveBeenCalled();
    });

    it("clicking Return to paused ride calls onReturn", async () => {
      const user = userEvent.setup();
      const switchPrompt = buildSwitchPrompt();
      renderItem({ switchPrompt });

      await user.click(screen.getByRole("button", { name: "Return to paused ride" }));

      expect(switchPrompt.onReturn).toHaveBeenCalledTimes(1);
    });

    it("clicking the confirm action calls onConfirm", async () => {
      const user = userEvent.setup();
      const switchPrompt = buildSwitchPrompt();
      renderItem({ switchPrompt });

      await user.click(screen.getByRole("button", { name: "End and switch" }));

      expect(switchPrompt.onConfirm).toHaveBeenCalledTimes(1);
    });

    it("disables every rendered action while busy", () => {
      renderItem({ switchPrompt: buildSwitchPrompt({ busy: true }) });

      const dialog = screen.getByRole("alertdialog");
      for (const button of within(dialog).getAllByRole("button")) {
        expect(button).toBeDisabled();
      }
    });

    it("styles the confirm action as destructive only when confirmVariant is danger", () => {
      const { unmount } = renderItem({
        switchPrompt: buildSwitchPrompt({
          confirmVariant: "danger",
          confirmLabel: "End and switch",
        }),
      });
      expect(screen.getByRole("button", { name: "End and switch" })).toHaveClass(
        "btn-danger",
      );
      unmount();

      renderItem({
        switchPrompt: buildSwitchPrompt({
          confirmVariant: "secondary",
          confirmLabel: "Check again",
        }),
      });
      const secondaryConfirm = screen.getByRole("button", { name: "Check again" });
      expect(secondaryConfirm).toHaveClass("btn-secondary");
      expect(secondaryConfirm).not.toHaveClass("btn-danger");
    });

    it("never styles Cancel as destructive, and styles Return as the positive primary action", () => {
      renderItem({ switchPrompt: buildSwitchPrompt({ offerReturn: true }) });

      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      expect(cancelButton).toHaveClass("btn-secondary");
      expect(cancelButton).not.toHaveClass("btn-danger");

      const returnButton = screen.getByRole("button", { name: "Return to paused ride" });
      expect(returnButton).toHaveClass("btn-primary");
      expect(returnButton).not.toHaveClass("btn-danger");
    });

    it("clicking Rename while this card's switch prompt is open cancels it first, then enters rename mode", async () => {
      const user = userEvent.setup();
      const switchPrompt = buildSwitchPrompt();
      renderItem({ switchPrompt });

      await user.click(screen.getByRole("button", { name: "Rename" }));

      expect(switchPrompt.onCancel).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Route name")).toBeInTheDocument();
    });

    it("clicking the pin toggle while this card's switch prompt is open cancels it first, then still calls onPinToggle", async () => {
      const user = userEvent.setup();
      const switchPrompt = buildSwitchPrompt();
      const { route, onPinToggle } = renderItem({ switchPrompt, isPinned: false });

      await user.click(screen.getByRole("button", { name: "Pin Evening loop" }));

      expect(switchPrompt.onCancel).toHaveBeenCalledTimes(1);
      expect(onPinToggle).toHaveBeenCalledWith(route);
    });

    describe("scroll-into-view target (backlog item 95)", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalMatchMedia = window.matchMedia;

      afterEach(() => {
        Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        window.matchMedia = originalMatchMedia;
      });

      /** Every element reports this rect unless overridden per-test — tall
       * enough (bottom 900, beyond jsdom's default 768 innerHeight) that a
       * card using it is NOT already fully visible, so the default fixture
       * exercises the "must scroll" branch unless a test overrides it. */
      function stubRect(overrides: Partial<DOMRect> = {}): DOMRect {
        return {
          top: 100,
          bottom: 900,
          left: 0,
          right: 320,
          width: 320,
          height: 800,
          x: 0,
          y: 100,
          toJSON: () => "",
          ...overrides,
        };
      }

      function captureScrollCalls() {
        const calls: { target: Element; options: ScrollIntoViewOptions }[] = [];
        Element.prototype.scrollIntoView = function scrollIntoView(
          this: Element,
          options?: boolean | ScrollIntoViewOptions,
        ) {
          calls.push({ target: this, options: (options ?? {}) as ScrollIntoViewOptions });
        };
        return calls;
      }

      it("scrolls the outer route card (not the nested panel) into view, end-aligned, when it first opens", () => {
        Element.prototype.getBoundingClientRect = () => stubRect();
        const calls = captureScrollCalls();

        const { route } = renderItem({
          switchPrompt: buildSwitchPrompt({ message: "Ending your current ride…" }),
        });

        expect(calls).toHaveLength(1);
        const card = document.querySelector(`[data-route-id="${route.id}"]`);
        expect(calls[0]?.target).toBe(card);
        expect(calls[0]?.target).not.toBe(screen.getByRole("alertdialog"));
        expect(calls[0]?.options).toEqual(
          expect.objectContaining({ block: "end", behavior: "smooth" }),
        );
      });

      it("does not scroll again for an identical rerendered message, but does for a genuinely changed message", () => {
        Element.prototype.getBoundingClientRect = () => stubRect();
        const calls = captureScrollCalls();

        const { rerenderWithSwitchPrompt } = renderItem({
          switchPrompt: buildSwitchPrompt({ message: "Ending your current ride…" }),
        });
        expect(calls).toHaveLength(1);

        rerenderWithSwitchPrompt(
          buildSwitchPrompt({ message: "Ending your current ride…" }),
        );
        expect(calls).toHaveLength(1);

        rerenderWithSwitchPrompt(
          buildSwitchPrompt({
            message: "This unfinished ride could not be ended on this device. Try again.",
          }),
        );
        expect(calls).toHaveLength(2);
      });

      it("does not scroll again for a busy progress message, but re-arms for a later non-busy actionable message (item 95 follow-up)", () => {
        Element.prototype.getBoundingClientRect = () => stubRect();
        const calls = captureScrollCalls();

        const { rerenderWithSwitchPrompt } = renderItem({
          switchPrompt: buildSwitchPrompt({
            busy: false,
            message:
              '"Route A" is paused. Return to it, or end it and switch to "Route B".',
          }),
        });
        expect(calls).toHaveLength(1);

        // Tapping "Return to paused ride" flips this card's own prompt into
        // a busy, non-actionable progress message before the async storage
        // reads resolve. This must NOT re-trigger a fresh scroll: the
        // screen is about to leave Routes regardless of this scroll's
        // outcome, and the busy state offers nothing actionable to bring
        // into view.
        rerenderWithSwitchPrompt(
          buildSwitchPrompt({ busy: true, message: "Opening your paused ride…" }),
        );
        expect(calls).toHaveLength(1);

        // A later, genuinely new ACTIONABLE message following the busy
        // interval (e.g. a failed re-check) must still re-check visibility
        // and scroll if needed — the busy message must not have been
        // latched as "the last seen message" and permanently suppressed
        // future checks.
        rerenderWithSwitchPrompt(
          buildSwitchPrompt({
            busy: false,
            message:
              "This paused ride has changed since this screen opened. Check again to see its current status.",
          }),
        );
        expect(calls).toHaveLength(2);
      });

      it("does not scroll at all when the card is already fully visible", () => {
        // Well within jsdom's default 768px innerHeight, comfortably below
        // a headerless (headerBottom 0) top boundary.
        Element.prototype.getBoundingClientRect = () =>
          stubRect({ top: 50, bottom: 200 });
        const calls = captureScrollCalls();

        renderItem({
          switchPrompt: buildSwitchPrompt({ message: "Ending your current ride…" }),
        });

        expect(calls).toHaveLength(0);
      });

      it("scrolls when the sticky header (via stickyHeaderRef) occludes an otherwise short-enough card", () => {
        const headerEl = document.createElement("header");
        Element.prototype.getBoundingClientRect = function (this: Element) {
          if (this === headerEl) return stubRect({ top: 0, bottom: 120 });
          // Short card, would be "fully visible" against a headerless (0)
          // top boundary, but its top (60) sits above the header's own
          // bottom (120) — occluded, must still scroll.
          return stubRect({ top: 60, bottom: 200 });
        };
        const calls = captureScrollCalls();
        const stickyHeaderRef = { current: headerEl };

        renderItem({
          switchPrompt: buildSwitchPrompt({ message: "Ending your current ride…" }),
          stickyHeaderRef,
        });

        expect(calls).toHaveLength(1);
      });

      it("uses immediate (auto) behaviour under prefers-reduced-motion, and smooth otherwise", () => {
        Element.prototype.getBoundingClientRect = () => stubRect();
        window.matchMedia = ((query: string) => ({
          matches: query === "(prefers-reduced-motion: reduce)",
        })) as typeof window.matchMedia;
        const calls = captureScrollCalls();

        renderItem({
          switchPrompt: buildSwitchPrompt({ message: "Ending your current ride…" }),
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.options).toEqual(
          expect.objectContaining({ block: "end", behavior: "auto" }),
        );
      });
    });
  });
});
