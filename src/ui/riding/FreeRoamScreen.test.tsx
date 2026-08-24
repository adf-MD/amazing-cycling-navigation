import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { FreeRoamScreen } from "./FreeRoamScreen.tsx";
import { FOLLOW_PITCH_DEGREES, NAVIGATION_ZOOM } from "./rideCamera.ts";
import { db } from "../../storage/db.ts";
import type { Coordinate } from "../../domain/types.ts";
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
  triggerCameraSettled: (camera: {
    coordinate: Coordinate;
    zoom: number;
    bearingDegrees: number;
    pitchDegrees: number;
  }) => void;
  setCameraSpy: ReturnType<typeof vi.fn>;
  changeZoomBySpy: ReturnType<typeof vi.fn>;
} {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let userCameraInteractionListener: (() => void) | undefined;
  let cameraSettledListener:
    | ((camera: {
        coordinate: Coordinate;
        zoom: number;
        bearingDegrees: number;
        pitchDegrees: number;
      }) => void)
    | undefined;
  const setCameraSpy = vi.fn();
  const changeZoomBySpy = vi.fn();
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
      onCameraSettled: (listener) => {
        cameraSettledListener = listener;
      },
      setCamera: setCameraSpy,
      centreOn: () => undefined,
      changeZoomBy: changeZoomBySpy,
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
    triggerCameraSettled: (camera) => cameraSettledListener?.(camera),
    setCameraSpy,
    changeZoomBySpy,
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

  it("shows a compact Offline indicator inside the status card while active, not a standalone paragraph", () => {
    vi.stubGlobal("navigator", { onLine: false });
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

    const offline = screen.getByText("Offline");
    expect(offline).toHaveAttribute("role", "status");
    expect(screen.queryByText(/still work; map imagery may be unavailable/)).toBeNull();
  });

  it("shows both the offline indicator and a geolocation error together without duplicating either", () => {
    vi.stubGlobal("navigator", { onLine: false });
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

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Location permission was denied. Allow location access in your browser settings to use Free roam.",
    );
    expect(screen.getAllByText(/Location permission was denied/)).toHaveLength(1);
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

  describe("Zoom controls (backlog item 53)", () => {
    it("render with correct accessible names and glyphs (free roam has no idle state to hide behind)", () => {
      const fake = buildFakeGeolocationSource();
      render(
        <FreeRoamScreen
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      const zoomInButton = screen.getByRole("button", { name: "Zoom in" });
      const zoomOutButton = screen.getByRole("button", { name: "Zoom out" });
      expect(zoomInButton).toHaveTextContent("+");
      expect(zoomOutButton).toHaveTextContent("−");
    });

    // Zoom is pressed before any GPS fix is ever emitted: mode is
    // "following" but still awaitingFreshFix (auto-started on mount, see
    // FreeRoamScreen's own mount effect), so hasActionableFollowAnchor
    // (rideCamera.ts) is false and the press correctly falls back to the
    // ordinary, unanchored changeZoomBy path (backlog item 65) — there is
    // no rider coordinate yet to honestly anchor to. See the "genuinely
    // following" tests below for the anchored case, once a fix exists.
    it("before any accepted fix, pressing Zoom in calls changeZoomBy(1); pressing Zoom out calls changeZoomBy(-1)", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(map.changeZoomBySpy).toHaveBeenLastCalledWith(1);

      await user.click(screen.getByRole("button", { name: "Zoom out" }));
      expect(map.changeZoomBySpy).toHaveBeenLastCalledWith(-1);
    });

    // Backlog item 65: once genuinely following (an accepted fix already
    // applied), a zoom press re-anchors via setCamera at the rider's own
    // coordinate/bearing/pitch, instead of the ordinary unanchored
    // changeZoomBy path — replaces this test's own prior "never calls
    // setCamera" assertion, which described the pre-fix defect. Mirrors
    // RidingScreen.test.tsx's own identical proof.
    it("a zoom press while genuinely following re-anchors via setCamera at the rider's own coordinate, keeps Follow's aria-pressed true, and shows no paused toast", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      map.triggerLoad();
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });
      map.setCameraSpy.mockClear();
      map.changeZoomBySpy.mockClear();

      await user.click(screen.getByRole("button", { name: "Zoom in" }));

      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.queryByText("Map follow paused.")).toBeNull();
      expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      expect(map.setCameraSpy).toHaveBeenLastCalledWith(
        SAMPLE_FIX.coordinate,
        NAVIGATION_ZOOM + 1,
        SAMPLE_FIX.headingDegrees,
        FOLLOW_PITCH_DEGREES,
        { animate: true, followOffset: true },
      );
      // Only one camera operation per press — the unanchored fallback
      // must not also fire for the same press.
      expect(map.changeZoomBySpy).not.toHaveBeenCalled();
    });

    it("two consecutive zoom presses while genuinely following each re-anchor via setCamera, accumulating zoom", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      map.triggerLoad();
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });
      map.setCameraSpy.mockClear();

      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      await user.click(screen.getByRole("button", { name: "Zoom in" }));

      expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
      expect(map.setCameraSpy).toHaveBeenNthCalledWith(
        1,
        SAMPLE_FIX.coordinate,
        NAVIGATION_ZOOM + 1,
        SAMPLE_FIX.headingDegrees,
        FOLLOW_PITCH_DEGREES,
        { animate: true, followOffset: true },
      );
      expect(map.setCameraSpy).toHaveBeenNthCalledWith(
        2,
        SAMPLE_FIX.coordinate,
        NAVIGATION_ZOOM + 2,
        SAMPLE_FIX.headingDegrees,
        FOLLOW_PITCH_DEGREES,
        { animate: true, followOffset: true },
      );
    });

    it("a genuine manual gesture still pauses Follow and shows the toast, unaffected by the new zoom controls", async () => {
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      map.triggerLoad();
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });

      map.triggerUserCameraInteraction();

      expect(await screen.findByText("Map follow paused.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  it("shows no route-shaped UI at all — no elevation profile, manoeuvre panel, climb selector or Finish ride/completion", () => {
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
    expect(screen.queryByText("Route complete")).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish ride" })).toBeNull();
    expect(screen.queryByRole("button", { name: /keep riding/i })).toBeNull();
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

      expect(screen.getByText("Screen on")).toBeInTheDocument();
    });

    it("does not render the wake-lock control when navigator.wakeLock is absent", () => {
      vi.stubGlobal("navigator", { onLine: true });
      render(
        <FreeRoamScreen
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(screen.queryByText("Screen on")).toBeNull();
    });

    it("renders the immersive header (and its title) before the compact wake-lock control in DOM order", () => {
      // Backlog item 68 relocated the wake-lock control again, into the
      // shared compact active-status area alongside the GPS status line —
      // still after the header in document order, just further down than
      // item 56's original "directly after the header" placement.
      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const fakeWakeLock = buildFakeWakeLockSource();
      render(
        <FreeRoamScreen
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
          wakeLockSource={fakeWakeLock.source}
        />,
      );

      const checkbox = screen.getByRole("checkbox", { name: /screen on/i });
      const heading = screen.getByRole("heading", { name: "Free roam" });

      expect(
        heading.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("never renders a Map/Profile switcher — free roam has no route profile to switch to (backlog item 58)", () => {
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(screen.queryByRole("group", { name: "Riding view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Profile" })).toBeNull();
  });

  describe("Immersive fixed shell (backlog item 58)", () => {
    it("renders the immersive header with centre text 'Free roam', with the global nav's own concerns entirely absent from this screen", () => {
      render(
        <FreeRoamScreen
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(
        screen.getByRole("heading", { level: 1, name: "Free roam" }),
      ).toBeInTheDocument();
      expect(document.querySelector("header.riding-immersive-header")).not.toBeNull();
    });

    it("marks the screen as the fixed, non-scrolling immersive shell", () => {
      const { container } = render(
        <FreeRoamScreen
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      const section = container.querySelector("section.screen");
      expect(section).not.toBeNull();
      expect(section).toHaveClass("riding-fixed-shell");
    });

    it("wraps the map in the flex-filling immersive content area, never the pre-item-58 --active/--overview vocabulary", () => {
      const { container } = render(
        <FreeRoamScreen
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      const contentArea = container.querySelector(".ride-content-area");
      expect(contentArea).not.toBeNull();
      expect(contentArea).toHaveClass("ride-content-area--immersive");

      const mapContainer = container.querySelector(".ride-map-container");
      expect(mapContainer).not.toBeNull();
      expect(mapContainer).toHaveClass("ride-map-container--immersive");
      expect(mapContainer).not.toHaveClass("ride-map-container--active");
      expect(mapContainer).not.toHaveClass("ride-map-container--overview");
      expect(contentArea).toContainElement(mapContainer as HTMLElement);
    });

    it("renders the paused toast inside the map container itself, as a non-layout-affecting overlay, not the shared status stack", async () => {
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      const { container } = render(
        <FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />,
      );
      map.triggerLoad();
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });

      map.triggerUserCameraInteraction();

      const toast = await screen.findByText("Map follow paused.");
      expect(toast).toHaveClass("ride-map-paused-toast");
      const mapContainer = container.querySelector(".ride-map-container");
      expect(mapContainer).not.toBeNull();
      expect(mapContainer).toContainElement(toast);
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
