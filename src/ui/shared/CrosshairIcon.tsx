export interface CrosshairIconProps {
  sizePx?: number;
}

const DEFAULT_SIZE_PX = 22;
const VIEWBOX_UNITS = 24;
const STROKE_PX = 2;

/**
 * The position-indicator crosshair shared by Riding and free roam's
 * "Follow my location" control and Planning's "Locate me" control
 * (item 110 presentation follow-up).
 *
 * It reproduces the same motif the controls carried before — a ring with
 * four axis ticks reaching past it — rather than substituting a location
 * pin, a locate-fixed glyph or anything resembling a direction of travel.
 * What changes is only how it is produced.
 *
 * Drawn rather than set as the character it used to be. That character
 * was rendered by whichever font in the system stack happened to carry
 * it — one on an installed iPhone, another in CI — so its box, weight
 * and optical size differed by platform, which is precisely the
 * inconsistency this follow-up exists to remove. As a path it is
 * identical everywhere and can be asserted exactly.
 *
 * Styling is inline rather than in a class, matching NorthArrowIcon and
 * NavIcon: Vitest never loads index.css (`test: { css: false }`), so a
 * class-based size would be invisible to every unit test.
 *
 * Always `aria-hidden` — the hosting button's own `aria-label` and, where
 * it has one, `aria-pressed` carry all the accessible meaning. The
 * buttons keep rendering their "Waiting…"/"Locating…" wording as text in
 * place of this glyph, unchanged.
 */
export function CrosshairIcon({ sizePx = DEFAULT_SIZE_PX }: CrosshairIconProps) {
  // Expressed in user units so the painted stroke is exactly STROKE_PX at
  // whatever size the icon is rendered, rather than scaling with the box.
  const strokeWidth = (STROKE_PX * VIEWBOX_UNITS) / sizePx;

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
      <circle cx={12} cy={12} r={5.5} />
      <circle cx={12} cy={12} r={1.3} fill="currentColor" stroke="none" />
      {/* Four axis ticks, starting clear of the ring so the gap reads at
       * small sizes, and stopping short of the viewBox edge so the round
       * caps cannot be clipped by the icon's own box. */}
      <path d="M12 1.5 V4.5 M12 19.5 V22.5 M1.5 12 H4.5 M19.5 12 H22.5" />
    </svg>
  );
}
