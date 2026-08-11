import { act, renderHook } from "@testing-library/react";
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
import type { PlannedRoute } from "../../domain/types.ts";
import { db } from "../../storage/db.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import { DEFAULT_ELEVATION_VIEW_MODE } from "../../navigation/upcomingElevation.ts";

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
