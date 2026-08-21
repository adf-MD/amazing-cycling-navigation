import type { ReactNode, Ref } from "react";

export interface RidingImmersiveHeaderProps {
  /** This screen's sole <h1> while active (backlog item 55) — mirrors the
   * idle-only `.ride-route-header`'s own <h1> exactly, so exactly one <h1>
   * matching the route name (or "Free roam") ever exists per render
   * regardless of state. Visually truncated to one line via CSS
   * (`.riding-immersive-header-title`) so it can never push Pause/End out
   * of the viewport; the accessible name is the full, untruncated text
   * content — CSS `text-overflow` never touches the DOM text — and a
   * native `title` attribute additionally surfaces it on hover/long-press
   * as a convenience, not as the accessibility mechanism. */
  title: string;
  pauseLabel: string;
  onPause: () => void;
  pauseDisabled: boolean;
  pauseButtonRef?: Ref<HTMLButtonElement>;
  /** Whatever the owning screen's own End-ride trigger currently renders
   * (button + inline error), or null while its confirmation is shown
   * elsewhere in the screen's own body instead. This component owns no
   * End-ride business logic, confirmation state, or error state —
   * layout/safe-area presentation only. */
  endAction: ReactNode;
}

/**
 * The compact, persistent Pause/title/End header shown while route Riding
 * or free roam is genuinely GPS-active (backlog item 55), replacing the
 * global MainNavigation for the duration — see immersiveRidingShell.ts.
 * Shared, purely presentational: RidingScreen and FreeRoamScreen each own
 * their own Pause/End business logic, focus management and error state,
 * passing actions and the End-ride slot in as props rather than this
 * component owning any of it.
 */
export function RidingImmersiveHeader({
  title,
  pauseLabel,
  onPause,
  pauseDisabled,
  pauseButtonRef,
  endAction,
}: RidingImmersiveHeaderProps) {
  return (
    <header className="riding-immersive-header">
      <div className="riding-immersive-header-start">
        <button
          type="button"
          className="btn-secondary"
          ref={pauseButtonRef}
          onClick={onPause}
          disabled={pauseDisabled}
        >
          {pauseLabel}
        </button>
      </div>
      <h1 className="screen-title riding-immersive-header-title" title={title}>
        {title}
      </h1>
      <div className="riding-immersive-header-end">{endAction}</div>
    </header>
  );
}
