import { afterEach, describe, expect, it } from "vitest";
import {
  applyTopRevealScroll,
  computeTopRevealScrollDelta,
  TOP_REVEAL_TOLERANCE_PX,
} from "./routeCardTopReveal.ts";

describe("computeTopRevealScrollDelta", () => {
  it("returns 0 when the band is already clear of the header and within the viewport", () => {
    expect(computeTopRevealScrollDelta({ top: 100, bottom: 200 }, 65, 0, 800, 8)).toBe(0);
  });

  it("returns a negative delta sized to clear the header when the band's top is hidden under it", () => {
    // effectiveTop = max(65, 0) + 8 = 73. Band top is 20, needs to move to 73.
    expect(computeTopRevealScrollDelta({ top: 20, bottom: 400 }, 65, 0, 800, 8)).toBe(
      20 - 73,
    );
  });

  it("returns a negative delta sized to clear the visible top when it exceeds the header bottom", () => {
    // visibleTop (120) exceeds headerBottomPx (65) — e.g. a visualViewport
    // that has scrolled relative to the layout viewport (mirrors
    // routeSwitchCardVisibility's own precedent for this case).
    // effectiveTop = max(65, 120) + 8 = 128. Band top is 100, needs 128.
    expect(computeTopRevealScrollDelta({ top: 100, bottom: 400 }, 65, 120, 800, 8)).toBe(
      100 - 128,
    );
  });

  it("returns a positive delta when the band hasn't scrolled into view at all (top already clear)", () => {
    // effectiveTop = 73. Band top (900) is already >= effectiveTop, but its
    // bottom (1100) is past visibleBottom (800) — scroll down by 300 to
    // align the bottom, since that doesn't push the top back above 73.
    expect(computeTopRevealScrollDelta({ top: 900, bottom: 1100 }, 65, 0, 800, 8)).toBe(
      300,
    );
  });

  it("clamps the downward delta so the band's own top is never pushed back above effectiveTop", () => {
    // Band (top: 100, bottom: 2000) is far taller than the available
    // viewport band. Naively aligning the bottom (2000 -> 800 => scroll by
    // 1200) would push the top from 100 to 100 - 1200 = -1100, hiding it
    // under the header. Top-prioritisation clamps the scroll to exactly
    // what's available before the top would be re-hidden: 100 - 73 = 27.
    expect(computeTopRevealScrollDelta({ top: 100, bottom: 2000 }, 65, 0, 800, 8)).toBe(
      27,
    );
  });

  it("respects the tolerance for a sub-pixel difference, treating it as a no-op", () => {
    // effectiveTop = 73. Band top is 73.5, off by less than
    // TOP_REVEAL_TOLERANCE_PX (1) once the raw delta (-0.5) is computed.
    expect(computeTopRevealScrollDelta({ top: 73.5, bottom: 400 }, 65, 0, 800, 8)).toBe(
      0,
    );
    expect(TOP_REVEAL_TOLERANCE_PX).toBe(1);
  });

  it("is a no-op exactly at the effectiveTop boundary", () => {
    expect(computeTopRevealScrollDelta({ top: 73, bottom: 400 }, 65, 0, 800, 8)).toBe(0);
  });

  it("uses the default gap when none is supplied", () => {
    // TOP_REVEAL_GAP_PX defaults to 8, matching the explicit-gap case above.
    expect(computeTopRevealScrollDelta({ top: 20, bottom: 400 }, 65, 0, 800)).toBe(
      20 - 73,
    );
  });
});

// The single shared applier (backlog item 105): three callers now depend on
// it — a card's successful save, a card's Cancel/Escape, and the Manage
// tags panel's top after a successful global operation — so its viewport
// measurement and its "one scrollBy at most" rule are worth pinning here
// rather than only through each caller's own component test.
describe("applyTopRevealScroll", () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollBy = window.scrollBy;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalMatchMedia = window.matchMedia;
  const originalVisualViewport = window.visualViewport;

  afterEach(() => {
    window.scrollBy = originalScrollBy;
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalVisualViewport,
    });
  });

  function captureScrollByCalls() {
    const calls: ScrollToOptions[] = [];
    window.scrollBy = (options?: ScrollToOptions | number) => {
      if (typeof options === "object") {
        calls.push(options);
      }
    };
    return calls;
  }

  function stubVisualViewport(value: { offsetTop: number; height: number } | null) {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value,
    });
  }

  it("scrolls by the computed delta, never touching horizontal position", () => {
    const calls = captureScrollByCalls();
    // jsdom's innerHeight is 768 and no sticky header is supplied, so the
    // effective top boundary is the 8px gap alone: -300 - 8.
    expect(applyTopRevealScroll({ top: -300, bottom: -256 }, 0)).toBe(-308);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ top: -308, left: 0, behavior: "smooth" });
  });

  it("issues no call at all when the band is already suitably framed", () => {
    const calls = captureScrollByCalls();
    expect(applyTopRevealScroll({ top: 100, bottom: 144 }, 0)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("accounts for a sticky header's own bottom edge", () => {
    const calls = captureScrollByCalls();
    // Without the header this band would need no scroll at all; the header
    // occluding its top is the only reason a delta exists.
    expect(applyTopRevealScroll({ top: 60, bottom: 100 }, 120)).toBe(60 - 128);
    expect(calls).toHaveLength(1);
  });

  it("prefers the visual viewport's own band over the layout viewport", () => {
    const calls = captureScrollByCalls();
    stubVisualViewport({ offsetTop: 200, height: 300 });
    // The band sits below the shrunken visible band's bottom (200 + 300),
    // so it must scroll down — against the layout viewport's 768 it would
    // have been considered already visible and scrolled nothing.
    expect(applyTopRevealScroll({ top: 520, bottom: 560 }, 0)).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

  it("falls back to the layout viewport when no visual viewport is exposed", () => {
    const calls = captureScrollByCalls();
    stubVisualViewport(null);
    expect(applyTopRevealScroll({ top: 520, bottom: 560 }, 0)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("uses immediate behaviour under prefers-reduced-motion", () => {
    const calls = captureScrollByCalls();
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    })) as typeof window.matchMedia;
    applyTopRevealScroll({ top: -300, bottom: -256 }, 0);
    expect(calls[0]).toEqual({ top: -308, left: 0, behavior: "auto" });
  });
});
