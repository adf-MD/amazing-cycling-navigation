export interface ConnectivityIconProps {
  online: boolean;
  sizePx?: number;
}

const DEFAULT_SIZE_PX = 16;

/**
 * A small, project-owned, dependency-free connectivity glyph (backlog item
 * 83) — no external asset or icon library. All visual styling is inline
 * (never a CSS class): this project's Vitest environment never loads
 * index.css (`test: { css: false }` in vite.config.ts), and a class-only
 * element has rendered invisible in production before for exactly that
 * reason (see ManoeuvreIcon.tsx's own doc comment). Always `aria-hidden` —
 * the caller renders the real "Online"/"Offline" accessible text alongside
 * it, matching this project's "never colour/shape alone" convention: the
 * offline variant differs by an added diagonal strike, a genuine shape
 * difference, not merely a `currentColor` swap.
 */
export function ConnectivityIcon({
  online,
  sizePx = DEFAULT_SIZE_PX,
}: ConnectivityIconProps) {
  return (
    <svg
      aria-hidden="true"
      width={sizePx}
      height={sizePx}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx={12} cy={19} r={1.7} fill="currentColor" />
      <path
        d="M8.3 15.3a5.2 5.2 0 0 1 7.4 0"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M4.9 11.9a10.2 10.2 0 0 1 14.2 0"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {online ? null : (
        <line
          x1={3.5}
          y1={3.5}
          x2={20.5}
          y2={20.5}
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
