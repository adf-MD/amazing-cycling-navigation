// Deliberately separate from RidingScreen.finishEndRide.test.tsx (already
// ~500 lines / 12 tests — exactly the condition that justified splitting
// that file out from RidingScreen.test.tsx in the first place). Reuses the
// same scaffolding conventions (real Dexie/fake-indexeddb backend,
// buildFakeGeolocationSource, a local trimmed MapLibreLike stub,
// act()-wrapped emitFix calls) rather than reinventing them. See
// CLAUDE.md's "A finished ride's persisted state is never cleared" entry,
// completion-arming paragraph, for the feature this proves.
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingScreen } from "./RidingScreen.tsx";
import { db } from "../../storage/db.ts";
import {
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { PlannedRoute } from "../../domain/types.ts";
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

/** At the finish, with a fresh unmatched fix this projects (via a
 * whole-route search, since there's no prior lastMatch) onto the route's
 * final point — near-total reported progress with zero lateral distance.
 * This is the hostile scenario the arming gate exists to guard against. */
function nearEndFix(timestampMs: number): GeolocationFix {
  return {
    coordinate: FINAL_COORDINATE,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

/** Far from the finish (~350m, comfortably beyond the arming departure
 * radius) at roughly 50% route progress (comfortably inside the 10-80%
 * interior band) — genuine arming evidence. */
function midpointFix(timestampMs: number): GeolocationFix {
  return {
    coordinate: MIDPOINT_COORDINATE,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function createMockMapFactory(): { factory: MapFactory } {
  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: () => undefined,
      onStyleLoaded: () => undefined,
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
      onCameraSettled: () => undefined,
      setCamera: () => undefined,
      centreOn: () => undefined,
      changeZoomBy: () => undefined,
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
  return { factory };
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

describe("RidingScreen route-completion arming", () => {
  it("a hostile fix at the finish with misreported near-total progress (no prior arming evidence) never shows the completion panel", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(1000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(2000));
    });

    await waitFor(() => {
      expect(screen.getByText("0.0 km · ascent unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByText("Route complete")).toBeNull();
    expect(await getActiveRideState()).toBeDefined();
  });

  it("a full legitimate sequence (arm via interior progress, then complete at the finish) shows the panel", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(2000));
    });
    expect(screen.queryByText("Route complete")).toBeNull();

    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(4000));
    });

    expect(await screen.findByText("Route complete")).toBeInTheDocument();
  });

  it("End ride is available and works before arming has happened", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });

    const endRideButton = await screen.findByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Start riding" }),
    ).toBeInTheDocument();
  });

  it("End ride is available and works after arming has happened", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(2000));
    });

    const endRideButton = await screen.findByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Start riding" }),
    ).toBeInTheDocument();
  });

  it("a fresh Start after End ride does not inherit arming — the hostile fix stays unconfirmed again", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    // Arm and complete the first ride.
    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(4000));
    });
    expect(await screen.findByText("Route complete")).toBeInTheDocument();

    // End it.
    const endRideButton = screen.getByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Start riding" }),
    ).toBeInTheDocument();

    // Start again, within the same mount — the exact same hostile
    // first-fix-at-the-finish scenario must not skip arming again, proving
    // the reset happened in memory, not merely via the cleared storage row.
    // finish() disposed the original watch, so the new "Start riding"
    // press creates a fresh one at fake.watches[1], not fake.watches[0].
    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[1]?.emitFix(nearEndFix(5000));
    });
    act(() => {
      fake.watches[1]?.emitFix(nearEndFix(6000));
    });
    await waitFor(() => {
      expect(screen.getByText("0.0 km · ascent unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByText("Route complete")).toBeNull();
  });

  it("a route resumed with a persisted armed=true row shows the panel after only the completion fixes, with no re-arming needed", async () => {
    const user = userEvent.setup();
    await setActiveRideState({
      id: "active",
      routeId: route.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: MIDPOINT_COORDINATE, accuracyMetres: 6, timestampMs: 1000 },
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
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Resume riding" }));
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });

    expect(await screen.findByText("Route complete")).toBeInTheDocument();
  });

  it("a legacy resumed row with no completionArmed field restores unarmed and still requires arming evidence", async () => {
    const user = userEvent.setup();
    // Hand-built, not via a helper that would default the field in —
    // simulates a genuinely pre-existing row from before this feature
    // shipped.
    await setActiveRideState({
      id: "active",
      routeId: route.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: MIDPOINT_COORDINATE, accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 10,
      matchedDistanceFromStartMetres: route.distanceMetres / 2,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      lastReliableMatchedPointIndex: 10,
      lastReliableMatchedDistanceFromStartMetres: route.distanceMetres / 2,
    });

    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Resume riding" }));
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });

    await waitFor(() => {
      expect(screen.getByText("0.0 km · ascent unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByText("Route complete")).toBeNull();
  });
});
