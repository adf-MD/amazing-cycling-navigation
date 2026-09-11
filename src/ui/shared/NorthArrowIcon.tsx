import { toDisplayBearingDegrees } from "../../navigation/bearing.ts";
import {
  DART_PATH,
  NORTH_ARROW_SIZE_PX,
  NORTH_LETTER_PATH,
  ROTATION_CENTRE,
} from "./northArrowGeometry.ts";

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
  /**
   * Whether the hosting control is currently in its pressed state.
   *
   * A semantic flag, deliberately not a colour: the two established
   * tokens are resolved inside this component so all three screens
   * cannot drift apart, and no call site ever passes a colour string or
   * a CSS-variable expression of its own.
   */
  isPressed?: boolean;
  sizePx?: number;
}

const DEFAULT_SIZE_PX = NORTH_ARROW_SIZE_PX;

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
  isPressed = false,
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
  const [centreX, centreY] = ROTATION_CENTRE;
  // The letter is a hole punched in the pointer, so it takes the colour
  // the button is painting behind it: the ordinary surface when idle, the
  // accent when pressed. That is what produces the inverse pairing —
  // dark pointer with a light letter, light pointer with an accent one —
  // with no second colour rule and no badge, disc or halo behind it.
  const letterFill = isPressed ? "var(--colour-accent)" : "var(--colour-bg)";

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
       * accent background. The silhouette is item 110's, unchanged. */}
      <path d={DART_PATH} />
      {/* The upright N. The <svg> above already carries the CSS
       * rotate(-bearing), so this group's rotate(+bearing) about the very
       * same centre cancels it exactly and leaves the letter upright
       * while the pointer turns beneath it. Keeping both rotations inside
       * one <svg> matters: the north-up button is located in Playwright
       * with a strict-mode locator("svg"), which a second nested <svg>
       * would break with a locator error rather than a failed
       * assertion. */}
      <g
        transform={`rotate(${String(-rotationDegrees)} ${String(centreX)} ${String(centreY)})`}
      >
        <path d={NORTH_LETTER_PATH} fill={letterFill} />
      </g>
    </svg>
  );
}
