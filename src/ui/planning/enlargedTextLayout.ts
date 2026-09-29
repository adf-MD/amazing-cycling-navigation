/**
 * Backlog item 114: when does Planning switch to its enlarged-text layout?
 *
 * At ordinary text Planning's attribution, imagery/status messages and
 * placement control all share the map. At enlarged browser text they no
 * longer fit inside it: at 200% the attribution wraps into the placement
 * control, and the imagery banner grows taller than the map's free area.
 * The enlarged layout moves the attribution to a strip directly below the
 * map, lowers the placement control, and puts the messages in normal flow.
 *
 * The switch is a ratio of the map's own size to the root font size, never
 * the font size alone: the collisions come from text (which scales with
 * rem) against map pixels, so this also catches browser page zoom (where
 * the map shrinks while the root stays 16px) and never fires merely because
 * a desktop's default font is large.
 *
 * 17 was derived from item 114's measured onset sweep (pinned Playwright
 * container, Chromium and WebKit), not picked:
 *
 *   size       engages at        ordinary layout first fails at
 *   375x667    110% (height)     120%
 *   320x844    106% (width)      135%
 *   390x844    132% (width)      150%
 *   430x932    146% (width)      175%
 *
 * It never engages at 100% text: the smallest ordinary ratios are 18
 * (width, at 320px) and 17.5 (height, at the map's 280px floor). Because
 * the floor is 17.5rem at 16px, even a keyboard that shrank the layout
 * viewport and pushed the map to that floor cannot engage it.
 *
 * Nothing the switch itself changes feeds back into these inputs: the
 * enlarged layout never resizes the map. The release threshold sits a
 * quarter rem higher than the engage threshold only so that sub-pixel
 * rounding at the boundary cannot flip the layout back and forth.
 */
export const ENLARGED_TEXT_ENGAGE_RATIO = 17;
export const ENLARGED_TEXT_RELEASE_RATIO = 17.25;

export interface EnlargedTextLayoutInputs {
  widthPx: number;
  heightPx: number;
  rootFontPx: number;
}

function isUsable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** True when Planning should use its enlarged-text layout. Invalid or
 * missing measurements (jsdom reports zero sizes) always mean the ordinary
 * layout, which is exactly today's. */
export function isEnlargedTextLayout(
  { widthPx, heightPx, rootFontPx }: EnlargedTextLayoutInputs,
  wasEnlarged: boolean,
): boolean {
  if (!isUsable(widthPx) || !isUsable(heightPx) || !isUsable(rootFontPx)) return false;
  const widthRatio = widthPx / rootFontPx;
  const heightRatio = heightPx / rootFontPx;
  if (wasEnlarged) {
    return (
      widthRatio < ENLARGED_TEXT_RELEASE_RATIO ||
      heightRatio < ENLARGED_TEXT_RELEASE_RATIO
    );
  }
  return (
    widthRatio < ENLARGED_TEXT_ENGAGE_RATIO || heightRatio < ENLARGED_TEXT_ENGAGE_RATIO
  );
}
