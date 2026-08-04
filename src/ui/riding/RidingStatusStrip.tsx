import type { OffRouteLevel } from "../../navigation/types.ts";
import { formatDistanceKm } from "../shared/routeSummary.ts";

export interface RidingStatusStripProps {
  offRouteLevel: OffRouteLevel;
  distanceRemainingMetres: number | null;
  accuracyMetres: number;
  isStale: boolean;
  fixAgeMs: number | null;
}

const OFF_ROUTE_LABEL: Record<OffRouteLevel, string> = {
  "on-route": "On route",
  "possibly-off-route": "Possibly off route",
  "off-route": "Off route",
};

function formatFixAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  return `${String(Math.round(seconds / 60))} min ago`;
}

/**
 * The combined live ride-status strip: route status, remaining distance,
 * GPS accuracy/staleness — one compact row, in that order. Receives only
 * already-derived presentation values from useRideNavigation; it never
 * computes off-route/stale state itself. "Off route" carries
 * `role="alert"`; "On route"/"Possibly off route" carry `role="status"` —
 * a colour cue reinforces the off-route levels, but the wording alone
 * (never colour alone) already distinguishes every state.
 */
export function RidingStatusStrip({
  offRouteLevel,
  distanceRemainingMetres,
  accuracyMetres,
  isStale,
  fixAgeMs,
}: RidingStatusStripProps) {
  return (
    <div className="ride-status-strip">
      <span
        role={offRouteLevel === "off-route" ? "alert" : "status"}
        className={`ride-status-strip-status ride-status-strip-status--${offRouteLevel}`}
      >
        {OFF_ROUTE_LABEL[offRouteLevel]}
      </span>
      {distanceRemainingMetres !== null ? (
        <span className="ride-status-strip-detail">
          Remaining: {formatDistanceKm(distanceRemainingMetres)}
        </span>
      ) : null}
      <span className="ride-status-strip-detail">
        GPS accuracy: ±{Math.round(accuracyMetres)} m — {isStale ? "Stale" : "Live"}
        {fixAgeMs !== null ? ` (${formatFixAge(fixAgeMs)})` : null}
      </span>
    </div>
  );
}
