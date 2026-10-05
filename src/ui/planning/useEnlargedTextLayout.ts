import { useLayoutEffect, useState, type RefObject } from "react";
import { isEnlargedTextLayout } from "./enlargedTextLayout.ts";

/**
 * Backlog item 114: whether Planning should use its enlarged-text layout,
 * re-evaluated whenever the measured box resizes or the root font size
 * changes.
 *
 * Measured in a layout effect, like SettingsSection's sticky heights, so an
 * enlarged page never paints the ordinary layout first. `sizeRef` is the
 * box the decision reads. Since item 122 that is Planning's invisible size
 * reference, which has the map's width and always the enlarged layout's
 * height, not the map itself, whose ordinary height is taller: the switch
 * then decides at item 114's accepted points, and the map's own change in
 * height on a switch never feeds back into the decision. `fontProbeRef`
 * must be an element whose own size follows the root font size (the
 * placement control, whose label is in rem), because a font-size change
 * alone need not resize the measured box. Returns false wherever layout is
 * unavailable (jsdom), which keeps the ordinary layout as the default.
 */
export function useEnlargedTextLayout(
  sizeRef: RefObject<HTMLElement | null>,
  fontProbeRef: RefObject<HTMLElement | null>,
): boolean {
  const [isEnlarged, setIsEnlarged] = useState(false);

  useLayoutEffect(() => {
    const evaluate = () => {
      const sized = sizeRef.current;
      if (!sized) return;
      const box = sized.getBoundingClientRect();
      // A classic (non-overlay) desktop scrollbar narrows the measured box by
      // about 15px — more than the 0.25rem hysteresis — and since item 122
      // engaging shortens the map by up to 100px, which can make the page
      // stop scrolling. Without this, near that height the scrollbar would
      // come and go with each switch and the layout would flip continuously
      // (e2e/planningEnlargedTextScrollbar.spec.ts). Adding back whatever
      // width the scrollbar takes makes the width input the same with or
      // without it. Overlay scrollbars, as on the iPhone, take none, and
      // jsdom reports no client width, so both read 0 here.
      const root = document.documentElement;
      const scrollbarWidth =
        root.clientWidth > 0 ? Math.max(0, window.innerWidth - root.clientWidth) : 0;
      const rootFontPx = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      setIsEnlarged((wasEnlarged) =>
        isEnlargedTextLayout(
          { widthPx: box.width + scrollbarWidth, heightPx: box.height, rootFontPx },
          wasEnlarged,
        ),
      );
    };
    evaluate();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(evaluate);
    if (sizeRef.current) observer.observe(sizeRef.current);
    if (fontProbeRef.current) observer.observe(fontProbeRef.current);
    return () => {
      observer.disconnect();
    };
  }, [sizeRef, fontProbeRef]);

  return isEnlarged;
}
