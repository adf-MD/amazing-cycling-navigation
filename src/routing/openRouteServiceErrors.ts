export type RoutingErrorReason =
  | "no-api-key"
  | "unauthorized"
  | "forbidden"
  | "rate-limited"
  | "offline"
  | "network-failure"
  | "timeout"
  // The provider was reached and responded, but said no route/point is
  // possible — never confused with a genuine connectivity failure (see
  // openRouteServiceAdapter.ts's mapErrorResponse and usePlanningRoute.ts's
  // mapErrorReasonToOutcome, which both treat these as proof the key and
  // connection work).
  | "no-route-found"
  | "no-routable-point"
  | "provider-error"
  | "malformed-response"
  | "no-geometry"
  | "unknown";

/**
 * The adapter's own typed error. Kept deliberately generic in its
 * `message` — never interpolates the raw provider response body, request
 * URL, waypoints or API key (see the adapter's redaction tests) — so it's
 * always safe to show to the user or log to diagnostics as-is.
 *
 * No "cancelled" reason exists here on purpose: a genuine AbortSignal
 * abort is re-thrown by the adapter unchanged (the native AbortError),
 * never wrapped into a RoutingError, so callers can check
 * `error.name === "AbortError"` and it can never be mistaken for a real
 * failure.
 */
export class RoutingError extends Error {
  readonly reason: RoutingErrorReason;
  readonly retryAfterSeconds?: number;
  /** OpenRouteService's own numeric error code (e.g. 2009), when the
   * response body carried one recognised as such — a safe diagnostic
   * value on its own; never the accompanying message text, which
   * openrouteservice sometimes echoes the request's own coordinates into
   * (see the adapter's redaction tests). */
  readonly providerErrorCode?: number;

  constructor(
    reason: RoutingErrorReason,
    message: string,
    retryAfterSeconds?: number,
    providerErrorCode?: number,
  ) {
    super(message);
    this.name = "RoutingError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
    this.providerErrorCode = providerErrorCode;
  }
}
