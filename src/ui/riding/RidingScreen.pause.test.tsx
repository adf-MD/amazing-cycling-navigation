// Deliberately separate from RidingScreen.test.tsx (already 5000+ lines) and
// RidingScreen.finishEndRide.test.tsx — pure file-size/organisation
// hygiene, mirroring that file's exact real-Dexie/fake-indexeddb backend
// plus targeted vi.spyOn approach. See CLAUDE.md's item 55 entry for the
// feature this proves (Immersive active-Riding shell and Pause lifecycle).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingScreen } from "./RidingScreen.tsx";
import { db } from "../../storage/db.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
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

const MIDPOINT_COORDINATE: Coordinate = routePoints[10]?.coordinate ?? [0, 51];

function midpointFix(timestampMs: number): GeolocationFix {
  return {
    coordinate: MIDPOINT_COORDINATE,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

/** Mirrors RidingScreen.finishEndRide.test.tsx's identical local stub. */
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RidingScreen Pause (backlog item 55)", () => {
  it("shows no Pause button in a clean pre-ride state", () => {
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("shows Pause with the correct route title once the ride is actively tracking", async () => {
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

    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: route.name }),
    ).toBeInTheDocument();
  });

  it("has no confirmation — pressing Pause never shows an alertdialog", async () => {
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
    await user.click(await screen.findByRole("button", { name: "Pause" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a successful Pause writes a resumable row and calls onRidePaused only after nav.pause() resolves", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRidePaused = vi.fn();

    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRidePaused={onRidePaused}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    // Let the ordinary fix-triggered persistence effect's own write settle
    // first, so the deferred mock installed below is only ever consumed by
    // pause()'s own explicit write, not that earlier, unrelated one.
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });

    let resolveWrite: (() => void) | undefined;
    const setSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = () => {
              resolve();
            };
          }),
      );

    await user.click(screen.getByRole("button", { name: "Pause" }));

    // Pending: onRidePaused must not fire while the write is still in flight.
    expect(screen.getByRole("button", { name: "Pausing…" })).toBeDisabled();
    expect(onRidePaused).not.toHaveBeenCalled();

    await act(async () => {
      resolveWrite?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onRidePaused).toHaveBeenCalledOnce();
    });
    setSpy.mockRestore();

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
  });

  it("preserves route progress and does not call onRideFinalized/clear storage", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRidePaused = vi.fn();
    const onRideFinalized = vi.fn();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRidePaused={onRidePaused}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    await user.click(await screen.findByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(onRidePaused).toHaveBeenCalledOnce();
    });
    expect(onRideFinalized).not.toHaveBeenCalled();

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
    if (stored && "routeId" in stored) {
      expect(stored.routeId).toBe(route.id);
      expect(stored.lastFix?.coordinate).toEqual(MIDPOINT_COORDINATE);
    } else {
      throw new Error("expected a route ride-state row");
    }
  });

  it("a storage failure shows a retryable, accessible error and keeps the ride active", async () => {
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
    // Let the ordinary fix-triggered persistence effect's own write settle
    // first, so the rejection below only ever affects pause()'s own call.
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });

    const setSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await user.click(screen.getByRole("button", { name: "Pause" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The ride could not be paused on this device. Try again.",
    );
    // Still active — Pause button remains present (not unmounted into the
    // Ride launcher) and re-enabled for a retry.
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled();

    setSpy.mockRestore();
    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    });
  });

  it("moves focus to the Pause button after a failed pause", async () => {
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
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });
    vi.spyOn(rideStateRepository, "setActiveRideState").mockRejectedValueOnce(
      new Error("boom"),
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));

    await screen.findByRole("alert");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
    });
  });

  it("End ride still opens/cancels correctly from the immersive header's own slot", async () => {
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

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();
    });
    // Pause is unaffected by an End-ride confirmation that was cancelled.
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled();
  });

  it("mutual exclusion: Pause is disabled while an End-ride finalisation is genuinely in flight", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();

    let resolveClear: (() => void) | undefined;
    vi.spyOn(rideStateRepository, "clearActiveRideState").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve;
        }),
    );

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
    // Opens the confirmation, then clicks its own confirm button (also
    // named "End ride" — it's the only such button once the trigger has
    // unmounted into the confirm row).
    await user.click(await screen.findByRole("button", { name: "End ride" }));
    await user.click(await screen.findByRole("button", { name: "End ride" }));

    // Pending: the header's own Pause button stays visible throughout
    // (it's never part of the End-ride confirm-row), and must now be
    // disabled by the cross-guard.
    expect(await screen.findByRole("button", { name: "Ending ride…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();

    await act(async () => {
      resolveClear?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "End ride" })).toBeNull();
    });
  });

  it("mutual exclusion: End ride is disabled while a Pause is genuinely in flight", async () => {
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
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });

    let resolveWrite: (() => void) | undefined;
    vi.spyOn(rideStateRepository, "setActiveRideState").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByRole("button", { name: "End ride" })).toBeDisabled();

    await act(async () => {
      resolveWrite?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("releases the wake lock on Pause while the desired preference is preserved in storage", async () => {
    vi.stubGlobal("navigator", { onLine: true, wakeLock: { request: vi.fn() } });
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const fakeWakeLock = buildFakeWakeLockSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        wakeLockSource={fakeWakeLock.source}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });

    const checkbox = await screen.findByRole("checkbox", {
      name: /screen on/i,
    });
    await user.click(checkbox);
    act(() => {
      fakeWakeLock.instances[0]?.resolveRequest();
    });
    await waitFor(() => {
      expect(checkbox).toBeChecked();
    });
    expect(fakeWakeLock.requestSpy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: /screen on/i })).toBeNull();
    });
    expect(fakeWakeLock.instances[0]?.released).toBe(true);

    const stored = await getActiveRideState();
    if (stored && "wakeLockDesired" in stored) {
      expect(stored.wakeLockDesired).toBe(true);
    } else {
      throw new Error("expected a route ride-state row with wakeLockDesired");
    }
  });
});
