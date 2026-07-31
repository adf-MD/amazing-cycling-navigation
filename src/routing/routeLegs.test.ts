import { describe, expect, it } from "vitest";
import {
  LEG_REQUEST_CONCURRENCY_LIMIT,
  RouteLegCache,
  deriveLegRequirements,
  getProviderInstanceToken,
  resolveRouteLegsInOrder,
} from "./routeLegs.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
import type { RoutingOptions, RoutingProvider } from "./provider.ts";
import type { Coordinate, PlannedRoute, Waypoint } from "../domain/types.ts";

const A: Waypoint = { id: "a", coordinate: [0, 51] };
const B: Waypoint = { id: "b", coordinate: [0.001, 51] };
const B_MOVED: Waypoint = { id: "b", coordinate: [0.0011, 51] };
const C: Waypoint = { id: "c", coordinate: [0.002, 51] };
const D: Waypoint = { id: "d", coordinate: [0.003, 51] };
const E: Waypoint = { id: "e", coordinate: [0.004, 51] };
const X: Waypoint = { id: "x", coordinate: [0.0015, 51] };

const OPTIONS: RoutingOptions = { profile: "cycling-road", avoidFerries: false };

function buildRoute(id: string): PlannedRoute {
  return {
    id,
    name: "Leg",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
      { coordinate: [0.001, 51], elevationMetres: null, distanceFromStartMetres: 70 },
    ],
    manoeuvres: [],
    distanceMetres: 70,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

interface RecordedCall {
  waypoints: Coordinate[];
  options: RoutingOptions;
  signal?: AbortSignal;
}

function buildImmediateAdapter(): { adapter: RoutingProvider; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const adapter: RoutingProvider = {
    calculateRoute: (waypoints, options, signal) => {
      calls.push({ waypoints, options, signal });
      return Promise.resolve(buildRoute(`route-${String(calls.length)}`));
    },
  };
  return { adapter, calls };
}

interface DeferredCall {
  waypoints: Coordinate[];
  options: RoutingOptions;
  signal?: AbortSignal;
  settled: boolean;
  resolve: (route: PlannedRoute) => void;
  reject: (error: unknown) => void;
}

function buildQueuedAdapter(): { adapter: RoutingProvider; calls: DeferredCall[] } {
  const calls: DeferredCall[] = [];
  const adapter: RoutingProvider = {
    calculateRoute: (waypoints, options, signal) => {
      const call: DeferredCall = {
        waypoints,
        options,
        signal,
        settled: false,
        resolve: () => undefined,
        reject: () => undefined,
      };
      const promise = new Promise<PlannedRoute>((resolve, reject) => {
        call.resolve = resolve;
        call.reject = reject;
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
      // Two-argument .then() consumes the rejection branch itself, so this
      // never produces an unhandled-rejection warning — it exists purely
      // to flip `settled` for the concurrency assertions below.
      promise.then(
        () => {
          call.settled = true;
        },
        () => {
          call.settled = true;
        },
      );
      calls.push(call);
      return promise;
    },
  };
  return { adapter, calls };
}

function activeCallCount(calls: DeferredCall[]): number {
  return calls.filter((call) => !call.settled).length;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("deriveLegRequirements", () => {
  it("produces one requirement for two waypoints", () => {
    expect(deriveLegRequirements([A, B])).toEqual([
      { start: A.coordinate, end: B.coordinate },
    ]);
  });

  it("produces n-1 requirements for n waypoints, in order", () => {
    expect(deriveLegRequirements([A, B, C, D])).toEqual([
      { start: A.coordinate, end: B.coordinate },
      { start: B.coordinate, end: C.coordinate },
      { start: C.coordinate, end: D.coordinate },
    ]);
  });

  it("treats reversed endpoints as a different requirement", () => {
    const forward = deriveLegRequirements([A, B]);
    const backward = deriveLegRequirements([B, A]);
    expect(forward[0]).not.toEqual(backward[0]);
  });

  it("produces no requirements for fewer than two waypoints", () => {
    expect(deriveLegRequirements([])).toEqual([]);
    expect(deriveLegRequirements([A])).toEqual([]);
  });
});

describe("RouteLegCache", () => {
  it("reuses an entry for an identical key", () => {
    const cache = new RouteLegCache();
    const route = buildRoute("r1");
    cache.set("key-1", route);
    expect(cache.get("key-1")).toBe(route);
  });

  it("misses for an unknown key", () => {
    const cache = new RouteLegCache();
    expect(cache.get("nope")).toBeUndefined();
  });

  it("evicts the oldest entry deterministically once over its bound", () => {
    const cache = new RouteLegCache(2);
    cache.set("a", buildRoute("a"));
    cache.set("b", buildRoute("b"));
    cache.set("c", buildRoute("c"));

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it("counts a get() as a use, protecting a recently-touched entry from eviction", () => {
    const cache = new RouteLegCache(2);
    cache.set("a", buildRoute("a"));
    cache.set("b", buildRoute("b"));
    cache.get("a");
    cache.set("c", buildRoute("c"));

    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("getProviderInstanceToken", () => {
  it("assigns a stable token for the same adapter instance", () => {
    const adapter: RoutingProvider = {
      calculateRoute: () => Promise.reject(new Error("unused")),
    };
    expect(getProviderInstanceToken(adapter)).toBe(getProviderInstanceToken(adapter));
  });

  it("assigns different tokens to different adapter instances", () => {
    const adapterA: RoutingProvider = {
      calculateRoute: () => Promise.reject(new Error("unused")),
    };
    const adapterB: RoutingProvider = {
      calculateRoute: () => Promise.reject(new Error("unused")),
    };
    expect(getProviderInstanceToken(adapterA)).not.toBe(
      getProviderInstanceToken(adapterB),
    );
  });
});

describe("resolveRouteLegsInOrder — cache keying", () => {
  it("does not reuse a cached leg across different adapter instances even with identical requirement/options", async () => {
    const cache = new RouteLegCache();
    const { adapter: adapterA, calls: callsA } = buildImmediateAdapter();
    const { adapter: adapterB, calls: callsB } = buildImmediateAdapter();
    const tokenA = getProviderInstanceToken(adapterA);
    const tokenB = getProviderInstanceToken(adapterB);
    const requirements = deriveLegRequirements([A, B]);

    await resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter: adapterA,
      cache,
      providerToken: tokenA,
    });
    expect(callsA).toHaveLength(1);

    await resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter: adapterB,
      cache,
      providerToken: tokenB,
    });
    expect(callsB).toHaveLength(1);
  });

  it("re-requests every leg when avoidFerries changes, even with unchanged endpoints", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B, C, D]);

    await resolveRouteLegsInOrder(
      requirements,
      { profile: "cycling-road", avoidFerries: false },
      { adapter, cache, providerToken },
    );
    calls.length = 0;
    await resolveRouteLegsInOrder(
      requirements,
      { profile: "cycling-road", avoidFerries: true },
      { adapter, cache, providerToken },
    );

    expect(calls).toHaveLength(3);
  });

  it("re-requests every leg when profile changes, even with unchanged endpoints and avoidFerries", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B, C, D]);

    await resolveRouteLegsInOrder(
      requirements,
      { profile: "cycling-road", avoidFerries: false },
      { adapter, cache, providerToken },
    );
    calls.length = 0;
    await resolveRouteLegsInOrder(
      requirements,
      { profile: "cycling-regular", avoidFerries: false },
      { adapter, cache, providerToken },
    );

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.options.profile).toBe("cycling-regular");
    }
  });

  it("resolves entirely from cache, with no adapter calls, when switching back to a previously-used profile", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B, C, D]);

    await resolveRouteLegsInOrder(
      requirements,
      { profile: "cycling-road", avoidFerries: false },
      { adapter, cache, providerToken },
    );
    await resolveRouteLegsInOrder(
      requirements,
      { profile: "cycling-regular", avoidFerries: false },
      { adapter, cache, providerToken },
    );
    calls.length = 0;

    // Switching back to cycling-road with the same waypoints: every leg
    // is still cached under its own cycling-road key, so this resolves
    // with zero further adapter calls — the mechanism Planning relies on
    // to recognise a matching retained result without a new request.
    await resolveRouteLegsInOrder(
      requirements,
      { profile: "cycling-road", avoidFerries: false },
      { adapter, cache, providerToken },
    );

    expect(calls).toHaveLength(0);
  });
});

describe("resolveRouteLegsInOrder — [A,B,C,D] edit scenarios request exactly the required legs", () => {
  it("first calculation requests exactly 3 legs, each with exactly 2 coordinates", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B, C, D]);

    const legs = await resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.waypoints).toHaveLength(2);
    }
    expect(calls.map((call) => call.waypoints)).toEqual([
      [A.coordinate, B.coordinate],
      [B.coordinate, C.coordinate],
      [C.coordinate, D.coordinate],
    ]);
    expect(legs).toHaveLength(3);
  });

  it("an unchanged recalculation makes zero new calls", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B, C, D]);
    await resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    calls.length = 0;
    const legs = await resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    expect(calls).toHaveLength(0);
    expect(legs).toHaveLength(3);
  });

  it("moving B requests exactly 2 legs (A→B_moved, B_moved→C), reusing C→D", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    calls.length = 0;
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B_MOVED, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.waypoints)).toEqual([
      [A.coordinate, B_MOVED.coordinate],
      [B_MOVED.coordinate, C.coordinate],
    ]);
  });

  it("appending E requests exactly 1 leg (D→E)", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    calls.length = 0;
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D, E]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.waypoints).toEqual([D.coordinate, E.coordinate]);
  });

  it("inserting X between B and C requests exactly 2 legs (B→X, X→C)", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    calls.length = 0;
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, X, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.waypoints)).toEqual([
      [B.coordinate, X.coordinate],
      [X.coordinate, C.coordinate],
    ]);
  });

  it("deleting interior waypoint C requests exactly 1 new leg (B→D)", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    calls.length = 0;
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.waypoints).toEqual([B.coordinate, D.coordinate]);
  });

  it("reordering to [A,B,D,C] reuses A→B and requests only the two new ordered pairs", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    calls.length = 0;
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, D, C]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.waypoints)).toEqual([
      [B.coordinate, D.coordinate],
      [D.coordinate, C.coordinate],
    ]);
  });

  it("undo (reverting to the original waypoints) reuses every cached leg — zero new calls", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B_MOVED, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    calls.length = 0;
    // "Undo" the move — back to the exact original waypoint array.
    const legs = await resolveRouteLegsInOrder(
      deriveLegRequirements([A, B, C, D]),
      OPTIONS,
      {
        adapter,
        cache,
        providerToken,
      },
    );

    expect(calls).toHaveLength(0);
    expect(legs).toHaveLength(3);
  });

  it("redo (reapplying the move) reuses every cached leg — zero new calls", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B_MOVED, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    }); // undo

    calls.length = 0;
    const legs = await resolveRouteLegsInOrder(
      deriveLegRequirements([A, B_MOVED, C, D]),
      OPTIONS,
      {
        adapter,
        cache,
        providerToken,
      },
    ); // redo

    expect(calls).toHaveLength(0);
    expect(legs).toHaveLength(3);
  });

  it("return to start requests exactly 1 new closing leg (D→A)", async () => {
    const { adapter, calls } = buildImmediateAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    calls.length = 0;
    await resolveRouteLegsInOrder(deriveLegRequirements([A, B, C, D, A]), OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.waypoints).toEqual([D.coordinate, A.coordinate]);
  });
});

describe("resolveRouteLegsInOrder — concurrency", () => {
  it(`never has more than ${String(LEG_REQUEST_CONCURRENCY_LIMIT)} requests in flight at once`, async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B, C, D, E]);

    const resultPromise = resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
    });

    await flushMicrotasks();
    expect(calls).toHaveLength(LEG_REQUEST_CONCURRENCY_LIMIT);
    expect(activeCallCount(calls)).toBe(LEG_REQUEST_CONCURRENCY_LIMIT);

    calls[0]?.resolve(buildRoute("r0"));
    await flushMicrotasks();
    expect(activeCallCount(calls)).toBeLessThanOrEqual(LEG_REQUEST_CONCURRENCY_LIMIT);
    expect(calls).toHaveLength(3);

    calls[1]?.resolve(buildRoute("r1"));
    await flushMicrotasks();
    expect(calls).toHaveLength(4);

    calls[2]?.resolve(buildRoute("r2"));
    calls[3]?.resolve(buildRoute("r3"));
    const legs = await resultPromise;

    expect(legs).toHaveLength(4);
  });
});

describe("resolveRouteLegsInOrder — failures and cancellation", () => {
  it("a decisive failure aborts sibling in-flight legs and stops launching new work", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B, C, D, E]);

    const resultPromise = resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
    });
    resultPromise.catch(() => undefined);

    await flushMicrotasks();
    expect(calls).toHaveLength(2);

    calls[0]?.reject(new RoutingError({ reason: "unauthorized", message: "bad key" }));
    await flushMicrotasks();

    expect(calls[1]?.settled).toBe(true);
    expect(calls).toHaveLength(2);
    await expect(resultPromise).rejects.toMatchObject({ reason: "unauthorized" });
  });

  it("external signal supersession surfaces as an AbortError, not a decisive routing failure", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B]);
    const externalController = new AbortController();

    const resultPromise = resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
      signal: externalController.signal,
    });
    resultPromise.catch(() => undefined);

    await flushMicrotasks();
    expect(calls).toHaveLength(1);

    externalController.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.size).toBe(0);
  });

  it("never caches a failed leg", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B]);

    const resultPromise = resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
    });
    resultPromise.catch(() => undefined);

    await flushMicrotasks();
    calls[0]?.reject(
      new RoutingError({ reason: "provider-unavailable", message: "down" }),
    );

    await expect(resultPromise).rejects.toBeInstanceOf(RoutingError);
    expect(cache.size).toBe(0);
  });

  it("never caches an aborted leg", async () => {
    const { adapter } = buildQueuedAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B]);
    const externalController = new AbortController();

    const resultPromise = resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
      signal: externalController.signal,
    });
    resultPromise.catch(() => undefined);

    await flushMicrotasks();
    externalController.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.size).toBe(0);
  });

  it("caches a successful leg from a batch that later fails, and reuses it in the next resolution", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const cache = new RouteLegCache();
    const providerToken = getProviderInstanceToken(adapter);
    const requirements = deriveLegRequirements([A, B, C]);

    const resultPromise = resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
    });
    resultPromise.catch(() => undefined);

    await flushMicrotasks();
    expect(calls).toHaveLength(2);

    const routeAB = buildRoute("leg-ab");
    calls[0]?.resolve(routeAB);
    calls[1]?.reject(new RoutingError({ reason: "unauthorized", message: "bad key" }));

    await expect(resultPromise).rejects.toMatchObject({ reason: "unauthorized" });
    expect(cache.size).toBe(1);

    calls.length = 0;
    const retryPromise = resolveRouteLegsInOrder(requirements, OPTIONS, {
      adapter,
      cache,
      providerToken,
    });
    await flushMicrotasks();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.waypoints).toEqual([B.coordinate, C.coordinate]);
    calls[0]?.resolve(buildRoute("leg-bc"));

    const legs = await retryPromise;
    expect(legs).toHaveLength(2);
    expect(legs[0]?.route).toBe(routeAB);
  });
});
