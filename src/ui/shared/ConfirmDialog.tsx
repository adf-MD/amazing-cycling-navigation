import type { KeyboardEvent, RefObject } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables the Confirm/Cancel buttons while a triggered action is still
   * in flight, so a rapid double click can't submit twice and Cancel can
   * never appear to undo work storage is still carrying out — mirrors
   * RouteListItem.tsx's own hand-rolled delete confirmation precedent.
   * Disabling the button doesn't stop Escape from cancelling; a caller
   * relying on this must also guard its own onCancel. Undefined/false for
   * both existing callers, so their behaviour is unchanged. */
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  /** Heading level for the dialog's own title (backlog item 118). Defaults
   * to 2, which is what every caller rendered before this prop existed, so
   * a page-level dialog beneath a single h1 is unchanged. A caller that
   * renders this dialog *inside* a card supplies the level below that
   * card's own heading instead: Settings' OpenRouteService card is an h3
   * (backlog item 112), so its key-deletion confirmation is an h4. Without
   * this the title would take the UA default 1.5em — larger than
   * .screen-title's own clamped size — and would read as a new top-level
   * section rather than as part of the card it belongs to. */
  headingLevel?: 2 | 3 | 4;
  /** A handle onto this dialog's own root element, for a caller that must
   * measure its rendered box (backlog item 118's Settings reveal, which
   * scrolls the confirmation into the usable viewport when opening it
   * would otherwise leave it partly hidden). Named after
   * RouteTagManager.tsx's own `confirmRef` precedent rather than using
   * React 19's ref-as-prop, since every ref in this codebase is passed as
   * an explicit `*Ref` prop. Undefined for all six other callers, so their
   * rendering and behaviour are byte-identical. */
  containerRef?: RefObject<HTMLDivElement | null>;
}

/** Keeps the rendered tag a real JSX intrinsic rather than a computed
 * string, so nothing here widens to ElementType or needs a cast. */
const TITLE_TAGS = { 2: "h2", 3: "h3", 4: "h4" } as const;

/**
 * The app's shared, reusable confirmation pattern — a non-modal (in DOM
 * terms; `aria-modal="true"` is the ARIA hint only) alertdialog. Focus
 * moves to Cancel as soon as it opens (plain `autoFocus`, no effect
 * needed), and Escape anywhere inside it cancels, mirroring
 * RouteListItem.tsx's own hand-rolled per-row delete confirmation exactly.
 * Focus-restore to whatever triggered the dialog is the caller's own
 * responsibility (typically via a ref to that trigger, called from
 * onCancel/onConfirm) — this component has no notion of what opened it.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  confirmDisabled,
  cancelDisabled,
  headingLevel = 2,
  containerRef,
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  const Title = TITLE_TAGS[headingLevel];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="route-delete-confirm"
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      <Title id="confirm-dialog-title">{title}</Title>
      <p>{message}</p>
      <div className="route-delete-confirm-actions">
        <button
          type="button"
          className="btn-secondary"
          autoFocus
          onClick={onCancel}
          disabled={cancelDisabled}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
