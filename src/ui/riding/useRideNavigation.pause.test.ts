import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRideNavigation } from "./useRideNavigation.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { buildRoutePointsFromWaypoints } from "../../test/fixtures/routeGeometry.ts";
import type { PlannedRoute } from "../../domain/types.ts";
import { db } from "../../storage/db.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";
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

const FOLLOWING_CAMERA_STATE: StoredCameraState = {
  mode: "following",
  coordinate: null,
  zoom: 17,
  bearingDegrees: 42,
  pitchDegrees: 35,
};

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRideNavigation pause()", () => {
  it("writes a complete resumable snapshot, including a synchronously-read camera state, then stops the watch", async () => {
    const fake = buildFakeGeolocationSource();
    let cameraState = FOLLOWING_CAMERA_STATE;
    const { result } = renderHook(() =>
      useRideNavigation(route, {
        geolocationSource: fake.source,
        getCameraState: () => cameraState,
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

    // A camera-only change, with no accompanying fix — the ordinary
    // persistence effect's own getCameraState identity is stable, so this
    // change alone would never be persisted by it; pause() must read it
    // fresh regardless.
    cameraState = { ...FOLLOWING_CAMERA_STATE, zoom: 19 };

    await act(async () => {
      await result.current.pause();
    });

    expect(fake.watches[0]?.disposed).toBe(true);
    expect(result.current.geolocationStatus).toBe("idle");
    // Pause preserves progress/preferences — unlike finish().
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(result.current.wakeLockDesired).toBe(true);

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
    expect(stored?.lastFix?.coordinate).toEqual(SAMPLE_FIX.coordinate);
    if (stored && "cameraZoom" in stored) {
      expect(stored.cameraZoom).toBe(19);
      expect(stored.cameraMode).toBe("following");
    } else {
      throw new Error("expected a route ride-state row");
    }
  });

  it("the stored row remains present and resumable after a successful pause", async () => {
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

    await act(async () => {
      await result.current.pause();
    });

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
    if (stored && "routeId" in stored) {
      expect(stored.routeId).toBe(route.id);
    } else {
      throw new Error("expected a route ride-state row");
    }
  });

  it("a pause before the first GPS fix creates a valid resumable row with a null fix", async () => {
    const fake = buildFakeGeolocationSource();
    const { result } = renderHook(() =>
      useRideNavigation(route, { geolocationSource: fake.source }),
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
    if (stored && "routeId" in stored) {
      expect(stored.routeId).toBe(route.id);
      expect(stored.lastFix).toBeNull();
      expect(typeof stored.startedAt).toBe("string");
    } else {
      throw new Error("expected a route ride-state row");
    }
  });

  it("preserves elevation view, wake-lock preference, dismissed climb and completion-armed state", async () => {
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
    act(() => {
      result.current.setElevationViewMode({ kind: "upcoming", windowMetres: 10000 });
      result.current.setWakeLockDesired(true);
      result.current.setDismissedClimbFeatureId("climb-1");
      result.current.setCompletionArmed(true);
    });

    await act(async () => {
      await result.current.pause();
    });

    expect(result.current.elevationViewMode).toEqual({
      kind: "upcoming",
      windowMetres: 10000,
    });
    expect(result.current.wakeLockDesired).toBe(true);
    expect(result.current.dismissedClimbFeatureId).toBe("climb-1");
    expect(result.current.completionArmed).toBe(true);

    const stored = await getActiveRideState();
    if (stored && "dismissedClimbFeatureId" in stored) {
      expect(stored.dismissedClimbFeatureId).toBe("climb-1");
      expect(stored.completionArmed).toBe(true);
    } else {
      throw new Error("expected a route ride-state row");
    }
  });

  it("a storage rejection leaves the watch and session fully live and permits a retry", async () => {
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

    const setSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(
      act(async () => {
        await result.current.pause();
      }),
    ).rejects.toThrow("boom");

    // Nothing changed: the watch and in-memory session are still fully live.
    expect(result.current.geolocationStatus).toBe("watching");
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(fake.watches[0]?.disposed).toBe(false);

    setSpy.mockRestore();

    // Retry succeeds.
    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.geolocationStatus).toBe("idle");
    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("duplicate concurrent pause() calls cannot double-write or double-stop", async () => {
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

    const setSpy = vi.spyOn(rideStateRepository, "setActiveRideState");

    await act(async () => {
      await Promise.all([result.current.pause(), result.current.pause()]);
    });

    // The second, redundant pause() call must have been rejected by the
    // synchronous isPausingRef guard before ever reaching storage — only
    // the first call's own write should have happened.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(result.current.geolocationStatus).toBe("idle");
    setSpy.mockRestore();
  });

  it("late callbacks from the stopped generation are ignored", async () => {
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

    await act(async () => {
      await result.current.pause();
    });

    // The stopped watch's own callback fires late — must be ignored.
    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });
    expect(result.current.currentFix).toEqual(SAMPLE_FIX);
    expect(result.current.geolocationStatus).toBe("idle");
  });

  it("never calls clearActiveRideState or applies finish()'s reset behaviour", async () => {
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
      await result.current.pause();
    });

    expect(clearSpy).not.toHaveBeenCalled();
    expect(result.current.currentFix).not.toBeNull();
    expect(result.current.elevationViewMode).not.toBeUndefined();
    expect(result.current.elevationViewMode).toEqual(DEFAULT_ELEVATION_VIEW_MODE);
    clearSpy.mockRestore();
  });

  it("a fix arriving during the pause write is not persisted, but does not throw", async () => {
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

    // A plain object, not a bare `let`, works around a TypeScript 6.0.3
    // closure-narrowing defect where a `let` reassigned only inside an
    // async callback and read outside it narrows to `never` (see
    // CLAUDE.md's own documented precedent for this exact pattern).
    const pending: { resolveWrite: (() => void) | null } = { resolveWrite: null };
    const setSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            pending.resolveWrite = resolve;
          }),
      );

    let pausePromise: Promise<void> = Promise.resolve();
    act(() => {
      pausePromise = result.current.pause();
    });

    // The watch is still nominally live while pause()'s own write is
    // pending — a genuine fix is still accepted into in-memory state.
    act(() => {
      fake.watches[0]?.emitFix(LATER_FIX);
    });
    expect(result.current.currentFix).toEqual(LATER_FIX);

    pending.resolveWrite?.();
    await act(async () => {
      await pausePromise;
    });

    expect(result.current.geolocationStatus).toBe("idle");
    setSpy.mockRestore();
  });

  // pause() reads isFinalizingRef, so it is blocked while finish() is
  // already in flight — this direction is a genuine, provable guarantee.
  // The reverse is not symmetric (see isPausingRef's own declaration
  // comment for the react-hooks/immutability constraint that forces this
  // asymmetry): finish() does not check isPausingRef, so calling finish()
  // while pause() is already in flight is not blocked at the hook level —
  // RidingScreen's own bidirectional isFinalizeActionPendingRef/
  // isPauseActionPendingRef cross-guard is what actually prevents this
  // ordering from ever reaching the hook in practice. Both directions are
  // covered below, proving the real guarantee and documenting the known,
  // accepted gap rather than leaving it silently unverified.
  it("pause() is blocked while finish() is already in flight", async () => {
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

    await act(async () => {
      // finish() is called first — its synchronous guard-set runs before
      // pause() is ever invoked.
      await Promise.all([result.current.finish(), result.current.pause()]);
    });

    // finish() alone applied: storage cleared, every field reset.
    expect(await getActiveRideState()).toBeUndefined();
    expect(result.current.currentFix).toBeNull();
    expect(result.current.geolocationStatus).toBe("idle");
  });

  it("a finish() called while pause() is already in flight is not blocked at the hook level (known, accepted asymmetry)", async () => {
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

    await act(async () => {
      // pause() is called first, but does not block finish() from
      // starting — both transitions run to completion. finish()'s own
      // reset always applies last here (its clearActiveRideState() call
      // is issued after pause()'s own write), so the final state matches
      // a plain finish().
      await Promise.all([result.current.pause(), result.current.finish()]);
    });

    expect(result.current.geolocationStatus).toBe("idle");
    expect(result.current.currentFix).toBeNull();
    expect(await getActiveRideState()).toBeUndefined();
  });
});
