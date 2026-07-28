import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "../../test/fixtures/routeGeometry.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { OFF_ROUTE_BASE_METRES } from "../../navigation/offRoute.ts";
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

function pointAt(index: number): Coordinate {
  return routePoints[index]?.coordinate ?? [0, 51];
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
      fitBounds: () => undefined,
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
      points: [
        { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
        { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 2000 },
        { coordinate: [0.02, 51], elevationMetres: 15, distanceFromStartMetres: 4000 },
        { coordinate: [0.03, 51], elevationMetres: 90, distanceFromStartMetres: 7000 },
        { coordinate: [0.04, 51], elevationMetres: 80, distanceFromStartMetres: 8000 },
      ],
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
      points: [
        { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
        { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 2000 },
        { coordinate: [0.02, 51], elevationMetres: 15, distanceFromStartMetres: 4000 },
      ],
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
      points: [
        { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
        { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 2000 },
        { coordinate: [0.02, 51], elevationMetres: 15, distanceFromStartMetres: 4000 },
      ],
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
});
