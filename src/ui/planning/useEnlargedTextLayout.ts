import { useLayoutEffect, useState, type RefObject } from "react";
import { isEnlargedTextLayout } from "./enlargedTextLayout.ts";

/**
 * Backlog item 114: whether Planning should use its enlarged-text layout,
 * re-evaluated whenever the map resizes or the root font size changes.
 *
 * Measured in a layout effect, like SettingsSection's sticky heights, so an
 * enlarged page never paints the ordinary layout first. The map container
 * catches size changes; `fontProbeRef` must be an element whose own size
 * follows the root font size (the placement control, whose label is in
 * rem), because a font-size change alone need not resize the map. Returns
 * false wherever layout is unavailable (jsdom), which keeps the ordinary
 * layout — exactly today's — as the default.
 */
export function useEnlargedTextLayout(
  mapRef: RefObject<HTMLElement | null>,
  fontProbeRef: RefObject<HTMLElement | null>,
): boolean {
  const [isEnlarged, setIsEnlarged] = useState(false);

  useLayoutEffect(() => {
    const evaluate = () => {
      const map = mapRef.current;
      if (!map) return;
      const box = map.getBoundingClientRect();
      const rootFontPx = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      setIsEnlarged((wasEnlarged) =>
        isEnlargedTextLayout(
          { widthPx: box.width, heightPx: box.height, rootFontPx },
          wasEnlarged,
        ),
      );
    };
    evaluate();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(evaluate);
    if (mapRef.current) observer.observe(mapRef.current);
    if (fontProbeRef.current) observer.observe(fontProbeRef.current);
    return () => {
      observer.disconnect();
    };
  }, [mapRef, fontProbeRef]);

  return isEnlarged;
}
