import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows title and message when open, and calls the right handler per button", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Delete route"
        message="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("moves focus to the Cancel button as soon as it opens", () => {
    render(
      <ConfirmDialog
        open
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("pressing Escape anywhere inside the dialog cancels", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirmDisabled disables Confirm and blocks its click handler", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmDisabled
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const confirmButton = screen.getByRole("button", { name: "Delete" });
    expect(confirmButton).toBeDisabled();
    await user.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancelDisabled disables Cancel and blocks its click handler", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        cancelDisabled
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeDisabled();
    await user.click(cancelButton);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("titles the dialog at level 2 by default, which is what every existing caller renders", () => {
    render(
      <ConfirmDialog
        open
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Delete route", level: 2 }),
    ).toBeInTheDocument();
  });

  it("renders the title at the requested level, still naming the dialog (backlog item 118)", () => {
    render(
      <ConfirmDialog
        open
        headingLevel={4}
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Delete route", level: 4 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Delete route");
  });

  it("resolves containerRef to the alertdialog root, and renders identically without it (backlog item 118 follow-up)", () => {
    const containerRef = { current: null as HTMLDivElement | null };
    const { unmount } = render(
      <ConfirmDialog
        open
        containerRef={containerRef}
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(containerRef.current).toBe(screen.getByRole("alertdialog"));
    const withRef = screen.getByRole("alertdialog").outerHTML;
    unmount();

    // The six other call sites omit the prop; their markup must be
    // byte-identical to the same dialog rendered with it.
    render(
      <ConfirmDialog
        open
        title="Delete route"
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alertdialog").outerHTML).toBe(withRef);
  });
});
