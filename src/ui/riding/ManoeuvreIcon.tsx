import type { ReactNode } from "react";
import type { ManoeuvreType } from "../../domain/types.ts";

export interface ManoeuvreIconProps {
  type: ManoeuvreType;
  sizePx?: number;
}

const DEFAULT_SIZE_PX = 24;

/** Rotation (degrees clockwise from "straight ahead") for every
 * directional variant. Roundabout/u-turn/waypoint/finish use their own
 * distinct glyph instead of a rotated arrow (below). */
const DIRECTIONAL_ROTATION_DEGREES: Partial<Record<ManoeuvreType, number>> = {
  "sharp-left": -135,
  left: -90,
  "slight-left": -35,
  continue: 0,
  start: 0,
  "slight-right": 35,
  right: 90,
  "sharp-right": 135,
};

/** A plain forward-pointing arrowhead-on-a-stem, the shared base shape for
 * every directional variant (rotated around its own centre) and the
 * fallback for "continue"/"start"/"unknown"/any unrecognised runtime
 * value — direction/meaning is always carried by the adjacent instruction
 * text, never by the icon alone. */
function ForwardArrow({ rotationDegrees = 0 }: { rotationDegrees?: number }) {
  return (
    <path
      d="M12 3 L19 12 L14.5 12 L14.5 21 L9.5 21 L9.5 12 L5 12 Z"
      transform={rotationDegrees ? `rotate(${String(rotationDegrees)} 12 12)` : undefined}
    />
  );
}

function UTurnGlyph() {
  return (
    <path
      d="M8 20 V11 A4 4 0 0 1 16 11 V15 M12.5 11.5 L16 15 L19.5 11.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function RoundaboutGlyph() {
  return (
    <>
      <circle cx={12} cy={12} r={7} fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M12 5 L15 8 L12 8 Z" />
    </>
  );
}

function WaypointGlyph() {
  return <circle cx={12} cy={12} r={5} />;
}

function FinishGlyph() {
  return (
    <>
      <line x1={7} y1={4} x2={7} y2={21} stroke="currentColor" strokeWidth={2} />
      <path d="M7 5 H18 L14.5 8.5 L18 12 H7 Z" />
    </>
  );
}

/**
 * A small, project-owned, dependency-free direction icon — no external
 * asset or map glyph/sprite. All visual styling is inline (never a CSS
 * class): this project's Vitest environment never loads index.css
 * (`test: { css: false }` in vite.config.ts), and a class-only element
 * has rendered invisible in production before for exactly that reason
 * (see GradientColourSwatch's own doc comment). Always `aria-hidden` —
 * the caller must render adjacent real text carrying the accessible
 * meaning, matching this project's "never colour/shape alone" convention.
 *
 * The switch below has a real, reachable `default` branch rather than an
 * exhaustive lookup: Manoeuvre.type can hold a legacy raw provider code
 * string for a route saved before this canonical vocabulary existed
 * (Dexie never validates stored data against the TS type), so this must
 * degrade to the generic forward-arrow glyph rather than rendering
 * nothing or throwing.
 */
export function ManoeuvreIcon({ type, sizePx = DEFAULT_SIZE_PX }: ManoeuvreIconProps) {
  let glyph: ReactNode;
  switch (type) {
    case "u-turn":
      glyph = <UTurnGlyph />;
      break;
    case "roundabout":
      glyph = <RoundaboutGlyph />;
      break;
    case "waypoint":
      glyph = <WaypointGlyph />;
      break;
    case "finish":
      glyph = <FinishGlyph />;
      break;
    case "sharp-left":
    case "left":
    case "slight-left":
    case "continue":
    case "start":
    case "slight-right":
    case "right":
    case "sharp-right":
      glyph = <ForwardArrow rotationDegrees={DIRECTIONAL_ROTATION_DEGREES[type]} />;
      break;
    default:
      // "unknown", or any non-canonical legacy runtime value.
      glyph = <ForwardArrow rotationDegrees={0} />;
      break;
  }

  return (
    <svg
      aria-hidden="true"
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
