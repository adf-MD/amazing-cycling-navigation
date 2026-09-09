/** CSS-pixel tolerance for treating two geometry samples as unchanged —
 * absorbs sub-pixel/DPI rounding rather than requiring floating-point
 * equality, which a continuously jittering value could otherwise never
 * satisfy, stalling the loop until the safety cap. Deliberately the same
 * 1px figure as routeCardTopReveal.ts's TOP_REVEAL_TOLERANCE_PX. */
const SETTLE_TOLERANCE_PX = 1;

/** Consecutive in-tolerance animation frames required before the geometry
 * is considered settled — a condition-based completion, not a fixed frame
 * count. Mirrors useResetScrollForNewRideContent.ts's own constant. */
const STABLE_FRAMES_REQUIRED = 3;

/** Elapsed-time backstop, in milliseconds — never the normal completion
 * path (the consecutive-in-tolerance-frames check above is), only a bound
 * on a pathological case that never stabilises. Same figure and rationale
 * as useResetScrollForNewRideContent.ts's REASSERT_SAFETY_CAP_MS. */
const SETTLE_SAFETY_CAP_MS = 1000;

/** DOM events that indicate genuine new user input, as distinct from a
 * programmatic scroll animation settling late — any one of these firing
 * while the loop is active abandons it rather than acting against geometry
 * the user is actively changing. Deliberately excludes "scroll" itself,
 * which our own callers' corrective scrolls also fire and which would be
 * self-defeating to listen for (useResetScrollForNewRideContent.ts's own
 * established list and reasoning). */
const GENUINE_SCROLL_INPUT_EVENTS = ["touchstart", "pointerdown", "wheel"] as const;

interface ViewportSignature {
  offsetTop: number;
  height: number;
  scrollY: number;
}

/** The three values that must all hold still before a deliberate reveal
 * scroll may be computed. `scrollY` is included deliberately alongside the
 * visual viewport's own box: it can keep changing independently while iOS
 * Safari restores the page after a keyboard dismissal, or while an earlier
 * smooth scroll is still in flight — for instance a confirmation's own
 * downward scroll still running when a successful operation's upward
 * manager reveal begins. Falls back to the layout viewport when
 * visualViewport is unavailable, matching routeCardTopReveal.ts's own
 * fallback. */
function readViewportSignature(): ViewportSignature {
  const visualViewport = window.visualViewport;
  return {
    offsetTop: visualViewport?.offsetTop ?? 0,
    height: visualViewport?.height ?? window.innerHeight,
    scrollY: window.scrollY,
  };
}

function isUnchanged(a: ViewportSignature, b: ViewportSignature): boolean {
  return (
    Math.abs(a.offsetTop - b.offsetTop) <= SETTLE_TOLERANCE_PX &&
    Math.abs(a.height - b.height) <= SETTLE_TOLERANCE_PX &&
    Math.abs(a.scrollY - b.scrollY) <= SETTLE_TOLERANCE_PX
  );
}

/**
 * Runs `run` once the visible-viewport geometry has genuinely stopped
 * moving, and returns a cancel function for effect cleanup.
 *
 * Backlog item 106. A reveal that measures immediately after a commit can
 * read geometry that is still mid-transition — most obviously while iOS
 * Safari is dismissing the software keyboard, un-panning the layout
 * viewport and restoring scroll position, all asynchronously and all after
 * React's own effects have run. A delta computed from that transient state
 * is applied against the state that follows it, so the two motions sum.
 *
 * Deliberately condition-based, never a fixed `setTimeout`: it waits for
 * STABLE_FRAMES_REQUIRED consecutive frames whose signature is unchanged
 * within SETTLE_TOLERANCE_PX.
 *
 * **At the safety cap it abandons WITHOUT calling `run`.** If the geometry
 * never settles, the one thing that must not happen is a deliberate scroll
 * computed from values known to be unstable — that is exactly the
 * overshoot this exists to prevent. Callers focus their target
 * synchronously, before starting this wait, so abandoning leaves the user
 * with correct focus and an unmoved viewport rather than a wrong jump.
 *
 * Callers must re-measure their own target and header INSIDE `run`;
 * nothing may be captured beforehand, or the wait achieves nothing.
 */
export function runWhenViewportSettled(run: () => void): () => void {
  let rafId: number | null = null;
  let startTimestamp: number | null = null;
  let consecutiveStableFrames = 0;
  let previous: ViewportSignature | null = null;
  let hasRun = false;

  const stop = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const eventName of GENUINE_SCROLL_INPUT_EVENTS) {
      window.removeEventListener(eventName, stop);
    }
  };

  const tick = (timestamp: number) => {
    rafId = null;
    startTimestamp ??= timestamp;
    const current = readViewportSignature();
    consecutiveStableFrames =
      previous !== null && isUnchanged(previous, current)
        ? consecutiveStableFrames + 1
        : 0;
    previous = current;
    if (consecutiveStableFrames >= STABLE_FRAMES_REQUIRED) {
      stop();
      if (!hasRun) {
        hasRun = true;
        run();
      }
      return;
    }
    if (timestamp - startTimestamp >= SETTLE_SAFETY_CAP_MS) {
      // Abandon deliberately: see the doc comment above.
      stop();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  for (const eventName of GENUINE_SCROLL_INPUT_EVENTS) {
    window.addEventListener(eventName, stop, { passive: true, once: true });
  }
  rafId = requestAnimationFrame(tick);

  return stop;
}
