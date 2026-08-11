// Deliberately separate from RidingScreen.test.tsx (already 4711+ lines) —
// pure file-size/organisation hygiene, not a differing storage-mocking
// convention: this file uses the exact same real-Dexie/fake-indexeddb
// backend plus targeted vi.spyOn approach RidingScreen.test.tsx itself
// already establishes (see its own "riding-edit-copy-in-planning"/
// saveDraft spy precedent). See CLAUDE.md's "A finished ride's persisted
// state is never cleared" entry for the feature this proves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingScreen } from "./RidingScreen.tsx";
import { db } from "../../storage/db.ts";
import {
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { PlannedRoute } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "../../test/fixtures/routeGeometry.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";
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

function nearEndFix(timestampMs: number): GeolocationFix {
  return {
    coordinate: FINAL_COORDINATE,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function midpointFix(timestampMs: number): GeolocationFix {
  return {
    coordinate: MIDPOINT_COORDINATE,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

/** A minimal local MapLibreLike stub, mirroring the trimmed convention
 * PlanningScreen.draftHydration.test.tsx already established for a split
 * test file (kept local/duplicated rather than shared, so this file's own
 * diff stays self-contained). */
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RidingScreen Finish/End ride", () => {
  it("shows no End-ride button in a clean pre-ride state", () => {
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End ride" })).toBeNull();
  });

  it("shows End ride once the ride is actively tracking", async () => {
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

    expect(await screen.findByRole("button", { name: "End ride" })).toBeInTheDocument();
  });

  it("shows End ride in an existing Resume-riding state", async () => {
    await setActiveRideState({
      id: "active",
      routeId: route.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: MIDPOINT_COORDINATE, accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 10,
      matchedDistanceFromStartMetres: route.distanceMetres / 2,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });

    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Resume riding" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
  });

  it("opening and cancelling the End-ride confirmation changes nothing and restores focus", async () => {
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
    expect(within(dialog).getByText("End this ride?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Navigation progress for this ride will be cleared. The saved route will remain in your library.",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(endRideButton).toHaveFocus();
    expect(await getActiveRideState()).toBeDefined();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();

    // Escape behaves the same way.
    await user.click(endRideButton);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(endRideButton).toHaveFocus();
  });

  it("confirming End ride clears storage once and returns to Start riding for the same route", async () => {
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
    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Start riding" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume riding" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End ride" })).toBeNull();
    expect(screen.getByRole("heading", { name: route.name })).toBeInTheDocument();
  });

  it("a storage-clear failure retains the active/resumable ride and shows a retryable error", async () => {
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

    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    const endRideButton = await screen.findByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ride could not be ended on this device. Try again.",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await getActiveRideState()).toBeDefined();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();

    clearSpy.mockRestore();

    // Retry succeeds.
    await user.click(screen.getByRole("button", { name: "End ride" }));
    const retryDialog = await screen.findByRole("alertdialog");
    await user.click(within(retryDialog).getByRole("button", { name: "End ride" }));
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Start riding" }),
    ).toBeInTheDocument();
  });

  it("a confirmed completion candidate shows Route complete without clearing anything automatically", async () => {
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
    expect(await getActiveRideState()).toBeDefined();
    expect(screen.queryByText("Route complete")).toBeNull();

    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(2000));
    });
    // A single near-end fix is not enough.
    await waitFor(() => {
      expect(screen.queryByText("Route complete")).toBeNull();
    });

    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });
    expect(await screen.findByText("Route complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish ride" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep riding" })).toBeInTheDocument();
    // Nothing was cleared just by showing the panel.
    expect(await getActiveRideState()).toBeDefined();
  });

  it("Keep riding dismisses the completion panel without ending navigation", async () => {
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
      fake.watches[0]?.emitFix(nearEndFix(2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });
    await user.click(await screen.findByRole("button", { name: "Keep riding" }));

    expect(screen.queryByText("Route complete")).toBeNull();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    expect(await getActiveRideState()).toBeDefined();
  });

  it("Finish ride uses the same finalisation path and produces the same clean state", async () => {
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
      fake.watches[0]?.emitFix(nearEndFix(2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });
    await user.click(await screen.findByRole("button", { name: "Finish ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Start riding" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Route complete")).toBeNull();
    expect(screen.queryByRole("button", { name: "End ride" })).toBeNull();
  });

  it("wake lock and geolocation cleanup occur through the existing lifecycle with no leaks", async () => {
    vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const fakeWakeLock = buildFakeWakeLockSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        wakeLockSource={fakeWakeLock.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    await user.click(await screen.findByRole("checkbox", { name: /keep screen awake/i }));
    fakeWakeLock.instances[0]?.resolveRequest();
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /keep screen awake/i })).toBeChecked();
    });

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(fake.watches[0]?.disposed).toBe(true);
    expect(fakeWakeLock.instances[0]?.releaseCallCount).toBeGreaterThan(0);
  });

  it("a late callback from the disposed watch cannot alter the finished state", async () => {
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
    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });

    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(9999));
    });

    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume riding" })).toBeNull();
    expect(screen.queryByText(/Waiting for a GPS fix/)).toBeNull();
    expect(await getActiveRideState()).toBeUndefined();
  });

  it("a pending older persistence write cannot recreate ride state after successful finalisation", async () => {
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
    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));
    // A fix racing the still-in-flight clear.
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(1500));
    });

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    // Give any stray microtask a chance to run before the final assertion.
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
  });

  // Note: RidingScreen always fully unmounts/remounts on a genuine route
  // change (App.tsx never keeps the same instance mounted across a
  // selectedRoute change — see CLAUDE.md's own established reliance on
  // this for reachedManoeuvreIndex/explicitFeatureSelection), so a live
  // rerender with a different `route` prop on an already-mounted instance
  // does not reflect any reachable production scenario and isn't tested
  // here. useRouteCompletionCandidate's own routeId-keyed reset (see its
  // own unit tests) exists purely as defence-in-depth for that
  // unreachable-in-practice case, mirroring explicitFeatureSelection's
  // identical precedent.
});
