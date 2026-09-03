/**
 * Whether a route card (or its bottom-anchored switch-guard prompt) is
 * already fully visible between the sticky header and the bottom of the
 * visible viewport, so a caller can skip an unnecessary scroll. `visibleTop`
 * and `visibleBottom` describe the visible viewport band (e.g. derived from
 * `window.visualViewport`); `headerBottomPx` additionally raises the
 * effective top boundary to clear a sticky header that overlaps the top of
 * that band. `bottomCushionPx` reserves a little breathing room (e.g. a
 * safe-area inset) at the bottom.
 */
export function isCardAlreadyFullyVisible(
  cardRect: { top: number; bottom: number },
  headerBottomPx: number,
  bottomCushionPx: number,
  visibleTopPx: number,
  visibleBottomPx: number,
): boolean {
  const effectiveTop = Math.max(headerBottomPx, visibleTopPx);
  const effectiveBottom = visibleBottomPx - bottomCushionPx;
  return cardRect.top >= effectiveTop && cardRect.bottom <= effectiveBottom;
}
