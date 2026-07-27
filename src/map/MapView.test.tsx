import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapView } from "./MapView.tsx";
import type {
  CreateMapOptions,
  MapErrorInfo,
  MapLibreLike,
  MapFactory,
  MapSourceDataInfo,
  WarningFeatureHit,
} from "./mapAdapter.ts";
import { clearErrorLog, getRecentErrors } from "../platform/errorLog.ts";
import { clearMapDiagnostics, getRecentMapAttempts } from "./mapDiagnostics.ts";
import type { Coordinate, RoutePoint, RouteWarning } from "../domain/types.ts";

const points: RoutePoint[] = [
  { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
  { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 100 },
];

const warningPoints: RoutePoint[] = Array.from({ length: 5 }, (_, index) => ({
  coordinate: [index * 0.001, 51] as Coordinate,
  elevationMetres: null,
  distanceFromStartMetres: index * 100,
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
  removeSpy: ReturnType<typeof vi.fn>;
  fitBoundsSpy: ReturnType<typeof vi.fn>;
  resizeSpy: ReturnType<typeof vi.fn>;
  getCenterSpy: ReturnType<typeof vi.fn>;
  getZoomSpy: ReturnType<typeof vi.fn>;
  setCameraSpy: ReturnType<typeof vi.fn>;
  addLineLayerSpy: ReturnType<typeof vi.fn>;
  /** Default: never a hit (returns null). Tests override with
   * .mockReturnValueOnce/.mockReturnValue to simulate a warning-feature
   * hit; also lets tests assert exactly which coordinate/layerIds MapView
   * queried. */
  queryTopWarningFeatureAtSpy: ReturnType<
    typeof vi.fn<
      (coordinate: Coordinate, layerIds: readonly string[]) => WarningFeatureHit | null
    >
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
  const removeSpy = vi.fn();
  const fitBoundsSpy = vi.fn();
  const resizeSpy = vi.fn();
  const getCenterSpy = vi.fn(() => center);
  const getZoomSpy = vi.fn(() => 14);
  const setCameraSpy = vi.fn();
  const addLineLayerSpy = vi.fn();
  const queryTopWarningFeatureAtSpy = vi.fn((): WarningFeatureHit | null => null);
  const constructedStyles: CreateMapOptions["style"][] = [];

  const factory: MapFactory = ({ style }) => {
    constructedStyles.push(style);
    styleLoadedFired = false;
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
      resize: resizeSpy,
      onMapTap: (listener) => {
        mapTapListener = listener;
      },
      queryTopWarningFeatureAt: queryTopWarningFeatureAtSpy,
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
    addLineLayerSpy,
    queryTopWarningFeatureAtSpy,
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
    removeSpy,
  };
}

function firstCallOrder(spy: ReturnType<typeof vi.fn>): number {
  const [order] = spy.mock.invocationCallOrder;
  if (order === undefined) {
    throw new Error("expected spy to have been called");
  }
  return order;
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

  it("shows a terminal load-error state, including the underlying message, if the fallback style also fails fatally", () => {
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
    expect(screen.getByTestId("map-load-error")).toHaveTextContent(
      "fallback also failed",
    );
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

  it("shows an explicit tiles-unavailable banner on a map error, keeping the route layer", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);
    mock.triggerLoad();

    expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();

    mock.triggerError({ message: "tile fetch failed", category: "source-or-tile" });

    const banner = screen.getByTestId("tiles-unavailable-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("tile fetch failed");
    expect(mock.sources.has("acn-route-remaining")).toBe(true);
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

  describe("planningOverlay", () => {
    it("leaves the planning sources empty when the prop is absent, exactly like Riding mode today", () => {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      expect(mock.sources.get("acn-planning-waypoints")?.features).toEqual([]);
      expect(mock.sources.get("acn-planning-waypoint-selected")?.features).toEqual([]);
      expect(mock.sources.get("acn-planning-preview")?.features).toEqual([]);
    });

    it("renders waypoint markers, separating the selected one into its own source", () => {
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

      expect(mock.sources.get("acn-planning-waypoints")?.features).toHaveLength(1);
      expect(mock.sources.get("acn-planning-waypoint-selected")?.features).toHaveLength(
        1,
      );
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

      expect(mock.sources.get("acn-planning-waypoints")?.features).toHaveLength(1);
      expect(mock.sources.get("acn-planning-waypoint-selected")?.features).toHaveLength(
        1,
      );
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
        { lineColor: string; lineWidth: number; lineDasharray?: number[] },
      ][];
      const paintFor = (layerId: string) => calls.find(([id]) => id === layerId)?.[2];

      // Every category (and selected) has its own colour, and dash pattern
      // distinguishes categories from each other rather than colour alone.
      const dasharrays = layerIds.map((id) =>
        JSON.stringify(paintFor(id)?.lineDasharray),
      );
      expect(new Set(dasharrays).size).toBe(layerIds.length);
      // Selected is solid (no dasharray) and wider than every category.
      const selectedPaint = paintFor("acn-warning-selected-line");
      expect(selectedPaint?.lineDasharray).toBeUndefined();
      for (const categoryLayerId of layerIds.slice(0, -1)) {
        expect(selectedPaint?.lineWidth).toBeGreaterThan(
          paintFor(categoryLayerId)?.lineWidth ?? 0,
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
