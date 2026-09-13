/** The framing margin kept between the confirmation and both usable-band
 * edges — below the sticky header at the top, and above the safe-area
 * inset at the bottom. Numerically the same 8px as `--space-8` and as
 * routeCardTopReveal.ts's own TOP_REVEAL_GAP_PX, which is the established
 * figure for exactly this job; kept as a JS constant because this reveal
 * computes its own delta rather than letting the browser scroll for it. */
export const REVEAL_GAP_PX = 8;

/** Deltas below this are treated as "already in place", so sub-pixel
 * layout rounding can never produce a visible twitch. The same 1px figure
 * as routeCardTopReveal.ts's TOP_REVEAL_TOLERANCE_PX and
 * viewportSettle.ts's SETTLE_TOLERANCE_PX. */
export const REVEAL_TOLERANCE_PX = 1;

/**
 * Resolves `--safe-area-inset-bottom` to an absolute pixel number.
 *
 * Deliberately read from a **custom property**, not from `scroll-margin-
 * bottom` as items 95 and 106 do. Those two let the browser perform the
 * scroll, so the declaration is genuinely honoured there; here it would be
 * read purely as a number — and `scroll-margin` is not inert. It also
 * feeds the scroll-into-view the focusing steps run for `autoFocus`, so
 * declaring it would quietly change the native reveal this code measures
 * and then corrects, leaving two mechanisms interacting through one
 * property. Reading a custom property has no scrolling effect at all.
 *
 * Measured rather than assumed: in the pinned Playwright container this
 * resolves to `"0px"` in Chromium, WebKit and the Pixel-7 preset alike,
 * and to `"34px"` when a test sets an inline override on the root element
 * — which is exactly the seam index.css documents for these properties.
 * In jsdom the stylesheet is never loaded (`css: false` in vite.config.ts)
 * so it resolves to an empty string, hence the non-finite fallback.
 */
export function readSafeAreaInsetBottomPx(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--safe-area-inset-bottom")
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The vertical delta (for `window.scrollBy`) that brings the Settings
 * key-deletion confirmation into the usable band, or 0 when no movement is
 * warranted.
 *
 * **Bottom-prioritising**, and therefore a third code path alongside
 * routeCardTopReveal.ts's top-prioritising `computeTopRevealScrollDelta`
 * and routeSwitchCardVisibility.ts's whole-card `isCardAlreadyFullyVisible`.
 * When the inset is taller than the band it anchors the inset's BOTTOM,
 * which is what keeps the Cancel/Delete row complete: that row is the last
 * content inside the inset (see ConfirmDialog's markup), followed only by
 * the inset's own padding, so bottom-aligning the inset guarantees at
 * least as much protection as measuring the buttons would — and it also
 * keeps Cancel's focus ring, which protrudes 4px, inside that padding
 * rather than inside the cushion. The residual case where the action row
 * alone exceeds the band is unreachable at the supported phone-portrait
 * widths (two wrapped 62px buttons plus padding against a band of roughly
 * 620-745px) and is deliberately not engineered for.
 *
 * `scrollIntoView` cannot express this contract. `block: "nearest"` aligns
 * the START edge when the target is taller than the scrollport — the
 * top-prioritising behaviour this exists to avoid — and `block: "end"`
 * always scrolls, so it cannot satisfy "do not move when it already fits".
 * Neither can express the sticky header without a `scroll-padding-top` on
 * the scrolling element, which would change every other scrollIntoView in
 * the application.
 *
 * No clamping: `window.scrollBy` already clamps to the document's own
 * scrollable range, so a page with too little room below degrades to a
 * best-effort partial move rather than needing arithmetic here.
 */
export function computeConfirmationRevealDelta(
  insetRect: { top: number; bottom: number },
  headerBottomPx: number,
  bottomCushionPx: number,
  visibleTopPx: number,
  visibleBottomPx: number,
  gapPx: number = REVEAL_GAP_PX,
): number {
  // The sticky header's bottom is scroll-invariant (position: sticky;
  // top: 0), which is what makes a single-pass delta correct rather than
  // needing to iterate after the scroll lands.
  const effectiveTop = Math.max(headerBottomPx, visibleTopPx) + gapPx;
  const effectiveBottom = visibleBottomPx - bottomCushionPx;
  const height = insetRect.bottom - insetRect.top;

  // An element with no laid-out box cannot be revealed. This is the state
  // every rect reports in jsdom, where nothing has layout at all, and
  // without it the "top is above the band" branch below would compute a
  // spurious -gapPx delta for a box that does not exist on screen.
  if (height <= 0) return 0;

  let delta = 0;
  if (height <= effectiveBottom - effectiveTop) {
    // It fits: move the minimum distance that makes all of it visible. The
    // two branches are mutually exclusive — if the inset fits and its top
    // is above the band, its bottom is necessarily inside it.
    if (insetRect.bottom > effectiveBottom) {
      delta = insetRect.bottom - effectiveBottom;
    } else if (insetRect.top < effectiveTop) {
      delta = insetRect.top - effectiveTop;
    }
  } else {
    // It cannot fit: the actions win, and whatever title and warning fit
    // above them is the context retained. Can be negative, which is the
    // case where the rider had already scrolled past the actions.
    delta = insetRect.bottom - effectiveBottom;
  }

  return Math.abs(delta) < REVEAL_TOLERANCE_PX ? 0 : delta;
}

/**
 * The single place this reveal is actually performed. Measures the usable
 * visible band (the visual viewport when a software keyboard or pinch zoom
 * has shrunk it, else the layout viewport — the same idiom
 * routeCardTopReveal.ts, RouteListItem.tsx and RouteLibrary.tsx already
 * use), asks the pure function above for a delta, and issues at most ONE
 * `window.scrollBy` for it.
 *
 * `behavior: "auto"` unconditionally, never `prefersReducedMotion()`-
 * conditional: a smooth scroll keeps moving the actions for hundreds of
 * milliseconds after they are interactive, which is the interaction-safety
 * hazard item 95 measured and corrected. `left: 0` guarantees the
 * horizontal scroll position is never touched, so this cannot disturb the
 * 200%-text horizontal-containment guarantees.
 *
 * Returns the applied delta (0 when nothing was needed) so callers and
 * tests can assert the decision rather than only its side effect.
 */
export function applyConfirmationReveal(
  insetEl: HTMLElement,
  headerBottomPx: number,
): number {
  const visualViewport = window.visualViewport;
  const visibleTop = visualViewport?.offsetTop ?? 0;
  const visibleBottom = visualViewport
    ? visualViewport.offsetTop + visualViewport.height
    : window.innerHeight;
  const delta = computeConfirmationRevealDelta(
    insetEl.getBoundingClientRect(),
    headerBottomPx,
    readSafeAreaInsetBottomPx() + REVEAL_GAP_PX,
    visibleTop,
    visibleBottom,
  );
  if (delta !== 0) {
    window.scrollBy({ top: delta, left: 0, behavior: "auto" });
  }
  return delta;
}
