import type { NextManoeuvreSelection } from "../../navigation/nextManoeuvre.ts";
import { formatManoeuvreDistance } from "../shared/routeSummary.ts";
import { ManoeuvreIcon } from "./ManoeuvreIcon.tsx";
import { genericManoeuvreLabel } from "./manoeuvreLabels.ts";

export interface RidingCompactManoeuvreCueProps {
  selection: NextManoeuvreSelection;
  /** Mirrors RidingNextManoeuvrePanel's own isFrozen — true while the shown
   * manoeuvre/distance is based on the rider's last reliable position
   * rather than a fresh, on-route fix. */
  isFrozen: boolean;
}

/**
 * A compact, single-line manoeuvre cue for the Profile pane (backlog item
 * 56), shown by RidingScreen only while the same urgency classification the
 * full RidingNextManoeuvrePanel already uses (classifyManoeuvreUrgency, on
 * the identical NextManoeuvreSelection) reports "near" or "imminent" — no
 * new navigation logic, no separate urgency thresholds. Reuses the same
 * shared instruction-resolution (manoeuvreLabels.ts's genericManoeuvreLabel)
 * and distance-formatting (routeSummary.ts's formatManoeuvreDistance) the
 * full panel itself uses, so the two never disagree on wording. Deliberately
 * does not decide its own
 * visibility: RidingScreen computes that from the live selection every
 * render, so the cue simply stops being rendered once the manoeuvre is
 * passed or its urgency returns to "normal" — no explicit dismiss action.
 *
 * The instruction line is visually truncated to one line via CSS
 * (`.ride-compact-manoeuvre-instruction`, ellipsis) while its full text
 * remains the element's real accessible content — mirrors
 * RidingImmersiveHeader's own established title-truncation pattern, rather
 * than inventing new text-shortening logic. Only the instruction carries
 * `role="status"`, matching the full panel's own accessibility contract
 * (never `role="alert"`, even at imminent urgency — this is routine
 * navigation information, not a safety condition).
 */
export function RidingCompactManoeuvreCue({
  selection,
  isFrozen,
}: RidingCompactManoeuvreCueProps) {
  const instructionText =
    selection.manoeuvre.instruction?.trim() ??
    genericManoeuvreLabel(selection.manoeuvre.type);

  return (
    <div className="ride-compact-manoeuvre-cue">
      <ManoeuvreIcon type={selection.manoeuvre.type} sizePx={20} />
      <p role="status" className="ride-compact-manoeuvre-instruction">
        {instructionText}
        {isFrozen ? " — last known position" : ""}
      </p>
      <p className="ride-compact-manoeuvre-distance">
        {formatManoeuvreDistance(selection.remainingDistanceMetres)}
      </p>
    </div>
  );
}
