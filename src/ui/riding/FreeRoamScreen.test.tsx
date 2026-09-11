import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { FreeRoamScreen } from "./FreeRoamScreen.tsx";
import { NORTH_LETTER_PATH } from "../shared/northArrowGeometry.ts";
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
  /** Backlog item 108: fires style.load alone, WITHOUT the subsequent
   * load — the structurally-ready-but-imagery-incomplete state item 96's
   * grace period gates, and the only way to reach the "delayed" kind. */
  triggerStyleLoaded: () => void;
  /** Backlog item 108: how many times the factory has genuinely built a
   * map. A "Retry map imagery" press recreates the map, so this replaces
   * the old map-loading-banner proxy, which item 108 suppresses during an
   * active session. */
  mapConstructionCount: () => number;
  /** Backlog item 83: mirrors RidingScreen.test.tsx's identical helper —
   * fires a post-load-shaped tile error against whichever map instance
   * was constructed most recently. */
  triggerTileError: () => void;
  /** Backlog item 83: simulates the external basemap's own source
   * reporting loaded — the genuine recovery signal that clears
   * tileErrorMessage in production (see MapView.tsx's onSourceData). */
  triggerSourceData: (info: { sourceId: string; isSourceLoaded: boolean }) => void;
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
  let errorListener: (() => void) | undefined;
  let sourceDataListener:
    ((info: { sourceId: string; isSourceLoaded: boolean }) => void) | undefined;
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
  let constructionCount = 0;
  const factory: MapFactory = () => {
    constructionCount += 1;
    const map: MapLibreLike = {
      onLoad: (listener) => {
        loadListener = listener;
      },
      onStyleLoaded: (listener) => {
        styleLoadedListener = listener;
      },
      onError: (listener) => {
        errorListener = () => {
          listener({ message: "tile fetch failed", category: "style-request-or-parse" });
        };
      },
      onSourceData: (listener) => {
        sourceDataListener = listener;
      },
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
    triggerStyleLoaded: () => styleLoadedListener?.(),
    mapConstructionCount: () => constructionCount,
    triggerTileError: () => errorListener?.(),
    triggerSourceData: (info) => sourceDataListener?.(info),
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

/** Item 110's presentation follow-up replaced the "+"/"−" text
 * characters with a shared drawn ZoomIcon, matched by construction. The
 * glyph check becomes: a drawn icon is present, and no bare text
 * character is left behind in the control. */
function expectDrawnZoomGlyphs(zoomIn: HTMLElement, zoomOut: HTMLElement): void {
  for (const button of [zoomIn, zoomOut]) {
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button).toHaveTextContent("");
  }
  expect(zoomIn).not.toHaveTextContent("+");
  expect(zoomOut).not.toHaveTextContent("−");
}

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
    expect(screen.getByText(/GPS ±8 m · Live/)).toBeInTheDocument();
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

  // Backlog item 83: mirrors RidingScreen.test.tsx's own describe("offline
  // and tile-failure resilience", ...) coverage, previously missing here.
  describe("map-imagery recovery relocation (backlog item 83)", () => {
    it("relocates a mid-session tile error into the active status card, out of the map's own overlay", () => {
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });

      act(() => {
        map.triggerLoad();
      });
      act(() => {
        map.triggerTileError();
      });

      const banner = screen.getByTestId("tiles-unavailable-banner");
      expect(banner.closest(".ride-status-card")).not.toBeNull();
      expect(banner.closest(".map-status-overlay")).toBeNull();
      // The rest of the free-roam UI is untouched by the map's own tile
      // failure.
      expect(screen.getByText(/GPS ±8 m · Live/)).toBeInTheDocument();
      expect(screen.getByTestId("map-container")).toBeInTheDocument();
    });

    it("wires the status card's Retry action through to a genuine map retry, clearing the row once the fresh attempt succeeds", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });

      act(() => {
        map.triggerLoad();
      });
      act(() => {
        map.triggerTileError();
      });
      const banner = screen.getByTestId("tiles-unavailable-banner");
      const retryButton = within(banner).getByRole("button", {
        name: "Retry map imagery",
      });

      const constructionsBeforeRetry = map.mapConstructionCount();
      await user.click(retryButton);

      // Backlog item 108 replaced this test's old proxy for "a genuine
      // retry happened" — the in-map map-loading banner — because an
      // active free-roam session now suppresses every in-map imagery
      // message. Counting real map constructions proves the same thing
      // more directly, and the suppression itself is asserted below.
      await waitFor(() => {
        expect(map.mapConstructionCount()).toBeGreaterThan(constructionsBeforeRetry);
      });
      expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();
      expect(screen.queryByTestId("map-loading")).toBeNull();

      act(() => {
        map.triggerLoad();
      });
      expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();
    });

    it("clears the relocated imagery-recovery row automatically on genuine imagery recovery, via the same signal that clears the map-owned banner", async () => {
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });

      act(() => {
        map.triggerLoad();
      });
      act(() => {
        map.triggerTileError();
      });
      expect(screen.getByTestId("tiles-unavailable-banner")).toBeInTheDocument();

      act(() => {
        map.triggerSourceData({ sourceId: "openmaptiles", isSourceLoaded: true });
      });
      await waitFor(() => {
        expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();
      });
    });
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

  // Backlog item 110 — free roam's twin of RidingScreen's own suite. Free
  // roam starts already following, so a rotated followed camera is its
  // ordinary case, and it is exactly the mode in which no pre-existing
  // field retained a map bearing.
  describe("north-pointing arrow (backlog item 110)", () => {
    function arrowIn(button: HTMLElement): SVGSVGElement {
      const svg = button.querySelector("svg");
      if (!svg) {
        throw new Error("expected the north-up control to render an arrow glyph");
      }
      return svg;
    }

    function renderFreeRoam() {
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      map.triggerLoad();
      return {
        map,
        northUpButton: screen.getByRole("button", {
          name: "North-up, top-down view",
        }),
      };
    }

    it("shows no static N as the control's visual content", () => {
      const { northUpButton } = renderFreeRoam();

      expect(northUpButton).toHaveTextContent("");
      expect(arrowIn(northUpButton)).toBeInTheDocument();
    });

    it("points the arrow towards north at a rotated, followed camera", async () => {
      const { map, northUpButton } = renderFreeRoam();

      act(() => {
        map.triggerCameraSettled({
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: 90,
          pitchDegrees: 35,
        });
      });

      await waitFor(() => {
        expect(arrowIn(northUpButton).style.transform).toBe("rotate(-90deg)");
      });
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(northUpButton).toHaveAttribute("aria-pressed", "false");
    });

    it("normalises MapLibre's own signed bearing readback", async () => {
      const { map, northUpButton } = renderFreeRoam();

      act(() => {
        map.triggerCameraSettled({
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: -90,
          pitchDegrees: 35,
        });
      });

      await waitFor(() => {
        expect(arrowIn(northUpButton).style.transform).toBe("rotate(-270deg)");
      });
    });

    it("returns the arrow to up once the camera settles north-up, leaving no stale bearing", async () => {
      const user = userEvent.setup();
      const { map, northUpButton } = renderFreeRoam();

      act(() => {
        map.triggerCameraSettled({
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: 212,
          pitchDegrees: 35,
        });
      });
      await waitFor(() => {
        expect(arrowIn(northUpButton).style.transform).toBe("rotate(-212deg)");
      });

      await user.click(northUpButton);
      expect(arrowIn(northUpButton).style.transform).toBe("rotate(0deg)");

      act(() => {
        map.triggerCameraSettled({
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: 0,
          pitchDegrees: 0,
        });
      });
      await waitFor(() => {
        expect(northUpButton).toHaveAttribute("aria-pressed", "true");
      });
      expect(arrowIn(northUpButton).style.transform).toBe("rotate(0deg)");
    });

    it("keeps the rotation on the glyph, never on the button (negative control 5)", async () => {
      const { map, northUpButton } = renderFreeRoam();

      act(() => {
        map.triggerCameraSettled({
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: 90,
          pitchDegrees: 35,
        });
      });

      await waitFor(() => {
        expect(arrowIn(northUpButton).style.transform).toBe("rotate(-90deg)");
      });
      expect(northUpButton.style.transform).toBe("");
    });
  });

  // Item 110 presentation follow-up: all four of free roam's map controls
  // now draw their symbols.
  describe("drawn control symbols (item 110 presentation follow-up)", () => {
    function renderFreeRoam() {
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      map.triggerLoad();
      return { map, fake };
    }

    // Compatibility guard, not new evidence: free roam already put
    // North-up above Follow before the item 110 second follow-up.
    it("already renders North-up before Follow, and keeps doing so", () => {
      renderFreeRoam();

      const cluster = document.querySelector(".ride-map-camera-controls");
      if (!(cluster instanceof HTMLElement)) {
        throw new Error("expected the free roam camera cluster to render");
      }
      expect(
        [...cluster.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
      ).toEqual(["North-up, top-down view", "Follow my location"]);
    });

    it("shows the pending wording, not the crosshair, before the first fix", () => {
      renderFreeRoam();

      // Free roam opens already following but with no fix yet, so the
      // Follow control legitimately renders its pending word instead of
      // a glyph. Asserted explicitly so the four-symbol check below
      // cannot quietly pass on a half-rendered screen.
      const followButton = screen.getByRole("button", { name: "Follow my location" });
      expect(followButton).toHaveTextContent("Waiting…");
      expect(followButton.querySelector("svg")).toBeNull();
    });

    it("draws all four symbols, leaving no text glyph behind", () => {
      const { fake } = renderFreeRoam();
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });

      for (const name of [
        "Zoom in",
        "Zoom out",
        "Follow my location",
        "North-up, top-down view",
      ]) {
        const button = screen.getByRole("button", { name });
        expect(button.querySelector("svg")).not.toBeNull();
        expect(button).toHaveTextContent("");
      }
    });

    it("keeps every accessible name and both pressed semantics", () => {
      renderFreeRoam();

      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(
        screen.getByRole("button", { name: "North-up, top-down view" }),
      ).toHaveAttribute("aria-pressed", "false");
      for (const name of ["Zoom in", "Zoom out"]) {
        expect(
          screen.getByRole("button", { name }).getAttribute("aria-pressed"),
        ).toBeNull();
      }
    });

    it("hands the north arrow the control's own pressed state", async () => {
      const user = userEvent.setup();
      const { map } = renderFreeRoam();
      const northUp = screen.getByRole("button", { name: "North-up, top-down view" });
      const letter = () => northUp.querySelector(`path[d="${NORTH_LETTER_PATH}"]`);

      expect(letter()).toHaveAttribute("fill", "var(--colour-bg)");

      await user.click(northUp);
      act(() => {
        map.triggerCameraSettled({
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: 0,
          pitchDegrees: 0,
        });
      });
      await waitFor(() => {
        expect(northUp).toHaveAttribute("aria-pressed", "true");
      });
      expect(letter()).toHaveAttribute("fill", "var(--colour-accent)");
    });
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
      expectDrawnZoomGlyphs(zoomInButton, zoomOutButton);
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

      const toggle = screen.getByRole("button", { name: "Screen on" });
      const heading = screen.getByRole("heading", { name: "Free roam" });

      expect(
        heading.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
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

describe("FreeRoamScreen: hosted imagery status and route-free copy (backlog item 108)", () => {
  it("shows the slow-imagery row in the status card, with position-only wording and nothing over the map", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });

      act(() => {
        map.triggerStyleLoaded();
      });
      act(() => {
        vi.advanceTimersByTime(1_999);
      });
      expect(screen.queryByTestId("map-imagery-delayed-banner")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      const row = await screen.findByTestId("map-imagery-delayed-banner");
      expect(row.closest(".ride-status-card")).not.toBeNull();
      expect(row.closest(".map-status-overlay")).toBeNull();
      expect(row).toHaveTextContent(
        "Map imagery is taking longer than usual to load. Your position is still shown.",
      );
      expect(row.textContent).not.toMatch(/route/i);
      expect(screen.queryByTestId("retry-map-imagery-button")).toBeNull();
      expect(
        screen.getByTestId("map-container").querySelector(".map-status-message"),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the slow-imagery row while imagery stays delayed, with no fixed disappearance timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
      act(() => {
        fake.watches[0]?.emitFix(SAMPLE_FIX);
      });
      act(() => {
        map.triggerStyleLoaded();
      });
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      const row = await screen.findByTestId("map-imagery-delayed-banner");
      // Anchored to the hosted row specifically — the in-map banner reuses
      // this same test id, so without this the assertions below would also
      // be satisfied by the pre-item-108 in-map presentation.
      expect(row.closest(".ride-status-card")).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(600_000);
      });
      const persisted = screen.getByTestId("map-imagery-delayed-banner");
      expect(persisted.closest(".ride-status-card")).not.toBeNull();
      expect(screen.getAllByTestId("map-imagery-delayed-banner")).toHaveLength(1);

      act(() => {
        map.triggerLoad();
      });
      await waitFor(() => {
        expect(screen.queryByTestId("map-imagery-delayed-banner")).toBeNull();
      });
      expect(document.querySelector(".ride-status-card-imagery-row")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses position-only wording for a mid-session tile error, never claiming a route", () => {
    const fake = buildFakeGeolocationSource();
    const map = buildStubMapFactory();
    render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);
    act(() => {
      fake.watches[0]?.emitFix(SAMPLE_FIX);
    });
    act(() => {
      map.triggerLoad();
    });
    act(() => {
      map.triggerTileError();
    });

    const banner = screen.getByTestId("tiles-unavailable-banner");
    expect(banner).toHaveTextContent(
      "Map imagery unavailable. Your position is still shown.",
    );
    expect(banner.textContent).not.toMatch(/route/i);
  });

  // The UNHOSTED path is genuinely reachable in free roam, which is why
  // MapView needs imageryCopyContext at all rather than the status card
  // alone being corrected: Pause is enabled before the first fix arrives,
  // and pausing then leaves geolocationStatus "idle" with no retained fix,
  // so showStatusCard goes false while MapView stays mounted.
  it("keeps position-only wording when the status card is absent, after pausing before any fix arrives", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const map = buildStubMapFactory();
    render(<FreeRoamScreen geolocationSource={fake.source} mapFactory={map.factory} />);

    // No fix has ever arrived, so pausing leaves the card with nothing to
    // show and it unmounts entirely.
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(document.querySelector(".ride-status-card")).toBeNull();
    });

    act(() => {
      map.triggerLoad();
    });
    act(() => {
      map.triggerTileError();
    });

    const banner = await screen.findByTestId("tiles-unavailable-banner");
    // Back inside the map, because there is no host to relocate it to...
    expect(banner.closest(".map-status-overlay")).not.toBeNull();
    expect(banner.closest(".ride-status-card")).toBeNull();
    // ...but still truthful about what free roam actually shows.
    expect(banner).toHaveTextContent(
      "Map imagery unavailable. Your position is still shown.",
    );
    expect(banner.textContent).not.toMatch(/route/i);
  });
});
