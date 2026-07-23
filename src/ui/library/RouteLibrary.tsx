import { useCallback, useState } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { exportRouteToGpx } from "../../gpx/exportGpx.ts";
import type { GpxImportResult } from "../../gpx/importGpx.ts";
import type { GpxImportNotice } from "../../gpx/parseGpx.ts";
import { logError } from "../../platform/errorLog.ts";
import { deleteRoute, listRoutes, renameRoute } from "../../storage/routesRepository.ts";
import { downloadTextFile } from "../shared/downloadTextFile.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { ImportGpxButton } from "./ImportGpxButton.tsx";
import { RouteListItem } from "./RouteListItem.tsx";

export interface RouteLibraryProps {
  onOpenRoute: (route: PlannedRoute) => void;
}

export function RouteLibrary({ onOpenRoute }: RouteLibraryProps) {
  const listRoutesQuery = useCallback(() => listRoutes(), []);
  const routes = useLiveQuery(listRoutesQuery);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [notices, setNotices] = useState<GpxImportNotice[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImported = (result: GpxImportResult) => {
    setNotices(result.notices);
    setImportError(null);
  };

  const handleImportError = (error: unknown) => {
    setNotices([]);
    setImportError(
      error instanceof Error ? error.message : "That file could not be imported.",
    );
    logError("gpx-import", error);
  };

  const handleRename = (id: string, name: string) => {
    renameRoute(id, name).catch((error: unknown) => {
      logError("route-rename", error);
    });
  };

  const handleExport = (route: PlannedRoute) => {
    const fileName = `${route.name.trim() || "route"}.gpx`;
    downloadTextFile(fileName, exportRouteToGpx(route), "application/gpx+xml");
  };

  const handleDeleteRequest = (id: string) => {
    setPendingDeleteId(id);
  };

  const handleDeleteConfirm = () => {
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    if (id) {
      deleteRoute(id).catch((error: unknown) => {
        logError("route-delete", error);
      });
    }
  };

  const handleDeleteCancel = () => {
    setPendingDeleteId(null);
  };

  return (
    <section aria-label="Route library">
      <h2>Routes</h2>
      <ImportGpxButton onImported={handleImported} onError={handleImportError} />
      {importError ? <p role="alert">{importError}</p> : null}
      {notices.map((notice) => (
        <p role="status" key={notice.message}>
          {notice.message}
        </p>
      ))}

      {routes === undefined ? (
        <p>Loading routes…</p>
      ) : routes.length === 0 ? (
        <p>No routes saved yet. Import a GPX file to get started.</p>
      ) : (
        <ul>
          {routes.map((route) => (
            <RouteListItem
              key={route.id}
              route={route}
              onOpen={onOpenRoute}
              onRename={handleRename}
              onExport={handleExport}
              onDeleteRequest={handleDeleteRequest}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete route"
        message="This route will be permanently deleted from this device. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </section>
  );
}
