import { prefersReducedMotion } from "../../platform/environmentContext.ts";
import { computeTopRevealScrollDelta } from "../library/routeCardTopReveal.ts";
import {
  REVEAL_GAP_PX,
  readSafeAreaInsetBottomPx,
} from "../shared/confirmationRevealScroll.ts";

/**
 * Brings a warning selected on Planning's map — its row together with the
 * details it opens — into the usable band (backlog item 124, slice 10,
 * P-18): below the sticky navigation plus the 8px gap, and above the
 * visible viewport's bottom less the safe-area inset and the same gap.
 *
 * The geometry is routeCardTopReveal.ts's top-prioritising
 * `computeTopRevealScrollDelta`, unchanged; passing it a visible bottom
 * already reduced by that cushion is what keeps the item clear of the
 * home indicator. That function gives exactly the rider's decisions of
 * 4 October 2026: no movement when the whole item is already inside the
 * band; otherwise the minimum, which brings an item arriving from below
 * up to the band's bottom; and when the item is taller than the band, its
 * beginning aligned below the navigation, so the row's label and the
 * start of its explanation show and the rest is reached by scrolling.
 * `computeConfirmationRevealDelta` would be the wrong choice: an oversized
 * confirmation keeps its action row, so it anchors the bottom instead.
 *
 * Smooth unless reduced motion is set, as the button-only reveal it
 * replaces was: decision 3 keeps it, rather than copying the confirmations'
 * always-instant movement. One `window.scrollBy`, computed once — the
 * sticky header's bottom is scroll-invariant, so a single delta is final —
 * and never re-issued, so a rider who scrolls during or after it is not
 * pulled back. `left: 0` leaves the horizontal position alone.
 *
 * Returns the applied delta (0 when nothing was needed).
 */
export function revealSelectedWarning(
  itemEl: HTMLElement,
  headerBottomPx: number,
): number {
  const rect = itemEl.getBoundingClientRect();
  // An element with no laid-out box cannot be revealed — the state every
  // rect reports in jsdom — exactly as computeConfirmationRevealDelta
  // guards it; without this the top branch would compute a spurious
  // upward delta for a box that is not on screen.
  if (rect.height <= 0) return 0;
  const visualViewport = window.visualViewport;
  const visibleTop = visualViewport?.offsetTop ?? 0;
  const visibleBottom = visualViewport
    ? visualViewport.offsetTop + visualViewport.height
    : window.innerHeight;
  const delta = computeTopRevealScrollDelta(
    rect,
    headerBottomPx,
    visibleTop,
    visibleBottom - (readSafeAreaInsetBottomPx() + REVEAL_GAP_PX),
  );
  if (delta !== 0) {
    window.scrollBy({
      top: delta,
      left: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }
  return delta;
}
