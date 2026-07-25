import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePlanningRoute } from "./usePlanningRoute.ts";
import { RoutingError } from "../../routing/openRouteServiceErrors.ts";
import type { RoutingOptions, RoutingProvider } from "../../routing/provider.ts";
import { db } from "../../storage/db.ts";
import {
  getProviderKeyVerification,
  saveProviderKey,
} from "../../storage/providerKeyRepository.ts";
import type { Coordinate, PlannedRoute, Waypoint } from "../../domain/types.ts";

const WAYPOINT_A: Waypoint = { id: "a", coordinate: [0, 51] };
const WAYPOINT_B: Waypoint = { id: "b", coordinate: [0.01, 51] };
const WAYPOINTS: Waypoint[] = [WAYPOINT_A, WAYPOINT_B];
const SINGLE_WAYPOINT: Waypoint[] = [WAYPOINT_A];

function buildRoute(id = "route-1"): PlannedRoute {
  return {
    id,
    name: "Test route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: Array.from({ length: 10 }, (_, i) => ({
      coordinate: [i * 0.001, 51] as Coordinate,
      elevationMetres: null,
      distanceFromStartMetres: i * 100,
    })),
    manoeuvres: [],
    distanceMetres: 1000,
    ascentMetres: 0,
    descentMetres: 0,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

interface DeferredCall {
  waypoints: Coordinate[];
  options: RoutingOptions;
  signal?: AbortSignal;
  resolve: (route: PlannedRoute) => void;
  reject: (error: unknown) => void;
}

function buildQueuedAdapter(): { adapter: RoutingProvider; calls: DeferredCall[] } {
  const calls: DeferredCall[] = [];
  const adapter: RoutingProvider = {
    calculateRoute: (waypoints, options, signal) =>
      new Promise<PlannedRoute>((resolve, reject) => {
        calls.push({ waypoints, options, signal, resolve, reject });
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  };
  return { adapter, calls };
}

/** Gives the promise-chain callbacks inside usePlanningRoute a turn to
 * run and commit their setState calls, after settling a deferred call
 * directly (bypassing the fetch/timer machinery real requests go
 * through). */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
});

describe("usePlanningRoute", () => {
  it("never calculates automatically on mount", () => {
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    expect(calls).toHaveLength(0);
    expect(result.current.state.kind).toBe("unrouted-preview");
  });

  it("calculateNow performs the explicit first calculation", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });

    expect(calls).toHaveLength(1);
    expect(result.current.isCalculating).toBe(true);

    const route = buildRoute();
    await act(async () => {
      calls[0]?.resolve(route);
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: "routed",
        route,
        waypoints: WAYPOINTS,
      });
    });
    expect(result.current.isCalculating).toBe(false);
  });

  it("does not call the provider with fewer than 2 waypoints", () => {
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: SINGLE_WAYPOINT,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });

    expect(calls).toHaveLength(0);
  });

  it("supersedes an in-flight request with a newer one, aborting the stale request", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });
    act(() => {
      result.current.calculateNow();
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal?.aborted).toBe(true);

    const route = buildRoute("second");
    await act(async () => {
      calls[1]?.resolve(route);
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.state).toMatchObject({ kind: "routed", route });
    });
  });

  it("never surfaces a cancellation/abort as a user-facing error", async () => {
    const { adapter } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });
    act(() => {
      result.current.calculateNow(); // aborts the first
    });

    await act(async () => {
      // The first call's own abort listener rejects it; nothing else to do
      // but give that rejection's handler a turn to run.
      await flushMicrotasks();
    });

    expect(result.current.lastErrorMessage).toBeNull();
    expect(result.current.state.kind).not.toBe("routed");
  });

  it("a failed recalculation retains the previous successful route, unchanged, with a separate error", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const { result, rerender } = renderHook(
      (props: { waypoints: readonly Waypoint[] }) =>
        usePlanningRoute({
          waypoints: props.waypoints,
          profile: "cycling-road",
          avoidFerries: false,
          adapter,
        }),
      { initialProps: { waypoints: WAYPOINTS } },
    );

    act(() => {
      result.current.calculateNow();
    });
    const firstRoute = buildRoute("first");
    await act(async () => {
      calls[0]?.resolve(firstRoute);
      await flushMicrotasks();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe("routed");
    });

    // A genuine edit triggers a debounced recalculation.
    const editedWaypoints: Waypoint[] = [
      ...WAYPOINTS,
      { id: "c", coordinate: [0.02, 51] },
    ];
    rerender({ waypoints: editedWaypoints });

    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    await act(async () => {
      calls[1]?.reject(new RoutingError("network-failure", "boom"));
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).not.toBeNull();
    });
    expect(result.current.state).toEqual({
      kind: "routed",
      route: firstRoute,
      waypoints: WAYPOINTS,
    });
  });

  it("clears the routed result once waypoints drop below 2", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const { result, rerender } = renderHook(
      (props: { waypoints: readonly Waypoint[] }) =>
        usePlanningRoute({
          waypoints: props.waypoints,
          profile: "cycling-road",
          avoidFerries: false,
          adapter,
        }),
      { initialProps: { waypoints: WAYPOINTS } },
    );

    act(() => {
      result.current.calculateNow();
    });
    await act(async () => {
      calls[0]?.resolve(buildRoute());
      await flushMicrotasks();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe("routed");
    });

    rerender({ waypoints: SINGLE_WAYPOINT });

    expect(result.current.state).toEqual({ kind: "insufficient-waypoints" });
  });

  it("records a verified outcome in storage after a successful calculation", async () => {
    await saveProviderKey("dummy-test-key");
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });
    await act(async () => {
      calls[0]?.resolve(buildRoute());
      await flushMicrotasks();
    });

    await waitFor(async () => {
      const verification = await getProviderKeyVerification();
      expect(verification).toMatchObject({ outcome: "verified" });
    });
  });

  it("records a rejected outcome in storage after a 401", async () => {
    await saveProviderKey("dummy-test-key");
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });
    await act(async () => {
      calls[0]?.reject(new RoutingError("unauthorized", "The key was rejected."));
      await flushMicrotasks();
    });

    await waitFor(async () => {
      const verification = await getProviderKeyVerification();
      expect(verification).toMatchObject({ outcome: "rejected" });
    });
  });

  it("shows the required no-key message when the adapter reports no-api-key", async () => {
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });
    await act(async () => {
      calls[0]?.reject(new RoutingError("no-api-key", "no key"));
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).toBe(
        "Road routing requires your personal OpenRouteService key.",
      );
    });
  });

  it("records a verified outcome (not unavailable) when the provider reports no route found", async () => {
    await saveProviderKey("dummy-test-key");
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });
    await act(async () => {
      calls[0]?.reject(
        new RoutingError(
          "no-route-found",
          "No cycling route could be found between these waypoints.",
        ),
      );
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).toContain(
        "Your key and connection to OpenRouteService are working",
      );
    });
    const verification = await getProviderKeyVerification();
    expect(verification).toMatchObject({ outcome: "verified" });
  });

  it("records a verified outcome when a waypoint is too far from a routable road", async () => {
    await saveProviderKey("dummy-test-key");
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });
    await act(async () => {
      calls[0]?.reject(
        new RoutingError(
          "no-routable-point",
          "A waypoint is too far from a usable road for cycling.",
        ),
      );
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).toContain(
        "too far from a usable road for cycling",
      );
    });
    const verification = await getProviderKeyVerification();
    expect(verification).toMatchObject({ outcome: "verified" });
  });

  it("does not change the persisted verification outcome for an ambiguous provider-error", async () => {
    await saveProviderKey("dummy-test-key");
    const { adapter, calls } = buildQueuedAdapter();
    const { result } = renderHook(() =>
      usePlanningRoute({
        waypoints: WAYPOINTS,
        profile: "cycling-road",
        avoidFerries: false,
        adapter,
      }),
    );

    act(() => {
      result.current.calculateNow();
    });
    await act(async () => {
      calls[0]?.reject(
        new RoutingError(
          "provider-error",
          "The routing provider returned an unexpected error (status 500).",
        ),
      );
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).not.toBeNull();
    });
    const verification = await getProviderKeyVerification();
    expect(verification).toBeUndefined();
  });
});
