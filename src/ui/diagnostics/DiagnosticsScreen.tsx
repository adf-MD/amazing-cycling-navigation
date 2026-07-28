import { useCallback, useState } from "react";
import { useOnlineStatus } from "../../platform/onlineStatus.ts";
import { useRecentErrors } from "../../platform/errorLog.ts";
import {
  useServiceWorkerStatus,
  type ServiceWorkerStatus,
} from "../../platform/serviceWorkerStatus.ts";
import { useGeolocationPermissionStatus } from "../../platform/geolocationPermission.ts";
import { isMapRenderingSupported } from "../../platform/mapSupport.ts";
import { systemClock, useNow, type Clock } from "../../platform/clock.ts";
import {
  describeRoutingAttempt,
  useRecentRoutingAttempts,
} from "../../routing/routingDiagnostics.ts";
import { OpenRouteServiceAdapter } from "../../routing/openRouteServiceAdapter.ts";
import type { RoutingProvider } from "../../routing/provider.ts";
import {
  CONNECTION_TEST_STAGE_DESCRIPTIONS,
  formatConnectionTestReport,
  runRoutingConnectionTest,
  type RoutingConnectionTestResult,
} from "../../routing/routingConnectionTest.ts";
import { describeMapAttempt, useRecentMapAttempts } from "../../map/mapDiagnostics.ts";
import { useStorageHealth } from "../../storage/storageHealth.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import { getProviderKey } from "../../storage/providerKeyRepository.ts";
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

function formatDiagnosticsReportHeader(): string {
  return `App version: ${__APP_VERSION__}\nBuild: ${__BUILD_ID__}`;
}

function buildDefaultAdapter(): RoutingProvider {
  return new OpenRouteServiceAdapter({
    getApiKey: () => getProviderKey().then((key) => key?.apiKey),
  });
}

export interface DiagnosticsScreenProps {
  clock?: Clock;
  /** Injectable for tests; defaults to a real OpenRouteServiceAdapter
   * reading the user's stored key fresh on every request — the same
   * construction PlanningScreen uses, so "Test routing connection" below
   * exercises identical request code to a real Planning calculation. */
  routingProvider?: RoutingProvider;
}

export function DiagnosticsScreen({
  clock = systemClock,
  routingProvider,
}: DiagnosticsScreenProps) {
  const online = useOnlineStatus();
  const serviceWorkerStatus = useServiceWorkerStatus();
  const storageHealth = useStorageHealth();
  const recentErrors = useRecentErrors();
  const recentRoutingAttempts = useRecentRoutingAttempts();
  const recentMapAttempts = useRecentMapAttempts();
  const geolocationPermission = useGeolocationPermissionStatus();
  const now = useNow(clock);

  const rideStateQuery = useCallback(() => getActiveRideState(), []);
  const rideState = useLiveQuery(rideStateQuery);

  const keyQuery = useCallback(() => getProviderKey(), []);
  const key = useLiveQuery(keyQuery);
  const hasKey = key !== undefined;

  // Created once, mirroring PlanningScreen's own treatment of an
  // injectable-but-effectively-stable routingProvider prop.
  const [adapter] = useState<RoutingProvider>(
    () => routingProvider ?? buildDefaultAdapter(),
  );
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] =
    useState<RoutingConnectionTestResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const runConnectionTest = useCallback(() => {
    if (isTestingConnection) return;
    setIsTestingConnection(true);
    setCopyStatus("idle");
    void runRoutingConnectionTest(adapter)
      .then((result) => {
        setConnectionTestResult(result);
      })
      .finally(() => {
        setIsTestingConnection(false);
      });
  }, [adapter, isTestingConnection]);

  const copyConnectionTestReport = useCallback(() => {
    if (!connectionTestResult) return;
    const report = `${formatDiagnosticsReportHeader()}\n${formatConnectionTestReport(connectionTestResult)}`;
    void (async () => {
      try {
        await navigator.clipboard.writeText(report);
        setCopyStatus("copied");
      } catch {
        setCopyStatus("failed");
      }
    })();
  }, [connectionTestResult]);

  const fixAgeMs = rideState?.lastFix ? now - rideState.lastFix.timestampMs : null;

  return (
    <section aria-label="Diagnostics">
      <h1>Diagnostics</h1>
      <dl>
        <dt>App version</dt>
        <dd>{__APP_VERSION__}</dd>

        <dt>Build</dt>
        <dd>{__BUILD_ID__}</dd>

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

      <h2>Recent routing attempts</h2>
      <p>
        Browsers may report a generic fetch failure instead of the real HTTP status (for
        example 502) when the provider&apos;s error response is missing CORS headers — an
        entry reading &quot;Fetch failed before an HTTP response was exposed to the
        browser&quot; can mean a provider outage, a missing CORS header, a DNS or TLS
        failure, or a local network restriction, and cannot be told apart from this
        information alone.
      </p>
      {recentRoutingAttempts.length === 0 ? (
        <p>No routing attempts recorded this session.</p>
      ) : (
        <ul>
          {recentRoutingAttempts.map((entry) => (
            <li key={entry.attemptId}>{describeRoutingAttempt(entry)}</li>
          ))}
        </ul>
      )}

      <h3>Test routing connection</h3>
      <p>
        This sends one real request to OpenRouteService, using fixed test coordinates
        rather than any route you&apos;ve planned, and uses one API request.
      </p>
      {!hasKey ? <p>No OpenRouteService key configured.</p> : null}
      <button
        type="button"
        onClick={runConnectionTest}
        disabled={!hasKey || isTestingConnection}
      >
        {isTestingConnection ? "Testing…" : "Test routing connection"}
      </button>
      {connectionTestResult ? (
        <>
          <p role="status">
            {connectionTestResult.outcome === "success" ? "Succeeded" : "Failed"} —{" "}
            {connectionTestResult.message} ({String(connectionTestResult.elapsedMs)} ms)
          </p>
          <dl>
            <dt>Stage</dt>
            <dd>
              {connectionTestResult.stage} —{" "}
              {CONNECTION_TEST_STAGE_DESCRIPTIONS[connectionTestResult.stage]}
            </dd>

            {connectionTestResult.errorName ? (
              <>
                <dt>Error</dt>
                <dd>
                  {connectionTestResult.errorName}
                  {connectionTestResult.errorMessage
                    ? `: ${connectionTestResult.errorMessage}`
                    : ""}
                </dd>
              </>
            ) : null}

            {connectionTestResult.transportFailureReasonCode ? (
              <>
                <dt>Safe reason code</dt>
                <dd>{connectionTestResult.transportFailureReasonCode}</dd>
              </>
            ) : null}

            {connectionTestResult.httpStatus !== undefined ? (
              <>
                <dt>HTTP status</dt>
                <dd>{connectionTestResult.httpStatus}</dd>
              </>
            ) : null}

            <dt>Headers constructed</dt>
            <dd>{connectionTestResult.headersConstructed ? "Yes" : "No"}</dd>

            <dt>Request constructed</dt>
            <dd>{connectionTestResult.requestConstructed ? "Yes" : "No"}</dd>

            <dt>Fetch invoked</dt>
            <dd>{connectionTestResult.fetchInvoked ? "Yes" : "No"}</dd>

            <dt>Fetch returned a promise</dt>
            <dd>{connectionTestResult.fetchReturnedPromise ? "Yes" : "No"}</dd>

            <dt>HTTP response received</dt>
            <dd>{connectionTestResult.responseReceived ? "Yes" : "No"}</dd>

            <dt>Secure context</dt>
            <dd>{connectionTestResult.isSecureContext ? "Yes" : "No"}</dd>

            <dt>Service worker controlling this page</dt>
            <dd>{connectionTestResult.isServiceWorkerControlled ? "Yes" : "No"}</dd>

            <dt>Active service worker script</dt>
            <dd>{connectionTestResult.activeServiceWorkerScriptUrl ?? "None"}</dd>

            <dt>Installed/standalone display</dt>
            <dd>{connectionTestResult.isStandalone ? "Yes" : "No"}</dd>
          </dl>
          <button type="button" onClick={copyConnectionTestReport}>
            Copy diagnostic report
          </button>
          {copyStatus === "copied" ? <p>Copied to clipboard.</p> : null}
          {copyStatus === "failed" ? (
            <p>
              Could not copy automatically — select and copy the report text manually:
              <br />
              <textarea
                readOnly
                value={`${formatDiagnosticsReportHeader()}\n${formatConnectionTestReport(connectionTestResult)}`}
              />
            </p>
          ) : null}
        </>
      ) : null}

      <h2>Recent map imagery attempts</h2>
      {recentMapAttempts.length === 0 ? (
        <p>No map imagery attempts recorded this session.</p>
      ) : (
        <ul>
          {recentMapAttempts.map((entry) => (
            <li key={entry.timestampIso}>{describeMapAttempt(entry)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
