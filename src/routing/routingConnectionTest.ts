import type { Coordinate } from "../domain/types.ts";
import type { RoutingProvider } from "./provider.ts";
import { RoutingError, type RoutingErrorReason } from "./openRouteServiceErrors.ts";
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
  | "offline"
  | "timeout"
  | "transport-response-unavailable"
  | "http-response"
  | "response-parsing"
  | "route-processing"
  | "success";

/** Fixed, generic per-stage explanations — deliberately hedged for
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
    case "no-api-key":
      return "not-attempted-no-key";
  }
}

export interface RoutingConnectionTestResult {
  /** Identifies this specific test run — generated fresh each call, never
   * read back from the shared routing-attempt log, so the report this
   * result feeds can never be confused with a concurrent attempt from
   * elsewhere (e.g. another tab, or a Planning recalculation). */
  attemptId: string;
  outcome: "success" | "failure";
  stage: RoutingConnectionTestStage;
  reason: RoutingErrorReason | "success";
  httpStatus?: number;
  elapsedMs: number;
  message: string;
  waypointCount: number;
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
 * self-contained result — every field the caller needs for a copyable
 * report is captured directly here, never read back from the shared
 * routing-attempt log, which could otherwise race a concurrent attempt
 * from elsewhere. Never throws.
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

    return {
      attemptId,
      outcome: "failure",
      stage,
      reason: error.reason,
      httpStatus: error.httpStatus,
      elapsedMs,
      message: describeRoutingError(error),
      waypointCount: waypoints.length,
      ...environment,
    };
  }
}

/** A plain-text, copyable block — every field is already safe to share
 * (see RoutingConnectionTestResult's own field-level guarantees): no API
 * key, no Authorization header, and no coordinates (only a count). */
export function formatConnectionTestReport(result: RoutingConnectionTestResult): string {
  const lines = [
    "OpenRouteService connection test report",
    `Attempt ID: ${result.attemptId}`,
    `Outcome: ${result.outcome}`,
    `Stage: ${result.stage} — ${CONNECTION_TEST_STAGE_DESCRIPTIONS[result.stage]}`,
    `Detail: ${result.message}`,
    result.httpStatus !== undefined ? `HTTP status: ${String(result.httpStatus)}` : null,
    `Elapsed: ${String(result.elapsedMs)} ms`,
    `Waypoints used: ${String(result.waypointCount)} (fixed test coordinates, not the rider's own route)`,
    `Secure context: ${String(result.isSecureContext)}`,
    `Service worker controlling this page: ${String(result.isServiceWorkerControlled)}`,
    `Active service worker script: ${result.activeServiceWorkerScriptUrl ?? "none"}`,
    `Installed/standalone display: ${String(result.isStandalone)}`,
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}
