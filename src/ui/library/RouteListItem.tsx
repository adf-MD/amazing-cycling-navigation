import { useId, useRef, useState } from "react";
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
  const headingId = useId();
  const descriptionId = useId();

  const handleRenameSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== route.name) {
      onRename(route.id, trimmed);
    }
    setIsRenaming(false);
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

  if (isRenaming) {
    return (
      <li data-route-id={route.id}>
        <form onSubmit={handleRenameSubmit}>
          <label>
            Route name
            <input
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value);
              }}
            />
          </label>
          <button type="submit">Save</button>
          <button
            type="button"
            onClick={() => {
              setDraftName(route.name);
              setIsRenaming(false);
            }}
          >
            Cancel
          </button>
        </form>
      </li>
    );
  }

  return (
    <li data-route-id={route.id}>
      <div>
        <button
          type="button"
          ref={nameButtonRef}
          onClick={() => {
            onOpen(route);
          }}
        >
          {route.name}
        </button>
      </div>
      <div>
        {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
      </div>
      <div className="route-list-item-actions">
        <button
          type="button"
          onClick={() => {
            if (isDeletePending) {
              onDeleteCancel(route.id);
            }
            setDraftName(route.name);
            setIsRenaming(true);
          }}
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => {
            onExport(route);
          }}
        >
          Export
        </button>
        <button
          type="button"
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
          <h3 id={headingId}>Delete “{route.name}”?</h3>
          <p id={descriptionId}>
            This route will be permanently deleted from this device. This cannot be
            undone.
          </p>
          {deleteError ? <p role="alert">{deleteError}</p> : null}
          <div className="route-delete-confirm-actions">
            <button
              type="button"
              autoFocus
              disabled={isDeleting}
              onClick={handleCancelDelete}
            >
              Cancel
            </button>
            <button
              type="button"
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
    </li>
  );
}
