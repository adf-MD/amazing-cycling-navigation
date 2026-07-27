export type RoutingErrorReason =
  | "no-api-key"
  | "unauthorized"
  | "forbidden"
  | "rate-limited"
  | "offline"
  // fetch() itself rejected while the browser reported online. This
  // cannot reliably distinguish a provider outage, a DNS/TLS failure, a
  // local network restriction, or — notably — a real HTTP error response
  // (e.g. a 502) whose CORS headers were missing, which browsers expose
  // to page JavaScript only as a generic TypeError. Never claim more
  // certainty than that in user-facing text.
  | "transport-failure"
  | "timeout"
  // The provider was reached and responded, but said no route/point is
  // possible — never confused with a genuine connectivity failure (see
  // openRouteServiceAdapter.ts's mapErrorResponse and usePlanningRoute.ts's
  // mapErrorReasonToOutcome, which both treat these as proof the key and
  // connection work).
  | "no-route-found"
  | "no-routable-point"
  // An HTTP 500/502/503/504 was actually received — the provider itself
  // is unavailable, as distinct from transport-failure (no response was
  // ever received at all).
  | "provider-unavailable"
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
  /** The raw HTTP status, when a response was received at all — distinct
   * from providerErrorCode, which is OpenRouteService's own body-level
   * numbering (e.g. 2009), not the transport-level status (e.g. 502). */
  readonly httpStatus?: number;
  /** The underlying pre-response fetch rejection's `Error.name` (e.g.
   * "TypeError") — only set for "transport-failure". Always safe: a fixed,
   * small vocabulary of browser-defined class names, never provider text. */
  readonly transportErrorName?: string;
  /** An already-sanitised form of the underlying error's `message`, via
   * sanitiseTransportErrorMessage.ts — only set for "transport-failure",
   * and only when the raw message matched a known-safe browser string.
   * Never the raw message itself. */
  readonly transportErrorMessage?: string;

  constructor(
    reason: RoutingErrorReason,
    message: string,
    retryAfterSeconds?: number,
    providerErrorCode?: number,
    httpStatus?: number,
    transportError?: { name: string; sanitisedMessage: string | undefined },
  ) {
    super(message);
    this.name = "RoutingError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
    this.providerErrorCode = providerErrorCode;
    this.httpStatus = httpStatus;
    this.transportErrorName = transportError?.name;
    this.transportErrorMessage = transportError?.sanitisedMessage;
  }
}
