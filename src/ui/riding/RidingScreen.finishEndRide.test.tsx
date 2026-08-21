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
import { clearErrorLog, getRecentErrors } from "../../platform/errorLog.ts";

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
      await screen.findByRole("button", { name: "Resume ride" }),
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
    // The trigger genuinely unmounts while the confirmation is open
    // (backlog item 50's in-place confirmation morph), so the button
    // re-queried here is a freshly remounted DOM node, not the one captured
    // before the click — mirrors PlanningScreen.clearDraft.test.tsx's own
    // established precedent for the identical scenario.
    const restoredEndRideButton = screen.getByRole("button", { name: "End ride" });
    expect(restoredEndRideButton).toHaveFocus();
    expect(await getActiveRideState()).toBeDefined();

    // Escape behaves the same way.
    await user.click(restoredEndRideButton);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();
  });

  it("the active-tracking End-ride confirmation replaces the trigger in its own action-row slot, with route status and the map staying mounted (backlog item 50)", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const { container } = render(
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

    // The immersive header's own End slot goes empty once the
    // confirmation opens, and the confirmation renders as its own
    // full-width row immediately after the header (backlog item 55
    // restructures item 50's original .ride-end-ride-row container).
    const header = container.querySelector(".riding-immersive-header");
    const confirmRow = container.querySelector(".ride-end-ride-confirm-row");
    const dialog = await screen.findByRole("alertdialog");
    expect(header).not.toBeNull();
    expect(confirmRow).not.toBeNull();
    expect(confirmRow?.contains(dialog)).toBe(true);
    // The trigger never coexists with the confirmation — the only
    // "End ride"-named button left anywhere is the dialog's own confirm
    // button.
    expect(screen.getAllByRole("button", { name: "End ride" })).toEqual([
      within(dialog).getByRole("button", { name: "End ride" }),
    ]);
    // Surrounding content stays visible and unaffected while the
    // confirmation is open.
    expect(screen.getByRole("heading", { name: route.name })).toBeInTheDocument();
    expect(
      screen.getByText(
        /No trusted turn information is available|Turn information is unavailable/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
  });

  it("the resumable pre-ride End-ride confirmation replaces the trigger in its own panel position, with Resume ride and Edit copy staying visible (backlog item 50)", async () => {
    await setActiveRideState({
      id: "active",
      routeId: route.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: MIDPOINT_COORDINATE, accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 10,
      matchedDistanceFromStartMetres: route.distanceMetres / 2,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });
    const user = userEvent.setup();
    const { container } = render(
      <RidingScreen
        route={route}
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "End ride" }));

    // The resumable pre-ride panel's own action-slot wrapper — distinct
    // from .ride-end-ride-row (the active-tracking one), preserving the
    // existing assertion elsewhere that .ride-end-ride-row stays absent in
    // this idle/resumable state.
    const panelRow = container.querySelector(".ride-end-ride-panel-row");
    const dialog = await screen.findByRole("alertdialog");
    expect(panelRow).not.toBeNull();
    expect(panelRow?.contains(dialog)).toBe(true);
    expect(container.querySelector(".ride-end-ride-row")).toBeNull();
    expect(screen.getAllByRole("button", { name: "End ride" })).toEqual([
      within(dialog).getByRole("button", { name: "End ride" }),
    ]);
    // The rest of the pre-ride panel stays visible and unaffected.
    expect(screen.getByRole("button", { name: "Resume ride" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit copy" })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
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
    // A second consecutive interior fix arms the ride (see
    // RidingScreen.completionArming.test.tsx for arming-specific
    // coverage) — required before any completion evidence counts.
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1500));
    });

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
      fake.watches[0]?.emitFix(midpointFix(1500));
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
      fake.watches[0]?.emitFix(midpointFix(1500));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });
    // Finish ride stays confirmation-free and separate from End ride's own
    // in-place morph (backlog item 50) — no alertdialog exists at all
    // before the click, and clicking Finish ride finalises directly with
    // no confirmation ever appearing.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Finish ride" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

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
    await user.click(await screen.findByRole("checkbox", { name: /keep screen on/i }));
    fakeWakeLock.instances[0]?.resolveRequest();
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /keep screen on/i })).toBeChecked();
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
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
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

describe("RidingScreen onRideFinalized", () => {
  it("onRideFinalized is not called until the persisted clear has actually resolved", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    let resolveClear: (() => void) | undefined;
    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockReturnValue(
        new Promise((resolve) => {
          resolveClear = () => {
            resolve(undefined);
          };
        }),
      );
    const onRideFinalized = vi.fn();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    // The clear is still pending — onRideFinalized must not have fired yet.
    expect(onRideFinalized).not.toHaveBeenCalled();

    resolveClear?.();
    await waitFor(() => {
      expect(onRideFinalized).toHaveBeenCalledTimes(1);
    });
    clearSpy.mockRestore();
  });

  it("a successful Finish ride calls onRideFinalized exactly once", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRideFinalized = vi.fn();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1500));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(nearEndFix(3000));
    });
    await user.click(await screen.findByRole("button", { name: "Finish ride" }));

    await waitFor(() => {
      expect(onRideFinalized).toHaveBeenCalledTimes(1);
    });
  });

  it("cancelling or pressing Escape on the End-ride dialog never calls onRideFinalized", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRideFinalized = vi.fn();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    const endRideButton = await screen.findByRole("button", { name: "End ride" });

    await user.click(endRideButton);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    // The trigger genuinely unmounts while the confirmation is open
    // (backlog item 50's in-place confirmation morph), so re-query it here
    // rather than reusing the reference captured before the first click —
    // a click on the earlier, now-detached node would silently no-op.
    await user.click(screen.getByRole("button", { name: "End ride" }));
    await user.keyboard("{Escape}");

    expect(onRideFinalized).not.toHaveBeenCalled();
  });

  it("a storage-clear failure never calls onRideFinalized; a subsequent successful retry calls it exactly once", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRideFinalized = vi.fn();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
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

    await screen.findByRole("alert");
    expect(onRideFinalized).not.toHaveBeenCalled();

    clearSpy.mockRestore();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const retryDialog = await screen.findByRole("alertdialog");
    await user.click(within(retryDialog).getByRole("button", { name: "End ride" }));

    await waitFor(() => {
      expect(onRideFinalized).toHaveBeenCalledTimes(1);
    });
  });

  it("a rapid double confirm click calls onRideFinalized at most once", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRideFinalized = vi.fn();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirmButton = within(dialog).getByRole("button", { name: "End ride" });

    await user.click(confirmButton);
    // The button disables itself once the click is handled — a second
    // click attempt on the same (by-then-unmounted or disabled) element is
    // a no-op through user-event, exercising the same re-entrancy guard
    // performFinalizeRide's own isFinalizeActionPendingRef provides.
    await user.click(confirmButton).catch(() => undefined);

    await waitFor(() => {
      expect(onRideFinalized).toHaveBeenCalledTimes(1);
    });
  });

  it("a throwing onRideFinalized still reaches the clean Start-riding state with no finalizeError shown, and is logged", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRideFinalized = vi.fn(() => {
      throw new Error("boom");
    });
    clearErrorLog();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(1000));
    });
    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(
      await screen.findByRole("button", { name: "Start riding" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await getActiveRideState()).toBeUndefined();
    expect(
      getRecentErrors().some(
        (entry) => entry.context === "riding-ride-finalized-callback",
      ),
    ).toBe(true);
  });
});
