import { describe, expect, it } from "vitest";
import {
  ENLARGED_TEXT_ENGAGE_RATIO,
  ENLARGED_TEXT_RELEASE_RATIO,
  isEnlargedTextLayout,
} from "./enlargedTextLayout.ts";

// The switch's inputs: the map's width and, since item 122, the size
// reference's height, which keeps the map's earlier height (44dvh between
// 280 and 460px). These are the map sizes item 114's Stage 1 measured
// (pinned container), which that reference reproduces.
const MAP_390x844 = { widthPx: 358, heightPx: 380 };
const MAP_320x844 = { widthPx: 288, heightPx: 380 };
const MAP_375x667 = { widthPx: 343, heightPx: 300 };
const MAP_HEIGHT_FLOOR_PX = 280;

describe("isEnlargedTextLayout", () => {
  it("keeps the ordinary layout at 100% text at every supported portrait size", () => {
    for (const map of [MAP_390x844, MAP_320x844, MAP_375x667]) {
      expect(isEnlargedTextLayout({ ...map, rootFontPx: 16 }, false)).toBe(false);
    }
  });

  it("keeps the ordinary layout at 100% text even with the size reference at its 280px floor, as a layout-resizing keyboard could leave it", () => {
    expect(
      isEnlargedTextLayout(
        { widthPx: 358, heightPx: MAP_HEIGHT_FLOOR_PX, rootFontPx: 16 },
        false,
      ),
    ).toBe(false);
  });

  it("uses the enlarged layout at 200% text at every supported portrait size", () => {
    for (const map of [MAP_390x844, MAP_320x844, MAP_375x667]) {
      expect(isEnlargedTextLayout({ ...map, rootFontPx: 32 }, false)).toBe(true);
    }
  });

  it("engages on either axis alone", () => {
    // 375x667 at 112%: wide enough, too short.
    expect(isEnlargedTextLayout({ ...MAP_375x667, rootFontPx: 17.92 }, false)).toBe(true);
    // 320x844 at 112%: tall enough, too narrow.
    expect(isEnlargedTextLayout({ ...MAP_320x844, rootFontPx: 17.92 }, false)).toBe(true);
    // 390x844 at 112%: neither.
    expect(isEnlargedTextLayout({ ...MAP_390x844, rootFontPx: 17.92 }, false)).toBe(
      false,
    );
  });

  it("engages strictly below the engage ratio and releases only at the release ratio", () => {
    const rootFontPx = 20;
    const at = (ratio: number, wasEnlarged: boolean) =>
      isEnlargedTextLayout(
        { widthPx: ratio * rootFontPx, heightPx: 1000, rootFontPx },
        wasEnlarged,
      );
    expect(at(ENLARGED_TEXT_ENGAGE_RATIO, false)).toBe(false);
    expect(at(ENLARGED_TEXT_ENGAGE_RATIO - 0.01, false)).toBe(true);
    // Between the two thresholds the current layout is kept.
    const between = (ENLARGED_TEXT_ENGAGE_RATIO + ENLARGED_TEXT_RELEASE_RATIO) / 2;
    expect(at(between, false)).toBe(false);
    expect(at(between, true)).toBe(true);
    expect(at(ENLARGED_TEXT_RELEASE_RATIO, true)).toBe(false);
  });

  it("treats missing or invalid measurements as the ordinary layout", () => {
    for (const inputs of [
      { widthPx: 0, heightPx: 0, rootFontPx: 16 },
      { widthPx: 358, heightPx: 380, rootFontPx: Number.NaN },
      { widthPx: Number.NaN, heightPx: 380, rootFontPx: 32 },
      { widthPx: 358, heightPx: -1, rootFontPx: 32 },
      { widthPx: Number.POSITIVE_INFINITY, heightPx: 380, rootFontPx: 32 },
    ]) {
      expect(isEnlargedTextLayout(inputs, false)).toBe(false);
      expect(isEnlargedTextLayout(inputs, true)).toBe(false);
    }
  });
});
