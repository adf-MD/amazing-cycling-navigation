import type { OffRouteLevel } from "../../navigation/types.ts";
import {
  formatDistanceKm,
  formatDistanceKmValue,
  formatMetres,
} from "../shared/routeSummary.ts";

export interface RidingStatusStripProps {
  offRouteLevel: OffRouteLevel;
  distanceRemainingMetres: number | null;
  remainingAscentMetres: number | null;
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

// Deliberately not formatAscent() from routeSummary.ts: that helper's
// "ascent not available" wording is tuned for the separate whole-route-
// total call sites (pre-ride header, RidingLauncher) and must stay
// unchanged there — this is a shorter, remaining-value-specific phrase.
// Checks === null, never a truthy check, since a genuinely known 0 m
// remaining ascent must render as "0 m ascent", not be treated as
// unavailable.
function formatRemainingAscentText(remainingAscentMetres: number | null): string {
  return remainingAscentMetres === null
    ? "ascent unavailable"
    : `${formatMetres(remainingAscentMetres)} ascent`;
}

// The compact visible text ("61.5 km · 993 m ascent") could be misread as
// route totals; this spelled-out label is what assistive tech announces
// instead (via aria-label on the wrapping span), making the "remaining"
// framing unambiguous.
function buildRemainingAriaLabel(
  distanceRemainingMetres: number,
  remainingAscentMetres: number | null,
): string {
  const distancePart = `${formatDistanceKmValue(distanceRemainingMetres)} kilometres remaining`;
  const ascentPart =
    remainingAscentMetres === null
      ? "ascent remaining not available"
      : `${String(Math.round(remainingAscentMetres))} metres ascent remaining`;
  return `${distancePart}, ${ascentPart}`;
}

/**
 * The combined live ride-status strip: route status, remaining
 * distance/ascent, GPS accuracy/staleness — three deliberate stacked
 * lines, in that order. Receives only already-derived presentation
 * values from useRideNavigation; it never computes off-route/stale state
 * itself. "Off route" carries `role="alert"`; "On route"/"Possibly off
 * route" carry `role="status"` — a colour cue reinforces the off-route
 * levels, but the wording alone (never colour alone) already
 * distinguishes every state. The remaining-metrics and GPS lines carry no
 * live-region role: they change continuously and would otherwise be
 * noisy for assistive tech.
 */
export function RidingStatusStrip({
  offRouteLevel,
  distanceRemainingMetres,
  remainingAscentMetres,
  accuracyMetres,
  isStale,
  fixAgeMs,
}: RidingStatusStripProps) {
  const ageSuffix = isStale && fixAgeMs !== null ? ` (${formatFixAge(fixAgeMs)})` : "";

  return (
    <div className="ride-status-strip">
      <span
        role={offRouteLevel === "off-route" ? "alert" : "status"}
        className={`ride-status-strip-status ride-status-strip-status--${offRouteLevel}`}
      >
        {OFF_ROUTE_LABEL[offRouteLevel]}
      </span>
      {distanceRemainingMetres !== null ? (
        <span
          className="ride-status-strip-remaining"
          aria-label={buildRemainingAriaLabel(
            distanceRemainingMetres,
            remainingAscentMetres,
          )}
        >
          {formatDistanceKm(distanceRemainingMetres)} ·{" "}
          {formatRemainingAscentText(remainingAscentMetres)}
        </span>
      ) : null}
      <span className="ride-status-strip-gps">
        GPS ±{Math.round(accuracyMetres)} m · {isStale ? `Stale${ageSuffix}` : "Live"}
      </span>
    </div>
  );
}
