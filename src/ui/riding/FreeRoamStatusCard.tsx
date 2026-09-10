import type { MapImageryRecoveryStatus } from "../../map/MapView.tsx";
import { formatGpsStatusLine } from "./rideStatusText.ts";
import { ConnectivityIcon } from "./ConnectivityIcon.tsx";
import { describeMapImageryRecovery } from "../../map/mapImageryRecoveryPresentation.ts";
import {
  RidingWakeLockControl,
  type RidingWakeLockControlProps,
} from "./RidingWakeLockControl.tsx";

export interface FreeRoamLiveStatus {
  accuracyMetres: number;
  isStale: boolean;
  fixAgeMs: number | null;
}

export interface FreeRoamStatusCardProps {
  /** Null exactly when there is no current fix yet — either still waiting
   * for the first fix, or a geolocation error with no fix ever retained. */
  liveStatus: FreeRoamLiveStatus | null;
  /** Pre-formatted by the caller (formatGeolocationError stays owned by
   * FreeRoamScreen, unchanged). Null = no active geolocation error. */
  geolocationErrorMessage: string | null;
  onRetryGeolocation: () => void;
  online: boolean;
  /** Null = no terminal, retryable map-imagery trouble right now (backlog
   * item 83) — see MapView's onImageryStatusChange. */
  imageryRecoveryStatus: MapImageryRecoveryStatus | null;
  onRetryImagery: () => void;
  /** Undefined = wake lock unsupported/ineligible right now — the card
   * renders no wake-lock slot at all. */
  wakeLock?: RidingWakeLockControlProps;
}

// A glanceable state word, deliberately distinct from the precise
// accuracy/freshness line beneath it (never restating the same fact
// twice). Free roam has no off-route concept, so this never escalates to
// role="alert" itself — a genuine GPS error is already carried by the
// dedicated error row. "Location" rather than "Tracking" (backlog item
// 82): free roam records no track, progress or location history, so the
// previous wording overstated what the feature does.
function freeRoamTrackingLabel(
  liveStatus: FreeRoamLiveStatus | null,
  hasError: boolean,
): string {
  if (hasError) return "GPS error";
  if (!liveStatus) return "Waiting for a GPS fix…";
  return liveStatus.isStale ? "Location — signal lost" : "Location";
}

/**
 * Free roam's counterpart to RidingStatusCard.tsx — deliberately not a
 * reuse of that component, since its off-route/remaining-distance/ascent
 * props are fundamentally route-shaped and meaningless without a route.
 * Same two-column main region (item 82 follow-up, 2026-08-26), wake-lock
 * slot, compact connectivity indicator and full-width error/imagery-
 * recovery rows (item 83), but the text column's status label is a plain
 * tracking-state word instead of an off-route status, and there is no
 * remaining-distance/ascent row.
 */
export function FreeRoamStatusCard({
  liveStatus,
  geolocationErrorMessage,
  onRetryGeolocation,
  online,
  imageryRecoveryStatus,
  onRetryImagery,
  wakeLock,
}: FreeRoamStatusCardProps) {
  const topLabel = freeRoamTrackingLabel(liveStatus, geolocationErrorMessage !== null);
  // Backlog item 108: free roam has no route, so it must never inherit
  // Route riding's "the route ... is still shown" wording — the shared
  // table below resolves position-only copy from this context argument
  // rather than either card carrying its own copy of the mapping.
  const imageryRecoveryPresentation = imageryRecoveryStatus
    ? describeMapImageryRecovery(imageryRecoveryStatus.kind, "free-roam")
    : null;

  return (
    <div className="ride-status-card">
      <div className="ride-status-card-main">
        <div className="ride-status-card-text">
          <div className="ride-status-card-status-row">
            <span role="status" className="ride-status-card-status">
              {topLabel}
            </span>
            <span role="status" className="ride-status-card-connectivity">
              <ConnectivityIcon online={online} />
              {online ? "Online" : "Offline"}
            </span>
          </div>
          {liveStatus ? (
            <span className="ride-status-card-detail">
              {formatGpsStatusLine(liveStatus)}
            </span>
          ) : null}
        </div>
        {wakeLock ? <RidingWakeLockControl {...wakeLock} /> : null}
      </div>
      {geolocationErrorMessage ? (
        <div role="alert" className="ride-status-card-error-row">
          <span>{geolocationErrorMessage}</span>
          <button type="button" onClick={onRetryGeolocation}>
            Try again
          </button>
        </div>
      ) : null}
      {imageryRecoveryPresentation ? (
        <div
          role={imageryRecoveryPresentation.role}
          data-testid={imageryRecoveryPresentation.testId}
          className={`ride-status-card-imagery-row${
            imageryRecoveryPresentation.role === "alert"
              ? " ride-status-card-imagery-row--alert"
              : ""
          }${
            imageryRecoveryPresentation.retryable
              ? ""
              : " ride-status-card-imagery-row--pending"
          }`}
        >
          <span>{imageryRecoveryPresentation.message}</span>
          {/* Backlog item 108: the transient "delayed" kind is deliberately
           * non-actionable — imagery is still in flight, so a Retry would
           * only restart a request that has not failed. The three terminal
           * kinds keep the Retry action item 83 gave them, unchanged. */}
          {imageryRecoveryPresentation.retryable ? (
            <button
              type="button"
              onClick={onRetryImagery}
              data-testid="retry-map-imagery-button"
              className="map-status-retry-button"
            >
              Retry map imagery
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
