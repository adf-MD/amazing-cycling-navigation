import type { Coordinate, PlannedRoute } from "../domain/types.ts";
import type { RoutingOptions, RoutingProvider } from "./provider.ts";
import {
  RoutingError,
  type DispatchMarkers,
  type TransportFailureReasonCode,
} from "./openRouteServiceErrors.ts";
import {
  isOrsFeatureCollection,
  type OrsDirectionsRequestBody,
} from "./openRouteServiceTypes.ts";
import { normalizeOpenRouteServiceRoute } from "./normalizeOpenRouteServiceRoute.ts";
import {
  recordRoutingAttempt,
  type RoutingAttemptDiagnostic,
} from "./routingDiagnostics.ts";
import { sanitiseTransportErrorMessage } from "./sanitiseErrorMessage.ts";
import { generateId } from "../platform/idGenerator.ts";
import { isValidHttpHeaderValue } from "../platform/apiKeyValidation.ts";
import {
  isSecureContext,
  isServiceWorkerControlled,
  isStandaloneDisplayMode,
} from "../platform/environmentContext.ts";

/** The current HeiGIT-hosted endpoint — the deprecated api.openrouteservice.org
 * host must never be used. Exported so other modules (e.g. the Diagnostics
 * connection-test report) can derive the host/path without duplicating it. */
export const DEFAULT_BASE_URL = "https://api.heigit.org/openrouteservice/v2";

const REQUEST_TIMEOUT_MS = 15_000;

export const OPENROUTESERVICE_PROVIDER_ID = "openrouteservice";

export interface OpenRouteServiceAdapterOptions {
  /** Read fresh on every request — never cached inside the adapter. */
  getApiKey: () => Promise<string | undefined>;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Structural check, not `instanceof Error`/`instanceof DOMException` —
 * the exact class a fetch abort rejects with varies by runtime, but it
 * always carries `name === "AbortError"`. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/** Merges an optional caller signal with this adapter's own timeout
 * signal into one combined signal — a small hand-rolled listener merge
 * rather than AbortSignal.any()/.timeout(), so this has no minimum
 * browser-version dependency at all. */
function mergeAbortSignals(
  external: AbortSignal | undefined,
  timeout: AbortSignal,
): AbortSignal {
  if (!external) return timeout;
  const controller = new AbortController();
  if (external.aborted || timeout.aborted) {
    controller.abort();
    return controller.signal;
  }
  const onAbort = () => {
    controller.abort();
  };
  external.addEventListener("abort", onAbort, { once: true });
  timeout.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

/** Reads the standard Retry-After header (seconds) — the one quota/rate-
 * limit timing signal with a real, documented HTTP meaning; used for both
 * 403 (daily-quota problems sometimes carry it too) and 429. Best-effort:
 * absent on most 401/other responses, and not every provider sends it. */
function readRetryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Best-effort only: these headers are safe numeric/text values with no
 * request content, but are only visible to page JavaScript at all when the
 * provider's CORS configuration exposes them — absent on most responses. */
function readRateLimitHeaders(response: Response): {
  remaining?: string;
  limit?: string;
} {
  return {
    remaining:
      response.headers.get("RateLimit-Remaining") ??
      response.headers.get("X-RateLimit-Remaining") ??
      undefined,
    limit:
      response.headers.get("RateLimit-Limit") ??
      response.headers.get("X-RateLimit-Limit") ??
      undefined,
  };
}

/** OpenRouteService error codes (from its public API documentation, not
 * independently verified against a live response — the same honesty
 * caveat this project already applies in surfaceCodes.ts) that mean "no
 * route could be built between these locations", as distinct from any
 * other provider-side error. Classification is based only on the
 * response body's error.code, never on assuming a specific HTTP status
 * for these cases, since that mapping isn't confidently known either. */
const ORS_NO_ROUTE_CODES = new Set([2009]);
/** "A waypoint isn't close enough to a road this profile can route on" —
 * distinct from "no route exists between two otherwise-routable points". */
const ORS_NO_ROUTABLE_POINT_CODES = new Set([2010, 2011]);

function classifyOrsErrorCode(
  code: number | undefined,
): "no-route-found" | "no-routable-point" | null {
  if (code === undefined) return null;
  if (ORS_NO_ROUTE_CODES.has(code)) return "no-route-found";
  if (ORS_NO_ROUTABLE_POINT_CODES.has(code)) return "no-routable-point";
  return null;
}

function hasNumericErrorCode(body: unknown): body is { error: { code: number } } {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "code" in body.error &&
    typeof body.error.code === "number"
  );
}

/** Reads only the numeric error.code from a response body, if present —
 * deliberately never reads or forwards error.message, which
 * openrouteservice sometimes echoes the request's own coordinates into
 * (see the adapter's redaction tests). Never throws: an unparseable or
 * differently-shaped body just means "no code available". `bodyWasJson`
 * distinguishes "we tried to parse and it wasn't JSON" from the other
 * error-status branches below, which never attempt a parse at all. */
async function readOrsErrorInfo(
  response: Response,
): Promise<{ code: number | undefined; bodyWasJson: boolean }> {
  try {
    const body: unknown = await response.json();
    return {
      code: hasNumericErrorCode(body) ? body.error.code : undefined,
      bodyWasJson: true,
    };
  } catch {
    return { code: undefined, bodyWasJson: false };
  }
}

/** Only ever applied to a fetch-dispatch-stage failure message — a
 * narrower, safe *hint* about why the promise rejected, derived purely
 * from a small pattern match. Never used to decide whether a failure was
 * synchronous or asynchronous (the calling code's try/catch boundary
 * alone decides that). */
function classifyTransportFailureReasonCode(
  rawMessage: string,
): TransportFailureReasonCode {
  return /illegal invocation/i.test(rawMessage)
    ? "fetch-illegal-invocation"
    : "generic-fetch-rejection";
}

async function mapErrorResponse(
  response: Response,
  dispatchMarkers: DispatchMarkers,
): Promise<{ routingError: RoutingError; bodyWasJson?: boolean }> {
  switch (response.status) {
    case 401:
      return {
        routingError: new RoutingError({
          reason: "unauthorized",
          message: "The OpenRouteService key was rejected.",
          httpStatus: response.status,
          dispatchMarkers,
        }),
      };
    case 403:
      return {
        routingError: new RoutingError({
          reason: "forbidden",
          message: "Access was denied — check the account, permissions or daily quota.",
          retryAfterSeconds: readRetryAfterSeconds(response),
          httpStatus: response.status,
          dispatchMarkers,
        }),
      };
    case 429:
      return {
        routingError: new RoutingError({
          reason: "rate-limited",
          message: "The rate limit was reached.",
          retryAfterSeconds: readRetryAfterSeconds(response),
          httpStatus: response.status,
          dispatchMarkers,
        }),
      };
    // The provider itself returned a server error — a proxy or backend
    // problem on its side, not the browser's connection. Classified
    // directly from the status, without attempting to read a body: an
    // infrastructure-level 502 (e.g. a proxy that couldn't resolve its
    // own routing backend) won't carry OpenRouteService's own JSON error
    // shape at all.
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        routingError: new RoutingError({
          reason: "provider-unavailable",
          message: "OpenRouteService returned a server error.",
          httpStatus: response.status,
          dispatchMarkers,
        }),
      };
    default: {
      // Deliberately never interpolates the response body's message text
      // — never risk echoing back request content (coordinates, key) the
      // provider might reflect in it. Only a recognised numeric error
      // code is read, which also proves the request reached and was
      // authenticated by the provider (see mapErrorReasonToOutcome).
      const { code, bodyWasJson } = await readOrsErrorInfo(response);
      const reason = classifyOrsErrorCode(code);
      if (reason === "no-route-found") {
        return {
          routingError: new RoutingError({
            reason,
            message: "No cycling route could be found between these waypoints.",
            providerErrorCode: code,
            httpStatus: response.status,
            dispatchMarkers,
          }),
          bodyWasJson,
        };
      }
      if (reason === "no-routable-point") {
        return {
          routingError: new RoutingError({
            reason,
            message: "A waypoint is too far from a usable road for cycling.",
            providerErrorCode: code,
            httpStatus: response.status,
            dispatchMarkers,
          }),
          bodyWasJson,
        };
      }
      return {
        routingError: new RoutingError({
          reason: "provider-error",
          message: "The routing provider returned an unexpected error.",
          providerErrorCode: code,
          httpStatus: response.status,
          dispatchMarkers,
        }),
        bodyWasJson,
      };
    }
  }
}

/**
 * OpenRouteService/HeiGIT `cycling-road` adapter implementing the
 * project's provider-independent RoutingProvider interface. Deliberately
 * never imports storage/ — the caller supplies the key via `getApiKey`
 * and is responsible for recording the outcome (see
 * src/ui/planning/usePlanningRoute.ts), keeping this adapter a pure
 * network/normalisation boundary that needs no IndexedDB setup to test.
 */
export class OpenRouteServiceAdapter implements RoutingProvider {
  private readonly getApiKey: () => Promise<string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: OpenRouteServiceAdapterOptions) {
    this.getApiKey = options.getApiKey;
    // Bound explicitly — calling fetch later as `this.fetchImpl(request)`
    // (a property access, not `window.fetch(request)`) throws a real,
    // confirmed "Illegal invocation" TypeError in Chromium: proven by a
    // real-browser Playwright regression test (e2e/fetchInvocation.spec.ts)
    // before this binding was added, per this project's own policy against
    // speculative fixes. Never applied to an injected fetchImpl — a
    // caller-supplied function is the caller's own responsibility, and
    // wrapping it here would be surprising for tests that assert on call
    // identity/arguments.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  async calculateRoute(
    waypoints: Coordinate[],
    options: RoutingOptions,
    signal?: AbortSignal,
  ): Promise<PlannedRoute> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      // A local configuration gate, not a routing attempt — never
      // recorded as a diagnostic (see routingDiagnostics.ts).
      throw new RoutingError({
        reason: "no-api-key",
        message: "No OpenRouteService key is configured.",
      });
    }

    const startedAt = Date.now();
    const endpointHost = new URL(this.baseUrl).host;
    const endpointPath = `/directions/${options.profile}/geojson`;
    const wasOnline = typeof navigator === "undefined" || navigator.onLine;

    // A single, mutable record of how far *this* attempt actually got —
    // updated in place as each stage below succeeds, then read (never
    // separately re-derived) both by recordAttempt and by any RoutingError
    // this method throws, so the diagnostic log and the thrown error can
    // never disagree about these facts.
    const markers: DispatchMarkers = {
      headersConstructed: false,
      requestConstructed: false,
      fetchInvoked: false,
      fetchReturnedPromise: false,
      responseReceived: false,
    };

    const recordAttempt = (
      fields: Pick<
        RoutingAttemptDiagnostic,
        | "responseReceived"
        | "category"
        | "httpStatus"
        | "statusText"
        | "bodyWasJson"
        | "providerErrorCode"
        | "rateLimitRemaining"
        | "rateLimitLimit"
        | "errorName"
        | "errorMessage"
        | "transportFailureReasonCode"
      >,
    ): void => {
      recordRoutingAttempt({
        attemptId: generateId(),
        timestampIso: new Date().toISOString(),
        providerId: OPENROUTESERVICE_PROVIDER_ID,
        endpointHost,
        endpointPath,
        httpMethod: "POST",
        wasOnline,
        isSecureContext: isSecureContext(),
        isServiceWorkerControlled: isServiceWorkerControlled(),
        isStandalone: isStandaloneDisplayMode(),
        waypointCount: waypoints.length,
        elapsedMs: Date.now() - startedAt,
        headersConstructed: markers.headersConstructed,
        requestConstructed: markers.requestConstructed,
        fetchInvoked: markers.fetchInvoked,
        fetchReturnedPromise: markers.fetchReturnedPromise,
        ...fields,
      });
    };

    if (!wasOnline) {
      recordAttempt({ responseReceived: false, category: "offline" });
      throw new RoutingError({
        reason: "offline",
        message: "The device is currently offline.",
        dispatchMarkers: { ...markers },
      });
    }

    // Stage A: explicit key-format validation. Deterministic and safe
    // regardless of how strictly a given engine's native Headers
    // constructor validates values — this is also what makes the path
    // reliably unit-testable at all (see the adapter's own tests). A
    // syntactically valid key that the provider later rejects is a
    // completely separate path ("unauthorized", from mapErrorResponse).
    if (!isValidHttpHeaderValue(apiKey)) {
      recordAttempt({ responseReceived: false, category: "invalid-header-value" });
      throw new RoutingError({
        reason: "invalid-header-value",
        message:
          "The stored key contains a character that cannot be sent in a request header.",
        dispatchMarkers: { ...markers },
      });
    }

    const body: OrsDirectionsRequestBody = {
      coordinates: waypoints.map(([longitude, latitude]) => [longitude, latitude]),
      elevation: true,
      extra_info: ["surface"],
      instructions: true,
      ...(options.avoidFerries ? { options: { avoid_features: ["ferries"] } } : {}),
    };

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, REQUEST_TIMEOUT_MS);
    const combinedSignal = mergeAbortSignals(signal, timeoutController.signal);

    // Stage B: Headers construction, in its own try/catch — explicit key
    // validation above already covers the one failure mode this project
    // can anticipate, but this still guards against any other
    // construction failure, classified distinctly rather than folded into
    // a later, vaguer category.
    let headers: Headers;
    try {
      headers = new Headers({
        // Raw key, never a "Bearer " prefix, and never appended to the
        // URL — see the redaction/URL tests.
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/geo+json, application/json",
      });
      markers.headersConstructed = true;
    } catch (error) {
      clearTimeout(timeoutId);
      const errorName = error instanceof Error ? error.name : "unknown";
      // Deliberately never attempts to read or sanitise error.message
      // here: this project's own testing confirmed native Headers
      // construction errors embed the raw invalid value verbatim (e.g.
      // `Headers.append: "<the value>" is an invalid header value.`), so
      // no message from this stage can ever be safely shown.
      recordAttempt({
        responseReceived: false,
        category: "header-construction-failure",
        errorName,
      });
      throw new RoutingError({
        reason: "header-construction-failure",
        message: "The routing request's headers could not be constructed.",
        transportErrorName: errorName,
        dispatchMarkers: { ...markers },
      });
    }

    // Stage C: Request construction, in its own try/catch.
    let request: Request;
    try {
      request = new Request(`${this.baseUrl}${endpointPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
      markers.requestConstructed = true;
    } catch (error) {
      clearTimeout(timeoutId);
      const errorName = error instanceof Error ? error.name : "unknown";
      recordAttempt({
        responseReceived: false,
        category: "invalid-request-construction",
        errorName,
      });
      throw new RoutingError({
        reason: "invalid-request-construction",
        message: "The routing request could not be constructed.",
        transportErrorName: errorName,
        dispatchMarkers: { ...markers },
      });
    }

    // Stage D: invoke fetch synchronously, without awaiting yet — a
    // synchronous invocation-time throw (e.g. an "Illegal invocation"-
    // shaped error from an engine that binds fetch to its receiver) is
    // caught right here, structurally distinct from an asynchronous
    // rejection of the returned promise (Stage E below). The try/catch
    // boundary itself is the source of truth for that distinction, never
    // inferred from the caught error's message.
    let responsePromise: Promise<Response>;
    try {
      // Set before the call, not after — "invoked" means "we attempted
      // the call", not "the call succeeded"; a synchronous throw below
      // still means fetch was genuinely invoked.
      markers.fetchInvoked = true;
      responsePromise = this.fetchImpl(request);
    } catch (error) {
      clearTimeout(timeoutId);
      const errorName = error instanceof Error ? error.name : "unknown";
      const rawMessage = error instanceof Error ? error.message : String(error);
      const sanitisedMessage = sanitiseTransportErrorMessage(rawMessage, apiKey);
      const reasonCode = classifyTransportFailureReasonCode(rawMessage);
      recordAttempt({
        responseReceived: false,
        category: "fetch-invocation-failure",
        errorName,
        errorMessage: sanitisedMessage,
        transportFailureReasonCode: reasonCode,
      });
      throw new RoutingError({
        reason: "fetch-invocation-failure",
        message: "The routing request could not be sent.",
        transportErrorName: errorName,
        transportErrorMessage: sanitisedMessage,
        transportFailureReasonCode: reasonCode,
        dispatchMarkers: { ...markers },
      });
    }

    if (
      !(responsePromise instanceof Promise) &&
      typeof (responsePromise as { then?: unknown } | null | undefined)?.then !==
        "function"
    ) {
      // Only reachable with a badly-behaved injected fetchImpl — the
      // native fetch always returns a real Promise. Classified explicitly
      // rather than falling through to a misleading transport-failure.
      clearTimeout(timeoutId);
      recordAttempt({
        responseReceived: false,
        category: "fetch-invocation-failure",
        errorName: "TypeError",
        transportFailureReasonCode: "fetch-returned-non-promise",
      });
      throw new RoutingError({
        reason: "fetch-invocation-failure",
        message:
          "The routing request implementation returned an invalid value instead of a promise.",
        transportErrorName: "TypeError",
        transportFailureReasonCode: "fetch-returned-non-promise",
        dispatchMarkers: { ...markers },
      });
    }
    markers.fetchReturnedPromise = true;

    // Stage E: await the fetch promise — genuine asynchronous rejection
    // (network/DNS/TLS/a CORS-hidden response/offline mid-flight/timeout),
    // never a construction or invocation-time problem.
    let response: Response;
    try {
      response = await responsePromise;
    } catch (error) {
      if (isAbortError(error)) {
        if (signal?.aborted) {
          // A genuine caller cancellation — never a real error, and never
          // recorded as a diagnostic; re-thrown unchanged so callers can
          // recognise it via error.name.
          throw error;
        }
        recordAttempt({ responseReceived: false, category: "timeout" });
        throw new RoutingError({
          reason: "timeout",
          message: "The routing request timed out.",
          dispatchMarkers: { ...markers },
        });
      }
      // Cannot reliably distinguish a provider outage, a DNS/TLS failure,
      // a local network restriction, or a real HTTP error response whose
      // CORS headers were missing (see RoutingErrorReason's doc comment)
      // — the diagnostic and the message both say so honestly. errorName
      // is always safe (a fixed browser class name); errorMessage is only
      // ever the sanitised, allowlisted form (see sanitiseErrorMessage.ts)
      // — the raw message is used transiently for classification only and
      // never itself recorded or thrown.
      const errorName = error instanceof Error ? error.name : "unknown";
      const rawMessage = error instanceof Error ? error.message : String(error);
      const sanitisedMessage = sanitiseTransportErrorMessage(rawMessage, apiKey);
      const reasonCode = classifyTransportFailureReasonCode(rawMessage);
      recordAttempt({
        responseReceived: false,
        category: "transport-failure",
        errorName,
        errorMessage: sanitisedMessage,
        transportFailureReasonCode: reasonCode,
      });
      throw new RoutingError({
        reason: "transport-failure",
        message: "The routing request failed.",
        transportErrorName: errorName,
        transportErrorMessage: sanitisedMessage,
        transportFailureReasonCode: reasonCode,
        dispatchMarkers: { ...markers },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Stage F: a response was received.
    markers.responseReceived = true;

    if (!response.ok) {
      const { routingError, bodyWasJson } = await mapErrorResponse(response, {
        ...markers,
      });
      const rateLimits = readRateLimitHeaders(response);
      recordAttempt({
        responseReceived: true,
        httpStatus: response.status,
        statusText: response.statusText,
        bodyWasJson,
        providerErrorCode: routingError.providerErrorCode,
        rateLimitRemaining: rateLimits.remaining,
        rateLimitLimit: rateLimits.limit,
        category: routingError.reason,
      });
      throw routingError;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      recordAttempt({
        responseReceived: true,
        httpStatus: response.status,
        statusText: response.statusText,
        bodyWasJson: false,
        category: "malformed-response",
      });
      throw new RoutingError({
        reason: "malformed-response",
        message: "The routing response could not be parsed.",
        dispatchMarkers: { ...markers },
      });
    }

    if (!isOrsFeatureCollection(payload)) {
      recordAttempt({
        responseReceived: true,
        httpStatus: response.status,
        statusText: response.statusText,
        bodyWasJson: true,
        category: "malformed-response",
      });
      throw new RoutingError({
        reason: "malformed-response",
        message: "The routing response had an unexpected shape.",
        dispatchMarkers: { ...markers },
      });
    }

    try {
      const route = normalizeOpenRouteServiceRoute(payload, {
        name: "Planned route",
        createdAt: new Date().toISOString(),
        profile: options.profile,
        providerId: OPENROUTESERVICE_PROVIDER_ID,
      });
      recordAttempt({
        responseReceived: true,
        httpStatus: response.status,
        statusText: response.statusText,
        bodyWasJson: true,
        category: "success",
      });
      return route;
    } catch (error) {
      recordAttempt({
        responseReceived: true,
        httpStatus: response.status,
        statusText: response.statusText,
        bodyWasJson: true,
        category: error instanceof RoutingError ? error.reason : "unknown",
      });
      throw error;
    }
  }
}
