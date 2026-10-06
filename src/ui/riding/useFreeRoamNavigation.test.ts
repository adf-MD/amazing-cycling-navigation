import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFreeRoamNavigation } from "./useFreeRoamNavigation.ts";
import { browserGeolocationSource } from "../../platform/geolocation.ts";
import type {
  GeolocationError,
  GeolocationFix,
  GeolocationSource,
} from "../../platform/geolocation.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { db } from "../../storage/db.ts";
import {
  OWNED_FREE_ROAM_SESSION_ID,
  ownedFreeRoamRow,
  seedOwnedFreeRoamSession,
} from "../../test/freeRoamSession.ts";
import {
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import { isStoredFreeRoamRideState } from "../../storage/mapping.ts";

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

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
  // App stores the owned session before the screen mounts (item 140).
  await seedOwnedFreeRoamSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFreeRoamNavigation geolocation watch lifecycle", () => {
  it("never calls watchPosition before start() is called", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );

    expect(fake.watchPositionSpy).not.toHaveBeenCalled();
    expect(result.current.geolocationStatus).toBe("idle");
  });

  it("start() creates exactly one watch and enters watching", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
  });

  it("Try again after an error disposes the old watch and creates a new one", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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

    expect(result.current.currentFix).toBeNull();
    expect(result.current.geolocationStatus).toBe("watching");
  });

  it("an unsupported browser reports the unsupported reason, and start() after geolocation becomes available succeeds", () => {
    vi.stubGlobal("navigator", {});
    const { result, unmount } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: browserGeolocationSource,
      }),
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
    unmount();
  });

  it("a start() call triggered reentrantly from inside watchPosition is a safe no-op", () => {
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
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: source,
      }),
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
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );

    act(() => {
      result.current.start();
    });
    unmount();

    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("visibility restart disposes the old watch and leaves exactly one active", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
    renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fake.watchPositionSpy).not.toHaveBeenCalled();
  });

  it("a stale callback from the pre-restart watch is ignored after a visibility-triggered restart", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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

    expect(result.current.currentFix).toEqual(SAMPLE_FIX);

    act(() => {
      fake.watches[1]?.emitFix(LATER_FIX);
    });
    expect(result.current.currentFix).toEqual(LATER_FIX);
  });
});

describe("useFreeRoamNavigation restore", () => {
  it("restores nothing from App's fresh row, which stores no fix or camera", () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );

    expect(result.current.currentFix).toBeNull();
    expect(result.current.restoredCameraState).toBeNull();
    expect(result.current.restoredLastReliableBearingDegrees).toBeNull();
  });

  it("restores a genuine free-roam row's fix (marked stale), camera state and bearing", async () => {
    await setActiveRideState({
      id: "active",
      kind: "free-roam",
      startedAt: "2026-01-01T00:00:00.000Z",
      sessionId: OWNED_FREE_ROAM_SESSION_ID,
      lastFix: { coordinate: [0, 51], accuracyMetres: 8, timestampMs: 1000 },
      cameraMode: "following",
      lastReliableBearingDegrees: 88,
      wakeLockDesired: true,
    });

    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.currentFix?.coordinate).toEqual([0, 51]);
    expect(result.current.isStale).toBe(true);
    expect(result.current.restoredCameraState?.mode).toBe("following");
    expect(result.current.restoredLastReliableBearingDegrees).toBe(88);
    expect(result.current.wakeLockDesired).toBe(true);
  });

  it("a route-kind row in storage is never restored into this hook", async () => {
    await db.routes.put({
      id: "route-1",
      name: "Evening loop",
      createdAt: "2026-01-01T00:00:00.000Z",
      points: [],
      manoeuvres: [],
      distanceMetres: 0,
      ascentMetres: 0,
      descentMetres: 0,
      warnings: [],
      source: { kind: "gpx-import" },
    });
    await setActiveRideState({
      id: "active",
      routeId: "route-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastFix: { coordinate: [0, 51], accuracyMetres: 8, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });

    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.currentFix).toBeNull();
    expect(result.current.restoredCameraState).toBeNull();
    // A route session stored in place of App's own: the owned session is
    // gone (backlog item 140).
    expect(result.current.sessionGone).toBe(true);
  });
});

describe("useFreeRoamNavigation persistence", () => {
  it("persists a free-roam-kind row on every accepted fix", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
    expect(stored && isStoredFreeRoamRideState(stored)).toBe(true);
    expect(stored?.lastFix?.coordinate).toEqual(SAMPLE_FIX.coordinate);
  });

  it("uses getPersistableSnapshot's camera state and bearing at write time", async () => {
    const fake = buildFakeGeolocationSource();
    const getPersistableSnapshot = vi.fn(() => ({
      cameraState: {
        mode: "following" as const,
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
      },
      lastReliableBearingDegrees: 77,
    }));
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
        getPersistableSnapshot,
      }),
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

    const stored = await getActiveRideState();
    expect(stored?.cameraMode).toBe("following");
    expect(
      stored && isStoredFreeRoamRideState(stored)
        ? stored.lastReliableBearingDegrees
        : null,
    ).toBe(77);
  });
});

describe("useFreeRoamNavigation finish()", () => {
  it("clears persisted state, resets every field to fresh-session defaults, and disposes the watch", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
      await result.current.finish(OWNED_FREE_ROAM_SESSION_ID);
    });

    expect(await getActiveRideState()).toBeUndefined();
    expect(result.current.currentFix).toBeNull();
    expect(result.current.geolocationStatus).toBe("idle");
    expect(result.current.isStale).toBe(false);
    expect(result.current.geolocationError).toBeNull();
    expect(result.current.wakeLockDesired).toBe(false);
    expect(result.current.restoredCameraState).toBeNull();
    expect(result.current.restoredLastReliableBearingDegrees).toBeNull();
    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("a storage-clear failure leaves the session completely untouched and re-arms persistence", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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
      .spyOn(rideStateRepository, "clearActiveRideStateIfSession")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(
      act(async () => {
        await result.current.finish(OWNED_FREE_ROAM_SESSION_ID);
      }),
    ).rejects.toThrow("boom");

    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(fake.watches[0]?.disposed).toBe(false);
    expect(await getActiveRideState()).toBeDefined();

    clearSpy.mockRestore();

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
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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

    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideStateIfSession");

    await act(async () => {
      await Promise.all([
        result.current.finish(OWNED_FREE_ROAM_SESSION_ID),
        result.current.finish(OWNED_FREE_ROAM_SESSION_ID),
      ]);
    });

    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });

  it("a fix arriving while the clear is still pending cannot recreate the row afterwards", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
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

    let finishPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      finishPromise = result.current.finish(OWNED_FREE_ROAM_SESSION_ID);
    });

    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });
    expect(result.current.currentFix).toEqual(LATER_FIX);

    await act(async () => {
      await finishPromise;
    });

    expect(await getActiveRideState()).toBeUndefined();
    expect(result.current.currentFix).toBeNull();
  });
});

describe("useFreeRoamNavigation session identity (backlog item 140)", () => {
  async function flushStorage(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it("an early fix before a delayed restore read writes nothing and is kept; every write afterwards carries App's session", async () => {
    const appRow = await getActiveRideState();
    const realRead = rideStateRepository.getActiveRideState;
    let releaseRead: (() => void) | undefined;
    vi.spyOn(rideStateRepository, "getActiveRideState").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRead = () => {
            resolve(realRead());
          };
        }),
    );
    const writeSpy = vi.spyOn(rideStateRepository, "setActiveRideState");
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    await flushStorage();

    expect(writeSpy).not.toHaveBeenCalled();
    await expect(getActiveRideState()).resolves.toEqual(appRow);

    await act(async () => {
      releaseRead?.();
      await Promise.resolve();
    });
    // The fresh fix is not replaced by the row's stored one (none).
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });
    await waitFor(async () => {
      expect((await getActiveRideState())?.lastFix?.timestampMs).toBe(
        LATER_FIX.timestampMs,
      );
    });

    expect(writeSpy).toHaveBeenCalled();
    for (const [written] of writeSpy.mock.calls) {
      expect(written).toMatchObject({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        startedAt: appRow?.startedAt,
      });
    }
  });

  it("after a failed restore read writes nothing and Pause fails, yet End ride still clears only App's session", async () => {
    const appRow = await getActiveRideState();
    vi.spyOn(rideStateRepository, "getActiveRideState").mockRejectedValueOnce(
      new Error("synthetic restore failure"),
    );
    const writeSpy = vi.spyOn(rideStateRepository, "setActiveRideState");
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );

    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    await flushStorage();
    let pauseError: unknown = null;
    await act(async () => {
      try {
        await result.current.pause();
      } catch (error) {
        pauseError = error;
      }
    });

    expect(pauseError).toBeInstanceOf(Error);
    expect(result.current.geolocationStatus).toBe("watching");
    expect(writeSpy).not.toHaveBeenCalled();
    await expect(getActiveRideState()).resolves.toEqual(appRow);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.finish(OWNED_FREE_ROAM_SESSION_ID);
    });
    expect(outcome).toBe("ended");
    await expect(getActiveRideState()).resolves.toBeUndefined();
  });

  for (const [label, replace] of [
    ["missing", () => db.rideState.clear()],
    [
      "replaced by another free roam",
      () =>
        setActiveRideState(ownedFreeRoamRow({ sessionId: "free-roam-session-newer" })),
    ],
  ] as const) {
    it(`a missing owned session is gone at restore — ${label}: no write on a later fix, the watch stops and it is reported`, async () => {
      await replace();
      const before = await getActiveRideState();
      const writeSpy = vi.spyOn(rideStateRepository, "setActiveRideState");
      const fake = buildFakeGeolocationSource();
      const { result } = renderHook(() =>
        useFreeRoamNavigation({
          sessionId: OWNED_FREE_ROAM_SESSION_ID,
          geolocationSource: fake.source,
        }),
      );

      act(() => {
        result.current.start();
      });
      await waitFor(() => {
        expect(result.current.sessionGone).toBe(true);
      });
      expect(fake.watches[0]?.disposed).toBe(true);
      expect(result.current.geolocationStatus).toBe("idle");
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });
      act(() => {
        result.current.start();
      });
      await flushStorage();

      expect(fake.watches).toHaveLength(1);
      expect(writeSpy).not.toHaveBeenCalled();
      await expect(getActiveRideState()).resolves.toEqual(before);
    });
  }

  for (const [label, replace] of [
    ["missing", () => db.rideState.clear()],
    [
      "replaced by a newer free roam",
      () =>
        setActiveRideState(ownedFreeRoamRow({ sessionId: "free-roam-session-newer" })),
    ],
  ] as const) {
    it(`End ride for a session ${label} elsewhere deletes nothing, stops the watch and retires the hook: no later fix or Pause writes`, async () => {
      const fake = buildFakeGeolocationSource();
      const { result } = renderHook(() =>
        useFreeRoamNavigation({
          sessionId: OWNED_FREE_ROAM_SESSION_ID,
          geolocationSource: fake.source,
        }),
      );
      act(() => {
        result.current.start();
      });
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });
      await waitFor(async () => {
        expect((await getActiveRideState())?.lastFix?.timestampMs).toBe(
          SAMPLE_FIX.timestampMs,
        );
      });
      await replace();
      const newer = await getActiveRideState();
      const writeSpy = vi.spyOn(rideStateRepository, "setActiveRideState");

      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.finish(OWNED_FREE_ROAM_SESSION_ID);
      });

      expect(outcome).toBe("session-gone");
      expect(fake.watches[0]?.disposed).toBe(true);
      act(() => {
        fake.watches[0]?.emitFix(LATER_FIX);
      });
      await act(async () => {
        await result.current.pause();
      });
      await flushStorage();
      expect(writeSpy).not.toHaveBeenCalled();
      await expect(getActiveRideState()).resolves.toEqual(newer);
    });
  }

  it("a write held before its transaction when End begins is cancelled: refused End, then the released write leaves the newer session unchanged", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        sessionId: OWNED_FREE_ROAM_SESSION_ID,
        geolocationSource: fake.source,
      }),
    );
    act(() => {
      result.current.start();
    });
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    await waitFor(async () => {
      expect((await getActiveRideState())?.lastFix?.timestampMs).toBe(
        SAMPLE_FIX.timestampMs,
      );
    });

    // Hold the next write before its transaction exists, as the e2e
    // write-delay seam does.
    let releaseWrite: (() => void) | undefined;
    window.__acnE2eRideStateWriteDelay = () =>
      new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });
    await waitFor(() => {
      expect(releaseWrite).toBeDefined();
    });
    delete window.__acnE2eRideStateWriteDelay;

    // Another window replaces the session; this one's End is refused.
    const newer = ownedFreeRoamRow({ sessionId: "free-roam-session-newer" });
    await db.rideState.put(newer);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.finish(OWNED_FREE_ROAM_SESSION_ID);
    });
    expect(outcome).toBe("session-gone");

    await act(async () => {
      releaseWrite?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await expect(getActiveRideState()).resolves.toEqual(newer);
  });
});
