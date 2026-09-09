import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteTagManager, type RouteTagManagerProps } from "./RouteTagManager.tsx";

// Props-only isolated tests, mirroring RouteListItem.test.tsx's own style
// (RouteLibrary.tagManagement.test.tsx covers the same panel through the
// real repository and live query instead).

function renderManager(overrides: Partial<RouteTagManagerProps> = {}) {
  const props: RouteTagManagerProps = {
    tags: ["Gravel", "Road"],
    routeCountsByTagKey: new Map([
      ["gravel", 3],
      ["road", 1],
    ]),
    sourceKey: "",
    newName: "",
    isBusy: false,
    errorMessage: null,
    confirmation: null,
    onSourceKeyChange: vi.fn(),
    onNewNameChange: vi.fn(),
    onRenameRequest: vi.fn(),
    onDeleteRequest: vi.fn(),
    onConfirm: vi.fn(),
    onCancelConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<RouteTagManager {...props} />);
  return props;
}

function panel(): HTMLElement {
  return screen.getByRole("group", { name: "Manage tags" });
}

describe("RouteTagManager", () => {
  it("lists every tag once with a correctly pluralised route count", () => {
    renderManager();
    expect(
      within(panel()).getByRole("option", { name: "Gravel (3 routes)" }),
    ).toBeInTheDocument();
    expect(
      within(panel()).getByRole("option", { name: "Road (1 route)" }),
    ).toBeInTheDocument();
  });

  it("starts on a neutral placeholder rather than auto-selecting the first tag", () => {
    renderManager();
    expect(within(panel()).getByLabelText("Tag to manage")).toHaveValue("");
    expect(
      within(panel()).getByRole("option", { name: "Choose a tag" }),
    ).toBeInTheDocument();
  });

  it("disables the actions and the name field until a tag is chosen", () => {
    renderManager();
    expect(within(panel()).getByRole("button", { name: "Rename tag" })).toBeDisabled();
    expect(within(panel()).getByRole("button", { name: "Delete tag" })).toBeDisabled();
    expect(within(panel()).getByLabelText("New name")).toBeDisabled();
  });

  it("leaves Rename enabled with an empty name, so the failure is a real message", () => {
    renderManager({ sourceKey: "gravel" });
    expect(within(panel()).getByRole("button", { name: "Rename tag" })).toBeEnabled();
  });

  it("states the scope of the pending change before it is submitted", () => {
    renderManager({ sourceKey: "gravel" });
    expect(within(panel()).getByText("Rename “Gravel” on 3 routes.")).toBeVisible();
  });

  it("switches to merge wording and a merge action once the typed name collides", () => {
    renderManager({ sourceKey: "gravel", newName: "road" });
    expect(
      within(panel()).getByText("Merge “Gravel” into “Road” on 3 routes."),
    ).toBeVisible();
    expect(
      within(panel()).getByRole("button", { name: "Merge tags" }),
    ).toBeInTheDocument();
    expect(
      within(panel()).queryByRole("button", { name: "Rename tag" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a deliberate case-only rename as a rename, not a merge", () => {
    renderManager({ sourceKey: "gravel", newName: "gravel" });
    expect(
      within(panel()).getByRole("button", { name: "Rename tag" }),
    ).toBeInTheDocument();
    expect(
      within(panel()).getByText("Rename “Gravel” to “gravel” on 3 routes."),
    ).toBeVisible();
  });

  it("falls back to the placeholder when the chosen tag is no longer offered", () => {
    // A <select> whose value matches no option silently shows the first
    // one, which would arm a destructive action against the wrong tag.
    renderManager({
      tags: ["Road"],
      routeCountsByTagKey: new Map([["road", 1]]),
      sourceKey: "gravel",
    });
    expect(within(panel()).getByLabelText("Tag to manage")).toHaveValue("");
    expect(within(panel()).getByRole("button", { name: "Delete tag" })).toBeDisabled();
  });

  it("disables every control and announces progress while an operation is applying", () => {
    renderManager({ sourceKey: "gravel", isBusy: true });
    expect(within(panel()).getByRole("status")).toHaveTextContent("Applying…");
    expect(within(panel()).getByLabelText("Tag to manage")).toBeDisabled();
    expect(within(panel()).getByLabelText("New name")).toBeDisabled();
    expect(within(panel()).getByRole("button", { name: "Rename tag" })).toBeDisabled();
    expect(within(panel()).getByRole("button", { name: "Delete tag" })).toBeDisabled();
    expect(within(panel()).getByRole("button", { name: "Close" })).toBeDisabled();
  });

  it("shows a failure as an alert without dismissing the panel", () => {
    renderManager({ sourceKey: "gravel", newName: "Trail", errorMessage: "Nope." });
    expect(within(panel()).getByRole("alert")).toHaveTextContent("Nope.");
    expect(within(panel()).getByLabelText("New name")).toHaveValue("Trail");
  });

  it("labels the confirmation with its own ids and focuses Cancel", () => {
    renderManager({
      sourceKey: "gravel",
      confirmation: {
        title: "Delete the tag “Gravel”?",
        message: "Gone.",
        confirmLabel: "Delete tag",
      },
    });
    const dialog = screen.getByRole("alertdialog", { name: "Delete the tag “Gravel”?" });
    expect(dialog).toHaveTextContent("Gone.");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("cancels the confirmation on Escape", async () => {
    const user = userEvent.setup();
    const props = renderManager({
      sourceKey: "gravel",
      confirmation: { title: "Delete?", message: "Gone.", confirmLabel: "Delete tag" },
    });
    await user.keyboard("{Escape}");
    expect(props.onCancelConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows an explicit empty state, and only a Close action, once no tag is left", () => {
    renderManager({ tags: [], routeCountsByTagKey: new Map() });
    expect(
      within(panel()).getByText(
        "No tags left. Add tags from a route to manage them here.",
      ),
    ).toBeVisible();
    expect(within(panel()).queryByLabelText("Tag to manage")).not.toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
