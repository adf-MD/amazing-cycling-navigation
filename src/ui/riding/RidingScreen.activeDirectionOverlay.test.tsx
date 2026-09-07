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
import type { Coordinate, PlannedRoute, RoutePoint } from "../../domain/types.ts";
import {
  OUT_AND_BACK_COINCIDENT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX,
} from "../../test/fixtures/outAndBackCoincidentRoute.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";

const ACTIVE_DIRECTION_SOURCE_ID = "acn-route-active-direction";
const COMPLETED_SOURCE_ID = "acn-route-completed";

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

// Backlog item 98 follow-up: a straight, non-retracing climb-then-descend
// route (a single mountain pass, not an out-and-back), so every route
// distance maps to a unique physical position and a fix can jump straight
// to any target distance with no self-intersection/continuity ambiguity
// to resolve first — deliberately simpler than
// e2e/ridingActiveDirectionLayering.spec.ts's own coincident out-and-back
// fixture, which exists to prove a different thing (overlap priority) this
// file's own turnaround test already covers. Same elevation-vs-distance
// profile and thresholds, verified directly through
// analyzeRouteElevationProfile and detectRouteFeatures rather than
// assumed: climb 460-2000 m (category-3), whose micro bands are
// "gentle-or-descending" 460-500 m then "very-hard-climb" 500-2000 m;
// descent 2000-2600 m (very-steep), whose micro bands are "neutral"
// 2000-2020 m then "very-steep" 2020-2600 m. The short "neutral" edge is
// exactly what lets a test distinguish the descent's own local colour
// from its macro band.
const CLASSIFIED_LAT = 51.5;
const CLASSIFIED_START_LON = -0.2;
const CLASSIFIED_STEP_METRES = 25;
const CLASSIFIED_FLAT_END_METRES = 500;
const CLASSIFIED_SUMMIT_METRES = 2000;
const CLASSIFIED_DESCENT_LENGTH_METRES = 600;
const CLASSIFIED_ROUTE_END_METRES =
  CLASSIFIED_SUMMIT_METRES + CLASSIFIED_DESCENT_LENGTH_METRES;
const CLASSIFIED_GRADE_PERCENT = 11;
const CLASSIFIED_METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const CLASSIFIED_SUMMIT_ELEVATION_METRES =
  10 +
  ((CLASSIFIED_SUMMIT_METRES - CLASSIFIED_FLAT_END_METRES) * CLASSIFIED_GRADE_PERCENT) /
    100;

function classifiedElevationAtDistance(routeDistanceMetres: number): number {
  if (routeDistanceMetres <= CLASSIFIED_FLAT_END_METRES) return 10;
  if (routeDistanceMetres <= CLASSIFIED_SUMMIT_METRES) {
    return (
      10 +
      ((routeDistanceMetres - CLASSIFIED_FLAT_END_METRES) * CLASSIFIED_GRADE_PERCENT) /
        100
    );
  }
  return (
    CLASSIFIED_SUMMIT_ELEVATION_METRES -
    ((routeDistanceMetres - CLASSIFIED_SUMMIT_METRES) * CLASSIFIED_GRADE_PERCENT) / 100
  );
}

/** A coordinate exactly on the classified fixture's road at an arbitrary
 * route distance — straightforward since this route never retraces
 * itself, so route distance and physical position are the same thing. */
function classifiedCoordinateAtDistance(routeDistanceMetres: number): Coordinate {
  return [
    CLASSIFIED_START_LON + routeDistanceMetres / CLASSIFIED_METRES_PER_DEGREE_LON,
    CLASSIFIED_LAT,
  ];
}

function buildClassifiedClimbDescentRoutePoints(): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let x = 0; x <= CLASSIFIED_ROUTE_END_METRES; x += CLASSIFIED_STEP_METRES) {
    points.push({
      coordinate: classifiedCoordinateAtDistance(x),
      elevationMetres: classifiedElevationAtDistance(x),
      distanceFromStartMetres: x,
    });
  }
  return points;
}

const classifiedRoutePoints = buildClassifiedClimbDescentRoutePoints();
const classifiedRoute: PlannedRoute = {
  id: "route-98-classified",
  name: "Coincident classified climb and descent",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: classifiedRoutePoints,
  manoeuvres: [],
  distanceMetres: classifiedRoutePoints.at(-1)?.distanceFromStartMetres ?? 0,
  ascentMetres: 0,
  descentMetres: 0,
  warnings: [],
  source: { kind: "gpx-import" },
};

function classifiedFixAt(
  routeDistanceMetres: number,
  timestampMs: number,
): GeolocationFix {
  return fixAt(classifiedCoordinateAtDistance(routeDistanceMetres), timestampMs);
}

interface LineFeature {
  properties: { visualKey: string; paintPriority: number };
  geometry: { type: string; coordinates: [number, number][] };
}

function buildMockMapFactory(): {
  factory: MapFactory;
  triggerLoad: () => void;
  activeDirectionFeatures: () => LineFeature[];
  completedFeatures: () => LineFeature[];
  /** Simulates a real map tap resolving to the given route feature id —
   * drives MapView's own production onMapTap/queryTopRouteFeatureAt/
   * onSelectRouteFeature wiring (mapAdapter.ts's MapLibreLike is the only
   * mocked layer), never RidingScreen's private selection state directly. */
  tapRouteFeature: (featureId: string) => void;
} {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let mapTapListener: ((coordinate: Coordinate) => void) | undefined;
  let nextRouteFeatureHit: string | null = null;
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
      onMapTap: (listener) => {
        mapTapListener = listener;
      },
      queryTopWarningFeatureAt: () => null,
      queryTopRouteFeatureAt: () =>
        nextRouteFeatureHit === null ? null : { routeFeatureId: nextRouteFeatureHit },
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
    completedFeatures: () =>
      (sources.get(COMPLETED_SOURCE_ID)?.features ?? []) as unknown as LineFeature[],
    tapRouteFeature: (featureId: string) => {
      nextRouteFeatureHit = featureId;
      mapTapListener?.([0, 51]);
    },
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

  it("freezes the whole overlay, including its near end, with the rest of the trusted presentation while a fix is strongly off route", async () => {
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
    const before = mock.activeDirectionFeatures();
    const completedBefore = mock.completedFeatures();

    // ~133 m off the line: comfortably past the 55 m off-route threshold at
    // this accuracy (OFF_ROUTE_BASE_METRES 50 + 5 m), which is exactly what
    // freezes presentationDistanceFromStartMetres — but still close enough
    // to stay an ordinary windowed match rather than a whole-route
    // reacquire, which would classify "untrusted" instead.
    const [lon, lat] = pointAt(60);
    act(() => {
      watch?.emitFix(fixAt([lon, lat + 0.0012], 11_000));
    });

    // The raw match genuinely advanced — this is a real off-route
    // excursion, not a no-op — proved independently via the
    // completed/remaining split, which (unlike the active-direction
    // overlay) is still clipped by the live raw match and so must move.
    await waitFor(() => {
      expect(mock.completedFeatures()).not.toEqual(completedBefore);
    });

    // The active-direction overlay itself stays completely frozen: both
    // endpoints, every intervening span, and every feature's own
    // properties, byte-identical to before the excursion.
    expect(mock.activeDirectionFeatures()).toEqual(before);
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

  it("keeps the active overlay unchanged while a different feature is explicitly selected, then cleared", async () => {
    const user = userEvent.setup();
    const mock = buildMockMapFactory();
    const fake = buildFakeGeolocationSource();

    render(
      <RidingScreen
        route={classifiedRoute}
        geolocationSource={fake.source}
        mapFactory={mock.factory}
      />,
    );
    mock.triggerLoad();
    await user.click(screen.getByRole("button", { name: "Start riding" }));

    // 5 m into the descent's own short "neutral" edge (2000-2020 m), where
    // its local colour genuinely differs from its "very-steep" macro band
    // — deliberately NOT a position deep inside the uniform "very-steep"
    // micro band, where a macro-fallback bug would produce the identical
    // string and this assertion could pass either way. activeFeature is
    // the descent here, never the climb, so the standard feature view
    // (and this selection's own details panel) stays in play rather than
    // the dedicated active-climb view a rider ON the climb would see
    // instead.
    const watch = fake.watches.at(-1);
    act(() => {
      watch?.emitFix(classifiedFixAt(2005, 1_000));
    });
    await waitFor(() => {
      expect(mock.activeDirectionFeatures().length).toBeGreaterThan(0);
    });
    const before = mock.activeDirectionFeatures();
    const visualKeysBefore = before.map((feature) => feature.properties.visualKey);
    expect(visualKeysBefore).toContain("neutral");

    // Select the opposite-direction climb through the real map-tap path —
    // MapView's own production onMapTap/queryTopRouteFeatureAt handling,
    // not a fabricated prop or private state change.
    act(() => {
      mock.tapRouteFeature("climb-460");
    });
    await user.click(await screen.findByRole("button", { name: "Profile" }));
    await screen.findByRole("heading", { name: /Category 3 climb/ });
    await user.click(await screen.findByRole("button", { name: "Map" }));

    expect(mock.activeDirectionFeatures()).toEqual(before);

    // Clearing the selection must not change it either.
    await user.click(await screen.findByRole("button", { name: "Profile" }));
    await user.click(await screen.findByRole("button", { name: "Clear selection" }));
    await user.click(await screen.findByRole("button", { name: "Map" }));

    expect(mock.activeDirectionFeatures()).toEqual(before);
  });

  it("shows an active descent's own local micro colour even when a different feature is explicitly selected", async () => {
    const user = userEvent.setup();
    const mock = buildMockMapFactory();
    const fake = buildFakeGeolocationSource();

    render(
      <RidingScreen
        route={classifiedRoute}
        geolocationSource={fake.source}
        mapFactory={mock.factory}
      />,
    );
    mock.triggerLoad();
    await user.click(screen.getByRole("button", { name: "Start riding" }));

    // 5 m into the descent's own short "neutral" edge (2000-2020 m) — the
    // active feature is the descent, but its LOCAL colour here differs
    // from its macro "very-steep" band, which is exactly what
    // discriminates correct micro-detail plumbing from a macro fallback.
    const watch = fake.watches.at(-1);
    act(() => {
      watch?.emitFix(classifiedFixAt(2005, 1_000));
    });
    await waitFor(() => {
      expect(mock.activeDirectionFeatures().length).toBeGreaterThan(0);
    });

    // Select the climb — a genuinely different feature than the active
    // descent, so microDetailFeature !== activeFeature and the new
    // fourth branch (a fresh classification for an active, unselected
    // descent) is what has to supply this colour.
    act(() => {
      mock.tapRouteFeature("climb-460");
    });
    await user.click(await screen.findByRole("button", { name: "Profile" }));
    await screen.findByRole("heading", { name: /Category 3 climb/ });
    await user.click(await screen.findByRole("button", { name: "Map" }));

    const visualKeys = mock
      .activeDirectionFeatures()
      .map((feature) => feature.properties.visualKey);
    expect(visualKeys).toContain("neutral");
    expect(visualKeys).not.toContain("very-hard-climb");
    expect(visualKeys).not.toContain("category-3");
  });
});
