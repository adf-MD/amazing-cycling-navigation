import type { ReactNode, SVGProps } from "react";
import type { PrimaryDestination } from "./screenTypes.ts";

export interface NavIconProps {
  destination: PrimaryDestination;
  sizePx?: number;
}

const DEFAULT_SIZE_PX = 22;

/** 2 px painted at the 22 px default box (2 × 24 / 22), the same line as
 * CrosshairIcon's. Kept as the approved mock-up's literal value. */
const STROKE_WIDTH = 2.18;

/** The shared line style: one weight, round caps and joins throughout. */
const LINE: SVGProps<SVGGElement> = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: STROKE_WIDTH,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/** An 8-tooth gear: trapezoid teeth with a tip radius of 9.8 and a root
 * radius of 7.5 units, computed once for backlog item 102's mock-ups. */
const GEAR_PATH =
  "M10.38 4.68L10.72 2.28A9.8 9.8 0 0 1 13.28 2.28L13.62 4.68A7.5 7.5 0 0 1 16.03 5.67" +
  "L16.03 5.67L17.97 4.23A9.8 9.8 0 0 1 19.77 6.03L18.33 7.97A7.5 7.5 0 0 1 19.32 10.38" +
  "L19.32 10.38L21.72 10.72A9.8 9.8 0 0 1 21.72 13.28L19.32 13.62A7.5 7.5 0 0 1 18.33 16.03" +
  "L18.33 16.03L19.77 17.97A9.8 9.8 0 0 1 17.97 19.77L16.03 18.33A7.5 7.5 0 0 1 13.62 19.32" +
  "L13.62 19.32L13.28 21.72A9.8 9.8 0 0 1 10.72 21.72L10.38 19.32A7.5 7.5 0 0 1 7.97 18.33" +
  "L7.97 18.33L6.03 19.77A9.8 9.8 0 0 1 4.23 17.97L5.67 16.03A7.5 7.5 0 0 1 4.68 13.62" +
  "L4.68 13.62L2.28 13.28A9.8 9.8 0 0 1 2.28 10.72L4.68 10.38A7.5 7.5 0 0 1 5.67 7.97" +
  "L5.67 7.97L4.23 6.03A9.8 9.8 0 0 1 6.03 4.23L7.97 5.67A7.5 7.5 0 0 1 10.38 4.68Z";

/** A bulleted list: square bullets, so it cannot read as a hamburger. */
function RoutesGlyph() {
  return (
    <>
      <rect x={3} y={5} width={3.4} height={3.4} rx={0.8} />
      <rect x={3} y={10.3} width={3.4} height={3.4} rx={0.8} />
      <rect x={3} y={15.6} width={3.4} height={3.4} rx={0.8} />
      <g {...LINE}>
        <path d="M10.2 6.7H20.8M10.2 12H20.8M10.2 17.3H20.8" />
      </g>
    </>
  );
}

/** A bicycle with only four frame tubes, a saddle and a T bar: a full
 * diamond frame merged into a blob at 22 px. */
function RideGlyph() {
  return (
    <g {...LINE}>
      <circle cx={5.3} cy={15.9} r={3.8} />
      <circle cx={18.7} cy={15.9} r={3.8} />
      <path d="M5.3 15.9L9.6 9.2H15.4L18.7 15.9M9.6 9.2L12.6 15.9M15.4 9.2V5.9M13.9 5.9H16.9M9.6 9.2L9.1 6.4M7.7 6.4H10.3" />
    </g>
  );
}

/** The winding route as a dotted trail at the line's own weight, with a dot
 * at each end. Dotted on purpose: a continuous line along this course reads
 * as a chart at 22 px, a dotted one as a trail to follow. */
function PlanGlyph() {
  return (
    <>
      <g {...LINE} strokeDasharray="0.01 3.7">
        <path d="M4 18L9 12L15 14L20 6" />
      </g>
      <circle cx={4} cy={18} r={2.4} />
      <circle cx={20} cy={6} r={2.4} />
    </>
  );
}

function SettingsGlyph() {
  return (
    <g {...LINE}>
      <path d={GEAR_PATH} />
      <circle cx={12} cy={12} r={2.7} />
    </g>
  );
}

/**
 * A small, project-owned, dependency-free destination icon for the main
 * navigation — no external asset, icon library, or map glyph/sprite. All
 * visual styling is inline (never a CSS class): this project's Vitest
 * environment never loads index.css (`test: { css: false }` in
 * vite.config.ts), and a class-only element has rendered invisible in
 * production before for exactly that reason (see GradientColourSwatch's
 * own doc comment). Always `aria-hidden` — the caller renders the visible
 * text label carrying the accessible meaning, matching ManoeuvreIcon's
 * existing convention and this project's "never colour/shape alone" rule.
 *
 * Backlog item 102 chose this family from measured mock-ups
 * (docs/design/navigation-symbols/): a list, a bicycle and a gear drawn in
 * one 2 px line, with Plan's dotted trail kept from the icons before it
 * and redrawn at that line's weight. The glyphs are transcribed from the
 * approved mock-up, contain no text, and draw the same shape whether or not
 * their tab is selected — the selected state is the button's own surface
 * and ring (index.css).
 *
 * The switch has a real, reachable `default` branch (falls back to the
 * Routes glyph) rather than being exhaustive-only, mirroring
 * ManoeuvreIcon's own defensive style even though `PrimaryDestination` is
 * a closed union with no external/stored data feeding it today. Keyed on
 * the four primary destinations since backlog item 121, which removed
 * Status from the navigation and with it the pulse-line glyph.
 */
export function NavIcon({ destination, sizePx = DEFAULT_SIZE_PX }: NavIconProps) {
  let glyph: ReactNode;
  switch (destination) {
    case "library":
      glyph = <RoutesGlyph />;
      break;
    case "riding":
      glyph = <RideGlyph />;
      break;
    case "planning":
      glyph = <PlanGlyph />;
      break;
    case "settings":
      glyph = <SettingsGlyph />;
      break;
    default:
      glyph = <RoutesGlyph />;
      break;
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={sizePx}
      height={sizePx}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ display: "block", flexShrink: 0 }}
    >
      {glyph}
    </svg>
  );
}
