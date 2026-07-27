export type RoutingErrorReason =
  | "no-api-key"
  // The stored key itself contains a character that cannot be sent in an
  // HTTP header value (checked explicitly, before ever touching Headers/
  // Request) — a local syntax problem, never a claim the provider would
  // reject it (see "unauthorized" for that, a completely separate path).
  | "invalid-header-value"
  // Explicit key validation passed, but the native `Headers` constructor
  // itself still threw for some other reason.
  | "header-construction-failure"
  // The native `Request` constructor threw, after Headers construction
  // already succeeded.
  | "invalid-request-construction"
  // Calling the fetch implementation itself threw *synchronously* —
  // before any Promise was even created (e.g. an "Illegal invocation"-
  // shaped error from an engine that binds fetch to its receiver). Never
  // confused with an async rejection of the returned promise, which is
  // "transport-failure" below — the synchronous try/catch boundary around
  // the call itself is what distinguishes these, not message content.
  | "fetch-invocation-failure"
  | "unauthorized"
  | "forbidden"
  | "rate-limited"
  | "offline"
  // The fetch implementation was invoked, returned a promise, and that
  // promise rejected — a genuine post-dispatch failure. This cannot
  // reliably distinguish a provider outage, a DNS/TLS failure, a local
  // network restriction, or — notably — a real HTTP error response (e.g.
  // a 502) whose CORS headers were missing, which browsers expose to page
  // JavaScript only as a generic TypeError. Never claim more certainty
  // than that in user-facing text.
  | "transport-failure"
  | "timeout"
  // The provider was reached and responded, but said no route/point is
  // possible — never confused with a genuine connectivity failure (see
  // openRouteServiceAdapter.ts's mapErrorResponse and
  // routingErrorPresentation.ts's mapErrorReasonToOutcome, which both
  // treat these as proof the key and connection work).
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

/** A narrower, safe classification of *why* the fetch-dispatch promise
 * rejected — only ever derived from a small, curated pattern match (never
 * from raw, unvetted message text) and never used to decide *whether* a
 * failure was synchronous or asynchronous (the try/catch boundary alone
 * decides that; see "fetch-invocation-failure" vs "transport-failure"
 * above). */
export type TransportFailureReasonCode =
  "fetch-illegal-invocation" | "fetch-returned-non-promise" | "generic-fetch-rejection";

/** Factual markers recording exactly how far one routing attempt actually
 * got through the request pipeline — set once each, in order, by the
 * adapter itself, never reconstructed afterwards from a reason/stage
 * lookup table. Always the adapter's own real values for that specific
 * attempt. */
export interface DispatchMarkers {
  headersConstructed: boolean;
  requestConstructed: boolean;
  fetchInvoked: boolean;
  fetchReturnedPromise: boolean;
  responseReceived: boolean;
}

export interface RoutingErrorOptions {
  reason: RoutingErrorReason;
  message: string;
  retryAfterSeconds?: number;
  /** OpenRouteService's own numeric error code (e.g. 2009), when the
   * response body carried one recognised as such — a safe diagnostic
   * value on its own; never the accompanying message text, which
   * openrouteservice sometimes echoes the request's own coordinates into
   * (see the adapter's redaction tests). */
  providerErrorCode?: number;
  /** The raw HTTP status, when a response was received at all — distinct
   * from providerErrorCode, which is OpenRouteService's own body-level
   * numbering (e.g. 2009), not the transport-level status (e.g. 502). */
  httpStatus?: number;
  /** The underlying local error's `Error.name` (e.g. "TypeError") — only
   * set for "fetch-invocation-failure"/"transport-failure". Always safe: a
   * fixed, small vocabulary of browser-defined class names, never provider
   * or request text. */
  transportErrorName?: string;
  /** An already-sanitised, allowlisted form of the underlying error's
   * `message` — only ever populated for "transport-failure" (the
   * fetch-dispatch stage), via sanitiseTransportErrorMessage.ts's
   * allowlist gate. Deliberately never attempted at all for
   * "invalid-header-value"/"header-construction-failure"/"invalid-
   * request-construction": empirical testing (jsdom's own native `Headers`
   * implementation) confirmed those constructors' own error messages
   * embed the raw invalid value verbatim (e.g. `Headers.append: "<the
   * value>" is an invalid header value.`), so no message from those
   * stages can ever be safely shown — only the error's name and a
   * structural reason code. */
  transportErrorMessage?: string;
  transportFailureReasonCode?: TransportFailureReasonCode;
  dispatchMarkers?: DispatchMarkers;
}

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
 *
 * Constructed from a single options object (rather than a long positional
 * parameter list) — the field count has grown enough, across several
 * rounds of diagnostic hardening, that positional construction was no
 * longer readable at call sites.
 */
export class RoutingError extends Error {
  readonly reason: RoutingErrorReason;
  readonly retryAfterSeconds?: number;
  readonly providerErrorCode?: number;
  readonly httpStatus?: number;
  readonly transportErrorName?: string;
  readonly transportErrorMessage?: string;
  readonly transportFailureReasonCode?: TransportFailureReasonCode;
  readonly dispatchMarkers?: DispatchMarkers;

  constructor(options: RoutingErrorOptions) {
    super(options.message);
    this.name = "RoutingError";
    this.reason = options.reason;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.providerErrorCode = options.providerErrorCode;
    this.httpStatus = options.httpStatus;
    this.transportErrorName = options.transportErrorName;
    this.transportErrorMessage = options.transportErrorMessage;
    this.transportFailureReasonCode = options.transportFailureReasonCode;
    this.dispatchMarkers = options.dispatchMarkers;
  }
}
