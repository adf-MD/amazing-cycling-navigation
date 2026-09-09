import { describe, expect, it } from "vitest";
import {
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
