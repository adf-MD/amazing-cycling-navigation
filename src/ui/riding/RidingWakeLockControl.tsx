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
 * Accessibility: the checkbox's checked state always reflects the rider's
 * *desired* state, never whether a lock is currently actually held — that
 * distinction is communicated separately via a freshly mounted
 * `role="status"`/`role="alert"` element, which is itself what triggers
 * (or doesn't trigger) an assistive-technology announcement. This keeps
 * announcements to meaningful transitions only (activation, failure),
 * with no continuously-updating live region and no extra bookkeeping.
 */
export function RidingWakeLockControl({
  desired,
  onToggleDesired,
  wakeLockSource,
  clock,
}: RidingWakeLockControlProps) {
  const { status, retry } = useScreenWakeLock({ desired, wakeLockSource, clock });

  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          className="wake-lock-checkbox"
          checked={desired}
          onChange={(event) => {
            onToggleDesired(event.target.checked);
          }}
        />
        Keep screen awake
      </label>
      <p>
        Keeps the display on while Riding mode is visible. This may increase battery use.
      </p>
      {status === "active" ? <p role="status">Screen staying awake.</p> : null}
      {status === "unavailable" ? (
        <div role="alert">
          <p>The screen could not be kept awake.</p>
          <button type="button" onClick={retry}>
            Tap to try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
