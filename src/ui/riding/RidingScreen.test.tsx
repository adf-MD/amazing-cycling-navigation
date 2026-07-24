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
import { OFF_ROUTE_BASE_METRES } from "../../navigation/offRoute.ts";
import { NAVIGATION_ZOOM } from "./rideCamera.ts";

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
  triggerCameraSettled: (camera: { coordinate: Coordinate; zoom: number }) => void;
  setCameraSpy: ReturnType<typeof vi.fn>;
  getZoomSpy: ReturnType<typeof vi.fn>;
} {
  let loadListener: (() => void) | undefined;
  let errorListener: (() => void) | undefined;
  let userCameraInteractionListener: (() => void) | undefined;
  let cameraSettledListener:
    ((camera: { coordinate: Coordinate; zoom: number }) => void) | undefined;
  const setCameraSpy = vi.fn();
  const getZoomSpy = vi.fn(() => 14);
  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: (listener) => {
        loadListener = listener;
      },
      onError: (listener) => {
        errorListener = () => {
          listener({ message: "tile fetch failed" });
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
      remove: () => undefined,
    };
    return map;
  };
  return {
    factory,
    triggerLoad: () => loadListener?.(),
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
    expect(screen.queryByRole("group", { name: "Upcoming elevation window" })).toBeNull();
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
    expect(screen.queryByRole("group", { name: "Upcoming elevation window" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    stub.emitFix({
      coordinate: [0, 51],
      accuracyMetres: 5,
      timestampMs: 1000,
      speedMetresPerSecond: null,
    });

    expect(
      await screen.findByRole("group", { name: "Upcoming elevation window" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/10–20 m/)).toBeInTheDocument();
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
      });

      expect(await screen.findByText("On route")).toBeInTheDocument();
      expect(screen.getByText(/Remaining:/)).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: "Upcoming elevation window" }),
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
      });
      await screen.findByText("On route");

      map.triggerLoad();
      map.triggerTileError();

      expect(await screen.findByTestId("tiles-unavailable-banner")).toBeInTheDocument();
      // The rest of the ride UI is untouched by the map's own tile failure.
      expect(screen.getByText("On route")).toBeInTheDocument();
      expect(screen.getByText(/Remaining:/)).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: "Upcoming elevation window" }),
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
      });

      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledWith(pointAt(0), NAVIGATION_ZOOM, {
          animate: true,
        });
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
      });
      await user.click(followButton);

      expect(followButton).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
      });
      expect(map.setCameraSpy).toHaveBeenLastCalledWith(pointAt(5), NAVIGATION_ZOOM, {
        animate: true,
      });
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

    it("restores a free-panned camera position instantly, without an animated following ease", async () => {
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
        expect(map.setCameraSpy).toHaveBeenCalledWith(freeCoordinate, 14, {
          animate: false,
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
  });
});
