import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, SubmitEvent } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { prefersReducedMotion } from "../../platform/environmentContext.ts";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";
import { PinIcon } from "./PinIcon.tsx";

/** The inline, route-card-scoped presentation of backlog item 73's
 * unfinished-session switch guard (item 73 follow-up) — a ready-made view
 * model plus every handler this card needs, bundled together so a
 * non-null value is always fully actionable. App.tsx computes every field;
 * this component only renders it. `confirmVariant` is "danger" only for
 * the destructive End-and-switch/Discard-and-continue family of statuses —
 * Cancel and Return are always secondary-styled, never destructive. */
export interface RouteSwitchPrompt {
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant: "secondary" | "danger";
  offerReturn: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onReturn: () => void;
}

export interface RouteListItemProps {
  route: PlannedRoute;
  onOpen: (route: PlannedRoute) => void;
  onRename: (id: string, name: string) => void;
  onExport: (route: PlannedRoute) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteCancel: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  isDeletePending: boolean;
  isDeleting: boolean;
  deleteError: string | null;
  isPinned: boolean;
  isPinPending: boolean;
  pinError: string | null;
  onPinToggle: (route: PlannedRoute) => void;
  /** Registers/unregisters this row's name button so RouteLibrary can move
   * focus to it after a different route is deleted. */
  nameButtonRef: (element: HTMLButtonElement | null) => void;
  /** Registers/unregisters this row's pin toggle so RouteLibrary can move
   * focus back to it after a successful pin/unpin. Needed even though
   * pinned and unpinned routes render as one continuous, single-keyed
   * list: this button is `disabled` for the duration of the write (to
   * block a duplicate submission), and a real browser automatically blurs
   * a focused control the instant it becomes disabled — confirmed in a
   * real browser, not merely suspected, via this component's own e2e
   * pinning coverage. */
  pinButtonRef: (element: HTMLButtonElement | null) => void;
  /** The inline switch-guard prompt for THIS card, or null when no switch
   * is pending here (backlog item 73 follow-up). See RouteSwitchPrompt's
   * own doc comment. */
  switchPrompt: RouteSwitchPrompt | null;
}

export function RouteListItem({
  route,
  onOpen,
  onRename,
  onExport,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
  isDeletePending,
  isDeleting,
  deleteError,
  isPinned,
  isPinPending,
  pinError,
  onPinToggle,
  nameButtonRef,
  pinButtonRef,
  switchPrompt,
}: RouteListItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(route.name);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const wasRenamingRef = useRef(false);
  const headingId = useId();
  const descriptionId = useId();
  const nameFieldId = useId();
  const switchPanelRef = useRef<HTMLDivElement>(null);
  const switchHeadingId = useId();
  const switchDescriptionId = useId();
  // Tracks the last message this card scrolled for, so a later status
  // change within the SAME pending switch (e.g. conflict -> clear-failed
  // surfacing a longer error) re-checks nearest-scroll too, not only the
  // initial open — a failure can grow the panel's height enough to push
  // its own buttons back below the fold.
  const lastSwitchMessageRef = useRef<string | null>(null);

  // Autofocuses (and selects the existing name in) the input on entering
  // rename mode, and returns focus to the Rename button on leaving it —
  // mirroring handleCancelDelete's own Cancel/Escape-returns-focus-to-
  // Delete precedent below. A ref (rather than a second render) tracks
  // whether this is a genuine exit rather than the initial mount, so the
  // Rename button isn't focused on first render. Both Save and Cancel/
  // Escape go through the same setIsRenaming(false), so this single
  // effect covers all three exits without duplicating focus logic.
  useEffect(() => {
    if (isRenaming) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    } else if (wasRenamingRef.current) {
      renameButtonRef.current?.focus();
    }
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  // Re-checks nearest-scroll whenever this card's switch prompt first
  // appears, or its message text changes (a later status transition within
  // the same pending switch, e.g. a failure surfacing new error text) —
  // mirrors RouteSummaryPanel.tsx's own scrollIntoView({block:"nearest"})
  // + prefersReducedMotion() precedent.
  useEffect(() => {
    if (!switchPrompt) {
      lastSwitchMessageRef.current = null;
      return;
    }
    if (switchPrompt.message !== lastSwitchMessageRef.current) {
      lastSwitchMessageRef.current = switchPrompt.message;
      switchPanelRef.current?.scrollIntoView({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [switchPrompt]);

  const openRename = () => {
    if (isDeletePending) {
      onDeleteCancel(route.id);
    }
    if (switchPrompt) {
      switchPrompt.onCancel();
    }
    setDraftName(route.name);
    setIsRenaming(true);
  };

  const handleRenameSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== route.name) {
      onRename(route.id, trimmed);
    }
    setIsRenaming(false);
  };

  const handleCancelRename = () => {
    setDraftName(route.name);
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      handleCancelRename();
    }
  };

  const handleCancelDelete = () => {
    if (isDeleting) return;
    onDeleteCancel(route.id);
    deleteButtonRef.current?.focus();
  };

  // Mirrors openRename's own "cancel a pending delete confirmation (and
  // switch prompt) first" precedent above, so an open alertdialog never
  // gets silently moved into a different group instead of being resolved.
  const handlePinClick = () => {
    if (isDeletePending) {
      onDeleteCancel(route.id);
    }
    if (switchPrompt) {
      switchPrompt.onCancel();
    }
    onPinToggle(route);
  };

  const handleConfirmKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      handleCancelDelete();
    }
  };

  return (
    <li className="route-card stack" data-route-id={route.id}>
      {isRenaming ? (
        <form
          className="stack"
          onSubmit={handleRenameSubmit}
          onKeyDown={handleRenameKeyDown}
        >
          <label htmlFor={nameFieldId}>Route name</label>
          <input
            id={nameFieldId}
            ref={nameInputRef}
            className="field-input"
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value);
            }}
          />
          <p className="route-card-meta">
            {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
          </p>
          <div className="row">
            <button type="submit" className="btn-primary">
              Save
            </button>
            <button type="button" className="btn-secondary" onClick={handleCancelRename}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="route-card-title-row">
            <button
              type="button"
              className="route-card-title"
              ref={nameButtonRef}
              onClick={() => {
                onOpen(route);
              }}
            >
              {route.name}
            </button>
            <button
              type="button"
              className={`route-pin-toggle${isPinned ? " is-pinned" : ""}`}
              ref={pinButtonRef}
              aria-pressed={isPinned}
              aria-label={`${isPinned ? "Unpin" : "Pin"} ${route.name}`}
              title={`${isPinned ? "Unpin" : "Pin"} ${route.name}`}
              disabled={isPinPending || isDeleting}
              onClick={handlePinClick}
            >
              <PinIcon filled={isPinned} />
            </button>
          </div>
          <p className="route-card-meta">
            {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
          </p>
          {pinError ? (
            <p role="alert" className="field-error">
              {pinError}
            </p>
          ) : null}
          <div className="route-list-item-actions">
            <button
              type="button"
              className="btn-secondary"
              ref={renameButtonRef}
              onClick={openRename}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onExport(route);
              }}
            >
              Export
            </button>
            <button
              type="button"
              className="btn-danger"
              ref={deleteButtonRef}
              onClick={() => {
                onDeleteRequest(route.id);
              }}
            >
              Delete
            </button>
          </div>
          {isDeletePending ? (
            <div
              className="route-delete-confirm"
              role="alertdialog"
              aria-labelledby={headingId}
              aria-describedby={descriptionId}
              onKeyDown={handleConfirmKeyDown}
            >
              <h2 id={headingId}>Delete “{route.name}”?</h2>
              <p id={descriptionId}>
                This route will be permanently deleted from this device. This cannot be
                undone.
              </p>
              {deleteError ? <p role="alert">{deleteError}</p> : null}
              <div className="route-delete-confirm-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  autoFocus
                  disabled={isDeleting}
                  onClick={handleCancelDelete}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isDeleting}
                  onClick={() => {
                    onDeleteConfirm(route.id);
                  }}
                >
                  {isDeleting ? "Deleting…" : "Delete route"}
                </button>
              </div>
            </div>
          ) : null}
          {switchPrompt ? (
            <div
              ref={switchPanelRef}
              className="route-delete-confirm"
              role="alertdialog"
              aria-labelledby={switchHeadingId}
              aria-describedby={switchDescriptionId}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  switchPrompt.onCancel();
                }
              }}
            >
              <h2 id={switchHeadingId}>{switchPrompt.title}</h2>
              <p id={switchDescriptionId}>{switchPrompt.message}</p>
              <div className="route-delete-confirm-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  autoFocus
                  disabled={switchPrompt.busy}
                  onClick={switchPrompt.onCancel}
                >
                  Cancel
                </button>
                {switchPrompt.offerReturn ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={switchPrompt.busy}
                    onClick={switchPrompt.onReturn}
                  >
                    Return to paused ride
                  </button>
                ) : null}
                <button
                  type="button"
                  className={
                    switchPrompt.confirmVariant === "danger"
                      ? "btn-danger"
                      : "btn-secondary"
                  }
                  disabled={switchPrompt.busy}
                  onClick={switchPrompt.onConfirm}
                >
                  {switchPrompt.confirmLabel}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}
