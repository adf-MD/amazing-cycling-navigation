import { describe, expect, it } from "vitest";
import { isCardAlreadyFullyVisible } from "./routeSwitchCardVisibility.ts";

describe("isCardAlreadyFullyVisible", () => {
  it("is true when the card sits entirely within the visible band", () => {
    expect(isCardAlreadyFullyVisible({ top: 100, bottom: 300 }, 80, 20, 0, 800)).toBe(
      true,
    );
  });

  it("is false when the card's top is above the header's bottom", () => {
    expect(isCardAlreadyFullyVisible({ top: 50, bottom: 300 }, 80, 20, 0, 800)).toBe(
      false,
    );
  });

  it("is false when the card's bottom is below the viewport bottom", () => {
    expect(isCardAlreadyFullyVisible({ top: 100, bottom: 790 }, 80, 20, 0, 800)).toBe(
      false,
    );
  });

  it("accounts for the bottom cushion, not just the raw viewport edge", () => {
    // Bottom sits inside the raw viewport (800) but inside the reserved
    // 20px cushion, so it must still be treated as not fully visible.
    expect(isCardAlreadyFullyVisible({ top: 100, bottom: 785 }, 80, 20, 0, 800)).toBe(
      false,
    );
    expect(isCardAlreadyFullyVisible({ top: 100, bottom: 780 }, 80, 20, 0, 800)).toBe(
      true,
    );
  });

  it("uses the larger of the header bottom and the visible top as the effective top boundary", () => {
    // visibleTop (120) exceeds headerBottomPx (80) — e.g. a visualViewport
    // that has scrolled down relative to the layout viewport.
    expect(isCardAlreadyFullyVisible({ top: 100, bottom: 300 }, 80, 0, 120, 800)).toBe(
      false,
    );
    expect(isCardAlreadyFullyVisible({ top: 130, bottom: 300 }, 80, 0, 120, 800)).toBe(
      true,
    );
  });

  it("is true exactly at the boundary (top === effectiveTop, bottom === effectiveBottom)", () => {
    expect(isCardAlreadyFullyVisible({ top: 80, bottom: 780 }, 80, 20, 0, 800)).toBe(
      true,
    );
  });
});
