import { useCallback, useRef, useState } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { exportRouteToGpx } from "../../gpx/exportGpx.ts";
import type { GpxImportResult } from "../../gpx/importGpx.ts";
import type { GpxImportNotice } from "../../gpx/parseGpx.ts";
import { logError } from "../../platform/errorLog.ts";
import { deleteRoute, listRoutes, renameRoute } from "../../storage/routesRepository.ts";
import { downloadTextFile } from "../shared/downloadTextFile.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { ImportGpxButton } from "./ImportGpxButton.tsx";
import { RouteListItem } from "./RouteListItem.tsx";
import { computeFocusRouteIdAfterDelete } from "./routeDeleteFocus.ts";

export interface RouteLibraryProps {
  onOpenRoute: (route: PlannedRoute) => void;
}

export function RouteLibrary({ onOpenRoute }: RouteLibraryProps) {
  const listRoutesQuery = useCallback(() => listRoutes(), []);
  const routes = useLiveQuery(listRoutesQuery);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notices, setNotices] = useState<GpxImportNotice[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const nameButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);

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
    setExportError(null);
    const fileName = `${route.name.trim() || "route"}.gpx`;
    exportRouteToGpx(route)
      .then((xml) => {
        downloadTextFile(fileName, xml, "application/gpx+xml");
      })
      .catch((error: unknown) => {
        setExportError(
          error instanceof Error ? error.message : "That route could not be exported.",
        );
        logError("route-export", error);
      });
  };

  const handleDeleteRequest = (id: string) => {
    if (isDeleting) return;
    setPendingDeleteId(id);
    setDeleteError(null);
  };

  const handleDeleteCancel = (id: string) => {
    if (isDeleting || id !== pendingDeleteId) return;
    setPendingDeleteId(null);
    setDeleteError(null);
  };

  const handleDeleteConfirm = (id: string) => {
    if (isDeleting) return;
    const focusTargetId = computeFocusRouteIdAfterDelete(routes ?? [], id);

    setIsDeleting(true);
    setDeleteError(null);
    deleteRoute(id)
      .then(() => {
        setPendingDeleteId(null);
        setIsDeleting(false);
        const target = focusTargetId ? nameButtonRefs.current.get(focusTargetId) : null;
        (target ?? headingRef.current)?.focus();
      })
      .catch((error: unknown) => {
        setIsDeleting(false);
        setDeleteError(
          error instanceof Error ? error.message : "That route could not be deleted.",
        );
        logError("route-delete", error);
      });
  };

  return (
    <section aria-label="Route library">
      <h2 ref={headingRef} tabIndex={-1}>
        Routes
      </h2>
      <ImportGpxButton onImported={handleImported} onError={handleImportError} />
      {importError ? <p role="alert">{importError}</p> : null}
      {exportError ? <p role="alert">{exportError}</p> : null}
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
              onDeleteCancel={handleDeleteCancel}
              onDeleteConfirm={handleDeleteConfirm}
              isDeletePending={route.id === pendingDeleteId}
              isDeleting={isDeleting}
              deleteError={deleteError}
              nameButtonRef={(element) => {
                if (element) {
                  nameButtonRefs.current.set(route.id, element);
                } else {
                  nameButtonRefs.current.delete(route.id);
                }
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
