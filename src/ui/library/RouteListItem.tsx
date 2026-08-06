import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, SubmitEvent } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";

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
  /** Registers/unregisters this row's name button so RouteLibrary can move
   * focus to it after a different route is deleted. */
  nameButtonRef: (element: HTMLButtonElement | null) => void;
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
  nameButtonRef,
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

  const openRename = () => {
    if (isDeletePending) {
      onDeleteCancel(route.id);
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
          <div>
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
          </div>
          <p className="route-card-meta">
            {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
          </p>
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
        </>
      )}
    </li>
  );
}
