import { useState } from "react";
import type { SubmitEvent } from "react";
import type { PlannedRoute } from "../../domain/types.ts";

export interface RouteListItemProps {
  route: PlannedRoute;
  onOpen: (route: PlannedRoute) => void;
  onRename: (id: string, name: string) => void;
  onExport: (route: PlannedRoute) => void;
  onDeleteRequest: (id: string) => void;
}

export function RouteListItem({
  route,
  onOpen,
  onRename,
  onExport,
  onDeleteRequest,
}: RouteListItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(route.name);

  const handleRenameSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== route.name) {
      onRename(route.id, trimmed);
    }
    setIsRenaming(false);
  };

  if (isRenaming) {
    return (
      <li>
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
    <li>
      <button
        type="button"
        onClick={() => {
          onOpen(route);
        }}
      >
        {route.name}
      </button>
      <span>{(route.distanceMetres / 1000).toFixed(1)} km</span>
      <button
        type="button"
        onClick={() => {
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
        onClick={() => {
          onDeleteRequest(route.id);
        }}
      >
        Delete
      </button>
    </li>
  );
}
