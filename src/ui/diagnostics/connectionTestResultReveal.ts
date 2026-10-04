import { prefersReducedMotion } from "../../platform/environmentContext.ts";
import { computeTopRevealScrollDelta } from "../library/routeCardTopReveal.ts";
import {
  REVEAL_GAP_PX,
  readSafeAreaInsetBottomPx,
} from "../shared/confirmationRevealScroll.ts";
import {
  armOperationInteractionGuard,
  type OperationInteractionGuard,
} from "../shared/operationInteractionGuard.ts";

/**
 * Brings the routing-connection test's result line into the usable band
 * when a test finishes while the rider is still waiting (backlog item 124,
 * slice 11, P-15): below the sticky navigation and the Settings/Status
 * switcher plus the 8px gap, and above the visible viewport's bottom less
 * the safe-area inset and the same gap.
 *
 * The same composition as Planning's map-selected warning reveal
 * (src/ui/planning/warningReveal.ts, slice 10), which is deliberately left
 * untouched rather than generalised: routeCardTopReveal.ts's
 * top-prioritising `computeTopRevealScrollDelta`, unchanged, given a
 * visible bottom already reduced by that cushion. That gives exactly the
 * rider's decision 12 of 4 October 2026: no movement when the line is
 * already inside the band; otherwise the minimum, which brings a line
 * arriving from below up to the band's bottom; and when the line is taller
 * than the band, its beginning aligned below the navigation, the rest
 * reached by ordinary scrolling.
 *
 * Smooth unless reduced motion is set. One `window.scrollBy`, computed once
 * — the sticky rows' bottoms are scroll-invariant, so a single delta is
 * final — and never re-issued, so a rider who scrolls during or after it
 * is not pulled back. `left: 0` leaves the horizontal position alone.
 * Nothing is focused: the line is the screen's existing `role="status"`
 * live region, which announces the outcome by itself.
 *
 * Returns the applied delta (0 when nothing was needed).
 */
export function revealConnectionTestResult(
  lineEl: HTMLElement,
  headerBottomPx: number,
): number {
  const rect = lineEl.getBoundingClientRect();
  // An element with no laid-out box cannot be revealed — the state every
  // rect reports in jsdom.
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

/**
 * Whether the rider is still waiting at **Test routing connection** while
 * one attempt runs (slice 11). Armed when the attempt begins, inside the
 * button's own click, so the activation itself — the press that focuses
 * the button, Enter's or Space's key — has already happened.
 *
 * The accepted shared guard (operationInteractionGuard.ts, unchanged) is
 * composed, with the button as its area: a `pointerdown` elsewhere, any
 * `keydown`, a `wheel` or a `touchmove` means the rider has moved on, and a
 * repeated tap on the disabled button does not. Two further signals are
 * this caller's own, both capture-phase and passive:
 *
 * - **`focusin` outside the button.** The button is disabled while the
 *   test runs, and a disabled button losing focus fires only blur and
 *   focusout, leaving focus on `<body>`; a deliberate move — Tab, a tap on
 *   another control, assistive technology — fires `focusin` on its new
 *   target. That is what separates the activation's own focus loss from
 *   the rider moving focus elsewhere. `document.activeElement` would not:
 *   a WebKit tap never focuses the button, so focus can legitimately still
 *   be wherever it was before.
 * - **The document becoming hidden** — switching apps or locking the
 *   phone — by the rider's answer of 4 October 2026. Becoming visible
 *   again does not re-arm it: that attempt never reveals. The request and
 *   its result are untouched.
 *
 * Its owner reads `armed` once the attempt has finished and then calls
 * `detach()`; a detached guard reads as disarmed, and every listener goes.
 */
export function armConnectionTestWaitGuard(
  getButton: () => Element | null,
): OperationInteractionGuard {
  const shared = armOperationInteractionGuard(getButton);
  let movedOn = false;
  let attached = true;
  const onFocusIn = (event: FocusEvent) => {
    const button = getButton();
    const target = event.target;
    if (button === null || !(target instanceof Node) || !button.contains(target)) {
      movedOn = true;
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") movedOn = true;
  };

  const options = { capture: true, passive: true } as const;
  window.addEventListener("focusin", onFocusIn, options);
  document.addEventListener("visibilitychange", onVisibilityChange, options);

  return {
    get armed() {
      return !movedOn && shared.armed;
    },
    detach() {
      movedOn = true;
      shared.detach();
      if (!attached) return;
      attached = false;
      window.removeEventListener("focusin", onFocusIn, { capture: true });
      document.removeEventListener("visibilitychange", onVisibilityChange, {
        capture: true,
      });
    },
  };
}
