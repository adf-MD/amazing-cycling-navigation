import { useCallback } from "react";
import { useOnlineStatus } from "../../platform/onlineStatus.ts";
import { useRecentErrors } from "../../platform/errorLog.ts";
import {
  useServiceWorkerStatus,
  type ServiceWorkerStatus,
} from "../../platform/serviceWorkerStatus.ts";
import { useGeolocationPermissionStatus } from "../../platform/geolocationPermission.ts";
import { isMapRenderingSupported } from "../../platform/mapSupport.ts";
import { systemClock, useNow, type Clock } from "../../platform/clock.ts";
import { useStorageHealth } from "../../storage/storageHealth.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";

const SERVICE_WORKER_LABEL: Record<ServiceWorkerStatus, string> = {
  unsupported: "Not supported by this browser",
  "not-registered": "Not registered",
  installing: "Installing",
  waiting: "Waiting to activate",
  active: "Active",
  unknown: "Unknown",
};

const GEOLOCATION_PERMISSION_LABEL = {
  granted: "Granted",
  denied: "Denied",
  prompt: "Not yet requested",
  unsupported: "Not supported by this browser",
};

function formatFixAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  return `${String(Math.round(seconds / 60))} min ago`;
}

export interface DiagnosticsScreenProps {
  clock?: Clock;
}

export function DiagnosticsScreen({ clock = systemClock }: DiagnosticsScreenProps) {
  const online = useOnlineStatus();
  const serviceWorkerStatus = useServiceWorkerStatus();
  const storageHealth = useStorageHealth();
  const recentErrors = useRecentErrors();
  const geolocationPermission = useGeolocationPermissionStatus();
  const now = useNow(clock);

  const rideStateQuery = useCallback(() => getActiveRideState(), []);
  const rideState = useLiveQuery(rideStateQuery);

  const fixAgeMs = rideState?.lastFix ? now - rideState.lastFix.timestampMs : null;

  return (
    <section aria-label="Diagnostics">
      <h1>Diagnostics</h1>
      <dl>
        <dt>App version</dt>
        <dd>{__APP_VERSION__}</dd>

        <dt>Network</dt>
        <dd>{online ? "Online" : "Offline"}</dd>

        <dt>Service worker</dt>
        <dd>{SERVICE_WORKER_LABEL[serviceWorkerStatus]}</dd>

        <dt>Storage</dt>
        <dd>
          {storageHealth.status === "checking" && "Checking…"}
          {storageHealth.status === "ok" &&
            `OK (schema version ${String(storageHealth.schemaVersion)})`}
          {storageHealth.status === "error" && "Unavailable"}
        </dd>

        <dt>Map rendering support</dt>
        <dd>
          {isMapRenderingSupported() ? "Supported" : "Not supported by this browser"}
        </dd>

        <dt>Geolocation permission</dt>
        <dd>{GEOLOCATION_PERMISSION_LABEL[geolocationPermission]}</dd>

        <dt>Last known fix accuracy</dt>
        <dd>
          {rideState?.lastFix
            ? `±${String(Math.round(rideState.lastFix.accuracyMetres))} m`
            : "Not applicable yet"}
        </dd>

        <dt>Last known fix age</dt>
        <dd>{fixAgeMs !== null ? formatFixAge(fixAgeMs) : "Not applicable yet"}</dd>

        <dt>Active route</dt>
        <dd>{rideState?.routeId ?? "None"}</dd>
      </dl>

      <h2>Recent errors</h2>
      {recentErrors.length === 0 ? (
        <p>No errors recorded this session.</p>
      ) : (
        <ul>
          {recentErrors.map((entry) => (
            <li key={`${String(entry.timestampMs)}-${entry.context}`}>
              <strong>{entry.context}</strong>: {entry.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
