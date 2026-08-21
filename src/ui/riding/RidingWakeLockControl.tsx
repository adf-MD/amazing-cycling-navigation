import { useEffect, useId, useRef, useState } from "react";
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
 * with no continuously-updating live region and no extra bookkeeping. The
 * success status element is visually hidden (backlog item 68 — a
 * permanent visible "Screen staying awake." line was judged too much
 * scarce vertical space for a compact shared status area) but stays
 * mounted in the accessibility tree exactly as before, so the
 * announcement itself is unchanged — only its visibility is.
 *
 * The always-visible battery/behaviour explanation lives behind a tap and
 * keyboard accessible information popover instead of permanent text, kept
 * as local, transient disclosure state (never persisted) — this is the
 * first anchored, non-modal popover in the codebase, so its open/close
 * wiring lives here rather than in a shared component (no other call site
 * exists yet). `controlRef` is the outside-click boundary for the whole
 * control (checkbox, info button, popover, retry alert all count as
 * "inside"); `rowRef` is a narrower `position: relative` anchor for just
 * the compact row, so the popover's anchor point never shifts depending on
 * whether the retry/alert block below it is also rendered.
 */
export function RidingWakeLockControl({
  desired,
  onToggleDesired,
  wakeLockSource,
  clock,
}: RidingWakeLockControlProps) {
  const { status, retry } = useScreenWakeLock({ desired, wakeLockSource, clock });
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const infoId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isInfoOpen) return;

    // Listeners are only attached here, after this effect runs following
    // the commit that opened the popover — the pointerdown that opened it
    // has already finished its own synchronous dispatch, so it can never
    // also be seen by this listener and immediately close what it just
    // opened.
    function handlePointerDown(event: PointerEvent) {
      if (!controlRef.current?.contains(event.target as Node)) {
        setIsInfoOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsInfoOpen(false);
        infoButtonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isInfoOpen]);

  return (
    <div ref={controlRef} className="ride-wake-lock-control">
      <div ref={rowRef} className="wake-lock-row">
        <label className="wake-lock-label">
          <input
            type="checkbox"
            className="wake-lock-checkbox"
            checked={desired}
            onChange={(event) => {
              onToggleDesired(event.target.checked);
            }}
          />
          Keep screen on
        </label>
        <button
          type="button"
          className="wake-lock-info-button"
          ref={infoButtonRef}
          aria-label="About Keep screen on"
          aria-expanded={isInfoOpen}
          aria-controls={infoId}
          onClick={() => {
            setIsInfoOpen((open) => !open);
          }}
        >
          <span aria-hidden="true">ⓘ</span>
        </button>
        {status === "active" ? (
          <span role="status" className="visually-hidden">
            Screen staying awake.
          </span>
        ) : null}
        {isInfoOpen ? (
          <div id={infoId} role="note" className="wake-lock-popover">
            <p>
              Keeps the display on while Riding mode is visible. This may increase battery
              use.
            </p>
            <button
              type="button"
              onClick={() => {
                setIsInfoOpen(false);
                infoButtonRef.current?.focus();
              }}
            >
              Close
            </button>
          </div>
        ) : null}
      </div>
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
