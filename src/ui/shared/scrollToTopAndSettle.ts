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
 * item 121), whose own tests still guard this exact behaviour, so that
 * the Settings/Status section's interim top reset reuses the proven loop
 * rather than a second, weaker copy of it.
 */
export function scrollToTopAndSettle(): () => void {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });

  let rafId: number | null = null;
  let startTimestamp: number | null = null;
  let consecutiveStableFrames = 0;

  const stopReasserting = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const eventName of GENUINE_SCROLL_INPUT_EVENTS) {
      window.removeEventListener(eventName, stopReasserting);
    }
  };

  const tick = (timestamp: number) => {
    startTimestamp ??= timestamp;
    if (Math.abs(window.scrollY) > TOP_TOLERANCE_PX) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
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
