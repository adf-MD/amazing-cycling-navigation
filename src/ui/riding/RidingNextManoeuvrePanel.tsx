import type { PlannedRouteSource } from "../../domain/types.ts";
import {
  classifyManoeuvreUrgency,
  type NextManoeuvreSelection,
} from "../../navigation/nextManoeuvre.ts";
import { formatManoeuvreDistance } from "../shared/routeSummary.ts";
import { ManoeuvreIcon } from "./ManoeuvreIcon.tsx";
import { genericManoeuvreLabel } from "./manoeuvreLabels.ts";

export interface RidingNextManoeuvrePanelProps {
  /** Used only to choose the "unavailable" message's wording — trust
   * itself is decided upstream by domain/manoeuvreTrust.ts's
   * hasTrustedManoeuvres, not by this field. */
  sourceKind: PlannedRouteSource["kind"];
  /** Whether route.manoeuvres is safe to use for navigation (see
   * hasTrustedManoeuvres). The caller must also have gated the
   * selectNextManoeuvre call itself on this — a non-null `selection` here
   * is trusted by construction, so the active-display branch below never
   * re-checks trust. */
  isTrusted: boolean;
  selection: NextManoeuvreSelection | null;
  /** True while the shown manoeuvre/distance is based on the rider's last
   * reliable position rather than a fresh, on-route fix — nav.isStale or a
   * strongly off-route episode. Deliberately a single combined qualifier
   * (not distinguishing "why"), mirroring ElevationChart's own simple
   * "Last known position"/"Current route position" wording rather than
   * describing every possible cause. */
  isFrozen: boolean;
}

const URGENCY_FONT_SIZE_REM: Record<
  ReturnType<typeof classifyManoeuvreUrgency>,
  number
> = {
  normal: 1,
  near: 1.25,
  imminent: 1.75,
};
const URGENCY_FONT_WEIGHT: Record<ReturnType<typeof classifyManoeuvreUrgency>, number> = {
  normal: 400,
  near: 600,
  imminent: 800,
};

/**
 * Riding-only "what's next" panel, sourced solely from trusted
 * route.manoeuvres — either provider-generated or from a validated ACN GPX
 * navigation extension (see domain/manoeuvreTrust.ts), never geometry-
 * inferred. Three mutually exclusive rendered states: an active
 * next-manoeuvre display; an explanatory "unavailable" message for an
 * untrusted planner route with no usable manoeuvres; or nothing at all —
 * either every manoeuvre has already been reliably passed (end of route: a
 * stale final turn must not be left showing indefinitely), there is no
 * reliable presentation distance yet (e.g. before the first GPS fix is
 * accepted; the existing "Waiting for a GPS fix…" status above already
 * covers that wait, so this panel need not duplicate it), or the route is an
 * untrusted `gpx-import` (backlog item 97: that case is delegated entirely
 * to RidingUntrustedGpxNotice, rendered by RidingScreen outside this
 * Map-exclusive panel so its compact "No turn cues" indicator survives
 * Map<->Profile switching — rendering it here too would duplicate it).
 *
 * Accessibility: only the instruction+qualifier text carries
 * `role="status"`. Its rendered content changes only at a meaningful
 * transition (a new manoeuvre selected, or the qualifier appearing/
 * disappearing) — never on every GPS fix, since the numeric distance
 * lives in a separate sibling with no role at all and can re-render
 * silently every fix. Never `role="alert"`, even when imminent: this is
 * routine navigation information, not a safety condition (off-route
 * status already owns that escalation).
 */
export function RidingNextManoeuvrePanel({
  sourceKind,
  isTrusted,
  selection,
  isFrozen,
}: RidingNextManoeuvrePanelProps) {
  if (!selection) {
    if (!isTrusted) {
      if (sourceKind === "gpx-import") {
        // Handled by RidingUntrustedGpxNotice instead (backlog item 97) —
        // see this component's own doc comment above.
        return null;
      }
      return (
        <p role="status" className="status-row">
          Turn information is unavailable for this route.
        </p>
      );
    }
    // Every manoeuvre has been reliably passed — end of route.
    return null;
  }

  const urgency = classifyManoeuvreUrgency(selection.remainingDistanceMetres);
  // A whitespace-only (but non-empty pre-trim) provider instruction would
  // render as blank rather than falling back to the generic label — an ORS
  // response is never expected to actually do this, so it's an accepted,
  // effectively unreachable edge case rather than a real correctness gap.
  const instructionText =
    selection.manoeuvre.instruction?.trim() ??
    genericManoeuvreLabel(selection.manoeuvre.type);

  return (
    <div className="ride-manoeuvre-card">
      <div className="ride-manoeuvre-icon">
        <ManoeuvreIcon type={selection.manoeuvre.type} sizePx={32} />
      </div>
      <div className="ride-manoeuvre-text">
        <p role="status" className="ride-manoeuvre-instruction">
          {instructionText}
          {isFrozen ? " — based on your last known position" : ""}
        </p>
        <p
          className="ride-manoeuvre-distance"
          style={{
            fontSize: `${String(URGENCY_FONT_SIZE_REM[urgency])}rem`,
            fontWeight: URGENCY_FONT_WEIGHT[urgency],
          }}
        >
          {formatManoeuvreDistance(selection.remainingDistanceMetres)}
        </p>
      </div>
    </div>
  );
}
