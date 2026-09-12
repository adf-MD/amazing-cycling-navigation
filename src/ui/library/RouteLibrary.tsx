import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import type { LibraryRoute, PlannedRoute } from "../../domain/types.ts";
import {
  collectTagSuggestions,
  countRoutesByTagIdentity,
  tagIdentityKey,
  tagsEqualByIdentity,
} from "../../domain/routeTags.ts";
import { prefersReducedMotion } from "../../platform/environmentContext.ts";
import { runWhenViewportSettled } from "../shared/viewportSettle.ts";
import { applyTopRevealScroll } from "./routeCardTopReveal.ts";
import { isCardAlreadyFullyVisible } from "./routeSwitchCardVisibility.ts";
import {
  describeActiveTagFilterCount,
  describeProspectiveTagFilterCount,
  selectProspectiveTagFilterCounts,
  tagFilterCountSlotDigits,
} from "./routeLibraryView.ts";
import { RouteTagManager } from "./RouteTagManager.tsx";
import {
  reconcileTagLifecycle,
  type PendingTagLifecycle,
} from "./tagLifecycleReconciliation.ts";
import {
  describeDeleteConfirmation,
  describeMergeConfirmation,
  describeTagLifecycleSuccess,
  type TagLifecycleConfirmation,
} from "./tagLifecycleMessages.ts";
import {
  resolveEffectiveSourceKey,
  resolveTagLifecycleTarget,
  findTagSpelling,
} from "./tagLifecycleTarget.ts";
import { exportRouteToGpx } from "../../gpx/exportGpx.ts";
import type { GpxImportResult } from "../../gpx/importGpx.ts";
import type { GpxImportNotice } from "../../gpx/parseGpx.ts";
import { systemClock, type Clock } from "../../platform/clock.ts";
import { logError } from "../../platform/errorLog.ts";
import {
  DEFAULT_ROUTE_LIBRARY_SORT_ORDER,
  type RouteLibrarySortOrder,
} from "../../storage/mapping.ts";
import {
  getRouteLibraryPreferences,
  saveRouteLibraryPreferences,
} from "../../storage/routeLibraryPreferencesRepository.ts";
import {
  applyRouteTagLifecycle,
  deleteRoute,
  listRoutes,
  pinRoute,
  renameRoute,
  unpinRoute,
  updateRouteTags,
  type RouteTagLifecycleOperation,
} from "../../storage/routesRepository.ts";
import { downloadTextFile } from "../shared/downloadTextFile.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { ImportGpxButton } from "./ImportGpxButton.tsx";
import { computeFocusRouteIdAfterDelete } from "./routeDeleteFocus.ts";
import { isPinnedRoute, selectRouteLibraryGroups } from "./routeLibraryView.ts";
import { RouteListItem, type RouteSwitchPrompt } from "./RouteListItem.tsx";

/** The inline switch-guard prompt (backlog item 73 follow-up), owned and
 * fully computed by App.tsx — this is the single, complete, discriminated
 * contract: when non-null, `routeId` identifies which card renders it and
 * every handler the card and this library need is guaranteed present, so
 * there is no way to have a visible prompt with a missing/no-op handler. */
export interface PendingRouteSwitch extends RouteSwitchPrompt {
  routeId: string;
  /** Reported back to App when this route stops being visible in the
   * current (search/sort-filtered) list — deleted, or merely filtered out
   * by search text — so App can cancel the pending switch safely instead
   * of leaving an invisible actionable prompt. */
  onTargetMissing: (routeId: string) => void;
}

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
  /** A ref holding the current session's selected tag-filter identity keys
   * (tagIdentityKey outputs, not display spellings) — mirrors
   * restoreSearchQueryRef's own contract exactly: never one-shot-nulled,
   * continuously synced, owned by App (survives this component's own
   * unmount/remount on every screen switch), resets only when App itself
   * remounts. Hydrated once per mount via an effect below (backlog item
   * 100 stage 3). */
  restoreTagFilterKeysRef?: RefObject<readonly string[]>;
  /** Injectable for tests, mirroring PlanningScreen's own clock prop
   * convention — lets a test control pin-timestamp ordering deterministically
   * instead of depending on real clicks landing in different milliseconds.
   * Defaults to the real system clock in production. */
  clock?: Clock;
  /** Optional at this outer level only (defaults to null) so existing call
   * sites need no mechanical update; when present it is always the
   * complete PendingRouteSwitch bundle — see that type's own doc comment. */
  pendingRouteSwitch?: PendingRouteSwitch | null;
  /** App's own sticky top-navigation element, threaded straight through to
   * every RouteListItem row unchanged (a single shared ref, not per-row) —
   * mirrors restoreScrollYRef's own shape. Lets a card measure the sticky
   * header's live rendered height when deciding whether its route-switch
   * guard prompt needs to scroll into view (backlog item 95). */
  stickyHeaderRef?: RefObject<HTMLElement | null>;
}

export function RouteLibrary({
  onOpenRoute,
  restoreScrollYRef,
  restoreSearchQueryRef,
  restoreTagFilterKeysRef,
  clock = systemClock,
  pendingRouteSwitch = null,
  stickyHeaderRef,
}: RouteLibraryProps) {
  const listRoutesQuery = useCallback(() => listRoutes(), []);
  const routes = useLiveQuery(listRoutesQuery);
  const preferencesQuery = useCallback(() => getRouteLibraryPreferences(), []);
  const preferences = useLiveQuery(preferencesQuery);
  const sortOrder = preferences?.sortOrder ?? DEFAULT_ROUTE_LIBRARY_SORT_ORDER;

  const [searchQuery, setSearchQuery] = useState("");
  // Backlog item 100 stage 3: selected tag-filter identity keys
  // (tagIdentityKey outputs). tagFiltersHydrated distinguishes "nothing
  // restored yet" from "genuinely nothing to restore" — see the
  // hydration effect below for why the stale-key pruning and
  // restoration-ref sync both must wait for it.
  const [selectedTagFilters, setSelectedTagFilters] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // The global tag manager (backlog item 100 stage 4A).
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [tagManagerSourceKey, setTagManagerSourceKey] = useState("");
  const [tagManagerNewName, setTagManagerNewName] = useState("");
  const [tagLifecycleConfirm, setTagLifecycleConfirm] = useState<{
    operation: RouteTagLifecycleOperation;
    copy: TagLifecycleConfirmation;
  } | null>(null);
  const [tagLifecycleError, setTagLifecycleError] = useState<string | null>(null);
  const [tagLifecycleStatus, setTagLifecycleStatus] = useState<string | null>(null);
  const [tagManagerHint, setTagManagerHint] = useState<string | null>(null);
  // Drives only the visible disabled/"Applying…" UI; isTagLifecycleBusyRef
  // below is the correctness guard, mirroring RouteListItem's own
  // isSavingTags/isSavingTagsRef split.
  const [isTagLifecycleBusy, setIsTagLifecycleBusy] = useState(false);
  const isTagLifecycleBusyRef = useRef(false);
  // ONE marker for both the tag-filter follow and the manager's own
  // completion, because both wait on exactly the same two signals: the
  // write settling, and the live-query corpus reflecting it. See
  // tagLifecycleReconciliation.ts.
  const [pendingTagLifecycle, setPendingTagLifecycle] =
    useState<PendingTagLifecycle | null>(null);
  // Never focuses during rendering: the render-time adjustment only
  // records where focus must go, and a post-commit effect performs it.
  const [pendingFocusHandoff, setPendingFocusHandoff] = useState<{
    target: "select" | "search" | "rename" | "delete";
    id: number;
    /** Backlog item 105. Set on exactly ONE transition — a successful
     * rename/merge/non-final delete, where the panel stays open — and
     * never by requestManagerFocus, which serves the failed-operation and
     * cancelled-confirmation paths. The effect below branches on this
     * flag rather than on `target === "select"`: that the two currently
     * coincide is a fact about today's call sites, not a contract, and
     * this is deliberately not a general scroll-on-focus rule. */
    reveal?: boolean;
  } | null>(null);
  // The one-at-a-time admission state, reported upward by each card.
  const [inlineEditorRouteIds, setInlineEditorRouteIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [busyTagSaveRouteIds, setBusyTagSaveRouteIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [dismissInlineEditorsToken, setDismissInlineEditorsToken] = useState(0);
  const manageTagsButtonRef = useRef<HTMLButtonElement>(null);
  const tagManagerSelectRef = useRef<HTMLSelectElement>(null);
  const tagManagerRenameButtonRef = useRef<HTMLButtonElement>(null);
  const tagManagerDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const tagManagerCloseButtonRef = useRef<HTMLButtonElement>(null);
  // Measured by the post-success reveal below; see its own comment.
  const tagManagerPanelRef = useRef<HTMLDivElement>(null);
  const tagManagerHeadingRef = useRef<HTMLHeadingElement>(null);
  // The armed confirmation and its Cancel action (backlog item 106).
  const tagManagerConfirmRef = useRef<HTMLDivElement>(null);
  const tagManagerConfirmCancelRef = useRef<HTMLButtonElement>(null);
  const [tagFiltersHydrated, setTagFiltersHydrated] = useState(false);
  // Backlog item 106. The filter chooser is a disclosure, collapsed on
  // every mount — deliberately NOT restored across a route-open/return
  // round trip the way the selections themselves are, so there is one
  // predictable starting state and no extra session ref. Active filters
  // stay visible while collapsed through the count and Clear row instead.
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
  const tagFilterLabelId = useId();
  const tagFilterPanelId = useId();
  const tagFilterCountIdPrefix = useId();
  const tagManagerPanelId = useId();
  const tagFilterDisclosureRef = useRef<HTMLButtonElement>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notices, setNotices] = useState<GpxImportNotice[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isSavingSortPreference, setIsSavingSortPreference] = useState(false);
  const [sortPreferenceError, setSortPreferenceError] = useState<string | null>(null);
  const [pinPendingIds, setPinPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [pinErrors, setPinErrors] = useState<Record<string, string>>({});
  // Tracks pendingRouteSwitch's own previous value so the delete-clearing
  // adjustment below (backlog item 73 follow-up) can detect a genuine
  // change during rendering, React's own documented alternative to an
  // effect for this — see that adjustment's own doc comment.
  const [previousPendingRouteSwitch, setPreviousPendingRouteSwitch] =
    useState(pendingRouteSwitch);

  const nameButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pinButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasAppliedScrollRestoreRef = useRef(false);
  const lastRenamedIdRef = useRef<string | null>(null);
  // The name handleRename actually wrote for lastRenamedIdRef, so the
  // consuming effect below can tell "routes hasn't reflected this rename
  // yet" apart from "nothing rename-related is happening" — see that
  // effect's own doc comment.
  const lastRenamedNameRef = useRef<string | null>(null);
  // Set on a successful pin/unpin, consumed by the focus-restoration effect
  // below. Accepted, narrow gap (same class as lastRenamedIdRef's own
  // documented one): pinning a second route before the first one's effect
  // has fired overwrites this marker, so the first route's move goes
  // focus-unrestored — sub-perceptible given how fast a local write+re-
  // render round-trips.
  const pendingPinFocusIdRef = useRef<string | null>(null);
  // Set on a successful tag save (backlog item 100 stage 3), consumed by
  // the disappearance focus-repair effect below — see handleTagsSave's
  // own doc comment for why the intent is set BEFORE the write starts,
  // not inside its .then().
  const lastTagsSaveIntentRef = useRef<{ id: string; tags: string[] } | null>(null);
  const clearTagFiltersButtonRef = useRef<HTMLButtonElement>(null);

  const groups = useMemo(
    () =>
      routes === undefined
        ? { pinned: [], unpinned: [] }
        : selectRouteLibraryGroups(routes, searchQuery, sortOrder, selectedTagFilters),
    [routes, searchQuery, sortOrder, selectedTagFilters],
  );
  const viewRoutes = useMemo(() => [...groups.pinned, ...groups.unpinned], [groups]);
  const previousViewRoutesRef = useRef<readonly PlannedRoute[]>(viewRoutes);

  // The reusable-tag suggestion corpus (backlog item 100 stage 2): derived
  // from the FULL, unfiltered live-query result, never from viewRoutes/
  // groups — a suggestion must remain available regardless of the current
  // search text, sort order, or pin state (negative control #1's target).
  // Reused unchanged as the tag-filter chip source (stage 3).
  const tagSuggestions = useMemo(() => collectTagSuggestions(routes ?? []), [routes]);

  const availableTagIdentityKeys = useMemo(
    () => new Set(tagSuggestions.map(tagIdentityKey)),
    [tagSuggestions],
  );

  // Prunes any previously-selected tag-filter identity key that no longer
  // names a real tag anywhere in the full route corpus — its last route
  // was untagged, retagged, or deleted (backlog item 100 stage 3).
  // Adjusted during rendering (React's own documented "adjust state when
  // a value changes" pattern — see this file's own pendingRouteSwitch/
  // previousPendingRouteSwitch adjustment below, and RouteListItem.tsx's
  // pendingSyncTags adjustment, for the same react-hooks/set-state-in-
  // effect reason), not inside a useEffect.
  //
  // Gated on tagFiltersHydrated && routes !== undefined: useLiveQuery
  // returns undefined until IndexedDB resolves, so tagSuggestions/
  // availableTagIdentityKeys are legitimately empty during that window —
  // pruning against an empty corpus before it's real would erase a
  // just-restored selection before routes has ever loaded. Both
  // conditions are read fresh every render, not cached, so pruning
  // engages the instant they're both true, whichever settles last.
  //
  // Deliberately a genuine removal from state, not a read-time filter
  // applied only where selectedTagFilters is consumed: masking would let
  // an identical spelling re-typed later in the SAME session silently
  // reactivate a filter the rider never re-selected.
  //
  // Self-terminating: pruning is itself a selectedTagFilters update, so
  // the very next render recomputes staleTagFilterKeys as [] — it only
  // fires again once a genuinely new identity goes stale, not on every
  // unrelated routes-changing render (a rename, a pin toggle) that would
  // otherwise misfire a reference-equality "did this change" check.
  // Backlog item 100 stage 4A moved the pruning above into
  // tagLifecycleReconciliation.ts, which now ALSO carries a pending global
  // rename's filter follow and the manager's own completion. They must
  // share one computation: two render-time blocks each deriving a next
  // selection from the same stale render scope would clobber one another,
  // and whichever ran second would win. Stage 3's own filter tests are the
  // behaviour-preserving safety net for that move.
  const tagLifecycle = reconcileTagLifecycle({
    selectedKeys: selectedTagFilters,
    availableKeys: availableTagIdentityKeys,
    availableTags: tagSuggestions,
    pending: pendingTagLifecycle,
    corpusReady: tagFiltersHydrated && routes !== undefined,
  });
  if (tagLifecycle.nextSelectedKeys) {
    setSelectedTagFilters(tagLifecycle.nextSelectedKeys);
  }
  // Both signals have landed, so the result can finally be reported using
  // the repository's own authoritative count rather than a pre-submit UI
  // count the corpus may already have invalidated.
  const settled = tagLifecycle.completed ? pendingTagLifecycle : null;
  if (settled !== null && settled.outcome.status === "applied") {
    setTagLifecycleStatus(
      describeTagLifecycleSuccess(
        settled.kind === "delete"
          ? { kind: "delete", sourceTag: settled.sourceSpelling }
          : {
              kind: "rename",
              sourceTag: settled.sourceSpelling,
              targetTag: settled.targetSpelling ?? settled.sourceSpelling,
              merged: settled.isMerge,
            },
        settled.outcome.sourceRouteCount,
      ),
    );
    setTagManagerNewName("");
    setTagManagerSourceKey(
      settled.kind === "rename" && settled.targetKey !== null ? settled.targetKey : "",
    );
    // Focus is only RECORDED here; performing it during rendering would
    // be a DOM side effect in the render phase. The post-commit effect
    // below carries it out, and only then closes a manager whose last tag
    // has just gone.
    // A monotonic id, produced with the updater form because a ref may not
    // be written during rendering (react-hooks/refs). It lets the effect
    // below consume each hand-off exactly once without needing a second
    // state update to clear it.
    const focusTarget = tagSuggestions.length === 0 ? "search" : "select";
    setPendingFocusHandoff((previous) => ({
      target: focusTarget,
      id: (previous?.id ?? 0) + 1,
      // Only when the panel survives the operation is there a panel top to
      // reveal; the final-tag case closes it below and hands focus to
      // Search instead, so it deliberately carries no reveal.
      reveal: focusTarget === "select",
    }));
    // Phase one of the final-tag transition: the panel is closed here, in
    // the same render pass, and phase two (the layout effect below)
    // focuses Search before the browser paints — so focus is never
    // observably lost even though the panel it was in has gone.
    if (focusTarget === "search") {
      setIsTagManagerOpen(false);
    }
  }
  if (tagLifecycle.clearPending) {
    setPendingTagLifecycle(null);
  }

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

  // Hydrates the selected tag filters from the session-lifetime ref
  // exactly once per mount (backlog item 100 stage 3), mirroring the
  // search-query hydration effect above — but, unlike search, also sets
  // an explicit tagFiltersHydrated completion flag. Scroll restoration
  // and the restoration-ref sync effect below both gate on this flag
  // directly, rather than relying on their declaration order relative to
  // this effect, so their correctness doesn't depend on an implicit
  // ordering assumption.
  useLayoutEffect(() => {
    if (restoreTagFilterKeysRef?.current && restoreTagFilterKeysRef.current.length > 0) {
      setSelectedTagFilters(new Set(restoreTagFilterKeysRef.current));
    }
    setTagFiltersHydrated(true);
  }, [restoreTagFilterKeysRef]);

  // Keeps the session-restoration ref in sync with selectedTagFilters from
  // whichever cause changed it — a toggle click, Clear, hydration itself,
  // or the render-phase stale-key pruning above — the last of which runs
  // during render, where writing restoreTagFilterKeysRef.current directly
  // would trip react-hooks/refs. A dedicated effect (unlike
  // handleSearchChange's inline write-through) is needed for that reason,
  // and is gated on tagFiltersHydrated so the initial, pre-hydration empty
  // selection can never overwrite a not-yet-consumed restoration ref.
  useEffect(() => {
    if (!tagFiltersHydrated) return;
    if (restoreTagFilterKeysRef) {
      restoreTagFilterKeysRef.current = [...selectedTagFilters];
    }
  }, [selectedTagFilters, restoreTagFilterKeysRef, tagFiltersHydrated]);

  useLayoutEffect(() => {
    if (hasAppliedScrollRestoreRef.current) return;
    if (!tagFiltersHydrated) return;
    if (routes === undefined || preferences === undefined) return; // still "Loading routes…"
    hasAppliedScrollRestoreRef.current = true;
    const restoreScrollY = restoreScrollYRef?.current ?? null;
    if (restoreScrollY != null && viewRoutes.length > 0) {
      window.scrollTo({ top: restoreScrollY, left: 0, behavior: "auto" });
    }
    if (restoreScrollYRef) {
      restoreScrollYRef.current = null;
    }
  }, [routes, preferences, viewRoutes, restoreScrollYRef, tagFiltersHydrated]);

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
  // A second, genuinely pre-existing defect (found by direct reading, not
  // just this file's own e2e suite): this effect's deps, [viewRoutes,
  // routes], fire it on *any* render where either changed while the
  // marker was set — not only the render caused by this rename's own
  // write landing. An unrelated viewRoutes/routes-changing render (a
  // different route's pin/unpin, a search-query change) arriving before
  // this rename's write lands used to null the marker anyway, so the
  // genuine orphaning correction — once the live query did catch up —
  // was silently skipped. lastRenamedNameRef (set by handleRename
  // alongside the id) is what closes this: the marker is only evaluated
  // and consumed once routes demonstrably reflects this rename's own
  // outcome — the route's name matches what was written, or the route no
  // longer exists — never on an unrelated re-render in between.
  useEffect(() => {
    // Hoisted once (backlog item 100 stage 3) so both the rename block
    // below and the tag-save block that follows it inspect the exact
    // same pre-change snapshot, and previousViewRoutesRef.current is
    // updated exactly once at the end — two independent effects with the
    // same [viewRoutes, routes] deps would each race to update this ref
    // first, corrupting the other's own "previous" comparison.
    const previous = previousViewRoutesRef.current;

    const renamedId = lastRenamedIdRef.current;
    if (renamedId) {
      const currentRoute = (routes ?? []).find((route) => route.id === renamedId);
      const outcomeKnown =
        !currentRoute || currentRoute.name === lastRenamedNameRef.current;
      if (outcomeKnown) {
        const wasVisible = previous.some((route) => route.id === renamedId);
        const stillVisible = viewRoutes.some((route) => route.id === renamedId);
        const stillExists = currentRoute !== undefined;
        if (wasVisible && !stillVisible && stillExists) {
          const focusTargetId = computeFocusRouteIdAfterDelete(previous, renamedId);
          const target = focusTargetId ? nameButtonRefs.current.get(focusTargetId) : null;
          (target ?? searchInputRef.current)?.focus();
        }
        lastRenamedIdRef.current = null;
        lastRenamedNameRef.current = null;
      }
    }

    // Tag-save-caused disappearance (backlog item 100 stage 3): a saved
    // tag change can newly fail the active tag filter (rarely, the active
    // search text too) and unmount the row mid-edit. An entirely separate
    // marker from lastRenamedIdRef/lastRenamedNameRef above, set only by
    // handleTagsSave — see its own doc comment for why the intent is set
    // BEFORE the write starts, as one atomic object, rather than inside
    // a .then().
    const tagsSaveIntent = lastTagsSaveIntentRef.current;
    if (tagsSaveIntent) {
      const currentRoute = (routes ?? []).find((route) => route.id === tagsSaveIntent.id);
      const outcomeKnown =
        !currentRoute || tagsEqualByIdentity(currentRoute.tags, tagsSaveIntent.tags);
      if (outcomeKnown) {
        const wasVisible = previous.some((route) => route.id === tagsSaveIntent.id);
        const stillVisible = viewRoutes.some((route) => route.id === tagsSaveIntent.id);
        const stillExists = currentRoute !== undefined;
        if (wasVisible && !stillVisible && stillExists) {
          const focusTargetId = computeFocusRouteIdAfterDelete(
            previous,
            tagsSaveIntent.id,
          );
          const target = focusTargetId ? nameButtonRefs.current.get(focusTargetId) : null;
          (
            target ??
            clearTagFiltersButtonRef.current ??
            tagFilterDisclosureRef.current ??
            searchInputRef.current
          )?.focus();
        }
        lastTagsSaveIntentRef.current = null;
      }
    }

    previousViewRoutesRef.current = viewRoutes;
  }, [viewRoutes, routes]);

  // Restores focus to a route's own pin toggle after a successful pin/
  // unpin. Necessary even though pinned and unpinned routes render as one
  // continuous, single-keyed `viewRoutes.map(renderCard)` list (so React's
  // own keyed reconciliation happily moves, rather than remounts, a card
  // that reorders within it — confirmed directly, in a real browser, by
  // this file's own e2e pinning suite): the pin toggle is `disabled` for
  // the duration of the write (to block a duplicate submission), and a
  // real browser automatically blurs a focused control the instant it
  // becomes disabled — a native DOM rule jsdom's own component tests
  // don't reproduce, which is why this was first suspected unnecessary.
  // A second, genuinely pre-existing defect (found via this file's own
  // e2e pinning suite failing in real Chromium, unrelated to the group-
  // heading removal itself) is that pinPendingIds clearing (which
  // re-enables the button) and the routes live query updating (which
  // reruns this effect) are two independent async updates with no
  // guaranteed order: this can run while the button is still disabled,
  // where an unconditional .focus() would silently no-op and the marker
  // would be lost with nothing left to retry it. Both this effect's own
  // pinPendingIds dependency and its disabled check below exist to close
  // that gap — the marker is only consumed once the button is genuinely
  // focusable, whichever of the two updates lands second.
  // A third, independently-timed input to that same disabled check —
  // RouteListItem's own `isPinPending || isDeleting` — went uncovered by
  // the two dependencies above until this fix: if this route's own pin
  // write settled while an *unrelated* route's delete was still in
  // flight, the button stayed disabled for a reason neither `groups` nor
  // `pinPendingIds` reflects, and once that unrelated delete's own
  // `isDeleting → false` transition later landed with no accompanying
  // `groups`/`pinPendingIds` change, this effect never re-ran and the
  // marker was stranded permanently. `isDeleting` is now a third
  // dependency, read the same indirect way as `pinPendingIds` — only via
  // `button.disabled`, never directly in the body — so the marker
  // retries on whichever of all three updates lands last.
  useEffect(() => {
    const targetId = pendingPinFocusIdRef.current;
    if (!targetId) return;
    const button = pinButtonRefs.current.get(targetId);
    if (!button || button.disabled) return;
    button.focus();
    pendingPinFocusIdRef.current = null;
  }, [groups, pinPendingIds, isDeleting]);

  // Cross-card coordination for backlog item 73 follow-up's inline switch
  // prompt, owned here because pendingDeleteId is owned here — a per-card
  // RouteListItem handler structurally cannot see another card's pending
  // delete. The instant a switch prompt appears (on any card, for any
  // reason), any open delete-confirmation anywhere in the list is cleared
  // — covering both the same-card and cross-card cases with one mechanism.
  //
  // Adjusted during rendering (React's own documented alternative to an
  // effect for "reset derived state when a prop changes": see
  // react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // not inside a useEffect — this project's react-hooks/set-state-in-effect
  // rule only exempts a ref-gated "consume once" shape, which this isn't
  // (pendingRouteSwitch is a prop, not a ref), and calling setState
  // directly in an effect body here would also cost an extra render pass.
  if (pendingRouteSwitch !== previousPendingRouteSwitch) {
    setPreviousPendingRouteSwitch(pendingRouteSwitch);
    if (pendingRouteSwitch && pendingDeleteId !== null) {
      setPendingDeleteId(null);
      setDeleteError(null);
    }
  }

  // Search/sort/pin/delete safety net for backlog item 73 follow-up: if
  // the pending switch's target route stops being visible in the current
  // (search-filtered) list — deleted entirely, or merely no longer
  // matching the search text — report it rather than leaving an invisible
  // actionable prompt or fabricating a card that doesn't match the query.
  useEffect(() => {
    if (!pendingRouteSwitch) return;
    const stillVisible = viewRoutes.some(
      (route) => route.id === pendingRouteSwitch.routeId,
    );
    if (!stillVisible) {
      pendingRouteSwitch.onTargetMissing(pendingRouteSwitch.routeId);
    }
  }, [pendingRouteSwitch, viewRoutes]);

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
    lastRenamedNameRef.current = name;
    renameRoute(id, name).catch((error: unknown) => {
      // A failed write's outcome can never become "known" to the
      // consuming effect above (routes will never reflect it), so the
      // marker must be cleared explicitly here rather than left to
      // strand — but only if it's still the one this call itself set, to
      // preserve the existing "second rename overwrites the marker"
      // behaviour documented on that effect.
      if (lastRenamedIdRef.current === id && lastRenamedNameRef.current === name) {
        lastRenamedIdRef.current = null;
        lastRenamedNameRef.current = null;
      }
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

  const handlePinToggle = (route: PlannedRoute) => {
    if (pinPendingIds.has(route.id)) return;
    setPinPendingIds((previous) => new Set(previous).add(route.id));
    setPinErrors((previous) => {
      if (!(route.id in previous)) return previous;
      return Object.fromEntries(
        Object.entries(previous).filter(([id]) => id !== route.id),
      );
    });
    const wasPinned = isPinnedRoute(route);
    const operation = wasPinned ? unpinRoute(route.id) : pinRoute(route.id, clock);
    operation
      .then(() => {
        setPinPendingIds((previous) => {
          const next = new Set(previous);
          next.delete(route.id);
          return next;
        });
        pendingPinFocusIdRef.current = route.id;
      })
      .catch((error: unknown) => {
        setPinPendingIds((previous) => {
          const next = new Set(previous);
          next.delete(route.id);
          return next;
        });
        setPinErrors((previous) => ({
          ...previous,
          [route.id]: wasPinned
            ? "This route could not be unpinned. Try again."
            : "This route could not be pinned. Try again.",
        }));
        logError("route-pin-toggle", error);
      });
  };

  // Thin wrapper around the stage-1 storage primitive: logs and rethrows
  // on failure (matching every other handler here), rethrowing so the
  // calling card's own local try/catch still sees the rejection and can
  // show its own generic recovery UI. Save-pending/error/draft state is
  // deliberately NOT lifted here — unlike pin, a tag change never
  // reorders or hides a card on its own, so RouteListItem's own local
  // state is sufficient for the EDITOR's own lifecycle (see
  // RouteListItem.tsx's own doc comments); this file only needs to know
  // about a save for its own, separate disappearance-focus-repair concern
  // (backlog item 100 stage 3, see the merged effect above).
  //
  // The focus-repair intent is set as one atomic object BEFORE
  // updateRouteTags is even called, never inside its .then() — setting it
  // only on success recreates the exact ordering race that broke item
  // 100 stage 2 (39e45fe -> 6f3e2d3): if the live query updates `routes`
  // before the write's .then() fires, the consuming effect's own trailing
  // `previousViewRoutesRef.current = viewRoutes` update already advances
  // past the change with no marker in place, and nothing re-triggers the
  // effect once one is finally set. Setting it eagerly (mirroring
  // handleRename's own working pattern exactly) means the consuming
  // effect works correctly regardless of which async signal — write
  // settlement or live-query update — arrives first.
  const handleTagsSave = (id: string, tags: readonly string[]): Promise<void> => {
    const intent = { id, tags: [...tags] };
    lastTagsSaveIntentRef.current = intent;
    return updateRouteTags(id, intent.tags).catch((error: unknown) => {
      // Guarded clear, mirroring handleRename's own: only clear if this
      // call's own intent is still the recorded one (identity comparison
      // via ===, not value comparison) — a later save for the same or a
      // different route may have already legitimately overwritten it.
      if (lastTagsSaveIntentRef.current === intent) {
        lastTagsSaveIntentRef.current = null;
      }
      logError("route-tags-save", error);
      throw error;
    });
  };

  const handleToggleTagFilter = (tag: string) => {
    const key = tagIdentityKey(tag);
    setSelectedTagFilters((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Backlog item 100 stage 4A. The manager's own tags/counts always come
  // from the FULL unfiltered corpus (tagSuggestions/routes), never from
  // viewRoutes: a tag hidden by the current search or filter must still be
  // manageable, with its true route count.
  const routeCountsByTagKey = useMemo(
    () => countRoutesByTagIdentity(routes ?? []),
    [routes],
  );

  // Backlog item 111, and deliberately NOT the memo above. These are
  // prospective counts: for each unselected tag, how many routes would
  // remain if it were added to the current selection — so they are scoped
  // to the active name search and the already-selected tag identities,
  // where the manager's counts are unconditionally whole-corpus. The two
  // answer different questions and must never be substituted for one
  // another.
  //
  // Computed unconditionally rather than gated on isTagFilterOpen: the
  // work is one pass over the current result set, and deriving it only
  // while open would make "collapse, change something, reopen" a cache
  // question it has no reason to be. `routes` is the live query, so an
  // import, delete, rename, retag or global tag-lifecycle operation
  // recomputes this for free.
  const prospectiveTagFilterCounts = useMemo(
    () => selectProspectiveTagFilterCounts(routes ?? [], searchQuery, selectedTagFilters),
    [routes, searchQuery, selectedTagFilters],
  );

  // How wide the chip's count slot has to be reserved — see
  // tagFilterCountSlotDigits for why this is derived from the corpus size
  // rather than from the largest count currently on screen.
  const tagFilterCountDigits = tagFilterCountSlotDigits(routes?.length ?? 0);
  // React's CSSProperties carries no index signature for custom
  // properties, so this is typed through an explicit intersection rather
  // than forced with a cast — this project keeps unchecked casts out of
  // typed boundaries.
  const tagFilterCountSlotStyle: CSSProperties & Record<`--${string}`, string> = {
    "--tag-filter-count-digits": String(tagFilterCountDigits),
  };
  // Derived, never stored-and-reconciled, and used for BEHAVIOUR — the
  // disabled state, the preview and confirmation copy, the target
  // resolution, and the operation handed to storage. A <select> whose
  // value matches no option silently shows the first one, so deriving only
  // the rendered value would leave every other path acting on a stale key
  // and could arm a destructive action against the wrong tag.
  const effectiveTagManagerSourceKey = resolveEffectiveSourceKey(
    tagSuggestions,
    tagManagerSourceKey,
  );

  // Resets the manager's transient messages whenever it is opened or
  // closed, so a stale success or error can never outlive its operation.
  const closeTagManager = () => {
    if (isTagLifecycleBusyRef.current) return;
    setIsTagManagerOpen(false);
    setTagLifecycleConfirm(null);
    setTagLifecycleError(null);
    setTagManagerNewName("");
    setTagManagerSourceKey("");
    (manageTagsButtonRef.current ?? headingRef.current)?.focus();
  };

  // The admission check for opening the manager. A busy tag save, a
  // running delete, or a BUSY switch prompt each refuse outright: the
  // manager stays shut and the in-flight interaction is left completely
  // untouched, with a visible reason rather than a silent no-op. An idle
  // switch prompt or delete confirmation is cancelled instead, following
  // handleDeleteRequest's own established preamble.
  const handleOpenTagManager = () => {
    if (isTagManagerOpen) {
      closeTagManager();
      return;
    }
    if (busyTagSaveRouteIds.size > 0) {
      setTagManagerHint("Finish saving that route's tags first, then manage tags.");
      return;
    }
    if (isDeleting) {
      setTagManagerHint("Wait for the route deletion to finish, then manage tags.");
      return;
    }
    if (pendingRouteSwitch?.busy) {
      setTagManagerHint("Wait for the ride switch to finish, then manage tags.");
      return;
    }
    if (pendingRouteSwitch) {
      pendingRouteSwitch.onCancel();
    }
    if (pendingDeleteId !== null) {
      setPendingDeleteId(null);
      setDeleteError(null);
    }
    setTagManagerHint(null);
    setTagLifecycleStatus(null);
    setTagLifecycleError(null);
    setDismissInlineEditorsToken((token) => token + 1);
    // Only now, past every refusal above: a refused open must leave the
    // filter chooser exactly as it was (item 106).
    setIsTagFilterOpen(false);
    setIsTagManagerOpen(true);
  };

  // The reverse admission check, asked synchronously by a card BEFORE it
  // opens an inline editor — never as a notification afterwards, which
  // would allow a frame with both interactions on screen.
  const requestInlineEditorOpen = useCallback(() => {
    if (isTagLifecycleBusyRef.current) return false;
    setIsTagManagerOpen(false);
    setTagLifecycleConfirm(null);
    return true;
  }, []);

  const handleInlineEditorOpenChange = useCallback((routeId: string, isOpen: boolean) => {
    setInlineEditorRouteIds((previous) => {
      if (previous.has(routeId) === isOpen) return previous;
      const next = new Set(previous);
      if (isOpen) next.add(routeId);
      else next.delete(routeId);
      return next;
    });
  }, []);

  const handleTagsSaveBusyChange = useCallback((routeId: string, isBusy: boolean) => {
    setBusyTagSaveRouteIds((previous) => {
      if (previous.has(routeId) === isBusy) return previous;
      const next = new Set(previous);
      if (isBusy) next.add(routeId);
      else next.delete(routeId);
      return next;
    });
  }, []);

  const runTagLifecycle = (
    operation: RouteTagLifecycleOperation,
    marker: PendingTagLifecycle,
  ) => {
    // Synchronous guard, checked and set before React can re-render —
    // a state value alone cannot stop two invocations landing in one
    // batch (RouteListItem's own isSavingTagsRef precedent).
    if (isTagLifecycleBusyRef.current) return;
    isTagLifecycleBusyRef.current = true;
    setIsTagLifecycleBusy(true);
    setTagLifecycleError(null);
    setTagLifecycleStatus(null);
    setTagManagerHint(null);
    setPendingTagLifecycle(marker);

    // Reference-identity guarded, exactly like handleTagsSave's own
    // `lastTagsSaveIntentRef.current === intent` clear: a later operation
    // may legitimately have replaced this marker already.
    const abandonMarker = () => {
      setPendingTagLifecycle((current) => (current === marker ? null : current));
    };

    applyRouteTagLifecycle(operation)
      .then((outcome) => {
        isTagLifecycleBusyRef.current = false;
        setIsTagLifecycleBusy(false);
        setTagLifecycleConfirm(null);
        if (outcome.status === "invalid-target") {
          abandonMarker();
          setTagLifecycleError("Enter a new name for this tag.");
          return;
        }
        // The write signal. The corpus signal is awaited separately, in
        // the render-time reconciliation above — a zero-write outcome
        // settles there immediately, because the corpus will never change
        // again and waiting for it would hang on "Applying…" forever.
        setPendingTagLifecycle((current) =>
          current === marker
            ? {
                ...marker,
                outcome: {
                  status: "applied",
                  sourceRouteCount: outcome.sourceRouteCount,
                  writtenRouteCount: outcome.writtenRouteCount,
                },
              }
            : current,
        );
      })
      .catch((error: unknown) => {
        isTagLifecycleBusyRef.current = false;
        setIsTagLifecycleBusy(false);
        setTagLifecycleConfirm(null);
        // The transaction aborted, so the corpus is untouched and the
        // active tag filters must stay exactly as they were.
        abandonMarker();
        setTagLifecycleError(
          operation.kind === "rename"
            ? "That tag could not be renamed. Try again."
            : "That tag could not be deleted. Try again.",
        );
        requestManagerFocus(operation.kind === "rename" ? "rename" : "delete");
        logError("route-tag-lifecycle", error);
      });
  };

  const buildTagLifecycleMarker = (
    operation: RouteTagLifecycleOperation,
    sourceSpelling: string,
    isMerge: boolean,
  ): PendingTagLifecycle => ({
    kind: operation.kind,
    sourceKey: tagIdentityKey(operation.sourceKey),
    sourceSpelling,
    targetKey:
      operation.kind === "rename" ? tagIdentityKey(operation.targetSpelling) : null,
    targetSpelling: operation.kind === "rename" ? operation.targetSpelling : null,
    isMerge,
    outcome: { status: "pending" },
  });

  const handleTagRenameRequest = () => {
    const sourceKey = effectiveTagManagerSourceKey;
    const sourceSpelling = findTagSpelling(tagSuggestions, sourceKey);
    if (sourceSpelling === null) return;
    const { targetSpelling, isMerge } = resolveTagLifecycleTarget(
      tagSuggestions,
      sourceKey,
      tagManagerNewName,
    );
    if (targetSpelling === null) {
      // Deliberately submitted rather than blocked behind a disabled
      // button: this is a real, reachable message instead of dead code.
      setTagLifecycleError("Enter a new name for this tag.");
      return;
    }
    const operation: RouteTagLifecycleOperation = {
      kind: "rename",
      sourceKey,
      targetSpelling,
    };
    if (!isMerge) {
      runTagLifecycle(
        operation,
        buildTagLifecycleMarker(operation, sourceSpelling, false),
      );
      return;
    }
    // A rename must never silently become a merge, so the collision is
    // detected here and routed to an explicit confirmation instead.
    setTagLifecycleConfirm({
      operation,
      copy: describeMergeConfirmation(
        sourceSpelling,
        targetSpelling,
        routeCountsByTagKey.get(sourceKey) ?? 0,
      ),
    });
  };

  const handleTagDeleteRequest = () => {
    const sourceKey = effectiveTagManagerSourceKey;
    const sourceSpelling = findTagSpelling(tagSuggestions, sourceKey);
    if (sourceSpelling === null) return;
    setTagLifecycleConfirm({
      operation: { kind: "delete", sourceKey },
      copy: describeDeleteConfirmation(
        sourceSpelling,
        routeCountsByTagKey.get(sourceKey) ?? 0,
      ),
    });
  };

  const handleTagLifecycleConfirm = () => {
    if (!tagLifecycleConfirm) return;
    const { operation } = tagLifecycleConfirm;
    const sourceSpelling =
      findTagSpelling(tagSuggestions, tagIdentityKey(operation.sourceKey)) ??
      operation.sourceKey;
    runTagLifecycle(
      operation,
      buildTagLifecycleMarker(operation, sourceSpelling, operation.kind === "rename"),
    );
  };

  const handleTagLifecycleCancelConfirm = () => {
    if (isTagLifecycleBusyRef.current) return;
    const wasDelete = tagLifecycleConfirm?.operation.kind === "delete";
    setTagLifecycleConfirm(null);
    requestManagerFocus(wasDelete ? "delete" : "rename");
  };

  // Performs the completion focus hand-off AFTER commit — never during
  // the render-time adjustment above, which must stay free of DOM side
  // effects. Ref-gated "consume once" via a single combined boolean, the
  // one shape this project's react-hooks/set-state-in-effect rule exempts.
  //
  // Order matters for the final-tag case: Search is focused FIRST and only
  // then is the manager closed, so focus is never destroyed by the panel
  // unmounting under it. The panel deliberately stays mounted (its render
  // condition is isTagManagerOpen, not tagSuggestions.length > 0) until
  // this runs, which is what makes the live-query-first ordering safe —
  // the corpus can empty before the write promise settles.
  const handledFocusHandoffIdRef = useRef(0);
  useLayoutEffect(() => {
    // Assigned only on the one reveal branch below, and returned as this
    // effect's cleanup so a pending settle loop can never outlive the
    // commit that started it (or the component).
    let cancelSettledReveal: (() => void) | null = null;
    const cleanUp = () => {
      cancelSettledReveal?.();
    };
    // The marker is read and consumed INSIDE the effect, never during
    // rendering, and this effect performs no setState — the same shape as
    // this file's own pendingPinFocusIdRef effect.
    if (pendingFocusHandoff === null) return cleanUp;
    if (pendingFocusHandoff.id === handledFocusHandoffIdRef.current) return cleanUp;
    handledFocusHandoffIdRef.current = pendingFocusHandoff.id;
    if (pendingFocusHandoff.target === "search") {
      searchInputRef.current?.focus();
      return cleanUp;
    }
    if (pendingFocusHandoff.target === "rename") {
      tagManagerRenameButtonRef.current?.focus();
      return cleanUp;
    }
    if (pendingFocusHandoff.target === "delete") {
      tagManagerDeleteButtonRef.current?.focus();
      return cleanUp;
    }
    if (!pendingFocusHandoff.reveal) {
      tagManagerSelectRef.current?.focus();
      return cleanUp;
    }
    // Backlog item 105's one reveal transition. preventScroll suppresses
    // the browser's own "scroll nearest into view" for the newly focused
    // select — which knows nothing of the sticky header, and would
    // otherwise compete with (and could override) the deliberate scroll
    // below. The focus TARGET is unchanged from 0.4.19.
    //
    // Backlog item 106: focus stays immediate, but the measurement and
    // scroll now wait for runWhenViewportSettled. This effect no longer
    // claims to measure "settled post-operation geometry" synchronously —
    // it cannot. A rename or merge is typed into the New name field, so
    // this path is just as exposed to an in-flight keyboard dismissal (and
    // to a confirmation's own end-aligned scroll still animating) as the
    // card close is. Everything is re-measured inside the callback.
    tagManagerSelectRef.current?.focus({ preventScroll: true });
    cancelSettledReveal = runWhenViewportSettled(() => {
      const panelEl = tagManagerPanelRef.current;
      const headingEl = tagManagerHeadingRef.current;
      if (!panelEl || !headingEl) return;
      applyTopRevealScroll(
        {
          top: panelEl.getBoundingClientRect().top,
          bottom: headingEl.getBoundingClientRect().bottom,
        },
        stickyHeaderRef?.current?.getBoundingClientRect().bottom ?? 0,
      );
    });
    return cleanUp;
  }, [pendingFocusHandoff, stickyHeaderRef]);

  // Backlog item 106. An armed Merge/Delete confirmation is appended
  // beneath the manager's action row, so on a long library it can land
  // below the fold and the press looks like it did nothing. Unlike the
  // panel-top reveal above, this is a whole card whose ACTIONS matter
  // most, so it reuses item 95's established confirmation-card priority —
  // isCardAlreadyFullyVisible plus an end-aligned scrollIntoView — rather
  // than the top-prioritising delta path, which would happily leave the
  // buttons off-screen. Focus is immediate and the scroll alone waits, so
  // an open alertdialog is never left focused on its now-disabled trigger.
  useLayoutEffect(() => {
    let cancelConfirmReveal: (() => void) | null = null;
    if (tagLifecycleConfirm !== null) {
      tagManagerConfirmCancelRef.current?.focus({ preventScroll: true });
      cancelConfirmReveal = runWhenViewportSettled(() => {
        const confirmEl = tagManagerConfirmRef.current;
        if (!confirmEl) return;
        const confirmRect = confirmEl.getBoundingClientRect();
        const headerBottom =
          stickyHeaderRef?.current?.getBoundingClientRect().bottom ?? 0;
        const bottomCushion =
          parseFloat(getComputedStyle(confirmEl).scrollMarginBottom) || 0;
        const visualViewport = window.visualViewport;
        const visibleTop = visualViewport?.offsetTop ?? 0;
        const visibleBottom = visualViewport
          ? visualViewport.offsetTop + visualViewport.height
          : window.innerHeight;
        if (
          isCardAlreadyFullyVisible(
            confirmRect,
            headerBottom,
            bottomCushion,
            visibleTop,
            visibleBottom,
          )
        ) {
          return;
        }
        confirmEl.scrollIntoView({
          block: "end",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      });
    }
    return () => {
      cancelConfirmReveal?.();
    };
  }, [tagLifecycleConfirm, stickyHeaderRef]);

  // Every manager focus move goes through the hand-off above rather than
  // calling .focus() inline. The confirmation disables the Rename/Delete
  // buttons while it is open, and a real browser (like jsdom here) simply
  // ignores .focus() on a disabled element — so focusing in the same
  // handler that clears the confirmation silently dropped focus to
  // <body>, because the button is still disabled until React re-renders.
  const requestManagerFocus = (target: "select" | "search" | "rename" | "delete") => {
    setPendingFocusHandoff((previous) => ({ target, id: (previous?.id ?? 0) + 1 }));
  };

  // Focuses the Filter by tags disclosure rather than the old label span,
  // which no longer exists — and which would in any case be the wrong
  // target now that Clear can be pressed from the collapsed summary row,
  // where the expanded panel is not on screen at all (item 106).
  const handleClearTagFilters = () => {
    setSelectedTagFilters(new Set());
    tagFilterDisclosureRef.current?.focus();
  };

  // The filter chooser's own admission check, mirroring
  // handleOpenTagManager's below. Only a genuinely BUSY lifecycle
  // operation refuses; an idle manager — including one showing an armed
  // but non-busy confirmation — is simply closed, and that close is
  // deliberately NOT closeTagManager(), which focuses the Manage tags
  // button and would steal focus from the disclosure just activated.
  const handleToggleTagFilters = () => {
    if (isTagFilterOpen) {
      setIsTagFilterOpen(false);
      return;
    }
    if (isTagLifecycleBusyRef.current) {
      setTagManagerHint("Wait for the tag update to finish, then filter by tags.");
      return;
    }
    setTagManagerHint(null);
    setIsTagManagerOpen(false);
    setTagLifecycleConfirm(null);
    setTagLifecycleError(null);
    setTagManagerNewName("");
    setTagManagerSourceKey("");
    setIsTagFilterOpen(true);
  };

  const handleDeleteRequest = (id: string) => {
    if (isDeleting) return;
    if (pendingRouteSwitch) {
      // Busy (clearing/returning): don't interrupt an in-flight switch
      // action — let it settle rather than racing a cancel against it.
      if (pendingRouteSwitch.busy) return;
      pendingRouteSwitch.onCancel();
    }
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
  // Named distinctly from handleDeleteConfirm's own local hasActiveQuery
  // above (an unrelated, differently-scoped delete-focus-fallback flag)
  // to avoid a same-named-but-different-purpose variable in this file.
  const hasActiveNameQuery = trimmedQuery.length > 0;
  const hasActiveTagFilters = selectedTagFilters.size > 0;

  const renderCard = (route: LibraryRoute) => (
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
      isPinned={isPinnedRoute(route)}
      isPinPending={pinPendingIds.has(route.id)}
      pinError={pinErrors[route.id] ?? null}
      onPinToggle={handlePinToggle}
      tagSuggestions={tagSuggestions}
      onTagsSave={handleTagsSave}
      nameButtonRef={(element) => {
        if (element) {
          nameButtonRefs.current.set(route.id, element);
        } else {
          nameButtonRefs.current.delete(route.id);
        }
      }}
      pinButtonRef={(element) => {
        if (element) {
          pinButtonRefs.current.set(route.id, element);
        } else {
          pinButtonRefs.current.delete(route.id);
        }
      }}
      switchPrompt={pendingRouteSwitch?.routeId === route.id ? pendingRouteSwitch : null}
      stickyHeaderRef={stickyHeaderRef}
      onInlineEditorOpenChange={handleInlineEditorOpenChange}
      onTagsSaveBusyChange={handleTagsSaveBusyChange}
      dismissInlineEditorsToken={dismissInlineEditorsToken}
      requestInlineEditorOpen={requestInlineEditorOpen}
    />
  );

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
              <option value="distance-desc">Longest route</option>
              <option value="ascent-desc">Most total ascent</option>
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

      {/* Backlog item 106: the tag controls are their own full-width
          section, no longer four unrelated siblings inside the toolbar's
          generic centred .row — which left "Manage tags" floating beside
          the much taller filter block instead of aligning with anything.
          Both controls are now peer disclosures, and only one of their
          panels may be open at a time. */}
      {routes !== undefined && routes.length > 0 && tagSuggestions.length > 0 ? (
        <div className="tag-controls stack">
          <div className="row tag-controls-actions">
            <button
              type="button"
              className="btn-secondary tag-disclosure"
              id={tagFilterLabelId}
              ref={tagFilterDisclosureRef}
              aria-expanded={isTagFilterOpen}
              aria-controls={isTagFilterOpen ? tagFilterPanelId : undefined}
              onClick={handleToggleTagFilters}
            >
              Filter by tags
              <span aria-hidden="true" className="tag-disclosure-chevron">
                ▾
              </span>
            </button>
            <button
              type="button"
              className="btn-secondary tag-disclosure"
              ref={manageTagsButtonRef}
              aria-expanded={isTagManagerOpen}
              aria-controls={isTagManagerOpen ? tagManagerPanelId : undefined}
              onClick={handleOpenTagManager}
            >
              Manage tags
              <span aria-hidden="true" className="tag-disclosure-chevron">
                ▾
              </span>
            </button>
          </div>
          {/* Collapsed filtering must never be invisible filtering: the
              count and a real Clear action stay on screen. Exactly one
              Clear ever renders — this one, or the expanded panel's. */}
          {!isTagFilterOpen && hasActiveTagFilters ? (
            <div className="row tag-controls-summary">
              <p className="field-hint">
                {describeActiveTagFilterCount(selectedTagFilters.size)}
              </p>
              <button
                type="button"
                className="btn-secondary"
                ref={clearTagFiltersButtonRef}
                onClick={handleClearTagFilters}
              >
                Clear tag filters
              </button>
            </div>
          ) : null}
          {/* Chips are not rendered at all while collapsed, rather than
              hidden — nothing unreachable is ever left in the tab order. */}
          {isTagFilterOpen ? (
            <div id={tagFilterPanelId} className="stack">
              <div
                className="tag-filters"
                role="group"
                aria-labelledby={tagFilterLabelId}
                /* The project's first inline CSS custom property, and
                   deliberately so: the slot width depends on how many
                   routes are saved, which is data no static class can
                   know. Set once on the group and inherited by every
                   chip. */
                style={tagFilterCountSlotStyle}
              >
                {tagSuggestions.map((tag, index) => {
                  const key = tagIdentityKey(tag);
                  const isSelected = selectedTagFilters.has(key);
                  // Absent means zero: the chips come from the full
                  // unfiltered corpus while the counts come from the
                  // narrowed result set, so a candidate that survives
                  // nowhere simply has no entry.
                  const count = prospectiveTagFilterCounts.get(key) ?? 0;
                  const isUnavailable = !isSelected && count === 0;
                  // Indexed, never keyed by tag identity: an identity key
                  // may contain spaces, and aria-describedby is a
                  // space-separated list of ID references.
                  const descriptionId = `${tagFilterCountIdPrefix}-${String(index)}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`tag-filter-chip${isSelected ? " is-selected" : ""}${
                        isUnavailable ? " is-unavailable" : ""
                      }`}
                      aria-pressed={isSelected}
                      // Never the native `disabled` attribute. A chip can
                      // become unavailable while it holds focus — a live
                      // corpus update, or simply typing in the search
                      // field — and a browser refuses .focus() on a
                      // disabled element while jsdom never reproduces the
                      // resulting blur. aria-disabled leaves the chip
                      // focusable and in the tab order, so focus is
                      // neither stranded nor silently lost, and no focus
                      // hand-off is needed: the chip just stays focused.
                      aria-disabled={isUnavailable ? true : undefined}
                      aria-describedby={isSelected ? undefined : descriptionId}
                      onClick={() => {
                        // aria-disabled does not prevent activation on
                        // its own; this is what makes it a no-op, for
                        // pointer, Enter and Space alike (a native button
                        // synthesises click for both keys).
                        if (isUnavailable) return;
                        handleToggleTagFilter(tag);
                      }}
                      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                        // Belt and braces over the click guard above, and
                        // it earns its place for Space specifically:
                        // without preventDefault the page would still
                        // scroll on a chip that does nothing.
                        if (!isUnavailable) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                        }
                      }}
                    >
                      <span aria-hidden="true" className="tag-filter-check">
                        {isSelected ? "✓" : ""}
                      </span>
                      <span className="tag-filter-label">{tag}</span>
                      {/* aria-hidden so the chip's accessible name stays
                          the tag itself — voice control and this
                          project's own name-exact queries both depend on
                          that. The number reaches assistive technology
                          through the description below instead. */}
                      {isSelected ? null : (
                        <span aria-hidden="true" className="tag-filter-count">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Outside every button, so none of this joins a chip's
                  accessible name. .visually-hidden is position: absolute,
                  so this wrapper is neither a flex nor a grid item and
                  adds no layout of its own. */}
              <div className="visually-hidden">
                {tagSuggestions.map((tag, index) => {
                  const key = tagIdentityKey(tag);
                  if (selectedTagFilters.has(key)) return null;
                  return (
                    <span key={key} id={`${tagFilterCountIdPrefix}-${String(index)}`}>
                      {describeProspectiveTagFilterCount(
                        prospectiveTagFilterCounts.get(key) ?? 0,
                      )}
                    </span>
                  );
                })}
              </div>
              {hasActiveTagFilters ? (
                <button
                  type="button"
                  className="btn-secondary"
                  ref={clearTagFiltersButtonRef}
                  onClick={handleClearTagFilters}
                >
                  Clear tag filters
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tagManagerHint ? <p role="status">{tagManagerHint}</p> : null}
      {/* The success message lives here, outside the panel, so it survives
          the manager closing after a final-tag deletion. */}
      {tagLifecycleStatus ? <p role="status">{tagLifecycleStatus}</p> : null}

      {/* Rendered only once no card has an inline interaction open, so the
          manager and a card editor are never on screen together: opening
          the manager bumps the dismissal token, the cards close on the
          next commit, and the panel appears after that. Its own condition
          is isTagManagerOpen alone — NOT tagSuggestions.length > 0 — so a
          final-tag deletion can complete and hand focus on before the
          panel goes. */}
      {isTagManagerOpen && inlineEditorRouteIds.size === 0 ? (
        <RouteTagManager
          panelId={tagManagerPanelId}
          tags={tagSuggestions}
          routeCountsByTagKey={routeCountsByTagKey}
          sourceKey={effectiveTagManagerSourceKey}
          newName={tagManagerNewName}
          isBusy={isTagLifecycleBusy}
          errorMessage={tagLifecycleError}
          confirmation={tagLifecycleConfirm?.copy ?? null}
          onSourceKeyChange={(key) => {
            setTagManagerSourceKey(key);
            setTagLifecycleError(null);
            setTagLifecycleStatus(null);
          }}
          onNewNameChange={(value) => {
            setTagManagerNewName(value);
            setTagLifecycleError(null);
          }}
          onRenameRequest={handleTagRenameRequest}
          onDeleteRequest={handleTagDeleteRequest}
          onConfirm={handleTagLifecycleConfirm}
          onCancelConfirm={handleTagLifecycleCancelConfirm}
          onClose={closeTagManager}
          selectRef={tagManagerSelectRef}
          renameButtonRef={tagManagerRenameButtonRef}
          deleteButtonRef={tagManagerDeleteButtonRef}
          closeButtonRef={tagManagerCloseButtonRef}
          panelRef={tagManagerPanelRef}
          headingRef={tagManagerHeadingRef}
          confirmRef={tagManagerConfirmRef}
          confirmCancelButtonRef={tagManagerConfirmCancelRef}
        />
      ) : null}

      {routes === undefined || preferences === undefined ? (
        <p>Loading routes…</p>
      ) : routes.length === 0 ? (
        <p>No routes saved yet. Import a GPX file to get started.</p>
      ) : viewRoutes.length === 0 ? (
        <p role="status">
          {hasActiveNameQuery && hasActiveTagFilters
            ? `No routes match “${trimmedQuery}” and the selected tags.`
            : hasActiveTagFilters
              ? "No routes match the selected tags."
              : `No routes match “${trimmedQuery}”.`}
        </p>
      ) : (
        <ul className="route-list">{viewRoutes.map(renderCard)}</ul>
      )}
    </section>
  );
}
