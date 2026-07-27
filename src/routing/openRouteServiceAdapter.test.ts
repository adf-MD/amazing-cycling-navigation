import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouteServiceAdapter } from "./openRouteServiceAdapter.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
import {
  clearRoutingDiagnostics,
  getRecentRoutingAttempts,
} from "./routingDiagnostics.ts";
import type { Coordinate } from "../domain/types.ts";
import type { OrsFeatureCollectionResponse } from "./openRouteServiceTypes.ts";

// Clearly fake — never a real key, matching CLAUDE.md's "never use a real
// API key in automated tests" requirement.
const DUMMY_KEY = "test-dummy-ors-key-0000000000";
const WAYPOINTS: Coordinate[] = [
  [-1.5, 53.8],
  [-1.4, 53.8],
];

function buildValidResponse(): OrsFeatureCollectionResponse {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: 1000, duration: 100 } },
        geometry: {
          type: "LineString",
          coordinates: [
            [-1.5, 53.8, 10],
            [-1.4, 53.8, 12],
          ],
        },
      },
    ],
  };
}

function buildFetchMock(response: {
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  json?: () => Promise<unknown>;
}) {
  const mock = vi.fn<typeof fetch>();
  mock.mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: "",
    headers: new Headers(response.headers ?? {}),
    json: response.json ?? (() => Promise.resolve(buildValidResponse())),
  } as Response);
  return mock;
}

/** The adapter calls its fetch implementation with a single native
 * `Request` object (see openRouteServiceAdapter.ts's Stage D) — this reads
 * back the fields tests need from it. */
function firstRequest(fetchImpl: ReturnType<typeof vi.fn>): Request {
  const [request] = fetchImpl.mock.calls[0] as [Request];
  return request;
}

beforeEach(() => {
  clearRoutingDiagnostics();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouteServiceAdapter", () => {
  it("never makes a request when no key is configured", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(undefined),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "no-api-key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the key in the Authorization header, unprefixed", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });

    expect(firstRequest(fetchImpl).headers.get("Authorization")).toBe(DUMMY_KEY);
  });

  it("never puts the key in the request URL, and posts to the exact production endpoint", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });

    const url = firstRequest(fetchImpl).url;
    expect(url).not.toContain(DUMMY_KEY);
    expect(url).toBe(
      "https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson",
    );
  });

  it("sends an Accept header matching the two shapes the endpoint can return", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });

    expect(firstRequest(fetchImpl).headers.get("Accept")).toBe(
      "application/geo+json, application/json",
    );
  });

  it("posts the cycling-road profile and requests elevation/surface/instructions", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });

    const request = firstRequest(fetchImpl);
    expect(request.url).toContain("/directions/cycling-road/geojson");
    const body = (await request.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      coordinates: [
        [-1.5, 53.8],
        [-1.4, 53.8],
      ],
      elevation: true,
      extra_info: ["surface"],
      instructions: true,
    });
  });

  it("includes avoid_features ferries only when avoidFerries is set", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await adapter.calculateRoute(WAYPOINTS, {
      profile: "cycling-road",
      avoidFerries: true,
    });

    const body = (await firstRequest(fetchImpl).json()) as Record<string, unknown>;
    expect(body.options).toEqual({ avoid_features: ["ferries"] });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate-limited"],
  ])("maps HTTP %d to reason %s", async (status, reason) => {
    const fetchImpl = buildFetchMock({ ok: false, status });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason, httpStatus: status });
  });

  it("surfaces a 429's Retry-After as retryAfterSeconds", async () => {
    const fetchImpl = buildFetchMock({
      ok: false,
      status: 429,
      headers: { "Retry-After": "30" },
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "rate-limited", retryAfterSeconds: 30 });
  });

  it("throws offline before ever calling fetch when the browser reports offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "offline" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a network-throwing fetch (no response received) to transport-failure, with a safe sanitised message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({
      reason: "transport-failure",
      transportErrorName: "TypeError",
      transportErrorMessage: "Failed to fetch",
      transportFailureReasonCode: "generic-fetch-rejection",
      dispatchMarkers: {
        headersConstructed: true,
        requestConstructed: true,
        fetchInvoked: true,
        fetchReturnedPromise: true,
        responseReceived: false,
      },
    });

    const [latest] = getRecentRoutingAttempts();
    expect(latest).toMatchObject({
      responseReceived: false,
      category: "transport-failure",
      errorName: "TypeError",
      errorMessage: "Failed to fetch",
      transportFailureReasonCode: "generic-fetch-rejection",
      waypointCount: WAYPOINTS.length,
      headersConstructed: true,
      requestConstructed: true,
      fetchInvoked: true,
      fetchReturnedPromise: true,
    });
  });

  it("withholds an unrecognised transport error's message from both the error and the diagnostic", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError(`blocked while fetching key ${DUMMY_KEY}`));
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({
      reason: "transport-failure",
      transportErrorName: "TypeError",
      transportErrorMessage: undefined,
    });

    const [latest] = getRecentRoutingAttempts();
    expect(latest?.errorMessage).toBeUndefined();
    expect(JSON.stringify(latest)).not.toContain(DUMMY_KEY);
  });

  it("distinguishes the adapter's own AbortController timeout from a caller cancellation", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockImplementation(
        (request: Request) =>
          new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      const promise = adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });
      const assertion = expect(promise).rejects.toMatchObject({ reason: "timeout" });
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;

      const [latest] = getRecentRoutingAttempts();
      expect(latest).toMatchObject({
        responseReceived: false,
        category: "timeout",
        headersConstructed: true,
        requestConstructed: true,
        fetchInvoked: true,
        fetchReturnedPromise: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps ORS error code 2009 (no route between locations) to no-route-found", async () => {
    const fetchImpl = buildFetchMock({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: { code: 2009, message: "Route could not be found between locations" },
        }),
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "no-route-found", providerErrorCode: 2009 });
  });

  it.each([2010, 2011])(
    "maps ORS error code %d (no routable point) to no-routable-point",
    async (code) => {
      const fetchImpl = buildFetchMock({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { code, message: "not routable" } }),
      });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toMatchObject({ reason: "no-routable-point", providerErrorCode: code });
    },
  );

  it.each([500, 502, 503, 504])(
    "maps HTTP %d to provider-unavailable without reading the response body",
    async (status) => {
      const fetchImpl = buildFetchMock({
        ok: false,
        status,
        json: () => Promise.reject(new Error("must not be read for a 5xx")),
      });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toMatchObject({ reason: "provider-unavailable", httpStatus: status });
    },
  );

  it("falls back to provider-error for an unrecognised status/body combination", async () => {
    const fetchImpl = buildFetchMock({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: 9999, message: "unknown" } }),
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({
      reason: "provider-error",
      providerErrorCode: 9999,
      httpStatus: 404,
    });
  });

  it("re-throws a genuine caller cancellation unchanged, not as a RoutingError", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort();
      const abortError = new DOMException("Aborted", "AbortError");
      return Promise.reject(abortError);
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    const promise = adapter.calculateRoute(
      WAYPOINTS,
      { profile: "cycling-road" },
      controller.signal,
    );

    await expect(promise).rejects.toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
    await expect(promise).rejects.not.toBeInstanceOf(RoutingError);
  });

  it("maps a malformed (non-JSON) response to malformed-response", async () => {
    const fetchImpl = buildFetchMock({
      ok: true,
      json: () => Promise.reject(new Error("not json")),
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "malformed-response" });
  });

  it("maps a structurally-unexpected response body to malformed-response", async () => {
    const fetchImpl = buildFetchMock({
      ok: true,
      json: () => Promise.resolve({ unexpected: "shape" }),
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "malformed-response" });
  });

  it("maps a response with no usable geometry to no-geometry", async () => {
    const fetchImpl = buildFetchMock({
      ok: true,
      json: () =>
        Promise.resolve({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { summary: { distance: 0, duration: 0 } },
              geometry: { type: "LineString", coordinates: [] },
            },
          ],
        }),
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "no-geometry" });
  });

  it("returns a normalised PlannedRoute on success, with every dispatch marker true", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    const route = await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });

    expect(route.source).toEqual({
      kind: "planner",
      provider: "openrouteservice",
      profile: "cycling-road",
    });
    expect(route.points.length).toBeGreaterThan(0);

    const [latest] = getRecentRoutingAttempts();
    expect(latest).toMatchObject({
      bodyWasJson: true,
      category: "success",
      headersConstructed: true,
      requestConstructed: true,
      fetchInvoked: true,
      fetchReturnedPromise: true,
      responseReceived: true,
    });
  });

  it("records bodyWasJson: false only when a parse was actually attempted and failed", async () => {
    const fetchImpl = buildFetchMock({
      ok: true,
      json: () => Promise.reject(new Error("not json")),
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "malformed-response" });

    const [latest] = getRecentRoutingAttempts();
    expect(latest).toMatchObject({ bodyWasJson: false, category: "malformed-response" });
  });

  it("leaves bodyWasJson unset for a 5xx, which never attempts a body parse", async () => {
    const fetchImpl = buildFetchMock({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error("must not be read for a 5xx")),
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "provider-unavailable" });

    const [latest] = getRecentRoutingAttempts();
    expect(latest?.bodyWasJson).toBeUndefined();
  });

  it("captures best-effort rate-limit headers when the provider exposes them via CORS", async () => {
    const fetchImpl = buildFetchMock({
      ok: false,
      status: 429,
      headers: { "RateLimit-Remaining": "3", "RateLimit-Limit": "40" },
    });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "rate-limited" });

    const [latest] = getRecentRoutingAttempts();
    expect(latest).toMatchObject({ rateLimitRemaining: "3", rateLimitLimit: "40" });
  });

  it("leaves rate-limit fields unset when the provider doesn't expose them", async () => {
    const fetchImpl = buildFetchMock({ ok: false, status: 429 });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "rate-limited" });

    const [latest] = getRecentRoutingAttempts();
    expect(latest?.rateLimitRemaining).toBeUndefined();
    expect(latest?.rateLimitLimit).toBeUndefined();
  });

  describe("explicit request stages", () => {
    it("Stage A: rejects an invalid stored key before ever constructing headers or invoking fetch", async () => {
      const fetchImpl = buildFetchMock({ ok: true });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve("abc\ndef"),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toMatchObject({
        reason: "invalid-header-value",
        dispatchMarkers: {
          headersConstructed: false,
          requestConstructed: false,
          fetchInvoked: false,
          fetchReturnedPromise: false,
          responseReceived: false,
        },
      });
      expect(fetchImpl).not.toHaveBeenCalled();

      const [latest] = getRecentRoutingAttempts();
      expect(latest).toMatchObject({
        category: "invalid-header-value",
        headersConstructed: false,
        requestConstructed: false,
        fetchInvoked: false,
      });
    });

    it("Stage A: never includes the key in the thrown message or the diagnostic", async () => {
      const badKey = "abc\ndef-secret";
      const fetchImpl = buildFetchMock({ ok: true });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(badKey),
        fetchImpl,
      });

      try {
        await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });
        expect.unreachable("expected calculateRoute to throw");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(badKey);
        expect(message).not.toContain("secret");
      }
      const [latest] = getRecentRoutingAttempts();
      expect(JSON.stringify(latest)).not.toContain("secret");
    });

    it("Stage B: classifies an unexpected native Headers-construction failure as header-construction-failure, without claiming the key is invalid", async () => {
      // Built before stubbing Headers — buildFetchMock's own Response
      // stand-in also constructs a Headers object internally.
      const fetchImpl = buildFetchMock({ ok: true });
      const originalHeaders = globalThis.Headers;
      function ThrowingHeaders(): never {
        throw new TypeError("Headers construction exploded");
      }
      vi.stubGlobal("Headers", ThrowingHeaders);
      try {
        const adapter = new OpenRouteServiceAdapter({
          getApiKey: () => Promise.resolve(DUMMY_KEY),
          fetchImpl,
        });

        await expect(
          adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
        ).rejects.toMatchObject({
          reason: "header-construction-failure",
          transportErrorName: "TypeError",
          dispatchMarkers: { headersConstructed: false, requestConstructed: false },
        });
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        vi.stubGlobal("Headers", originalHeaders);
      }
    });

    it("Stage B: never attempts to sanitise or surface the native Headers error's own message (it can embed the raw value)", async () => {
      const fetchImpl = buildFetchMock({ ok: true });
      const originalHeaders = globalThis.Headers;
      function ThrowingHeaders(): never {
        throw new TypeError(`Headers.append: "${DUMMY_KEY}" is an invalid header value.`);
      }
      vi.stubGlobal("Headers", ThrowingHeaders);
      try {
        const adapter = new OpenRouteServiceAdapter({
          getApiKey: () => Promise.resolve(DUMMY_KEY),
          fetchImpl,
        });

        await expect(
          adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
        ).rejects.toMatchObject({ transportErrorMessage: undefined });

        const [latest] = getRecentRoutingAttempts();
        expect(latest?.errorMessage).toBeUndefined();
        expect(JSON.stringify(latest)).not.toContain(DUMMY_KEY);
      } finally {
        vi.stubGlobal("Headers", originalHeaders);
      }
    });

    it("Stage C: classifies a Request-construction failure distinctly, after headers succeeded, without invoking fetch", async () => {
      const originalRequest = globalThis.Request;
      function ThrowingRequest(): never {
        throw new TypeError("Request construction exploded");
      }
      vi.stubGlobal("Request", ThrowingRequest);
      try {
        const fetchImpl = buildFetchMock({ ok: true });
        const adapter = new OpenRouteServiceAdapter({
          getApiKey: () => Promise.resolve(DUMMY_KEY),
          fetchImpl,
        });

        await expect(
          adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
        ).rejects.toMatchObject({
          reason: "invalid-request-construction",
          transportErrorName: "TypeError",
          dispatchMarkers: { headersConstructed: true, requestConstructed: false },
        });
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        vi.stubGlobal("Request", originalRequest);
      }
    });

    it("Stage D: classifies a synchronous fetch-invocation throw distinctly from an async rejection", async () => {
      const fetchImpl = vi.fn().mockImplementation(() => {
        throw new TypeError("Failed to execute 'fetch': Illegal invocation");
      });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toMatchObject({
        reason: "fetch-invocation-failure",
        transportFailureReasonCode: "fetch-illegal-invocation",
        dispatchMarkers: {
          headersConstructed: true,
          requestConstructed: true,
          fetchInvoked: true,
          fetchReturnedPromise: false,
          responseReceived: false,
        },
      });

      const [latest] = getRecentRoutingAttempts();
      expect(latest).toMatchObject({
        category: "fetch-invocation-failure",
        fetchInvoked: true,
        fetchReturnedPromise: false,
        transportFailureReasonCode: "fetch-illegal-invocation",
      });
    });

    it("Stage D: classifies a fetchImpl that returns a non-promise value explicitly, not as a misleading transport failure", async () => {
      const fetchImpl = vi.fn().mockReturnValue(undefined);
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toMatchObject({
        reason: "fetch-invocation-failure",
        transportFailureReasonCode: "fetch-returned-non-promise",
        dispatchMarkers: {
          fetchInvoked: true,
          fetchReturnedPromise: false,
          responseReceived: false,
        },
      });
    });

    it("an injected mock fetchImpl returning a real Response continues to work end-to-end", async () => {
      const fetchImpl = buildFetchMock({ ok: true });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      const route = await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(route.points.length).toBeGreaterThan(0);
    });
  });

  describe("diagnostics redaction", () => {
    it("never includes the dummy key or waypoint coordinates in a thrown error's message, even against an echoing response", async () => {
      // A non-5xx status, so the adapter actually attempts to read the
      // body (a 5xx skips that entirely — see the provider-unavailable
      // tests) — this exercises the real redaction-while-reading path.
      const fetchImpl = buildFetchMock({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            error: `request from key ${DUMMY_KEY} at ${JSON.stringify(WAYPOINTS)} failed`,
          }),
      });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      try {
        await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });
        expect.unreachable("expected calculateRoute to throw");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(DUMMY_KEY);
        expect(message).not.toContain("-1.5");
        expect(message).not.toContain("53.8");
      }
    });

    it("never includes error.message from a realistic ORS no-route-found body, even though it echoes coordinates", async () => {
      const fetchImpl = buildFetchMock({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: {
              code: 2009,
              message:
                "Route could not be found between locations 53.335, -6.28 and 53.34, -6.27.",
            },
          }),
      });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      try {
        await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });
        expect.unreachable("expected calculateRoute to throw");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("53.335");
        expect(message).not.toContain("-6.28");
        expect(error).toMatchObject({
          reason: "no-route-found",
          providerErrorCode: 2009,
        });
      }
    });
  });

  describe("routing attempt diagnostics", () => {
    it("records a received-response entry for a 502", async () => {
      const fetchImpl = buildFetchMock({ ok: false, status: 502 });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toMatchObject({ reason: "provider-unavailable" });

      const [latest] = getRecentRoutingAttempts();
      expect(latest).toMatchObject({
        providerId: "openrouteservice",
        wasOnline: true,
        responseReceived: true,
        httpStatus: 502,
        category: "provider-unavailable",
      });
    });

    it("records an offline entry without ever calling fetch", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      const fetchImpl = buildFetchMock({ ok: true });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toMatchObject({ reason: "offline" });

      const [latest] = getRecentRoutingAttempts();
      expect(latest).toMatchObject({
        wasOnline: false,
        responseReceived: false,
        category: "offline",
        headersConstructed: false,
        requestConstructed: false,
        fetchInvoked: false,
      });
    });

    it("records a no-response entry for a transport failure", async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toMatchObject({ reason: "transport-failure" });

      const [latest] = getRecentRoutingAttempts();
      expect(latest).toMatchObject({
        wasOnline: true,
        responseReceived: false,
        category: "transport-failure",
      });
    });

    it("never includes the dummy key or waypoint coordinates in a recorded diagnostic", async () => {
      const fetchImpl = buildFetchMock({
        ok: false,
        status: 502,
        json: () =>
          Promise.resolve({
            error: `request from key ${DUMMY_KEY} at ${JSON.stringify(WAYPOINTS)} failed`,
          }),
      });
      const adapter = new OpenRouteServiceAdapter({
        getApiKey: () => Promise.resolve(DUMMY_KEY),
        fetchImpl,
      });

      await expect(
        adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
      ).rejects.toBeInstanceOf(RoutingError);

      const [latest] = getRecentRoutingAttempts();
      const serialised = JSON.stringify(latest);
      expect(serialised).not.toContain(DUMMY_KEY);
      expect(serialised).not.toContain("-1.5");
      expect(serialised).not.toContain("53.8");
      expect(Object.keys(latest ?? {}).sort()).toEqual(
        [
          "attemptId",
          "timestampIso",
          "providerId",
          "endpointHost",
          "endpointPath",
          "httpMethod",
          "wasOnline",
          "isSecureContext",
          "isServiceWorkerControlled",
          "isStandalone",
          "waypointCount",
          "elapsedMs",
          "headersConstructed",
          "requestConstructed",
          "fetchInvoked",
          "fetchReturnedPromise",
          "responseReceived",
          "httpStatus",
          "statusText",
          "bodyWasJson",
          "providerErrorCode",
          "rateLimitRemaining",
          "rateLimitLimit",
          "category",
        ].sort(),
      );
    });
  });
});
