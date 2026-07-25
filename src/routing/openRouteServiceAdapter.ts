import type { Coordinate, PlannedRoute } from "../domain/types.ts";
import type { RoutingOptions, RoutingProvider } from "./provider.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
import {
  isOrsFeatureCollection,
  type OrsDirectionsRequestBody,
} from "./openRouteServiceTypes.ts";
import { normalizeOpenRouteServiceRoute } from "./normalizeOpenRouteServiceRoute.ts";

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
      return new RoutingError("unauthorized", "The OpenRouteService key was rejected.");
    case 403:
      return new RoutingError(
        "forbidden",
        "Access was denied — check the account, permissions or daily quota.",
        readRetryAfterSeconds(response),
      );
    case 429:
      return new RoutingError(
        "rate-limited",
        "The rate limit was reached.",
        readRetryAfterSeconds(response),
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
        );
      }
      if (reason === "no-routable-point") {
        return new RoutingError(
          reason,
          "A waypoint is too far from a usable road for cycling.",
          undefined,
          code,
        );
      }
      return new RoutingError(
        "provider-error",
        `The routing provider returned an unexpected error (status ${String(response.status)}).`,
        undefined,
        code,
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
      throw new RoutingError("no-api-key", "No OpenRouteService key is configured.");
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
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
      response = await this.fetchImpl(
        `${this.baseUrl}/directions/${options.profile}/geojson`,
        {
          method: "POST",
          headers: {
            // Raw key, never a "Bearer " prefix, and never appended to
            // the URL — see the redaction/URL tests.
            Authorization: apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: combinedSignal,
        },
      );
    } catch (error) {
      if (isAbortError(error)) {
        if (signal?.aborted) {
          // A genuine caller cancellation — re-thrown unchanged so
          // callers can recognise it as "not an error" via error.name.
          throw error;
        }
        throw new RoutingError("timeout", "The routing request timed out.");
      }
      throw new RoutingError("network-failure", "The routing request failed.");
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw await mapErrorResponse(response);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RoutingError(
        "malformed-response",
        "The routing response could not be parsed.",
      );
    }

    if (!isOrsFeatureCollection(payload)) {
      throw new RoutingError(
        "malformed-response",
        "The routing response had an unexpected shape.",
      );
    }

    return normalizeOpenRouteServiceRoute(payload, {
      name: "Planned route",
      createdAt: new Date().toISOString(),
      profile: options.profile,
      providerId: OPENROUTESERVICE_PROVIDER_ID,
    });
  }
}
