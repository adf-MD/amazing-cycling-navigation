export interface ZoomIconProps {
  /** "in" draws the plus, "out" the minus. */
  direction: "in" | "out";
  sizePx?: number;
}

const DEFAULT_SIZE_PX = 24;
const VIEWBOX_UNITS = 24;
const STROKE_PX = 2.5;

/** Both bars span this, centred — one length, used twice. */
const BAR_START = 4;
const BAR_END = 20;

/**
 * The zoom in/out glyphs shared by Planning, Riding and free roam
 * (item 110 presentation follow-up).
 *
 * One component with a direction, rather than two, so the plus and the
 * minus are matched **by construction**: the minus is the horizontal bar,
 * and the plus is that identical bar plus a vertical one of the same
 * length, same stroke width and same end caps. Two separately authored
 * glyphs would be free to drift apart in optical weight, which is exactly
 * what they did as text — `+` and `−` (U+2212) are drawn to different
 * weights in most system fonts, and differently again between platforms.
 *
 * Styling is inline rather than in a class, matching NorthArrowIcon and
 * NavIcon: Vitest never loads index.css (`test: { css: false }`).
 *
 * Always `aria-hidden`; the hosting button's `aria-label` carries the
 * meaning. Neither zoom increment nor any button behaviour is affected by
 * this component.
 */
export function ZoomIcon({ direction, sizePx = DEFAULT_SIZE_PX }: ZoomIconProps) {
  // Expressed in user units so the painted stroke is exactly STROKE_PX at
  // whatever size the icon is rendered.
  const strokeWidth = (STROKE_PX * VIEWBOX_UNITS) / sizePx;
  const horizontal = `M${String(BAR_START)} 12 H${String(BAR_END)}`;
  const vertical = `M12 ${String(BAR_START)} V${String(BAR_END)}`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={sizePx}
      height={sizePx}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      style={{ display: "block", margin: "0 auto", flexShrink: 0 }}
    >
      <path d={direction === "in" ? `${horizontal} ${vertical}` : horizontal} />
    </svg>
  );
}
