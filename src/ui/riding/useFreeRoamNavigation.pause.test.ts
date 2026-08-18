import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFreeRoamNavigation } from "./useFreeRoamNavigation.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { db } from "../../storage/db.ts";
import {
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import {
  isStoredFreeRoamRideState,
  toStoredFreeRoamState,
} from "../../storage/mapping.ts";

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

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFreeRoamNavigation pause()", () => {
  it("writes a complete resumable snapshot, including a synchronously-read camera+bearing state, then stops the watch", async () => {
    const fake = buildFakeGeolocationSource();
    let snapshot = {
      cameraState: {
        mode: "following" as const,
        coordinate: null,
        zoom: 17,
        bearingDegrees: 90,
        pitchDegrees: 35,
      },
      lastReliableBearingDegrees: 90,
    };
    const { result } = renderHook(() =>
      useFreeRoamNavigation({
        geolocationSource: fake.source,
        getPersistableSnapshot: () => snapshot,
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
    act(() => {
      result.current.setWakeLockDesired(true);
    });

    // A camera-only change, with no accompanying fix.
    snapshot = { ...snapshot, cameraState: { ...snapshot.cameraState, zoom: 19 } };

    await act(async () => {
      await result.current.pause();
    });

    expect(fake.watches[0]?.disposed).toBe(true);
    expect(result.current.geolocationStatus).toBe("idle");
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(result.current.wakeLockDesired).toBe(true);

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
    if (stored && isStoredFreeRoamRideState(stored)) {
      expect(stored.cameraZoom).toBe(19);
      expect(stored.cameraBearingDegrees).toBe(90);
      expect(stored.lastReliableBearingDegrees).toBe(90);
    } else {
      throw new Error("expected a free-roam ride-state row");
    }
  });

  it("the stored row remains present and resumable after a successful pause", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
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

    await act(async () => {
      await result.current.pause();
    });

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
    expect(stored && isStoredFreeRoamRideState(stored)).toBe(true);
  });

  it("does not clear the already-existing initial free-roam row, and pauses correctly before the first fresh fix", async () => {
    const fake = buildFakeGeolocationSource();
    // Mirrors RidingLauncher.handleStartFreeRoam's own pre-mount seed.
    await setActiveRideState(
      toStoredFreeRoamState(
        "2026-01-01T00:00:00.000Z",
        null,
        {
          mode: "overview",
          coordinate: null,
          zoom: null,
          bearingDegrees: 0,
          pitchDegrees: 0,
        },
        null,
        false,
      ),
    );

    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
    );

    act(() => {
      result.current.start();
    });
    expect(result.current.currentFix).toBeNull();

    await act(async () => {
      await result.current.pause();
    });

    expect(fake.watches[0]?.disposed).toBe(true);
    expect(result.current.geolocationStatus).toBe("idle");

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
    if (stored && isStoredFreeRoamRideState(stored)) {
      expect(stored.lastFix).toBeNull();
      expect(typeof stored.startedAt).toBe("string");
    } else {
      throw new Error("expected a free-roam ride-state row");
    }
  });

  it("preserves the wake-lock preference", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
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
    act(() => {
      result.current.setWakeLockDesired(true);
    });

    await act(async () => {
      await result.current.pause();
    });

    expect(result.current.wakeLockDesired).toBe(true);
    const stored = await getActiveRideState();
    if (stored && isStoredFreeRoamRideState(stored)) {
      expect(stored.wakeLockDesired).toBe(true);
    } else {
      throw new Error("expected a free-roam ride-state row");
    }
  });

  it("a storage rejection leaves the watch and session fully live and permits a retry", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
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

    const setSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(
      act(async () => {
        await result.current.pause();
      }),
    ).rejects.toThrow("boom");

    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(fake.watches[0]?.disposed).toBe(false);

    setSpy.mockRestore();

    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.geolocationStatus).toBe("idle");
    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("duplicate concurrent pause() calls cannot double-write or double-stop", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
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

    const setSpy = vi.spyOn(rideStateRepository, "setActiveRideState");

    await act(async () => {
      await Promise.all([result.current.pause(), result.current.pause()]);
    });

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(result.current.geolocationStatus).toBe("idle");
    setSpy.mockRestore();
  });

  it("late callbacks from the stopped generation are ignored", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
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

    await act(async () => {
      await result.current.pause();
    });

    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(result.current.geolocationStatus).toBe("idle");
  });

  it("never calls clearActiveRideState", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
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
      await result.current.pause();
    });

    expect(clearSpy).not.toHaveBeenCalled();
    expect(result.current.currentFix).not.toBeNull();
    clearSpy.mockRestore();
  });

  // Mirrors useRideNavigation.pause.test.ts's identical pair exactly — see
  // that file's own comment for the full react-hooks/immutability-driven
  // asymmetry rationale (pause() blocks against an in-flight finish(), but
  // not vice versa at the hook level; RidingScreen/FreeRoamScreen's own
  // bidirectional screen-level cross-guard is the real enforcement).
  it("pause() is blocked while finish() is already in flight", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
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

    await act(async () => {
      await Promise.all([result.current.finish(), result.current.pause()]);
    });

    expect(await getActiveRideState()).toBeUndefined();
    expect(result.current.currentFix).toBeNull();
    expect(result.current.geolocationStatus).toBe("idle");
  });

  it("a finish() called while pause() is already in flight is not blocked at the hook level (known, accepted asymmetry)", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useFreeRoamNavigation({ geolocationSource: fake.source }),
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

    await act(async () => {
      await Promise.all([result.current.pause(), result.current.finish()]);
    });

    expect(result.current.geolocationStatus).toBe("idle");
    expect(result.current.currentFix).toBeNull();
    expect(await getActiveRideState()).toBeUndefined();
  });
});
