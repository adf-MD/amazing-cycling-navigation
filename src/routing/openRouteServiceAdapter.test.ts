import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouteServiceAdapter } from "./openRouteServiceAdapter.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
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
    headers: new Headers(response.headers ?? {}),
    json: response.json ?? (() => Promise.resolve(buildValidResponse())),
  } as Response);
  return mock;
}

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

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(requestInit.headers);
    expect(headers.get("Authorization")).toBe(DUMMY_KEY);
  });

  it("never puts the key in the request URL", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).not.toContain(DUMMY_KEY);
    expect(url).toContain(
      "https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson",
    );
  });

  it("posts the cycling-road profile and requests elevation/surface/instructions", async () => {
    const fetchImpl = buildFetchMock({ ok: true });
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" });

    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/directions/cycling-road/geojson");
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
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

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
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
    ).rejects.toMatchObject({ reason });
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

  it("maps a network-throwing fetch to network-failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve(DUMMY_KEY),
      fetchImpl,
    });

    await expect(
      adapter.calculateRoute(WAYPOINTS, { profile: "cycling-road" }),
    ).rejects.toMatchObject({ reason: "network-failure" });
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

  it("returns a normalised PlannedRoute on success", async () => {
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
  });

  describe("diagnostics redaction", () => {
    it("never includes the dummy key or waypoint coordinates in a thrown error's message, even against an echoing response", async () => {
      const fetchImpl = buildFetchMock({
        ok: false,
        status: 500,
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
  });
});
