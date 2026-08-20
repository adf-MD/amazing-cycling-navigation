import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRideCamera, type UseRideCameraOptions } from "./useRideCamera.ts";
import { FOLLOW_PITCH_DEGREES, NAVIGATION_ZOOM } from "./rideCamera.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";

const FRESH_FIX: GeolocationFix = {
  coordinate: [0, 51],
  accuracyMetres: 8,
  timestampMs: 1000,
  speedMetresPerSecond: 5,
  headingDegrees: 90,
};

const BASE_OPTIONS: UseRideCameraOptions = {
  routeId: "route-1",
  routePoints: [],
  currentFix: null,
  isStale: false,
  matchedDistanceFromStartMetres: null,
  offRouteLevel: "on-route",
  restoredCameraState: null,
};

describe("useRideCamera", () => {
  it("issues no camera target and starts in overview mode before anything happens", () => {
    const { result } = renderHook(() => useRideCamera(BASE_OPTIONS));

    expect(result.current.mode).toBe("overview");
    expect(result.current.cameraTarget).toBeNull();
    expect(result.current.hasActionableCameraTarget).toBe(false);
  });

  it("requestFollow with a fresh fix produces a following command using the fix's own heading", () => {
    const { result } = renderHook(() =>
      useRideCamera({ ...BASE_OPTIONS, currentFix: FRESH_FIX, isStale: false }),
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
    expect(result.current.hasActionableCameraTarget).toBe(true);
  });

  it("a manual interaction pauses following, and Follow resumes it", () => {
    const { result } = renderHook(() =>
      useRideCamera({ ...BASE_OPTIONS, currentFix: FRESH_FIX, isStale: false }),
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

  it("resetCamera returns to overview with no camera target", () => {
    const { result } = renderHook(() =>
      useRideCamera({ ...BASE_OPTIONS, currentFix: FRESH_FIX, isStale: false }),
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

  describe("zoom controls (backlog item 53)", () => {
    it("requestZoom(1) and requestZoom(-1) each produce a distinct zoomTarget requestId", () => {
      const { result } = renderHook(() => useRideCamera(BASE_OPTIONS));

      expect(result.current.zoomTarget).toBeNull();

      act(() => {
        result.current.requestZoom(1);
      });
      const first = result.current.zoomTarget;
      expect(first).toMatchObject({ delta: 1 });
      expect(first?.requestId).toBeTruthy();

      act(() => {
        result.current.requestZoom(1);
      });
      const second = result.current.zoomTarget;
      expect(second).toMatchObject({ delta: 1 });
      expect(second?.requestId).toBeTruthy();
      expect(second?.requestId).not.toBe(first?.requestId);

      act(() => {
        result.current.requestZoom(-1);
      });
      expect(result.current.zoomTarget).toMatchObject({ delta: -1 });
    });

    // Backlog item 65: a zoom press while genuinely following (an
    // actionable fix already applied) re-anchors cameraTarget to the
    // same coordinate/bearing/pitch at the new zoom, through
    // cameraTarget/setCamera — never the ordinary unanchored
    // zoomTarget/changeZoomBy path, so the two can never both fire for
    // the same press.
    it("calling requestZoom while genuinely following re-anchors cameraTarget to the same coordinate/bearing at the new zoom, keeps Follow engaged, and never touches zoomTarget", () => {
      const { result } = renderHook(() =>
        useRideCamera({ ...BASE_OPTIONS, currentFix: FRESH_FIX, isStale: false }),
      );

      act(() => {
        result.current.requestFollow();
      });
      const cameraTargetBeforeZoom = result.current.cameraTarget;
      expect(cameraTargetBeforeZoom).toMatchObject({
        coordinate: FRESH_FIX.coordinate,
        zoom: NAVIGATION_ZOOM,
        bearingDegrees: 90,
        pitchDegrees: FOLLOW_PITCH_DEGREES,
        followOffset: true,
      });
      expect(result.current.zoomTarget).toBeNull();

      act(() => {
        result.current.requestZoom(1);
      });

      expect(result.current.mode).toBe("following");
      expect(result.current.showPausedToast).toBe(false);
      // cameraTarget updates (not preserved by reference) — the anchor
      // coordinate/bearing/pitch/followOffset stay exactly the same,
      // only zoom changes.
      expect(result.current.cameraTarget).not.toBe(cameraTargetBeforeZoom);
      expect(result.current.cameraTarget).toMatchObject({
        coordinate: FRESH_FIX.coordinate,
        zoom: NAVIGATION_ZOOM + 1,
        bearingDegrees: 90,
        pitchDegrees: FOLLOW_PITCH_DEGREES,
        animate: true,
        followOffset: true,
      });
      expect(result.current.cameraTarget?.requestId).toBeTruthy();
      // Proves only ONE camera operation fires per press: the unanchored
      // fallback (zoomTarget) never also fires for the same press.
      expect(result.current.zoomTarget).toBeNull();
    });

    it("two consecutive anchored zoom presses each produce a distinct requestId and both apply, accumulating zoom", () => {
      const { result } = renderHook(() =>
        useRideCamera({ ...BASE_OPTIONS, currentFix: FRESH_FIX, isStale: false }),
      );

      act(() => {
        result.current.requestFollow();
      });

      act(() => {
        result.current.requestZoom(1);
      });
      const first = result.current.cameraTarget;
      expect(first).toMatchObject({ zoom: NAVIGATION_ZOOM + 1 });

      act(() => {
        result.current.requestZoom(1);
      });
      const second = result.current.cameraTarget;
      expect(second).toMatchObject({ zoom: NAVIGATION_ZOOM + 2 });
      expect(second?.requestId).toBeTruthy();
      expect(second?.requestId).not.toBe(first?.requestId);
    });

    it("requestZoom while following but still awaiting the first fresh fix falls back to the ordinary unanchored zoomTarget path, never fabricating a cameraTarget", () => {
      const { result } = renderHook(() => useRideCamera(BASE_OPTIONS));

      act(() => {
        result.current.requestFollow();
      });
      expect(result.current.mode).toBe("following");
      expect(result.current.awaitingFreshFix).toBe(true);
      expect(result.current.cameraTarget).toBeNull();

      act(() => {
        result.current.requestZoom(1);
      });

      expect(result.current.cameraTarget).toBeNull();
      expect(result.current.zoomTarget).toMatchObject({ delta: 1 });
    });

    it("requestZoom while free (after a manual gesture) uses the ordinary unanchored zoomTarget path, cameraTarget unaffected", () => {
      const { result } = renderHook(() =>
        useRideCamera({ ...BASE_OPTIONS, currentFix: FRESH_FIX, isStale: false }),
      );

      act(() => {
        result.current.requestFollow();
      });
      act(() => {
        result.current.reportUserInteraction();
      });
      expect(result.current.mode).toBe("free");
      const cameraTargetBeforeZoom = result.current.cameraTarget;

      act(() => {
        result.current.requestZoom(1);
      });

      expect(result.current.mode).toBe("free");
      expect(result.current.cameraTarget).toBe(cameraTargetBeforeZoom);
      expect(result.current.zoomTarget).toMatchObject({ delta: 1 });
    });

    it("after requestZoom, a subsequent fresh fix produces a following command whose zoom reflects the change", () => {
      const { result, rerender } = renderHook(
        (props: UseRideCameraOptions) => useRideCamera(props),
        {
          initialProps: { ...BASE_OPTIONS, currentFix: FRESH_FIX, isStale: false },
        },
      );

      act(() => {
        result.current.requestFollow();
      });
      expect(result.current.cameraTarget).toMatchObject({ zoom: NAVIGATION_ZOOM });

      act(() => {
        result.current.requestZoom(1);
      });

      const MOVED_FIX: GeolocationFix = {
        ...FRESH_FIX,
        coordinate: [0, 51.0002],
        timestampMs: 2000,
      };
      rerender({ ...BASE_OPTIONS, currentFix: MOVED_FIX, isStale: false });

      expect(result.current.cameraTarget).toMatchObject({
        coordinate: MOVED_FIX.coordinate,
        zoom: NAVIGATION_ZOOM + 1,
      });
    });

    it("reportCameraSettled while following reconciles persistableCameraState.zoom to the settled value", () => {
      const { result } = renderHook(() =>
        useRideCamera({ ...BASE_OPTIONS, currentFix: FRESH_FIX, isStale: false }),
      );

      act(() => {
        result.current.requestFollow();
      });
      act(() => {
        result.current.requestZoom(1);
      });
      // Simulate MapLibre settling at a slightly different real zoom (e.g.
      // due to its own min/max clamping) than the optimistic accumulator.
      act(() => {
        result.current.reportCameraSettled(FRESH_FIX.coordinate, 16.9, 90, 35);
      });

      expect(result.current.persistableCameraState).toMatchObject({
        mode: "following",
        zoom: 16.9,
      });
    });

    it("restoring a following session with a persisted zoom uses it for the very first produced command", () => {
      const restored: StoredCameraState = {
        mode: "following",
        coordinate: null,
        zoom: 18.5,
        bearingDegrees: 0,
        pitchDegrees: 0,
      };
      const initialProps: UseRideCameraOptions = {
        ...BASE_OPTIONS,
        restoredCameraState: null,
      };
      const { result, rerender } = renderHook(
        (props: UseRideCameraOptions) => useRideCamera(props),
        { initialProps },
      );

      rerender({ ...BASE_OPTIONS, restoredCameraState: restored });
      expect(result.current.mode).toBe("following");
      expect(result.current.awaitingFreshFix).toBe(true);

      rerender({
        ...BASE_OPTIONS,
        restoredCameraState: restored,
        currentFix: FRESH_FIX,
        isStale: false,
      });

      expect(result.current.cameraTarget).toMatchObject({
        coordinate: FRESH_FIX.coordinate,
        zoom: 18.5,
      });
    });

    it("restoring a following session with no persisted zoom falls back to NAVIGATION_ZOOM", () => {
      const restored: StoredCameraState = {
        mode: "following",
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
      };
      const initialProps: UseRideCameraOptions = {
        ...BASE_OPTIONS,
        restoredCameraState: null,
      };
      const { result, rerender } = renderHook(
        (props: UseRideCameraOptions) => useRideCamera(props),
        { initialProps },
      );

      rerender({ ...BASE_OPTIONS, restoredCameraState: restored });
      rerender({
        ...BASE_OPTIONS,
        restoredCameraState: restored,
        currentFix: FRESH_FIX,
        isStale: false,
      });

      expect(result.current.cameraTarget).toMatchObject({ zoom: NAVIGATION_ZOOM });
    });
  });
});
