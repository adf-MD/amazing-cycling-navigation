import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFreeRoamCamera } from "./useFreeRoamCamera.ts";
import { NAVIGATION_ZOOM } from "./rideCamera.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";

const FRESH_FIX: GeolocationFix = {
  coordinate: [0, 51],
  accuracyMetres: 8,
  timestampMs: 1000,
  speedMetresPerSecond: 5,
  headingDegrees: 90,
};

const STALE_FIX: GeolocationFix = {
  coordinate: [0.01, 51],
  accuracyMetres: 10,
  timestampMs: 500,
  speedMetresPerSecond: null,
  headingDegrees: null,
};

describe("useFreeRoamCamera", () => {
  it("issues no camera target and starts in overview mode before anything happens", () => {
    const { result } = renderHook(() =>
      useFreeRoamCamera({
        currentFix: null,
        isStale: false,
        restoredCameraState: null,
        restoredLastReliableBearingDegrees: null,
      }),
    );

    expect(result.current.mode).toBe("overview");
    expect(result.current.cameraTarget).toBeNull();
  });

  it("requestFollow with a fresh fix produces a following command using the fix's own heading", () => {
    const { result, rerender } = renderHook(
      (props: { currentFix: GeolocationFix | null; isStale: boolean }) =>
        useFreeRoamCamera({
          ...props,
          restoredCameraState: null,
          restoredLastReliableBearingDegrees: null,
        }),
      { initialProps: { currentFix: FRESH_FIX, isStale: false } },
    );

    act(() => {
      result.current.requestFollow();
    });

    expect(result.current.mode).toBe("following");
    expect(result.current.cameraTarget).toMatchObject({
      coordinate: FRESH_FIX.coordinate,
      zoom: NAVIGATION_ZOOM,
      bearingDegrees: 90,
      animate: true,
      followOffset: true,
    });

    rerender({ currentFix: FRESH_FIX, isStale: false });
  });

  it("requestFollow with no fix yet enters following/awaitingFreshFix with no command", () => {
    const { result } = renderHook(() =>
      useFreeRoamCamera({
        currentFix: null,
        isStale: false,
        restoredCameraState: null,
        restoredLastReliableBearingDegrees: null,
      }),
    );

    act(() => {
      result.current.requestFollow();
    });

    expect(result.current.mode).toBe("following");
    expect(result.current.awaitingFreshFix).toBe(true);
    expect(result.current.cameraTarget).toBeNull();
  });

  it("a manual interaction pauses following, and Follow resumes it", () => {
    const { result } = renderHook(() =>
      useFreeRoamCamera({
        currentFix: FRESH_FIX,
        isStale: false,
        restoredCameraState: null,
        restoredLastReliableBearingDegrees: null,
      }),
    );

    act(() => {
      result.current.requestFollow();
    });
    expect(result.current.mode).toBe("following");

    act(() => {
      result.current.reportUserInteraction();
    });
    expect(result.current.mode).toBe("free");
    expect(result.current.showPausedToast).toBe(true);

    act(() => {
      result.current.requestFollow();
    });
    expect(result.current.mode).toBe("following");
  });

  it("requestNorthUp resets orientation and reports isNorthUpTopDown once genuinely settled", () => {
    const { result } = renderHook(() =>
      useFreeRoamCamera({
        currentFix: FRESH_FIX,
        isStale: false,
        restoredCameraState: null,
        restoredLastReliableBearingDegrees: null,
      }),
    );

    act(() => {
      result.current.requestNorthUp();
    });
    expect(result.current.mode).toBe("free");
    expect(result.current.cameraTarget).toMatchObject({
      coordinate: null,
      bearingDegrees: 0,
      pitchDegrees: 0,
    });

    act(() => {
      result.current.reportCameraSettled([0, 51], 14, 0, 0);
    });
    expect(result.current.isNorthUpTopDown).toBe(true);
  });

  it("persistableLastReliableBearingDegrees is populated even while mode is following (unlike persistableCameraState)", () => {
    const { result } = renderHook(() =>
      useFreeRoamCamera({
        currentFix: FRESH_FIX,
        isStale: false,
        restoredCameraState: null,
        restoredLastReliableBearingDegrees: null,
      }),
    );

    act(() => {
      result.current.requestFollow();
    });

    expect(result.current.mode).toBe("following");
    expect(result.current.persistableLastReliableBearingDegrees).toBe(90);
    // persistableCameraState only ever carries a real bearing while free —
    // the key documented behavioural difference from useRideCamera.ts.
    expect(result.current.persistableCameraState.bearingDegrees).toBe(0);
  });

  it("resetCamera returns to overview with no camera target", () => {
    const { result } = renderHook(() =>
      useFreeRoamCamera({
        currentFix: FRESH_FIX,
        isStale: false,
        restoredCameraState: null,
        restoredLastReliableBearingDegrees: null,
      }),
    );

    act(() => {
      result.current.requestFollow();
    });
    expect(result.current.mode).toBe("following");

    act(() => {
      result.current.resetCamera();
    });
    expect(result.current.mode).toBe("overview");
    expect(result.current.cameraTarget).toBeNull();
  });

  describe("initial framing (world-view-flash avoidance on a resumed following session)", () => {
    // A stable reference across rerenders — production's own
    // restoredCameraState is a useState value that only changes when a
    // genuinely new restore result resolves, and the hook's own restore
    // effect specifically dedupes against object identity
    // (lastRestoredRef), so a fresh literal on every render would
    // re-dispatch "restore" on every rerender and misrepresent the real
    // behaviour being tested here.
    const RESTORED_FOLLOWING: StoredCameraState = {
      mode: "following",
      coordinate: null,
      zoom: null,
      bearingDegrees: 0,
      pitchDegrees: 0,
    };

    function renderResumingIntoFollowing(
      restoredLastReliableBearingDegrees: number | null,
    ) {
      return renderHook(
        (props: { currentFix: GeolocationFix | null; isStale: boolean }) =>
          useFreeRoamCamera({
            ...props,
            restoredCameraState: RESTORED_FOLLOWING,
            restoredLastReliableBearingDegrees,
          }),
        { initialProps: { currentFix: STALE_FIX, isStale: true } },
      );
    }

    it("frames the restored stale fix with the restored bearing while awaiting the first fresh fix", () => {
      const { result } = renderResumingIntoFollowing(123);

      expect(result.current.mode).toBe("following");
      expect(result.current.cameraTarget).toEqual({
        coordinate: STALE_FIX.coordinate,
        zoom: NAVIGATION_ZOOM,
        bearingDegrees: 123,
        pitchDegrees: 0,
        animate: false,
        followOffset: false,
      });
    });

    it("falls back to north-up (bearing 0) when no last-reliable bearing was ever restored", () => {
      const { result } = renderResumingIntoFollowing(null);

      expect(result.current.cameraTarget).toMatchObject({ bearingDegrees: 0 });
    });

    it("cancellation path 1: a real fresh-fix command supersedes the synthetic framing", () => {
      const { result, rerender } = renderResumingIntoFollowing(123);
      expect(result.current.cameraTarget).toMatchObject({ animate: false });

      rerender({ currentFix: FRESH_FIX, isStale: false });

      expect(result.current.cameraTarget).toMatchObject({
        coordinate: FRESH_FIX.coordinate,
        animate: true,
        followOffset: true,
      });
    });

    it("cancellation path 2: isStale flipping false (even with the same coordinate) clears the synthetic framing", () => {
      const { result, rerender } = renderResumingIntoFollowing(123);
      expect(result.current.cameraTarget).toMatchObject({ animate: false });

      // Same coordinate object, now reported fresh — the real "fresh-fix"
      // dispatch fires (lastDispatchedFixRef was never set, since the
      // initial stale render skipped it) and produces a real, animated
      // following command, superseding the synthetic one.
      rerender({ currentFix: STALE_FIX, isStale: false });

      expect(result.current.cameraTarget).toMatchObject({
        coordinate: STALE_FIX.coordinate,
        animate: true,
        followOffset: true,
      });
    });

    it("cancellation path 3: a manual interaction leaving following mode clears the synthetic framing", () => {
      const { result } = renderResumingIntoFollowing(123);
      expect(result.current.cameraTarget).not.toBeNull();

      act(() => {
        result.current.reportUserInteraction();
      });

      expect(result.current.mode).toBe("free");
      expect(result.current.cameraTarget).toBeNull();
    });
  });

  it("round-trips a restored free camera position via persistableCameraState", () => {
    const restoredFree: StoredCameraState = {
      mode: "free",
      coordinate: [-1.2, 53.4],
      zoom: 13.5,
      bearingDegrees: 128,
      pitchDegrees: 22,
    };
    const { result } = renderHook(() =>
      useFreeRoamCamera({
        currentFix: null,
        isStale: false,
        restoredCameraState: restoredFree,
        restoredLastReliableBearingDegrees: null,
      }),
    );

    expect(result.current.mode).toBe("free");
    expect(result.current.cameraTarget).toMatchObject({
      coordinate: restoredFree.coordinate,
      zoom: restoredFree.zoom,
      bearingDegrees: restoredFree.bearingDegrees,
      pitchDegrees: restoredFree.pitchDegrees,
      animate: false,
    });
  });

  describe("an 'overview' restore never undoes an explicit requestFollow()", () => {
    const OVERVIEW: StoredCameraState = {
      mode: "overview",
      coordinate: null,
      zoom: null,
      bearingDegrees: 0,
      pitchDegrees: 0,
    };

    it("requestFollow() called before the restore resolves stays in effect once the overview restore lands", () => {
      // Reproduces a real, previously-shipped race found while writing
      // freeRoam.spec.ts: RidingLauncher's "Start free roam" always
      // persists an initial row with cameraMode "overview" before
      // FreeRoamScreen ever mounts, and FreeRoamScreen's own mount effect
      // calls requestFollow() synchronously in the same tick that
      // restoredCameraState is still null. Because the storage read
      // restoredCameraState depends on resolves asynchronously, it always
      // arrives *after* the synchronous requestFollow() dispatch — an
      // unconditional "restore" dispatch here would silently reset mode
      // back to "overview" every time, undoing the follow request.
      const initialProps: { restoredCameraState: StoredCameraState | null } = {
        restoredCameraState: null,
      };
      const { result, rerender } = renderHook(
        (props: { restoredCameraState: StoredCameraState | null }) =>
          useFreeRoamCamera({
            currentFix: null,
            isStale: false,
            restoredLastReliableBearingDegrees: null,
            ...props,
          }),
        { initialProps },
      );

      act(() => {
        result.current.requestFollow();
      });
      expect(result.current.mode).toBe("following");

      // The async restore now "arrives" — simulating the mount-time
      // storage read resolving after requestFollow() already ran.
      rerender({ restoredCameraState: OVERVIEW });

      expect(result.current.mode).toBe("following");
    });

    it("a genuinely restored 'following'/'free' mode still applies normally (only 'overview' is skipped)", () => {
      const restoredFollowing: StoredCameraState = {
        mode: "following",
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
      };
      const { result } = renderHook(() =>
        useFreeRoamCamera({
          currentFix: null,
          isStale: false,
          restoredCameraState: restoredFollowing,
          restoredLastReliableBearingDegrees: null,
        }),
      );

      expect(result.current.mode).toBe("following");
      expect(result.current.awaitingFreshFix).toBe(true);
    });
  });
});
