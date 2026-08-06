import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { exportRouteToGpx } from "../../gpx/exportGpx.ts";
import type { GpxImportResult } from "../../gpx/importGpx.ts";
import type { GpxImportNotice } from "../../gpx/parseGpx.ts";
import { logError } from "../../platform/errorLog.ts";
import {
  DEFAULT_ROUTE_LIBRARY_SORT_ORDER,
  type RouteLibrarySortOrder,
} from "../../storage/mapping.ts";
import {
  getRouteLibraryPreferences,
  saveRouteLibraryPreferences,
} from "../../storage/routeLibraryPreferencesRepository.ts";
import { deleteRoute, listRoutes, renameRoute } from "../../storage/routesRepository.ts";
import { downloadTextFile } from "../shared/downloadTextFile.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { ImportGpxButton } from "./ImportGpxButton.tsx";
import { computeFocusRouteIdAfterDelete } from "./routeDeleteFocus.ts";
import { selectRouteLibraryView } from "./routeLibraryView.ts";
import { RouteListItem } from "./RouteListItem.tsx";

export interface RouteLibraryProps {
  onOpenRoute: (route: PlannedRoute) => void;
  /** A ref (never a dereferenced value — reading `.current` during render
   * would both trip react-hooks/refs and not pick up a later mutation)
   * holding the document scrollY to restore once, the first time real
   * route cards render after this component mounts. Consumed and nulled
   * out after that one attempt, whether or not it actually scrolled. */
  restoreScrollYRef?: RefObject<number | null>;
  /** A ref holding the current session's search query, continuously
   * synced on every keystroke — unlike restoreScrollYRef this is never
   * one-shot-nulled, because every navigate-away-and-back path to Routes
   * needs it restored, not only the route-open path (there is no single
   * "about to navigate away from Routes" call site the way handleOpenRoute
   * is for scroll). Owned by App (never unmounts), so it survives this
   * component's own unmount/remount on every screen switch; resets only
   * when App itself remounts (a full reload). Hydrated once per mount via
   * an effect below, never a lazy useState initializer, for the same
   * react-hooks/refs reason as restoreScrollYRef. */
  restoreSearchQueryRef?: RefObject<string>;
}

export function RouteLibrary({
  onOpenRoute,
  restoreScrollYRef,
  restoreSearchQueryRef,
}: RouteLibraryProps) {
  const listRoutesQuery = useCallback(() => listRoutes(), []);
  const routes = useLiveQuery(listRoutesQuery);
  const preferencesQuery = useCallback(() => getRouteLibraryPreferences(), []);
  const preferences = useLiveQuery(preferencesQuery);
  const sortOrder = preferences?.sortOrder ?? DEFAULT_ROUTE_LIBRARY_SORT_ORDER;

  const [searchQuery, setSearchQuery] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notices, setNotices] = useState<GpxImportNotice[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isSavingSortPreference, setIsSavingSortPreference] = useState(false);
  const [sortPreferenceError, setSortPreferenceError] = useState<string | null>(null);

  const nameButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasAppliedScrollRestoreRef = useRef(false);
  const lastRenamedIdRef = useRef<string | null>(null);

  const viewRoutes = useMemo(
    () =>
      routes === undefined ? [] : selectRouteLibraryView(routes, searchQuery, sortOrder),
    [routes, searchQuery, sortOrder],
  );
  const previousViewRoutesRef = useRef<readonly PlannedRoute[]>(viewRoutes);

  // Hydrates the search query from the session-lifetime ref exactly once
  // per mount — never via a lazy useState initializer, since reading a
  // ref's .current during render trips react-hooks/refs (see
  // restoreSearchQueryRef's own doc comment above). restoreSearchQueryRef
  // is a stable prop reference (owned by App, created once via useRef), so
  // despite being a dependency this only ever fires on mount.
  useLayoutEffect(() => {
    if (restoreSearchQueryRef?.current) {
      setSearchQuery(restoreSearchQueryRef.current);
    }
  }, [restoreSearchQueryRef]);

  useLayoutEffect(() => {
    if (hasAppliedScrollRestoreRef.current) return;
    if (routes === undefined || preferences === undefined) return; // still "Loading routes…"
    hasAppliedScrollRestoreRef.current = true;
    const restoreScrollY = restoreScrollYRef?.current ?? null;
    if (restoreScrollY != null && viewRoutes.length > 0) {
      window.scrollTo({ top: restoreScrollY, left: 0, behavior: "auto" });
    }
    if (restoreScrollYRef) {
      restoreScrollYRef.current = null;
    }
  }, [routes, preferences, viewRoutes, restoreScrollYRef]);

  // If a rename causes the renamed route to drop out of the active search
  // filter, its row (and any focus within it) unmounts — move focus to
  // the next/else-previous displayed route, or the search field. Keyed
  // off lastRenamedIdRef (set by handleRename) rather than a generic
  // "focus was orphaned" check: by the time this effect can run, the
  // browser has already defaulted focus to <body> on the row's removal,
  // so a document.activeElement check can't tell a rename-caused
  // disappearance apart from a delete-caused one. The stillExists guard
  // defers to handleDeleteConfirm's own focus handling if the same route
  // was deleted before this rename's write round-tripped. Accepted, narrow
  // gap: renaming a second route before the first rename's write lands
  // overwrites this marker, so the first route's stranding goes
  // uncorrected — local IndexedDB writes round-trip in low single-digit
  // milliseconds, so this window is sub-perceptible.
  useEffect(() => {
    const renamedId = lastRenamedIdRef.current;
    if (renamedId) {
      const previous = previousViewRoutesRef.current;
      const wasVisible = previous.some((route) => route.id === renamedId);
      const stillVisible = viewRoutes.some((route) => route.id === renamedId);
      const stillExists = (routes ?? []).some((route) => route.id === renamedId);
      if (wasVisible && !stillVisible && stillExists) {
        const focusTargetId = computeFocusRouteIdAfterDelete(previous, renamedId);
        const target = focusTargetId ? nameButtonRefs.current.get(focusTargetId) : null;
        (target ?? searchInputRef.current)?.focus();
      }
      lastRenamedIdRef.current = null;
    }
    previousViewRoutesRef.current = viewRoutes;
  }, [viewRoutes, routes]);

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
    lastRenamedIdRef.current = id;
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
    const focusTargetId = computeFocusRouteIdAfterDelete(viewRoutes, id);
    const hasActiveQuery = searchQuery.trim().length > 0;

    setIsDeleting(true);
    setDeleteError(null);
    deleteRoute(id)
      .then(() => {
        setPendingDeleteId(null);
        setIsDeleting(false);
        const target = focusTargetId ? nameButtonRefs.current.get(focusTargetId) : null;
        const fallback = hasActiveQuery ? searchInputRef.current : null;
        (target ?? fallback ?? headingRef.current)?.focus();
      })
      .catch((error: unknown) => {
        setIsDeleting(false);
        setDeleteError(
          error instanceof Error ? error.message : "That route could not be deleted.",
        );
        logError("route-delete", error);
      });
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (restoreSearchQueryRef) {
      restoreSearchQueryRef.current = value;
    }
  };

  const handleClearSearch = () => {
    handleSearchChange("");
    searchInputRef.current?.focus();
  };

  const handleSortOrderChange = (nextSortOrder: RouteLibrarySortOrder) => {
    setSortPreferenceError(null);
    setIsSavingSortPreference(true);
    saveRouteLibraryPreferences({ sortOrder: nextSortOrder })
      .then(() => {
        setIsSavingSortPreference(false);
      })
      .catch((error: unknown) => {
        logError("route-library-save-preferences", error);
        setIsSavingSortPreference(false);
        setSortPreferenceError(
          "This preference could not be saved on this device. Try again.",
        );
      });
  };

  const trimmedQuery = searchQuery.trim();

  return (
    <section className="screen" aria-label="Route library">
      <div className="row">
        <h1 className="screen-title" ref={headingRef} tabIndex={-1}>
          Routes
        </h1>
        <ImportGpxButton onImported={handleImported} onError={handleImportError} />
      </div>
      {importError ? <p role="alert">{importError}</p> : null}
      {exportError ? <p role="alert">{exportError}</p> : null}
      {notices.map((notice) => (
        <p role="status" key={notice.message}>
          {notice.message}
        </p>
      ))}

      {routes !== undefined && routes.length > 0 ? (
        <div className="row">
          <div className="route-library-field">
            <label htmlFor="route-library-search">Search routes</label>
            <div className="row">
              <input
                id="route-library-search"
                type="search"
                className="field-input"
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => {
                  handleSearchChange(event.target.value);
                }}
              />
              {trimmedQuery ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleClearSearch}
                >
                  Clear search
                </button>
              ) : null}
            </div>
          </div>
          <div className="route-library-field">
            <label htmlFor="route-library-sort">Sort by</label>
            <select
              id="route-library-sort"
              className="route-library-sort-select"
              value={sortOrder}
              onChange={(event) => {
                handleSortOrderChange(event.target.value as RouteLibrarySortOrder);
              }}
            >
              <option value="most-recent">Most recent</option>
              <option value="name-asc">Name A–Z</option>
            </select>
          </div>
          {isSavingSortPreference ? (
            <p role="status" className="field-hint">
              Saving…
            </p>
          ) : null}
          {sortPreferenceError ? (
            <p role="alert" className="field-error">
              {sortPreferenceError}
            </p>
          ) : null}
        </div>
      ) : null}

      {routes === undefined || preferences === undefined ? (
        <p>Loading routes…</p>
      ) : routes.length === 0 ? (
        <p>No routes saved yet. Import a GPX file to get started.</p>
      ) : viewRoutes.length === 0 ? (
        <p role="status">No routes match “{trimmedQuery}”.</p>
      ) : (
        <ul className="route-list">
          {viewRoutes.map((route) => (
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
