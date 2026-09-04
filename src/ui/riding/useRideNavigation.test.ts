import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRideNavigation } from "./useRideNavigation.ts";
import { browserGeolocationSource } from "../../platform/geolocation.ts";
import type {
  GeolocationError,
  GeolocationFix,
  GeolocationSource,
} from "../../platform/geolocation.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { buildRoutePointsFromWaypoints } from "../../test/fixtures/routeGeometry.ts";
import {
  OUT_AND_BACK_COINCIDENT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX,
  OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_SHORT_TURNAROUND_INDEX,
} from "../../test/fixtures/outAndBackCoincidentRoute.ts";
import type { PlannedRoute, RoutePoint } from "../../domain/types.ts";
import { db, type StoredRideState } from "../../storage/db.ts";
import {
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import { DEFAULT_ELEVATION_VIEW_MODE } from "../../navigation/upcomingElevation.ts";
import { OFF_ROUTE_BASE_METRES } from "../../navigation/offRoute.ts";
import { getRecentErrors } from "../../platform/errorLog.ts";

const routePoints = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
);

const route: PlannedRoute = {
  id: "route-1",
  name: "Evening loop",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: routePoints,
  manoeuvres: [],
  distanceMetres: routePoints.at(-1)?.distanceFromStartMetres ?? 0,
  ascentMetres: 2,
  descentMetres: 0,
  warnings: [],
  source: { kind: "gpx-import" },
};

// A distinct route carrying real per-point elevation (routePoints above
// always has elevationMetres: null) — a clean, steady 5% climb along the
// route's own distance, so remaining ascent decreases predictably as
// progress advances without depending on precise smoothing numerics.
const elevatedRoutePoints: RoutePoint[] = routePoints.map((point) => ({
  ...point,
  elevationMetres: point.distanceFromStartMetres * 0.05,
}));

const elevatedRoute: PlannedRoute = {
  ...route,
  id: "route-elevated-1",
  points: elevatedRoutePoints,
};

const onRoutePointA = routePoints[5];
const onRoutePointB = routePoints[15];
if (!onRoutePointA || !onRoutePointB) {
  throw new Error("fixture missing point");
}

// Mirrors rideNavigationCore.test.ts's own off-route fixture exactly: far
// enough (in latitude) to be raw-classified off-route from the very first
// fix, which is what freezes lastReliableMatch immediately rather than
// only once the debounced warning escalates.
const FAR_COORDINATE: [number, number] = [
  0.005,
  51 + OFF_ROUTE_BASE_METRES / 111_000 + 0.001,
];

function fixAt(
  coordinate: readonly [number, number],
  timestampMs: number,
): GeolocationFix {
  return {
    coordinate,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function expectNumber(value: number | null): number {
  expect(value).not.toBeNull();
  if (value === null) {
    throw new Error("expected a non-null number");
  }
  return value;
}

const SAMPLE_FIX: GeolocationFix = {
  coordinate: [0, 51],
  accuracyMetres: 8,
  timestampMs: 1000,
  speedMetresPerSecond: null,
  headingDegrees: null,
};

const LATER_FIX: GeolocationFix = {
  coordinate: [0.005, 51],
  accuracyMetres: 6,
  timestampMs: 2000,
  speedMetresPerSecond: null,
  headingDegrees: null,
};

const PERMISSION_DENIED_ERROR: GeolocationError = {
  reason: "permission-denied",
  message: "Location permission was denied.",
};

const TIMEOUT_ERROR: GeolocationError = {
  reason: "timeout",
  message: "Getting your location timed out.",
};

const POSITION_UNAVAILABLE_ERROR: GeolocationError = {
  reason: "position-unavailable",
  message: "Your location is currently unavailable.",
};

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRideNavigation geolocation watch lifecycle", () => {
  it("never calls watchPosition before start() is called", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    expect(fake.watchPositionSpy).not.toHaveBeenCalled();
    expect(result.current.geolocationStatus).toBe("idle");
  });

  it("start() creates exactly one watch and enters watching", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });

    expect(fake.watchPositionSpy).toHaveBeenCalledOnce();
    expect(result.current.geolocationStatus).toBe("watching");
  });

  it("the first fix is fresh and clears any prior error", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });

    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(result.current.isStale).toBe(false);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.geolocationError).toBeNull();
  });

  it("an error enters the explicit error state and marks a retained fix stale", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    act(() => {
      fake.watches[0]?.emitError(PERMISSION_DENIED_ERROR);
    });

    expect(result.current.geolocationStatus).toBe("error");
    expect(result.current.geolocationError).toEqual(PERMISSION_DENIED_ERROR);
    expect(result.current.isStale).toBe(true);
    // The retained fix must be preserved, not discarded, on error.
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
  });

  it("Try again after an error disposes the old watch and creates a new one", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitError(PERMISSION_DENIED_ERROR);
    });
    act(() => {
      result.current.start();
    });

    expect(fake.watchPositionSpy).toHaveBeenCalledTimes(2);
    expect(fake.watches[0]?.disposed).toBe(true);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.geolocationError).toBeNull();
  });

  it("repeated Try again while already watching does not create a second watch", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
      result.current.start();
    });

    expect(fake.watchPositionSpy).toHaveBeenCalledOnce();
  });

  it("a callback from an obsolete (pre-retry) watch is ignored", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitError(PERMISSION_DENIED_ERROR);
    });
    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });

    // The stray fix from the disposed original watch must not resurrect state.
    expect(result.current.currentFix).toBeNull();
    expect(result.current.geolocationStatus).toBe("watching");
  });

  it("a callback from the current replacement watch succeeds", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitError(PERMISSION_DENIED_ERROR);
    });
    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[1]?.emitFix(SAMPLE_FIX);
    });

    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.geolocationError).toBeNull();
  });

  it("a current watch that errors then later succeeds recovers without a retry tap", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitError(PERMISSION_DENIED_ERROR);
    });
    expect(result.current.geolocationStatus).toBe("error");

    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });

    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.geolocationError).toBeNull();
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    // No retry call was ever made — this is the still-live original watch.
    expect(fake.watchPositionSpy).toHaveBeenCalledOnce();
  });

  it.each([
    ["permission-denied", PERMISSION_DENIED_ERROR],
    ["timeout", TIMEOUT_ERROR],
    ["position-unavailable", POSITION_UNAVAILABLE_ERROR],
  ] as const)("retries reliably after a %s error", (_label, error) => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitError(error);
    });
    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[1]?.emitFix(SAMPLE_FIX);
    });

    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.geolocationError).toBeNull();
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
  });

  it("an unsupported browser reports the unsupported reason, and start() after geolocation becomes available succeeds", () => {
    vi.stubGlobal("navigator", {});
    const { result, unmount } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: browserGeolocationSource }),
    );

    act(() => {
      result.current.start();
    });

    expect(result.current.geolocationStatus).toBe("error");
    expect(result.current.geolocationError?.reason).toBe("unsupported");

    let successCallback: ((position: GeolocationPosition) => void) | undefined;
    const watchPosition = vi.fn((success: (position: GeolocationPosition) => void) => {
      successCallback = success;
      return 1;
    });
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch: vi.fn() } });

    act(() => {
      result.current.start();
    });
    act(() => {
      successCallback?.({
        coords: { longitude: 0, latitude: 51, accuracy: 5, speed: null, heading: null },
        timestamp: 1000,
      } as GeolocationPosition);
    });

    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.currentFix?.coordinate).toEqual([0, 51]);
    // Unmount deterministically here, while the working stub is still in
    // place — vi.unstubAllGlobals() in this file's afterEach would
    // otherwise race against @testing-library/react's own unmount-on-
    // cleanup, leaving navigator.geolocation undefined when the effect's
    // cleanup runs.
    unmount();
  });

  it("handles onError firing synchronously before watchPosition returns its cleanup", () => {
    const fake = buildFakeGeolocationSource();
    fake.armSyncEmissionForNextWatch({ kind: "error", error: PERMISSION_DENIED_ERROR });
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });

    expect(result.current.geolocationStatus).toBe("error");
    expect(result.current.geolocationError).toEqual(PERMISSION_DENIED_ERROR);
    // The generation-bound cleanup returned from that same synchronous
    // watchPosition() call must still have been stored as current (the
    // chosen policy keeps an erroring watch alive) — proven by a
    // same-tick retry correctly disposing exactly this watch.
    act(() => {
      result.current.start();
    });
    expect(fake.watches[0]?.disposed).toBe(true);
    expect(fake.watchPositionSpy).toHaveBeenCalledTimes(2);
  });

  it("handles onFix firing synchronously before watchPosition returns its cleanup", () => {
    const fake = buildFakeGeolocationSource();
    fake.armSyncEmissionForNextWatch({ kind: "fix", fix: SAMPLE_FIX });
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });

    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
  });

  it("a start() call triggered reentrantly from inside watchPosition is a safe no-op", () => {
    // Defensive proof for the synchronous-callback race: even if something
    // called start() again before the outer watchPosition() call has
    // returned its own cleanup, the already-synchronous setStatus("watching")
    // means the reentrant call's own guard rejects it immediately — only
    // one watch is ever created, and its cleanup is the one actually
    // stored as current.
    let reentrantStartCallCount = 0;
    const outerCleanup = vi.fn();
    let hookStart: (() => void) | null = null;
    const source: GeolocationSource = {
      watchPosition: () => {
        reentrantStartCallCount += 1;
        if (reentrantStartCallCount === 1) {
          hookStart?.();
        }
        return outerCleanup;
      },
    };
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: source }),
    );
    hookStart = result.current.start;

    act(() => {
      result.current.start();
    });

    expect(reentrantStartCallCount).toBe(1);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(outerCleanup).not.toHaveBeenCalled();
  });

  it("unmount disposes the current watch exactly once while watching", () => {
    const fake = buildFakeGeolocationSource();
    const { result, unmount } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    unmount();

    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("unmount disposes the current watch exactly once while in an error state", () => {
    const fake = buildFakeGeolocationSource();
    const { result, unmount } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitError(PERMISSION_DENIED_ERROR);
    });
    unmount();

    // The chosen policy leaves the watch alive through an error; unmount
    // must still dispose it exactly once.
    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("visibility restart disposes the old watch and leaves exactly one active", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fake.watchPositionSpy).toHaveBeenCalledTimes(2);
    expect(fake.watches[0]?.disposed).toBe(true);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.isStale).toBe(true);
  });

  it("pageshow restart disposes the old watch and leaves exactly one active", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });

    expect(fake.watchPositionSpy).toHaveBeenCalledTimes(2);
    expect(fake.watches[0]?.disposed).toBe(true);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.isStale).toBe(true);
  });

  it("visibilitychange while idle does not request a watch", () => {
    const fake = buildFakeGeolocationSource();
    renderHook(() => useRideNavigation(route, { geolocationSource: fake.source }));

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fake.watchPositionSpy).not.toHaveBeenCalled();
  });

  it("a stale callback from the pre-restart watch is ignored after a visibility-triggered restart", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });

    // The pre-restart watch's fix must not overwrite the current position.
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);

    act(() => {
      fake.watches[1]?.emitFix(LATER_FIX);
    });
    expect(result.current.currentFix).toEqual(LATER_FIX);
  });
});

describe("useRideNavigation finish()", () => {
  it("clears persisted state, resets every field to fresh-ride defaults, and disposes the watch", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(await getActiveRideState()).toBeDefined();

    await act(async () => {
      await result.current.finish();
    });

    expect(await getActiveRideState()).toBeUndefined();
    expect(result.current.currentFix).toBeNull();
    expect(result.current.geolocationStatus).toBe("idle");
    expect(result.current.isStale).toBe(false);
    expect(result.current.geolocationError).toBeNull();
    expect(result.current.matchedDistanceFromStartMetres).toBeNull();
    expect(result.current.presentationDistanceFromStartMetres).toBeNull();
    expect(result.current.elevationViewMode).toEqual(DEFAULT_ELEVATION_VIEW_MODE);
    expect(result.current.wakeLockDesired).toBe(false);
    expect(result.current.dismissedClimbFeatureId).toBeNull();
    expect(result.current.restoredCameraState).toBeNull();
    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("a storage-clear failure leaves the ride completely untouched and re-arms persistence", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(
      act(async () => {
        await result.current.finish();
      }),
    ).rejects.toThrow("boom");

    // Nothing else changed: the ride is still fully active/resumable.
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(fake.watches[0]?.disposed).toBe(false);
    expect(await getActiveRideState()).toBeDefined();

    clearSpy.mockRestore();

    // The ref must have been re-armed: an ordinary fix persists normally.
    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const stored = await getActiveRideState();
    expect(stored?.lastFix?.coordinate).toEqual(LATER_FIX.coordinate);
  });

  it("a redundant concurrent call is a silent no-op", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");

    await act(async () => {
      await Promise.all([result.current.finish(), result.current.finish()]);
    });

    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });

  it("a fix arriving while the clear is still pending cannot recreate the row afterwards", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(await getActiveRideState()).toBeDefined();

    let finishPromise: Promise<void> = Promise.resolve();
    act(() => {
      finishPromise = result.current.finish();
    });

    // The clear's own IndexedDB transaction is still pending here — the
    // watch has not been stopped yet, so a genuine fix is still accepted
    // into in-memory state (proving handleFix isn't blocked)...
    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });
    expect(result.current.currentFix).toEqual(LATER_FIX);

    await act(async () => {
      await finishPromise;
    });

    // ...but the persistence effect must never have written it, so the
    // row stays cleared once finish() actually resolves.
    expect(await getActiveRideState()).toBeUndefined();
    expect(result.current.currentFix).toBeNull();
  });
});

describe("useRideNavigation restoration lifecycle (backlog item 72)", () => {
  const RESUMABLE_ROW: StoredRideState = {
    id: "active",
    routeId: route.id,
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
  };

  it("transitions loading -> ready with restoredForThisRoute true on a genuine match", async () => {
    await setActiveRideState(RESUMABLE_ROW);
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    expect(result.current.restorationStatus).toBe("loading");

    await waitFor(() => {
      expect(result.current.restorationStatus).toBe("ready");
    });
    expect(result.current.restoredForThisRoute).toBe(true);
    expect(result.current.currentFix).not.toBeNull();
    // Restoration never touches geolocationStatus itself — it stays idle
    // until an explicit start(), regardless of what was restored.
    expect(result.current.geolocationStatus).toBe("idle");
  });

  it("reaches ready with restoredForThisRoute false when no row exists at all, leaving fields at fresh defaults", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    await waitFor(() => {
      expect(result.current.restorationStatus).toBe("ready");
    });
    expect(result.current.restoredForThisRoute).toBe(false);
    expect(result.current.currentFix).toBeNull();
  });

  it("reaches ready with restoredForThisRoute false for a row belonging to a different route, leaving fields at fresh defaults", async () => {
    await setActiveRideState({ ...RESUMABLE_ROW, routeId: elevatedRoute.id });
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    await waitFor(() => {
      expect(result.current.restorationStatus).toBe("ready");
    });
    expect(result.current.restoredForThisRoute).toBe(false);
    expect(result.current.currentFix).toBeNull();
  });

  it("a rejected read sets restorationStatus to error and logs, leaving every restorable field at its untouched default", async () => {
    vi.spyOn(rideStateRepository, "getActiveRideState").mockRejectedValueOnce(
      new Error("boom"),
    );
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    await waitFor(() => {
      expect(result.current.restorationStatus).toBe("error");
    });
    expect(result.current.restoredForThisRoute).toBe(false);
    expect(result.current.currentFix).toBeNull();
    expect(
      getRecentErrors().some((entry) => entry.context === "ride-navigation-restore"),
    ).toBe(true);
  });

  it("retryRestoration re-invokes the read and can transition error -> ready", async () => {
    const getActiveRideStateSpy = vi
      .spyOn(rideStateRepository, "getActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    await waitFor(() => {
      expect(result.current.restorationStatus).toBe("error");
    });
    expect(getActiveRideStateSpy).toHaveBeenCalledOnce();

    act(() => {
      result.current.retryRestoration();
    });
    expect(result.current.restorationStatus).toBe("loading");

    await waitFor(() => {
      expect(result.current.restorationStatus).toBe("ready");
    });
    expect(getActiveRideStateSpy).toHaveBeenCalledTimes(2);
    // Nothing was ever persisted for this route, so the retry correctly
    // settles into "nothing to restore", not a stale earlier attempt.
    expect(result.current.restoredForThisRoute).toBe(false);
  });

  it("a cancelled-by-unmount restoration applies no state after unmount, without throwing or warning", async () => {
    let resolveRead!: (value: StoredRideState | undefined) => void;
    const deferred = new Promise<StoredRideState | undefined>((resolve) => {
      resolveRead = resolve;
    });
    vi.spyOn(rideStateRepository, "getActiveRideState").mockReturnValueOnce(deferred);

    const fake = buildFakeGeolocationSource();
    const { result, unmount } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
    );

    expect(result.current.restorationStatus).toBe("loading");
    unmount();

    // Resolving after unmount must not throw — the effect's own `cancelled`
    // guard silently no-ops every setter it would otherwise call.
    resolveRead(RESUMABLE_ROW);
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe("useRideNavigation remaining distance/ascent", () => {
  it("are null before any fix, and non-null together once an on-route fix lands", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(elevatedRoute, { geolocationSource: fake.source }),
    );

    expect(result.current.distanceRemainingMetres).toBeNull();
    expect(result.current.remainingAscentMetres).toBeNull();

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(fixAt(onRoutePointA.coordinate, 1000));
    });

    expect(result.current.distanceRemainingMetres).not.toBeNull();
    expect(result.current.remainingAscentMetres).not.toBeNull();
  });

  it("decrease together as reliable progress advances", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(elevatedRoute, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(fixAt(onRoutePointA.coordinate, 1000));
    });
    const distanceAtA = result.current.distanceRemainingMetres;
    const ascentAtA = result.current.remainingAscentMetres;

    act(() => {
      fake.watches[0]?.emitFix(fixAt(onRoutePointB.coordinate, 2000));
    });

    expect(expectNumber(result.current.distanceRemainingMetres)).toBeLessThan(
      expectNumber(distanceAtA),
    );
    expect(expectNumber(result.current.remainingAscentMetres)).toBeLessThan(
      expectNumber(ascentAtA),
    );
  });

  it("stay frozen while strongly off-route, even as the raw match keeps moving", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(elevatedRoute, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(fixAt(onRoutePointA.coordinate, 1000));
    });
    const matchedBeforeOffRoute = result.current.matchedDistanceFromStartMetres;
    const frozenDistance = result.current.distanceRemainingMetres;
    const frozenAscent = result.current.remainingAscentMetres;

    act(() => {
      fake.watches[0]?.emitFix(fixAt(FAR_COORDINATE, 2000));
    });

    expect(result.current.matchedDistanceFromStartMetres).not.toBe(matchedBeforeOffRoute);
    expect(result.current.distanceRemainingMetres).toBe(frozenDistance);
    expect(result.current.remainingAscentMetres).toBe(frozenAscent);
  });

  it("release together once reliable matching resumes, advancing to a new position", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(elevatedRoute, { geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(fixAt(onRoutePointA.coordinate, 1000));
    });
    const frozenDistance = result.current.distanceRemainingMetres;
    const frozenAscent = result.current.remainingAscentMetres;

    act(() => {
      fake.watches[0]?.emitFix(fixAt(FAR_COORDINATE, 2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(fixAt(onRoutePointB.coordinate, 3000));
    });

    expect(expectNumber(result.current.distanceRemainingMetres)).toBeLessThan(
      expectNumber(frozenDistance),
    );
    expect(expectNumber(result.current.remainingAscentMetres)).toBeLessThan(
      expectNumber(frozenAscent),
    );
  });
});

describe("useRideNavigation resume near an exactly coincident out-and-back turnaround (backlog item 104)", () => {
  const coincidentRoute: PlannedRoute = {
    ...route,
    id: "coincident-out-and-back-1",
    points: OUT_AND_BACK_COINCIDENT_ROUTE_POINTS,
    distanceMetres:
      OUT_AND_BACK_COINCIDENT_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0,
  };
  const turnaroundPoint =
    OUT_AND_BACK_COINCIDENT_ROUTE_POINTS[OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX];
  if (!turnaroundPoint) throw new Error("fixture missing turnaround point");

  it("advances remaining distance on the return leg after a resume seeded exactly at the turnaround, never regressing to the outbound occurrence", async () => {
    await setActiveRideState({
      id: "active",
      routeId: coincidentRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: {
        coordinate: turnaroundPoint.coordinate,
        accuracyMetres: 6,
        timestampMs: 1000,
      },
      lastMatchedPointIndex: OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX,
      matchedDistanceFromStartMetres: turnaroundPoint.distanceFromStartMetres,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      lastReliableMatchedPointIndex: OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX,
      lastReliableMatchedDistanceFromStartMetres: turnaroundPoint.distanceFromStartMetres,
    });

    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(coincidentRoute, { geolocationSource: fake.source }),
    );

    await waitFor(() => {
      expect(result.current.restorationStatus).toBe("ready");
    });
    expect(result.current.restoredForThisRoute).toBe(true);
    const remainingAtTurnaround = expectNumber(result.current.distanceRemainingMetres);

    act(() => {
      result.current.start();
    });
    // A fix ~20 m onto the return leg — exactly coincident, in reverse,
    // with the point 20 m before the turnaround on the outbound leg. A
    // matcher that regressed to that outbound occurrence would show
    // remaining distance INCREASE here instead.
    const returnLegPoint =
      OUT_AND_BACK_COINCIDENT_ROUTE_POINTS[OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX + 1];
    if (!returnLegPoint) throw new Error("fixture missing return-leg point");
    act(() => {
      fake.watches[0]?.emitFix(fixAt(returnLegPoint.coordinate, 2000));
    });

    expect(expectNumber(result.current.distanceRemainingMetres)).toBeLessThan(
      remainingAtTurnaround,
    );
  });
});

describe("useRideNavigation resume mid-hold at walking pace (backlog item 104 follow-up)", () => {
  const shortRoute: PlannedRoute = {
    ...route,
    id: "short-coincident-out-and-back-1",
    points: OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS,
    distanceMetres:
      OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0,
  };
  const turnaroundPoint =
    OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS[
      OUT_AND_BACK_COINCIDENT_SHORT_TURNAROUND_INDEX
    ];
  if (!turnaroundPoint) throw new Error("fixture missing short turnaround point");
  const turnaroundDistanceMetres = turnaroundPoint.distanceFromStartMetres;

  /** The short fixture has only eight points, so return-leg fixes have to
   * be interpolated rather than taken from the point array. */
  function coordinateAtDistance(targetMetres: number): readonly [number, number] {
    const points = OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (!a || !b) continue;
      if (
        targetMetres >= a.distanceFromStartMetres &&
        targetMetres <= b.distanceFromStartMetres
      ) {
        const span = b.distanceFromStartMetres - a.distanceFromStartMetres;
        const fraction =
          span === 0 ? 0 : (targetMetres - a.distanceFromStartMetres) / span;
        return [
          a.coordinate[0] + fraction * (b.coordinate[0] - a.coordinate[0]),
          a.coordinate[1] + fraction * (b.coordinate[1] - a.coordinate[1]),
        ];
      }
    }
    throw new Error("distance outside short fixture range");
  }

  it("resumes from the stable match a hold had already persisted, then advances on the return leg without a single backwards step", async () => {
    // Exactly the row a pause taken DURING a hold writes: the held anchor
    // is what lastMatch/lastReliableMatch already are, so nothing new has
    // to be persisted for a resume to behave correctly — this test exists
    // to prove that, since it is the reason the follow-up adds no storage
    // field of its own.
    await setActiveRideState({
      id: "active",
      routeId: shortRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: {
        coordinate: coordinateAtDistance(turnaroundDistanceMetres + 3),
        accuracyMetres: 14,
        timestampMs: 1000,
      },
      lastMatchedPointIndex: OUT_AND_BACK_COINCIDENT_SHORT_TURNAROUND_INDEX,
      matchedDistanceFromStartMetres: turnaroundDistanceMetres,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      lastReliableMatchedPointIndex: OUT_AND_BACK_COINCIDENT_SHORT_TURNAROUND_INDEX,
      lastReliableMatchedDistanceFromStartMetres: turnaroundDistanceMetres,
    });

    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(shortRoute, { geolocationSource: fake.source }),
    );

    await waitFor(() => {
      expect(result.current.restorationStatus).toBe("ready");
    });
    expect(result.current.restoredForThisRoute).toBe(true);
    expect(expectNumber(result.current.matchedDistanceFromStartMetres)).toBeCloseTo(
      turnaroundDistanceMetres,
      6,
    );

    act(() => {
      result.current.start();
    });

    // Walking pace along the exactly retraced return leg: every step is
    // smaller than PROGRESS_EPSILON_METRES.
    let previousRemaining = expectNumber(result.current.distanceRemainingMetres);
    const remainingAtResume = previousRemaining;
    for (let beyondTurn = 1.4, tick = 0; beyondTurn <= 28; beyondTurn += 1.4, tick += 1) {
      const coordinate = coordinateAtDistance(turnaroundDistanceMetres + beyondTurn);
      act(() => {
        fake.watches[0]?.emitFix(fixAt(coordinate, 2000 + tick * 1000));
      });
      const remaining = expectNumber(result.current.distanceRemainingMetres);
      expect(remaining).toBeLessThanOrEqual(previousRemaining + 1e-6);
      previousRemaining = remaining;
    }

    expect(previousRemaining).toBeLessThan(remainingAtResume - 20);
  });
});
