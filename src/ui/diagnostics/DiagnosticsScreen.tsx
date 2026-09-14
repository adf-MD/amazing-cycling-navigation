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
  describeConnectionTestStage,
  formatConnectionTestReport,
  runRoutingConnectionTest,
  type RoutingConnectionTestResult,
} from "../../routing/routingConnectionTest.ts";
import { describeMapAttempt, useRecentMapAttempts } from "../../map/mapDiagnostics.ts";
import { useStorageHealth } from "../../storage/storageHealth.ts";
import { isStoredRouteRideState } from "../../storage/mapping.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import { getProviderKey } from "../../storage/providerKeyRepository.ts";
import { getRoute } from "../../storage/routesRepository.ts";
import {
  describeActiveSession,
  type ResolvedActiveRoute,
} from "./activeSessionSummary.ts";
import { useLiveQuery } from "../shared/useLiveQuery.ts";
import { useTranslate } from "../../i18n/useTranslate.ts";
import type { ParameterlessMessageKey, Translator } from "../../i18n/translate.ts";

const SERVICE_WORKER_LABEL_KEYS: Record<ServiceWorkerStatus, ParameterlessMessageKey> = {
  unsupported: "status.sw.unsupported",
  "not-registered": "status.sw.notRegistered",
  installing: "status.sw.installing",
  waiting: "status.sw.waiting",
  active: "status.sw.active",
  unknown: "status.sw.unknown",
};

const GEOLOCATION_PERMISSION_LABEL_KEYS: Record<
  "granted" | "denied" | "prompt" | "unsupported",
  ParameterlessMessageKey
> = {
  granted: "status.permission.granted",
  denied: "status.permission.denied",
  prompt: "status.permission.prompt",
  unsupported: "status.permission.unsupported",
};

function formatFixAge(translator: Translator, ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return translator.t("status.fixAge.seconds", { seconds });
  return translator.t("status.fixAge.minutes", {
    minutes: Math.round(seconds / 60),
  });
}

/** Binary units, ordered from the smallest this ever selects. The unit is
 * part of the message rather than appended, since a language may place it
 * differently; the abbreviations themselves are standard and stay. */
const STORAGE_BYTE_UNIT_KEYS = [
  "status.storage.kibibytes",
  "status.storage.mebibytes",
  "status.storage.gibibytes",
  "status.storage.tebibytes",
] as const;

function formatStorageBytes(translator: Translator, bytes: number): string {
  // Rounds first, then formats the already-rounded value — see
  // `src/ui/shared/routeSummary.ts`'s header for why that ordering is
  // load-bearing rather than stylistic.
  const round = (value: number, digits: number): string =>
    new Intl.NumberFormat(translator.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false,
    }).format(
      digits === 0 ? Number(String(Math.round(value))) : Number(value.toFixed(digits)),
    );
  if (bytes < 1024) {
    return translator.t("status.storage.bytes", { value: round(bytes, 0) });
  }
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < STORAGE_BYTE_UNIT_KEYS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unitKey = STORAGE_BYTE_UNIT_KEYS[unitIndex] ?? "status.storage.tebibytes";
  return translator.t(unitKey, { value: round(value, 1) });
}

// Floors so a displayed "90%" can never contradict the raw >=0.9 pressure
// classification, except a genuinely non-zero fraction below 1% shows
// "<1%" rather than a misleadingly exact "0%" — only an exact 0 ratio
// still shows "0%".
function formatStoragePercentage(translator: Translator, usageRatio: number): string {
  const flooredPercent = Math.floor(usageRatio * 100);
  if (usageRatio > 0 && flooredPercent === 0) {
    return translator.t("status.storage.lessThanOnePercent");
  }
  return translator.t("status.storage.percentage", { percentage: flooredPercent });
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
  const translator = useTranslate();
  const { t } = translator;
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

  // Backlog item 117. The stored session carries only a routeId, so the
  // name is resolved here rather than duplicated into ride-state
  // persistence. A live query, not a one-shot read, so a rename in Routes
  // updates this row by itself; the querier is keyed on the id, so changing
  // session resubscribes. See activeSessionSummary.ts for why the result
  // carries the id it was resolved for.
  const activeRouteId =
    rideState && isStoredRouteRideState(rideState) ? rideState.routeId : undefined;
  const activeRouteQuery = useCallback(async (): Promise<
    ResolvedActiveRoute | undefined
  > => {
    if (activeRouteId === undefined) return undefined;
    const route = await getRoute(activeRouteId);
    return { routeId: activeRouteId, name: route?.name ?? null };
  }, [activeRouteId]);
  const resolvedActiveRoute = useLiveQuery(activeRouteQuery);

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
    <section className="screen diagnostics-screen" aria-label={t("status.landmarkLabel")}>
      <h1 className="screen-title">{t("status.title")}</h1>

      <section
        className="panel stack diagnostics-section"
        aria-labelledby="diagnostics-system-status-heading"
      >
        <h2 id="diagnostics-system-status-heading">{t("status.systemStatus")}</h2>
        <dl className="diagnostics-definition-grid">
          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.appVersion")}</dt>
            <dd className="diagnostics-value">{__APP_VERSION__}</dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.build")}</dt>
            <dd className="diagnostics-value diagnostics-value--mono">{__BUILD_ID__}</dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.network")}</dt>
            <dd className="diagnostics-value">
              {t(online ? "status.online" : "status.offline")}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.serviceWorker")}</dt>
            <dd className="diagnostics-value">
              {t(SERVICE_WORKER_LABEL_KEYS[serviceWorkerStatus])}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.storage")}</dt>
            <dd className="diagnostics-value">
              {storageHealth.status === "checking" && t("status.storage.checking")}
              {storageHealth.status === "error" && t("status.storage.unavailable")}
              {storageHealth.status === "ok" && (
                <div className="diagnostics-value-lines">
                  <p>
                    {t("status.storage.ok", { version: storageHealth.schemaVersion })}
                  </p>
                  {storageHealth.estimate.status === "checking" && (
                    <p className="field-hint">{t("status.storage.estimateChecking")}</p>
                  )}
                  {storageHealth.estimate.status === "unsupported" && (
                    <p className="field-hint">
                      {t("status.storage.estimateUnsupported")}
                    </p>
                  )}
                  {storageHealth.estimate.status === "unavailable" && (
                    <p className="field-hint">
                      {t("status.storage.estimateUnavailable")}
                    </p>
                  )}
                  {storageHealth.estimate.status === "available" && (
                    <>
                      <p>
                        {t("status.storage.estimate", {
                          used: formatStorageBytes(
                            translator,
                            storageHealth.estimate.usageBytes,
                          ),
                          quota: formatStorageBytes(
                            translator,
                            storageHealth.estimate.quotaBytes,
                          ),
                          percentage: formatStoragePercentage(
                            translator,
                            storageHealth.estimate.usageRatio,
                          ),
                        })}
                      </p>
                      {storageHealth.estimate.highPressure && (
                        <p className="diagnostics-value--storage-pressure">
                          {t("status.storage.pressure")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.mapRendering")}</dt>
            <dd className="diagnostics-value">
              {t(
                isMapRenderingSupported()
                  ? "status.mapRendering.supported"
                  : "status.mapRendering.unsupported",
              )}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.geolocationPermission")}</dt>
            <dd className="diagnostics-value">
              {t(GEOLOCATION_PERMISSION_LABEL_KEYS[geolocationPermission])}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.fixAccuracy")}</dt>
            <dd className="diagnostics-value">
              {rideState?.lastFix
                ? t("status.fixAccuracyValue", {
                    accuracy: Math.round(rideState.lastFix.accuracyMetres),
                  })
                : t("status.notApplicableYet")}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.fixAge")}</dt>
            <dd className="diagnostics-value">
              {fixAgeMs !== null
                ? formatFixAge(translator, fixAgeMs)
                : t("status.notApplicableYet")}
            </dd>
          </div>

          <div className="diagnostics-definition-item">
            <dt className="diagnostics-label">{t("status.session")}</dt>
            <dd className="diagnostics-value">
              {describeActiveSession(translator, rideState, resolvedActiveRoute)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="panel stack diagnostics-section"
        aria-labelledby="diagnostics-errors-heading"
      >
        <h2 id="diagnostics-errors-heading">{t("status.recentErrors")}</h2>
        {recentErrors.length === 0 ? (
          <p className="field-hint">{t("status.noErrors")}</p>
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
        <h2 id="diagnostics-routing-heading">{t("status.routingDiagnostics")}</h2>

        <h3>{t("status.recentRoutingAttempts")}</h3>
        <details className="settings-disclosure">
          <summary>{t("status.fetchFailureSummary")}</summary>
          <p>{t("status.fetchFailureDetail")}</p>
        </details>
        <details className="settings-disclosure">
          <summary>{t("status.httpGuideSummary")}</summary>
          <p>{t("status.httpGuideIntro")}</p>
          {/* The <strong> code and the prose after it are two separate
              pieces on purpose: the code is a machine value that must read
              identically in every language, while the sentence beside it is
              rider-facing copy. Keeping them apart is what stops a
              translation from silently renumbering an HTTP status. */}
          <ul className="diagnostics-status-guide">
            <li>
              <strong>{t("status.http.success")}</strong>
              <ul>
                <li>
                  <strong>200</strong> {t("status.http.200")}
                </li>
              </ul>
            </li>
            <li>
              <strong>{t("status.http.redirects")}</strong>
              <ul>
                <li>{t("status.http.redirectsDetail")}</li>
              </ul>
            </li>
            <li>
              <strong>{t("status.http.requestProblems")}</strong>
              <ul>
                <li>
                  <strong>400</strong> {t("status.http.400")}
                </li>
                <li>
                  <strong>{t("status.http.401or403")}</strong>{" "}
                  {t("status.http.401or403Detail")}
                </li>
                <li>
                  <strong>404</strong> {t("status.http.404")}
                </li>
                <li>
                  <strong>405</strong> {t("status.http.405")}
                </li>
                <li>
                  <strong>408</strong> {t("status.http.408")}
                </li>
                <li>
                  <strong>413</strong> {t("status.http.413")}
                </li>
                <li>
                  <strong>429</strong> {t("status.http.429")}
                </li>
                <li>
                  <strong>{t("status.http.other4xx")}</strong>{" "}
                  {t("status.http.other4xxDetail")}
                </li>
              </ul>
            </li>
            <li>
              <strong>{t("status.http.serviceProblems")}</strong>
              <ul>
                <li>
                  <strong>500</strong> {t("status.http.500")}
                </li>
                <li>
                  <strong>501</strong> {t("status.http.501")}
                </li>
                <li>
                  <strong>{t("status.http.other5xx")}</strong>{" "}
                  {t("status.http.other5xxDetail")}
                </li>
              </ul>
            </li>
            <li>
              <strong>{t("status.http.none")}</strong>
              <ul>
                <li>{t("status.http.noneDetail")}</li>
              </ul>
            </li>
          </ul>
        </details>
        {recentRoutingAttempts.length === 0 ? (
          <p className="field-hint">{t("status.noRoutingAttempts")}</p>
        ) : (
          <ul className="diagnostics-log-list">
            {recentRoutingAttempts.map((entry) => (
              <li key={entry.attemptId} className="diagnostics-log-row">
                {describeRoutingAttempt(translator, entry)}
              </li>
            ))}
          </ul>
        )}

        <h3>{t("status.testConnection")}</h3>
        <p className="field-hint">{t("status.testConnectionHint")}</p>
        {!hasKey ? <p className="field-hint">{t("status.testConnectionNoKey")}</p> : null}
        <button
          type="button"
          className="btn-secondary"
          onClick={runConnectionTest}
          disabled={!hasKey || isTestingConnection}
        >
          {t(isTestingConnection ? "status.testing" : "status.testConnection")}
        </button>
        {connectionTestResult ? (
          <>
            <p className="status-row" role="status">
              {/* `detail` is the provider-facing explanation the connection
                  test itself produced, and `elapsed` a machine number.
                  Both are interpolated as values, never re-parsed. */}
              {t("status.testResult", {
                outcome: t(
                  connectionTestResult.outcome === "success"
                    ? "status.testSucceeded"
                    : "status.testFailed",
                ),
                detail: connectionTestResult.message,
                elapsed: connectionTestResult.elapsedMs,
              })}
            </p>
            <dl className="diagnostics-definition-grid">
              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">{t("status.stage")}</dt>
                <dd className="diagnostics-value">
                  {t("status.stageValue", {
                    stage: connectionTestResult.stage,
                    description: describeConnectionTestStage(
                      translator,
                      connectionTestResult.stage,
                    ),
                  })}
                </dd>
              </div>

              {connectionTestResult.errorName ? (
                <div className="diagnostics-definition-item">
                  <dt className="diagnostics-label">{t("status.error")}</dt>
                  <dd className="diagnostics-value">
                    {connectionTestResult.errorMessage
                      ? t("status.errorValue", {
                          name: connectionTestResult.errorName,
                          message: connectionTestResult.errorMessage,
                        })
                      : connectionTestResult.errorName}
                  </dd>
                </div>
              ) : null}

              {connectionTestResult.transportFailureReasonCode ? (
                <div className="diagnostics-definition-item">
                  <dt className="diagnostics-label">{t("status.safeReasonCode")}</dt>
                  <dd className="diagnostics-value">
                    {connectionTestResult.transportFailureReasonCode}
                  </dd>
                </div>
              ) : null}

              {connectionTestResult.httpStatus !== undefined ? (
                <div className="diagnostics-definition-item">
                  <dt className="diagnostics-label">{t("status.httpStatus")}</dt>
                  <dd className="diagnostics-value">{connectionTestResult.httpStatus}</dd>
                </div>
              ) : null}

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">{t("status.headersConstructed")}</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.headersConstructed
                    ? t("status.yes")
                    : t("status.no")}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">{t("status.requestConstructed")}</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.requestConstructed
                    ? t("status.yes")
                    : t("status.no")}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">{t("status.fetchInvoked")}</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.fetchInvoked ? t("status.yes") : t("status.no")}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">{t("status.fetchReturnedPromise")}</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.fetchReturnedPromise
                    ? t("status.yes")
                    : t("status.no")}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">{t("status.responseReceived")}</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.responseReceived
                    ? t("status.yes")
                    : t("status.no")}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">{t("status.secureContext")}</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.isSecureContext
                    ? t("status.yes")
                    : t("status.no")}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">
                  {t("status.serviceWorkerControlling")}
                </dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.isServiceWorkerControlled
                    ? t("status.yes")
                    : t("status.no")}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">
                  {t("status.activeServiceWorkerScript")}
                </dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.activeServiceWorkerScriptUrl ?? t("status.none")}
                </dd>
              </div>

              <div className="diagnostics-definition-item">
                <dt className="diagnostics-label">{t("status.standaloneDisplay")}</dt>
                <dd className="diagnostics-value">
                  {connectionTestResult.isStandalone ? t("status.yes") : t("status.no")}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn-secondary"
              onClick={copyConnectionTestReport}
            >
              {t("status.copyReport")}
            </button>
            {copyStatus === "copied" ? (
              <p className="field-hint">{t("status.copied")}</p>
            ) : null}
            {copyStatus === "failed" ? (
              <p className="field-error">
                {t("status.copyFailed")}
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
        <h2 id="diagnostics-map-heading">{t("status.recentMapAttempts")}</h2>
        {recentMapAttempts.length === 0 ? (
          <p className="field-hint">{t("status.noMapAttempts")}</p>
        ) : (
          <ul className="diagnostics-log-list">
            {recentMapAttempts.map((entry) => (
              <li key={entry.timestampIso} className="diagnostics-log-row">
                {describeMapAttempt(translator, entry)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
