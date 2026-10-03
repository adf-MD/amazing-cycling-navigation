import {
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Both labels are **required** (backlog item 113 stage 5). They used to
   * default to "Confirm"/"Cancel" here, which made this generic component
   * an author of rider-facing copy — and the only way to localise a
   * default would have been to read the language from React context
   * inside a component whose whole value is that it holds no opinions.
   * Every caller already supplied `confirmLabel`; they now supply
   * `cancelLabel` too, from their own translator. */
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables the Confirm/Cancel buttons while a triggered action is still
   * in flight, so a rapid double click can't submit twice and Cancel can
   * never appear to undo work storage is still carrying out — mirrors
   * RouteListItem.tsx's own hand-rolled delete confirmation precedent.
   * Disabling the button doesn't stop Escape from cancelling; a caller
   * relying on this must also guard its own onCancel. Undefined/false for
   * both existing callers, so their behaviour is unchanged. */
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  /** Heading level for the dialog's own title (backlog item 118). Defaults
   * to 2, which is what every caller rendered before this prop existed, so
   * a page-level dialog beneath a single h1 is unchanged. A caller that
   * renders this dialog *inside* a card supplies the level below that
   * card's own heading instead: Settings' OpenRouteService card is an h3
   * (backlog item 112), so its key-deletion confirmation is an h4. Without
   * this the title would take the UA default 1.5em — larger than
   * .screen-title's own clamped size — and would read as a new top-level
   * section rather than as part of the card it belongs to. */
  headingLevel?: 2 | 3 | 4;
  /** A handle onto this dialog's own root element, for a caller that must
   * measure its rendered box (backlog item 118's Settings reveal, which
   * scrolls the confirmation into the usable viewport when opening it
   * would otherwise leave it partly hidden). Named after
   * RouteTagManager.tsx's own `confirmRef` precedent rather than using
   * React 19's ref-as-prop, since every ref in this codebase is passed as
   * an explicit `*Ref` prop. Also passed by the item 124 callers that reveal
   * their confirmation (Clear draft, Planning's saved-route switch, Riding's
   * Edit copy and the paused panel's End ride); undefined for every other
   * caller, whose rendering and behaviour are unchanged. */
  containerRef?: RefObject<HTMLDivElement | null>;
  /** A handle onto the Cancel/Confirm action row, for a caller whose
   * reveal prioritises that row when the whole dialog cannot fit (backlog
   * item 124's Clear draft, Planning's saved-route switch, Riding's Edit
   * copy and the paused panel's End ride). Same explicit-`*Ref` convention
   * as `containerRef`; undefined for every other caller. */
  actionsRef?: RefObject<HTMLDivElement | null>;
  /** Backlog item 124. Cancel still receives focus the moment the dialog
   * opens, but with `preventScroll`, for a caller that performs its own
   * deliberate reveal in a layout effect: the browser's own focus scroll
   * centres Cancel (item 118 measured 619px of movement where ~240px was
   * the minimum), so leaving it on would mean two mechanisms moving the
   * page for one opening, and more movement than the reveal rule allows.
   * Set by Clear draft, Planning's saved-route switch, Riding's Edit copy
   * and the paused panel's End ride (not the riding header's, which opens
   * inside a fixed shell); undefined/false for every other caller, which
   * keep plain `autoFocus` exactly as before. */
  focusCancelWithoutScroll?: boolean;
  /** A handle onto the dialog's own title, which this also makes focusable
   * by script only (`tabIndex={-1}`: never in the tab order, never
   * activated) — the precedent of Planning's save heading and Settings'
   * OpenRouteService heading. For a caller whose action keeps running after
   * Confirm (backlog item 124's D-06, Edit copy, and D-01, Clear draft):
   * focus waits here while both actions are disabled, so it stays inside
   * the dialog — Chromium drops a focused button that becomes disabled to
   * `<body>` — and Escape still reaches the dialog's own handler, which the
   * caller refuses while busy. Undefined for every other caller, whose
   * markup is unchanged. */
  titleRef?: RefObject<HTMLHeadingElement | null>;
}

/** Keeps the rendered tag a real JSX intrinsic rather than a computed
 * string, so nothing here widens to ElementType or needs a cast. */
const TITLE_TAGS = { 2: "h2", 3: "h3", 4: "h4" } as const;

/**
 * The app's shared, reusable confirmation pattern: a named, described,
 * **non-modal** `role="dialog"` (backlog item 119). It renders in the
 * page's flow and leaves everything around it operable — the page-level
 * ride-switch prompt depends on the primary navigation staying live so a
 * rider can leave Routes mid-prompt — so it never claims `aria-modal`,
 * which would tell assistive technology the rest of the page is inert when
 * it is not. For the same reason it is not an `alertdialog`, which ARIA
 * expects to be modal.
 *
 * More than one may be open at once (that page-level prompt beside a
 * screen's own confirmation, or two in RidingScreen's paused panel), so
 * every instance takes its own title and description ids from `useId()`
 * and is announced by its own title and message; each acts only on its
 * own subject. Focus moves to Cancel as soon as it opens — plain
 * `autoFocus` by default, or a `preventScroll` focus from a layout effect
 * when the caller opts in with `focusCancelWithoutScroll` (item 124) — and
 * Escape inside it cancels it alone.
 * Focus-restore to whatever triggered the dialog is the caller's own
 * responsibility (typically via a ref to that trigger, called from
 * onCancel/onConfirm) — this component has no notion of what opened it.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled,
  cancelDisabled,
  headingLevel = 2,
  containerRef,
  actionsRef,
  focusCancelWithoutScroll = false,
  titleRef,
}: ConfirmDialogProps) {
  // Called before the early return below, as hooks must be.
  const headingId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Keyed on two primitives only, so this runs when the dialog opens and
  // never again on an unrelated re-render — Planning re-renders every
  // second through useNow, and an unstable dependency here would pull
  // focus back to Cancel each time. A child's layout effects run before
  // its parent's, so a caller's own reveal effect already finds Cancel
  // focused, and the page unmoved by it.
  useLayoutEffect(() => {
    if (!open || !focusCancelWithoutScroll) return;
    cancelRef.current?.focus({ preventScroll: true });
  }, [open, focusCancelWithoutScroll]);

  if (!open) {
    return null;
  }

  const Title = TITLE_TAGS[headingLevel];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      className="route-delete-confirm"
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      <Title id={headingId} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
        {title}
      </Title>
      <p id={descriptionId}>{message}</p>
      <div className="route-delete-confirm-actions" ref={actionsRef}>
        <button
          type="button"
          className="btn-secondary"
          autoFocus={!focusCancelWithoutScroll}
          ref={cancelRef}
          onClick={onCancel}
          disabled={cancelDisabled}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
