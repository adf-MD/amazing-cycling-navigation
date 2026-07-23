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

function buildStubMapFactory(): { factory: MapFactory; triggerTileError: () => void } {
  let errorListener: (() => void) | undefined;
  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: () => undefined,
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
      resize: () => undefined,
      remove: () => undefined,
    };
    return map;
  };
  return { factory, triggerTileError: () => errorListener?.() };
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
});
