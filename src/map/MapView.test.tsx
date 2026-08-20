import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MapView } from "./MapView.tsx";
import type {
  CreateMapOptions,
  DistanceBadgeMarkerSpec,
  MapErrorInfo,
  MapLibreLike,
  MapFactory,
  MapMarkerSpec,
  MapSourceDataInfo,
  RouteFeatureHit,
  WarningFeatureHit,
} from "./mapAdapter.ts";
import { clearErrorLog, getRecentErrors } from "../platform/errorLog.ts";
import { clearMapDiagnostics, getRecentMapAttempts } from "./mapDiagnostics.ts";
import type { Coordinate, RoutePoint, RouteWarning } from "../domain/types.ts";
import type { ClassifiedSegment } from "../navigation/gradient.ts";
import type {
  ClimbFeature,
  DescentFeature,
  RouteFeature,
} from "../navigation/routeFeatures.ts";
import {
  MICRO_DETAIL_COLOURS,
  ROUTE_FEATURE_COLOURS,
  UNREACHABLE_FALLBACK_COLOUR,
  type MicroDetailVisualKey,
} from "../navigation/routeFeaturePalette.ts";
import type { ZoomInterpolatedLineWidth } from "./mapAdapter.ts";
import {
  legibleWidthStops,
  recedingWidthStops,
  ROUTE_WIDTH_CLOSE_ZOOM,
  ROUTE_WIDTH_OVERVIEW_ZOOM,
  ROUTE_WIDTH_REGIONAL_ZOOM,
  warningWidthStops,
} from "./routeWidthPolicy.ts";

const points: RoutePoint[] = [
  { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
  { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 100 },
];

const warningPoints: RoutePoint[] = Array.from({ length: 5 }, (_, index) => ({
  coordinate: [index * 0.001, 51] as Coordinate,
  elevationMetres: null,
  distanceFromStartMetres: index * 100,
}));

// Long enough (5km, 500m spacing) that a 1km badge interval places
// several exact-on-point candidates (1/2/3/4 km) with no interpolation
// noise to account for in assertions.
const badgeRoutePoints: RoutePoint[] = Array.from({ length: 11 }, (_, index) => ({
  coordinate: [(index * 500) / 100_000, 51] as Coordinate,
  elevationMetres: null,
  distanceFromStartMetres: index * 500,
}));

// 22km — long enough that the naive candidate count at every one of the
// four approved intervals (1/5/10/20km) is both non-zero and within the
// marker cap, so a zoom-band change actually changes which interval is
// selected (a short route de-escalates back to 1km regardless of zoom).
const longBadgeRoutePoints: RoutePoint[] = Array.from({ length: 45 }, (_, index) => ({
  coordinate: [(index * 500) / 100_000, 51] as Coordinate,
  elevationMetres: null,
  distanceFromStartMetres: index * 500,
}));

interface MockMapHandle {
  factory: MapFactory;
  /** Targets whichever map instance was constructed most recently — matches
   * MapView's own behaviour of falling back to a freshly-constructed map. */
  triggerLoad: () => void;
  /** Fires only "style.load" — never the full "load" — for testing the
   * intermediate "style structurally ready" stage on its own. */
  triggerStyleLoaded: () => void;
  triggerError: (info: MapErrorInfo) => void;
  triggerSourceData: (info: MapSourceDataInfo) => void;
  /** Simulates a genuine user gesture (drag/pinch/rotate/pitch) — the real
   * adapter only calls its listener when movestart's originalEvent is
   * set, so this is the "user" case; programmatic moves never call it. */
  triggerUserCameraInteraction: () => void;
  triggerCameraSettled: (camera: {
    coordinate: Coordinate;
    zoom: number;
    bearingDegrees: number;
    pitchDegrees: number;
  }) => void;
  triggerMapTap: (coordinate: Coordinate) => void;
  sources: Map<string, GeoJSON.FeatureCollection>;
  layers: Set<string>;
  /** Registered images on whichever map instance was constructed most
   * recently — cleared on every new instance (see factory below), unlike
   * `sources`/`layers`, since a genuinely fresh MapLibre Map always
   * starts with zero registered images. */
  images: Set<string>;
  removeSpy: ReturnType<typeof vi.fn>;
  fitBoundsSpy: ReturnType<typeof vi.fn>;
  resizeSpy: ReturnType<typeof vi.fn>;
  getCenterSpy: ReturnType<typeof vi.fn>;
  getZoomSpy: ReturnType<typeof vi.fn>;
  setCameraSpy: ReturnType<typeof vi.fn>;
  centreOnSpy: ReturnType<typeof vi.fn>;
  changeZoomBySpy: ReturnType<typeof vi.fn>;
  /** Diagnostic-only (backlog item 65) — a deterministic linear mapping
   * from coordinate to pixel, distinct enough per input that a test can
   * tell two different coordinates apart by their projected values. */
  projectSpy: ReturnType<
    typeof vi.fn<(coordinate: Coordinate) => { x: number; y: number }>
  >;
  addLineLayerSpy: ReturnType<typeof vi.fn>;
  addImageSpy: ReturnType<typeof vi.fn>;
  addSymbolLayerSpy: ReturnType<typeof vi.fn>;
  /** Default: never a hit (returns null). Tests override with
   * .mockReturnValueOnce/.mockReturnValue to simulate a warning-feature
   * hit; also lets tests assert exactly which coordinate/layerIds MapView
   * queried. */
  queryTopWarningFeatureAtSpy: ReturnType<
    typeof vi.fn<
      (coordinate: Coordinate, layerIds: readonly string[]) => WarningFeatureHit | null
    >
  >;
  /** Default: never a hit (returns null). Tests override with
   * .mockReturnValueOnce/.mockReturnValue to simulate a route-feature
   * (climb/descent) hit; also lets tests assert exactly which
   * coordinate/layerIds MapView queried. */
  queryTopRouteFeatureAtSpy: ReturnType<
    typeof vi.fn<
      (coordinate: Coordinate, layerIds: readonly string[]) => RouteFeatureHit | null
    >
  >;
  setMarkersSpy: ReturnType<typeof vi.fn<(markers: readonly MapMarkerSpec[]) => void>>;
  setDistanceBadgesSpy: ReturnType<
    typeof vi.fn<(badges: readonly DistanceBadgeMarkerSpec[]) => void>
  >;
  constructedStyles: CreateMapOptions["style"][];
}

function createMockMapFactory(center: Coordinate = [1.23, 4.56]): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let styleLoadedFired = false;
  let errorListener: ((info: MapErrorInfo) => void) | undefined;
  let sourceDataListener: ((info: MapSourceDataInfo) => void) | undefined;
  let userCameraInteractionListener: (() => void) | undefined;
  let cameraSettledListener:
    | ((camera: {
        coordinate: Coordinate;
        zoom: number;
        bearingDegrees: number;
        pitchDegrees: number;
      }) => void)
    | undefined;
  let mapTapListener: ((coordinate: Coordinate) => void) | undefined;
  const sources = new Map<string, GeoJSON.FeatureCollection>();
  const layers = new Set<string>();
  const images = new Set<string>();
  const removeSpy = vi.fn();
  const fitBoundsSpy = vi.fn();
  const resizeSpy = vi.fn();
  const getCenterSpy = vi.fn(() => center);
  const getZoomSpy = vi.fn(() => 14);
  const setCameraSpy = vi.fn();
  const centreOnSpy = vi.fn();
  const changeZoomBySpy = vi.fn();
  const projectSpy = vi.fn((coordinate: Coordinate): { x: number; y: number } => ({
    x: coordinate[0] * 100,
    y: coordinate[1] * 100,
  }));
  const addLineLayerSpy = vi.fn();
  const addImageSpy = vi.fn();
  const addSymbolLayerSpy = vi.fn();
  const queryTopWarningFeatureAtSpy = vi.fn((): WarningFeatureHit | null => null);
  const queryTopRouteFeatureAtSpy = vi.fn((): RouteFeatureHit | null => null);
  const setMarkersSpy: ReturnType<
    typeof vi.fn<(markers: readonly MapMarkerSpec[]) => void>
  > = vi.fn();
  const setDistanceBadgesSpy: ReturnType<
    typeof vi.fn<(badges: readonly DistanceBadgeMarkerSpec[]) => void>
  > = vi.fn();
  const constructedStyles: CreateMapOptions["style"][] = [];

  const factory: MapFactory = ({ style }) => {
    constructedStyles.push(style);
    styleLoadedFired = false;
    // A genuinely fresh MapLibre Map instance always starts with zero
    // registered images — clear in place (not reassign) so the handle's
    // `images` reference stays valid across a fallback/retry's new
    // instance, matching how triggerLoad already always targets
    // "whichever instance was constructed most recently".
    images.clear();
    const map: MapLibreLike = {
      onLoad: (listener) => {
        loadListener = listener;
      },
      onStyleLoaded: (listener) => {
        styleLoadedListener = listener;
      },
      onError: (listener) => {
        errorListener = listener;
      },
      onSourceData: (listener) => {
        sourceDataListener = listener;
      },
      addGeoJsonSource: (id, data) => {
        sources.set(id, data);
      },
      setGeoJsonSourceData: (id, data) => {
        sources.set(id, data);
      },
      hasSource: (id) => sources.has(id),
      addLineLayer: (id, sourceId, paint) => {
        layers.add(id);
        addLineLayerSpy(id, sourceId, paint);
      },
      addCircleLayer: (id: string) => {
        layers.add(id);
      },
      hasLayer: (id) => layers.has(id),
      hasImage: (id) => images.has(id),
      addImage: (id, image, options) => {
        images.add(id);
        addImageSpy(id, image, options);
      },
      addSymbolLayer: (id, sourceId, iconId, options) => {
        layers.add(id);
        addSymbolLayerSpy(id, sourceId, iconId, options);
      },
      fitBounds: fitBoundsSpy,
      getCenter: getCenterSpy,
      getZoom: getZoomSpy,
      onUserCameraInteraction: (listener) => {
        userCameraInteractionListener = listener;
      },
      onCameraSettled: (listener) => {
        cameraSettledListener = listener;
      },
      setCamera: setCameraSpy,
      centreOn: centreOnSpy,
      changeZoomBy: changeZoomBySpy,
      project: projectSpy,
      resize: resizeSpy,
      onMapTap: (listener) => {
        mapTapListener = listener;
      },
      queryTopWarningFeatureAt: queryTopWarningFeatureAtSpy,
      queryTopRouteFeatureAt: queryTopRouteFeatureAtSpy,
      setMarkers: setMarkersSpy,
      setDistanceBadges: setDistanceBadgesSpy,
      remove: removeSpy,
    };
    return map;
  };

  return {
    factory,
    fitBoundsSpy,
    resizeSpy,
    getCenterSpy,
    getZoomSpy,
    setCameraSpy,
    centreOnSpy,
    changeZoomBySpy,
    projectSpy,
    addLineLayerSpy,
    addImageSpy,
    addSymbolLayerSpy,
    queryTopWarningFeatureAtSpy,
    queryTopRouteFeatureAtSpy,
    setMarkersSpy,
    setDistanceBadgesSpy,
    constructedStyles,
    triggerLoad: () => {
      act(() => {
        // Real MapLibre always fires "style.load" strictly before "load"
        // — mirror that guarantee here so every existing test calling
        // only triggerLoad() keeps working unchanged.
        if (!styleLoadedFired) {
          styleLoadedFired = true;
          styleLoadedListener?.();
        }
        loadListener?.();
      });
    },
    triggerStyleLoaded: () => {
      act(() => {
        if (styleLoadedFired) return;
        styleLoadedFired = true;
        styleLoadedListener?.();
      });
    },
    triggerError: (info) => {
      act(() => {
        errorListener?.(info);
      });
    },
    triggerSourceData: (info) => {
      act(() => {
        sourceDataListener?.(info);
      });
    },
    triggerUserCameraInteraction: () => {
      act(() => {
        userCameraInteractionListener?.();
      });
    },
    triggerCameraSettled: (camera) => {
      act(() => {
        cameraSettledListener?.(camera);
      });
    },
    triggerMapTap: (coordinate) => {
      act(() => {
        mapTapListener?.(coordinate);
      });
    },
    sources,
    layers,
    images,
    removeSpy,
  };
}

function firstCallOrder(spy: ReturnType<typeof vi.fn>): number {
  return nthCallOrder(spy, 0);
}

/** The Nth call's own invocationCallOrder — used, alongside firstCallOrder
 * above, to prove ordering across a *re*-application (e.g. a second
 * resize()-then-setCamera pair), not just the first. */
function nthCallOrder(spy: ReturnType<typeof vi.fn>, index: number): number {
  const order: number | undefined = spy.mock.invocationCallOrder[index];
  if (order === undefined) {
    throw new Error(
      `expected spy to have been called at least ${String(index + 1)} time(s)`,
    );
  }
  return order;
}

/** The sole argument of a single-argument spy's most recent call — used
 * throughout the distance badge overlay tests below to read back
 * whatever setMarkers/setDistanceBadges was last called with. */
function lastCallFirstArg<T>(spy: { mock: { calls: [T][] } }): T {
  const lastCall = spy.mock.calls.at(-1);
  if (lastCall === undefined) {
    throw new Error("expected the spy to have been called at least once");
  }
  return lastCall[0];
}

/** Every route/warning/preview lineWidth is now a ZoomInterpolatedLineWidth
 * (routeWidthPolicy.ts) rather than a plain number — this extracts the
 * close-zoom (ROUTE_WIDTH_CLOSE_ZOOM) stop, which by construction always
 * equals the width this layer used before backlog item 23, so every
 * existing "compare today's widths" assertion keeps working unchanged in
 * spirit. Throws for a plain number (every real call site is now
 * zoom-interpolated) or a stop list missing the close-zoom stop. */
function closeZoomWidth(lineWidth: number | ZoomInterpolatedLineWidth): number {
  if (typeof lineWidth === "number") {
    throw new Error("expected a ZoomInterpolatedLineWidth, got a plain number");
  }
  const closeStop = lineWidth.stops.find((stop) => stop.zoom === ROUTE_WIDTH_CLOSE_ZOOM);
  if (!closeStop) {
    throw new Error("expected a stop at ROUTE_WIDTH_CLOSE_ZOOM");
  }
  return closeStop.width;
}

function widthAt(lineWidth: number | ZoomInterpolatedLineWidth, zoom: number): number {
  if (typeof lineWidth === "number") {
    throw new Error("expected a ZoomInterpolatedLineWidth, got a plain number");
  }
  const stop = lineWidth.stops.find((candidate) => candidate.zoom === zoom);
  if (!stop) {
    throw new Error(`expected a stop at zoom ${String(zoom)}`);
  }
  return stop.width;
}

beforeEach(() => {
  clearMapDiagnostics();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MapView", () => {
  it("renders visible attribution linking to the configured tile source", () => {
    const { factory } = createMockMapFactory();
    render(<MapView points={points} mapFactory={factory} />);

    const attribution = screen.getByTestId("map-attribution");
    expect(attribution).toHaveClass("map-attribution");
    const link = attribution.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(link?.textContent).toBe("OpenStreetMap contributors");
  });

  it("shows a loading indicator until the map's first load fires", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    expect(screen.getByTestId("map-loading")).toHaveTextContent("Loading map");

    mock.triggerLoad();

    expect(screen.queryByTestId("map-loading")).toBeNull();
  });

  it("falls back to the local neutral style immediately on a fatal pre-ready style error, and still shows the route", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerError({
      message: "style fetch failed",
      category: "style-request-or-parse",
    });

    expect(screen.queryByTestId("map-load-error")).toBeNull();
    expect(mock.constructedStyles).toHaveLength(2);
    expect(mock.constructedStyles[1]).not.toBe(mock.constructedStyles[0]);

    mock.triggerLoad();

    expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
    expect(mock.sources.has("acn-route-remaining")).toBe(true);
  });

  it("shows a terminal load-error state with a compact, non-technical message and a working Retry, while the raw message still reaches the error log", () => {
    clearErrorLog();
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerError({
      message: "primary style fetch failed",
      category: "style-request-or-parse",
    });
    mock.triggerError({
      message: "fallback also failed",
      category: "style-request-or-parse",
    });

    expect(screen.queryByTestId("map-loading")).toBeNull();
    const banner = screen.getByTestId("map-load-error");
    expect(banner).toHaveTextContent(
      "Map failed to load. Check your connection and try again.",
    );
    expect(banner).not.toHaveTextContent("fallback also failed");
    expect(
      getRecentErrors().some((entry) => entry.message.includes("fallback also failed")),
    ).toBe(true);

    expect(screen.getByTestId("retry-map-imagery-button")).toBeInTheDocument();
  });

  it("says the map is taking longer than expected if the style isn't ready after the timeout", () => {
    vi.useFakeTimers();
    try {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(screen.getByTestId("map-loading")).toHaveTextContent(
        "taking longer than expected",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the local neutral style if the style isn't ready within the timeout, and still shows the route", () => {
    vi.useFakeTimers();
    try {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      expect(mock.constructedStyles).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(mock.constructedStyles).toHaveLength(2);
      expect(mock.constructedStyles[1]).not.toBe(mock.constructedStyles[0]);

      mock.triggerLoad();

      expect(screen.queryByTestId("map-loading")).toBeNull();
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      expect(mock.sources.has("acn-route-remaining")).toBe(true);
      expect(mock.fitBoundsSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show the timeout message once the style has already become ready", () => {
    vi.useFakeTimers();
    try {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(screen.queryByTestId("map-loading")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds route and position layers independent of the base style once loaded", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerLoad();

    expect(mock.sources.has("acn-route-remaining")).toBe(true);
    expect(mock.sources.has("acn-route-completed")).toBe(true);
    expect(mock.sources.has("acn-position")).toBe(true);
    expect(mock.layers.has("acn-route-remaining-line")).toBe(true);
    expect(mock.layers.has("acn-route-completed-line")).toBe(true);
    expect(mock.layers.has("acn-position-marker")).toBe(true);
  });

  it("marks the start and finish for a point-to-point route", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerLoad();

    expect(mock.sources.get("acn-route-start")?.features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [0, 51],
    });
    expect(mock.sources.get("acn-route-finish")?.features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [0.001, 51],
    });
  });

  it("marks only the start (not a separate finish) for a closed-loop route", () => {
    const loopPoints: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 100 },
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 200 },
    ];
    const mock = createMockMapFactory();
    render(<MapView points={loopPoints} mapFactory={mock.factory} />);

    mock.triggerLoad();

    expect(mock.sources.get("acn-route-start")?.features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [0, 51],
    });
    expect(mock.sources.get("acn-route-finish")?.features).toEqual([]);
  });

  it("frames the map to the route's bounding box once loaded", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerLoad();

    expect(mock.fitBoundsSpy).toHaveBeenCalledWith({
      southWest: [0, 51],
      northEast: [0.001, 51],
    });
  });

  it("records the camera centre once fitBounds has actually been applied", () => {
    const mock = createMockMapFactory([-1.5, 53.8]);
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerLoad();

    expect(mock.getCenterSpy).toHaveBeenCalled();
    expect(screen.getByTestId("map-container")).toHaveAttribute(
      "data-camera-center",
      "-1.5,53.8",
    );
  });

  it("skips the automatic overview fit when suppressInitialOverviewFit is set, but still marks start/finish", () => {
    const mock = createMockMapFactory();
    render(
      <MapView points={points} mapFactory={mock.factory} suppressInitialOverviewFit />,
    );

    mock.triggerLoad();

    expect(mock.fitBoundsSpy).not.toHaveBeenCalled();
    expect(mock.sources.get("acn-route-start")?.features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [0, 51],
    });
  });

  it("reports a genuine user camera interaction, but not for its own load/fit/resize calls", () => {
    const onUserCameraInteraction = vi.fn();
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        onUserCameraInteraction={onUserCameraInteraction}
      />,
    );

    mock.triggerLoad();
    expect(onUserCameraInteraction).not.toHaveBeenCalled();

    mock.triggerUserCameraInteraction();
    expect(onUserCameraInteraction).toHaveBeenCalledOnce();
  });

  it("reports where the camera settles via onCameraSettled", () => {
    const onCameraSettled = vi.fn();
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        onCameraSettled={onCameraSettled}
      />,
    );
    mock.triggerLoad();

    mock.triggerCameraSettled({
      coordinate: [-1.1, 52.2],
      zoom: 12,
      bearingDegrees: 90,
      pitchDegrees: 35,
    });

    expect(onCameraSettled).toHaveBeenCalledWith({
      coordinate: [-1.1, 52.2],
      zoom: 12,
      bearingDegrees: 90,
      pitchDegrees: 35,
    });
  });

  it("updates the camera-centre diagnostic attribute whenever the camera settles, not just after the initial fit", () => {
    const mock = createMockMapFactory();
    render(
      <MapView points={points} mapFactory={mock.factory} suppressInitialOverviewFit />,
    );
    mock.triggerLoad();

    // The initial fit is suppressed here (mirroring a resumed
    // following/free ride), so without picking up onCameraSettled this
    // attribute would stay empty forever even though the camera moved.
    expect(screen.getByTestId("map-container")).toHaveAttribute("data-camera-center", "");

    mock.triggerCameraSettled({
      coordinate: [-1.1, 52.2],
      zoom: 12,
      bearingDegrees: 0,
      pitchDegrees: 0,
    });

    expect(screen.getByTestId("map-container")).toHaveAttribute(
      "data-camera-center",
      "-1.1,52.2",
    );
  });

  it("exposes zoom/bearing/pitch as diagnostic attributes once the camera settles, empty before the first settle", () => {
    const mock = createMockMapFactory();
    render(
      <MapView points={points} mapFactory={mock.factory} suppressInitialOverviewFit />,
    );
    mock.triggerLoad();

    const container = screen.getByTestId("map-container");
    expect(container).toHaveAttribute("data-camera-zoom", "");
    expect(container).toHaveAttribute("data-camera-bearing", "");
    expect(container).toHaveAttribute("data-camera-pitch", "");

    mock.triggerCameraSettled({
      coordinate: [-1.1, 52.2],
      zoom: 15.25,
      bearingDegrees: -42,
      pitchDegrees: 23,
    });

    expect(container).toHaveAttribute("data-camera-zoom", "15.25");
    expect(container).toHaveAttribute("data-camera-bearing", "-42");
    expect(container).toHaveAttribute("data-camera-pitch", "23");
  });

  it("applies an animated following cameraTarget via setCamera once ready, carrying centre/zoom/bearing/pitch/offset together", () => {
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        cameraTarget={{
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: 90,
          pitchDegrees: 35,
          animate: true,
          followOffset: true,
        }}
      />,
    );

    mock.triggerLoad();

    expect(mock.setCameraSpy).toHaveBeenCalledWith([0, 51], 16, 90, 35, {
      animate: true,
      followOffset: true,
    });
  });

  // Regression coverage for CLAUDE.md item 63 (the "re-pressing Follow
  // location..." race): mirrors "resizes the map before fitting a
  // boundsTarget's bounds" below exactly — a followOffset:true command's
  // setCamera converts a pixel offset into a geographic delta using
  // MapLibre's cached transform dimensions, computed synchronously at
  // call time, so those dimensions must be freshly resynced immediately
  // before every application, not just the first.
  it("resizes the map before applying a cameraTarget's setCamera", () => {
    const mock = createMockMapFactory();
    // No route points: isolates resize/setCamera calls to the cameraTarget
    // effect alone, rather than also counting the route-overview fit's own
    // resize-then-fitBounds pair — mirrors "resizes the map before fitting
    // a boundsTarget's bounds" below exactly.
    render(
      <MapView
        points={[]}
        mapFactory={mock.factory}
        cameraTarget={{
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: 90,
          pitchDegrees: 35,
          animate: true,
          followOffset: true,
          requestId: "request-1",
        }}
      />,
    );

    mock.triggerLoad();

    expect(mock.resizeSpy).toHaveBeenCalledOnce();
    expect(mock.setCameraSpy).toHaveBeenCalledOnce();
    expect(firstCallOrder(mock.resizeSpy)).toBeLessThan(
      firstCallOrder(mock.setCameraSpy),
    );
  });

  it("resizes the map again before re-applying a cameraTarget with a new requestId", () => {
    const mock = createMockMapFactory();
    const target = {
      coordinate: [-0.1, 51.5] as Coordinate,
      zoom: 16,
      bearingDegrees: 0,
      pitchDegrees: 35,
      animate: true,
      followOffset: true,
      requestId: "request-1",
    };
    // No route points — see the previous test's own isolation rationale.
    const { rerender } = render(
      <MapView points={[]} mapFactory={mock.factory} cameraTarget={target} />,
    );
    mock.triggerLoad();
    expect(mock.resizeSpy).toHaveBeenCalledOnce();
    expect(mock.setCameraSpy).toHaveBeenCalledOnce();

    // The actual re-press-Follow scenario: byte-identical values, only a
    // fresh requestId (see CameraTarget's own doc comment) — still a
    // genuine re-application, so resize() must fire again too, not just
    // on the first application.
    rerender(
      <MapView
        points={[]}
        mapFactory={mock.factory}
        cameraTarget={{ ...target, requestId: "request-2" }}
      />,
    );

    expect(mock.resizeSpy).toHaveBeenCalledTimes(2);
    expect(mock.setCameraSpy).toHaveBeenCalledTimes(2);
    // Compare the SECOND call's own order for each spy (index 1) — proves
    // resize() precedes setCamera on the re-application too, not just the
    // first.
    expect(nthCallOrder(mock.resizeSpy, 1)).toBeLessThan(
      nthCallOrder(mock.setCameraSpy, 1),
    );
  });

  it("applies a non-animated (restore) cameraTarget via setCamera", () => {
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        cameraTarget={{
          coordinate: [0.002, 51.002],
          zoom: 14,
          bearingDegrees: 200,
          pitchDegrees: 10,
          animate: false,
          followOffset: false,
        }}
      />,
    );

    mock.triggerLoad();

    expect(mock.setCameraSpy).toHaveBeenCalledWith([0.002, 51.002], 14, 200, 10, {
      animate: false,
      followOffset: false,
    });
  });

  it("applies an orientation-only (north-up) cameraTarget with a null centre/zoom", () => {
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        cameraTarget={{
          coordinate: null,
          zoom: null,
          bearingDegrees: 0,
          pitchDegrees: 0,
          animate: true,
          followOffset: false,
        }}
      />,
    );

    mock.triggerLoad();

    expect(mock.setCameraSpy).toHaveBeenCalledWith(null, null, 0, 0, {
      animate: true,
      followOffset: false,
    });
  });

  it("does not re-apply a cameraTarget whose values are unchanged, even as a new object", () => {
    const mock = createMockMapFactory();
    const target = {
      coordinate: [0, 51] as Coordinate,
      zoom: 16,
      bearingDegrees: 90,
      pitchDegrees: 35,
      animate: true,
      followOffset: true,
    };
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} cameraTarget={target} />,
    );
    mock.triggerLoad();
    expect(mock.setCameraSpy).toHaveBeenCalledOnce();

    rerender(
      <MapView points={points} mapFactory={mock.factory} cameraTarget={{ ...target }} />,
    );

    expect(mock.setCameraSpy).toHaveBeenCalledOnce();
  });

  it("applies a new cameraTarget again once only the bearing genuinely changes", () => {
    const mock = createMockMapFactory();
    const target = {
      coordinate: [0, 51] as Coordinate,
      zoom: 16,
      bearingDegrees: 90,
      pitchDegrees: 35,
      animate: true,
      followOffset: true,
    };
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} cameraTarget={target} />,
    );
    mock.triggerLoad();
    expect(mock.setCameraSpy).toHaveBeenCalledOnce();

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        cameraTarget={{ ...target, bearingDegrees: 95 }}
      />,
    );

    expect(mock.setCameraSpy).toHaveBeenCalledTimes(2);
  });

  it("applies a new cameraTarget again once its position genuinely changes", () => {
    const mock = createMockMapFactory();
    const target = {
      coordinate: [0, 51] as Coordinate,
      zoom: 16,
      bearingDegrees: 90,
      pitchDegrees: 35,
      animate: true,
      followOffset: true,
    };
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} cameraTarget={target} />,
    );
    mock.triggerLoad();
    expect(mock.setCameraSpy).toHaveBeenCalledOnce();

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        cameraTarget={{ ...target, coordinate: [0.001, 51.001] }}
      />,
    );

    expect(mock.setCameraSpy).toHaveBeenCalledTimes(2);
  });

  it("still applies a live cameraTarget once the fallback style becomes ready", () => {
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        cameraTarget={{
          coordinate: [0, 51],
          zoom: 16,
          bearingDegrees: 90,
          pitchDegrees: 35,
          animate: true,
          followOffset: true,
        }}
      />,
    );

    // Primary style never loads — falls back before ever reaching ready.
    mock.triggerError({
      message: "style fetch failed",
      category: "style-request-or-parse",
    });
    expect(mock.setCameraSpy).not.toHaveBeenCalled();

    mock.triggerLoad();

    expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
    expect(mock.setCameraSpy).toHaveBeenCalledWith([0, 51], 16, 90, 35, {
      animate: true,
      followOffset: true,
    });
  });

  it("re-applies setCamera on a second cameraTarget request even though the payload is byte-identical, when it carries a new requestId — the Riding Northwards/Follow-location-pressed-twice regression", () => {
    const mock = createMockMapFactory();
    const target = {
      coordinate: null,
      zoom: null,
      bearingDegrees: 0,
      pitchDegrees: 0,
      animate: true,
      followOffset: false,
      requestId: "request-1",
    };
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} cameraTarget={target} />,
    );
    mock.triggerLoad();
    expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);
    expect(mock.setCameraSpy).toHaveBeenNthCalledWith(1, null, null, 0, 0, {
      animate: true,
      followOffset: false,
    });

    // Simulates the rider manually rotating/tilting away between the two
    // presses — a real gesture updates onCameraSettled state but never
    // touches lastAppliedCameraTargetRef, unlike a genuinely new
    // cameraTarget object with unchanged values, which the pre-fix
    // value-only dedup would otherwise silently swallow.
    mock.triggerUserCameraInteraction();
    mock.triggerCameraSettled({
      coordinate: [0, 51],
      zoom: 14.35,
      bearingDegrees: 67,
      pitchDegrees: 31,
    });

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        cameraTarget={{ ...target, requestId: "request-2" }}
      />,
    );

    expect(mock.setCameraSpy).toHaveBeenCalledTimes(2);
    expect(mock.setCameraSpy).toHaveBeenNthCalledWith(2, null, null, 0, 0, {
      animate: true,
      followOffset: false,
    });
  });

  it("does not re-apply a cameraTarget with the same requestId, even as a new object", () => {
    const mock = createMockMapFactory();
    const target = {
      coordinate: [0, 51] as Coordinate,
      zoom: 16,
      bearingDegrees: 90,
      pitchDegrees: 35,
      animate: true,
      followOffset: true,
      requestId: "request-1",
    };
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} cameraTarget={target} />,
    );
    mock.triggerLoad();
    expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);

    rerender(
      <MapView points={points} mapFactory={mock.factory} cameraTarget={{ ...target }} />,
    );

    expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-apply an automatic (no requestId) cameraTarget whose values match a just-applied explicit (requestId-bearing) one", () => {
    const mock = createMockMapFactory();
    const explicitTarget = {
      coordinate: [0, 51] as Coordinate,
      zoom: 16,
      bearingDegrees: 90,
      pitchDegrees: 35,
      animate: true,
      followOffset: true,
      requestId: "request-1",
    };
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} cameraTarget={explicitTarget} />,
    );
    mock.triggerLoad();
    expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);

    // A subsequent automatic fresh-fix target with matching values but no
    // requestId at all — must stay deduped by value, not spuriously
    // reapply just because an explicit request with the same values
    // preceded it.
    const automaticTarget = {
      coordinate: explicitTarget.coordinate,
      zoom: explicitTarget.zoom,
      bearingDegrees: explicitTarget.bearingDegrees,
      pitchDegrees: explicitTarget.pitchDegrees,
      animate: explicitTarget.animate,
      followOffset: explicitTarget.followOffset,
    };
    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        cameraTarget={automaticTarget}
      />,
    );

    expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);
  });

  it("applies a boundsTarget via fitBounds once ready", () => {
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        boundsTarget={{
          bounds: { southWest: [-1.7, 53.6], northEast: [-1.3, 54.0] },
          requestId: "request-1",
        }}
      />,
    );

    mock.triggerLoad();

    expect(mock.fitBoundsSpy).toHaveBeenCalledWith({
      southWest: [-1.7, 53.6],
      northEast: [-1.3, 54.0],
    });
  });

  it("resizes the map before fitting a boundsTarget's bounds", () => {
    const mock = createMockMapFactory();
    // No route points: isolates resize/fitBounds calls to the boundsTarget
    // effect alone, rather than also counting the route-overview fit's own
    // resize-then-fitBounds pair.
    render(
      <MapView
        points={[]}
        mapFactory={mock.factory}
        boundsTarget={{
          bounds: { southWest: [-1.7, 53.6], northEast: [-1.3, 54.0] },
          requestId: "request-1",
        }}
      />,
    );

    mock.triggerLoad();

    expect(mock.resizeSpy).toHaveBeenCalledOnce();
    expect(mock.fitBoundsSpy).toHaveBeenCalledOnce();
    expect(firstCallOrder(mock.resizeSpy)).toBeLessThan(
      firstCallOrder(mock.fitBoundsSpy),
    );
  });

  it("does not re-apply a boundsTarget with the same requestId, even as a new object", () => {
    const mock = createMockMapFactory();
    const boundsTarget = {
      bounds: {
        southWest: [-1.7, 53.6] as Coordinate,
        northEast: [-1.3, 54.0] as Coordinate,
      },
      requestId: "request-1",
    };
    const { rerender } = render(
      <MapView points={[]} mapFactory={mock.factory} boundsTarget={boundsTarget} />,
    );
    mock.triggerLoad();
    expect(mock.fitBoundsSpy).toHaveBeenCalledTimes(1);

    rerender(
      <MapView
        points={[]}
        mapFactory={mock.factory}
        boundsTarget={{ ...boundsTarget }}
      />,
    );

    expect(mock.fitBoundsSpy).toHaveBeenCalledTimes(1);
  });

  it("re-applies a boundsTarget when only requestId changes, even with identical bounds values", () => {
    const mock = createMockMapFactory();
    const bounds = {
      southWest: [-1.7, 53.6] as Coordinate,
      northEast: [-1.3, 54.0] as Coordinate,
    };
    const { rerender } = render(
      <MapView
        points={[]}
        mapFactory={mock.factory}
        boundsTarget={{ bounds, requestId: "request-1" }}
      />,
    );
    mock.triggerLoad();
    expect(mock.fitBoundsSpy).toHaveBeenCalledTimes(1);

    rerender(
      <MapView
        points={[]}
        mapFactory={mock.factory}
        boundsTarget={{ bounds, requestId: "request-2" }}
      />,
    );

    expect(mock.fitBoundsSpy).toHaveBeenCalledTimes(2);
  });

  it("applies a centreTarget via centreOn once ready", () => {
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        centreTarget={{ coordinate: [-1.5, 53.8], requestId: "request-1" }}
      />,
    );

    mock.triggerLoad();

    expect(mock.centreOnSpy).toHaveBeenCalledWith([-1.5, 53.8], { animate: true });
  });

  it("does not re-apply a centreTarget with the same requestId, even as a new object", () => {
    const mock = createMockMapFactory();
    const centreTarget = {
      coordinate: [-1.5, 53.8] as Coordinate,
      requestId: "request-1",
    };
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} centreTarget={centreTarget} />,
    );
    mock.triggerLoad();
    expect(mock.centreOnSpy).toHaveBeenCalledTimes(1);

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        centreTarget={{ ...centreTarget }}
      />,
    );

    expect(mock.centreOnSpy).toHaveBeenCalledTimes(1);
  });

  it("re-applies a centreTarget when only requestId changes, even with an identical coordinate", () => {
    const mock = createMockMapFactory();
    const coordinate: Coordinate = [-1.5, 53.8];
    const { rerender } = render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        centreTarget={{ coordinate, requestId: "request-1" }}
      />,
    );
    mock.triggerLoad();
    expect(mock.centreOnSpy).toHaveBeenCalledTimes(1);

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        centreTarget={{ coordinate, requestId: "request-2" }}
      />,
    );

    expect(mock.centreOnSpy).toHaveBeenCalledTimes(2);
  });

  it("applies an orientNorthTarget via the existing setCamera reset once ready", () => {
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        orientNorthTarget={{ requestId: "request-1" }}
      />,
    );

    mock.triggerLoad();

    expect(mock.setCameraSpy).toHaveBeenCalledWith(null, null, 0, 0, {
      animate: true,
      followOffset: false,
    });
  });

  it("does not re-apply an orientNorthTarget with the same requestId, even as a new object", () => {
    const mock = createMockMapFactory();
    const { rerender } = render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        orientNorthTarget={{ requestId: "request-1" }}
      />,
    );
    mock.triggerLoad();
    expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        orientNorthTarget={{ requestId: "request-1" }}
      />,
    );

    expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);
  });

  it("re-applies setCamera on a second orientNorthTarget request even though the payload is byte-identical — the Northwards-pressed-twice regression", () => {
    const mock = createMockMapFactory();
    const { rerender } = render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        orientNorthTarget={{ requestId: "request-1" }}
      />,
    );
    mock.triggerLoad();
    expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);
    expect(mock.setCameraSpy).toHaveBeenNthCalledWith(1, null, null, 0, 0, {
      animate: true,
      followOffset: false,
    });

    // Simulates the rider manually rotating away from north between the
    // two presses — a real gesture updates onCameraSettled state but never
    // touches the requestId-dedup ref, unlike the shared cameraTarget
    // pipeline's value-based dedup, which this second, differently-
    // requestId'd command must NOT be swallowed by.
    mock.triggerUserCameraInteraction();
    mock.triggerCameraSettled({
      coordinate: [0, 51],
      zoom: 14,
      bearingDegrees: 45,
      pitchDegrees: 0,
    });

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        orientNorthTarget={{ requestId: "request-2" }}
      />,
    );

    expect(mock.setCameraSpy).toHaveBeenCalledTimes(2);
    expect(mock.setCameraSpy).toHaveBeenNthCalledWith(2, null, null, 0, 0, {
      animate: true,
      followOffset: false,
    });
  });

  it("applies a zoomTarget via changeZoomBy once ready", () => {
    const mock = createMockMapFactory();
    render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        zoomTarget={{ delta: 1, requestId: "request-1" }}
      />,
    );

    mock.triggerLoad();

    expect(mock.changeZoomBySpy).toHaveBeenCalledWith(1);
  });

  it("does not re-apply a zoomTarget with the same requestId, even as a new object", () => {
    const mock = createMockMapFactory();
    const zoomTarget = { delta: 1, requestId: "request-1" };
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} zoomTarget={zoomTarget} />,
    );
    mock.triggerLoad();
    expect(mock.changeZoomBySpy).toHaveBeenCalledTimes(1);

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        zoomTarget={{ ...zoomTarget }}
      />,
    );

    expect(mock.changeZoomBySpy).toHaveBeenCalledTimes(1);
  });

  it("re-applies changeZoomBy on a second zoomTarget request even with an identical delta — two consecutive Zoom-in presses", () => {
    const mock = createMockMapFactory();
    const { rerender } = render(
      <MapView
        points={points}
        mapFactory={mock.factory}
        zoomTarget={{ delta: 1, requestId: "request-1" }}
      />,
    );
    mock.triggerLoad();
    expect(mock.changeZoomBySpy).toHaveBeenCalledTimes(1);

    rerender(
      <MapView
        points={points}
        mapFactory={mock.factory}
        zoomTarget={{ delta: 1, requestId: "request-2" }}
      />,
    );

    expect(mock.changeZoomBySpy).toHaveBeenCalledTimes(2);
    expect(mock.changeZoomBySpy).toHaveBeenNthCalledWith(1, 1);
    expect(mock.changeZoomBySpy).toHaveBeenNthCalledWith(2, 1);
  });

  describe("follow-anchor diagnostic (backlog item 65)", () => {
    it("populates data-camera-follow-anchor-x/-y from project(currentPosition) once the camera settles", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          currentPosition={[1.5, 51.5]}
          suppressInitialOverviewFit
        />,
      );
      mock.triggerLoad();

      mock.triggerCameraSettled({
        coordinate: [-1.1, 52.2],
        zoom: 12,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(mock.projectSpy).toHaveBeenCalledWith([1.5, 51.5]);
      const container = screen.getByTestId("map-container");
      expect(container).toHaveAttribute("data-camera-follow-anchor-x", "150");
      expect(container).toHaveAttribute("data-camera-follow-anchor-y", "5150");
    });

    it("stays empty when currentPosition is absent", () => {
      const mock = createMockMapFactory();
      render(
        <MapView points={points} mapFactory={mock.factory} suppressInitialOverviewFit />,
      );
      mock.triggerLoad();

      mock.triggerCameraSettled({
        coordinate: [-1.1, 52.2],
        zoom: 12,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(mock.projectSpy).not.toHaveBeenCalled();
      const container = screen.getByTestId("map-container");
      expect(container).toHaveAttribute("data-camera-follow-anchor-x", "");
      expect(container).toHaveAttribute("data-camera-follow-anchor-y", "");
    });

    it("recomputes on a later settle, reflecting a changed currentPosition prop", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          currentPosition={[1.5, 51.5]}
          suppressInitialOverviewFit
        />,
      );
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [-1.1, 52.2],
        zoom: 12,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      const container = screen.getByTestId("map-container");
      expect(container).toHaveAttribute("data-camera-follow-anchor-x", "150");

      rerender(
        <MapView
          points={points}
          mapFactory={mock.factory}
          currentPosition={[2, 51.5]}
          suppressInitialOverviewFit
        />,
      );
      mock.triggerCameraSettled({
        coordinate: [-1.2, 52.3],
        zoom: 13,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(container).toHaveAttribute("data-camera-follow-anchor-x", "200");
    });
  });

  it("sets the route coordinate-count once real, non-empty route data is submitted", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerLoad();

    expect(screen.getByTestId("map-container")).toHaveAttribute(
      "data-route-coordinate-count",
      "2",
    );
  });

  it("only marks the route as loaded once the source itself reports isSourceLoaded", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);
    mock.triggerLoad();

    const container = screen.getByTestId("map-container");
    expect(container).toHaveAttribute("data-route-loaded", "false");

    // A different source finishing doesn't count.
    mock.triggerSourceData({ sourceId: "acn-position", isSourceLoaded: true });
    expect(container).toHaveAttribute("data-route-loaded", "false");

    // Not-yet-loaded events for the right source don't count either.
    mock.triggerSourceData({ sourceId: "acn-route-remaining", isSourceLoaded: false });
    expect(container).toHaveAttribute("data-route-loaded", "false");

    mock.triggerSourceData({ sourceId: "acn-route-remaining", isSourceLoaded: true });
    expect(container).toHaveAttribute("data-route-loaded", "true");
  });

  it("logs a diagnostic error if the route source never reports finishing loading", () => {
    vi.useFakeTimers();
    try {
      clearErrorLog();
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      const [latest] = getRecentErrors();
      expect(latest?.context).toBe("map");
      expect(latest?.message).toContain("Route data did not finish loading");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not log a diagnostic error once the route source reports loaded before the timeout", () => {
    vi.useFakeTimers();
    try {
      clearErrorLog();
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();
      mock.triggerSourceData({ sourceId: "acn-route-remaining", isSourceLoaded: true });

      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      expect(getRecentErrors()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resizes the map before fitting bounds, so stale container dimensions don't skew the fit", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerLoad();

    expect(firstCallOrder(mock.resizeSpy)).toBeLessThan(
      firstCallOrder(mock.fitBoundsSpy),
    );
  });

  it("does not re-fit bounds on a position-only update", () => {
    const mock = createMockMapFactory();
    const { rerender } = render(<MapView points={points} mapFactory={mock.factory} />);
    mock.triggerLoad();
    expect(mock.fitBoundsSpy).toHaveBeenCalledOnce();

    rerender(
      <MapView
        points={points}
        currentPosition={[0.0005, 51]}
        mapFactory={mock.factory}
      />,
    );

    expect(mock.fitBoundsSpy).toHaveBeenCalledOnce();
  });

  it("shows an explicit, compact, non-technical tiles-unavailable banner with a working Retry on a map error, keeping the route layer, while the raw message still reaches the error log", () => {
    clearErrorLog();
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);
    mock.triggerLoad();

    expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();

    mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });

    const banner = screen.getByTestId("tiles-unavailable-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(
      "Map imagery unavailable. The route and your position are still shown.",
    );
    expect(banner).not.toHaveTextContent("tile fetch failed");
    expect(mock.sources.has("acn-route-remaining")).toBe(true);
    expect(
      getRecentErrors().some((entry) => entry.message.includes("tile fetch failed")),
    ).toBe(true);

    expect(within(banner).getByTestId("retry-map-imagery-button")).toBeInTheDocument();
  });

  it("removes the map instance on unmount", () => {
    const mock = createMockMapFactory();
    const { unmount } = render(<MapView points={points} mapFactory={mock.factory} />);
    mock.triggerLoad();

    unmount();

    expect(mock.removeSpy).toHaveBeenCalledOnce();
  });

  it("updates the route source when points change after the map is ready", () => {
    const mock = createMockMapFactory();
    const { rerender } = render(<MapView points={points} mapFactory={mock.factory} />);
    mock.triggerLoad();

    const morePoints: RoutePoint[] = [
      ...points,
      { coordinate: [0.002, 51.001], elevationMetres: 14, distanceFromStartMetres: 200 },
    ];
    rerender(<MapView points={morePoints} mapFactory={mock.factory} />);

    const routeSource = mock.sources.get("acn-route-remaining");
    expect(routeSource?.features[0]?.geometry).toMatchObject({
      coordinates: [
        [0, 51],
        [0.001, 51],
        [0.002, 51.001],
      ],
    });
  });

  it("does not re-fit bounds when points change while suppressInitialOverviewFit is true", () => {
    const mock = createMockMapFactory();
    const { rerender } = render(
      <MapView points={points} mapFactory={mock.factory} suppressInitialOverviewFit />,
    );
    mock.triggerLoad();
    expect(mock.fitBoundsSpy).not.toHaveBeenCalled();

    const morePoints: RoutePoint[] = [
      ...points,
      { coordinate: [0.002, 51.001], elevationMetres: 14, distanceFromStartMetres: 200 },
    ];
    rerender(
      <MapView
        points={morePoints}
        mapFactory={mock.factory}
        suppressInitialOverviewFit
      />,
    );

    expect(mock.fitBoundsSpy).not.toHaveBeenCalled();
  });

  describe("planningOverlay", () => {
    it("calls setMarkers with no markers when the prop is absent, exactly like Riding mode today", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.setMarkersSpy).toHaveBeenCalledWith([]);
      expect(mock.sources.get("acn-planning-preview")?.features).toEqual([]);
    });

    it("renders waypoint markers via setMarkers, marking the selected one", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [
              { id: "a", coordinate: [0, 51] },
              { id: "b", coordinate: [0.001, 51] },
            ],
            previewCoordinates: [],
            selectedWaypointIndex: 1,
            onMapTap: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      expect(mock.setMarkersSpy).toHaveBeenCalledWith([
        {
          id: "a",
          coordinate: [0, 51],
          label: "1",
          role: "start",
          selected: false,
          ariaLabel: "Start waypoint 1",
        },
        {
          id: "b",
          coordinate: [0.001, 51],
          label: "2",
          role: "finish",
          selected: true,
          ariaLabel: "Finish waypoint 2",
        },
      ]);
    });

    it("suppresses the generic route start/finish markers so they never duplicate Planning's own waypoint markers", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [
              { id: "a", coordinate: [0, 51] },
              { id: "b", coordinate: [0.001, 51] },
            ],
            previewCoordinates: [],
            selectedWaypointIndex: null,
            onMapTap: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      expect(mock.sources.get("acn-route-start")?.features).toEqual([]);
      expect(mock.sources.get("acn-route-finish")?.features).toEqual([]);
    });

    it("renders the unrouted preview as a dashed line, distinct from the solid route layers", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [],
            previewCoordinates: [
              [0, 51],
              [0.001, 51],
            ],
            selectedWaypointIndex: null,
            onMapTap: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      expect(mock.sources.get("acn-planning-preview")?.features).toHaveLength(1);
      const calls = mock.addLineLayerSpy.mock.calls as [
        string,
        string,
        { lineDasharray?: number[] },
      ][];
      const previewCall = calls.find(([id]) => id === "acn-planning-preview-line");
      expect(previewCall?.[2].lineDasharray).toBeDefined();
      const routeCall = calls.find(([id]) => id === "acn-route-remaining-line");
      expect(routeCall?.[2].lineDasharray).toBeUndefined();
    });

    it("forwards a map tap as a coordinate to planningOverlay.onMapTap", () => {
      const mock = createMockMapFactory();
      const onMapTap = vi.fn();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [],
            previewCoordinates: [],
            selectedWaypointIndex: null,
            onMapTap,
          }}
        />,
      );
      mock.triggerLoad();

      mock.triggerMapTap([1.5, 52.5]);

      expect(onMapTap).toHaveBeenCalledWith([1.5, 52.5]);
    });

    it("never forwards a map tap when planningOverlay is absent (Riding mode)", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      // Should not throw with no onMapTap configured.
      expect(() => {
        mock.triggerMapTap([1.5, 52.5]);
      }).not.toThrow();
    });
  });

  describe("recoverable errors, staged readiness, and retry", () => {
    it("does not activate fallback for a single recoverable resource error once the style is ready", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerStyleLoaded();
      mock.triggerError({ message: "a tile failed", category: "source-or-tile" });

      expect(mock.constructedStyles).toHaveLength(1);
      expect(screen.queryByTestId("map-fallback-banner")).toBeNull();
    });

    it("keeps real imagery after a later successful load, following a recoverable error", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerStyleLoaded();
      mock.triggerError({ message: "a tile failed", category: "source-or-tile" });
      mock.triggerLoad();

      expect(mock.constructedStyles).toHaveLength(1);
      expect(screen.queryByTestId("map-fallback-banner")).toBeNull();
      const [latest] = getRecentMapAttempts();
      expect(latest?.category).toBe("imagery-recovered");
    });

    it("populates route, position and start/finish data on style-ready alone, before full imagery loads", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          currentPosition={[0.0005, 51]}
          mapFactory={mock.factory}
        />,
      );

      mock.triggerStyleLoaded();

      expect(
        mock.sources.get("acn-route-remaining")?.features[0]?.geometry,
      ).toMatchObject({
        coordinates: [
          [0, 51],
          [0.001, 51],
        ],
      });
      expect(mock.sources.get("acn-route-start")?.features[0]?.geometry).toEqual({
        type: "Point",
        coordinates: [0, 51],
      });
      expect(mock.sources.get("acn-position")?.features[0]?.geometry).toEqual({
        type: "Point",
        coordinates: [0.0005, 51],
      });
      expect(mock.fitBoundsSpy).toHaveBeenCalled();
      expect(screen.getByTestId("map-container")).toHaveAttribute(
        "data-route-coordinate-count",
        "2",
      );
      expect(screen.getByTestId("map-imagery-delayed-banner")).toBeInTheDocument();
      expect(screen.queryByTestId("map-loading")).toBeNull();
    });

    it("applies a live cameraTarget on style-ready alone, before full imagery loads", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          cameraTarget={{
            coordinate: [0, 51],
            zoom: 16,
            bearingDegrees: 90,
            pitchDegrees: 35,
            animate: true,
            followOffset: true,
          }}
        />,
      );

      mock.triggerStyleLoaded();

      expect(mock.setCameraSpy).toHaveBeenCalledWith([0, 51], 16, 90, 35, {
        animate: true,
        followOffset: true,
      });
    });

    it("populates Planning-overlay waypoints and preview data on style-ready alone", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [
              { id: "a", coordinate: [0, 51] },
              { id: "b", coordinate: [0.001, 51] },
            ],
            previewCoordinates: [
              [0, 51],
              [0.001, 51],
            ],
            selectedWaypointIndex: 1,
            onMapTap: vi.fn(),
          }}
        />,
      );

      mock.triggerStyleLoaded();

      expect(mock.setMarkersSpy).toHaveBeenCalledWith([
        expect.objectContaining({ id: "a", role: "start" }),
        expect.objectContaining({ id: "b", role: "finish", selected: true }),
      ]);
      expect(mock.sources.get("acn-planning-preview")?.features).toHaveLength(1);
    });

    it("clears the tiles-unavailable banner once the external basemap's own source reports loaded", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
      expect(screen.getByTestId("tiles-unavailable-banner")).toBeInTheDocument();

      // "openmaptiles" represents the base style's own vector tile source —
      // not one of this app's GeoJSON sources.
      mock.triggerSourceData({ sourceId: "openmaptiles", isSourceLoaded: true });

      expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();
    });

    it("does not clear the tiles-unavailable banner when only an app-owned source reports loaded", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
      expect(screen.getByTestId("tiles-unavailable-banner")).toBeInTheDocument();

      // Our own route/position sources report loaded almost immediately —
      // that must never be mistaken for the external basemap recovering.
      mock.triggerSourceData({ sourceId: "acn-route-remaining", isSourceLoaded: true });
      expect(screen.getByTestId("tiles-unavailable-banner")).toBeInTheDocument();

      mock.triggerSourceData({ sourceId: "acn-position", isSourceLoaded: true });
      expect(screen.getByTestId("tiles-unavailable-banner")).toBeInTheDocument();

      mock.triggerSourceData({ sourceId: "openmaptiles", isSourceLoaded: true });
      expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();
    });

    it('clicking "Retry map imagery" recreates the originally configured style, not the fallback', () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      expect(mock.constructedStyles).toHaveLength(2);

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });

      expect(mock.constructedStyles).toHaveLength(3);
      expect(mock.constructedStyles[2]).toBe(mock.constructedStyles[0]);
    });

    it("retry preserves and re-applies a live cameraTarget", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          cameraTarget={{
            coordinate: [0, 51],
            zoom: 16,
            bearingDegrees: 90,
            pitchDegrees: 35,
            animate: true,
            followOffset: true,
          }}
        />,
      );

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      mock.setCameraSpy.mockClear();

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });
      mock.triggerLoad();

      expect(mock.setCameraSpy).toHaveBeenCalledWith([0, 51], 16, 90, 35, {
        animate: true,
        followOffset: true,
      });
    });

    // Backlog item 66's own investigation, candidate ordering 8: a
    // fallback/retry instance swap landing in the narrow window where a
    // rider has tapped Start but no camera command exists yet (mirrors
    // RidingScreen's own "follow-requested" with freshCoordinate: null —
    // cameraTarget is still null, suppressInitialOverviewFit is still
    // false), with the real command arriving only once the swap has
    // settled. Unlike the sibling test above (an already-real
    // cameraTarget surviving a retry unchanged), this one proves a
    // null-then-real cameraTarget transition still lands correctly on
    // the surviving instance even when a fallback swap happens in
    // between — the overview effect correctly fires once (since
    // suppressInitialOverviewFit is still false when the fallback
    // instance's own style becomes ready), and the cameraTarget effect
    // correctly re-fires and applies once the real command arrives
    // afterwards, with lastAppliedCameraTargetRef having nothing stale
    // to wrongly dedupe against (it was never written to by the
    // overview fit, which is a completely separate mechanism).
    it("a fallback swap landing before the first real camera command still applies that command once it arrives", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          cameraTarget={null}
          suppressInitialOverviewFit={false}
        />,
      );

      // The original style fails before it ever becomes structurally
      // ready — switchToFallback() fires internally, without rerunning
      // the outer map-creation effect.
      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      expect(mock.constructedStyles).toHaveLength(2);

      // The fallback instance's own style becomes ready — still no real
      // camera command exists yet, so the overview fit correctly runs
      // once, against the fallback instance.
      mock.triggerLoad();
      expect(mock.resizeSpy).toHaveBeenCalledOnce();
      expect(mock.fitBoundsSpy).toHaveBeenCalledOnce();
      expect(mock.setCameraSpy).not.toHaveBeenCalled();

      // The real follow command finally arrives (mirrors the first
      // accepted GPS fix, arriving after the fallback swap has already
      // settled).
      rerender(
        <MapView
          points={points}
          mapFactory={mock.factory}
          cameraTarget={{
            coordinate: [0, 51],
            zoom: 16,
            bearingDegrees: 90,
            pitchDegrees: 35,
            animate: true,
            followOffset: true,
          }}
          suppressInitialOverviewFit={true}
        />,
      );

      expect(mock.setCameraSpy).toHaveBeenCalledOnce();
      expect(mock.setCameraSpy).toHaveBeenCalledWith([0, 51], 16, 90, 35, {
        animate: true,
        followOffset: true,
      });
      // No second, redundant overview fit — suppressInitialOverviewFit
      // was already true by the time the overview effect's own
      // dependencies changed again.
      expect(mock.fitBoundsSpy).toHaveBeenCalledOnce();
      expect(mock.resizeSpy).toHaveBeenCalledTimes(2);
      expect(nthCallOrder(mock.resizeSpy, 0)).toBeLessThan(
        firstCallOrder(mock.fitBoundsSpy),
      );
      expect(nthCallOrder(mock.resizeSpy, 1)).toBeLessThan(
        firstCallOrder(mock.setCameraSpy),
      );
      expect(firstCallOrder(mock.fitBoundsSpy)).toBeLessThan(
        firstCallOrder(mock.setCameraSpy),
      );
    });

    it("retry preserves and re-applies a still-current boundsTarget", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={[]}
          mapFactory={mock.factory}
          boundsTarget={{
            bounds: { southWest: [-1.7, 53.6], northEast: [-1.3, 54.0] },
            requestId: "request-1",
          }}
        />,
      );

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      mock.fitBoundsSpy.mockClear();

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });
      mock.triggerLoad();

      expect(mock.fitBoundsSpy).toHaveBeenCalledWith({
        southWest: [-1.7, 53.6],
        northEast: [-1.3, 54.0],
      });
    });

    it("retry preserves and re-applies a still-current centreTarget", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          centreTarget={{ coordinate: [-1.5, 53.8], requestId: "request-1" }}
        />,
      );

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      mock.centreOnSpy.mockClear();

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });
      mock.triggerLoad();

      expect(mock.centreOnSpy).toHaveBeenCalledWith([-1.5, 53.8], { animate: true });
    });

    it("retry preserves and re-applies a still-current orientNorthTarget", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          orientNorthTarget={{ requestId: "request-1" }}
        />,
      );

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      mock.setCameraSpy.mockClear();

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });
      mock.triggerLoad();

      expect(mock.setCameraSpy).toHaveBeenCalledWith(null, null, 0, 0, {
        animate: true,
        followOffset: false,
      });
    });

    it("retry preserves and re-applies a still-current zoomTarget", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          zoomTarget={{ delta: 1, requestId: "request-1" }}
        />,
      );

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      mock.changeZoomBySpy.mockClear();

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });
      mock.triggerLoad();

      expect(mock.changeZoomBySpy).toHaveBeenCalledWith(1);
    });

    it("retries at most once automatically when the browser goes online while fallback is active", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      expect(mock.constructedStyles).toHaveLength(2);

      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(mock.constructedStyles).toHaveLength(3);
    });

    it("does not create a retry loop from repeated errors on the fallback map itself", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(mock.constructedStyles).toHaveLength(2);

      mock.triggerError({ message: "another tile failed", category: "source-or-tile" });
      mock.triggerError({
        message: "yet another tile failed",
        category: "source-or-tile",
      });
      mock.triggerError({ message: "a sprite failed", category: "sprite" });

      expect(mock.constructedStyles).toHaveLength(2);
      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
    });

    describe("tile-error episode: retry, no-loop, and camera preservation (backlog item 67)", () => {
      it("triggers a genuine automatic retry for a post-load tile-error episode on an online event, with no camera-target prop mutation required", () => {
        const mock = createMockMapFactory();
        render(<MapView points={points} mapFactory={mock.factory} />);
        mock.triggerLoad();

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        expect(screen.getByTestId("tiles-unavailable-banner")).toBeInTheDocument();
        expect(mock.constructedStyles).toHaveLength(1);

        act(() => {
          window.dispatchEvent(new Event("online"));
        });

        expect(mock.constructedStyles).toHaveLength(2);
        expect(mock.constructedStyles[1]).toBe(mock.constructedStyles[0]);
        const [latest] = getRecentMapAttempts();
        expect(latest?.category).toBe("auto-retry");
      });

      it("retries at most once automatically for a tile-error episode, even with repeated online/visibility events and repeated errors within it", () => {
        const mock = createMockMapFactory();
        render(<MapView points={points} mapFactory={mock.factory} />);
        mock.triggerLoad();

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        mock.triggerError({
          message: "another tile fetch failed",
          category: "source-or-tile",
        });

        act(() => {
          window.dispatchEvent(new Event("online"));
        });
        act(() => {
          window.dispatchEvent(new Event("online"));
        });
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(mock.constructedStyles).toHaveLength(2);
      });

      it("a later, distinct tile-error episode (after a successful recovery) gets its own new automatic-retry allowance", () => {
        const mock = createMockMapFactory();
        render(<MapView points={points} mapFactory={mock.factory} />);
        mock.triggerLoad();

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        act(() => {
          window.dispatchEvent(new Event("online"));
        });
        expect(mock.constructedStyles).toHaveLength(2);

        // Recovery: the retried instance loads cleanly with no tile error.
        mock.triggerLoad();
        expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();

        // A distinct, later episode.
        mock.triggerError({
          message: "a different tile fetch failed",
          category: "source-or-tile",
        });
        expect(screen.getByTestId("tiles-unavailable-banner")).toBeInTheDocument();

        act(() => {
          window.dispatchEvent(new Event("online"));
        });

        expect(mock.constructedStyles).toHaveLength(3);
      });

      it('clicking "Retry map imagery" from the tiles-unavailable banner recreates the originally configured style, not the fallback', () => {
        const mock = createMockMapFactory();
        render(<MapView points={points} mapFactory={mock.factory} />);
        mock.triggerLoad();

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });

        expect(mock.constructedStyles).toHaveLength(2);
        expect(mock.constructedStyles[1]).toBe(mock.constructedStyles[0]);
      });

      it("records imagery-recovered once a tile-error episode is resolved via retry", () => {
        const mock = createMockMapFactory();
        render(<MapView points={points} mapFactory={mock.factory} />);
        mock.triggerLoad();

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        act(() => {
          screen
            .getByTestId("tiles-unavailable-banner")
            .querySelector<HTMLButtonElement>('[data-testid="retry-map-imagery-button"]')
            ?.click();
        });
        mock.triggerLoad();

        const [latest] = getRecentMapAttempts();
        expect(latest?.category).toBe("imagery-recovered");
      });

      it("preserves a manually free-panned camera (no cameraTarget) across a tile-error retry", () => {
        const mock = createMockMapFactory();
        render(<MapView points={points} mapFactory={mock.factory} />);
        mock.triggerLoad();

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-2.5, 52.1],
          zoom: 12,
          bearingDegrees: 45,
          pitchDegrees: 20,
        });

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        mock.setCameraSpy.mockClear();

        act(() => {
          screen
            .getByTestId("tiles-unavailable-banner")
            .querySelector<HTMLButtonElement>('[data-testid="retry-map-imagery-button"]')
            ?.click();
        });
        mock.triggerLoad();

        expect(mock.setCameraSpy).toHaveBeenCalledWith([-2.5, 52.1], 12, 45, 20, {
          animate: false,
          followOffset: false,
        });
      });

      // The following camera-preservation tests all use the tile-error
      // retry path (not the fatal/fallback path): switchToFallback()'s own
      // `if (styleReady || usedFallback) return;` guard means a fatal
      // error can only ever activate fallback strictly BEFORE the style
      // is structurally ready — which is exactly the window needed to
      // first let boundsTarget/centreTarget/orientNorthTarget/the
      // overview/warning-selection fits apply once. The lighter tile-
      // error path (reachable only once hasLoaded, i.e. after a full
      // triggerLoad()) has no such ordering conflict and directly
      // exercises this backlog item's own new retry mechanism.
      it("preserves a manually panned Planning camera by skipping a now-stale boundsTarget after a retry, rather than snapping back to it", () => {
        const mock = createMockMapFactory();
        render(
          <MapView
            points={[]}
            mapFactory={mock.factory}
            boundsTarget={{
              bounds: { southWest: [-1.7, 53.6], northEast: [-1.3, 54.0] },
              requestId: "request-1",
            }}
          />,
        );
        mock.triggerLoad();
        expect(mock.fitBoundsSpy).toHaveBeenCalledTimes(1);

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-1.55, 53.75],
          zoom: 13,
          bearingDegrees: 30,
          pitchDegrees: 10,
        });

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");
        mock.fitBoundsSpy.mockClear();
        mock.setCameraSpy.mockClear();

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });
        mock.triggerLoad();

        expect(mock.fitBoundsSpy).not.toHaveBeenCalled();
        expect(mock.setCameraSpy).toHaveBeenCalledWith([-1.55, 53.75], 13, 30, 10, {
          animate: false,
          followOffset: false,
        });
      });

      it("preserves a manually panned Planning camera by skipping a now-stale centreTarget after a retry", () => {
        const mock = createMockMapFactory();
        render(
          <MapView
            points={points}
            mapFactory={mock.factory}
            centreTarget={{ coordinate: [-1.5, 53.8], requestId: "request-1" }}
          />,
        );
        mock.triggerLoad();
        expect(mock.centreOnSpy).toHaveBeenCalledTimes(1);

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-1.55, 53.75],
          zoom: 13,
          bearingDegrees: 30,
          pitchDegrees: 10,
        });

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");
        mock.centreOnSpy.mockClear();
        mock.setCameraSpy.mockClear();

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });
        mock.triggerLoad();

        expect(mock.centreOnSpy).not.toHaveBeenCalled();
        expect(mock.setCameraSpy).toHaveBeenCalledWith([-1.55, 53.75], 13, 30, 10, {
          animate: false,
          followOffset: false,
        });
      });

      it("preserves a manually panned Planning camera by skipping a now-stale orientNorthTarget after a retry", () => {
        const mock = createMockMapFactory();
        render(
          <MapView
            points={points}
            mapFactory={mock.factory}
            orientNorthTarget={{ requestId: "request-1" }}
          />,
        );
        mock.triggerLoad();
        expect(mock.setCameraSpy).toHaveBeenCalledTimes(1);

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-1.55, 53.75],
          zoom: 13,
          bearingDegrees: 30,
          pitchDegrees: 10,
        });

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");
        mock.setCameraSpy.mockClear();

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });
        mock.triggerLoad();

        // The stale orientNorthTarget must not re-apply its own (null,
        // null, 0, 0, ...) command — only the diverged snapshot's own
        // values may appear.
        expect(mock.setCameraSpy).not.toHaveBeenCalledWith(null, null, 0, 0, {
          animate: true,
          followOffset: false,
        });
        expect(mock.setCameraSpy).toHaveBeenCalledWith([-1.55, 53.75], 13, 30, 10, {
          animate: false,
          followOffset: false,
        });
      });

      it("a zoomTarget press does not clear divergence — a later retry still restores the diverged snapshot rather than reapplying a stale boundsTarget", () => {
        const mock = createMockMapFactory();
        const { rerender } = render(
          <MapView
            points={[]}
            mapFactory={mock.factory}
            boundsTarget={{
              bounds: { southWest: [-1.7, 53.6], northEast: [-1.3, 54.0] },
              requestId: "request-1",
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-1.55, 53.75],
          zoom: 13,
          bearingDegrees: 30,
          pitchDegrees: 10,
        });

        // An entirely ordinary, unrelated zoom press.
        rerender(
          <MapView
            points={[]}
            mapFactory={mock.factory}
            boundsTarget={{
              bounds: { southWest: [-1.7, 53.6], northEast: [-1.3, 54.0] },
              requestId: "request-1",
            }}
            zoomTarget={{ delta: 1, requestId: "zoom-1" }}
          />,
        );
        expect(mock.changeZoomBySpy).toHaveBeenCalledWith(1);

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");
        mock.fitBoundsSpy.mockClear();
        mock.setCameraSpy.mockClear();

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });
        mock.triggerLoad();

        expect(mock.fitBoundsSpy).not.toHaveBeenCalled();
        expect(mock.setCameraSpy).toHaveBeenCalledWith([-1.55, 53.75], 13, 30, 10, {
          animate: false,
          followOffset: false,
        });
      });

      it("the overview-fit effect skips exactly once per generation after a diverged restore, then resumes normal behaviour for a later route change", () => {
        const mock = createMockMapFactory();
        const { rerender } = render(
          <MapView
            points={points}
            mapFactory={mock.factory}
            suppressInitialOverviewFit={false}
          />,
        );
        mock.triggerLoad();
        expect(mock.fitBoundsSpy).toHaveBeenCalledTimes(1);

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-2, 51.5],
          zoom: 10,
          bearingDegrees: 0,
          pitchDegrees: 0,
        });

        mock.fitBoundsSpy.mockClear();
        mock.setCameraSpy.mockClear();

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });
        mock.triggerLoad();

        // The overview-fit effect skipped its own fit for this generation
        // — the restored snapshot is the final word instead.
        expect(mock.fitBoundsSpy).not.toHaveBeenCalled();
        expect(mock.setCameraSpy).toHaveBeenCalledWith([-2, 51.5], 10, 0, 0, {
          animate: false,
          followOffset: false,
        });

        // A later, genuinely new route within the SAME generation resumes
        // completely normal overview-fit behaviour.
        mock.fitBoundsSpy.mockClear();
        const newPoints: RoutePoint[] = [
          { coordinate: [1, 52], elevationMetres: 5, distanceFromStartMetres: 0 },
          { coordinate: [1.001, 52], elevationMetres: 6, distanceFromStartMetres: 100 },
        ];
        rerender(
          <MapView
            points={newPoints}
            mapFactory={mock.factory}
            suppressInitialOverviewFit={false}
          />,
        );

        expect(mock.fitBoundsSpy).toHaveBeenCalledTimes(1);
      });

      it("the warning-selection auto-fit effect skips exactly once per generation after a diverged restore, then resumes normal behaviour for a later, genuinely new selection", () => {
        const warnings: RouteWarning[] = [
          {
            kind: "questionable-surface",
            startDistanceMetres: 50,
            endDistanceMetres: 150,
            message: "Questionable surface for a road bike.",
          },
          {
            kind: "ford",
            startDistanceMetres: 300,
            endDistanceMetres: 350,
            message: "Ford crossing.",
          },
        ];
        const mock = createMockMapFactory();
        const { rerender } = render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            // Isolates fitBoundsSpy to the warning-selection-fit effect's
            // own call — otherwise the overview-fit effect would also
            // fire once on initial mount (non-empty points, defaults to
            // unsuppressed), making the toHaveBeenCalledTimes(1) checks
            // below ambiguous about which effect actually fired.
            suppressInitialOverviewFit={true}
            warningOverlay={{
              warnings,
              selectedWarningIndex: 0,
              onSelectWarning: vi.fn(),
            }}
          />,
        );
        mock.triggerLoad();
        expect(mock.fitBoundsSpy).toHaveBeenCalledTimes(1);

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-2, 51.5],
          zoom: 10,
          bearingDegrees: 0,
          pitchDegrees: 0,
        });

        mock.fitBoundsSpy.mockClear();
        mock.setCameraSpy.mockClear();

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });
        mock.triggerLoad();

        // The stale warning-selection fit skipped for this generation —
        // the restored snapshot wins instead.
        expect(mock.fitBoundsSpy).not.toHaveBeenCalled();
        expect(mock.setCameraSpy).toHaveBeenCalledWith([-2, 51.5], 10, 0, 0, {
          animate: false,
          followOffset: false,
        });

        // A genuinely new selection within the SAME generation resumes
        // completely normal auto-fit behaviour.
        mock.fitBoundsSpy.mockClear();
        rerender(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            suppressInitialOverviewFit={true}
            warningOverlay={{
              warnings,
              selectedWarningIndex: 1,
              onSelectWarning: vi.fn(),
            }}
          />,
        );

        expect(mock.fitBoundsSpy).toHaveBeenCalledWith({
          southWest: [0.003, 51],
          northEast: [0.0035, 51],
        });
      });

      // A real, evidence-backed regression found via this backlog item's
      // own real-browser Planning coverage during implementation: a
      // gesture (pan), followed by orientNorthTarget/centreTarget/
      // cameraTarget's own null-coordinate north-up case, followed by a
      // retry, was silently discarding the rider's panned position — the
      // "partial" command (leaving coordinate/zoom "unchanged") had
      // incorrectly cleared hasCameraDivergedFromTargetsRef, suppressing
      // the snapshot restore even though the command itself never
      // supplied a real coordinate/zoom to fall back on for a freshly
      // (re)created instance with no prior state. The three tests below
      // pin this exact scenario at the unit level, not just via the
      // real-browser proof that originally caught it.
      it("a north-up press (orientNorthTarget) after a gesture does not suppress the diverged snapshot restore on a later retry", () => {
        const mock = createMockMapFactory();
        const { rerender } = render(
          <MapView points={points} mapFactory={mock.factory} orientNorthTarget={null} />,
        );
        mock.triggerLoad();

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-1.55, 53.75],
          zoom: 13,
          bearingDegrees: 30,
          pitchDegrees: 10,
        });

        // North-up, pressed after the gesture — settles with the SAME
        // coordinate/zoom (unchanged) but bearing/pitch reset to 0.
        rerender(
          <MapView
            points={points}
            mapFactory={mock.factory}
            orientNorthTarget={{ requestId: "request-1" }}
          />,
        );
        mock.triggerCameraSettled({
          coordinate: [-1.55, 53.75],
          zoom: 13,
          bearingDegrees: 0,
          pitchDegrees: 0,
        });

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        act(() => {
          screen
            .getByTestId("tiles-unavailable-banner")
            .querySelector<HTMLButtonElement>('[data-testid="retry-map-imagery-button"]')
            ?.click();
        });
        mock.setCameraSpy.mockClear();
        mock.triggerLoad();

        // Restores the full post-north-up pose — never a bare (null,
        // null, 0, 0, ...) reapply, which would leave a freshly created
        // instance's centre/zoom at whatever its own uninitialised
        // default is, not the rider's real panned position.
        expect(mock.setCameraSpy).toHaveBeenCalledWith([-1.55, 53.75], 13, 0, 0, {
          animate: false,
          followOffset: false,
        });
      });

      it("a recentre press (centreTarget) after a gesture does not suppress the diverged snapshot restore on a later retry", () => {
        const mock = createMockMapFactory();
        const { rerender } = render(
          <MapView points={points} mapFactory={mock.factory} centreTarget={null} />,
        );
        mock.triggerLoad();

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [-1.55, 53.75],
          zoom: 13,
          bearingDegrees: 30,
          pitchDegrees: 10,
        });

        rerender(
          <MapView
            points={points}
            mapFactory={mock.factory}
            centreTarget={{ coordinate: [-1.6, 53.8], requestId: "request-1" }}
          />,
        );
        mock.triggerCameraSettled({
          coordinate: [-1.6, 53.8],
          zoom: 13,
          bearingDegrees: 30,
          pitchDegrees: 10,
        });

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        act(() => {
          screen
            .getByTestId("tiles-unavailable-banner")
            .querySelector<HTMLButtonElement>('[data-testid="retry-map-imagery-button"]')
            ?.click();
        });
        mock.setCameraSpy.mockClear();
        mock.triggerLoad();

        expect(mock.setCameraSpy).toHaveBeenCalledWith([-1.6, 53.8], 13, 30, 10, {
          animate: false,
          followOffset: false,
        });
      });

      it("Riding's own north-up (a null-coordinate cameraTarget command) after a gesture does not suppress the diverged snapshot restore on a later retry", () => {
        const mock = createMockMapFactory();
        const { rerender } = render(
          <MapView points={points} mapFactory={mock.factory} cameraTarget={null} />,
        );
        mock.triggerLoad();

        mock.triggerUserCameraInteraction();
        mock.triggerCameraSettled({
          coordinate: [0, 51],
          zoom: 14,
          bearingDegrees: 67,
          pitchDegrees: 20,
        });

        // Mirrors rideCamera.ts's own "north-up-requested" command shape
        // exactly: a null coordinate/zoom, only bearing/pitch specified.
        rerender(
          <MapView
            points={points}
            mapFactory={mock.factory}
            cameraTarget={{
              coordinate: null,
              zoom: null,
              bearingDegrees: 0,
              pitchDegrees: 0,
              animate: true,
              followOffset: false,
              requestId: "north-up-1",
            }}
          />,
        );
        mock.triggerCameraSettled({
          coordinate: [0, 51],
          zoom: 14,
          bearingDegrees: 0,
          pitchDegrees: 0,
        });

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        act(() => {
          screen
            .getByTestId("tiles-unavailable-banner")
            .querySelector<HTMLButtonElement>('[data-testid="retry-map-imagery-button"]')
            ?.click();
        });
        mock.setCameraSpy.mockClear();
        mock.triggerLoad();

        expect(mock.setCameraSpy).toHaveBeenCalledWith([0, 51], 14, 0, 0, {
          animate: false,
          followOffset: false,
        });
      });

      it("layer/source counts after a retry match a fresh mount's, proving no duplicate accumulation", () => {
        const mock = createMockMapFactory();
        render(<MapView points={points} mapFactory={mock.factory} />);
        mock.triggerLoad();
        const layerCountAfterMount = mock.layers.size;
        const sourceCountAfterMount = mock.sources.size;

        // A tile error after the map has genuinely already loaded once —
        // the lighter, tile-error-specific retry path this backlog item
        // adds, not the pre-existing fallback/retry mechanism.
        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });
        mock.triggerLoad();

        expect(mock.layers.size).toBe(layerCountAfterMount);
        expect(mock.sources.size).toBe(sourceCountAfterMount);
      });

      it("reinstalls real route and position source data after a tile-error retry, not just empty layers", () => {
        const mock = createMockMapFactory();
        render(
          <MapView
            points={points}
            currentPosition={[0.0005, 51]}
            mapFactory={mock.factory}
          />,
        );
        mock.triggerLoad();
        expect(mock.sources.get("acn-position")?.features[0]?.geometry).toEqual({
          type: "Point",
          coordinates: [0.0005, 51],
        });

        mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });
        const banner = screen.getByTestId("tiles-unavailable-banner");

        act(() => {
          within(banner).getByTestId("retry-map-imagery-button").click();
        });
        mock.triggerLoad();

        expect(mock.sources.get("acn-position")?.features[0]?.geometry).toEqual({
          type: "Point",
          coordinates: [0.0005, 51],
        });
        expect(
          mock.sources.get("acn-route-remaining")?.features[0]?.geometry,
        ).toMatchObject({
          coordinates: [
            [0, 51],
            [0.001, 51],
          ],
        });
      });
    });
  });

  describe("direction arrow overlay", () => {
    it("registers the arrow icon and a symbol layer above the route lines, warning/selected and gradient layers, and below every position/marker layer", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.images.has("acn-route-arrow")).toBe(true);
      expect(mock.layers.has("acn-route-arrows")).toBe(true);

      const order = Array.from(mock.layers);
      const arrowIndex = order.indexOf("acn-route-arrows");
      expect(arrowIndex).toBeGreaterThan(order.indexOf("acn-route-remaining-line"));
      expect(arrowIndex).toBeGreaterThan(order.indexOf("acn-route-completed-line"));
      // Arrows now paint above the whole warning/gradient stack (a
      // deliberate reordering — see addRouteAndPositionLayers), so they
      // stay visible over whatever colours/patterns the route carries.
      expect(arrowIndex).toBeGreaterThan(
        order.indexOf("acn-warning-unknown-surface-line"),
      );
      expect(arrowIndex).toBeGreaterThan(order.indexOf("acn-warning-selected-line"));
      expect(arrowIndex).toBeGreaterThan(order.indexOf("acn-route-gradient-line"));
      expect(arrowIndex).toBeLessThan(order.indexOf("acn-position-marker"));
      expect(arrowIndex).toBeLessThan(order.indexOf("acn-start-marker"));
      expect(arrowIndex).toBeLessThan(order.indexOf("acn-finish-marker"));
    });

    it("sources the arrow layer from the remaining-route source with the chosen spacing", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.addSymbolLayerSpy).toHaveBeenCalledWith(
        "acn-route-arrows",
        "acn-route-remaining",
        "acn-route-arrow",
        { spacingPixels: 140 },
      );
    });

    it("never sources arrows from the Planning dashed unrouted preview", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={[]}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [],
            previewCoordinates: [
              [0, 51],
              [0.001, 51],
            ],
            selectedWaypointIndex: null,
            onMapTap: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const [, sourceId] = mock.addSymbolLayerSpy.mock.calls[0] as [string, string];
      expect(sourceId).toBe("acn-route-remaining");
      expect(mock.sources.get("acn-route-remaining")?.features).toEqual([]);
      expect(mock.sources.get("acn-planning-preview")?.features).not.toEqual([]);
    });

    it("never re-adds the arrow layer on a Riding progress update — coverage follows the existing remaining-source update path", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView
          points={points}
          matchedDistanceFromStartMetres={0}
          mapFactory={mock.factory}
        />,
      );
      mock.triggerLoad();
      expect(mock.addSymbolLayerSpy).toHaveBeenCalledTimes(1);

      rerender(
        <MapView
          points={points}
          matchedDistanceFromStartMetres={100}
          mapFactory={mock.factory}
        />,
      );

      expect(mock.addSymbolLayerSpy).toHaveBeenCalledTimes(1);
      expect(mock.sources.get("acn-route-remaining")?.features).toEqual([]);
    });

    it("registers the icon and layer on the fallback style too", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();

      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      expect(mock.images.has("acn-route-arrow")).toBe(true);
      expect(mock.addSymbolLayerSpy).toHaveBeenCalled();
    });

    it("registers exactly once per constructed instance across fail, fallback and manual retry — never duplicated, never skipped", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      expect(mock.addImageSpy).toHaveBeenCalledTimes(1);
      expect(mock.addSymbolLayerSpy).toHaveBeenCalledTimes(1);

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });
      mock.triggerLoad();

      expect(mock.addImageSpy).toHaveBeenCalledTimes(2);
      expect(mock.addSymbolLayerSpy).toHaveBeenCalledTimes(2);
    });

    it("an arrow-layer setup failure leaves every other layer intact, is logged, and never forces fallback", () => {
      clearErrorLog();
      const mock = createMockMapFactory();
      mock.addSymbolLayerSpy.mockImplementationOnce(() => {
        throw new Error("simulated arrow-layer failure");
      });
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings: [
              {
                kind: "unknown-surface",
                startDistanceMetres: 0,
                endDistanceMetres: 100,
                message: "Unknown surface.",
              },
            ],
            selectedWarningIndex: null,
            onSelectWarning: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      expect(mock.layers.has("acn-route-remaining-line")).toBe(true);
      expect(mock.layers.has("acn-route-completed-line")).toBe(true);
      expect(mock.layers.has("acn-position-marker")).toBe(true);
      expect(mock.layers.has("acn-start-marker")).toBe(true);
      expect(mock.layers.has("acn-finish-marker")).toBe(true);
      expect(mock.layers.has("acn-warning-unknown-surface-line")).toBe(true);
      expect(mock.layers.has("acn-planning-preview-line")).toBe(true);
      expect(screen.queryByTestId("map-fallback-banner")).toBeNull();
      expect(getRecentErrors().some((entry) => entry.context === "map")).toBe(true);
    });
  });

  describe("gradient overlay", () => {
    function gradientSegment(
      startDistanceMetres: number,
      endDistanceMetres: number,
      visualKey: MicroDetailVisualKey,
    ): ClassifiedSegment<MicroDetailVisualKey> {
      return {
        startDistanceMetres,
        endDistanceMetres,
        averageGradientPercent: null,
        visualKey,
      };
    }

    it("creates the gradient source/layer with a categorical colour keyed on visualKey", () => {
      // MapView calls the MapLibreLike interface directly — the actual
      // ["match", ...] expression is built one layer down, inside
      // MapLibreAdapter.addLineLayer (see mapAdapter.test.ts's own
      // "data-driven line colour" tests). At this level, the structured
      // DataDrivenLineColor MapView passes through is what's observable.
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.layers.has("acn-route-gradient-line")).toBe(true);
      const call = mock.addLineLayerSpy.mock.calls.find(
        ([id]) => id === "acn-route-gradient-line",
      ) as [string, string, { lineColor: unknown; lineWidth: number }] | undefined;
      expect(call?.[1]).toBe("acn-route-gradient");
      expect(call?.[2].lineColor).toEqual({
        property: "visualKey",
        cases: MICRO_DETAIL_COLOURS,
        fallback: UNREACHABLE_FALLBACK_COLOUR,
      });
    });

    it("leaves the gradient source empty when gradientOverlay is omitted", () => {
      const mock = createMockMapFactory();
      render(<MapView points={warningPoints} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.sources.get("acn-route-gradient")?.features).toEqual([]);
    });

    it("populates the gradient source with one feature per segment when gradientOverlay is given", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          gradientOverlay={{
            segments: [
              gradientSegment(0, 200, "gentle-or-descending"),
              gradientSegment(200, 400, "hard-climb"),
            ],
          }}
        />,
      );
      mock.triggerLoad();

      const features = mock.sources.get("acn-route-gradient")?.features ?? [];
      expect(features).toHaveLength(2);
      expect(
        features.map(
          (feature) => (feature.properties as { visualKey?: string } | null)?.visualKey,
        ),
      ).toEqual(["gentle-or-descending", "hard-climb"]);
    });

    it("clips gradient coverage to the remaining portion during active Riding, matching the route line's own live-distance split", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView
          points={warningPoints}
          matchedDistanceFromStartMetres={0}
          mapFactory={mock.factory}
          gradientOverlay={{ segments: [gradientSegment(0, 400, "hard-climb")] }}
        />,
      );
      mock.triggerLoad();

      const initialFeatures = mock.sources.get("acn-route-gradient")?.features ?? [];
      const initialCoordinateCount =
        initialFeatures[0]?.geometry.type === "LineString"
          ? initialFeatures[0].geometry.coordinates.length
          : 0;

      rerender(
        <MapView
          points={warningPoints}
          matchedDistanceFromStartMetres={200}
          mapFactory={mock.factory}
          gradientOverlay={{ segments: [gradientSegment(0, 400, "hard-climb")] }}
        />,
      );

      const remainingFeatures = mock.sources.get("acn-route-gradient")?.features ?? [];
      const remainingCoordinateCount =
        remainingFeatures[0]?.geometry.type === "LineString"
          ? remainingFeatures[0].geometry.coordinates.length
          : 0;
      expect(remainingCoordinateCount).toBeLessThan(initialCoordinateCount);
    });

    it("survives fallback and manual retry without duplication", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      const countAfterFallback = mock.addLineLayerSpy.mock.calls.filter(
        ([id]) => id === "acn-route-gradient-line",
      ).length;
      expect(countAfterFallback).toBe(1);

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });
      mock.triggerLoad();

      const countAfterRetry = mock.addLineLayerSpy.mock.calls.filter(
        ([id]) => id === "acn-route-gradient-line",
      ).length;
      expect(countAfterRetry).toBe(2);
    });

    it("a gradient-layer setup failure leaves every other layer intact, is logged, and never forces fallback", () => {
      clearErrorLog();
      const mock = createMockMapFactory();
      mock.addLineLayerSpy.mockImplementation((id: string) => {
        if (id === "acn-route-gradient-line") {
          throw new Error("simulated gradient-layer failure");
        }
      });
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.layers.has("acn-route-remaining-line")).toBe(true);
      expect(mock.layers.has("acn-route-completed-line")).toBe(true);
      expect(mock.layers.has("acn-position-marker")).toBe(true);
      expect(mock.layers.has("acn-start-marker")).toBe(true);
      expect(mock.layers.has("acn-finish-marker")).toBe(true);
      expect(mock.layers.has("acn-planning-preview-line")).toBe(true);
      expect(mock.addSymbolLayerSpy).toHaveBeenCalled(); // arrows still set up
      expect(screen.queryByTestId("map-fallback-banner")).toBeNull();
      expect(getRecentErrors().some((entry) => entry.context === "map")).toBe(true);
    });
  });

  describe("routeFeatureOverlay", () => {
    function climbFeature(
      startDistanceMetres: number,
      endDistanceMetres: number,
      category: ClimbFeature["category"] = "category-3",
    ): ClimbFeature {
      return {
        id: `climb-${String(startDistanceMetres)}`,
        kind: "climb",
        startDistanceMetres,
        endDistanceMetres,
        lengthMetres: endDistanceMetres - startDistanceMetres,
        elevationGainMetres: 40,
        averageGradientPercent: 6,
        maxGradientPercent: 8,
        climbScore: 20000,
        category,
      };
    }

    it("creates the macro layer with a categorical colour keyed on visualKey", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.layers.has("acn-route-feature-line")).toBe(true);
      const call = mock.addLineLayerSpy.mock.calls.find(
        ([id]) => id === "acn-route-feature-line",
      ) as [string, string, { lineColor: unknown; lineWidth: number }] | undefined;
      expect(call?.[1]).toBe("acn-route-feature");
      expect(call?.[2].lineColor).toEqual({
        property: "visualKey",
        cases: ROUTE_FEATURE_COLOURS,
        fallback: UNREACHABLE_FALLBACK_COLOUR,
      });
    });

    it("creates the selected-feature halo layer", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.layers.has("acn-route-feature-selected-line")).toBe(true);
    });

    it("leaves the macro and selected-feature sources empty when routeFeatureOverlay is omitted", () => {
      const mock = createMockMapFactory();
      render(<MapView points={warningPoints} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.sources.get("acn-route-feature")?.features).toEqual([]);
      expect(mock.sources.get("acn-route-feature-selected")?.features).toEqual([]);
    });

    it("populates the macro source with one sparse feature per recognised climb/descent", () => {
      const mock = createMockMapFactory();
      const features: RouteFeature[] = [
        climbFeature(0, 200, "category-2"),
        climbFeature(200, 400, "hc"),
      ];
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          routeFeatureOverlay={{
            features,
            selectedFeatureId: null,
            onSelectRouteFeature: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const collectionFeatures = mock.sources.get("acn-route-feature")?.features ?? [];
      expect(collectionFeatures).toHaveLength(2);
      expect(
        collectionFeatures.map(
          (feature) => (feature.properties as { visualKey?: string } | null)?.visualKey,
        ),
      ).toEqual(["category-2", "hc"]);
    });

    it("clips macro coverage to the remaining portion during active Riding, matching the micro gradient layer's own policy", () => {
      const mock = createMockMapFactory();
      const features: RouteFeature[] = [climbFeature(0, 400)];
      const { rerender } = render(
        <MapView
          points={warningPoints}
          matchedDistanceFromStartMetres={0}
          mapFactory={mock.factory}
          routeFeatureOverlay={{
            features,
            selectedFeatureId: null,
            onSelectRouteFeature: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const initialFeatures = mock.sources.get("acn-route-feature")?.features ?? [];
      const initialCoordinateCount =
        initialFeatures[0]?.geometry.type === "LineString"
          ? initialFeatures[0].geometry.coordinates.length
          : 0;

      rerender(
        <MapView
          points={warningPoints}
          matchedDistanceFromStartMetres={200}
          mapFactory={mock.factory}
          routeFeatureOverlay={{
            features,
            selectedFeatureId: null,
            onSelectRouteFeature: vi.fn(),
          }}
        />,
      );

      const remainingFeatures = mock.sources.get("acn-route-feature")?.features ?? [];
      const remainingCoordinateCount =
        remainingFeatures[0]?.geometry.type === "LineString"
          ? remainingFeatures[0].geometry.coordinates.length
          : 0;
      expect(remainingCoordinateCount).toBeLessThan(initialCoordinateCount);
    });

    it("populates the selected-feature source with the feature's complete, unclipped range", () => {
      const mock = createMockMapFactory();
      const features: RouteFeature[] = [climbFeature(0, 400)];
      render(
        <MapView
          points={warningPoints}
          matchedDistanceFromStartMetres={200}
          mapFactory={mock.factory}
          routeFeatureOverlay={{
            features,
            selectedFeatureId: "climb-0",
            onSelectRouteFeature: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const selected = mock.sources.get("acn-route-feature-selected")?.features ?? [];
      expect(selected).toHaveLength(1);
      const coordinates =
        selected[0]?.geometry.type === "LineString"
          ? selected[0].geometry.coordinates
          : [];
      // Unclipped despite matchedDistanceFromStartMetres=200 partway
      // through the feature — starts at the feature's own start (0), not
      // the ridden progress.
      expect(coordinates[0]).toEqual([0, 51]);
    });

    it("leaves the selected-feature source empty when nothing is selected", () => {
      const mock = createMockMapFactory();
      const features: RouteFeature[] = [climbFeature(0, 400)];
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          routeFeatureOverlay={{
            features,
            selectedFeatureId: null,
            onSelectRouteFeature: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      expect(mock.sources.get("acn-route-feature-selected")?.features).toEqual([]);
    });

    it("adds the climb/descent group's layers before the whole warning group, both narrower than the warning halo", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      const order = mock.addLineLayerSpy.mock.calls.map(([id]) => id as string);
      const featureSelectedIndex = order.indexOf("acn-route-feature-selected-line");
      const featureIndex = order.indexOf("acn-route-feature-line");
      const gradientIndex = order.indexOf("acn-route-gradient-line");
      const warningSelectedIndex = order.indexOf("acn-warning-selected-line");
      const firstWarningCategoryIndex = order.indexOf("acn-warning-unknown-surface-line");

      expect(featureSelectedIndex).toBeGreaterThanOrEqual(0);
      expect(featureSelectedIndex).toBeLessThan(featureIndex);
      expect(featureIndex).toBeLessThan(gradientIndex);
      expect(gradientIndex).toBeLessThan(warningSelectedIndex);
      expect(warningSelectedIndex).toBeLessThan(firstWarningCategoryIndex);
    });

    it("a route-feature-layer setup failure leaves every other layer intact, is logged, and never forces fallback", () => {
      clearErrorLog();
      const mock = createMockMapFactory();
      mock.addLineLayerSpy.mockImplementation((id: string) => {
        if (id === "acn-route-feature-line") {
          throw new Error("simulated route-feature-layer failure");
        }
      });
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.layers.has("acn-route-remaining-line")).toBe(true);
      expect(mock.layers.has("acn-route-completed-line")).toBe(true);
      expect(mock.layers.has("acn-warning-unknown-surface-line")).toBe(true);
      expect(mock.layers.has("acn-position-marker")).toBe(true);
      expect(screen.queryByTestId("map-fallback-banner")).toBeNull();
      expect(getRecentErrors().some((entry) => entry.context === "map")).toBe(true);
    });

    describe("route-feature hit-testing on map tap", () => {
      const features: RouteFeature[] = [climbFeature(0, 200)];

      it("selects the hit feature and never forwards to planningOverlay.onMapTap", () => {
        const mock = createMockMapFactory();
        const onSelectRouteFeature = vi.fn();
        const onMapTap = vi.fn();
        mock.queryTopRouteFeatureAtSpy.mockReturnValue({ routeFeatureId: "climb-0" });
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
            routeFeatureOverlay={{
              features,
              selectedFeatureId: null,
              onSelectRouteFeature,
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.001, 51]);

        expect(onSelectRouteFeature).toHaveBeenCalledWith("climb-0");
        expect(onMapTap).not.toHaveBeenCalled();
      });

      it("falls through to placement for a stale (non-matching) hit id", () => {
        const mock = createMockMapFactory();
        const onSelectRouteFeature = vi.fn();
        const onMapTap = vi.fn();
        mock.queryTopRouteFeatureAtSpy.mockReturnValue({ routeFeatureId: "climb-9999" });
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
            routeFeatureOverlay={{
              features,
              selectedFeatureId: null,
              onSelectRouteFeature,
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.001, 51]);

        expect(onSelectRouteFeature).not.toHaveBeenCalled();
        expect(onMapTap).toHaveBeenCalledWith([0.001, 51]);
      });

      it("never attempts route-feature hit-testing when no routeFeatureOverlay is configured", () => {
        const mock = createMockMapFactory();
        const onMapTap = vi.fn();
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.001, 51]);

        expect(mock.queryTopRouteFeatureAtSpy).not.toHaveBeenCalled();
        expect(onMapTap).toHaveBeenCalledWith([0.001, 51]);
      });

      it("a surface warning wins over an overlapping route feature — onSelectRouteFeature is not called", () => {
        const mock = createMockMapFactory();
        const onSelectWarning = vi.fn();
        const onSelectRouteFeature = vi.fn();
        const onMapTap = vi.fn();
        mock.queryTopWarningFeatureAtSpy.mockReturnValue({ warningIndex: 0 });
        mock.queryTopRouteFeatureAtSpy.mockReturnValue({ routeFeatureId: "climb-0" });
        const warnings: RouteWarning[] = [
          {
            kind: "unsuitable-surface",
            startDistanceMetres: 0,
            endDistanceMetres: 100,
            message: "Unsuitable surface",
          },
        ];
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
            warningOverlay={{ warnings, selectedWarningIndex: null, onSelectWarning }}
            routeFeatureOverlay={{
              features,
              selectedFeatureId: null,
              onSelectRouteFeature,
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.001, 51]);

        expect(onSelectWarning).toHaveBeenCalledWith(0);
        expect(onSelectRouteFeature).not.toHaveBeenCalled();
        expect(mock.queryTopRouteFeatureAtSpy).not.toHaveBeenCalled();
        expect(onMapTap).not.toHaveBeenCalled();
      });

      it("falls through to route-feature hit-testing when the warning hit-test misses", () => {
        const mock = createMockMapFactory();
        const onSelectWarning = vi.fn();
        const onSelectRouteFeature = vi.fn();
        mock.queryTopWarningFeatureAtSpy.mockReturnValue(null);
        mock.queryTopRouteFeatureAtSpy.mockReturnValue({ routeFeatureId: "climb-0" });
        const warnings: RouteWarning[] = [
          {
            kind: "unsuitable-surface",
            startDistanceMetres: 0,
            endDistanceMetres: 100,
            message: "Unsuitable surface",
          },
        ];
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            warningOverlay={{ warnings, selectedWarningIndex: null, onSelectWarning }}
            routeFeatureOverlay={{
              features,
              selectedFeatureId: null,
              onSelectRouteFeature,
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.001, 51]);

        expect(onSelectWarning).not.toHaveBeenCalled();
        expect(onSelectRouteFeature).toHaveBeenCalledWith("climb-0");
      });

      it("queries only the macro route-feature layer, never the selected-feature halo or micro-detail layer", () => {
        const mock = createMockMapFactory();
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            routeFeatureOverlay={{
              features,
              selectedFeatureId: null,
              onSelectRouteFeature: vi.fn(),
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.001, 51]);

        expect(mock.queryTopRouteFeatureAtSpy).toHaveBeenCalledWith(
          [0.001, 51],
          ["acn-route-feature-line"],
        );
      });

      it("does not move the camera (no fitBounds call) when a route feature is selected", () => {
        const mock = createMockMapFactory();
        const onSelectRouteFeature = vi.fn();
        mock.queryTopRouteFeatureAtSpy.mockReturnValue({ routeFeatureId: "climb-0" });
        const { rerender } = render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            routeFeatureOverlay={{
              features,
              selectedFeatureId: null,
              onSelectRouteFeature,
            }}
          />,
        );
        mock.triggerLoad();
        mock.fitBoundsSpy.mockClear();

        mock.triggerMapTap([0.001, 51]);
        rerender(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            routeFeatureOverlay={{
              features,
              selectedFeatureId: "climb-0",
              onSelectRouteFeature,
            }}
          />,
        );

        expect(mock.fitBoundsSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("distance badge overlay", () => {
    it("computes and pushes badges for routed points once the camera has settled", () => {
      const mock = createMockMapFactory();
      render(<MapView points={badgeRoutePoints} mapFactory={mock.factory} />);
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(mock.setDistanceBadgesSpy).toHaveBeenCalledWith([
        {
          id: "distance-badge-1",
          coordinate: [0.01, 51],
          label: "1",
          ariaLabel: "1 kilometre from route start",
        },
        {
          id: "distance-badge-2",
          coordinate: [0.02, 51],
          label: "2",
          ariaLabel: "2 kilometres from route start",
        },
        {
          id: "distance-badge-3",
          coordinate: [0.03, 51],
          label: "3",
          ariaLabel: "3 kilometres from route start",
        },
        {
          id: "distance-badge-4",
          coordinate: [0.04, 51],
          label: "4",
          ariaLabel: "4 kilometres from route start",
        },
      ]);
    });

    it("has its own marker collection, independent from Planning waypoint markers", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={badgeRoutePoints}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [
              { id: "w1", coordinate: [0, 51] },
              { id: "w2", coordinate: [0.05, 51] },
            ],
            previewCoordinates: [],
            selectedWaypointIndex: null,
            onMapTap: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(mock.setMarkersSpy).toHaveBeenCalled();
      const waypointCall = lastCallFirstArg(mock.setMarkersSpy);
      expect(waypointCall).toHaveLength(2);

      expect(mock.setDistanceBadgesSpy).toHaveBeenCalled();
      const badgeCall = lastCallFirstArg(mock.setDistanceBadgesSpy);
      expect(badgeCall.length).toBeGreaterThan(0);
      // Neither call's ids collide with the other's — the two groups are
      // diffed independently on the adapter (separate Map fields), never
      // through a single shared collection.
      const waypointIds = new Set(waypointCall.map((m) => m.id));
      const badgeIds = new Set(badgeCall.map((b: { id: string }) => b.id));
      for (const id of badgeIds) expect(waypointIds.has(id)).toBe(false);
    });

    it("only shows waypoint markers, never distance badges, on Planning's unrouted preview", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={[]}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [{ id: "w1", coordinate: [0, 51] }],
            previewCoordinates: [
              [0, 51],
              [0.001, 51],
            ],
            selectedWaypointIndex: null,
            onMapTap: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(mock.setDistanceBadgesSpy).toHaveBeenCalledWith([]);
    });

    it("updates badge positions and labels when the route changes", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView points={badgeRoutePoints} mapFactory={mock.factory} />,
      );
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      const firstCallCount = mock.setDistanceBadgesSpy.mock.calls.length;

      const shorterRoute = badgeRoutePoints.slice(0, 3); // 0, 500, 1000 — too short for any badge
      rerender(<MapView points={shorterRoute} mapFactory={mock.factory} />);

      expect(mock.setDistanceBadgesSpy.mock.calls.length).toBeGreaterThan(firstCallCount);
      expect(lastCallFirstArg(mock.setDistanceBadgesSpy)).toEqual([]);
    });

    it("retains the previous badges when a failed Planning recalculation leaves the same points reference", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView points={badgeRoutePoints} mapFactory={mock.factory} />,
      );
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      const callCountAfterFirstRoute = mock.setDistanceBadgesSpy.mock.calls.length;

      // Simulates PlanningScreen's own mapPoints: unchanged (same array
      // reference) when a recalculation fails and routing.state never
      // updates — the effect's own `points` dependency is referentially
      // unchanged, so it correctly never recomputes.
      rerender(<MapView points={badgeRoutePoints} mapFactory={mock.factory} />);

      expect(mock.setDistanceBadgesSpy.mock.calls.length).toBe(callCountAfterFirstRoute);
    });

    it("recomputes the interval only once the camera settles in a different zoom band, not on every settle event", () => {
      const mock = createMockMapFactory();
      render(<MapView points={longBadgeRoutePoints} mapFactory={mock.factory} />);
      mock.triggerLoad();

      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15.4,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      const callCountAfterFirstSettle = mock.setDistanceBadgesSpy.mock.calls.length;
      const specsAtStreetZoom = lastCallFirstArg(mock.setDistanceBadgesSpy);
      expect(specsAtStreetZoom.length).toBeGreaterThan(1); // 1km interval

      // Rounds to the same whole zoom level (15) — no state change, so
      // the badge effect must not re-run.
      mock.triggerCameraSettled({
        coordinate: [0.001, 51],
        zoom: 15.49,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(mock.setDistanceBadgesSpy.mock.calls.length).toBe(callCountAfterFirstSettle);

      // A genuinely different zoom band (wide overview, 20km) — the
      // effect must recompute, and a 22km route at 20km spacing places
      // exactly one badge, unlike the >1 at street zoom above.
      mock.triggerCameraSettled({
        coordinate: [0.002, 51],
        zoom: 0,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(mock.setDistanceBadgesSpy.mock.calls.length).toBeGreaterThan(
        callCountAfterFirstSettle,
      );
      expect(lastCallFirstArg(mock.setDistanceBadgesSpy)).toEqual([
        {
          id: "distance-badge-20",
          coordinate: [0.2, 51],
          label: "20",
          ariaLabel: "20 kilometres from route start",
        },
      ]);
    });

    it("registers badges on the fallback style too", () => {
      const mock = createMockMapFactory();
      render(<MapView points={badgeRoutePoints} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      expect(lastCallFirstArg(mock.setDistanceBadgesSpy).length).toBeGreaterThan(0);
    });

    it("does not duplicate badges across a manual imagery retry", () => {
      const mock = createMockMapFactory();
      render(<MapView points={badgeRoutePoints} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      const specsAfterFallback = lastCallFirstArg(mock.setDistanceBadgesSpy);

      act(() => {
        screen.getByTestId("retry-map-imagery-button").click();
      });
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      const specsAfterRetry = lastCallFirstArg(mock.setDistanceBadgesSpy);

      // Content is identical, not doubled — true cross-instance isolation
      // (a fresh Map instance's adapter starts with an empty
      // badgeMarkersById) is a structural guarantee exercised for real by
      // the e2e distanceBadges.spec.ts, since this mock records calls
      // rather than modelling marker identity across instances.
      expect(specsAfterRetry).toEqual(specsAfterFallback);
    });

    it("never triggers a camera fit as a side effect of a badge recompute", () => {
      const mock = createMockMapFactory();
      render(<MapView points={badgeRoutePoints} mapFactory={mock.factory} />);
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: 15,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      const fitCountBeforeSecondSettle = mock.fitBoundsSpy.mock.calls.length;
      const setCameraCountBeforeSecondSettle = mock.setCameraSpy.mock.calls.length;
      const callCountBeforeSecondSettle = mock.setDistanceBadgesSpy.mock.calls.length;

      // A different zoom band recomputes badges (points is unchanged, so
      // this isolates the badge-recompute path from the unrelated
      // "fit to whole route on a genuine points change" effect).
      mock.triggerCameraSettled({
        coordinate: [0.001, 51],
        zoom: 8,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(mock.setDistanceBadgesSpy.mock.calls.length).toBeGreaterThan(
        callCountBeforeSecondSettle,
      );
      expect(mock.fitBoundsSpy.mock.calls.length).toBe(fitCountBeforeSecondSettle);
      expect(mock.setCameraSpy.mock.calls.length).toBe(setCameraCountBeforeSecondSettle);
    });
  });

  describe("zoom-responsive route width policy (backlog item 23)", () => {
    function climbFeature(
      startDistanceMetres: number,
      endDistanceMetres: number,
    ): ClimbFeature {
      return {
        id: `climb-${String(startDistanceMetres)}`,
        kind: "climb",
        startDistanceMetres,
        endDistanceMetres,
        lengthMetres: endDistanceMetres - startDistanceMetres,
        elevationGainMetres: 40,
        averageGradientPercent: 6,
        maxGradientPercent: 8,
        climbScore: 20000,
        category: "category-3",
      };
    }

    function descentFeature(
      startDistanceMetres: number,
      endDistanceMetres: number,
    ): DescentFeature {
      return {
        id: `descent-${String(startDistanceMetres)}`,
        kind: "descent",
        startDistanceMetres,
        endDistanceMetres,
        lengthMetres: endDistanceMetres - startDistanceMetres,
        elevationLossMetres: 40,
        averageGradientPercent: -7,
        maxGradientPercent: -9,
        band: "steep",
      };
    }

    function paintFor(mock: MockMapHandle, layerId: string) {
      const call = mock.addLineLayerSpy.mock.calls.find(([id]) => id === layerId) as
        [string, string, { lineWidth: number | ZoomInterpolatedLineWidth }] | undefined;
      const lineWidth = call?.[2].lineWidth;
      if (lineWidth === undefined) {
        throw new Error(`expected addLineLayer to have been called for ${layerId}`);
      }
      return lineWidth;
    }

    it("every route/warning/preview layer's paint uses the real routeWidthPolicy stops, not a hardcoded value", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(paintFor(mock, "acn-route-remaining-line")).toEqual(legibleWidthStops(5));
      expect(paintFor(mock, "acn-route-completed-line")).toEqual(legibleWidthStops(5));
      expect(paintFor(mock, "acn-route-feature-selected-line")).toEqual(
        legibleWidthStops(9),
      );
      expect(paintFor(mock, "acn-route-feature-line")).toEqual(recedingWidthStops(5));
      expect(paintFor(mock, "acn-route-gradient-line")).toEqual(recedingWidthStops(5));
      expect(paintFor(mock, "acn-warning-selected-line")).toEqual(warningWidthStops(13));
      expect(paintFor(mock, "acn-warning-unknown-surface-line")).toEqual(
        warningWidthStops(8),
      );
      expect(paintFor(mock, "acn-warning-other-line")).toEqual(warningWidthStops(9));
      expect(paintFor(mock, "acn-warning-ferry-line")).toEqual(warningWidthStops(9));
      expect(paintFor(mock, "acn-warning-questionable-surface-line")).toEqual(
        warningWidthStops(9),
      );
      expect(paintFor(mock, "acn-warning-unsuitable-surface-line")).toEqual(
        warningWidthStops(10),
      );
      expect(paintFor(mock, "acn-warning-obstacle-line")).toEqual(warningWidthStops(10));
      expect(paintFor(mock, "acn-planning-preview-line")).toEqual(legibleWidthStops(4));
    });

    it("resolves the unchanged, close-zoom-only width at ROUTE_WIDTH_CLOSE_ZOOM for the base route casing", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(closeZoomWidth(paintFor(mock, "acn-route-remaining-line"))).toBe(5);
      expect(closeZoomWidth(paintFor(mock, "acn-route-feature-line"))).toBe(5);
    });

    it("the base casing stays wider than or equal to the macro overlay at every stop, and strictly wider at overview/regional", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      const casing = paintFor(mock, "acn-route-remaining-line");
      const overlay = paintFor(mock, "acn-route-feature-line");
      expect(widthAt(casing, ROUTE_WIDTH_OVERVIEW_ZOOM)).toBeGreaterThan(
        widthAt(overlay, ROUTE_WIDTH_OVERVIEW_ZOOM),
      );
      expect(widthAt(casing, ROUTE_WIDTH_REGIONAL_ZOOM)).toBeGreaterThan(
        widthAt(overlay, ROUTE_WIDTH_REGIONAL_ZOOM),
      );
      // Close zoom: the two families coincide exactly — today's unchanged
      // appearance, no visible casing ring.
      expect(widthAt(casing, ROUTE_WIDTH_CLOSE_ZOOM)).toBe(
        widthAt(overlay, ROUTE_WIDTH_CLOSE_ZOOM),
      );
    });

    it("backlog item 39: warning casings stay wider than the neutral base and the macro overlay at overview/regional, and the selected-warning halo stays wider than the selected route-feature halo at every stop", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      const neutralBase = paintFor(mock, "acn-route-remaining-line");
      const macroOverlay = paintFor(mock, "acn-route-feature-line");
      const warningCategory = paintFor(mock, "acn-warning-unsuitable-surface-line");
      for (const zoom of [ROUTE_WIDTH_OVERVIEW_ZOOM, ROUTE_WIDTH_REGIONAL_ZOOM]) {
        expect(widthAt(warningCategory, zoom)).toBeGreaterThan(
          widthAt(neutralBase, zoom),
        );
        expect(widthAt(warningCategory, zoom)).toBeGreaterThan(
          widthAt(macroOverlay, zoom),
        );
      }

      const selectedWarning = paintFor(mock, "acn-warning-selected-line");
      const selectedFeature = paintFor(mock, "acn-route-feature-selected-line");
      for (const zoom of [
        ROUTE_WIDTH_OVERVIEW_ZOOM,
        ROUTE_WIDTH_REGIONAL_ZOOM,
        ROUTE_WIDTH_CLOSE_ZOOM,
      ]) {
        expect(widthAt(selectedWarning, zoom)).toBeGreaterThan(
          widthAt(selectedFeature, zoom),
        );
      }
    });

    it("backlog item 39: adds each warning category layer in WARNING_CATEGORIES_IN_PAINT_ORDER sequence, with the selected-warning halo added before all of them", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      const order = mock.addLineLayerSpy.mock.calls.map(([id]) => id as string);
      const categoryLayerIds = [
        "acn-warning-unknown-surface-line",
        "acn-warning-other-line",
        "acn-warning-ferry-line",
        "acn-warning-questionable-surface-line",
        "acn-warning-unsuitable-surface-line",
        "acn-warning-obstacle-line",
      ];
      const selectedIndex = order.indexOf("acn-warning-selected-line");
      const categoryIndices = categoryLayerIds.map((id) => order.indexOf(id));
      for (const categoryIndex of categoryIndices) {
        expect(categoryIndex).toBeGreaterThan(-1);
        expect(selectedIndex).toBeLessThan(categoryIndex);
      }
      for (let index = 1; index < categoryIndices.length; index += 1) {
        expect(categoryIndices[index - 1]).toBeLessThan(
          categoryIndices[index] ?? Number.POSITIVE_INFINITY,
        );
      }
    });

    it("resolves identical route/warning/preview widths for Planning and Riding at the same zoom, by construction", () => {
      const planningMock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={planningMock.factory}
          planningOverlay={{
            waypoints: [
              { id: "a", coordinate: [0, 51] },
              { id: "b", coordinate: [0.001, 51] },
            ],
            previewCoordinates: [],
            selectedWaypointIndex: null,
            onMapTap: vi.fn(),
          }}
        />,
      );
      planningMock.triggerLoad();

      const ridingMock = createMockMapFactory();
      render(<MapView points={points} mapFactory={ridingMock.factory} />);
      ridingMock.triggerLoad();

      for (const layerId of [
        "acn-route-remaining-line",
        "acn-route-completed-line",
        "acn-route-feature-line",
        "acn-route-gradient-line",
        "acn-warning-selected-line",
        "acn-warning-unknown-surface-line",
        "acn-warning-other-line",
        "acn-warning-ferry-line",
        "acn-warning-questionable-surface-line",
        "acn-warning-unsuitable-surface-line",
        "acn-warning-obstacle-line",
        "acn-planning-preview-line",
      ]) {
        expect(paintFor(planningMock, layerId)).toEqual(paintFor(ridingMock, layerId));
      }
    });

    it("never alters classified route-feature/gradient source data across a zoom change", () => {
      const mock = createMockMapFactory();
      const features: RouteFeature[] = [climbFeature(0, 200), descentFeature(200, 400)];
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          routeFeatureOverlay={{
            features,
            selectedFeatureId: features[0]?.id ?? null,
            onSelectRouteFeature: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const atClose = JSON.stringify(mock.sources.get("acn-route-feature"));
      const selectedAtClose = JSON.stringify(
        mock.sources.get("acn-route-feature-selected"),
      );

      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_REGIONAL_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_OVERVIEW_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(JSON.stringify(mock.sources.get("acn-route-feature"))).toBe(atClose);
      expect(JSON.stringify(mock.sources.get("acn-route-feature-selected"))).toBe(
        selectedAtClose,
      );
    });

    it("backlog item 39: never alters classified warning source data across a zoom change", () => {
      const mock = createMockMapFactory();
      const zoomWarnings: RouteWarning[] = [
        {
          kind: "questionable-surface",
          startDistanceMetres: 50,
          endDistanceMetres: 150,
          message: "Questionable surface for a road bike.",
        },
        {
          kind: "ford",
          startDistanceMetres: 300,
          endDistanceMetres: 350,
          message: "Ford crossing.",
        },
      ];
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings: zoomWarnings,
            selectedWarningIndex: 0,
            onSelectWarning: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const questionableAtClose = JSON.stringify(
        mock.sources.get("acn-warning-questionable-surface"),
      );
      const obstacleAtClose = JSON.stringify(mock.sources.get("acn-warning-obstacle"));
      const selectedAtClose = JSON.stringify(mock.sources.get("acn-warning-selected"));

      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_REGIONAL_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_OVERVIEW_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(JSON.stringify(mock.sources.get("acn-warning-questionable-surface"))).toBe(
        questionableAtClose,
      );
      expect(JSON.stringify(mock.sources.get("acn-warning-obstacle"))).toBe(
        obstacleAtClose,
      );
      expect(JSON.stringify(mock.sources.get("acn-warning-selected"))).toBe(
        selectedAtClose,
      );
    });

    it("retains both a recognised climb and a recognised descent at full-route (overview) zoom", () => {
      const mock = createMockMapFactory();
      const features: RouteFeature[] = [climbFeature(0, 200), descentFeature(200, 400)];
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          routeFeatureOverlay={{
            features,
            selectedFeatureId: null,
            onSelectRouteFeature: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_OVERVIEW_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      const collectionFeatures = mock.sources.get("acn-route-feature")?.features ?? [];
      expect(collectionFeatures).toHaveLength(2);
      expect(
        collectionFeatures.map(
          (feature) => (feature.properties as { visualKey?: string } | null)?.visualKey,
        ),
      ).toEqual(["category-3", "steep"]);
    });

    it("still adds every route/warning/preview layer, with the same zoom-interpolated paint, on the local fallback style", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      mock.triggerError({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
      mock.triggerLoad();

      expect(screen.getByTestId("map-fallback-banner")).toBeInTheDocument();
      expect(paintFor(mock, "acn-route-remaining-line")).toEqual(legibleWidthStops(5));
      expect(paintFor(mock, "acn-route-feature-line")).toEqual(recedingWidthStops(5));
      // Backlog item 39: the fallback style installs the same
      // warningWidthStops-based paints as the primary style.
      expect(paintFor(mock, "acn-warning-selected-line")).toEqual(warningWidthStops(13));
      expect(paintFor(mock, "acn-warning-unsuitable-surface-line")).toEqual(
        warningWidthStops(10),
      );
    });

    it("scales the map container's own data-marker-zoom-band attribute across close, regional and overview zoom, and back", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      const container = screen.getByTestId("map-container");
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_CLOSE_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(container).toHaveAttribute("data-marker-zoom-band", "close");

      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_OVERVIEW_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(container).toHaveAttribute("data-marker-zoom-band", "overview");

      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_CLOSE_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(container).toHaveAttribute("data-marker-zoom-band", "close");
    });

    it("does not rebuild waypoint markers on a zoom-only camera settle", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={points}
          mapFactory={mock.factory}
          planningOverlay={{
            waypoints: [
              { id: "a", coordinate: [0, 51] },
              { id: "b", coordinate: [0.001, 51] },
            ],
            previewCoordinates: [],
            selectedWaypointIndex: null,
            onMapTap: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const callCountBeforeZoom = mock.setMarkersSpy.mock.calls.length;
      mock.triggerCameraSettled({
        coordinate: [0, 51],
        zoom: ROUTE_WIDTH_OVERVIEW_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      expect(mock.setMarkersSpy.mock.calls.length).toBe(callCountBeforeZoom);
    });
  });

  describe("warningOverlay", () => {
    const warnings: RouteWarning[] = [
      {
        kind: "questionable-surface",
        startDistanceMetres: 50,
        endDistanceMetres: 150,
        message: "Questionable surface for a road bike.",
      },
      {
        kind: "ford",
        startDistanceMetres: 300,
        endDistanceMetres: 350,
        message: "Ford crossing.",
      },
    ];

    it("leaves every warning source empty when the prop is absent, exactly like today", () => {
      const mock = createMockMapFactory();
      render(<MapView points={warningPoints} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.sources.get("acn-warning-questionable-surface")?.features).toEqual([]);
      expect(mock.sources.get("acn-warning-unsuitable-surface")?.features).toEqual([]);
      expect(mock.sources.get("acn-warning-unknown-surface")?.features).toEqual([]);
      expect(mock.sources.get("acn-warning-obstacle")?.features).toEqual([]);
      expect(mock.sources.get("acn-warning-ferry")?.features).toEqual([]);
      expect(mock.sources.get("acn-warning-other")?.features).toEqual([]);
      expect(mock.sources.get("acn-warning-selected")?.features).toEqual([]);
    });

    it("adds all 7 warning source/layer pairs, each with distinct, documented paint", () => {
      const mock = createMockMapFactory();
      render(<MapView points={warningPoints} mapFactory={mock.factory} />);
      mock.triggerLoad();

      const layerIds = [
        "acn-warning-unknown-surface-line",
        "acn-warning-other-line",
        "acn-warning-ferry-line",
        "acn-warning-questionable-surface-line",
        "acn-warning-unsuitable-surface-line",
        "acn-warning-obstacle-line",
        "acn-warning-selected-line",
      ];
      for (const layerId of layerIds) {
        expect(mock.layers.has(layerId)).toBe(true);
      }

      const calls = mock.addLineLayerSpy.mock.calls as [
        string,
        string,
        {
          lineColor: string;
          lineWidth: number | ZoomInterpolatedLineWidth;
          lineDasharray?: number[];
        },
      ][];
      const paintFor = (layerId: string) => calls.find(([id]) => id === layerId)?.[2];

      // Every category (and selected) has its own colour, and dash pattern
      // distinguishes categories from each other rather than colour alone.
      const dasharrays = layerIds.map((id) =>
        JSON.stringify(paintFor(id)?.lineDasharray),
      );
      expect(new Set(dasharrays).size).toBe(layerIds.length);
      // Selected is solid (no dasharray) and wider than every category, at
      // the unchanged close-zoom width (see closeZoomWidth's own doc
      // comment) — the zoom-responsive width policy (backlog item 23)
      // scales every warning layer by the same shared multiplier family,
      // so this relative ordering holds at every zoom, not just close.
      const selectedPaint = paintFor("acn-warning-selected-line");
      expect(selectedPaint?.lineDasharray).toBeUndefined();
      for (const categoryLayerId of layerIds.slice(0, -1)) {
        const categoryWidth = paintFor(categoryLayerId)?.lineWidth;
        expect(closeZoomWidth(selectedPaint?.lineWidth ?? 0)).toBeGreaterThan(
          categoryWidth === undefined ? 0 : closeZoomWidth(categoryWidth),
        );
      }
    });

    it("populates the category source with the warning's sliced geometry", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings,
            selectedWarningIndex: null,
            onSelectWarning: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const questionable = mock.sources.get("acn-warning-questionable-surface");
      expect(questionable?.features).toHaveLength(1);
      expect(questionable?.features[0]?.geometry).toMatchObject({
        type: "LineString",
        coordinates: [
          [0.0005, 51],
          [0.001, 51],
          [0.0015, 51],
        ],
      });

      const obstacle = mock.sources.get("acn-warning-obstacle");
      expect(obstacle?.features).toHaveLength(1);
    });

    it("populates the selected source only for the selected index, and clears it when deselected", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{ warnings, selectedWarningIndex: 1, onSelectWarning: vi.fn() }}
        />,
      );
      mock.triggerLoad();

      expect(mock.sources.get("acn-warning-selected")?.features).toHaveLength(1);
      expect(
        mock.sources.get("acn-warning-selected")?.features[0]?.geometry,
      ).toMatchObject({
        coordinates: [
          [0.003, 51],
          [0.0035, 51],
        ],
      });

      rerender(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings,
            selectedWarningIndex: null,
            onSelectWarning: vi.fn(),
          }}
        />,
      );

      expect(mock.sources.get("acn-warning-selected")?.features).toEqual([]);
    });

    it("frames the selected warning's own bounds via fitBounds, but never on deselect", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings,
            selectedWarningIndex: null,
            onSelectWarning: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();
      mock.fitBoundsSpy.mockClear();

      rerender(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{ warnings, selectedWarningIndex: 0, onSelectWarning: vi.fn() }}
        />,
      );

      expect(mock.fitBoundsSpy).toHaveBeenCalledWith({
        southWest: [0.0005, 51],
        northEast: [0.0015, 51],
      });

      mock.fitBoundsSpy.mockClear();
      rerender(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings,
            selectedWarningIndex: null,
            onSelectWarning: vi.fn(),
          }}
        />,
      );

      expect(mock.fitBoundsSpy).not.toHaveBeenCalled();
    });

    it("populates warning sources on style-ready alone, before full imagery loads", () => {
      const mock = createMockMapFactory();
      render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings,
            selectedWarningIndex: null,
            onSelectWarning: vi.fn(),
          }}
        />,
      );

      mock.triggerStyleLoaded();

      expect(mock.sources.get("acn-warning-questionable-surface")?.features).toHaveLength(
        1,
      );
    });

    it("re-slices warning geometry when points change, even with the same warnings array", () => {
      const mock = createMockMapFactory();
      const { rerender } = render(
        <MapView
          points={warningPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings,
            selectedWarningIndex: null,
            onSelectWarning: vi.fn(),
          }}
        />,
      );
      mock.triggerLoad();

      const shiftedPoints: RoutePoint[] = warningPoints.map((point) => ({
        ...point,
        coordinate: [point.coordinate[0] + 1, point.coordinate[1]],
      }));
      rerender(
        <MapView
          points={shiftedPoints}
          mapFactory={mock.factory}
          warningOverlay={{
            warnings,
            selectedWarningIndex: null,
            onSelectWarning: vi.fn(),
          }}
        />,
      );

      const questionable = mock.sources.get("acn-warning-questionable-surface");
      expect(questionable?.features[0]?.geometry).toMatchObject({
        coordinates: [
          [1.0005, 51],
          [1.001, 51],
          [1.0015, 51],
        ],
      });
    });

    describe("warning hit-testing on map tap", () => {
      const CATEGORY_LAYER_IDS = [
        "acn-warning-unknown-surface-line",
        "acn-warning-other-line",
        "acn-warning-ferry-line",
        "acn-warning-questionable-surface-line",
        "acn-warning-unsuitable-surface-line",
        "acn-warning-obstacle-line",
      ];

      it("selects the hit warning and never forwards to planningOverlay.onMapTap", () => {
        const mock = createMockMapFactory();
        const onSelectWarning = vi.fn();
        const onMapTap = vi.fn();
        mock.queryTopWarningFeatureAtSpy.mockReturnValue({ warningIndex: 1 });
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
            warningOverlay={{ warnings, selectedWarningIndex: null, onSelectWarning }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.003, 51]);

        expect(onSelectWarning).toHaveBeenCalledWith(1);
        expect(onMapTap).not.toHaveBeenCalled();
      });

      it("falls through to placement for an out-of-range or malformed hit index", () => {
        const mock = createMockMapFactory();
        const onSelectWarning = vi.fn();
        const onMapTap = vi.fn();
        mock.queryTopWarningFeatureAtSpy.mockReturnValue({ warningIndex: 99 });
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
            warningOverlay={{ warnings, selectedWarningIndex: null, onSelectWarning }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.003, 51]);

        expect(onSelectWarning).not.toHaveBeenCalled();
        expect(onMapTap).toHaveBeenCalledWith([0.003, 51]);
      });

      it("never attempts hit-testing when no warningOverlay is configured (Riding mode)", () => {
        const mock = createMockMapFactory();
        const onMapTap = vi.fn();
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.003, 51]);

        expect(mock.queryTopWarningFeatureAtSpy).not.toHaveBeenCalled();
        expect(onMapTap).toHaveBeenCalledWith([0.003, 51]);
      });

      it("never hit-tests before the style/warning layers are structurally ready, and forwards straight through", () => {
        const mock = createMockMapFactory();
        const onSelectWarning = vi.fn();
        const onMapTap = vi.fn();
        mock.queryTopWarningFeatureAtSpy.mockReturnValue({ warningIndex: 0 });
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
            warningOverlay={{ warnings, selectedWarningIndex: null, onSelectWarning }}
          />,
        );
        // No triggerLoad()/triggerStyleLoaded() yet — style is still loading.

        mock.triggerMapTap([0.003, 51]);

        expect(mock.queryTopWarningFeatureAtSpy).not.toHaveBeenCalled();
        expect(onSelectWarning).not.toHaveBeenCalled();
        expect(onMapTap).toHaveBeenCalledWith([0.003, 51]);
      });

      it("hit-testing still resolves correctly once the fallback style's own layers are ready", () => {
        const mock = createMockMapFactory();
        const onSelectWarning = vi.fn();
        mock.queryTopWarningFeatureAtSpy.mockReturnValue({ warningIndex: 0 });
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            warningOverlay={{ warnings, selectedWarningIndex: null, onSelectWarning }}
          />,
        );

        mock.triggerError({
          message: "style fetch failed",
          category: "style-request-or-parse",
        });
        mock.triggerLoad();

        mock.triggerMapTap([0.003, 51]);

        expect(onSelectWarning).toHaveBeenCalledWith(0);
      });

      it("selecting an already-selected warning again still calls onSelectWarning and never forwards to placement", () => {
        const mock = createMockMapFactory();
        const onSelectWarning = vi.fn();
        const onMapTap = vi.fn();
        mock.queryTopWarningFeatureAtSpy.mockReturnValue({ warningIndex: 0 });
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            planningOverlay={{
              waypoints: [],
              previewCoordinates: [],
              selectedWaypointIndex: null,
              onMapTap,
            }}
            warningOverlay={{ warnings, selectedWarningIndex: 0, onSelectWarning }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.001, 51]);
        mock.triggerMapTap([0.001, 51]);

        expect(onSelectWarning).toHaveBeenCalledTimes(2);
        expect(onSelectWarning).toHaveBeenNthCalledWith(1, 0);
        expect(onSelectWarning).toHaveBeenNthCalledWith(2, 0);
        expect(onMapTap).not.toHaveBeenCalled();
      });

      it("queries only the warning category layers, never the selected-warning highlight layer", () => {
        const mock = createMockMapFactory();
        render(
          <MapView
            points={warningPoints}
            mapFactory={mock.factory}
            warningOverlay={{
              warnings,
              selectedWarningIndex: null,
              onSelectWarning: vi.fn(),
            }}
          />,
        );
        mock.triggerLoad();

        mock.triggerMapTap([0.003, 51]);

        expect(mock.queryTopWarningFeatureAtSpy).toHaveBeenCalledWith(
          [0.003, 51],
          CATEGORY_LAYER_IDS,
        );
        const [, layerIds] = mock.queryTopWarningFeatureAtSpy.mock.calls[0] ?? [];
        expect(layerIds).not.toContain("acn-warning-selected-line");
      });
    });
  });
});
