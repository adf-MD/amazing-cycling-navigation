import type { RefObject } from "react";

export interface RidingRouteCompletionPanelProps {
  onFinish: () => void;
  onKeepRiding: () => void;
  /** True while a Finish-ride finalisation is genuinely in flight — disables
   * both buttons so a rapid double click can't submit twice, and swaps the
   * Finish-ride label to make the pending state visible. */
  isFinishing: boolean;
  error: string | null;
  finishButtonRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Shown only once useRouteCompletionCandidate conservatively confirms the
 * rider has reached the route's end (see navigation/rideCompletion.ts) —
 * never shown merely because one GPS fix looked close. Deliberately does
 * not auto-navigate or clear anything on its own; the rider must press
 * Finish ride. "Route complete" is a plain status paragraph, mirroring
 * RidingNextManoeuvrePanel's own instruction-paragraph role="status"
 * convention (not the whole panel), so re-renders while this stays mounted
 * don't repeatedly announce the same text.
 */
export function RidingRouteCompletionPanel({
  onFinish,
  onKeepRiding,
  isFinishing,
  error,
  finishButtonRef,
}: RidingRouteCompletionPanelProps) {
  return (
    <div className="panel stack ride-completion-panel">
      <p role="status">Route complete</p>
      <div className="row">
        <button
          type="button"
          className="btn-primary"
          ref={finishButtonRef}
          onClick={onFinish}
          disabled={isFinishing}
        >
          {isFinishing ? "Finishing ride…" : "Finish ride"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onKeepRiding}
          disabled={isFinishing}
        >
          Keep riding
        </button>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
