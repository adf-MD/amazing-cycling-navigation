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
import { isStoredRouteRideState } from "../../storage/mapping.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import { getProviderKey } from "../../storage/providerKeyRepository.ts";
import type { StoredRideState } from "../../storage/db.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";

/** "Active route" is a slight misnomer once a free-roam session (backlog
 * item 42, which has no route id at all) can also be the stored active
 * session — kept as the field label since it's still the common case, but
 * this resolves a genuinely useful value for either kind rather than
 * failing to compile against the union or silently showing "None" for an
 * active free-roam session. */
function describeActiveRideStateSummary(rideState: StoredRideState | undefined): string {
  if (!rideState) return "None";
  return isStoredRouteRideState(rideState) ? rideState.routeId : "Free roam";
}

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
    <section className="screen diagnostics-screen" aria-label="Diagnostics">
      <h1 className="screen-title">Diagnostics</h1>

      <section
        className="panel stack diagnostics-section"
        aria-labelledby="diagnostics-system-status-heading"
      >
        <h2 id="diagnostics-system-status-heading">System status</h2>
        <dl className="diagnostics-definition-grid">
          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">App version</dt>
            <dd className="diagnostics-value">{__APP_VERSION__}</dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Build</dt>
            <dd className="diagnostics-value diagnostics-value--mono">{__BUILD_ID__}</dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Network</dt>
            <dd className="diagnostics-value">{online ? "Online" : "Offline"}</dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Service worker</dt>
            <dd className="diagnostics-value">
              {SERVICE_WORKER_LABEL[serviceWorkerStatus]}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Storage</dt>
            <dd className="diagnostics-value">
              {storageHealth.status === "checking" && "Checking…"}
              {storageHealth.status === "ok" &&
                `OK (schema version ${String(storageHealth.schemaVersion)})`}
              {storageHealth.status === "error" && "Unavailable"}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Map rendering support</dt>
            <dd className="diagnostics-value">
              {isMapRenderingSupported() ? "Supported" : "Not supported by this browser"}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Geolocation permission</dt>
            <dd className="diagnostics-value">
              {GEOLOCATION_PERMISSION_LABEL[geolocationPermission]}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Last known fix accuracy</dt>
            <dd className="diagnostics-value">
              {rideState?.lastFix
                ? `±${String(Math.round(rideState.lastFix.accuracyMetres))} m`
                : "Not applicable yet"}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Last known fix age</dt>
            <dd className="diagnostics-value">
              {fixAgeMs !== null ? formatFixAge(fixAgeMs) : "Not applicable yet"}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">Active route</dt>
            <dd className="diagnostics-value diagnostics-value--mono">
              {describeActiveRideStateSummary(rideState)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="panel stack diagnostics-section"
        aria-labelledby="diagnostics-errors-heading"
      >
        <h2 id="diagnostics-errors-heading">Recent errors</h2>
        {recentErrors.length === 0 ? (
          <p className="field-hint">No errors recorded this session.</p>
        ) : (
          <ul className="diagnostics-log-list">
            {recentErrors.map((entry) => (
              <li
                key={`${String(entry.timestampMs)}-${entry.context}`}
                className="diagnostics-log-row"
              >
                <strong>{entry.context}</strong>: {entry.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="panel stack diagnostics-section"
        aria-labelledby="diagnostics-routing-heading"
      >
        <h2 id="diagnostics-routing-heading">Routing diagnostics</h2>

        <h3>Recent routing attempts</h3>
        <details className="settings-disclosure">
          <summary>Why a fetch can fail before an HTTP response</summary>
          <p>
            Browsers may report a generic fetch failure instead of the real HTTP status
            (for example 502) when the provider&apos;s error response is missing CORS
            headers — an entry reading &quot;Fetch failed before an HTTP response was
            exposed to the browser&quot; can mean a provider outage, a missing CORS
            header, a DNS or TLS failure, or a local network restriction, and cannot be
            told apart from this information alone.
          </p>
        </details>
        {recentRoutingAttempts.length === 0 ? (
          <p className="field-hint">No routing attempts recorded this session.</p>
        ) : (
          <ul className="diagnostics-log-list">
            {recentRoutingAttempts.map((entry) => (
              <li key={entry.attemptId} className="diagnostics-log-row">
                {describeRoutingAttempt(entry)}
              </li>
            ))}
          </ul>
        )}

        <h3>Test routing connection</h3>
        <p className="field-hint">
          This sends one real request to OpenRouteService, using fixed test coordinates
          rather than any route you&apos;ve planned, and uses one API request.
        </p>
        {!hasKey ? (
          <p className="field-hint">No OpenRouteService key configured.</p>
        ) : null}
        <button
          type="button"
          className="btn-secondary"
          onClick={runConnectionTest}
          disabled={!hasKey || isTestingConnection}
        >
          {isTestingConnection ? "Testing…" : "Test routing connection"}
        </button>
        {connectionTestResult ? (
          <>
            <p className="status-row" role="status">
              {connectionTestResult.outcome === "success" ? "Succeeded" : "Failed"} —{" "}
              {connectionTestResult.message} ({String(connectionTestResult.elapsedMs)} ms)
            </p>
            <dl className="diagnostics-definition-grid">
              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">Stage</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.stage} —{" "}
                  {CONNECTION_TEST_STAGE_DESCRIPTIONS[connectionTestResult.stage]}
                </dd>
              </div>

              {connectionTestResult.errorName ? (
                <div className="diagnostics-definition-item">
                  <dt className="diagnostics-label">Error</dt>
                  <dd className="diagnostics-value">
                    {connectionTestResult.errorName}
                    {connectionTestResult.errorMessage
                      ? `: ${connectionTestResult.errorMessage}`
                      : ""}
                  </dd>
                </div>
              ) : null}

              {connectionTestResult.transportFailureReasonCode ? (
                <div className="diagnostics-definition-item">
                  <dt className="diagnostics-label">Safe reason code</dt>
                  <dd className="diagnostics-value">
                    {connectionTestResult.transportFailureReasonCode}
                  </dd>
                </div>
              ) : null}

              {connectionTestResult.httpStatus !== undefined ? (
                <div className="diagnostics-definition-item">
                  <dt className="diagnostics-label">HTTP status</dt>
                  <dd className="diagnostics-value">{connectionTestResult.httpStatus}</dd>
                </div>
              ) : null}

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">Headers constructed</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.headersConstructed ? "Yes" : "No"}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">Request constructed</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.requestConstructed ? "Yes" : "No"}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">Fetch invoked</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.fetchInvoked ? "Yes" : "No"}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">Fetch returned a promise</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.fetchReturnedPromise ? "Yes" : "No"}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">HTTP response received</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.responseReceived ? "Yes" : "No"}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">Secure context</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.isSecureContext ? "Yes" : "No"}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">
                  Service worker controlling this page
                </dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.isServiceWorkerControlled ? "Yes" : "No"}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">Active service worker script</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.activeServiceWorkerScriptUrl ?? "None"}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">Installed/standalone display</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.isStandalone ? "Yes" : "No"}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn-secondary"
              onClick={copyConnectionTestReport}
            >
              Copy diagnostic report
            </button>
            {copyStatus === "copied" ? (
              <p className="field-hint">Copied to clipboard.</p>
            ) : null}
            {copyStatus === "failed" ? (
              <p className="field-error">
                Could not copy automatically — select and copy the report text manually:
                <br />
                <textarea
                  readOnly
                  className="field-input diagnostics-report-textarea"
                  value={`${formatDiagnosticsReportHeader()}\n${formatConnectionTestReport(connectionTestResult)}`}
                />
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section
        className="panel stack diagnostics-section"
        aria-labelledby="diagnostics-map-heading"
      >
        <h2 id="diagnostics-map-heading">Recent map imagery attempts</h2>
        {recentMapAttempts.length === 0 ? (
          <p className="field-hint">No map imagery attempts recorded this session.</p>
        ) : (
          <ul className="diagnostics-log-list">
            {recentMapAttempts.map((entry) => (
              <li key={entry.timestampIso} className="diagnostics-log-row">
                {describeMapAttempt(entry)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
