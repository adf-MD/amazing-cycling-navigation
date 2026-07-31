import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingScreen } from "./RidingScreen.tsx";
import { db } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
import type {
  GeolocationError,
  GeolocationFix,
  GeolocationSource,
} from "../../platform/geolocation.ts";
import type { Clock } from "../../platform/clock.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { Coordinate, PlannedRoute, RoutePoint } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "../../test/fixtures/routeGeometry.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";
import { OFF_ROUTE_BASE_METRES } from "../../navigation/offRoute.ts";
import { MICRO_DETAIL_COLOURS } from "../../navigation/routeFeaturePalette.ts";
import { routeTangentBearingDegrees } from "../../navigation/bearing.ts";
import { FOLLOW_PITCH_DEGREES, NAVIGATION_ZOOM } from "./rideCamera.ts";

const routePoints = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
);

const route: PlannedRoute = {
  id: "route-1",
  name: "Evening loop",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: routePoints,
  manoeuvres: [],
  distanceMetres: routePoints.at(-1)?.distanceFromStartMetres ?? 0,
  ascentMetres: 2,
  descentMetres: 0,
  warnings: [],
  source: { kind: "gpx-import" },
};

// A sustained, constant 8% climb, densely spaced (every 100 m, well under
// gradient.ts's MAX_ELEVATION_GAP_METRES) and long enough to clear both
// MIN_GRADE_WINDOW_METRES and GRADE_BASELINE_WINDOW_METRES — so every view
// (pre-start, Full, windowed) should classify it identically as
// "hard-climb" throughout. Shared by the "gradient integration" and
// "pre-ride selected-climb chart" describe blocks below.
const CLIMB_STEP_METRES = 100;
const CLIMB_POINT_COUNT = 41; // 4000 m total
const CLIMB_GRADE_PERCENT = 8;
const climbRoute: PlannedRoute = {
  ...route,
  points: Array.from({ length: CLIMB_POINT_COUNT }, (_, index) => {
    const distanceFromStartMetres = index * CLIMB_STEP_METRES;
    return {
      coordinate: [0.0001 * index, 51] as const,
      elevationMetres: (distanceFromStartMetres * CLIMB_GRADE_PERCENT) / 100,
      distanceFromStartMetres,
    };
  }),
  distanceMetres: (CLIMB_POINT_COUNT - 1) * CLIMB_STEP_METRES,
};

function pointAt(index: number): Coordinate {
  return routePoints[index]?.coordinate ?? [0, 51];
}

/** Linearly interpolates intermediate points between each consecutive
 * "keyframe" so a route shaped by a few widely-spaced elevation/position
 * waypoints — a convenient shorthand for defining a fixture's overall
 * profile — stays within gradient.ts's MAX_ELEVATION_GAP_METRES between
 * any two adjacent points, matching how real GPX/ORS data is always
 * densely sampled. Every keyframe's own distance/elevation/coordinate is
 * preserved exactly; only points strictly between them are synthesised. */
function densifyElevationRoute(
  keyframes: readonly RoutePoint[],
  stepMetres = 250,
): RoutePoint[] {
  const result: RoutePoint[] = [];
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const start = keyframes[i];
    const end = keyframes[i + 1];
    if (!start || !end) continue;
    const span = end.distanceFromStartMetres - start.distanceFromStartMetres;
    const steps = Math.max(1, Math.ceil(span / stepMetres));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const startElevation = start.elevationMetres ?? 0;
      const endElevation = end.elevationMetres ?? 0;
      result.push({
        coordinate: [
          start.coordinate[0] + t * (end.coordinate[0] - start.coordinate[0]),
          start.coordinate[1] + t * (end.coordinate[1] - start.coordinate[1]),
        ],
        elevationMetres: startElevation + t * (endElevation - startElevation),
        distanceFromStartMetres: start.distanceFromStartMetres + t * span,
      });
    }
  }
  const last = keyframes.at(-1);
  if (last) result.push(last);
  return result;
}

// The route isn't due-north, so its own tangent bearing isn't a clean
// round number — computed here via the same production function rather
// than a hand-derived magic float, since these tests are about camera
// behaviour, not bearing precision (see bearing.test.ts/rideCamera.test.ts
// for that).
function expectedBearingAt(index: number): number {
  const distance = routePoints[index]?.distanceFromStartMetres ?? 0;
  return routeTangentBearingDegrees(routePoints, distance) ?? 0;
}

function buildStubGeolocationSource(): {
  source: GeolocationSource;
  emitFix: (fix: GeolocationFix) => void;
  emitError: (error: GeolocationError) => void;
  watchPositionSpy: ReturnType<typeof vi.fn>;
} {
  let onFixListener: ((fix: GeolocationFix) => void) | undefined;
  let onErrorListener: ((error: GeolocationError) => void) | undefined;

  const watchPositionSpy = vi.fn(
    (
      onFix: (fix: GeolocationFix) => void,
      onError: (error: GeolocationError) => void,
    ) => {
      onFixListener = onFix;
      onErrorListener = onError;
      return vi.fn();
    },
  );

  return {
    source: { watchPosition: watchPositionSpy },
    emitFix: (fix) => onFixListener?.(fix),
    emitError: (error) => onErrorListener?.(error),
    watchPositionSpy,
  };
}

function buildStubMapFactory(): {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerTileError: () => void;
  triggerUserCameraInteraction: () => void;
  triggerCameraSettled: (camera: {
    coordinate: Coordinate;
    zoom: number;
    bearingDegrees: number;
    pitchDegrees: number;
  }) => void;
  setCameraSpy: ReturnType<typeof vi.fn>;
  getZoomSpy: ReturnType<typeof vi.fn>;
  fitBoundsSpy: ReturnType<typeof vi.fn>;
} {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let errorListener: (() => void) | undefined;
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
  const getZoomSpy = vi.fn(() => 14);
  const fitBoundsSpy = vi.fn();
  const factory: MapFactory = () => {
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
      fitBounds: fitBoundsSpy,
      getCenter: () => [0, 0],
      getZoom: getZoomSpy,
      onUserCameraInteraction: (listener) => {
        userCameraInteractionListener = listener;
      },
      onCameraSettled: (listener) => {
        cameraSettledListener = listener;
      },
      setCamera: setCameraSpy,
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
      // Real MapLibre always fires "style.load" strictly before "load" —
      // mirror that here so route/position data (now gated on style
      // readiness, not full load) is populated before camera/position
      // assertions run.
      styleLoadedListener?.();
      loadListener?.();
    },
    triggerTileError: () => errorListener?.(),
    triggerUserCameraInteraction: () => userCameraInteractionListener?.(),
    triggerCameraSettled: (camera) => cameraSettledListener?.(camera),
    setCameraSpy,
    getZoomSpy,
    fitBoundsSpy,
  };
}

function buildFixedClock(startMs: number): Clock {
  return { now: () => startMs };
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

describe("RidingScreen", () => {
  it("never requests a geolocation watch before the user taps Start riding", () => {
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(stub.watchPositionSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
  });

  it("shows total distance and ascent from the very start, even before Start riding is tapped", () => {
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    const expectedKm = (route.distanceMetres / 1000).toFixed(1);
    expect(screen.getByText(`${expectedKm} km · 2 m ascent`)).toBeInTheDocument();
  });

  it("shows 'ascent not available' when the route has no elevation data", () => {
    const stub = buildStubGeolocationSource();
    const routeWithoutElevation: PlannedRoute = { ...route, ascentMetres: null };
    render(
      <RidingScreen
        route={routeWithoutElevation}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(screen.getByText(/ascent not available/)).toBeInTheDocument();
  });

  it("shows the route map before Start riding is tapped, without the elevation window selector", () => {
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Elevation profile view" })).toBeNull();
  });

  it("shows the entire elevation profile before riding starts, then switches to the windowed view once riding", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    // A peak past the default 5 km window, so the full pre-ride profile
    // (10-90 m) and the windowed in-ride profile (10-20 m) are provably
    // different, not just "some chart rendered".
    const elevationRoute: PlannedRoute = {
      ...route,
      points: densifyElevationRoute([
        { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
        { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 2000 },
        { coordinate: [0.02, 51], elevationMetres: 15, distanceFromStartMetres: 4000 },
        { coordinate: [0.03, 51], elevationMetres: 90, distanceFromStartMetres: 7000 },
        { coordinate: [0.04, 51], elevationMetres: 80, distanceFromStartMetres: 8000 },
      ]),
      distanceMetres: 8000,
    };
    render(
      <RidingScreen
        route={elevationRoute}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(await screen.findByText(/10–90 m/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Elevation profile view" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    stub.emitFix({
      coordinate: [0, 51],
      accuracyMetres: 5,
      timestampMs: 1000,
      speedMetresPerSecond: null,
      headingDegrees: null,
    });

    const elevationWindowGroup = await screen.findByRole("group", {
      name: "Elevation profile view",
    });
    expect(elevationWindowGroup).toBeInTheDocument();
    expect(elevationWindowGroup).toHaveClass("elevation-window-group");
    // Default 5 km window from distance 0 runs [0, 5000], which includes an
    // interpolated boundary sample at 5000 m (between the 4000 m/15 m and
    // 7000 m/90 m points) rather than stopping at the last raw point
    // before the window edge — the literal fix for the rebasing bug: the
    // old behaviour would have shown 10–20 m here, clipping the boundary
    // instead of interpolating it.
    expect(await screen.findByText(/10–40 m/)).toBeInTheDocument();
  });

  it("shows a smoothed (not raw) elevation range, diluting an isolated single-sample spike", () => {
    const spikeRoute: PlannedRoute = {
      ...route,
      points: Array.from({ length: 60 }, (_, i) => ({
        coordinate: [i * 0.0001, 51] as const,
        elevationMetres: i === 30 ? 50 : 10,
        distanceFromStartMetres: i * 20,
      })),
      distanceMetres: 59 * 20,
    };
    const { container } = render(
      <RidingScreen
        route={spikeRoute}
        geolocationSource={buildStubGeolocationSource().source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );
    const figcaption = container.querySelector("figcaption");
    const match = /(\d+)–(\d+) m/.exec(figcaption?.textContent ?? "");
    expect(match).not.toBeNull();
    const maxElevationShown = Number(match?.[2]);
    // Plotting route.points raw would show a max of exactly 50 (the spike
    // itself); the shared smoothed analysis (analyzeRouteElevationProfile)
    // dilutes an isolated single-sample spike substantially, proving the
    // chart is driven by that analysis rather than the raw points.
    expect(maxElevationShown).toBeLessThan(30);
  });

  it("starts watching only after the explicit tap, and shows a waiting state before a fix arrives", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));

    expect(stub.watchPositionSpy).toHaveBeenCalledOnce();
    expect(screen.getByText(/waiting for a gps fix/i)).toBeInTheDocument();
  });

  it("shows GPS accuracy, live status and on-route state once a fix arrives", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    const clock = buildFixedClock(10_000);
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
        clock={clock}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    stub.emitFix({
      coordinate: pointAt(0),
      accuracyMetres: 7.4,
      timestampMs: 10_000,
      speedMetresPerSecond: null,
      headingDegrees: null,
    });

    expect(await screen.findByText(/±7 m/)).toBeInTheDocument();
    expect(screen.getByText(/Live/)).toBeInTheDocument();
    expect(screen.getByText("On route")).toBeInTheDocument();
  });

  it("shows an explicit permission-denied state and lets the user retry", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    stub.emitError({ reason: "permission-denied", message: "denied" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/location permission was denied/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("raises an off-route alert only after enough consecutive far fixes", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));

    // Prime a match on the route first: a fix with no prior match always
    // does a whole-route reacquire, which is itself untrusted and so
    // wouldn't count toward the off-route streak.
    stub.emitFix({
      coordinate: pointAt(5),
      accuracyMetres: 5,
      timestampMs: 1000,
      speedMetresPerSecond: null,
      headingDegrees: null,
    });
    await screen.findByText("On route");

    const farCoordinate: Coordinate = [
      0.005,
      51 + (OFF_ROUTE_BASE_METRES + 50) / 111_000,
    ];
    for (let i = 0; i < 3; i += 1) {
      stub.emitFix({
        coordinate: farCoordinate,
        accuracyMetres: 5,
        timestampMs: 2000 + i * 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("Off route");
  });

  it("switches the upcoming elevation window when a different option is tapped", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    stub.emitFix({
      coordinate: pointAt(0),
      accuracyMetres: 5,
      timestampMs: 1000,
      speedMetresPerSecond: null,
      headingDegrees: null,
    });

    const fiveKmButton = await screen.findByRole("button", { name: "5 km" });
    expect(fiveKmButton).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "10 km" }));

    expect(screen.getByRole("button", { name: "10 km" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(fiveKmButton).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a Full-mode marker and accessible position text for the current route position when Full is selected", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    const elevationRoute: PlannedRoute = {
      ...route,
      points: densifyElevationRoute([
        { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
        { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 2000 },
        { coordinate: [0.02, 51], elevationMetres: 15, distanceFromStartMetres: 4000 },
      ]),
      distanceMetres: 4000,
    };
    render(
      <RidingScreen
        route={elevationRoute}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    stub.emitFix({
      coordinate: [0.005, 51],
      accuracyMetres: 5,
      timestampMs: 1000,
      speedMetresPerSecond: null,
      headingDegrees: null,
    });

    await user.click(await screen.findByRole("button", { name: "Full" }));

    expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByText(/Current route position:/)).toBeInTheDocument();
    // Full mode shows the whole route's elevation range, not a windowed slice.
    expect(screen.getByText(/10–20 m/)).toBeInTheDocument();
  });

  it("restores a previously selected Full view as stale, then marks the position fresh once a new fix arrives", async () => {
    const elevationRoute: PlannedRoute = {
      ...route,
      points: densifyElevationRoute([
        { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
        { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 2000 },
        { coordinate: [0.02, 51], elevationMetres: 15, distanceFromStartMetres: 4000 },
      ]),
      distanceMetres: 4000,
    };

    await setActiveRideState({
      id: "active",
      routeId: elevationRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: [0.005, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 1,
      matchedDistanceFromStartMetres: 2000,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      elevationViewMode: { kind: "full" },
      lastReliableMatchedPointIndex: 1,
      lastReliableMatchedDistanceFromStartMetres: 2000,
    });

    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={elevationRoute}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    expect(await screen.findByText(/Last known position:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(await screen.findByRole("button", { name: "Resume riding" }));
    stub.emitFix({
      coordinate: [0.005, 51],
      accuracyMetres: 5,
      timestampMs: 2000,
      speedMetresPerSecond: null,
      headingDegrees: null,
    });

    await waitFor(() => {
      expect(screen.getByText(/Current route position:/)).toBeInTheDocument();
    });
  });

  describe("gradient integration", () => {
    it("shows no climb selected by default pre-ride ('All route'), with the recognised-climb count and no numbered heading", () => {
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      // No climb is auto-selected before any fix — the rider must pick one
      // explicitly from the dropdown.
      expect(screen.getByRole("combobox", { name: "Recognised climbs" })).toHaveValue(
        "all",
      );
      expect(screen.getByText("1 recognised climb on this route")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Climb 1/ })).toBeNull();
    });

    it("shows the numbered details heading and detailed local-gradient overlay once a climb is explicitly selected from the dropdown", async () => {
      const user = userEvent.setup();
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      // 4000 m at 8% -> climbScore 32000 -> category-2 (32000 to <64000).
      expect(
        screen.getByRole("heading", { name: "Climb 1 · Category 2" }),
      ).toBeInTheDocument();
      // With a climb selected, its detailed local-gradient overlay shows
      // too — "Hard climb" is this constant-8%-grade climb's own class.
      expect(screen.getByText(/Hard climb/)).toBeInTheDocument();
    });

    it("hides the pre-ride climb selector once riding starts, and does not let the stale pre-ride selection override the active climb", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      expect(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      expect(screen.queryByRole("combobox", { name: "Recognised climbs" })).toBeNull();

      // Before any fix, the pre-ride selection has already been cleared
      // by starting, so no feature is shown as selected/active yet.
      expect(screen.queryByRole("heading", { name: /Climb 1/ })).toBeNull();

      // Once a fix lands on the climb, it becomes active on its own
      // merits (not because of the earlier pre-ride selection), and its
      // (unnumbered, mid-ride) heading appears.
      stub.emitFix({
        coordinate: [0.002, 51],
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      expect(
        await screen.findByRole("heading", { name: "Category 2 climb" }),
      ).toBeInTheDocument();
    });

    it("does not carry over an explicit climb selection when the route changes", async () => {
      const user = userEvent.setup();
      const otherClimbRoute: PlannedRoute = {
        ...climbRoute,
        id: "other-climb-route",
        points: climbRoute.points.map((point) => ({ ...point })),
      };
      const { unmount } = render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      expect(
        screen.getByRole("heading", { name: "Climb 1 · Category 2" }),
      ).toBeInTheDocument();
      unmount();

      render(
        <RidingScreen
          route={otherClimbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      // The new route's own id no longer matches the earlier explicit
      // selection, so it falls back to "All route" rather than reusing the
      // old route's selected climb.
      expect(screen.getByRole("combobox", { name: "Recognised climbs" })).toHaveValue(
        "all",
      );
      expect(screen.queryByRole("heading", { name: "Climb 1 · Category 2" })).toBeNull();
    });

    it("shows the same gradient class and macro feature category in both the default windowed view and Full view", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: [0.002, 51],
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      // Default view is the 5 km window. Once the fix lands, the rider is
      // "on" the whole-route climb, so it becomes active and its detailed
      // local-gradient colouring appears alongside the unchanged macro
      // category — both derived from the identical full-route feature
      // boundaries regardless of which window is currently displayed.
      expect(await screen.findByText(/Hard climb/)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Category 2 climb" }),
      ).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Full" }));
      expect(await screen.findByText(/Hard climb/)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Category 2 climb" }),
      ).toBeInTheDocument();
    });

    it("keeps showing the pre-off-route active feature's detail once strongly off-route, using the frozen presentation distance rather than raw live progress", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      // Reuses the exact route/fixture/off-route geometry already proven
      // reliable by "keeps the Full-mode elevation marker pinned..."
      // above, just with elevation added (a steady ~5.4% grade over the
      // whole ~1113 m route — length/gradient/score all comfortably clear
      // recognised-climb eligibility, forming one "uncategorised" climb).
      const elevationRoute: PlannedRoute = {
        ...route,
        points: routePoints.map((point, index) => ({
          ...point,
          elevationMetres: index * 3,
        })),
      };
      render(
        <RidingScreen
          route={elevationRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(5),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await screen.findByText("On route");
      expect(
        screen.getByRole("heading", { name: "Uncategorised climb" }),
      ).toBeInTheDocument();

      const farCoordinate: Coordinate = [
        0.005,
        51 + (OFF_ROUTE_BASE_METRES + 50) / 111_000,
      ];
      for (let i = 0; i < 3; i += 1) {
        stub.emitFix({
          coordinate: farCoordinate,
          accuracyMetres: 5,
          timestampMs: 2000 + i * 1000,
          speedMetresPerSecond: null,
          headingDegrees: null,
        });
      }
      expect(await screen.findByRole("alert")).toHaveTextContent("Off route");

      // The active feature — and its detailed colouring — is derived from
      // the frozen presentation distance, so it stays exactly the climb
      // the rider was last reliably on, not whatever the raw off-route
      // fixes might otherwise imply.
      expect(
        screen.getByRole("heading", { name: "Uncategorised climb" }),
      ).toBeInTheDocument();
    });

    it("tapping the elevation chart while on the active climb drills into the tapped local-gradient segment, with a working clear control", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 320,
        height: 96,
        right: 320,
        bottom: 96,
        x: 0,
        y: 0,
        toJSON: () => "",
      });
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: [0.002, 51],
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await user.click(await screen.findByRole("button", { name: "Full" }));

      // The rider is already on the climb, so it's "active" and its
      // feature-level details panel already shows — but no segment is
      // selected yet, so there's no segment-details panel.
      await screen.findByRole("region", { name: "Route feature details" });
      expect(
        screen.queryByRole("region", { name: "Gradient segment details" }),
      ).toBeNull();

      const hitTarget = await screen.findByRole("img", {
        name: "Elevation profile chart",
      });
      const tapTarget = hitTarget.parentElement?.querySelector(
        "rect.elevation-chart-tap-target",
      );
      expect(tapTarget).not.toBeNull();
      if (!tapTarget) throw new Error("expected a tap-target rect");
      // The whole route is one climb, so any tap inside it (rather than
      // outside every feature) resolves to the finer-grained local-
      // gradient segment there, not a redundant re-selection of the
      // already-active feature — see resolveElevationChartTap's own
      // priority rule.
      fireEvent.click(tapTarget, { clientX: 160, clientY: 48 });

      const segmentPanel = await screen.findByRole("region", {
        name: "Gradient segment details",
      });
      expect(
        within(segmentPanel).getByRole("heading", { name: /Hard climb/ }),
      ).toBeInTheDocument();
      // The feature-level panel is untouched by the segment drill-down.
      expect(
        screen.getByRole("heading", { name: "Category 2 climb" }),
      ).toBeInTheDocument();

      const clearButton = within(segmentPanel).getByRole("button", {
        name: "Clear selection",
      });
      await user.click(clearButton);

      expect(
        screen.queryByRole("region", { name: "Gradient segment details" }),
      ).toBeNull();
      // Clearing the segment selection never touches the feature-level
      // selection/activity — the feature panel stays exactly as it was.
      expect(
        screen.getByRole("heading", { name: "Category 2 climb" }),
      ).toBeInTheDocument();

      vi.restoreAllMocks();
    });

    it("shows the explanatory empty state and no dropdown when the route has elevation but no recognised climbs", () => {
      const gentleRoute: PlannedRoute = {
        ...route,
        // 200 m at a 2.5% average grade — under both the 500 m length and
        // 3% average-gradient recognised-climb thresholds.
        points: Array.from({ length: 11 }, (_, index) => ({
          coordinate: [0.0001 * index, 51] as const,
          elevationMetres: index * 0.5,
          distanceFromStartMetres: index * 20,
        })),
        distanceMetres: 200,
      };
      render(
        <RidingScreen
          route={gentleRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      expect(
        screen.getByText(
          "No recognised climbs. A recognised climb must be at least 500 m long and average at least 3%.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Recognised climbs" })).toBeNull();
    });

    it("restores the climb's details panel when re-selected from the dropdown after clearing to All route", async () => {
      const user = userEvent.setup();
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      const select = screen.getByRole("combobox", { name: "Recognised climbs" });
      await user.selectOptions(select, "All route");
      expect(screen.queryByRole("heading", { name: /Climb 1/ })).toBeNull();

      await user.selectOptions(select, "climb-0");
      expect(
        screen.getByRole("heading", { name: "Climb 1 · Category 2" }),
      ).toBeInTheDocument();
    });

    it("does not trigger an additional camera fit when a climb is selected from the pre-ride dropdown", async () => {
      const user = userEvent.setup();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();
      // The initial route-overview fit happens asynchronously (a React
      // effect flush after the load callback), so it must be allowed to
      // settle before capturing the "before selection" baseline —
      // otherwise this test would race it and count it as caused by the
      // dropdown instead.
      await waitFor(() => {
        expect(map.fitBoundsSpy).toHaveBeenCalled();
      });
      const callsBeforeSelection = map.fitBoundsSpy.mock.calls.length;

      const select = screen.getByRole("combobox", { name: "Recognised climbs" });
      await user.selectOptions(select, "All route");
      await user.selectOptions(select, "climb-0");

      expect(map.fitBoundsSpy.mock.calls.length).toBe(callsBeforeSelection);
    });

    it("preserves an explicitly-selected feature across a mid-ride 'Try again' retry, rather than clearing it like a fresh pre-ride start", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 320,
        height: 96,
        right: 320,
        bottom: 96,
        x: 0,
        y: 0,
        toJSON: () => "",
      });
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      // Starting the ride clears the pre-ride selection (the idle-guarded
      // handleStart clear) — confirmed by no heading shown before a fix.
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      expect(screen.queryByRole("heading", { name: /Climb/ })).toBeNull();

      fake.watches[0]?.emitFix({
        coordinate: [0.002, 51],
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await user.click(await screen.findByRole("button", { name: "Full" }));

      // Explicitly drill into the active climb's own local-gradient
      // segment via a chart tap — a genuine mid-ride selection, distinct
      // from merely being "active".
      const hitTarget = await screen.findByRole("img", {
        name: "Elevation profile chart",
      });
      const tapTarget = hitTarget.parentElement?.querySelector(
        "rect.elevation-chart-tap-target",
      );
      if (!tapTarget) throw new Error("expected a tap-target rect");
      fireEvent.click(tapTarget, { clientX: 160, clientY: 48 });
      await screen.findByRole("region", { name: "Gradient segment details" });

      // A GPS error occurs mid-ride (geolocationStatus becomes "error",
      // not "idle") and the rider taps the same Try again/Start handler.
      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      await user.click(screen.getByRole("button", { name: "Try again" }));

      // The idle-only guard means this retry must NOT have cleared the
      // mid-ride segment selection, unlike a genuine fresh pre-ride start.
      expect(
        screen.getByRole("region", { name: "Gradient segment details" }),
      ).toBeInTheDocument();

      vi.restoreAllMocks();
    });

    it("shows no gradient-colours disclosure for a route with no elevation data (the chart's own missing-elevation message already covers this)", () => {
      render(
        <RidingScreen
          route={route}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      expect(
        screen.getByText("Elevation data is not available for this route."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Gradient colours")).toBeNull();
    });
  });

  describe("pre-ride selected-climb chart", () => {
    // Two distinct recognised climbs (verified against the real
    // detectRouteFeatures output before writing these assertions, since
    // smoothing shifts boundaries slightly from the raw keyframes): climb-0
    // (0-1000 m, category-4) and climb-1260 (1260-2250 m, category-4),
    // separated by a short, brisk descent too short (990 m apart, well
    // under nothing relevant here — the dip itself is only ~260 m) to
    // register as its own recognised descent.
    const twoClimbRoute: PlannedRoute = {
      ...route,
      id: "two-climb-route",
      points: densifyElevationRoute(
        [
          { coordinate: [0, 51], elevationMetres: 0, distanceFromStartMetres: 0 },
          { coordinate: [0.001, 51], elevationMetres: 85, distanceFromStartMetres: 1000 },
          {
            coordinate: [0.00125, 51],
            elevationMetres: 55,
            distanceFromStartMetres: 1250,
          },
          {
            coordinate: [0.00225, 51],
            elevationMetres: 140,
            distanceFromStartMetres: 2250,
          },
        ],
        100,
      ),
      distanceMetres: 2250,
    };

    // A single recognised climb (0-2000 m, category-4) with a genuine 300 m
    // flat section in its middle (1000-1300 m) — verified via the real
    // analysis to remain ONE climb feature (the flat stretch never splits
    // it) while its own local-gradient segments classify in three pieces:
    // hard-climb (0-980), gentle-or-descending (980-1300), hard-climb
    // (1300-2000).
    const FLAT_DIP_STEP_METRES = 100;
    const FLAT_DIP_GRADE_PERCENT = 6;
    const FLAT_START_METRES = 1000;
    const FLAT_END_METRES = 1300;
    const FLAT_DIP_TOTAL_METRES = 2000;
    function flatDipElevationAt(distanceMetres: number): number {
      const elevationAtFlatStart = (FLAT_START_METRES * FLAT_DIP_GRADE_PERCENT) / 100;
      if (distanceMetres <= FLAT_START_METRES) {
        return (distanceMetres * FLAT_DIP_GRADE_PERCENT) / 100;
      }
      if (distanceMetres <= FLAT_END_METRES) {
        return elevationAtFlatStart;
      }
      return (
        elevationAtFlatStart +
        ((distanceMetres - FLAT_END_METRES) * FLAT_DIP_GRADE_PERCENT) / 100
      );
    }
    const flatDipRoute: PlannedRoute = {
      ...route,
      id: "flat-dip-route",
      points: Array.from(
        { length: FLAT_DIP_TOTAL_METRES / FLAT_DIP_STEP_METRES + 1 },
        (_, index) => {
          const distanceFromStartMetres = index * FLAT_DIP_STEP_METRES;
          return {
            coordinate: [0.0001 * index, 51] as const,
            elevationMetres: flatDipElevationAt(distanceFromStartMetres),
            distanceFromStartMetres,
          };
        },
      ),
      distanceMetres: FLAT_DIP_TOTAL_METRES,
    };

    it("renders a detailed elevation chart directly between the selected climb's heading and its facts", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      const heading = screen.getByRole("heading", { name: "Climb 1 · Category 2" });
      const chart = screen.getByRole("img", { name: "Elevation profile for Climb 1" });
      const facts = screen.getByText(/Route position:/);

      // DOCUMENT_POSITION_FOLLOWING (4).
      expect(heading.compareDocumentPosition(chart) & 4).toBe(4);
      expect(chart.compareDocumentPosition(facts) & 4).toBe(4);
      expect(
        container.querySelector("section.route-feature-details")?.contains(chart),
      ).toBe(true);
    });

    it("covers the selected climb's complete start-to-end interval", async () => {
      const user = userEvent.setup();
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      const chart = screen.getByRole("img", { name: "Elevation profile for Climb 1" });
      const path = chart.querySelector("path.elevation-chart-area-fill");
      // Default chart width is 320; the climb's own start/finish map to the
      // chart's own left/right edges.
      expect(path?.getAttribute("d")).toMatch(/^M 0\.00 /);
      expect(path?.getAttribute("d")).toContain("L 320.00 ");
    });

    it("updates heading, chart accessible name and facts together when the dropdown selection changes", async () => {
      const user = userEvent.setup();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      expect(
        screen.getByRole("heading", { name: "Climb 1 · Category 4" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "Elevation profile for Climb 1" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Route position: 0\.0–1\.0 km/)).toBeInTheDocument();

      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-1260",
      );

      expect(
        screen.getByRole("heading", { name: "Climb 2 · Category 4" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Climb 1 · Category 4" })).toBeNull();
      expect(
        screen.getByRole("img", { name: "Elevation profile for Climb 2" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("img", { name: "Elevation profile for Climb 1" }),
      ).toBeNull();
      expect(screen.getByText(/Route position: 1\.3–2\.3 km/)).toBeInTheDocument();
    });

    it("shows no rider-position marker, completed/remaining split, or progress text", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      const chart = screen.getByRole("img", { name: "Elevation profile for Climb 1" });
      expect(chart.querySelector("line.elevation-chart-marker")).toBeNull();
      expect(chart.querySelector("circle.elevation-chart-marker-dot")).toBeNull();
      expect(chart.querySelector("path.elevation-chart-completed")).toBeNull();
      expect(screen.queryByText(/Current route position:/)).toBeNull();
      expect(screen.queryByText(/Last known position:/)).toBeNull();
      // The full-route overview chart is the only other rendered chart —
      // it also has no marker pre-ride, so this isn't double-counting.
      expect(container.querySelectorAll("line.elevation-chart-marker")).toHaveLength(0);
    });

    it("colours the pre-ride chart with the same authoritative MICRO_DETAIL_COLOURS as the active current-climb view", async () => {
      const user = userEvent.setup();
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      const chart = screen.getByRole("img", { name: "Elevation profile for Climb 1" });
      const fill = chart.querySelector("path.elevation-chart-area-fill");
      expect(fill?.getAttribute("fill")).toBe(MICRO_DETAIL_COLOURS["hard-climb"]);
    });

    it("retains the correct local-gradient treatment for a short flat section inside a recognised climb", async () => {
      const user = userEvent.setup();
      render(
        <RidingScreen
          route={flatDipRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      expect(
        screen.getByRole("img", { name: "Elevation profile for Climb 1" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Hard climb/)).toBeInTheDocument();
      expect(screen.getByText(/Gentle, flat or brief descent/)).toBeInTheDocument();
    });

    it("shows no additional chart alongside the existing empty state when the route has no recognised climbs", () => {
      const gentleRoute: PlannedRoute = {
        ...route,
        points: Array.from({ length: 11 }, (_, index) => ({
          coordinate: [0.0001 * index, 51] as const,
          elevationMetres: index * 0.5,
          distanceFromStartMetres: index * 20,
        })),
        distanceMetres: 200,
      };
      render(
        <RidingScreen
          route={gentleRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      expect(
        screen.getByText(
          "No recognised climbs. A recognised climb must be at least 500 m long and average at least 3%.",
        ),
      ).toBeInTheDocument();
      // Only the full-route overview chart is rendered — no second,
      // climb-specific chart.
      expect(screen.getAllByRole("img")).toHaveLength(1);
    });

    it("does not call geolocation or require an active ride to render the pre-ride preview", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Recognised climbs" }),
        "climb-0",
      );
      expect(
        screen.getByRole("img", { name: "Elevation profile for Climb 1" }),
      ).toBeInTheDocument();
      expect(stub.watchPositionSpy).not.toHaveBeenCalled();
    });

    it("renders the pre-ride chart without throwing when idle with a restored in-progress ride (geolocationStatus idle but progress already restored)", async () => {
      await setActiveRideState({
        id: "active",
        routeId: climbRoute.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: [0.005, 51], accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: 500,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationViewMode: { kind: "full" },
        lastReliableMatchedPointIndex: 5,
        lastReliableMatchedDistanceFromStartMetres: 500,
      });

      render(
        <RidingScreen
          route={climbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      // Still idle (the rider hasn't tapped "Resume riding" yet), so the
      // pre-ride selector/panel/chart still show for the same dropdown-
      // selected climb without throwing. In this specific restored state,
      // the restored progress also makes the (unrelated, already-existing)
      // top-of-screen chart show its own active Climb view/progress panel
      // simultaneously — a pre-existing quirk of this exact combination,
      // not something this slice changes or fixes — so more than one
      // "Climb 1 · Category 2" heading can legitimately appear; the point
      // of this test is that nothing throws and the pre-ride preview
      // chart, specifically, still renders for the right climb.
      expect(
        await screen.findByRole("button", { name: "Resume riding" }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("heading", { name: "Climb 1 · Category 2" }).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByRole("img", { name: "Elevation profile for Climb 1" }),
      ).toBeInTheDocument();
    });
  });

  describe("current-climb elevation view", () => {
    // Two distinct recognised climbs separated by a short reversal dip too
    // brief to qualify as its own recognised descent (250 m, under
    // routeFeatures.ts's 500 m MIN_FEATURE_LENGTH_METRES) but well past its
    // reversal-confirmation thresholds (a 30 m drop, comfortably over the
    // 10 m/200 m REVERSAL_BRIDGE thresholds) — so the two climbs are
    // reliably detected as genuinely separate features. Boundaries below
    // are the actual detectRouteFeatures output for this exact fixture
    // (verified directly against the real analysis before writing these
    // assertions), not hand-estimated from the keyframes, since smoothing
    // shifts them slightly from the raw keyframe distances.
    // Longitude-per-metre conversion at latitude 51°N, so each keyframe's
    // own coordinate is genuinely consistent with its declared
    // distanceFromStartMetres — projectFixOntoRoute measures matched
    // distance from real (turf-computed) geometric distance along the
    // polyline, not from these labels directly, so an inconsistent
    // conversion would let matched distance silently drift away from the
    // intended target the further along the route a fix is placed.
    const LON_PER_METRE = 1 / (111_320 * Math.cos((51 * Math.PI) / 180));
    function lonAt(distanceMetres: number): number {
      return distanceMetres * LON_PER_METRE;
    }
    const twoClimbRoute: PlannedRoute = {
      ...route,
      id: "two-climb-route",
      points: densifyElevationRoute(
        [
          { coordinate: [lonAt(0), 51], elevationMetres: 10, distanceFromStartMetres: 0 },
          {
            coordinate: [lonAt(500), 51],
            elevationMetres: 10,
            distanceFromStartMetres: 500,
          },
          {
            coordinate: [lonAt(1200), 51],
            elevationMetres: 52,
            distanceFromStartMetres: 1200,
          },
          {
            coordinate: [lonAt(1450), 51],
            elevationMetres: 22,
            distanceFromStartMetres: 1450,
          },
          {
            coordinate: [lonAt(2450), 51],
            elevationMetres: 222,
            distanceFromStartMetres: 2450,
          },
          {
            coordinate: [lonAt(2950), 51],
            elevationMetres: 222,
            distanceFromStartMetres: 2950,
          },
        ],
        50,
      ),
      distanceMetres: 2950,
    };
    // Real detectRouteFeatures output for the fixture above: climb-460
    // (460-1180 m, uncategorised) and climb-1440 (1440-2500 m, category-3).
    const CLIMB_1_MID_METRES = 800; // inside [460, 1180]
    const CLIMB_2_MID_METRES = 2000; // inside [1440, 2500]
    const BETWEEN_CLIMBS_METRES = 1300; // inside the dip, outside both climbs

    function coordinateAt(distanceMetres: number): Coordinate {
      const point = twoClimbRoute.points.find(
        (p) => Math.abs(p.distanceFromStartMetres - distanceMetres) < 1,
      );
      if (!point) {
        throw new Error(`two-climb fixture has no point near ${String(distanceMetres)}m`);
      }
      return point.coordinate;
    }

    function emitFixAt(
      stub: ReturnType<typeof buildStubGeolocationSource>,
      distanceMetres: number,
      timestampMs = 1000,
    ): void {
      stub.emitFix({
        coordinate: coordinateAt(distanceMetres),
        accuracyMetres: 5,
        timestampMs,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
    }

    it("shows no Climb option before the ride starts", () => {
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      expect(screen.queryByRole("button", { name: "Climb" })).toBeNull();
    });

    it("shows no Climb option while riding outside any recognised climb", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, BETWEEN_CLIMBS_METRES);

      await screen.findByText("On route");
      expect(screen.queryByRole("button", { name: "Climb" })).toBeNull();
    });

    it("auto-selects Climb view on entering the first recognised climb, showing climb-relative metrics with no percentage", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES);

      const climbButton = await screen.findByRole("button", { name: "Climb" });
      expect(climbButton).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("heading", { name: "Climb 1 · Uncategorised" }),
      ).toBeInTheDocument();
      const panel = screen.getByRole("region", { name: "Climb progress" });
      expect(within(panel).getByText(/km completed/)).toBeInTheDocument();
      expect(within(panel).getByText(/km remaining/)).toBeInTheDocument();
      expect(within(panel).getByText(/Elevation remaining:/)).toBeInTheDocument();
      expect(within(panel).queryByText(/%\s*(complete|done)/i)).toBeNull();
    });

    it("keeps Climb view showing without flicker across repeated fixes inside the same climb", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES - 100, 1000);
      await screen.findByRole("button", { name: "Climb" });
      emitFixAt(stub, CLIMB_1_MID_METRES, 2000);
      emitFixAt(stub, CLIMB_1_MID_METRES + 100, 3000);

      expect(await screen.findByRole("button", { name: "Climb" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("manually selecting a standard view dismisses Climb for the remainder of that climb, but it remains manually selectable", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES, 1000);
      await screen.findByRole("button", { name: "Climb" });

      await user.click(screen.getByRole("button", { name: "5 km" }));
      expect(screen.getByRole("button", { name: "Climb" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByRole("button", { name: "5 km" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // A further fix still inside the same climb must not reopen it.
      emitFixAt(stub, CLIMB_1_MID_METRES + 50, 2000);
      expect(screen.getByRole("button", { name: "Climb" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // The rider can still manually reselect Climb view.
      await user.click(screen.getByRole("button", { name: "Climb" }));
      expect(screen.getByRole("button", { name: "Climb" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("region", { name: "Climb progress" })).toBeInTheDocument();
    });

    it("returns to the rider's last standard view once they leave the climb", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES, 1000);
      await screen.findByRole("button", { name: "Climb" });

      emitFixAt(stub, BETWEEN_CLIMBS_METRES, 2000);
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Climb" })).toBeNull();
      });
      // Falls back to the app's default 5 km view, never explicitly chosen.
      expect(screen.getByRole("button", { name: "5 km" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("auto-selects Climb view again on entering a second, different climb, even though the first was dismissed", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES, 1000);
      await user.click(await screen.findByRole("button", { name: "Full" }));
      expect(screen.getByRole("button", { name: "Climb" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      emitFixAt(stub, CLIMB_2_MID_METRES, 2000);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Climb" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
      expect(
        screen.getByRole("heading", { name: "Climb 2 · Category 3" }),
      ).toBeInTheDocument();
    });

    it("never activates Climb view for a recognised descent", async () => {
      const user = userEvent.setup();
      const descentRoute: PlannedRoute = {
        ...route,
        id: "descent-route",
        points: Array.from({ length: 41 }, (_, index) => {
          const distanceFromStartMetres = index * 100;
          return {
            coordinate: [0.0001 * index, 51] as const,
            elevationMetres: 400 - (distanceFromStartMetres * 8) / 100,
            distanceFromStartMetres,
          };
        }),
        distanceMetres: 4000,
      };
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={descentRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: [0.002, 51],
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await screen.findByText("On route");
      expect(
        screen.getByRole("heading", { name: "Recognised descent" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Climb" })).toBeNull();
    });

    it("never activates Climb view for an ordinary uphill below recognised-climb thresholds", async () => {
      const user = userEvent.setup();
      const gentleRoute: PlannedRoute = {
        ...route,
        id: "gentle-route",
        // 200 m at a 2.5% average grade — under both the 500 m length and
        // 3% average-gradient recognised-climb thresholds.
        points: Array.from({ length: 11 }, (_, index) => ({
          coordinate: [0.0001 * index, 51] as const,
          elevationMetres: index * 0.5,
          distanceFromStartMetres: index * 20,
        })),
        distanceMetres: 200,
      };
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={gentleRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: [0.0005, 51],
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await screen.findByText("On route");
      expect(screen.queryByRole("button", { name: "Climb" })).toBeNull();
    });

    it("freezes Climb view's metrics and marker at the last reliable position once strongly off-route", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES, 1000);
      await screen.findByRole("button", { name: "Climb" });
      const distanceTextBefore = screen.getByText(/completed/).textContent;

      // Kept at the same route longitude as the on-route fix (so the
      // nearest point on the line stays mid-segment, not clamped to an
      // endpoint) — only the large latitude offset drives the lateral
      // distance that triggers off-route classification, matching the
      // established pattern above ("keeps the Full-mode elevation marker
      // pinned...").
      const farCoordinate: Coordinate = [
        lonAt(CLIMB_1_MID_METRES),
        51 + (OFF_ROUTE_BASE_METRES + 50) / 111_000,
      ];
      for (let i = 0; i < 3; i += 1) {
        stub.emitFix({
          coordinate: farCoordinate,
          accuracyMetres: 5,
          timestampMs: 2000 + i * 1000,
          speedMetresPerSecond: null,
          headingDegrees: null,
        });
      }
      expect(await screen.findByRole("alert")).toHaveTextContent("Off route");

      // Still showing Climb view, for the same climb, with unchanged
      // distance metrics — frozen at the last reliable position, not the
      // raw/live (now off-route) matched distance.
      expect(screen.getByRole("button", { name: "Climb" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(
        screen.getByRole("heading", { name: "Climb 1 · Uncategorised" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/completed/).textContent).toBe(distanceTextBefore);
    });

    it("renders the filled area beneath the profile with the current-position marker painted above every fill path", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES);

      const chartSvg = await screen.findByRole("img", {
        name: "Elevation profile chart",
      });
      const fillPaths = Array.from(
        chartSvg.querySelectorAll("path.elevation-chart-area-fill"),
      );
      expect(fillPaths.length).toBeGreaterThan(0);
      const markerLine = chartSvg.querySelector("line.elevation-chart-marker");
      expect(markerLine).not.toBeNull();
      if (!markerLine) throw new Error("expected a marker line");
      for (const fillPath of fillPaths) {
        expect(fillPath.compareDocumentPosition(markerLine) & 4).toBe(4);
      }
    });

    it("does not add the detailed area fill to Full or windowed elevation views", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES);
      await user.click(await screen.findByRole("button", { name: "Full" }));

      const chartSvg = await screen.findByRole("img", {
        name: "Elevation profile chart",
      });
      expect(chartSvg.querySelectorAll("path.elevation-chart-area-fill")).toHaveLength(0);
    });

    it("appends the Climb button after the four standard buttons, without disturbing their order", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES);

      const group = await screen.findByRole("group", { name: "Elevation profile view" });
      const labels = within(group)
        .getAllByRole("button")
        .map((button) => button.textContent);
      expect(labels).toEqual(["Full", "2 km", "5 km", "10 km", "Climb"]);
    });

    it("restores a climb-view dismissal for the current climb id across suspension/reload", async () => {
      await setActiveRideState({
        id: "active",
        routeId: twoClimbRoute.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: {
          coordinate: coordinateAt(CLIMB_1_MID_METRES),
          accuracyMetres: 5,
          timestampMs: 1000,
        },
        lastMatchedPointIndex: CLIMB_1_MID_METRES / 50,
        matchedDistanceFromStartMetres: CLIMB_1_MID_METRES,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationViewMode: { kind: "upcoming", windowMetres: 5000 },
        lastReliableMatchedPointIndex: CLIMB_1_MID_METRES / 50,
        lastReliableMatchedDistanceFromStartMetres: CLIMB_1_MID_METRES,
        dismissedClimbFeatureId: "climb-460",
      });

      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      const climbButton = await screen.findByRole("button", { name: "Climb" });
      expect(climbButton).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "5 km" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("defaults to not-dismissed (auto-open) for a legacy restored row with no dismissedClimbFeatureId field", async () => {
      await setActiveRideState({
        id: "active",
        routeId: twoClimbRoute.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: {
          coordinate: coordinateAt(CLIMB_1_MID_METRES),
          accuracyMetres: 5,
          timestampMs: 1000,
        },
        lastMatchedPointIndex: CLIMB_1_MID_METRES / 50,
        matchedDistanceFromStartMetres: CLIMB_1_MID_METRES,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
        lastReliableMatchedPointIndex: CLIMB_1_MID_METRES / 50,
        lastReliableMatchedDistanceFromStartMetres: CLIMB_1_MID_METRES,
      });

      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={buildStubGeolocationSource().source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      const climbButton = await screen.findByRole("button", { name: "Climb" });
      expect(climbButton).toHaveAttribute("aria-pressed", "true");
    });

    it("tapping the Climb chart drills into a local-gradient segment of the active climb, leaving the progress panel's own heading unaffected", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 320,
        height: 96,
        right: 320,
        bottom: 96,
        x: 0,
        y: 0,
        toJSON: () => "",
      });
      render(
        <RidingScreen
          route={twoClimbRoute}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      emitFixAt(stub, CLIMB_1_MID_METRES);
      await screen.findByRole("button", { name: "Climb" });

      const hitTarget = (
        await screen.findByRole("img", { name: "Elevation profile chart" })
      ).parentElement?.querySelector("rect.elevation-chart-tap-target");
      expect(hitTarget).not.toBeNull();
      if (!hitTarget) throw new Error("expected a tap-target rect");
      fireEvent.click(hitTarget, { clientX: 160, clientY: 48 });

      // Resolves to a local-gradient segment within the active climb
      // (finer-grained than the feature itself), matching the existing
      // tap-drill-down behaviour already proven for Full view — driven by
      // activeClimb's own segments, not an unrelated feature. The
      // progress panel's own heading is driven by activeClimb directly
      // and stays put regardless of this tap-driven segment selection.
      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Gradient segment details" }),
        ).toBeInTheDocument();
      });
      const progressPanel = screen.getByRole("region", { name: "Climb progress" });
      expect(
        within(progressPanel).getByRole("heading", { name: "Climb 1 · Uncategorised" }),
      ).toBeInTheDocument();

      vi.restoreAllMocks();
    });
  });

  it("keeps the Full-mode elevation marker pinned at the last reliable position once strongly off-route", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    const elevationRoute: PlannedRoute = {
      ...route,
      points: routePoints.map((point, index) => ({ ...point, elevationMetres: index })),
    };

    render(
      <RidingScreen
        route={elevationRoute}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    // Prime a match on the route first (see the off-route alert test above
    // for why): a fix with no prior match always does a whole-route
    // reacquire, which is itself untrusted.
    stub.emitFix({
      coordinate: pointAt(5),
      accuracyMetres: 5,
      timestampMs: 1000,
      speedMetresPerSecond: null,
      headingDegrees: null,
    });
    await screen.findByText("On route");

    await user.click(await screen.findByRole("button", { name: "Full" }));
    const positionTextBeforeOffRoute = (
      await screen.findByText(/Current route position:/)
    ).textContent;

    const farCoordinate: Coordinate = [
      0.005,
      51 + (OFF_ROUTE_BASE_METRES + 50) / 111_000,
    ];
    for (let i = 0; i < 3; i += 1) {
      stub.emitFix({
        coordinate: farCoordinate,
        accuracyMetres: 5,
        timestampMs: 2000 + i * 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("Off route");
    expect(screen.getByText(/Current route position:/).textContent).toBe(
      positionTextBeforeOffRoute,
    );
  });

  it("does not affect map camera/follow or north-up state when switching the elevation view mode", async () => {
    const user = userEvent.setup();
    const stub = buildStubGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={stub.source}
        mapFactory={buildStubMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    stub.emitFix({
      coordinate: pointAt(0),
      accuracyMetres: 5,
      timestampMs: 1000,
      speedMetresPerSecond: null,
      headingDegrees: null,
    });

    const followButton = await screen.findByRole("button", {
      name: "Follow my location",
    });
    expect(followButton).toHaveAttribute("aria-pressed", "true");

    await user.click(await screen.findByRole("button", { name: "Full" }));

    expect(followButton).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "North-up, top-down view" }),
    ).toBeInTheDocument();
  });

  describe("restoration", () => {
    it("restores a stale fix and prior progress, requiring an explicit Resume riding tap", async () => {
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
      });

      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(
        await screen.findByRole("button", { name: "Resume riding" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Stale/)).toBeInTheDocument();
      expect(stub.watchPositionSpy).not.toHaveBeenCalled();
    });

    it("clears the stale flag once a fresh fix arrives after resuming", async () => {
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
      });

      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(await screen.findByRole("button", { name: "Resume riding" }));
      expect(screen.getByText(/Stale/)).toBeInTheDocument();

      stub.emitFix({
        coordinate: pointAt(6),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await waitFor(() => {
        expect(screen.getByText(/Live/)).toBeInTheDocument();
      });
    });

    it("does not restore ride state belonging to a different route", async () => {
      await setActiveRideState({
        id: "active",
        routeId: "some-other-route",
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
      });

      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(
        await screen.findByRole("button", { name: "Start riding" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Stale/)).toBeNull();
    });

    it("restores a checked wake-lock preference and attempts one acquisition once visible", async () => {
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
        wakeLockDesired: true,
      });

      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const fakeWakeLock = buildFakeWakeLockSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
          wakeLockSource={fakeWakeLock.source}
        />,
      );

      // The wake-lock control (like the next-manoeuvre panel) only shows
      // once riding is genuinely active, matching Resume riding's own
      // existing "requires an explicit tap" behaviour above.
      await user.click(await screen.findByRole("button", { name: "Resume riding" }));

      expect(
        await screen.findByRole("checkbox", { name: /keep screen awake/i }),
      ).toBeChecked();
      expect(fakeWakeLock.requestSpy).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    });

    it("restores an unchecked wake-lock preference for a legacy row with no wakeLockDesired field", async () => {
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
      });

      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const fakeWakeLock = buildFakeWakeLockSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
          wakeLockSource={fakeWakeLock.source}
        />,
      );

      await user.click(await screen.findByRole("button", { name: "Resume riding" }));

      expect(
        await screen.findByRole("checkbox", { name: /keep screen awake/i }),
      ).not.toBeChecked();
      expect(fakeWakeLock.requestSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe("offline and tile-failure resilience", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("shows an explicit offline indicator while route, progress and elevation keep working", async () => {
      vi.stubGlobal("navigator", { onLine: false, geolocation: undefined });
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(screen.getByText(/^Offline/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(3),
        accuracyMetres: 6,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(await screen.findByText("On route")).toBeInTheDocument();
      expect(screen.getByText(/Remaining:/)).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: "Elevation profile view" }),
      ).toBeInTheDocument();
    });

    it("keeps off-route status, distance remaining and elevation window visible after a mid-ride tile error", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(3),
        accuracyMetres: 6,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await screen.findByText("On route");

      map.triggerLoad();
      map.triggerTileError();

      expect(await screen.findByTestId("tiles-unavailable-banner")).toBeInTheDocument();
      // The rest of the ride UI is untouched by the map's own tile failure.
      expect(screen.getByText("On route")).toBeInTheDocument();
      expect(screen.getByText(/Remaining:/)).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: "Elevation profile view" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("map-container")).toBeInTheDocument();
    });
  });

  describe("smart riding camera", () => {
    it("requests following as soon as Start riding is tapped, showing a pending state until a fresh fix arrives", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));

      const followButton = screen.getByRole("button", { name: "Follow my location" });
      expect(followButton).toHaveAttribute("aria-pressed", "true");
      expect(followButton).toHaveTextContent("Waiting…");
      expect(map.setCameraSpy).not.toHaveBeenCalled();
    });

    it("recentres the camera on the first fresh fix after starting", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledWith(
          pointAt(0),
          NAVIGATION_ZOOM,
          expectedBearingAt(0),
          FOLLOW_PITCH_DEGREES,
          { animate: true, followOffset: true },
        );
      });
      const followButton = screen.getByRole("button", { name: "Follow my location" });
      expect(followButton).toHaveTextContent("⌖");
      expect(followButton).toHaveAttribute("aria-pressed", "true");
    });

    it("keeps GPS progress updating in free mode without moving the camera again", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });
      const remainingBefore = screen.getByText(/Remaining:/).textContent;

      map.triggerUserCameraInteraction();
      expect(await screen.findByText("Map follow paused.")).toBeInTheDocument();

      stub.emitFix({
        coordinate: pointAt(8),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await waitFor(() => {
        expect(screen.getByText(/Remaining:/).textContent).not.toBe(remainingBefore);
      });
      // Progress kept moving (assertion above), but the camera itself
      // never moved again once free — still exactly the one call from
      // the earlier recentre.
      expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
    });

    it("recentres and resumes following when the follow button is pressed from free mode", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });

      map.triggerUserCameraInteraction();
      const followButton = await screen.findByRole("button", {
        name: "Follow my location",
      });
      expect(followButton).toHaveAttribute("aria-pressed", "false");

      // Position keeps tracking while free (case 7/8), so the rider has
      // moved on by the time they press follow again — proves the button
      // recentres to the *latest* position, not a stale cached one.
      stub.emitFix({
        coordinate: pointAt(5),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await user.click(followButton);

      expect(followButton).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
      });
      expect(map.setCameraSpy).toHaveBeenLastCalledWith(
        pointAt(5),
        NAVIGATION_ZOOM,
        expectedBearingAt(5),
        FOLLOW_PITCH_DEGREES,
        { animate: true, followOffset: true },
      );
    });

    it("never moves the camera for a stale restored fix, even when the persisted camera mode was following", async () => {
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
        cameraMode: "following",
      });

      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      expect(
        await screen.findByRole("button", { name: "Resume riding" }),
      ).toBeInTheDocument();
      expect(map.setCameraSpy).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Resume riding" }));

      const followButton = screen.getByRole("button", { name: "Follow my location" });
      expect(followButton).toHaveAttribute("aria-pressed", "true");
      expect(followButton).toHaveTextContent("Waiting…");
      expect(map.setCameraSpy).not.toHaveBeenCalled();
    });

    it("restores a free-panned camera position, bearing and pitch instantly, without an animated following ease", async () => {
      const freeCoordinate = pointAt(3);
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
        cameraMode: "free",
        cameraCoordinate: freeCoordinate,
        cameraZoom: 14,
        cameraBearingDegrees: 231,
        cameraPitchDegrees: 18,
      });

      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledWith(freeCoordinate, 14, 231, 18, {
          animate: false,
          followOffset: false,
        });
      });
      expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
    });

    it("resets the camera to overview when a genuinely different route is opened", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      const { rerender } = render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Follow my location" }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      const otherRoute: PlannedRoute = { ...route, id: "route-2" };
      rerender(
        <RidingScreen
          route={otherRoute}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );

      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("keeps a stable follow pitch across multiple following fixes — never oscillating", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });

      stub.emitFix({
        coordinate: pointAt(6),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
      });

      for (const call of map.setCameraSpy.mock.calls as unknown[][]) {
        expect(call[3]).toBe(FOLLOW_PITCH_DEGREES);
      }
    });

    it("north-up while following: exits to free, flattens and norths without moving centre/zoom, and pauses following", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });

      await user.click(screen.getByRole("button", { name: "North-up, top-down view" }));

      expect(map.setCameraSpy).toHaveBeenLastCalledWith(null, null, 0, 0, {
        animate: true,
        followOffset: false,
      });
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(await screen.findByText("Map follow paused.")).toBeInTheDocument();
    });

    it("the north-up control becomes pressed only once the camera has actually settled north-up", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });

      const northUpButton = screen.getByRole("button", {
        name: "North-up, top-down view",
      });
      await user.click(northUpButton);
      expect(northUpButton).toHaveAttribute("aria-pressed", "false");

      map.triggerCameraSettled({
        coordinate: pointAt(0),
        zoom: 16,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });

      await waitFor(() => {
        expect(northUpButton).toHaveAttribute("aria-pressed", "true");
      });
    });

    it("after north-up, later fixes update the position marker and navigation state but never move, rotate or tilt the camera", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });

      await user.click(screen.getByRole("button", { name: "North-up, top-down view" }));
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
      });
      const remainingBefore = screen.getByText(/Remaining:/).textContent;

      stub.emitFix({
        coordinate: pointAt(8),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await waitFor(() => {
        expect(screen.getByText(/Remaining:/).textContent).not.toBe(remainingBefore);
      });
      expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
    });

    it("pressing Follow my location from the north-up free view recentres and resumes travel-up bearing and pitch in one tap", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });

      await user.click(screen.getByRole("button", { name: "North-up, top-down view" }));
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
      });

      stub.emitFix({
        coordinate: pointAt(9),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await user.click(screen.getByRole("button", { name: "Follow my location" }));

      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(3);
      });
      expect(map.setCameraSpy).toHaveBeenLastCalledWith(
        pointAt(9),
        NAVIGATION_ZOOM,
        expectedBearingAt(9),
        FOLLOW_PITCH_DEGREES,
        { animate: true, followOffset: true },
      );
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("north-up while already free preserves centre and zoom, resets bearing and pitch, and remains free", async () => {
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      const user = userEvent.setup();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      map.triggerUserCameraInteraction();
      expect(await screen.findByText("Map follow paused.")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "North-up, top-down view" }));

      expect(map.setCameraSpy).toHaveBeenLastCalledWith(null, null, 0, 0, {
        animate: true,
        followOffset: false,
      });
      // Still free (not following) — a manual pan/rotate never becomes
      // following again on its own, and neither does north-up.
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("keeps both switching controls visible together, with the location control waiting when no fresh fix is usable", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));

      const followButton = screen.getByRole("button", { name: "Follow my location" });
      const northUpButton = screen.getByRole("button", {
        name: "North-up, top-down view",
      });
      expect(followButton).toBeInTheDocument();
      expect(northUpButton).toBeInTheDocument();
      expect(followButton).toHaveTextContent("Waiting…");
    });

    it("preserves the camera mode and reapplies the same cameraTarget after a fallback map-instance swap", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      // No triggerLoad() yet — the primary style never resolves.

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      expect(map.setCameraSpy).not.toHaveBeenCalled();

      // Primary style errors before ever loading — MapView falls back to
      // a fresh map instance (a new mapFactory() call), which then loads.
      map.triggerTileError();
      map.triggerLoad();

      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledWith(
          pointAt(0),
          NAVIGATION_ZOOM,
          expectedBearingAt(0),
          FOLLOW_PITCH_DEGREES,
          { animate: true, followOffset: true },
        );
      });
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("preserves the camera mode and reapplies the same cameraTarget after clicking Retry map imagery", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={map.factory}
        />,
      );
      // Primary style errors before ever loading — MapView falls back.
      map.triggerTileError();
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalled();
      });
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      map.setCameraSpy.mockClear();

      await user.click(screen.getByTestId("retry-map-imagery-button"));
      map.triggerLoad();

      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledWith(
          pointAt(0),
          NAVIGATION_ZOOM,
          expectedBearingAt(0),
          FOLLOW_PITCH_DEGREES,
          { animate: true, followOffset: true },
        );
      });
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  describe("geolocation retry and follow-location recovery", () => {
    it("creates a new watch on Try again after an error, and a fresh fix clears the alert and shows live GPS", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitError({ reason: "permission-denied", message: "denied" });
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/location permission was denied/i);

      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(fake.watchPositionSpy).toHaveBeenCalledTimes(2);

      fake.watches[1]?.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 6,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(await screen.findByText(/±6 m/)).toBeInTheDocument();
      expect(screen.getByText(/Live/)).toBeInTheDocument();
    });

    it("shows the Follow-location and North-up controls again after a fresh fix following Try again", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Follow my location" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "North-up, top-down view" }),
      ).toBeNull();

      await user.click(screen.getByRole("button", { name: "Try again" }));
      fake.watches[1]?.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(
        await screen.findByRole("button", { name: "Follow my location" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "North-up, top-down view" }),
      ).toBeInTheDocument();
    });

    it("requests camera follow on Try again and animates to the recovered position only once the fix is genuinely fresh", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitError({
        reason: "position-unavailable",
        message: "unavailable",
      });
      await screen.findByRole("alert");

      await user.click(screen.getByRole("button", { name: "Try again" }));
      // Following was requested but no fresh fix has arrived yet — must
      // not animate to a stale/absent position as though it were fresh.
      expect(map.setCameraSpy).not.toHaveBeenCalled();

      fake.watches[1]?.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledWith(
          pointAt(0),
          NAVIGATION_ZOOM,
          expectedBearingAt(0),
          FOLLOW_PITCH_DEGREES,
          { animate: true, followOffset: true },
        );
      });
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("a fix from the pre-retry watch after Try again produces no visible change", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      await user.click(screen.getByRole("button", { name: "Try again" }));

      fake.watches[0]?.emitFix({
        coordinate: pointAt(3),
        accuracyMetres: 5,
        timestampMs: 1500,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      // The obsolete watch's fix must not surface — the replacement watch
      // is still waiting, and the error alert must not have been affected
      // by it either.
      expect(screen.getByText(/waiting for a gps fix/i)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("manual map interaction after retry-recovery pauses follow, and Follow resumes it", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      await user.click(screen.getByRole("button", { name: "Try again" }));
      fake.watches[1]?.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });

      map.triggerUserCameraInteraction();
      const followButton = await screen.findByRole("button", {
        name: "Follow my location",
      });
      expect(followButton).toHaveAttribute("aria-pressed", "false");
      expect(await screen.findByText("Map follow paused.")).toBeInTheDocument();

      // Position keeps tracking while free, so the rider has moved on by
      // the time they press follow again — proves the button recentres
      // to the latest position, not a stale cached one (and a genuinely
      // different target, since MapView deduplicates identical
      // consecutive camera commands).
      fake.watches[1]?.emitFix({
        coordinate: pointAt(5),
        accuracyMetres: 5,
        timestampMs: 3000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await user.click(followButton);
      expect(followButton).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
      });
    });

    it("north-up works normally once recovered from a retry", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildStubMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      await user.click(screen.getByRole("button", { name: "Try again" }));
      fake.watches[1]?.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(1);
      });

      await user.click(screen.getByRole("button", { name: "North-up, top-down view" }));

      expect(map.setCameraSpy).toHaveBeenLastCalledWith(null, null, 0, 0, {
        animate: true,
        followOffset: false,
      });
      expect(screen.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("the retained fix shows as Stale, not Live, between Try again and the fresh fix", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await screen.findByText(/Live/);

      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      expect(screen.getByText(/Stale/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Try again" }));
      // Still the same retained fix, still stale — no fresh fix yet.
      expect(screen.getByText(/Stale/)).toBeInTheDocument();

      fake.watches[1]?.emitFix({
        coordinate: pointAt(1),
        accuracyMetres: 5,
        timestampMs: 3000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      expect(await screen.findByText(/Live/)).toBeInTheDocument();
    });

    it("route progress, off-route status and elevation-view selection survive error, retry and recovery unchanged", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitFix({
        coordinate: pointAt(5),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await screen.findByText("On route");
      await user.click(screen.getByRole("button", { name: "2 km" }));
      const remainingBefore = screen.getByText(/Remaining:/).textContent;

      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      await user.click(screen.getByRole("button", { name: "Try again" }));
      fake.watches[1]?.emitFix({
        coordinate: pointAt(5),
        accuracyMetres: 5,
        timestampMs: 3000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      await waitFor(() => {
        expect(screen.queryByRole("alert")).toBeNull();
      });
      expect(screen.getByText("On route")).toBeInTheDocument();
      expect(screen.getByText(/Remaining:/).textContent).toBe(remainingBefore);
      expect(screen.getByRole("button", { name: "2 km" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("a watch that errors then later succeeds on its own recovers end-to-end, without a Try again tap", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Follow my location" })).toBeNull();

      fake.watches[0]?.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(
        await screen.findByRole("button", { name: "Follow my location" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(fake.watchPositionSpy).toHaveBeenCalledOnce();
    });
  });

  describe("next manoeuvre", () => {
    const manoeuvreDistanceA = routePoints[5]?.distanceFromStartMetres ?? 0;
    const manoeuvreDistanceB = routePoints[15]?.distanceFromStartMetres ?? 0;

    const plannerRouteWithManoeuvres: PlannedRoute = {
      ...route,
      id: "route-with-manoeuvres",
      manoeuvres: [
        {
          distanceFromStartMetres: manoeuvreDistanceA,
          type: "left",
          instruction: "Turn left onto Ridge Road",
        },
        {
          distanceFromStartMetres: manoeuvreDistanceB,
          type: "finish",
          instruction: "Arrive at your destination",
        },
      ],
      source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
    };

    const plannerRouteWithoutManoeuvres: PlannedRoute = {
      ...route,
      id: "route-no-manoeuvres",
      manoeuvres: [],
      source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
    };

    const acnImportedRouteWithManoeuvres: PlannedRoute = {
      ...route,
      id: "route-acn-import",
      manoeuvres: [
        {
          distanceFromStartMetres: manoeuvreDistanceA,
          type: "left",
          instruction: "Turn left onto Ridge Road",
        },
      ],
      manoeuvreProvenance: { kind: "acn-gpx-extension", version: 1 },
      source: { kind: "gpx-import" },
    };

    const untrustedGpxImportWithManoeuvres: PlannedRoute = {
      ...route,
      id: "route-untrusted-manoeuvres",
      manoeuvres: [
        {
          distanceFromStartMetres: manoeuvreDistanceA,
          type: "left",
          instruction: "Turn left onto Ridge Road",
        },
      ],
      source: { kind: "gpx-import" },
    };

    it("does not show the next-manoeuvre panel before Start riding is tapped", () => {
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={plannerRouteWithManoeuvres}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(screen.queryByText("Turn left onto Ridge Road")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Turn information is unavailable for this route."),
      ).not.toBeInTheDocument();
    });

    it("shows the first trusted manoeuvre once riding starts and a fix arrives", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={plannerRouteWithManoeuvres}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(await screen.findByText("Turn left onto Ridge Road")).toBeInTheDocument();
    });

    it("advances to the next manoeuvre once the first is reliably passed, without regressing", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={plannerRouteWithManoeuvres}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
      await screen.findByText("Turn left onto Ridge Road");

      stub.emitFix({
        coordinate: pointAt(10),
        accuracyMetres: 5,
        timestampMs: 2000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(await screen.findByText("Arrive at your destination")).toBeInTheDocument();
      expect(screen.queryByText("Turn left onto Ridge Road")).not.toBeInTheDocument();
    });

    it("shows an unavailable message for a planner route with no usable manoeuvres", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={plannerRouteWithoutManoeuvres}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));

      expect(
        await screen.findByText("Turn information is unavailable for this route."),
      ).toBeInTheDocument();
    });

    it("shows the imported-GPX message, never an inferred turn, for an ordinary imported GPX route", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));

      expect(
        await screen.findByText(
          "No trusted turn information is available for this imported GPX. Follow the route line on the map.",
        ),
      ).toBeInTheDocument();
    });

    it("shows the first trusted manoeuvre for a GPX import carrying a valid ACN navigation extension", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={acnImportedRouteWithManoeuvres}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(await screen.findByText("Turn left onto Ridge Road")).toBeInTheDocument();
    });

    it("never shows an active manoeuvre for a gpx-import route with manoeuvres but no recorded provenance", async () => {
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={untrustedGpxImportWithManoeuvres}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(
        await screen.findByText(
          "No trusted turn information is available for this imported GPX. Follow the route line on the map.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Turn left onto Ridge Road")).not.toBeInTheDocument();
    });
  });

  describe("wake lock", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("does not render the wake-lock control before Start riding is tapped", () => {
      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
      expect(
        screen.queryByRole("checkbox", { name: /keep screen awake/i }),
      ).not.toBeInTheDocument();
    });

    it("does not render the wake-lock control, and issues no request, when navigator.wakeLock is absent", async () => {
      // No navigator stub at all — jsdom's default navigator has no
      // wakeLock property, matching a genuinely unsupported browser.
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const fakeWakeLock = buildFakeWakeLockSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
          wakeLockSource={fakeWakeLock.source}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      stub.emitFix({
        coordinate: pointAt(0),
        accuracyMetres: 5,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });

      expect(
        screen.queryByRole("checkbox", { name: /keep screen awake/i }),
      ).not.toBeInTheDocument();
      expect(fakeWakeLock.requestSpy).not.toHaveBeenCalled();
    });

    it("renders the wake-lock control once riding starts when the API is supported", async () => {
      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      expect(
        screen.queryByRole("checkbox", { name: /keep screen awake/i }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Start riding" }));

      expect(
        await screen.findByRole("checkbox", { name: /keep screen awake/i }),
      ).not.toBeChecked();
    });

    it("renders the compact wake-lock control before the route title in DOM order", async () => {
      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));

      const checkbox = await screen.findByRole("checkbox", {
        name: /keep screen awake/i,
      });
      const heading = screen.getByRole("heading", { name: route.name });

      expect(
        checkbox.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("opens the information popover from the compact row", async () => {
      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      await screen.findByRole("checkbox", { name: /keep screen awake/i });

      await user.click(screen.getByRole("button", { name: "About Keep screen awake" }));

      expect(
        screen.getByText(
          "Keeps the display on while Riding mode is visible. This may increase battery use.",
        ),
      ).toBeInTheDocument();
    });

    it("opening a different route than the one with a saved preference starts with the option off", async () => {
      await setActiveRideState({
        id: "active",
        routeId: "some-other-route",
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: null,
        lastMatchedPointIndex: 0,
        matchedDistanceFromStartMetres: 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
        wakeLockDesired: true,
      });

      vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
      const user = userEvent.setup();
      const stub = buildStubGeolocationSource();
      const fakeWakeLock = buildFakeWakeLockSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={stub.source}
          mapFactory={buildStubMapFactory().factory}
          wakeLockSource={fakeWakeLock.source}
        />,
      );

      await user.click(await screen.findByRole("button", { name: "Start riding" }));

      expect(
        await screen.findByRole("checkbox", { name: /keep screen awake/i }),
      ).not.toBeChecked();
      expect(fakeWakeLock.requestSpy).not.toHaveBeenCalled();
    });
  });
});
