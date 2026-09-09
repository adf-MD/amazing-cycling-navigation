import { prefersReducedMotion } from "../../platform/environmentContext.ts";

/** A small fixed gap kept between the sticky header's bottom edge (or the
 * visible viewport's own top, whichever is lower) and a revealed card's
 * top, so the title doesn't sit flush against the header's border. */
export const TOP_REVEAL_GAP_PX = 8;

/** Deltas smaller than this are treated as "already in place" — avoids an
 * imperceptible scroll triggered by sub-pixel layout rounding. */
export const TOP_REVEAL_TOLERANCE_PX = 1;

/**
 * The vertical delta (for `window.scrollBy`) needed to bring a card's own
 * top band — its outer top edge through the bottom of its title row —
 * below a sticky header and within the visible viewport, with a small
 * fixed gap. Deliberately top-prioritising and a separate code path from
 * routeSwitchCardVisibility.ts's bottom-prioritising, whole-card
 * `isCardAlreadyFullyVisible` (backlog item 95): a band taller than the
 * available viewport can never satisfy "the whole card fits", so this only
 * ever guarantees the band's own TOP is clear, never sacrificing it to try
 * to also show the band's bottom. Returns 0 (no scroll needed) when the
 * band is already suitably placed, within TOP_REVEAL_TOLERANCE_PX.
 */
export function computeTopRevealScrollDelta(
  topBandRect: { top: number; bottom: number },
  headerBottomPx: number,
  visibleTopPx: number,
  visibleBottomPx: number,
  gapPx: number = TOP_REVEAL_GAP_PX,
): number {
  const effectiveTop = Math.max(headerBottomPx, visibleTopPx) + gapPx;
  let delta = 0;
  if (topBandRect.top < effectiveTop) {
    // The band's top is hidden under the header (or above the visible
    // viewport entirely) — scroll up just enough to clear it.
    delta = topBandRect.top - effectiveTop;
  } else if (topBandRect.bottom > visibleBottomPx) {
    // The band hasn't scrolled into view at all yet — scroll down, but
    // never further than would push the band's own top back above
    // effectiveTop (prioritising the top over showing the full band).
    const idealDownward = topBandRect.bottom - visibleBottomPx;
    const maxWithoutHidingTop = topBandRect.top - effectiveTop;
    delta = Math.min(idealDownward, maxWithoutHidingTop);
  }
  return Math.abs(delta) < TOP_REVEAL_TOLERANCE_PX ? 0 : delta;
}

/**
 * The single place a top-reveal is actually performed. Measures the usable
 * visible band (the visual viewport when the on-screen keyboard or a pinch
 * zoom has shrunk it, else the layout viewport), asks
 * computeTopRevealScrollDelta above for the delta, and issues at most ONE
 * window.scrollBy for it. `left: 0` guarantees horizontal scroll position
 * is never touched, and a zero delta issues no call at all.
 *
 * Shared deliberately rather than duplicated: item 105 added a second and
 * third caller (a card's Cancel/Escape close, and the Manage tags panel's
 * own top after a successful global tag operation) to the original
 * successful-save one, and the item's own wording asks for one reveal path
 * rather than several. The module keeps its name — CLAUDE.md, backlog.md
 * and current-status.md all cite `routeCardTopReveal.ts` by name — even
 * though it now also serves the tag manager, which is not a card.
 *
 * Returns the applied delta (0 when nothing was needed) so callers and
 * tests can assert on the decision rather than only on its side effect.
 */
export function applyTopRevealScroll(
  band: { top: number; bottom: number },
  headerBottomPx: number,
): number {
  const visualViewport = window.visualViewport;
  const visibleTop = visualViewport?.offsetTop ?? 0;
  const visibleBottom = visualViewport
    ? visualViewport.offsetTop + visualViewport.height
    : window.innerHeight;
  const delta = computeTopRevealScrollDelta(
    band,
    headerBottomPx,
    visibleTop,
    visibleBottom,
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
