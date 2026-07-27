import type { Coordinate } from "../domain/types.ts";
import type { RoutingProvider } from "./provider.ts";
import {
  RoutingError,
  type DispatchMarkers,
  type RoutingErrorReason,
  type TransportFailureReasonCode,
} from "./openRouteServiceErrors.ts";
import {
  describeRoutingError,
  mapErrorReasonToOutcome,
} from "./routingErrorPresentation.ts";
import { recordProviderKeyVerification } from "../storage/providerKeyRepository.ts";
import { logError } from "../platform/errorLog.ts";
import {
  getActiveServiceWorkerScriptUrl,
  isSecureContext,
  isServiceWorkerControlled,
  isStandaloneDisplayMode,
} from "../platform/environmentContext.ts";
import { generateId } from "../platform/idGenerator.ts";

/**
 * OpenRouteService's own documented example coordinates (central
 * Heidelberg, Germany, near HeiGIT's home institution) — reused here
 * rather than invented, so this is a known-published reference pair, not
 * an arbitrary one. Not independently verified against a live
 * cycling-road response (no stored API key is available in this
 * environment): if this exact pair somehow isn't cycling-road-routable,
 * the test still correctly reports "connection and key verified" via the
 * route-processing stage, since a no-route-found/no-routable-point
 * response still proves the request reached and was authenticated by the
 * provider.
 */
const CONNECTION_TEST_WAYPOINTS: readonly Coordinate[] = [
  [8.681495, 49.41461],
  [8.686507, 49.41943],
];

export type RoutingConnectionTestStage =
  | "not-attempted-no-key"
  | "invalid-key-syntax"
  | "header-construction"
  | "request-construction"
  | "fetch-invocation"
  | "offline"
  | "timeout"
  | "transport-response-unavailable"
  | "http-response"
  | "response-parsing"
  | "route-processing"
  | "success";

/** Fixed, generic per-stage explanations, describing observed facts
 * rather than an assumed root cause — deliberately hedged for
 * "transport-response-unavailable": page JavaScript cannot establish
 * *why* the browser withheld a response (CORS/preflight rejection is only
 * one of several indistinguishable possibilities), so this must never
 * present CORS as confirmed. */
export const CONNECTION_TEST_STAGE_DESCRIPTIONS: Record<
  RoutingConnectionTestStage,
  string
> = {
  "not-attempted-no-key":
    "No OpenRouteService key is configured, so no request was sent.",
  "invalid-key-syntax":
    "The stored key itself contains a character that cannot be sent in a request header — checked before any request was constructed.",
  "header-construction": "The request's headers could not be constructed.",
  "request-construction": "The request object itself could not be constructed.",
  "fetch-invocation":
    "Calling the fetch implementation failed synchronously, before any promise existed.",
  offline: "The device reported itself offline before any request was sent.",
  timeout: "The request did not receive a response within the routing timeout.",
  "transport-response-unavailable":
    "The browser did not expose an HTTP response. Possible causes include CORS/preflight rejection, DNS, TLS, timeout, connectivity, or a provider response whose CORS headers were missing.",
  "http-response": "An HTTP response was received from OpenRouteService.",
  "response-parsing":
    "An HTTP response was received but its body could not be parsed as the expected route format.",
  "route-processing":
    "A response was received and parsed, but the route itself could not be used.",
  success: "A valid cycling route was received.",
};

export function classifyConnectionTestStage(
  reason: RoutingErrorReason | "success",
): RoutingConnectionTestStage {
  switch (reason) {
    case "success":
      return "success";
    case "no-api-key":
      return "not-attempted-no-key";
    case "invalid-header-value":
      return "invalid-key-syntax";
    case "header-construction-failure":
      return "header-construction";
    case "invalid-request-construction":
      return "request-construction";
    case "fetch-invocation-failure":
      return "fetch-invocation";
    case "offline":
      return "offline";
    case "timeout":
      return "timeout";
    case "transport-failure":
      return "transport-response-unavailable";
    case "unauthorized":
    case "forbidden":
    case "rate-limited":
    case "provider-unavailable":
    case "provider-error":
      return "http-response";
    case "malformed-response":
      return "response-parsing";
    case "no-route-found":
    case "no-routable-point":
    case "no-geometry":
    case "unknown":
      return "route-processing";
  }
}

/** Every marker true — the only possible state for a genuinely successful
 * calculateRoute call, since every pipeline stage necessarily succeeded on
 * the way there. Not a derived guess: a deterministic fact about what
 * "success" means, unlike a stage→marker lookup table for failures, which
 * this module deliberately does not use (see runRoutingConnectionTest). */
const SUCCESS_DISPATCH_MARKERS: DispatchMarkers = {
  headersConstructed: true,
  requestConstructed: true,
  fetchInvoked: true,
  fetchReturnedPromise: true,
  responseReceived: true,
};

/** All markers false — the only possible state before any request was
 * attempted at all (no key configured, or an unexpected non-RoutingError
 * thrown before the adapter itself could record anything). */
const NOT_ATTEMPTED_DISPATCH_MARKERS: DispatchMarkers = {
  headersConstructed: false,
  requestConstructed: false,
  fetchInvoked: false,
  fetchReturnedPromise: false,
  responseReceived: false,
};

export interface RoutingConnectionTestResult {
  /** Identifies this specific test run — generated fresh each call. */
  attemptId: string;
  outcome: "success" | "failure";
  stage: RoutingConnectionTestStage;
  reason: RoutingErrorReason | "success";
  httpStatus?: number;
  elapsedMs: number;
  message: string;
  waypointCount: number;
  /** The adapter's own recorded values for this exact attempt — carried
   * directly through the thrown RoutingError (see
   * openRouteServiceErrors.ts's DispatchMarkers), never re-derived from
   * `stage` afterwards, so this can never drift from what the adapter
   * itself observed. */
  headersConstructed: boolean;
  requestConstructed: boolean;
  fetchInvoked: boolean;
  fetchReturnedPromise: boolean;
  responseReceived: boolean;
  errorName?: string;
  errorMessage?: string;
  transportFailureReasonCode?: TransportFailureReasonCode;
  isSecureContext: boolean;
  isServiceWorkerControlled: boolean;
  isStandalone: boolean;
  activeServiceWorkerScriptUrl?: string;
}

/**
 * Always the fixed, documented reference pair — never the rider's own
 * planning waypoints. An invalid or distant waypoint could make an
 * otherwise-healthy connection look broken, a long or complex route tests
 * more than connectivity, and either makes the result harder to
 * interpret. This test exists to isolate provider connectivity,
 * authentication, response parsing and basic road-bike routing from
 * route-specific concerns — a separate future action could test the
 * rider's current planned route; this one deliberately does not combine
 * the two purposes.
 */
export function buildConnectionTestWaypoints(): Coordinate[] {
  return [...CONNECTION_TEST_WAYPOINTS];
}

/**
 * Runs one deliberate, real request through the exact same adapter code
 * path Planning uses (so it exercises identical request construction,
 * error classification and diagnostic recording), and returns a fully
 * self-contained result. Dispatch markers come directly from the
 * RoutingError this specific attempt threw (openRouteServiceAdapter.ts
 * attaches its own real values to every error it constructs) — never
 * looked up from the shared routing-attempt log and never re-derived from
 * `stage`, so they can never disagree with what the adapter itself
 * observed and can never be confused with a concurrent attempt from
 * elsewhere. Never throws.
 */
export async function runRoutingConnectionTest(
  adapter: RoutingProvider,
  waypoints: Coordinate[] = buildConnectionTestWaypoints(),
): Promise<RoutingConnectionTestResult> {
  const attemptId = generateId();
  const startedAt = Date.now();
  const environment = {
    isSecureContext: isSecureContext(),
    isServiceWorkerControlled: isServiceWorkerControlled(),
    isStandalone: isStandaloneDisplayMode(),
    activeServiceWorkerScriptUrl: getActiveServiceWorkerScriptUrl(),
  };

  try {
    await adapter.calculateRoute(waypoints, { profile: "cycling-road" });
    try {
      await recordProviderKeyVerification("verified");
    } catch (recordError) {
      logError("routing-connection-test-record-verification", recordError);
    }
    return {
      attemptId,
      outcome: "success",
      stage: "success",
      reason: "success",
      elapsedMs: Date.now() - startedAt,
      message: "Connected successfully and received a valid cycling route.",
      waypointCount: waypoints.length,
      ...SUCCESS_DISPATCH_MARKERS,
      ...environment,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (!(error instanceof RoutingError)) {
      logError("routing-connection-test", error);
      return {
        attemptId,
        outcome: "failure",
        stage: "transport-response-unavailable",
        reason: "unknown",
        elapsedMs,
        message: "An unexpected error occurred while testing the connection.",
        waypointCount: waypoints.length,
        ...NOT_ATTEMPTED_DISPATCH_MARKERS,
        ...environment,
      };
    }

    const stage = classifyConnectionTestStage(error.reason);
    const outcome = mapErrorReasonToOutcome(error.reason);
    if (outcome) {
      const rateLimitResetAt = error.retryAfterSeconds
        ? new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString()
        : null;
      try {
        await recordProviderKeyVerification(outcome, rateLimitResetAt);
      } catch (recordError) {
        logError("routing-connection-test-record-verification", recordError);
      }
    }

    const markers = error.dispatchMarkers ?? NOT_ATTEMPTED_DISPATCH_MARKERS;

    return {
      attemptId,
      outcome: "failure",
      stage,
      reason: error.reason,
      httpStatus: error.httpStatus,
      elapsedMs,
      message: describeRoutingError(error),
      waypointCount: waypoints.length,
      headersConstructed: markers.headersConstructed,
      requestConstructed: markers.requestConstructed,
      fetchInvoked: markers.fetchInvoked,
      fetchReturnedPromise: markers.fetchReturnedPromise,
      responseReceived: markers.responseReceived,
      errorName: error.transportErrorName,
      errorMessage: error.transportErrorMessage,
      transportFailureReasonCode: error.transportFailureReasonCode,
      ...environment,
    };
  }
}

/** A plain-text, copyable block — every field is already safe to share
 * (see RoutingConnectionTestResult's own field-level guarantees): no API
 * key, no Authorization header, and no coordinates (only a count). */
export function formatConnectionTestReport(result: RoutingConnectionTestResult): string {
  const yesNo = (value: boolean): string => (value ? "yes" : "no");
  const lines = [
    "OpenRouteService connection test report",
    `Attempt ID: ${result.attemptId}`,
    `Outcome: ${result.outcome}`,
    `Stage: ${result.stage} — ${CONNECTION_TEST_STAGE_DESCRIPTIONS[result.stage]}`,
    `Detail: ${result.message}`,
    result.errorName
      ? `Error: ${result.errorName}${result.errorMessage ? `: ${result.errorMessage}` : ""}`
      : null,
    result.transportFailureReasonCode
      ? `Safe reason code: ${result.transportFailureReasonCode}`
      : null,
    result.httpStatus !== undefined ? `HTTP status: ${String(result.httpStatus)}` : null,
    `Elapsed: ${String(result.elapsedMs)} ms`,
    `Waypoints used: ${String(result.waypointCount)} (fixed test coordinates, not the rider's own route)`,
    `Headers constructed: ${yesNo(result.headersConstructed)}`,
    `Request constructed: ${yesNo(result.requestConstructed)}`,
    `Fetch invoked: ${yesNo(result.fetchInvoked)}`,
    `Fetch returned a promise: ${yesNo(result.fetchReturnedPromise)}`,
    `HTTP response received: ${yesNo(result.responseReceived)}`,
    `Secure context: ${yesNo(result.isSecureContext)}`,
    `Service worker controlling this page: ${yesNo(result.isServiceWorkerControlled)}`,
    `Active service worker script: ${result.activeServiceWorkerScriptUrl ?? "none"}`,
    `Installed/standalone display: ${yesNo(result.isStandalone)}`,
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}
