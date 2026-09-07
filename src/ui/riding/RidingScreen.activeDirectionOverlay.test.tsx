// Backlog item 98: the active-Riding direction-aware overlay's input.
// Deliberately a separate file, mirroring this codebase's established
// convention for RidingScreen's sibling suites, and using its own local
// MapLibreLike stub rather than importing from RidingScreen.test.tsx,
// which exports nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingScreen } from "./RidingScreen.tsx";
import { db } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import {
  OUT_AND_BACK_COINCIDENT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX,
} from "../../test/fixtures/outAndBackCoincidentRoute.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";

const ACTIVE_DIRECTION_SOURCE_ID = "acn-route-active-direction";

const routePoints = OUT_AND_BACK_COINCIDENT_ROUTE_POINTS;
const turnaroundDistanceMetres =
  routePoints[OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX]?.distanceFromStartMetres ?? 0;

const route: PlannedRoute = {
  id: "route-98",
  name: "Coincident out and back",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: routePoints,
  manoeuvres: [],
  distanceMetres: routePoints.at(-1)?.distanceFromStartMetres ?? 0,
  ascentMetres: 0,
  descentMetres: 0,
  warnings: [],
  source: { kind: "gpx-import" },
};

interface LineFeature {
  properties: { visualKey: string; paintPriority: number };
  geometry: { type: string; coordinates: [number, number][] };
}

function buildMockMapFactory(): {
  factory: MapFactory;
  triggerLoad: () => void;
  activeDirectionFeatures: () => LineFeature[];
} {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  const sources = new Map<string, GeoJSON.FeatureCollection>();
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
      addGeoJsonSource: (id, data) => {
        sources.set(id, data);
      },
      setGeoJsonSourceData: (id, data) => {
        sources.set(id, data);
      },
      hasSource: (id) => sources.has(id),
      addLineLayer: () => undefined,
      addCircleLayer: () => undefined,
      hasLayer: () => false,
      hasImage: () => false,
      addImage: () => undefined,
      addSymbolLayer: () => undefined,
      fitBounds: () => undefined,
      getCenter: () => [0, 51],
      getZoom: () => 14,
      onUserCameraInteraction: () => undefined,
      onCameraSettled: () => undefined,
      setCamera: vi.fn(),
      centreOn: () => undefined,
      changeZoomBy: vi.fn(),
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
    activeDirectionFeatures: () =>
      (sources.get(ACTIVE_DIRECTION_SOURCE_ID)?.features ??
        []) as unknown as LineFeature[],
  };
}

function fixAt(coordinate: Coordinate, timestampMs: number): GeolocationFix {
  return {
    coordinate,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function pointAt(index: number): Coordinate {
  return routePoints[index]?.coordinate ?? [0, 51];
}

/** Which way along the road the overlay's nearest-to-the-rider piece runs.
 *
 * This fixture's outbound and return legs are exactly coincident, so their
 * coordinates are identical and only the DIRECTION the overlay's geometry
 * travels can distinguish them: outbound is increasing longitude, the
 * return leg decreasing. Farthest-first emission puts the piece at the
 * rider last, and its coordinates run in route order from the rider
 * forwards. */
/** The farthest-ahead point the overlay reaches, as a longitude. On this
 * fixture's outbound leg that is its greatest longitude. */
function farthestLongitude(features: LineFeature[]): number {
  let farthest = Number.NEGATIVE_INFINITY;
  for (const feature of features) {
    for (const [longitude] of feature.geometry.coordinates) {
      if (longitude > farthest) farthest = longitude;
    }
  }
  return farthest;
}

function overlayDirection(features: LineFeature[]): "outbound" | "return" | null {
  const nearest = features.at(-1);
  const coordinates = nearest?.geometry.coordinates ?? [];
  const first = coordinates.at(0);
  const last = coordinates.at(-1);
  if (!first || !last || first[0] === last[0]) return null;
  return last[0] > first[0] ? "outbound" : "return";
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

describe("RidingScreen — direction-aware active overlay input (backlog item 98)", () => {
  it("supplies nothing before riding starts, even when a paused session restored real progress", async () => {
    await setActiveRideState({
      id: "active",
      routeId: route.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: pointAt(60), accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 60,
      matchedDistanceFromStartMetres: routePoints[60]?.distanceFromStartMetres ?? 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      lastReliableMatchedPointIndex: 60,
      lastReliableMatchedDistanceFromStartMetres:
        routePoints[60]?.distanceFromStartMetres ?? 0,
    });
    const mock = buildMockMapFactory();
    const fake = buildFakeGeolocationSource();

    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={mock.factory}
      />,
    );
    mock.triggerLoad();

    await screen.findByRole("button", { name: /riding/i });
    await waitFor(() => {
      expect(mock.activeDirectionFeatures()).toEqual([]);
    });
  });

  it("stays empty on Start until a fix supplies reliable progress, then paints from the rider forward", async () => {
    const user = userEvent.setup();
    const mock = buildMockMapFactory();
    const fake = buildFakeGeolocationSource();

    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={mock.factory}
      />,
    );
    mock.triggerLoad();

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    expect(mock.activeDirectionFeatures()).toEqual([]);

    const watch = fake.watches.at(-1);
    act(() => {
      watch?.emitFix(fixAt(pointAt(10), 1_000));
    });

    await waitFor(() => {
      expect(mock.activeDirectionFeatures().length).toBeGreaterThan(0);
    });
  });

  it("uses the ordinary-route colour key on a route with no recognised features", async () => {
    const user = userEvent.setup();
    const mock = buildMockMapFactory();
    const fake = buildFakeGeolocationSource();

    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={mock.factory}
      />,
    );
    mock.triggerLoad();
    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches.at(-1)?.emitFix(fixAt(pointAt(10), 1_000));
    });

    await waitFor(() => {
      const features = mock.activeDirectionFeatures();
      expect(features.length).toBeGreaterThan(0);
      for (const feature of features) {
        expect(feature.properties.visualKey).toBe("ordinary-route");
      }
    });
  });

  it("advances onto the opposite-direction occurrence once progress passes the turnaround", async () => {
    const user = userEvent.setup();
    const mock = buildMockMapFactory();
    const fake = buildFakeGeolocationSource();

    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={mock.factory}
      />,
    );
    mock.triggerLoad();
    await user.click(screen.getByRole("button", { name: "Start riding" }));

    const watch = fake.watches.at(-1);
    let timestamp = 1_000;
    let nextIndex = 10;
    function ride(toIndex: number): void {
      for (let index = nextIndex; index <= toIndex; index += 10) {
        const pointIndex = index;
        act(() => {
          watch?.emitFix(fixAt(pointAt(pointIndex), timestamp));
        });
        timestamp += 10_000;
      }
      nextIndex = toIndex + 10;
    }

    ride(OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX - 20);
    await waitFor(() => {
      expect(overlayDirection(mock.activeDirectionFeatures())).toBe("outbound");
    });

    ride(OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX + 80);
    await waitFor(() => {
      expect(overlayDirection(mock.activeDirectionFeatures())).toBe("return");
    });

    // Farthest-first, so the piece at the rider is last in the source as
    // well as highest by paint priority.
    const paintPriorities = mock
      .activeDirectionFeatures()
      .map((feature) => feature.properties.paintPriority);
    expect(paintPriorities).toEqual([...paintPriorities].sort((a, b) => a - b));
    expect(turnaroundDistanceMetres).toBeGreaterThan(0);
  });

  it("freezes with the rest of the trusted presentation while a fix is strongly off route", async () => {
    const user = userEvent.setup();
    const mock = buildMockMapFactory();
    const fake = buildFakeGeolocationSource();

    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={mock.factory}
      />,
    );
    mock.triggerLoad();
    await user.click(screen.getByRole("button", { name: "Start riding" }));

    const watch = fake.watches.at(-1);
    act(() => {
      watch?.emitFix(fixAt(pointAt(40), 1_000));
    });
    await waitFor(() => {
      expect(mock.activeDirectionFeatures().length).toBeGreaterThan(0);
    });
    const farthestBefore = farthestLongitude(mock.activeDirectionFeatures());

    // ~133 m off the line: comfortably past the 55 m off-route threshold at
    // this accuracy (OFF_ROUTE_BASE_METRES 50 + 5 m), which is exactly what
    // freezes presentationDistanceFromStartMetres — but still close enough
    // to stay an ordinary windowed match rather than a whole-route
    // reacquire, which would classify "untrusted" instead.
    const [lon, lat] = pointAt(60);
    act(() => {
      watch?.emitFix(fixAt([lon, lat + 0.0012], 11_000));
    });

    // The window must not advance: its far end stays exactly where the last
    // reliable match left it. (Its near end may legitimately be trimmed —
    // MapView clips every overlay by the live match, which is what stops a
    // frozen window from repainting road already ridden.)
    await waitFor(() => {
      expect(farthestLongitude(mock.activeDirectionFeatures())).toBeCloseTo(
        farthestBefore,
        9,
      );
    });
  });

  it("keeps supplying the overlay across a Map/Profile switch, without duplicating it", async () => {
    const user = userEvent.setup();
    const mock = buildMockMapFactory();
    const fake = buildFakeGeolocationSource();

    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={mock.factory}
      />,
    );
    mock.triggerLoad();
    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches.at(-1)?.emitFix(fixAt(pointAt(10), 1_000));
    });
    await waitFor(() => {
      expect(mock.activeDirectionFeatures().length).toBeGreaterThan(0);
    });
    const before = mock.activeDirectionFeatures().length;

    await user.click(await screen.findByRole("button", { name: "Profile" }));
    await user.click(await screen.findByRole("button", { name: "Map" }));

    expect(mock.activeDirectionFeatures()).toHaveLength(before);
  });
});
