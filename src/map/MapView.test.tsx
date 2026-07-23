import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapView } from "./MapView.tsx";
import type { MapErrorInfo, MapFactory, MapLibreLike } from "./mapAdapter.ts";
import type { RoutePoint } from "../domain/types.ts";

const points: RoutePoint[] = [
  { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
  { coordinate: [0.001, 51], elevationMetres: 12, distanceFromStartMetres: 100 },
];

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerError: (info: MapErrorInfo) => void;
  sources: Map<string, GeoJSON.FeatureCollection>;
  layers: Set<string>;
  removeSpy: ReturnType<typeof vi.fn>;
  fitBoundsSpy: ReturnType<typeof vi.fn>;
  resizeSpy: ReturnType<typeof vi.fn>;
}

function createMockMapFactory(): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let errorListener: ((info: MapErrorInfo) => void) | undefined;
  const sources = new Map<string, GeoJSON.FeatureCollection>();
  const layers = new Set<string>();
  const removeSpy = vi.fn();
  const fitBoundsSpy = vi.fn();
  const resizeSpy = vi.fn();

  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: (listener) => {
        loadListener = listener;
      },
      onError: (listener) => {
        errorListener = listener;
      },
      onSourceData: () => {
        // not exercised by these component tests
      },
      addGeoJsonSource: (id, data) => {
        sources.set(id, data);
      },
      setGeoJsonSourceData: (id, data) => {
        sources.set(id, data);
      },
      hasSource: (id) => sources.has(id),
      addLineLayer: (id: string) => {
        layers.add(id);
      },
      addCircleLayer: (id: string) => {
        layers.add(id);
      },
      hasLayer: (id) => layers.has(id),
      fitBounds: fitBoundsSpy,
      resize: resizeSpy,
      remove: removeSpy,
    };
    return map;
  };

  return {
    factory,
    fitBoundsSpy,
    resizeSpy,
    triggerLoad: () => {
      act(() => {
        loadListener?.();
      });
    },
    triggerError: (info) => {
      act(() => {
        errorListener?.(info);
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

describe("MapView", () => {
  it("renders visible attribution linking to the configured tile source", () => {
    const { factory } = createMockMapFactory();
    render(<MapView points={points} mapFactory={factory} />);

    const attribution = screen.getByTestId("map-attribution");
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

  it("shows a distinct load-error state, including the underlying message, if the map errors before ever loading", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerError({ message: "style fetch failed" });

    expect(screen.queryByTestId("map-loading")).toBeNull();
    expect(screen.getByTestId("map-load-error")).toHaveTextContent("style fetch failed");
  });

  it("says the map is taking longer than expected if it hasn't loaded after the timeout", () => {
    vi.useFakeTimers();
    try {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByTestId("map-loading")).toHaveTextContent(
        "taking longer than expected",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show the timeout message once the map has already loaded", () => {
    vi.useFakeTimers();
    try {
      const mock = createMockMapFactory();
      render(<MapView points={points} mapFactory={mock.factory} />);
      mock.triggerLoad();

      act(() => {
        vi.advanceTimersByTime(10_000);
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

  it("frames the map to the route's bounding box once loaded", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);

    mock.triggerLoad();

    expect(mock.fitBoundsSpy).toHaveBeenCalledWith({
      southWest: [0, 51],
      northEast: [0.001, 51],
    });
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

    mock.triggerError({ message: "tile fetch failed" });

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
});
