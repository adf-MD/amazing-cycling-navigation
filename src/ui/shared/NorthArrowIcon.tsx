import { toDisplayBearingDegrees } from "../../navigation/bearing.ts";

export interface NorthArrowIconProps {
  /**
   * The map's current bearing — the compass direction presently drawn at
   * the top of the screen — as last reported by a settled (or
   * just-commanded) camera. The arrow is rotated by the NEGATIVE of this,
   * so that it keeps pointing at geographic north on the rotated map; the
   * negation lives here, exactly once, so no call site can get the sign
   * wrong and no screen can disagree with another.
   *
   * `null` when the camera has never settled, or has returned to a
   * north-up overview fit. Rendered unrotated (north already up), never
   * hidden — the control must never flicker in and out of existence.
   */
  bearingDegrees: number | null;
  sizePx?: number;
}

const DEFAULT_SIZE_PX = 22;

/**
 * The north-pointing arrow shared by all three north-up map controls —
 * Riding, free roam and Planning (backlog item 110). A small,
 * project-owned, dependency-free glyph: no external asset, no icon
 * library, and deliberately not `src/map/routeArrowIcon.ts`, which is a
 * raw RGBA bitmap authored pointing along +x for MapLibre's own
 * `icon-rotation-alignment: "map"` symbols.
 *
 * Derived from the map camera's own bearing and nothing else. There is no
 * compass, device-orientation subscription or heading sensor anywhere
 * behind this, and no per-frame listener: the value updates when the
 * camera settles, which is what makes the whole feature free. (The
 * hyphenation is deliberate: sensorFreeSource.test.ts scans for the
 * literal API tokens, and cannot tell prose from a real call.)
 *
 * All visual styling is inline (never a CSS class), matching
 * NavIcon.tsx/ManoeuvreIcon.tsx: this project's Vitest environment never
 * loads index.css (`test: { css: false }` in vite.config.ts), so a
 * class-only rotation would be invisible to every unit test — and a
 * class-only element has rendered invisible in production before for
 * exactly that reason. `margin: 0 auto` centres the block-level glyph
 * inside the 48px circular control without touching
 * `.ride-map-control`/`.planning-map-control` at all, so the existing
 * bounding-box and touch-target assertions stay byte-identical.
 *
 * The transform is applied to this `<svg>` only, never to the hosting
 * button: rotating the button would carry its border, focus ring and
 * pressed styling round with it.
 *
 * Always `aria-hidden` — the hosting button's own `aria-label` and
 * `aria-pressed` carry every bit of accessible meaning, matching
 * NavIcon's convention and this project's "never shape or colour alone"
 * rule.
 */
export function NorthArrowIcon({
  bearingDegrees,
  sizePx = DEFAULT_SIZE_PX,
}: NorthArrowIconProps) {
  // A final defensive boundary, not the first: the camera hooks already
  // normalise at their own reducer boundary, and Planning's settled
  // orientation comes straight from the map. This still guards the case
  // of a caller handing over a raw or corrupt value, so an invalid CSS
  // rotate() can never be emitted from here.
  const normalisedBearingDegrees =
    bearingDegrees === null ? null : toDisplayBearingDegrees(bearingDegrees);
  const rotationDegrees =
    normalisedBearingDegrees === null ? 0 : -normalisedBearingDegrees;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={sizePx}
      height={sizePx}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{
        display: "block",
        margin: "0 auto",
        flexShrink: 0,
        transform: `rotate(${String(rotationDegrees)}deg)`,
      }}
    >
      {/* A solid kite pointing straight up at 0 degrees, symmetric about
       * x=12 and spanning y 3..20.5 so its own visual centre sits close
       * to the viewBox centre the default transform-origin rotates
       * about. Filled rather than stroked so it stays legible both as
       * dark-on-light and, when the control is pressed, as white on the
       * accent background. */}
      <path d="M12 3 L19 20.5 L12 16 L5 20.5 Z" />
    </svg>
  );
}
