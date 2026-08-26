import type { Clock } from "../../platform/clock.ts";
import type { WakeLockSource } from "../../platform/wakeLock.ts";
import { useScreenWakeLock } from "./useScreenWakeLock.ts";

export interface RidingWakeLockControlProps {
  /** The rider's desired on/off preference for this active ride. */
  desired: boolean;
  onToggleDesired: (next: boolean) => void;
  wakeLockSource?: WakeLockSource;
  clock?: Clock;
}

/**
 * Riding-only "keep the screen on" control. Only ever rendered while the
 * Screen Wake Lock API is available and a ride is active (see
 * RidingScreen) — this component's own mount/unmount lifetime is what
 * useScreenWakeLock relies on to release the lock when riding stops, the
 * route is cleared, or the rider leaves the screen.
 *
 * Accessibility: `aria-pressed` always reflects the rider's *desired*
 * state, never whether a lock is currently actually held — that
 * distinction is communicated separately via a freshly mounted
 * `role="status"`/`role="alert"` element, which is itself what triggers
 * (or doesn't trigger) an assistive-technology announcement. This keeps
 * announcements to meaningful transitions only (activation, failure),
 * with no continuously-updating live region and no extra bookkeeping. The
 * success status element is visually hidden (backlog item 68 — a
 * permanent visible "Screen staying awake." line was judged too much
 * scarce vertical space for a compact shared status area) but stays
 * mounted in the accessibility tree exactly as before, so the
 * announcement itself is unchanged — only its visibility is.
 *
 * The visible "On"/"Off" state span is `aria-hidden` (backlog item 82):
 * `aria-pressed` alone already conveys the semantic state, so the text is
 * a non-colour visual cue only, not a second announcement. Because it is
 * excluded from accessible-name computation, the button's accessible name
 * still resolves to exactly "Screen on" from its one remaining visible
 * text node. The battery/behaviour explanation previously behind an
 * in-context information popover now lives in Settings instead (item 82)
 * — this component owns no disclosure state any more.
 */
export function RidingWakeLockControl({
  desired,
  onToggleDesired,
  wakeLockSource,
  clock,
}: RidingWakeLockControlProps) {
  const { status, retry } = useScreenWakeLock({ desired, wakeLockSource, clock });

  return (
    <div className="ride-wake-lock-control">
      <button
        type="button"
        className="wake-lock-toggle"
        aria-pressed={desired}
        onClick={() => {
          onToggleDesired(!desired);
        }}
      >
        <span className="wake-lock-toggle-label">Screen on</span>
        <span className="wake-lock-toggle-state" aria-hidden="true">
          {desired ? "On" : "Off"}
        </span>
      </button>
      {status === "active" ? (
        <span role="status" className="visually-hidden">
          Screen staying awake.
        </span>
      ) : null}
      {status === "unavailable" ? (
        <div role="alert" className="wake-lock-failure-row">
          <p>The screen could not be kept awake.</p>
          <button type="button" onClick={retry}>
            Tap to try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
