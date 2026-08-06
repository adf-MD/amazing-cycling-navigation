export interface PinIconProps {
  filled: boolean;
  sizePx?: number;
}

const DEFAULT_SIZE_PX = 20;

/**
 * A small, project-owned, dependency-free pushpin icon — no external asset
 * or icon font, and not copied from any icon library. Stays upright in
 * both states (never rotated); only the fill/outline treatment changes,
 * mirroring `ManoeuvreIcon`'s convention that the icon alone never carries
 * the state — the caller's colour/surface/border and its own aria-pressed/
 * aria-label carry the pinned/unpinned distinction. All visual styling is
 * inline (never a CSS class): this project's Vitest environment never
 * loads index.css (`test: { css: false }` in vite.config.ts), and a
 * class-only-styled SVG has rendered invisible in production before for
 * exactly that reason. Always `aria-hidden` — the caller must render the
 * real accessible label alongside it.
 */
export function PinIcon({ filled, sizePx = DEFAULT_SIZE_PX }: PinIconProps) {
  return (
    <svg
      aria-hidden="true"
      width={sizePx}
      height={sizePx}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M9 3.5 H15 V5 L14 6 V11 L18 15 V16.5 H13 V21 L12 22.5 L11 21 V16.5 H6 V15 L10 11 V6 L9 5 Z" />
    </svg>
  );
}
