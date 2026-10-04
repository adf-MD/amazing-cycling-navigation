import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { revealSelectedWarning } from "./warningReveal.ts";

// Backlog item 124, slice 10 (P-18). jsdom has no layout and no
// visualViewport, and its window.innerHeight is 768, so with a 60px
// sticky header and no safe-area inset the usable band is 68..760: 8px
// below the header, and 8px above the bottom. Real-browser geometry is
// proved in e2e/planningWarningMapReveal.smoke.spec.ts.
const HEADER_BOTTOM = 60;
const BAND_TOP = 68;
const BAND_BOTTOM = 760;

function itemAt(top: number, bottom: number): HTMLElement {
  const item = document.createElement("li");
  item.getBoundingClientRect = () => ({
    top,
    bottom,
    left: 0,
    right: 358,
    width: 358,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => "",
  });
  return item;
}

describe("revealSelectedWarning", () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollBy = window.scrollBy;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalMatchMedia = window.matchMedia;
  let scrolls: ScrollToOptions[];

  beforeEach(() => {
    scrolls = [];
    window.scrollBy = (options?: ScrollToOptions | number) => {
      if (typeof options === "object") scrolls.push(options);
    };
  });

  afterEach(() => {
    window.scrollBy = originalScrollBy;
    window.matchMedia = originalMatchMedia;
    document.documentElement.style.removeProperty("--safe-area-inset-bottom");
  });

  it("does not move an item that is already inside the band", () => {
    expect(revealSelectedWarning(itemAt(300, 400), HEADER_BOTTOM)).toBe(0);
    expect(scrolls).toEqual([]);
  });

  it("brings an item arriving from below up to the band's bottom, no further", () => {
    // The row's button inside the band, its details below it: the state
    // the button-only reveal left behind.
    expect(revealSelectedWarning(itemAt(700, 800), HEADER_BOTTOM)).toBe(
      800 - BAND_BOTTOM,
    );
    expect(scrolls).toEqual([{ top: 40, left: 0, behavior: "smooth" }]);
  });

  it("brings an item wholly below the screen up by the minimum", () => {
    expect(revealSelectedWarning(itemAt(1700, 1800), HEADER_BOTTOM)).toBe(
      1800 - BAND_BOTTOM,
    );
  });

  it("moves down only as far as shows an item above the band", () => {
    expect(revealSelectedWarning(itemAt(40, 140), HEADER_BOTTOM)).toBe(40 - BAND_TOP);
    expect(scrolls).toEqual([{ top: -28, left: 0, behavior: "smooth" }]);
  });

  it("aligns the beginning of an item taller than the band below the navigation", () => {
    // 900px tall against a 692px band: arriving from below, its top lands
    // 8px below the header rather than its bottom at the band's bottom.
    expect(revealSelectedWarning(itemAt(500, 1400), HEADER_BOTTOM)).toBe(500 - BAND_TOP);
  });

  it("aligns an oversized item whose beginning is above the band", () => {
    expect(revealSelectedWarning(itemAt(-200, 700), HEADER_BOTTOM)).toBe(-200 - BAND_TOP);
  });

  it("leaves an oversized item alone once its beginning is already aligned", () => {
    expect(revealSelectedWarning(itemAt(BAND_TOP, BAND_TOP + 900), HEADER_BOTTOM)).toBe(
      0,
    );
    expect(scrolls).toEqual([]);
  });

  it("treats sub-pixel misalignment as already in place", () => {
    expect(revealSelectedWarning(itemAt(700, BAND_BOTTOM + 0.6), HEADER_BOTTOM)).toBe(0);
  });

  it("keeps the item clear of the bottom safe-area inset as well as the gap", () => {
    // The same inline seam index.css documents and the e2e specs use.
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
    expect(revealSelectedWarning(itemAt(700, 800), HEADER_BOTTOM)).toBe(
      800 - (BAND_BOTTOM - 34),
    );
  });

  it("uses the viewport's top when there is no header", () => {
    expect(revealSelectedWarning(itemAt(-50, 50), 0)).toBe(-50 - 8);
  });

  it("does nothing for an item with no laid-out box", () => {
    expect(revealSelectedWarning(itemAt(0, 0), HEADER_BOTTOM)).toBe(0);
    expect(scrolls).toEqual([]);
  });

  it("moves at once when reduced motion is set", () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    })) as typeof window.matchMedia;
    revealSelectedWarning(itemAt(700, 800), HEADER_BOTTOM);
    expect(scrolls).toEqual([{ top: 40, left: 0, behavior: "auto" }]);
  });
});
