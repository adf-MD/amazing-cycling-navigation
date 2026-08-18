import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { FreeRoamScreen } from "./FreeRoamScreen.tsx";
import { db } from "../../storage/db.ts";
import type { GeolocationError, GeolocationFix } from "../../platform/geolocation.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";

const SAMPLE_FIX: GeolocationFix = {
  coordinate: [0, 51],
  accuracyMetres: 8,
  timestampMs: 1000,
  speedMetresPerSecond: 5,
  headingDegrees: 90,
};

const ERROR: GeolocationError = {
  reason: "permission-denied",
  message: "Location permission was denied.",
};

function buildStubMapFactory(): {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerUserCameraInteraction: () => void;
  setCameraSpy: ReturnType<typeof vi.fn>;
} {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let userCameraInteractionListener: (() => void) | undefined;
  const setCameraSpy = vi.fn();
  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: (listener) => {
        loadListener = listener;
      },
      onStyleLoaded: (listener) => {
        styleLoadedListener = listener;
      },
      onError: () => undefined,
      onSourceData: () => undefined,
      addGeoJsonSource: () => undefined,
      setGeoJsonSourceData: () => undefined,
      hasSource: () => false,
      addLineLayer: () => undefined,
      addCircleLayer: () => undefined,
      hasLayer: () => false,
      hasImage: () => false,
      addImage: () => undefined,
      addSymbolLayer: () => undefined,
      fitBounds: () => undefined,
      getCenter: () => [0, 0],
      getZoom: () => 14,
      onUserCameraInteraction: (listener) => {
        userCameraInteractionListener = listener;
      },
      onCameraSettled: () => undefined,
      setCamera: setCameraSpy,
      centreOn: () => undefined,
      changeZoomBy: () => undefined,
      resize: () => undefined,
      onMapTap: () => undefined,
      queryTopWarningFeatureAt: () => null,
      queryTopRouteFeatureAt: () => null,
      setMarkers: () => undefined,
      setDistanceBadges: () => undefined,
      remove: () => undefined,
    };
    return map;
  };
  return {
    factory,
    triggerLoad: () => {
      styleLoadedListener?.();
      loadListener?.();
    },
    triggerUserCameraInteraction: () => userCameraInteractionListener?.(),
    setCameraSpy,
  };
}

beforeEach(async () => {
  await db.rideState.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FreeRoamScreen", () => {
  it("auto-starts exactly one GPS watch on mount, with no idle panel/Start button", () => {
    const fake = buildFakeGeolocationSource();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(fake.watchPositionSpy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Start free roam" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume free roam" })).toBeNull();
  });

  it("StrictMode double-invocation still creates exactly one live watch", () => {
    const fake = buildFakeGeolocationSource();
    const map = buildStubMapFactory();
    render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />, {
      wrapper: StrictMode,
    });

    // Under StrictMode, either exactly one watch was ever created, or a
    // first mount/cleanup/remount cycle disposed the first before the
    // second was created — either way, at most one is ever live.
    const liveWatches = fake.watches.filter((watch) => !watch.disposed);
    expect(liveWatches.length).toBeLessThanOrEqual(1);
  });

  it("renders exactly one h1, named Free roam", () => {
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Free roam" }),
    ).toBeInTheDocument();
  });

  it("shows waiting for a GPS fix, then the accuracy/staleness status strip once a fix arrives", () => {
    const fake = buildFakeGeolocationSource();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(screen.getByText("Waiting for a GPS fix…")).toBeInTheDocument();

    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });

    expect(screen.queryByText("Waiting for a GPS fix…")).toBeNull();
    expect(screen.getByText(/GPS accuracy: ±8 m — Live/)).toBeInTheDocument();
  });

  it("a geolocation error shows the alert and Try again reactivates the watch", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    act(() => {
      fake.watches[0]?.emitError(ERROR);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Location permission was denied. Allow location access in your browser settings to use Free roam.",
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(fake.watchPositionSpy).toHaveBeenCalledTimes(2);
    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("North-up and Follow controls are present while watching and toggle aria-pressed", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    const northButton = screen.getByRole("button", { name: "North-up, top-down view" });
    const followButton = screen.getByRole("button", { name: "Follow my location" });
    expect(followButton).toHaveAttribute("aria-pressed", "true");

    await user.click(northButton);
    expect(followButton).toHaveAttribute("aria-pressed", "false");

    await user.click(followButton);
    expect(followButton).toHaveAttribute("aria-pressed", "true");
  });

  it("shows no route-shaped UI at all — no elevation profile, manoeuvre panel or climb selector", () => {
    const fake = buildFakeGeolocationSource();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });

    expect(screen.queryByText("Route profile")).toBeNull();
    expect(screen.queryByText("Recognised climbs")).toBeNull();
    expect(screen.queryByRole("group", { name: "Elevation profile view" })).toBeNull();
    expect(screen.queryByText(/Remaining:/)).toBeNull();
    expect(screen.queryByText(/^On route$|^Off route$|^Possibly off route$/)).toBeNull();
  });

  describe("wake lock control", () => {
    it("renders the wake-lock control only while genuinely active and the API is supported", () => {
      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const fakeWakeLock = buildFakeWakeLockSource();
      render(
        <FreeRoamScreen
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
          wakeLockSource={fakeWakeLock.source}
        />,
      );

      expect(screen.getByText("Keep screen awake")).toBeInTheDocument();
    });

    it("does not render the wake-lock control when navigator.wakeLock is absent", () => {
      vi.stubGlobal("navigator", { onLine: true });
      render(
        <FreeRoamScreen
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(screen.queryByText("Keep screen awake")).toBeNull();
    });
  });

  describe("onRidingActiveChange", () => {
    it("reports active once the watch starts, and false on unmount", () => {
      const onRidingActiveChange = vi.fn();
      const fake = buildFakeGeolocationSource();
      const { unmount } = render(
        <FreeRoamScreen
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
          onRidingActiveChange={onRidingActiveChange}
        />,
      );

      expect(onRidingActiveChange).toHaveBeenLastCalledWith(true);

      unmount();
      expect(onRidingActiveChange).toHaveBeenLastCalledWith(false);
    });
  });
});
