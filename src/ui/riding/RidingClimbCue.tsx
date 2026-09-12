import type { ClimbProgressMetrics } from "../../navigation/climbElevationView.ts";
import { formatDistanceKm } from "../shared/routeSummary.ts";

export interface RidingClimbCueProps {
  metrics: ClimbProgressMetrics;
  onViewClimb: () => void;
}

/**
 * Non-disruptive climb cue shown only on the active-Riding Map view
 * (backlog item 57) while the rider is inside a recognised climb whose
 * Climb elevation view has not been manually dismissed for this climb.
 * Deliberately stateless and does not decide its own visibility —
 * RidingScreen derives that entirely from values it already computes every
 * render (activeClimb, effectiveElevationView from climbElevationView.ts,
 * activeView), mirroring RidingCompactManoeuvreCue.tsx's own "the caller
 * decides, this component just presents" convention. `onViewClimb` only
 * ever needs to switch RidingScreen's activeView to "profile" — since this
 * cue is only ever rendered while effectiveElevationView.kind is already
 * "climb", Profile shows Climb view immediately with no separate dismissal
 * state to clear.
 *
 * Only the constant "Climb active" title carries `role="status"` — it
 * never changes while the cue is shown for one climb, so entering a climb
 * announces once and the continuously-updating distance-remaining line
 * beneath it (plain text, no live region) is never re-announced on every
 * GPS fix. `metrics` reuses RidingScreen's already-computed
 * ClimbProgressMetrics (the same object RidingClimbProgressPanel consumes
 * in the Profile pane) — no second climb-progress calculation.
 *
 * The title/detail text wraps rather than truncates at ordinary phone
 * sizes (backlog item 82) — see `.ride-climb-cue-action`/`.ride-climb-cue`
 * in `src/index.css` for the accompanying width/height budget.
 *
 * Backlog item 115 adds the `.ride-climb-cue-slot` wrapper. It is purely a
 * positioning concern and carries no content, no role and no behaviour: it
 * spans the whole map (`inset: 0`, `pointer-events: none`) so that it can
 * act as a CSS *size container* the cue itself queries, which is how the
 * lower-right placement is enabled only when the map is genuinely tall
 * enough to hold the cue, the attribution and the paused-Follow toast
 * without collision. See `.ride-climb-cue-slot` in `src/index.css` for the
 * derivation and for why the base placement is deliberately unchanged.
 */
export function RidingClimbCue({ metrics, onViewClimb }: RidingClimbCueProps) {
  return (
    <div className="ride-climb-cue-slot">
      <div className="ride-climb-cue">
        <div className="ride-climb-cue-text">
          <p role="status" className="ride-climb-cue-title">
            Climb active
          </p>
          <p className="ride-climb-cue-detail">
            {formatDistanceKm(metrics.distanceRemainingMetres)} remaining
          </p>
        </div>
        <button
          type="button"
          className="btn-primary ride-climb-cue-action"
          onClick={onViewClimb}
        >
          View climb
        </button>
      </div>
    </div>
  );
}
