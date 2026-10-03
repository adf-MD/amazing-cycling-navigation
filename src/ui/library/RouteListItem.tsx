import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject, SubmitEvent } from "react";
import type { LibraryRoute, PlannedRoute } from "../../domain/types.ts";
import {
  normalizeRouteTags,
  resolveTagSpelling,
  sortTagsForDisplay,
  tagIdentityKey,
  tagsEqualByIdentity,
} from "../../domain/routeTags.ts";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";
import { useTranslate } from "../../i18n/useTranslate.ts";
import { PinIcon } from "./PinIcon.tsx";
import { runWhenViewportSettled } from "../shared/viewportSettle.ts";
import { applyTopRevealScroll } from "./routeCardTopReveal.ts";
import { isCardAlreadyFullyVisible } from "./routeSwitchCardVisibility.ts";
import { applyConfirmationReveal } from "../shared/confirmationRevealScroll.ts";
import {
  armOperationInteractionGuard,
  type OperationInteractionGuard,
} from "../shared/operationInteractionGuard.ts";
import type { RouteDeletion } from "./routeDeletion.ts";

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

/** What a card knows as it leaves the list (backlog item 124, D-02),
 * reported from its own layout-effect cleanup — which React runs while the
 * card is still connected, before its element is removed, so focus inside it
 * is still observable there and nowhere later. RouteLibrary decides whether
 * the removal was a successful deletion; filtering, navigation and ordinary
 * remounts report too and are ignored there. */
export interface RouteCardRemovalReport {
  /** Focus was inside the card, never merely on `<body>`. */
  focusInside: boolean;
  /** The card's confirmed deletion attempt still had the rider waiting at
   * it (operationInteractionGuard.ts). */
  guardArmed: boolean;
}

export interface RouteListItemProps {
  route: LibraryRoute;
  onOpen: (route: PlannedRoute) => void;
  onRename: (id: string, name: string) => void;
  onExport: (route: PlannedRoute) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteCancel: (id: string) => void;
  /** Starts the confirmed deletion and returns its attempt number, or null
   * when it was refused (another deletion is busy) and nothing started. */
  onDeleteConfirm: (id: string) => number | null;
  /** This card's delete confirmation is open — unconfirmed, or showing this
   * card's confirmed deletion below. */
  isDeletePending: boolean;
  /** A confirmed deletion is busy somewhere in the list, which disables
   * every card's pin toggle. */
  isDeleting: boolean;
  /** This card's own confirmed deletion (backlog item 124, D-02), or null.
   * Owned by App (routeDeletion.ts), so it survives this card — and the
   * whole Routes screen — unmounting and remounting. */
  deletion: RouteDeletion | null;
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
  /** Called once as this card leaves the list, for any reason — see
   * RouteCardRemovalReport. Must be a stable reference: a new identity
   * would re-run the reporting effect and report a removal that did not
   * happen. */
  onCardRemoved?: (routeId: string, report: RouteCardRemovalReport) => void;
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
  deletion,
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
  onCardRemoved,
}: RouteListItemProps) {
  const translator = useTranslate();
  const { t } = translator;
  // Backlog item 113 stage 2. The pin control's accessible name used to be
  // a verb fragment glued to the route name (`${isPinned ? "Unpin" :
  // "Pin"} ${route.name}`). Each state is now a whole message carrying the
  // name as a parameter, so a translation can put the verb wherever its
  // grammar needs it. The rider's own route name is interpolated verbatim
  // — including any braces it happens to contain, which the message
  // formatter treats as ordinary text rather than placeholder syntax.
  const pinActionLabel = isPinned
    ? t("routes.card.unpin", { name: route.name })
    : t("routes.card.pin", { name: route.name });
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
  const deleteConfirmRef = useRef<HTMLDivElement>(null);
  const deleteActionsRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  // Backlog item 124, D-02. The confirmation's own title, focusable by
  // script only, where focus waits while a confirmed deletion runs.
  const deleteTitleRef = useRef<HTMLHeadingElement>(null);
  const deleteErrorId = useId();
  // The interaction guard of this card's latest confirmed deletion attempt,
  // tied to that attempt's number. Detached once its failure is decided,
  // when a newer attempt replaces it, and when this card unmounts — so a
  // card that leaves the list and comes back (a filter, a return to Routes)
  // has no guard, and never takes focus for an attempt it did not see.
  const deleteAttemptGuardRef = useRef<{
    attempt: number;
    guard: OperationInteractionGuard;
  } | null>(null);
  // Only a confirmed deletion still running, or committed and awaiting the
  // live list, is busy; a failed one leaves the card usable again.
  const isOwnDeletionBusy = deletion !== null && deletion.phase !== "failed";
  const isDeletionFailed = deletion?.phase === "failed";
  // Set only by Cancel/Escape (handleCancelDelete), never inferred from
  // isDeletePending going false, which a rename, pin, tag editor, switch
  // prompt or tag manager also does — and consumed on every transition, so
  // no request can survive into a later, unrelated close.
  const revealDeleteTriggerOnCloseRef = useRef(false);
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
  //
  // Backlog item 106: focus is restored IMMEDIATELY, but the measurement
  // and scroll wait for runWhenViewportSettled. Measuring in this effect
  // directly reads geometry that can still be mid-transition — while iOS
  // Safari dismisses the software keyboard it un-pans the layout viewport
  // and restores scroll, asynchronously and after React's effects have
  // run, and applyTopRevealScroll derives its effective top boundary from
  // visualViewport.offsetTop, so a delta computed then is applied against
  // the state that follows it. Everything is re-measured inside the
  // settled callback; nothing is captured here, or the wait would achieve
  // nothing.
  //
  // To be precise about what this does and does not fix: the overshoot
  // actually reproduced for item 106 was a different mechanism entirely —
  // the browser jumping to the top when the focused Cancel button was
  // unmounted mid-event — and handleCancelTags below is what prevents
  // that. This wait addresses a real but separately demonstrated
  // vulnerability (proved only against stubbed changing-viewport
  // geometry), never reproduced on a device.
  useEffect(() => {
    let cancelSettledReveal: (() => void) | null = null;
    if (isEditingTags) {
      tagInputRef.current?.focus();
    } else if (wasEditingTagsRef.current) {
      if (revealCardOnClose) {
        // preventScroll suppresses the browser's own competing scroll, so
        // exactly one deliberate scroll (below) ever runs for this close.
        tagsButtonRef.current?.focus({ preventScroll: true });
        cancelSettledReveal = runWhenViewportSettled(() => {
          const cardEl = cardRef.current;
          const titleRowEl = titleRowRef.current;
          if (!cardEl || !titleRowEl) return;
          applyTopRevealScroll(
            {
              top: cardEl.getBoundingClientRect().top,
              bottom: titleRowEl.getBoundingClientRect().bottom,
            },
            stickyHeaderRef?.current?.getBoundingClientRect().bottom ?? 0,
          );
        });
      } else {
        tagsButtonRef.current?.focus();
      }
    }
    wasEditingTagsRef.current = isEditingTags;
    return () => {
      cancelSettledReveal?.();
    };
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
  //
  // SAFETY INVARIANT (item 95 correction): once this prompt's actions are
  // available to activate, they must not still be moving because of the
  // prompt's own reveal scroll. `End and switch`, `Return to paused ride`
  // and `Cancel` sit one row apart and have very different, irreversible
  // consequences, so a control that drifts under a finger already
  // travelling towards it can end a ride the rider meant to resume. A CI
  // trace proved exactly that: a pointer aimed at `Return to paused ride`
  // landed on `End and switch` because the reveal was still animating.
  //
  // Two things enforce it together, and neither is sufficient alone:
  //
  // - useLayoutEffect, not useEffect. A passive effect runs AFTER paint,
  //   so the actions could be painted — and hit-testable — at one
  //   position and then moved. This runs after DOM layout but before the
  //   browser paints the prompt, so the first frame the rider can see or
  //   touch is already the settled one.
  // - behavior: "auto" unconditionally, not just under reduced motion. A
  //   smooth scroll keeps moving the actions for hundreds of milliseconds
  //   after they are interactive, which is the hazard itself. There is no
  //   `scroll-behavior` declaration anywhere in index.css, so "auto" is
  //   genuinely immediate rather than being re-animated by CSS. The minor
  //   animation is deliberately traded away for stable controls.
  useLayoutEffect(() => {
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
    cardEl.scrollIntoView({ block: "end", behavior: "auto" });
  }, [switchPrompt, stickyHeaderRef]);

  // The delete confirmation's own reveal and focus return (backlog item
  // 124). Opening: Cancel takes focus with preventScroll — replacing the
  // plain autoFocus, whose browser focus scroll centres the button and so
  // moves the page further than the rule allows — and the confirmation is
  // then revealed under item 118's rule: no movement when it fits between
  // the sticky header and the safe area, otherwise only enough to show all
  // of it, and when it cannot fit, only enough to show its complete
  // Cancel/Delete route row (none when that row already shows).
  //
  // Opening means a genuine false-to-true transition while this card is
  // mounted (backlog item 124, D-02). A card that MOUNTS with its
  // confirmation already open takes no focus and scrolls nothing: it was not
  // opened, it reappeared. That is only ever a confirmed deletion's
  // confirmation, running or failed, when a filter brings the card back or
  // the rider returns to Routes — item 124's slice 3 (D-03) closes an
  // unconfirmed one that filtering hides, and leaving Routes closes it too.
  // Before D-02 the mount ran the opening, as autoFocus had, and so took
  // focus from the search field for a failed deletion's returning card. The
  // previous value is a ref initialised to the mount value, so Strict Mode's
  // repeated mount effect sees no transition either.
  //
  // Closing after Cancel/Escape: focus has already returned to Delete,
  // without scrolling, in handleCancelDelete — before the focused Cancel is
  // destroyed. Here, after the collapse has committed (so any clamping of
  // the shorter document has already happened), the page moves only as far
  // as reveals that button, and not at all when it is visible: the rider's
  // current position, including scrolling done while it was open, is kept
  // and the pre-opening position is never restored. Only while Delete
  // still has focus, so nothing scrolls once the rider has moved on.
  //
  // Keyed on the primitive isDeletePending, so it runs on its transitions
  // only — never on an unrelated re-render — and a reopening re-measures.
  // A layout effect with an instant scroll: item 95's interaction-safety
  // pair, so the actions should not still be moving once they can be
  // touched.
  const wasDeletePendingRef = useRef(isDeletePending);
  useLayoutEffect(() => {
    const wasDeletePending = wasDeletePendingRef.current;
    wasDeletePendingRef.current = isDeletePending;
    const headerBottom = stickyHeaderRef?.current?.getBoundingClientRect().bottom ?? 0;
    if (isDeletePending) {
      if (wasDeletePending) return;
      revealDeleteTriggerOnCloseRef.current = false;
      deleteCancelRef.current?.focus({ preventScroll: true });
      const insetEl = deleteConfirmRef.current;
      if (insetEl) {
        applyConfirmationReveal(insetEl, headerBottom, deleteActionsRef.current);
      }
      return;
    }
    if (!revealDeleteTriggerOnCloseRef.current) return;
    revealDeleteTriggerOnCloseRef.current = false;
    const trigger = deleteButtonRef.current;
    if (!trigger || document.activeElement !== trigger) return;
    applyConfirmationReveal(trigger, headerBottom);
  }, [isDeletePending, stickyHeaderRef]);

  // A confirmed deletion's failure (backlog item 124, D-02, the rider's
  // decision of 2 October 2026): decided once, by the card that confirmed
  // it, when this mounted card sees its record become failed for a new
  // attempt — after "Deleting…", or straight from the open confirmation when
  // an immediate fault lands in the same commit as the press, or after a
  // retry. A card that mounts already failed (a filter returning it, a
  // return to Routes) decides nothing: its guard went with the card that
  // confirmed, and the previous-record ref starts at the mount value.
  //
  // Still waiting means this attempt's guard is still armed — no tap or click
  // outside the card, no key but Escape, no wheel or touch scroll — and
  // focus is inside the card: on the title it was parked on, on the card
  // after a tap on its text, or on a now re-enabled action. `<body>` never
  // counts. Then Cancel takes focus without the browser's own focus scroll —
  // the safe action beside a destructive retry, and the one an opening
  // focuses — and the grown confirmation is revealed by the minimum under
  // item 118's rule, its complete action row taking priority when it cannot
  // fit (as at 200% text). Otherwise nothing moves, and the message stays in
  // the confirmation as an alert, named by its aria-describedby. The guard
  // is detached either way.
  //
  // A layout effect with an instant scroll, so the reveal lands before the
  // re-enabled actions are painted (item 95's pair).
  const previousDeletionRef = useRef(deletion);
  useLayoutEffect(() => {
    const previous = previousDeletionRef.current;
    previousDeletionRef.current = deletion;
    if (deletion?.phase !== "failed") return;
    if (previous?.phase === "failed" && previous.attempt === deletion.attempt) return;
    const owned = deleteAttemptGuardRef.current;
    if (owned?.attempt !== deletion.attempt) return;
    deleteAttemptGuardRef.current = null;
    const card = cardRef.current;
    const focused = document.activeElement;
    const isStillWaiting =
      owned.guard.armed &&
      card !== null &&
      focused !== null &&
      focused !== document.body &&
      card.contains(focused);
    owned.guard.detach();
    if (!isStillWaiting) return;
    deleteCancelRef.current?.focus({ preventScroll: true });
    const insetEl = deleteConfirmRef.current;
    if (insetEl) {
      applyConfirmationReveal(
        insetEl,
        stickyHeaderRef?.current?.getBoundingClientRect().bottom ?? 0,
        deleteActionsRef.current,
      );
    }
  }, [deletion, stickyHeaderRef]);

  // Reports this card leaving the list (backlog item 124, D-02) — see
  // RouteCardRemovalReport — and detaches any deletion guard it still holds.
  // React runs a removed component's layout-effect cleanup while its element
  // is still connected, before removing it, so focus inside the card is
  // still observable here: measured in Chromium and WebKit during D-02's
  // investigation (React 19.2), and held by this file's own tests rather
  // than assumed. Keyed on stable values only, so it runs on unmount and
  // never on an ordinary re-render, which would detach a guard mid-attempt.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const attemptGuardRef = deleteAttemptGuardRef;
    const routeId = route.id;
    return () => {
      const owned = attemptGuardRef.current;
      attemptGuardRef.current = null;
      const focused = document.activeElement;
      const focusInside =
        card !== null &&
        focused !== null &&
        focused !== document.body &&
        card.contains(focused);
      onCardRemoved?.(routeId, { focusInside, guardArmed: owned?.guard.armed ?? false });
      owned?.guard.detach();
    };
  }, [route.id, onCardRemoved]);

  const openRename = () => {
    // Backlog item 124, D-02: every action on a card whose deletion is
    // running is refused, here as well as by its disabled button.
    if (isOwnDeletionBusy) return;
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
    // Escape can bypass the disabled Cancel, so this refuses while the
    // confirmed deletion runs.
    if (isOwnDeletionBusy) return;
    // Focus returns synchronously, before the focused Cancel is destroyed,
    // but without the browser's own focus scroll: the layout effect above
    // makes the only, minimal, correction once the collapse has committed.
    deleteButtonRef.current?.focus({ preventScroll: true });
    revealDeleteTriggerOnCloseRef.current = true;
    onDeleteCancel(route.id);
  };

  // Mirrors openRename's own "cancel a pending delete confirmation (and
  // switch prompt) first" precedent above, so an open confirmation never
  // gets silently moved into a different group instead of being resolved.
  const handlePinClick = () => {
    if (isDeleting || isOwnDeletionBusy) return;
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
    if (isOwnDeletionBusy) return;
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
    // Move focus to the card itself FIRST, synchronously, before the
    // editor unmounts (backlog item 106). Cancel/Escape close the editor
    // inside the very event that the focused Cancel button is handling, so
    // that button is destroyed while it still holds focus; the browser
    // then falls back to <body> and scrolls the document to the top. That
    // is the reported "scrolls farther up than necessary, leaving
    // avoidable content above the card" — measured in Chromium as a jump
    // from scrollY 339 straight to 0, with no scroll API call involved.
    // A successful Save never showed it because its close is asynchronous
    // (the write/live-query handshake), so nothing is unmounted while
    // focused. The card element survives the close, so focusing it keeps
    // focus inside the document and the jump never happens; the close
    // effect above then moves focus on to the Edit tags button.
    cardRef.current?.focus({ preventScroll: true });
    // Batched with the close below, so the effect above observes both in
    // the same commit. Set here rather than inferred from isEditingTags
    // going false, which a manager-driven dismissal also does.
    setRevealCardOnClose(true);
    setIsEditingTags(false);
  };

  // Backlog item 124, D-02. Once the deletion is admitted, focus waits on the
  // confirmation's own title, without the browser's focus scroll, before the
  // busy render disables both actions: Chromium drops a focused button that
  // becomes disabled to <body>, and from the title a refused Escape still
  // reaches the confirmation. Then this attempt arms its own interaction
  // guard over the whole card (operationInteractionGuard.ts), which the
  // failure decision above reads. A refused press — another deletion busy —
  // parks nothing and arms nothing.
  const handleConfirmDelete = () => {
    const attempt = onDeleteConfirm(route.id);
    if (attempt === null) return;
    deleteTitleRef.current?.focus({ preventScroll: true });
    deleteAttemptGuardRef.current?.guard.detach();
    deleteAttemptGuardRef.current = {
      attempt,
      guard: armOperationInteractionGuard(() => cardRef.current),
    };
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
        setTagsSaveError(t("routes.error.saveTags"));
      });
  };

  return (
    <li
      className={`route-card stack${switchPrompt ? " route-card--switch-pending" : ""}`}
      data-route-id={route.id}
      ref={cardRef}
      // Programmatically focusable only (never in the tab order), so
      // handleCancelTags can park focus here for the single commit in
      // which the editor unmounts — see its own comment.
      tabIndex={-1}
    >
      {isRenaming ? (
        <form
          className="stack"
          onSubmit={handleRenameSubmit}
          onKeyDown={handleRenameKeyDown}
        >
          <label htmlFor={nameFieldId}>{t("routes.card.nameLabel")}</label>
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
            {formatDistanceKm(translator, route.distanceMetres)} ·{" "}
            {formatAscent(translator, route.ascentMetres)}
          </p>
          <div className="row">
            <button type="submit" className="btn-primary">
              {t("routes.card.save")}
            </button>
            <button type="button" className="btn-secondary" onClick={handleCancelRename}>
              {t("routes.card.cancel")}
            </button>
          </div>
        </form>
      ) : isEditingTags ? (
        <div className="tag-editor stack" onKeyDown={handleTagsEditorKeyDown}>
          <h2 id={tagsHeadingId}>{route.name}</h2>
          <p className="route-card-meta">
            {formatDistanceKm(translator, route.distanceMetres)} ·{" "}
            {formatAscent(translator, route.ascentMetres)}
          </p>
          <form className="row" onSubmit={handleAddTag}>
            <div className="route-library-field">
              <label htmlFor={tagInputId}>{t("routes.card.addTagLabel")}</label>
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
              {t("routes.card.addTag")}
            </button>
          </form>
          <div
            className="tag-suggestions"
            role="group"
            aria-label={t("routes.card.tagSuggestions")}
          >
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
          {isSavingTags ? <p role="status">{t("routes.saving")}</p> : null}
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
              {t("routes.card.saveTags")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isSavingTags}
              onClick={handleCancelTags}
            >
              {t("routes.card.cancel")}
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
              disabled={isOwnDeletionBusy}
              onClick={() => {
                if (isOwnDeletionBusy) return;
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
              aria-label={pinActionLabel}
              title={pinActionLabel}
              disabled={isPinPending || isDeleting || isOwnDeletionBusy}
              onClick={handlePinClick}
            >
              <PinIcon filled={isPinned} />
            </button>
          </div>
          <p className="route-card-meta">
            {formatDistanceKm(translator, route.distanceMetres)} ·{" "}
            {formatAscent(translator, route.ascentMetres)}
          </p>
          {pinError ? (
            <p role="alert" className="field-error">
              {pinError}
            </p>
          ) : null}
          {route.tags.length > 0 ? (
            <ul className="route-card-tags" aria-label={t("routes.card.tags")}>
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
              disabled={isOwnDeletionBusy}
              onClick={openRename}
            >
              {t("routes.card.rename")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              ref={tagsButtonRef}
              disabled={isOwnDeletionBusy}
              onClick={openTagEditor}
            >
              {route.tags.length > 0
                ? t("routes.card.editTags")
                : t("routes.card.addTags")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isOwnDeletionBusy}
              onClick={() => {
                if (isOwnDeletionBusy) return;
                onExport(route);
              }}
            >
              {t("routes.card.export")}
            </button>
            <button
              type="button"
              className="btn-danger"
              ref={deleteButtonRef}
              disabled={isOwnDeletionBusy}
              onClick={() => {
                if (isOwnDeletionBusy) return;
                onDeleteRequest(route.id);
              }}
            >
              {t("routes.card.delete")}
            </button>
          </div>
          {isDeletePending ? (
            // A named, described, non-modal dialog, like every confirmation
            // (backlog item 119): the page stays operable around it.
            <div
              className="route-delete-confirm"
              role="dialog"
              aria-labelledby={headingId}
              aria-describedby={
                isDeletionFailed ? `${descriptionId} ${deleteErrorId}` : descriptionId
              }
              onKeyDown={handleConfirmKeyDown}
              ref={deleteConfirmRef}
            >
              {/* Focusable by script only (tabIndex -1: never in the tab
                  order): where focus waits while a confirmed deletion runs,
                  backlog item 124's D-02. */}
              <h2 id={headingId} ref={deleteTitleRef} tabIndex={-1}>
                {t("routes.card.deleteConfirmTitle", { name: route.name })}
              </h2>
              <p id={descriptionId}>{t("routes.card.deleteConfirmBody")}</p>
              {/* Always the ordinary translated message, whatever the
                  storage error said: its technical detail goes only to the
                  redacted error log (useRouteDeletion.ts). */}
              {isDeletionFailed ? (
                <p id={deleteErrorId} role="alert">
                  {t("routes.error.delete")}
                </p>
              ) : null}
              <div className="route-delete-confirm-actions" ref={deleteActionsRef}>
                {/* Focused on opening by the item 124 layout effect above,
                    with preventScroll, rather than by autoFocus. */}
                <button
                  type="button"
                  className="btn-secondary"
                  ref={deleteCancelRef}
                  disabled={isOwnDeletionBusy}
                  onClick={handleCancelDelete}
                >
                  {t("routes.card.cancel")}
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isOwnDeletionBusy}
                  onClick={handleConfirmDelete}
                >
                  {isOwnDeletionBusy
                    ? t("routes.card.deleting")
                    : t("routes.card.deleteConfirm")}
                </button>
              </div>
            </div>
          ) : null}
          {switchPrompt ? (
            <div
              className="route-delete-confirm"
              role="dialog"
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
                    {t("routes.card.returnToPausedRide")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary"
                  autoFocus
                  disabled={switchPrompt.busy}
                  onClick={switchPrompt.onCancel}
                >
                  {t("routes.card.cancel")}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}
