// backlog item 56: the fixed active-Riding Map/Profile shell. Deliberately
// separate from RidingScreen.test.tsx (already 150+ tests) and its sibling
// split files, mirroring this codebase's own established convention (see
// RidingScreen.pause.test.tsx/.finishEndRide.test.tsx/.completionArming.test.tsx).
// Reuses the same scaffolding conventions as those files (real Dexie/
// fake-indexeddb backend via db.routes/db.rideState, buildFakeGeolocationSource,
// a local trimmed MapLibreLike stub with camera spies) rather than importing
// anything from RidingScreen.test.tsx itself, which exports nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingScreen } from "./RidingScreen.tsx";
import { db } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "../../test/fixtures/routeGeometry.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";

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

const FINAL_COORDINATE = routePoints.at(-1)?.coordinate ?? [0, 51];
const MIDPOINT_COORDINATE = routePoints[10]?.coordinate ?? [0, 51];

function pointAt(index: number): Coordinate {
  return routePoints[index]?.coordinate ?? [0, 51];
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

function nearEndFix(timestampMs: number): GeolocationFix {
  return fixAt(FINAL_COORDINATE, timestampMs);
}

interface CameraSettledPayload {
  coordinate: Coordinate;
  zoom: number;
  bearingDegrees: number;
  pitchDegrees: number;
}

/** Mirrors RidingScreen.test.tsx's own buildStubMapFactory shape (camera
 * spies + a settled-camera trigger), kept as this file's own local copy per
 * this codebase's established no-shared-test-helpers-across-files
 * convention (RidingScreen.completionArming.test.tsx's createMockMapFactory
 * is the same precedent, just without the camera-settled machinery this
 * file additionally needs to prove camera-state preservation). */
function buildMockMapFactory(): {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerCameraSettled: (camera: CameraSettledPayload) => void;
  setCameraSpy: ReturnType<typeof vi.fn>;
  changeZoomBySpy: ReturnType<typeof vi.fn>;
} {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let cameraSettledListener: ((camera: CameraSettledPayload) => void) | undefined;
  const setCameraSpy = vi.fn();
  const changeZoomBySpy = vi.fn();
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
      addGeoJsonSource: () => undefined,
      setGeoJsonSourceData: () => undefined,
      hasSource: () => false,
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
      onCameraSettled: (listener) => {
        cameraSettledListener = listener;
      },
      setCamera: setCameraSpy,
      centreOn: () => undefined,
      changeZoomBy: changeZoomBySpy,
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
    // Real MapLibre always fires "style.load" strictly before "load" —
    // mirrored here since camera application (setCamera) is gated on style
    // readiness, matching RidingScreen.test.tsx's own buildStubMapFactory.
    triggerLoad: () => {
      styleLoadedListener?.();
      loadListener?.();
    },
    triggerCameraSettled: (camera) => cameraSettledListener?.(camera),
    setCameraSpy,
    changeZoomBySpy,
  };
}

async function switchToProfile(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole("button", { name: "Profile" }));
}

async function switchToMap(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole("button", { name: "Map" }));
}

function mapContainer(): HTMLElement {
  const element = screen.getByTestId("map-container");
  return element;
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

describe("RidingScreen — fixed Map/Profile shell (backlog item 56)", () => {
  describe("default view", () => {
    it("defaults to the Map view on a genuinely fresh Start riding", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));

      const mapButton = await screen.findByRole("button", { name: "Map" });
      const profileButton = screen.getByRole("button", { name: "Profile" });
      expect(mapButton).toHaveAttribute("aria-pressed", "true");
      expect(profileButton).toHaveAttribute("aria-pressed", "false");
      expect(document.querySelector(".ride-map-container")).toHaveAttribute(
        "aria-hidden",
        "false",
      );
      expect(document.querySelector(".ride-profile-pane--immersive")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });

    it("defaults to the Map view on an explicit Resume ride tap after a restored session", async () => {
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatchedPointIndex: 5,
        lastReliableMatchedDistanceFromStartMetres:
          routePoints[5]?.distanceFromStartMetres ?? 0,
      });
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );

      // No switcher exists at all before the ride is genuinely resumed —
      // idle state renders the old, unchanged scrolling layout.
      expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
      await user.click(await screen.findByRole("button", { name: "Resume ride" }));

      expect(await screen.findByRole("button", { name: "Map" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("does not reset the selected view on the mid-ride 'Try again' retry", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Start riding" }));
      await switchToProfile(user);
      expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
      await screen.findByRole("alert");
      await user.click(screen.getByRole("button", { name: "Try again" }));

      // Still Profile — Try again is handleStart's non-idle branch, which
      // deliberately never resets activeView (unlike a genuine fresh Start
      // or Resume ride).
      expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  describe("switcher accessibility", () => {
    it("exposes a labelled group with two named, mutually exclusive toggle buttons", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));

      const group = await screen.findByRole("group", { name: "Riding view" });
      const mapButton = within(group).getByRole("button", { name: "Map" });
      const profileButton = within(group).getByRole("button", { name: "Profile" });
      expect(mapButton).toHaveClass("is-selected");
      expect(profileButton).not.toHaveClass("is-selected");

      await user.click(profileButton);
      expect(mapButton).toHaveAttribute("aria-pressed", "false");
      expect(mapButton).not.toHaveClass("is-selected");
      expect(profileButton).toHaveAttribute("aria-pressed", "true");
      expect(profileButton).toHaveClass("is-selected");
    });
  });

  describe("switching does not disturb ride state", () => {
    it("never starts a second geolocation watch when toggling views", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      expect(fake.watches).toHaveLength(1);

      await switchToProfile(user);
      await switchToMap(user);
      await switchToProfile(user);

      expect(fake.watches).toHaveLength(1);
    });

    it("preserves route progress and remaining distance across a view switch", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      act(() => {
        fake.watches[0]?.emitFix(fixAt(pointAt(5), 1000));
      });
      await screen.findByText("On route");
      const remainingBefore = screen.getByText(/km ·/).textContent;

      await switchToProfile(user);
      await switchToMap(user);

      expect(screen.getByText(/km ·/).textContent).toBe(remainingBefore);
      expect(screen.getByText("On route")).toBeInTheDocument();
    });

    it("preserves the selected elevation window across a Map -> Profile -> Map -> Profile round trip", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      act(() => {
        fake.watches[0]?.emitFix(fixAt(pointAt(0), 1000));
      });
      await switchToProfile(user);
      await user.click(await screen.findByRole("button", { name: "10 km" }));
      expect(screen.getByRole("button", { name: "10 km" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await switchToMap(user);
      await switchToProfile(user);

      expect(screen.getByRole("button", { name: "10 km" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  describe("switching preserves camera state", () => {
    it("issues no additional camera or zoom commands merely from toggling views", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildMockMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      act(() => {
        fake.watches[0]?.emitFix(fixAt(pointAt(0), 1000));
      });
      await waitFor(() => {
        expect(map.setCameraSpy).toHaveBeenCalled();
      });
      const setCameraCallsBefore = map.setCameraSpy.mock.calls.length;
      const changeZoomCallsBefore = map.changeZoomBySpy.mock.calls.length;

      await switchToProfile(user);
      await switchToMap(user);
      await switchToProfile(user);
      await switchToMap(user);

      expect(map.setCameraSpy.mock.calls.length).toBe(setCameraCallsBefore);
      expect(map.changeZoomBySpy.mock.calls.length).toBe(changeZoomCallsBefore);
    });

    it("preserves the map's own settled camera attributes across a view switch", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const map = buildMockMapFactory();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={map.factory}
        />,
      );
      map.triggerLoad();
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      act(() => {
        fake.watches[0]?.emitFix(fixAt(pointAt(0), 1000));
      });
      act(() => {
        map.triggerCameraSettled({
          coordinate: pointAt(0),
          zoom: 17,
          bearingDegrees: 42,
          pitchDegrees: 35,
        });
      });
      await waitFor(() => {
        expect(mapContainer()).toHaveAttribute("data-camera-zoom", "17");
      });
      const centreBefore = mapContainer().getAttribute("data-camera-center");
      const bearingBefore = mapContainer().getAttribute("data-camera-bearing");
      const pitchBefore = mapContainer().getAttribute("data-camera-pitch");

      await switchToProfile(user);
      await switchToMap(user);

      expect(mapContainer()).toHaveAttribute("data-camera-zoom", "17");
      expect(mapContainer()).toHaveAttribute("data-camera-center", centreBefore ?? "");
      expect(mapContainer()).toHaveAttribute("data-camera-bearing", bearingBefore ?? "");
      expect(mapContainer()).toHaveAttribute("data-camera-pitch", pitchBefore ?? "");
    });
  });

  describe("pane content parity", () => {
    it("Map view shows status, the next-manoeuvre panel and the map, with zoom/camera controls", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      act(() => {
        fake.watches[0]?.emitFix(fixAt(pointAt(0), 1000));
      });
      await screen.findByText("On route");

      expect(screen.getByText(/km ·/)).toBeInTheDocument();
      // route's source.kind is "gpx-import" with no trusted manoeuvres, so
      // RidingNextManoeuvrePanel shows its GPX-specific unavailable message
      // — proves the full Map-view panel is genuinely mounted and reachable.
      expect(
        screen.getByText(
          /No trusted turn information is available for this imported GPX/,
        ),
      ).toBeInTheDocument();
      expect(mapContainer()).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "North-up, top-down view" }),
      ).toBeInTheDocument();
      // Profile-only content is not reachable while Map is selected.
      expect(screen.queryByRole("group", { name: "Elevation profile view" })).toBeNull();
    });

    it("Profile view shows the elevation window selector and chart, with Map-only controls unreachable", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));
      act(() => {
        fake.watches[0]?.emitFix(fixAt(pointAt(0), 1000));
      });
      await switchToProfile(user);

      expect(
        await screen.findByRole("group", { name: "Elevation profile view" }),
      ).toBeInTheDocument();
      // This fixture route carries no elevation data, so the chart itself
      // renders its own explanatory status message rather than an <img> —
      // still proves the Profile pane's elevation-section content is
      // genuinely reachable once Profile is selected.
      expect(
        screen.getByText("Elevation data is not available for this route."),
      ).toBeInTheDocument();
      // Shared status content stays reachable regardless of the selected view.
      expect(screen.getByText(/km ·/)).toBeInTheDocument();
      // Map-only content is not reachable while Profile is selected.
      expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "North-up, top-down view" }),
      ).toBeNull();
      // Backlog item 97: the untrusted-GPX trust notice is deliberately NOT
      // Map-only (unlike RidingNextManoeuvrePanel itself, which no longer
      // renders this message at all) — it must remain reachable from Profile
      // too. See RidingScreen.untrustedGpxNotice.test.tsx for the dedicated
      // coverage of its own timing/persistence behaviour.
      expect(
        screen.getByText(
          /No trusted turn information is available for this imported GPX/,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("completion is reachable from either view", () => {
    it("Finish ride stays reachable and functional after switching to Profile, with no automatic view switch", async () => {
      const user = userEvent.setup();
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: {
          coordinate: MIDPOINT_COORDINATE,
          accuracyMetres: 6,
          timestampMs: 1000,
        },
        lastMatchedPointIndex: 10,
        matchedDistanceFromStartMetres: route.distanceMetres / 2,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatchedPointIndex: 10,
        lastReliableMatchedDistanceFromStartMetres: route.distanceMetres / 2,
        completionArmed: true,
      });
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );

      await user.click(await screen.findByRole("button", { name: "Resume ride" }));
      act(() => {
        fake.watches[0]?.emitFix(nearEndFix(2000));
      });
      act(() => {
        fake.watches[0]?.emitFix(nearEndFix(3000));
      });
      expect(await screen.findByText("Route complete")).toBeInTheDocument();

      // Switching to Profile does not hide or disable the confirmed
      // completion panel — it stays part of the shared status stack above
      // the toggled Map/Profile content, reachable from either view.
      await switchToProfile(user);
      expect(screen.getByText("Route complete")).toBeInTheDocument();
      const finishButton = screen.getByRole("button", { name: "Finish ride" });
      expect(finishButton).toBeInTheDocument();
      // Clicking it does not itself switch the view back to Map.
      await user.click(finishButton);
      await waitFor(() => {
        expect(screen.queryByText("Route complete")).toBeNull();
      });
    });

    it("Keep riding dismisses the completion panel while Profile is selected, without switching to Map", async () => {
      const user = userEvent.setup();
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: {
          coordinate: MIDPOINT_COORDINATE,
          accuracyMetres: 6,
          timestampMs: 1000,
        },
        lastMatchedPointIndex: 10,
        matchedDistanceFromStartMetres: route.distanceMetres / 2,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatchedPointIndex: 10,
        lastReliableMatchedDistanceFromStartMetres: route.distanceMetres / 2,
        completionArmed: true,
      });
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );

      await user.click(await screen.findByRole("button", { name: "Resume ride" }));
      act(() => {
        fake.watches[0]?.emitFix(nearEndFix(2000));
      });
      act(() => {
        fake.watches[0]?.emitFix(nearEndFix(3000));
      });
      await screen.findByText("Route complete");
      await switchToProfile(user);

      await user.click(screen.getByRole("button", { name: "Keep riding" }));

      expect(screen.queryByText("Route complete")).toBeNull();
      // Still on Profile — dismissing the panel is not itself a view switch.
      expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  it("moving between views does not regress the reliably-reached manoeuvre index", async () => {
    // Reuses the same seam-skip fixture shape as RidingScreen.test.tsx's
    // "skips a synthetic waypoint-seam manoeuvre" test would, but only
    // needs a single trusted manoeuvre here — proves reachedManoeuvreIndex
    // (tracked in RidingScreen's own state, unaffected by activeView) stays
    // put across a view round trip while the rider approaches it.
    const trustedRoute: PlannedRoute = {
      ...route,
      source: { kind: "planner", provider: "test" },
      manoeuvres: [
        { distanceFromStartMetres: 0, type: "start" },
        {
          distanceFromStartMetres: routePoints[10]?.distanceFromStartMetres ?? 0,
          type: "left",
          instruction: "Turn left onto Ridge Road",
        },
        { distanceFromStartMetres: route.distanceMetres, type: "finish" },
      ],
    };
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={trustedRoute}
        geolocationSource={fake.source}
        mapFactory={buildMockMapFactory().factory}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      // ~100 m in: past the "start" manoeuvre's own 15 m reached-tolerance,
      // short of the "left" manoeuvre at ~200 m (routePoints[10]) — so the
      // next-manoeuvre panel shows the left turn, not "Start of route".
      fake.watches[0]?.emitFix(fixAt(pointAt(5), 1000));
    });
    await screen.findByText("Turn left onto Ridge Road");

    await switchToProfile(user);
    await switchToMap(user);

    expect(screen.getByText("Turn left onto Ridge Road")).toBeInTheDocument();
  });
});
