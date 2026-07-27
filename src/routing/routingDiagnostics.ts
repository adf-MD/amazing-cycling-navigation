import { useSyncExternalStore } from "react";
import type {
  RoutingErrorReason,
  TransportFailureReasonCode,
} from "./openRouteServiceErrors.ts";

/**
 * A sanitised record of one routing attempt, for the Diagnostics screen.
 * Deliberately limited to values that are safe to show or export as-is:
 * booleans, numbers, a closed reason/"success" string union, a fixed
 * (coordinate-free, key-free) endpoint host/path, and a waypoint *count*
 * rather than the waypoints themselves. Never the API key, Authorization
 * header, request body, waypoint coordinates, or raw provider response
 * body/message — those can all echo sensitive or identifying content back
 * (see the adapter's redaction tests), so only OpenRouteService's own
 * numeric error code and the HTTP status are kept from the provider side.
 * `errorName`/`errorMessage` (a pre-response fetch rejection's own
 * details) are populated only via sanitiseTransportErrorMessage.ts's
 * allowlist-and-redact gate, never the raw `Error.message` — see that
 * module's own doc comment.
 *
 * `responseReceived: false` cannot, by itself, distinguish a provider
 * outage, a DNS/TLS failure, a local network restriction, or a real HTTP
 * error response whose CORS headers were missing (which browsers expose
 * to page JavaScript only as a generic fetch failure, never the real
 * status) — see describeRoutingAttempt, which states this rather than
 * guessing.
 */
export interface RoutingAttemptDiagnostic {
  /** Generated fresh per attempt — lets a specific attempt be correlated
   * unambiguously (e.g. by a deliberate connection test) even if another
   * attempt is recorded around the same time. */
  attemptId: string;
  timestampIso: string;
  providerId: string;
  endpointHost: string;
  endpointPath: string;
  httpMethod: string;
  wasOnline: boolean;
  isSecureContext: boolean;
  isServiceWorkerControlled: boolean;
  isStandalone: boolean;
  /** Never the coordinates themselves. */
  waypointCount: number;
  elapsedMs: number;
  /** Factual markers recording exactly how far this specific attempt got
   * through the request pipeline — each set once, in order, by the
   * adapter itself (see openRouteServiceAdapter.ts), never reconstructed
   * afterwards from `category`. */
  headersConstructed: boolean;
  requestConstructed: boolean;
  fetchInvoked: boolean;
  fetchReturnedPromise: boolean;
  responseReceived: boolean;
  httpStatus?: number;
  /** Best-effort only — some browsers/HTTP versions (notably HTTP/2)
   * legitimately leave this empty, so it must never be relied on for
   * classification, only shown alongside httpStatus/category. */
  statusText?: string;
  /** Whether a response body parse was attempted and succeeded as JSON.
   * Left undefined when no parse was attempted at all (e.g. a 401/403/429/
   * 5xx response, whose body is deliberately never read). */
  bodyWasJson?: boolean;
  providerErrorCode?: number;
  /** Best-effort — only present when the provider's rate-limit headers
   * are exposed to page JavaScript by CORS. */
  rateLimitRemaining?: string;
  rateLimitLimit?: string;
  /** Safe: a fixed, small vocabulary of browser-defined class names (e.g.
   * "TypeError"), never provider text. Only set when responseReceived is
   * false and the failure wasn't a recognised offline/timeout condition. */
  errorName?: string;
  /** An already-sanitised message — see sanitiseTransportErrorMessage.ts.
   * Only set when responseReceived is false. Deliberately never populated
   * for header-construction-failure/invalid-request-construction: native
   * Headers/Request construction error messages were confirmed (by this
   * project's own testing) to embed the raw invalid value verbatim, so no
   * message from those stages can ever be safely shown — only errorName. */
  errorMessage?: string;
  /** A narrower, safe hint about *why* a fetch-invocation/transport
   * failure occurred, from a small curated pattern match — never used to
   * decide whether a failure was synchronous or asynchronous (`category`
   * itself already carries that distinction). */
  transportFailureReasonCode?: TransportFailureReasonCode;
  category: RoutingErrorReason | "success";
}

/** Smaller than errorLog.ts's generic error log — these are richer,
 * lower-frequency records (at most one per calculateRoute call). */
const MAX_ENTRIES = 10;

let entries: RoutingAttemptDiagnostic[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function recordRoutingAttempt(diagnostic: RoutingAttemptDiagnostic): void {
  entries = [diagnostic, ...entries].slice(0, MAX_ENTRIES);
  notify();
}

export function getRecentRoutingAttempts(): readonly RoutingAttemptDiagnostic[] {
  return entries;
}

export function subscribeRoutingDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearRoutingDiagnostics(): void {
  entries = [];
  notify();
}

export function useRecentRoutingAttempts(): readonly RoutingAttemptDiagnostic[] {
  return useSyncExternalStore(subscribeRoutingDiagnostics, getRecentRoutingAttempts);
}

/** Appends the safe error name/message and reason code, when present, in
 * parentheses — e.g. "(TypeError: Failed to fetch; reason:
 * generic-fetch-rejection)". Kept as a separate step from the base
 * description so the "Recent routing attempts" list stays concise; full
 * marker-level detail belongs in the connection-test report instead. */
function appendSafeErrorDetail(base: string, entry: RoutingAttemptDiagnostic): string {
  const parts: string[] = [];
  if (entry.errorName) {
    parts.push(
      entry.errorMessage ? `${entry.errorName}: ${entry.errorMessage}` : entry.errorName,
    );
  }
  if (entry.transportFailureReasonCode) {
    parts.push(`reason: ${entry.transportFailureReasonCode}`);
  }
  return parts.length > 0 ? `${base} (${parts.join("; ")})` : base;
}

/**
 * Deliberately does not attempt to guess further when no response was
 * received and the category isn't offline/timeout/one of the explicit
 * local pipeline stages below — a browser can hide a real HTTP error
 * (e.g. 502) behind a generic fetch failure when that response lacks CORS
 * headers, so this is reported honestly as indistinguishable from a
 * DNS/TLS failure or a local network restriction.
 */
export function describeRoutingAttempt(entry: RoutingAttemptDiagnostic): string {
  if (entry.responseReceived) {
    const status = entry.httpStatus !== undefined ? String(entry.httpStatus) : "unknown";
    const suffix = entry.category === "success" ? "" : ` (${entry.category})`;
    return `HTTP response received: ${status}${suffix}`;
  }
  let base: string;
  switch (entry.category) {
    case "offline":
      base = "Device reported offline";
      break;
    case "timeout":
      base = "Request timed out";
      break;
    case "invalid-header-value":
      base = "The stored key could not be used in a request header";
      break;
    case "header-construction-failure":
      base = "Request headers could not be constructed";
      break;
    case "invalid-request-construction":
      base = "Request could not be constructed";
      break;
    case "fetch-invocation-failure":
      base = "Fetch could not be invoked";
      break;
    default:
      base = "Fetch promise rejected before an HTTP response was exposed";
      break;
  }
  return appendSafeErrorDetail(base, entry);
}
