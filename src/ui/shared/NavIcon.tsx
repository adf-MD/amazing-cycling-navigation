import type { ReactNode } from "react";
import type { Screen } from "./screenTypes.ts";

export interface NavIconProps {
  screen: Screen;
  sizePx?: number;
}

const DEFAULT_SIZE_PX = 22;

function RoutesGlyph() {
  return (
    <>
      <rect x={4} y={6} width={16} height={2} rx={1} />
      <rect x={4} y={11} width={12} height={2} rx={1} />
      <rect x={4} y={16} width={8} height={2} rx={1} />
    </>
  );
}

function RideGlyph() {
  return (
    <path
      d="M6 18 L10 10 H15 L18 18 M10 10 L13.5 18 M15 10 V6.5 M13 6.5 H16.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function RideWheels() {
  return (
    <>
      <circle cx={6} cy={18} r={3} fill="none" stroke="currentColor" strokeWidth={1.8} />
      <circle cx={18} cy={18} r={3} fill="none" stroke="currentColor" strokeWidth={1.8} />
    </>
  );
}

function PlanGlyph() {
  return (
    <>
      <path
        d="M4 18 L9 12 L15 14 L20 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="0.5 3.5"
      />
      <circle cx={4} cy={18} r={2} />
      <circle cx={20} cy={6} r={2} />
    </>
  );
}

function DiagnosticsGlyph() {
  return (
    <path
      d="M3 13 H8 L10.5 6 L13.5 19 L16 13 H21"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function SettingsGlyph() {
  return (
    <>
      <circle cx={12} cy={12} r={4} fill="none" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M12 3 V5.5 M12 18.5 V21 M21 12 H18.5 M5.5 12 H3 M18.5 5.5 L16.8 7.2 M7.2 16.8 L5.5 18.5 M18.5 18.5 L16.8 16.8 M7.2 7.2 L5.5 5.5"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </>
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
 * The switch has a real, reachable `default` branch (falls back to the
 * Routes glyph) rather than being exhaustive-only, mirroring
 * ManoeuvreIcon's own defensive style even though `Screen` is a closed
 * union with no external/stored data feeding it today.
 */
export function NavIcon({ screen, sizePx = DEFAULT_SIZE_PX }: NavIconProps) {
  let glyph: ReactNode;
  switch (screen) {
    case "library":
      glyph = <RoutesGlyph />;
      break;
    case "riding":
      glyph = (
        <>
          <RideWheels />
          <RideGlyph />
        </>
      );
      break;
    case "planning":
      glyph = <PlanGlyph />;
      break;
    case "diagnostics":
      glyph = <DiagnosticsGlyph />;
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
