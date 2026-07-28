import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePlanningRoute, type PlanningRouteState } from "./usePlanningRoute.ts";
import { RoutingError } from "../../routing/openRouteServiceErrors.ts";
import type { RoutingOptions, RoutingProvider } from "../../routing/provider.ts";
import { cumulativeDistancesMetres } from "../../navigation/distance.ts";
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

// distanceFromStartMetres/distanceMetres are derived from the same
// cumulativeDistancesMetres primitive stitchPlannedRouteLegs.ts uses, so a
// single-leg calculation's stitched output is a true no-op against this
// fixture's own declared values (see the "always stitch, even for one
// leg" design decision) — a hand-typed round number here would drift
// against the real haversine spacing between these coordinates.
function buildRoute(id = "route-1"): PlannedRoute {
  const coordinates: Coordinate[] = Array.from({ length: 10 }, (_, i) => [i * 0.001, 51]);
  const distances = cumulativeDistancesMetres(coordinates);
  return {
    id,
    name: "Test route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: coordinates.map((coordinate, i) => ({
      coordinate,
      elevationMetres: null,
      distanceFromStartMetres: distances[i] ?? 0,
    })),
    manoeuvres: [],
    distanceMetres: distances.at(-1) ?? 0,
    // No point in this fixture carries elevation, so a real recompute
    // reports null (no data), never 0 (a real, flat route) — see
    // analyzeElevation's hasAnyElevation guard.
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

/** A geometrically-consistent leg fixture, starting and ending exactly at
 * the given coordinates — unlike buildRoute() (a fixed, self-contained
 * geometry only valid alone), multi-leg tests need consecutive legs whose
 * seams actually line up, or stitchPlannedRouteLegs.ts correctly rejects
 * the join as too large a gap. */
function buildLegRoute(start: Coordinate, end: Coordinate, id: string): PlannedRoute {
  const coordinates: Coordinate[] = [start, end];
  const distances = cumulativeDistancesMetres(coordinates);
  return {
    id,
    name: "Leg",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: coordinates.map((coordinate, i) => ({
      coordinate,
      elevationMetres: null,
      distanceFromStartMetres: distances[i] ?? 0,
    })),
    manoeuvres: [],
    distanceMetres: distances.at(-1) ?? 0,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

/** Asserts a routed state matches an expected leg/route, field-by-field —
 * never whole-object toEqual — since stitchPlannedRouteLegs.ts always
 * mints a fresh id/createdAt (and the fixed "Planned route" name) for the
 * combined route rather than leaking a leg's own incidental identity. */
function expectRoutedStateMatching(
  state: PlanningRouteState,
  expected: { route: PlannedRoute; waypoints: readonly Waypoint[] },
): void {
  expect(state.kind).toBe("routed");
  if (state.kind !== "routed") return;
  expect(state.waypoints).toEqual(expected.waypoints);
  expect(state.route.points).toEqual(expected.route.points);
  expect(state.route.manoeuvres).toEqual(expected.route.manoeuvres);
  expect(state.route.distanceMetres).toBeCloseTo(expected.route.distanceMetres, 6);
  expect(state.route.ascentMetres).toEqual(expected.route.ascentMetres);
  expect(state.route.descentMetres).toEqual(expected.route.descentMetres);
  expect(state.route.warnings).toEqual(expected.route.warnings);
  expect(state.route.source).toEqual(expected.route.source);
  expect(state.route.name).toBe("Planned route");
  expect(typeof state.route.id).toBe("string");
  expect(state.route.id.length).toBeGreaterThan(0);
  expect(typeof state.route.createdAt).toBe("string");
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
      expectRoutedStateMatching(result.current.state, { route, waypoints: WAYPOINTS });
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
      expectRoutedStateMatching(result.current.state, { route, waypoints: WAYPOINTS });
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
      calls[1]?.reject(
        new RoutingError({ reason: "transport-failure", message: "boom" }),
      );
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).not.toBeNull();
    });
    expectRoutedStateMatching(result.current.state, {
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
      calls[0]?.reject(
        new RoutingError({ reason: "unauthorized", message: "The key was rejected." }),
      );
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
      calls[0]?.reject(new RoutingError({ reason: "no-api-key", message: "no key" }));
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
        new RoutingError({
          reason: "no-route-found",
          message: "No cycling route could be found between these waypoints.",
        }),
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
        new RoutingError({
          reason: "no-routable-point",
          message: "A waypoint is too far from a usable road for cycling.",
        }),
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
        new RoutingError({
          reason: "provider-error",
          message: "The routing provider returned an unexpected error (status 500).",
        }),
      );
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).not.toBeNull();
    });
    const verification = await getProviderKeyVerification();
    expect(verification).toBeUndefined();
  });

  it("records an unavailable outcome (never rejected/quota-limited/verified) when the provider itself is down", async () => {
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
        new RoutingError({
          reason: "provider-unavailable",
          message: "OpenRouteService returned a server error.",
          httpStatus: 502,
        }),
      );
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).toContain(
        "OpenRouteService is temporarily unavailable (HTTP 502)",
      );
    });
    expect(result.current.lastErrorMessage).toContain("waypoints have been retained");
    const verification = await getProviderKeyVerification();
    expect(verification).toMatchObject({ outcome: "unavailable" });
  });

  it("shows a cautious, non-blaming message for a transport failure", async () => {
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
        new RoutingError({
          reason: "transport-failure",
          message: "The routing request failed.",
        }),
      );
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).toBe(
        "The routing provider could not be reached. OpenRouteService may be temporarily unavailable, or the browser or network may have blocked the request. Try again later.",
      );
    });
  });

  it("retains the last successful route, unchanged, after a provider-unavailable recalculation failure", async () => {
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

    const editedWaypoints: Waypoint[] = [
      ...WAYPOINTS,
      { id: "c", coordinate: [0.02, 51] },
    ];
    rerender({ waypoints: editedWaypoints });

    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    await act(async () => {
      calls[1]?.reject(
        new RoutingError({
          reason: "provider-unavailable",
          message: "OpenRouteService returned a server error.",
          httpStatus: 503,
        }),
      );
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.lastErrorMessage).not.toBeNull();
    });
    expectRoutedStateMatching(result.current.state, {
      route: firstRoute,
      waypoints: WAYPOINTS,
    });
  });

  describe("per-leg calculation", () => {
    const WAYPOINT_C: Waypoint = { id: "c", coordinate: [0.02, 51] };
    const WAYPOINT_D: Waypoint = { id: "d", coordinate: [0.03, 51] };

    it("requests one leg per waypoint pair, and reuses cached legs across an edit that only touches some legs", async () => {
      const { adapter, calls } = buildQueuedAdapter();
      const { result, rerender } = renderHook(
        (props: { waypoints: readonly Waypoint[] }) =>
          usePlanningRoute({
            waypoints: props.waypoints,
            profile: "cycling-road",
            avoidFerries: false,
            adapter,
          }),
        { initialProps: { waypoints: [WAYPOINT_A, WAYPOINT_B, WAYPOINT_C] } },
      );

      act(() => {
        result.current.calculateNow();
      });
      expect(calls).toHaveLength(2);
      expect(calls[0]?.waypoints).toEqual([WAYPOINT_A.coordinate, WAYPOINT_B.coordinate]);
      expect(calls[1]?.waypoints).toEqual([WAYPOINT_B.coordinate, WAYPOINT_C.coordinate]);

      await act(async () => {
        calls[0]?.resolve(
          buildLegRoute(WAYPOINT_A.coordinate, WAYPOINT_B.coordinate, "leg-ab"),
        );
        calls[1]?.resolve(
          buildLegRoute(WAYPOINT_B.coordinate, WAYPOINT_C.coordinate, "leg-bc"),
        );
        await flushMicrotasks();
      });
      await waitFor(() => {
        expect(result.current.state.kind).toBe("routed");
      });

      // Appending D only requires a new C->D leg — A->B and B->C stay cached.
      rerender({ waypoints: [WAYPOINT_A, WAYPOINT_B, WAYPOINT_C, WAYPOINT_D] });

      await waitFor(() => {
        expect(calls).toHaveLength(3);
      });
      expect(calls[2]?.waypoints).toEqual([WAYPOINT_C.coordinate, WAYPOINT_D.coordinate]);
    });

    it("exposes updatingLegCount while a multi-leg batch is in flight, and clears it once settled", async () => {
      const { adapter, calls } = buildQueuedAdapter();
      const { result } = renderHook(() =>
        usePlanningRoute({
          waypoints: [WAYPOINT_A, WAYPOINT_B, WAYPOINT_C],
          profile: "cycling-road",
          avoidFerries: false,
          adapter,
        }),
      );

      expect(result.current.updatingLegCount).toBeNull();
      act(() => {
        result.current.calculateNow();
      });
      expect(result.current.updatingLegCount).toBe(2);

      await act(async () => {
        calls[0]?.resolve(
          buildLegRoute(WAYPOINT_A.coordinate, WAYPOINT_B.coordinate, "leg-ab"),
        );
        calls[1]?.resolve(
          buildLegRoute(WAYPOINT_B.coordinate, WAYPOINT_C.coordinate, "leg-bc"),
        );
        await flushMicrotasks();
      });

      await waitFor(() => {
        expect(result.current.state.kind).toBe("routed");
      });
      expect(result.current.updatingLegCount).toBeNull();
    });

    it("keeps updatingLegCount null for a single-leg calculation", async () => {
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
      expect(result.current.updatingLegCount).toBeNull();

      await act(async () => {
        calls[0]?.resolve(buildRoute());
        await flushMicrotasks();
      });
      expect(result.current.updatingLegCount).toBeNull();
    });

    it("clears updatingLegCount after a decisive multi-leg failure, without publishing a route", async () => {
      const { adapter, calls } = buildQueuedAdapter();
      const { result } = renderHook(() =>
        usePlanningRoute({
          waypoints: [WAYPOINT_A, WAYPOINT_B, WAYPOINT_C],
          profile: "cycling-road",
          avoidFerries: false,
          adapter,
        }),
      );

      act(() => {
        result.current.calculateNow();
      });
      expect(result.current.updatingLegCount).toBe(2);

      await act(async () => {
        calls[0]?.reject(
          new RoutingError({ reason: "unauthorized", message: "bad key" }),
        );
        await flushMicrotasks();
      });

      await waitFor(() => {
        expect(result.current.lastErrorMessage).not.toBeNull();
      });
      expect(result.current.updatingLegCount).toBeNull();
      expect(result.current.state.kind).not.toBe("routed");
    });
  });
});
