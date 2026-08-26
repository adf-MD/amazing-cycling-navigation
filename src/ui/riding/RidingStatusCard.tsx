import type { OffRouteLevel } from "../../navigation/types.ts";
import {
  formatDistanceKm,
  formatDistanceKmValue,
  formatMetres,
} from "../shared/routeSummary.ts";
import { formatGpsStatusLine } from "./rideStatusText.ts";
import {
  RidingWakeLockControl,
  type RidingWakeLockControlProps,
} from "./RidingWakeLockControl.tsx";

export interface RidingLiveStatus {
  offRouteLevel: OffRouteLevel;
  distanceRemainingMetres: number | null;
  remainingAscentMetres: number | null;
  accuracyMetres: number;
  isStale: boolean;
  fixAgeMs: number | null;
}

export interface RidingStatusCardProps {
  /** Null exactly when there is no current fix yet — either still waiting
   * for the first fix, or a geolocation error with no fix ever retained.
   * Non-null covers both a live fix and a stale retained fix; isStale/
   * fixAgeMs distinguish those, exactly as RidingStatusStrip did before. */
  liveStatus: RidingLiveStatus | null;
  /** Pre-formatted by the caller (formatGeolocationError stays owned by
   * RidingScreen, unchanged). Null = no active geolocation error. */
  geolocationErrorMessage: string | null;
  onRetryGeolocation: () => void;
  online: boolean;
  /** Undefined = wake lock unsupported/ineligible right now — the card
   * renders no wake-lock slot at all. */
  wakeLock?: RidingWakeLockControlProps;
}

const OFF_ROUTE_LABEL: Record<OffRouteLevel, string> = {
  "on-route": "On route",
  "possibly-off-route": "Possibly off route",
  "off-route": "Off route",
};

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
 * The compact active-Riding status card (backlog item 75): one bordered
 * box holding, top to bottom, the route/GPS status line beside the
 * wake-lock control, remaining distance/ascent, GPS accuracy/staleness,
 * a compact geolocation-error row with an inline retry, and a compact
 * offline indicator. Receives only already-derived presentation values;
 * it never computes off-route/stale/geolocation state itself, and the
 * wake-lock lifecycle stays entirely inside RidingWakeLockControl — this
 * component only decides whether to render that control at all.
 *
 * The top-row label is unconditional, so the card can never render empty:
 * it shows the off-route status once a fix exists, "GPS error" once an
 * error exists with no fix yet, or "Waiting for a GPS fix…" otherwise.
 * "Off route" and the error row each carry their own role="alert" and may
 * legitimately coexist — both facts are independently true and neither is
 * suppressed in favour of the other.
 */
export function RidingStatusCard({
  liveStatus,
  geolocationErrorMessage,
  onRetryGeolocation,
  online,
  wakeLock,
}: RidingStatusCardProps) {
  const topLabel = liveStatus
    ? OFF_ROUTE_LABEL[liveStatus.offRouteLevel]
    : geolocationErrorMessage
      ? "GPS error"
      : "Waiting for a GPS fix…";
  const topRole = liveStatus?.offRouteLevel === "off-route" ? "alert" : "status";

  return (
    <div className="ride-status-card">
      <div className="ride-status-card-top-row">
        <span
          role={topRole}
          className={`ride-status-card-status${
            liveStatus ? ` ride-status-card-status--${liveStatus.offRouteLevel}` : ""
          }`}
        >
          {topLabel}
        </span>
        {wakeLock ? <RidingWakeLockControl {...wakeLock} /> : null}
      </div>
      {liveStatus && liveStatus.distanceRemainingMetres !== null ? (
        <span
          className="ride-status-card-remaining"
          aria-label={buildRemainingAriaLabel(
            liveStatus.distanceRemainingMetres,
            liveStatus.remainingAscentMetres,
          )}
        >
          {formatDistanceKm(liveStatus.distanceRemainingMetres)} ·{" "}
          {formatRemainingAscentText(liveStatus.remainingAscentMetres)}
        </span>
      ) : null}
      {liveStatus ? (
        <span className="ride-status-card-gps">{formatGpsStatusLine(liveStatus)}</span>
      ) : null}
      {geolocationErrorMessage ? (
        <div role="alert" className="ride-status-card-error-row">
          <span>{geolocationErrorMessage}</span>
          <button type="button" onClick={onRetryGeolocation}>
            Try again
          </button>
        </div>
      ) : null}
      {!online ? (
        <span role="status" className="ride-status-card-offline">
          Offline
        </span>
      ) : null}
    </div>
  );
}
