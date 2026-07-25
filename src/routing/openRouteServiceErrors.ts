export type RoutingErrorReason =
  | "no-api-key"
  | "unauthorized"
  | "forbidden"
  | "rate-limited"
  | "offline"
  | "network-failure"
  | "timeout"
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

  constructor(reason: RoutingErrorReason, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "RoutingError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
