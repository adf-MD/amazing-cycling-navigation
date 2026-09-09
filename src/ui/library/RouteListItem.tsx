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
import { applyTopRevealScroll } from "./routeCardTopReveal.ts";
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
  /** Reports whether this card currently has an inline interaction on
   * screen — a rename editor, a tag editor, or its delete confirmation —
   * so RouteLibrary can enforce the one-at-a-time contract with the
   * global tag manager (backlog item 100 stage 4A). Always reported false
   * on unmount: a stale route id left registered would permanently
   * prevent the manager from ever appearing. */
  onInlineEditorOpenChange?: (routeId: string, isOpen: boolean) => void;
  /** Reports whether a tag save is in flight for this card, INCLUDING the
   * post-write window where the editor is still waiting for the live
   * query to reflect it. RouteLibrary refuses to open the tag manager
   * while any such save is running, rather than interrupting it. Also
   * always reported false on unmount, for the same reason as above. */
  onTagsSaveBusyChange?: (routeId: string, isBusy: boolean) => void;
  /** Bumped by RouteLibrary when the global tag manager opens: this card
   * dismisses any idle inline interaction it has open. A card whose tag
   * save is in flight deliberately ignores it — RouteLibrary has already
   * refused to open the manager in that case, so the token can never
   * arrive mid-save. */
  dismissInlineEditorsToken?: number;
  /** Synchronous admission check, asked BEFORE an inline editor opens:
   * false while a global tag lifecycle operation is applying, in which
   * case the editor does not open at all. Asking after the fact would
   * allow one frame with both interactions on screen. */
  requestInlineEditorOpen?: () => boolean;
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
  onInlineEditorOpenChange,
  onTagsSaveBusyChange,
  dismissInlineEditorsToken,
  requestInlineEditorOpen,
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
  // Marks a close the user asked for EXPLICITLY, which is what the
  // close/focus effect below reveals the card's top for. Three things can
  // close this editor and only two of them set this:
  //   - a successful save (backlog item 100's 0.4.18 follow-up) — set in
  //     the render-time handshake block that also closes the editor;
  //   - an explicit Cancel or Escape (backlog item 105) — set in
  //     handleCancelTags, which both route through;
  //   - a manager-driven dismissal (dismissInlineEditorsToken), which
  //     deliberately does NOT set it: the user's attention is moving to
  //     the global tag manager, so the page must not jump to a card
  //     instead. That path keeps the plain focus() it has always had.
  // Never inferred merely from isEditingTags becoming false, which all
  // three trigger. Reset on every openTagEditor() open, mirroring that
  // function's other defensive resets — the reset is what stops one
  // session's signal reaching the next session's dismissal. Cancel/Escape
  // cannot race with the save: both no-op while isSavingTagsRef/
  // isSavingTags are true, which stay true for the entire window from
  // handleSaveTags's start until the success block below runs.
  const [revealCardOnClose, setRevealCardOnClose] = useState(false);
  const headingId = useId();
  const descriptionId = useId();
  const nameFieldId = useId();
  const tagInputId = useId();
  const tagsHeadingId = useId();
  const cardRef = useRef<HTMLLIElement>(null);
  // The reappearing ordinary-card title row, measured (alongside cardRef)
  // by the successful-save reveal below — see its own doc comment.
  const titleRowRef = useRef<HTMLDivElement>(null);
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
  // editor's own open/close transitions. An explicitly requested close
  // (revealCardOnClose: a successful save, or Cancel/Escape) additionally
  // reveals the card's own top/title below the sticky header — a plain
  // focus() only ever guarantees the BUTTON'S visibility via the browser's
  // own "scroll nearest into view" algorithm, which has no notion of the
  // sticky header's overlap or of the title several rows above the button
  // on a card grown tall from many tags. Backlog item 100's 0.4.18
  // follow-up shipped this for the save alone; item 105 extends it to
  // Cancel/Escape, after the installed-iPhone field test found a card
  // whose top could be left out of view. A manager-driven dismissal leaves
  // the signal false and keeps the plain focus() — see revealCardOnClose.
  useEffect(() => {
    if (isEditingTags) {
      tagInputRef.current?.focus();
    } else if (wasEditingTagsRef.current) {
      if (revealCardOnClose) {
        // preventScroll suppresses the browser's own competing scroll, so
        // exactly one deliberate scroll (below) ever runs for this close.
        tagsButtonRef.current?.focus({ preventScroll: true });
        const cardEl = cardRef.current;
        const titleRowEl = titleRowRef.current;
        if (cardEl && titleRowEl) {
          applyTopRevealScroll(
            {
              top: cardEl.getBoundingClientRect().top,
              bottom: titleRowEl.getBoundingClientRect().bottom,
            },
            stickyHeaderRef?.current?.getBoundingClientRect().bottom ?? 0,
          );
        }
      } else {
        tagsButtonRef.current?.focus();
      }
    }
    wasEditingTagsRef.current = isEditingTags;
  }, [isEditingTags, revealCardOnClose, stickyHeaderRef]);

  // Reports this card's inline-interaction state upward so RouteLibrary
  // can enforce the one-at-a-time contract with the global tag manager
  // (backlog item 100 stage 4A). The cleanup deliberately reports `false`
  // rather than merely dropping the subscription: a card can unmount at
  // any moment — filtered out by a search or tag change, or deleted — and
  // a stale route id left registered would leave the manager permanently
  // unable to appear, since its own render condition requires the set to
  // be empty.
  const isInlineEditorOpen = isRenaming || isEditingTags || isDeletePending;
  useEffect(() => {
    if (!onInlineEditorOpenChange) return;
    const routeId = route.id;
    onInlineEditorOpenChange(routeId, isInlineEditorOpen);
    return () => {
      onInlineEditorOpenChange(routeId, false);
    };
  }, [onInlineEditorOpenChange, route.id, isInlineEditorOpen]);

  // The same contract for an in-flight tag save, which RouteLibrary
  // refuses to interrupt rather than dismissing. isSavingTags stays true
  // across the whole write plus the live-query handshake that follows it,
  // which is exactly the window that must not be disturbed.
  useEffect(() => {
    if (!onTagsSaveBusyChange) return;
    const routeId = route.id;
    onTagsSaveBusyChange(routeId, isSavingTags);
    return () => {
      onTagsSaveBusyChange(routeId, false);
    };
  }, [onTagsSaveBusyChange, route.id, isSavingTags]);

  // Consumes RouteLibrary's dismissal token when the global tag manager
  // opens. Written as React's own "adjust state during render" pattern
  // against a state mirror of the token, following this file's own
  // pendingSyncTags precedent and RouteLibrary's
  // pendingRouteSwitch/previousPendingRouteSwitch one — not as an effect,
  // which this project's react-hooks/set-state-in-effect rule only
  // exempts for a ref-gated "consume once" shape. Self-terminating: the
  // mirror update is itself one of the condition's own inputs.
  const [previousDismissToken, setPreviousDismissToken] = useState(
    dismissInlineEditorsToken,
  );
  if (dismissInlineEditorsToken !== previousDismissToken) {
    setPreviousDismissToken(dismissInlineEditorsToken);
    // isSavingTags (state) rather than isSavingTagsRef: a ref may not be
    // read during rendering. It is sufficient here because RouteLibrary
    // already refuses to open the manager at all while any tag save is in
    // flight, so this token cannot arrive mid-save; this is the card's own
    // belt-and-braces check. The pending delete confirmation needs no
    // handling here either — it is RouteLibrary's own state, and
    // handleOpenTagManager clears it before bumping the token.
    if (!isSavingTags) {
      setIsRenaming(false);
      setIsEditingTags(false);
    }
  }

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
    setRevealCardOnClose(true);
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
    if (requestInlineEditorOpen && !requestInlineEditorOpen()) return;
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
    if (requestInlineEditorOpen && !requestInlineEditorOpen()) return;
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
    // Unlike pendingSyncTags above, THIS reset is very much reachable: a
    // prior successful save or Cancel leaves revealCardOnClose true, and
    // without clearing it here a later manager-driven dismissal of this
    // new editing session — which must never scroll — would inherit the
    // signal and spuriously reveal the card.
    setRevealCardOnClose(false);
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
    // Batched with the close below, so the effect above observes both in
    // the same commit. Set here rather than inferred from isEditingTags
    // going false, which a manager-driven dismissal also does.
    setRevealCardOnClose(true);
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
          <div className="route-card-title-row" ref={titleRowRef}>
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
