import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, RefObject, SubmitEvent } from "react";
import type { LibraryRoute, PlannedRoute } from "../../domain/types.ts";
import {
  normalizeRouteTags,
  resolveTagSpelling,
  sortTagsForDisplay,
  tagIdentityKey,
  tagsEqualByIdentity,
} from "../../domain/routeTags.ts";
import { prefersReducedMotion } from "../../platform/environmentContext.ts";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";
import { PinIcon } from "./PinIcon.tsx";
import { isCardAlreadyFullyVisible } from "./routeSwitchCardVisibility.ts";

/** The inline, route-card-scoped presentation of backlog item 73's
 * unfinished-session switch guard (item 73 follow-up) — a ready-made view
 * model plus every handler this card needs, bundled together so a
 * non-null value is always fully actionable. App.tsx computes every field;
 * this component only renders it. `confirmVariant` is "danger" only for
 * the destructive End-and-switch/Discard-and-continue family of statuses.
 * Cancel is always secondary-styled and Return is always primary-styled
 * (positive/green, backlog item 95) — neither is ever destructive. */
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
  route: LibraryRoute;
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
  /** Every tag currently used by any saved route (backlog item 100 stage
   * 2), deduplicated by identity and sorted for display — always derived
   * from RouteLibrary's full, unfiltered route list, never the current
   * search/sort/pin view. */
  tagSuggestions: readonly string[];
  /** Persists this route's tag collection. Resolves once the write has
   * settled; rejects (after RouteLibrary has already logged the failure)
   * so this card can show its own generic recovery UI. */
  onTagsSave: (id: string, tags: readonly string[]) => Promise<void>;
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
  /** App's own sticky top-navigation element (backlog item 95) — read only
   * to measure its live rendered height when deciding whether the switch
   * prompt needs to scroll into view; this card never writes to it. */
  stickyHeaderRef?: RefObject<HTMLElement | null>;
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
  tagSuggestions,
  onTagsSave,
  nameButtonRef,
  pinButtonRef,
  switchPrompt,
  stickyHeaderRef,
}: RouteListItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(route.name);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState<string[]>(() => [...route.tags]);
  const [newTagInput, setNewTagInput] = useState("");
  // Drives only the visible disabled/"Saving…" UI — never the correctness
  // guard itself (see isSavingTagsRef below and the doc comment on
  // handleSaveTags).
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [tagsSaveError, setTagsSaveError] = useState<string | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const wasRenamingRef = useRef(false);
  const tagsButtonRef = useRef<HTMLButtonElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const wasEditingTagsRef = useRef(false);
  // The synchronous, render-timing-independent guard for Save/Cancel/
  // Escape: a ref mutation is immediate, unlike a useState update (which
  // is batched/deferred), so this is safe even against two invocations
  // landing before React has re-rendered the disabled state at all.
  const isSavingTagsRef = useRef(false);
  // The write's own "settled" signal, held in STATE rather than a ref —
  // deliberately, unlike isSavingTagsRef above. Two independent async
  // events must both be observed before the editor closes: the write
  // promise settling, and route.tags (via the live query) demonstrably
  // reflecting it BY IDENTITY (see the effect below). Either can arrive
  // first. A ref here would only become visible the next time something
  // ELSE causes a re-render — if the live-query notification wins the
  // race (route.tags updates first), a mere ref set once the write later
  // settles triggers no re-render and no effect re-run, so the editor
  // would then never close. This was a real production race: CI failed
  // at the same boundary in both the chromium and android-chrome
  // Playwright projects during run 226 (item 100 stage 2, commit
  // 39e45fe). useState makes this a second genuine reactive signal,
  // symmetric with route.tags, so whichever of the two arrives second is
  // what closes the editor — including the successful-no-op-save case,
  // where route.tags may never change again at all.
  const [pendingSyncTags, setPendingSyncTags] = useState<string[] | null>(null);
  const headingId = useId();
  const descriptionId = useId();
  const nameFieldId = useId();
  const tagInputId = useId();
  const tagsHeadingId = useId();
  const cardRef = useRef<HTMLLIElement>(null);
  const switchHeadingId = useId();
  const switchDescriptionId = useId();
  // Tracks the last message this card scrolled for, so a later status
  // change within the SAME pending switch (e.g. conflict -> clear-failed
  // surfacing a longer error) re-checks scroll visibility too, not only
  // the initial open — a failure can grow the panel's height enough to
  // push its own buttons back below the fold.
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

  // Mirrors the isRenaming focus effect immediately above, for the tag
  // editor's own open/close transitions.
  useEffect(() => {
    if (isEditingTags) {
      tagInputRef.current?.focus();
    } else if (wasEditingTagsRef.current) {
      tagsButtonRef.current?.focus();
    }
    wasEditingTagsRef.current = isEditingTags;
  }, [isEditingTags]);

  // Closes the tag editor only once BOTH of two independent async facts
  // are established: the write settled (pendingSyncTags is set) and
  // route.tags (via the live query) demonstrably reflects it BY IDENTITY
  // — never a display-string/reference comparison, and never merely on
  // write-promise-resolution alone, so the editor can never close onto
  // stale chips. Either signal can arrive first; whichever becomes true
  // second is what closes the editor.
  //
  // Adjusted during rendering (React's own documented alternative to an
  // effect for "reset derived state when a prop changes": see
  // react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // and RouteLibrary.tsx's/RidingScreen.tsx's identical convention), not
  // inside a useEffect — this project's react-hooks/set-state-in-effect
  // rule only exempts a ref-gated "consume once" shape, which this isn't:
  // pendingSyncTags is deliberately state, not a ref, precisely so that
  // setting it is itself a re-render (see its own doc comment above for
  // the real production race, item 100 stage 2 CI run 226, a plain ref
  // here caused). Self-terminating with no separate "previous value"
  // mirror needed: clearing pendingSyncTags is itself one of this
  // condition's own inputs, so it becomes false the instant it's
  // actioned, with no risk of a repeat/infinite loop. Mirrors
  // RouteLibrary.tsx's own lastRenamedIdRef/lastRenamedNameRef "wait
  // until the live query demonstrably reflects an async local write"
  // precedent, generalised here to a genuine two-signal handshake.
  // isSavingTagsRef itself is reset separately below (refs cannot be
  // written during render), not here.
  if (pendingSyncTags !== null && tagsEqualByIdentity(route.tags, pendingSyncTags)) {
    setPendingSyncTags(null);
    setIsSavingTags(false);
    setIsEditingTags(false);
  }

  // The other half of isSavingTagsRef's reset on the success path above
  // (its failure-path reset in handleSaveTags's own .catch() already runs
  // in a plain callback, not during render, so it's unaffected by this).
  // A ref mutation, not a setState call, so react-hooks/set-state-in-effect
  // doesn't apply here; only react-hooks/refs' "not during render" rule
  // does, satisfied by doing it in an effect instead.
  useEffect(() => {
    if (!isSavingTags) {
      isSavingTagsRef.current = false;
    }
  }, [isSavingTags]);

  // Re-checks scroll visibility whenever this card's switch prompt first
  // appears, or its message text changes (a later status transition within
  // the same pending switch, e.g. a failure surfacing new error text).
  // Targets the outer route card (cardRef), not merely the nested prompt
  // panel: a "nearest"-only scroll of the panel alone can leave the card's
  // own top hidden under the sticky header, or its bottom below the
  // visible viewport, without ever correcting for either (backlog item
  // 95). Skips scrolling entirely when the card is already fully visible
  // between the sticky header and the visible viewport bottom (proven by
  // isCardAlreadyFullyVisible), and otherwise end-aligns so the card's own
  // bottom — where the prompt's actions live — is prioritised over its
  // top when the card is too tall to show both at once.
  useEffect(() => {
    if (!switchPrompt) {
      lastSwitchMessageRef.current = null;
      return;
    }
    // Busy (non-actionable) progress text — e.g. "Opening your paused
    // ride…"/"Ending your current ride…" — is skipped without recording it
    // as the last-seen message, so lastSwitchMessageRef keeps holding the
    // last ACTIONABLE text throughout the busy interval. This both avoids
    // an avoidable extra scroll moments before the screen navigates away,
    // and re-arms correctly once a genuinely new actionable message (e.g.
    // a failure) follows a busy status (item 95 follow-up).
    if (switchPrompt.busy) {
      return;
    }
    if (switchPrompt.message === lastSwitchMessageRef.current) {
      return;
    }
    lastSwitchMessageRef.current = switchPrompt.message;
    const cardEl = cardRef.current;
    if (!cardEl) return;
    const cardRect = cardEl.getBoundingClientRect();
    const headerBottom = stickyHeaderRef?.current?.getBoundingClientRect().bottom ?? 0;
    const bottomCushion = parseFloat(getComputedStyle(cardEl).scrollMarginBottom) || 0;
    const visualViewport = window.visualViewport;
    const visibleTop = visualViewport?.offsetTop ?? 0;
    const visibleBottom = visualViewport
      ? visualViewport.offsetTop + visualViewport.height
      : window.innerHeight;
    if (
      isCardAlreadyFullyVisible(
        cardRect,
        headerBottom,
        bottomCushion,
        visibleTop,
        visibleBottom,
      )
    ) {
      return;
    }
    cardEl.scrollIntoView({
      block: "end",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [switchPrompt, stickyHeaderRef]);

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

  // Mirrors openRename's cancel-pending-delete/cancel-switch-prompt
  // preamble, with one deliberate strengthening: a busy, non-interruptible
  // switch (see RouteLibrary.tsx's handleDeleteRequest, the only existing
  // site with this exact guard) must never be silently interrupted by
  // opening the tag editor.
  const openTagEditor = () => {
    if (isDeletePending) {
      onDeleteCancel(route.id);
    }
    if (switchPrompt) {
      if (switchPrompt.busy) return;
      switchPrompt.onCancel();
    }
    setTagDraft([...route.tags]);
    setNewTagInput("");
    setTagsSaveError(null);
    isSavingTagsRef.current = false;
    setIsSavingTags(false);
    // Defensive, not reachable in practice: pendingSyncTags is only ever
    // non-null while isEditingTags is true, and the closing effect always
    // clears both in the same update, so this button (rendered only
    // while isEditingTags is false) can never fire while a sync is still
    // pending.
    setPendingSyncTags(null);
    setIsEditingTags(true);
  };

  // Every draft membership/duplicate check below compares tags by
  // tagIdentityKey, never by direct display-string equality — so a route
  // whose own stored tag is "gravel" while the established suggestion
  // spelling is "Gravel" is recognised as the same tag.
  const handleAddTag = (event: SubmitEvent) => {
    event.preventDefault();
    const resolved = resolveTagSpelling(newTagInput, tagSuggestions);
    if (resolved === null) return;
    setNewTagInput("");
    const key = tagIdentityKey(resolved);
    setTagDraft((previous) =>
      previous.some((tag) => tagIdentityKey(tag) === key)
        ? previous
        : [...previous, resolved],
    );
  };

  const handleToggleSuggestion = (tag: string) => {
    const key = tagIdentityKey(tag);
    setTagDraft((previous) => {
      const isSelected = previous.some((draftTag) => tagIdentityKey(draftTag) === key);
      return isSelected
        ? previous.filter((draftTag) => tagIdentityKey(draftTag) !== key)
        : [...previous, tag];
    });
  };

  const handleCancelTags = () => {
    if (isSavingTagsRef.current) return;
    setIsEditingTags(false);
  };

  const handleTagsEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      handleCancelTags();
    }
  };

  // Guarded synchronously via isSavingTagsRef (immediate, unlike
  // useState) rather than the isSavingTags state value, so two
  // invocations landing before React has re-rendered the disabled state
  // at all still result in exactly one write. Success does not close the
  // editor directly — see the route.tags/pendingSyncTags sync effect
  // above, which is what actually closes it once both the write has
  // settled and the live query demonstrably reflects this save, so the
  // editor never closes onto stale chips.
  const handleSaveTags = () => {
    if (isSavingTagsRef.current) return;
    isSavingTagsRef.current = true;
    setIsSavingTags(true);
    setTagsSaveError(null);
    const tagsToSave = [...tagDraft];
    onTagsSave(route.id, tagsToSave)
      .then(() => {
        setPendingSyncTags(tagsToSave);
      })
      .catch(() => {
        isSavingTagsRef.current = false;
        setIsSavingTags(false);
        setTagsSaveError("This route's tags could not be saved. Try again.");
      });
  };

  return (
    <li
      className={`route-card stack${switchPrompt ? " route-card--switch-pending" : ""}`}
      data-route-id={route.id}
      ref={cardRef}
    >
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
      ) : isEditingTags ? (
        <div className="tag-editor stack" onKeyDown={handleTagsEditorKeyDown}>
          <h2 id={tagsHeadingId}>{route.name}</h2>
          <p className="route-card-meta">
            {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
          </p>
          <form className="row" onSubmit={handleAddTag}>
            <div className="route-library-field">
              <label htmlFor={tagInputId}>Add a tag</label>
              <input
                id={tagInputId}
                ref={tagInputRef}
                className="field-input"
                value={newTagInput}
                disabled={isSavingTags}
                onChange={(event) => {
                  setNewTagInput(event.target.value);
                }}
              />
            </div>
            <button type="submit" className="btn-secondary" disabled={isSavingTags}>
              Add tag
            </button>
          </form>
          <div className="tag-suggestions" role="group" aria-label="Tag suggestions">
            {sortTagsForDisplay(normalizeRouteTags([...tagSuggestions, ...tagDraft])).map(
              (tag) => {
                const key = tagIdentityKey(tag);
                const isSelected = tagDraft.some(
                  (draftTag) => tagIdentityKey(draftTag) === key,
                );
                return (
                  <button
                    key={key}
                    type="button"
                    className={`tag-suggestion${isSelected ? " is-selected" : ""}`}
                    aria-pressed={isSelected}
                    disabled={isSavingTags}
                    onClick={() => {
                      handleToggleSuggestion(tag);
                    }}
                  >
                    <span aria-hidden="true" className="tag-suggestion-check">
                      {isSelected ? "✓" : ""}
                    </span>
                    {tag}
                  </button>
                );
              },
            )}
          </div>
          {isSavingTags ? <p role="status">Saving…</p> : null}
          {tagsSaveError ? (
            <p role="alert" className="field-error">
              {tagsSaveError}
            </p>
          ) : null}
          <div className="row">
            <button
              type="button"
              className="btn-primary"
              disabled={isSavingTags}
              onClick={handleSaveTags}
            >
              Save tags
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isSavingTags}
              onClick={handleCancelTags}
            >
              Cancel
            </button>
          </div>
        </div>
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
          {route.tags.length > 0 ? (
            <ul className="route-card-tags" aria-label="Tags">
              {route.tags.map((tag) => (
                <li key={tag} className="route-card-tag">
                  {tag}
                </li>
              ))}
            </ul>
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
              ref={tagsButtonRef}
              onClick={openTagEditor}
            >
              {route.tags.length > 0 ? "Edit tags" : "Add tags"}
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
                {switchPrompt.offerReturn ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={switchPrompt.busy}
                    onClick={switchPrompt.onReturn}
                  >
                    Return to paused ride
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary"
                  autoFocus
                  disabled={switchPrompt.busy}
                  onClick={switchPrompt.onCancel}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}
