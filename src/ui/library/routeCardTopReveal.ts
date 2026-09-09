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
