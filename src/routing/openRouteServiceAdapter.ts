import type { Coordinate, PlannedRoute } from "../domain/types.ts";
import type { RoutingOptions, RoutingProvider } from "./provider.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
import {
  isOrsFeatureCollection,
  type OrsDirectionsRequestBody,
} from "./openRouteServiceTypes.ts";
import { normalizeOpenRouteServiceRoute } from "./normalizeOpenRouteServiceRoute.ts";
import {
  recordRoutingAttempt,
  type RoutingAttemptDiagnostic,
} from "./routingDiagnostics.ts";

/** The current HeiGIT-hosted endpoint — the deprecated api.openrouteservice.org
 * host must never be used. */
const DEFAULT_BASE_URL = "https://api.heigit.org/openrouteservice/v2";

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
 * differently-shaped body just means "no code available". */
async function readOrsErrorCode(response: Response): Promise<number | undefined> {
  try {
    const body: unknown = await response.json();
    return hasNumericErrorCode(body) ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

async function mapErrorResponse(response: Response): Promise<RoutingError> {
  switch (response.status) {
    case 401:
      return new RoutingError(
        "unauthorized",
        "The OpenRouteService key was rejected.",
        undefined,
        undefined,
        response.status,
      );
    case 403:
      return new RoutingError(
        "forbidden",
        "Access was denied — check the account, permissions or daily quota.",
        readRetryAfterSeconds(response),
        undefined,
        response.status,
      );
    case 429:
      return new RoutingError(
        "rate-limited",
        "The rate limit was reached.",
        readRetryAfterSeconds(response),
        undefined,
        response.status,
      );
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
      return new RoutingError(
        "provider-unavailable",
        "OpenRouteService returned a server error.",
        undefined,
        undefined,
        response.status,
      );
    default: {
      // Deliberately never interpolates the response body's message text
      // — never risk echoing back request content (coordinates, key) the
      // provider might reflect in it. Only a recognised numeric error
      // code is read, which also proves the request reached and was
      // authenticated by the provider (see mapErrorReasonToOutcome).
      const code = await readOrsErrorCode(response);
      const reason = classifyOrsErrorCode(code);
      if (reason === "no-route-found") {
        return new RoutingError(
          reason,
          "No cycling route could be found between these waypoints.",
          undefined,
          code,
          response.status,
        );
      }
      if (reason === "no-routable-point") {
        return new RoutingError(
          reason,
          "A waypoint is too far from a usable road for cycling.",
          undefined,
          code,
          response.status,
        );
      }
      return new RoutingError(
        "provider-error",
        "The routing provider returned an unexpected error.",
        undefined,
        code,
        response.status,
      );
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
    this.fetchImpl = options.fetchImpl ?? fetch;
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
      throw new RoutingError("no-api-key", "No OpenRouteService key is configured.");
    }

    const startedAt = Date.now();
    const endpointHost = new URL(this.baseUrl).host;
    const endpointPath = `/directions/${options.profile}/geojson`;
    const wasOnline = typeof navigator === "undefined" || navigator.onLine;

    const recordAttempt = (
      fields: Pick<
        RoutingAttemptDiagnostic,
        "responseReceived" | "category" | "httpStatus" | "providerErrorCode"
      >,
    ): void => {
      recordRoutingAttempt({
        timestampIso: new Date().toISOString(),
        providerId: OPENROUTESERVICE_PROVIDER_ID,
        endpointHost,
        endpointPath,
        wasOnline,
        elapsedMs: Date.now() - startedAt,
        ...fields,
      });
    };

    if (!wasOnline) {
      recordAttempt({ responseReceived: false, category: "offline" });
      throw new RoutingError("offline", "The device is currently offline.");
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

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${endpointPath}`, {
        method: "POST",
        headers: {
          // Raw key, never a "Bearer " prefix, and never appended to
          // the URL — see the redaction/URL tests.
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        if (signal?.aborted) {
          // A genuine caller cancellation — never a real error, and never
          // recorded as a diagnostic; re-thrown unchanged so callers can
          // recognise it via error.name.
          throw error;
        }
        recordAttempt({ responseReceived: false, category: "timeout" });
        throw new RoutingError("timeout", "The routing request timed out.");
      }
      // Cannot reliably distinguish a provider outage, a DNS/TLS failure,
      // a local network restriction, or a real HTTP error response whose
      // CORS headers were missing (see RoutingErrorReason's doc comment)
      // — the diagnostic and the message both say so honestly.
      recordAttempt({ responseReceived: false, category: "transport-failure" });
      throw new RoutingError("transport-failure", "The routing request failed.");
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const routingError = await mapErrorResponse(response);
      recordAttempt({
        responseReceived: true,
        httpStatus: response.status,
        providerErrorCode: routingError.providerErrorCode,
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
        category: "malformed-response",
      });
      throw new RoutingError(
        "malformed-response",
        "The routing response could not be parsed.",
      );
    }

    if (!isOrsFeatureCollection(payload)) {
      recordAttempt({
        responseReceived: true,
        httpStatus: response.status,
        category: "malformed-response",
      });
      throw new RoutingError(
        "malformed-response",
        "The routing response had an unexpected shape.",
      );
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
        category: "success",
      });
      return route;
    } catch (error) {
      recordAttempt({
        responseReceived: true,
        httpStatus: response.status,
        category: error instanceof RoutingError ? error.reason : "unknown",
      });
      throw error;
    }
  }
}
