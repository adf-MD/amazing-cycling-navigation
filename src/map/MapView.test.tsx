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
}

function createMockMapFactory(): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let errorListener: ((info: MapErrorInfo) => void) | undefined;
  const sources = new Map<string, GeoJSON.FeatureCollection>();
  const layers = new Set<string>();
  const removeSpy = vi.fn();

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
      remove: removeSpy,
    };
    return map;
  };

  return {
    factory,
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

  it("shows an explicit tiles-unavailable banner on a map error, keeping the route layer", () => {
    const mock = createMockMapFactory();
    render(<MapView points={points} mapFactory={mock.factory} />);
    mock.triggerLoad();

    expect(screen.queryByTestId("tiles-unavailable-banner")).toBeNull();

    mock.triggerError({ message: "tile fetch failed" });

    expect(screen.getByTestId("tiles-unavailable-banner")).toBeInTheDocument();
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
