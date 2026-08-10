import type { KeyboardEvent } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

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
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

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
    >
      <h2 id="confirm-dialog-title">{title}</h2>
      <p>{message}</p>
      <div className="route-delete-confirm-actions">
        <button type="button" className="btn-secondary" autoFocus onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
