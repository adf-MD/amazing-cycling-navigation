/** CSS-pixel tolerance for treating window.scrollY as "at the top" —
 * absorbs subpixel/DPI rounding rather than requiring an exact 0. */
const TOP_TOLERANCE_PX = 1;

/** Consecutive in-tolerance animation frames required before the
 * reassertion loop below (item 95 follow-up) considers the top reset
 * settled — a condition-based completion, not a fixed frame count. */
const STABLE_FRAMES_REQUIRED = 3;

/** Elapsed-time backstop for the reassertion loop, in milliseconds —
 * never the normal completion path (the consecutive-in-tolerance-frames
 * check above is), only a bound on a pathological case that never
 * stabilises. Sized from the worst-case smooth-scroll settle duration
 * measured against e2e/rideSessionSwitchGuard.spec.ts's ordinary-motion
 * Return scenario, plus margin — see that file for the measured figure. */
const REASSERT_SAFETY_CAP_MS = 1000;

/** DOM events that indicate genuine new user input, as distinct from a
 * leftover programmatic scroll animation settling late — any one of
 * these firing while the loop below is active ends it immediately rather
 * than fighting a deliberate scroll (item 95 follow-up). Deliberately
 * excludes "scroll" itself, which our own corrective scrollTo calls also
 * fire and would be self-defeating to listen for. */
const GENUINE_SCROLL_INPUT_EVENTS = ["touchstart", "pointerdown", "wheel"] as const;

/** The furthest the document can scroll down, never negative. */
function maxScrollTop(): number {
  const scroller = document.scrollingElement ?? document.documentElement;
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

export interface ScrollSettleOptions {
  /** Checked on every frame: true ends the loop without another scroll.
   * Backlog item 125's restoration passes "the rider has moved on". */
  shouldStop?: () => boolean;
  /** Called exactly once, however the loop ends — settled, capped,
   * stopped by genuine input or by `shouldStop`, or by the returned stop
   * function. */
  onEnd?: () => void;
}

/**
 * Scrolls the document to the top immediately, then keeps it there until
 * it has genuinely settled, and returns a function that stops the loop
 * early (for an effect's cleanup).
 *
 * A single scrollTo is not always enough: an unrelated scroll animation
 * already in flight elsewhere (e.g. the Route Library switch-prompt
 * card's own item-95 scroll, still animating when Return to paused ride
 * is tapped) can still be mid-flight when the caller commits, and there
 * is no reliable cross-browser guarantee that an instant scrollTo aborts
 * an in-flight smooth one. So a short requestAnimationFrame loop keeps
 * re-flattening scrollY to top until it has genuinely settled there for a
 * few consecutive frames, bounded by an elapsed-time safety cap and
 * abandoned immediately if real user input arrives (item 95 follow-up).
 *
 * Extracted unchanged from useResetScrollForNewRideContent.ts (backlog
 * item 121). Since backlog item 125 it is the top case of
 * scrollToAndSettle below, with identical behaviour, applied by
 * screenScrollMemory.ts's top requests; that hook's tests, ported from the
 * old one's, still guard the loop's drift, settle and safety-cap
 * behaviour.
 */
export function scrollToTopAndSettle(): () => void {
  return scrollToAndSettle(0);
}

/**
 * Backlog item 125: the same loop for any target, used to restore a
 * screen's own scroll position. One instant, unclamped scrollTo (the
 * browser clamps it), then on every frame the target is `top` clamped to
 * how far the document can scroll at that moment, so content that grows
 * or shrinks during the loop is followed rather than fought, and a page
 * shorter than `top` settles at its bottom. Completion, the safety cap and
 * the genuine-input events are exactly the top reset's.
 */
export function scrollToAndSettle(
  top: number,
  options: ScrollSettleOptions = {},
): () => void {
  window.scrollTo({ top, left: 0, behavior: "auto" });

  let rafId: number | null = null;
  let startTimestamp: number | null = null;
  let consecutiveStableFrames = 0;
  let ended = false;

  const stopReasserting = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const eventName of GENUINE_SCROLL_INPUT_EVENTS) {
      window.removeEventListener(eventName, stopReasserting);
    }
    if (!ended) {
      ended = true;
      options.onEnd?.();
    }
  };

  const tick = (timestamp: number) => {
    rafId = null;
    if (options.shouldStop?.()) {
      stopReasserting();
      return;
    }
    startTimestamp ??= timestamp;
    const target = Math.min(top, maxScrollTop());
    if (Math.abs(window.scrollY - target) > TOP_TOLERANCE_PX) {
      window.scrollTo({ top: target, left: 0, behavior: "auto" });
      consecutiveStableFrames = 0;
    } else {
      consecutiveStableFrames += 1;
    }
    if (consecutiveStableFrames >= STABLE_FRAMES_REQUIRED) {
      stopReasserting();
      return;
    }
    if (timestamp - startTimestamp >= REASSERT_SAFETY_CAP_MS) {
      stopReasserting();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  for (const eventName of GENUINE_SCROLL_INPUT_EVENTS) {
    window.addEventListener(eventName, stopReasserting, { passive: true, once: true });
  }
  rafId = requestAnimationFrame(tick);

  return stopReasserting;
}
