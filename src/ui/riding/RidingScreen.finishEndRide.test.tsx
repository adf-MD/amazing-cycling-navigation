// Deliberately separate from RidingScreen.test.tsx (already 4711+ lines) —
// pure file-size/organisation hygiene, not a differing storage-mocking
// convention: this file uses the exact same real-Dexie/fake-indexeddb
// backend plus targeted vi.spyOn approach RidingScreen.test.tsx itself
// already establishes (see its own "riding-edit-copy-in-planning"/
// saveDraft spy precedent). See CLAUDE.md's "A finished ride's persisted
// state is never cleared" entry for the feature this proves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { saveDraft } from "../../storage/planningDraftRepository.ts";
import * as guardModule from "../shared/operationInteractionGuard.ts";
import type { OperationInteractionGuard } from "../shared/operationInteractionGuard.ts";
import type { StoredRouteRideState } from "../../storage/db.ts";

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
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("End this ride?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Navigation progress for this ride will be cleared. The saved route will remain in your library.",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The header trigger stays mounted, concealed, while the confirmation is
    // open (0.4.42 installed-iPhone recheck), so the button re-queried here
    // is the very node captured before the click — revealed, enabled and
    // focused again.
    const restoredEndRideButton = screen.getByRole("button", { name: "End ride" });
    expect(restoredEndRideButton).toBe(endRideButton);
    expect(restoredEndRideButton).toBeEnabled();
    expect(restoredEndRideButton).not.toHaveAttribute("aria-hidden");
    expect(restoredEndRideButton.style.visibility).toBe("");
    expect(restoredEndRideButton).toHaveFocus();
    expect(await getActiveRideState()).toBeDefined();

    // Escape behaves the same way.
    await user.click(restoredEndRideButton);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
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

    // The confirmation renders as its own full-width row immediately after
    // the header (backlog item 55 restructures item 50's original
    // .ride-end-ride-row container).
    const header = container.querySelector(".riding-immersive-header");
    const endSlot = container.querySelector(".riding-immersive-header-end");
    const confirmRow = container.querySelector(".ride-end-ride-confirm-row");
    const dialog = await screen.findByRole("dialog");
    expect(header).not.toBeNull();
    expect(confirmRow).not.toBeNull();
    expect(confirmRow?.contains(dialog)).toBe(true);
    expect(endSlot?.contains(dialog)).toBe(false);
    // The header's own End trigger stays mounted while the confirmation is
    // open — concealed, outside the accessibility tree and the tab order,
    // and disabled — so the header keeps its geometry and the title never
    // jumps (0.4.42 installed-iPhone recheck). It is the same element
    // before, during and after the confirmation.
    const concealedTrigger = endSlot?.querySelector("button");
    expect(concealedTrigger).toBeInstanceOf(HTMLButtonElement);
    expect(concealedTrigger).toHaveAttribute("aria-hidden", "true");
    expect(concealedTrigger).toHaveAttribute("tabindex", "-1");
    expect(concealedTrigger).toBeDisabled();
    expect(concealedTrigger?.style.visibility).toBe("hidden");

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
    const dialog = await screen.findByRole("dialog");
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
    const dialog = await screen.findByRole("dialog");
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
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ride could not be ended on this device. Try again.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await getActiveRideState()).toBeDefined();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();

    clearSpy.mockRestore();

    // Retry succeeds.
    await user.click(screen.getByRole("button", { name: "End ride" }));
    const retryDialog = await screen.findByRole("dialog");
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
    // in-place morph (backlog item 50) — no dialog exists at all
    // before the click, and clicking Finish ride finalises directly with
    // no confirmation ever appearing.
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Finish ride" }));
    expect(screen.queryByRole("dialog")).toBeNull();

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
    await user.click(await screen.findByRole("button", { name: "Screen on" }));
    fakeWakeLock.instances[0]?.resolveRequest();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Screen on" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    // finish() deliberately awaits clearActiveRideState() FIRST, and only
    // then calls stop() and setWakeLockDesired(false) — after which React
    // must still commit a re-render, unmount RidingWakeLockControl, run
    // useScreenWakeLock's cleanup, and let its own un-awaited
    // `void handle.release()` settle. So an empty rideState row proves
    // only the first of those steps; asserting the rest immediately after
    // it is a race, and it is the assertion that is wrong, not the
    // production ordering. Both remaining facts are therefore polled.
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    await waitFor(() => {
      expect(fake.watches[0]?.disposed).toBe(true);
      expect(fakeWakeLock.instances[0]?.releaseCallCount).toBeGreaterThan(0);
    });
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
    const dialog = await screen.findByRole("dialog");
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
    const dialog = await screen.findByRole("dialog");
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
    const dialog = await screen.findByRole("dialog");
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
      within(await screen.findByRole("dialog")).getByRole("button", {
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
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await screen.findByRole("alert");
    expect(onRideFinalized).not.toHaveBeenCalled();

    clearSpy.mockRestore();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const retryDialog = await screen.findByRole("dialog");
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
    const dialog = await screen.findByRole("dialog");
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
    const dialog = await screen.findByRole("dialog");
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

// Backlog item 124, C-11 (the rider's decision of 3 October 2026): the paused
// panel's End ride confirmation is revealed by the common rule on opening,
// and a Cancel or Escape returns focus to End ride without the browser's own
// focus scroll, moving the page only as far as reveals that button. The
// riding header's confirmation (C-10) is left exactly as it was. Geometry is
// stubbed as RidingScreen.test.tsx's C-12 tests stub it; the real-browser
// geometry is proved in e2e/endRidePausedConfirmationReveal.smoke.spec.ts.
// The held Pause write below is a timing branch no ordinary flow reaches:
// these are its unit-level evidence.
describe("End ride's confirmation on the paused screen (backlog item 124, C-11)", () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalFocus = HTMLElement.prototype.focus;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollBy = window.scrollBy;

  afterEach(async () => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    HTMLElement.prototype.focus = originalFocus;
    window.scrollBy = originalScrollBy;
    document.querySelectorAll("body > header, body > .c11-elsewhere").forEach((node) => {
      node.remove();
    });
    vi.restoreAllMocks();
    await db.planningDrafts.clear();
  });

  function rect(top: number, bottom: number): DOMRect {
    return {
      top,
      bottom,
      left: 0,
      right: 358,
      width: 358,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => "",
    };
  }

  interface Band {
    top: number;
    bottom: number;
  }

  interface Geometry {
    inset: Band;
    actions: Band;
    trigger: Band;
    editInset: Band;
    editActions: Band;
  }

  /** Mutable, so a test can change what the next measurement sees. jsdom's
   * window.innerHeight is 768 and it has no visualViewport, so with the
   * 60px header the usable band is 68..760. Both End ride placements and
   * both of its triggers report the same boxes, so a test of the riding
   * header proves it is never revealed whatever its geometry. */
  function stubGeometry(initial: Partial<Geometry> = {}): Geometry {
    const geometry: Geometry = {
      inset: { top: 200, bottom: 397 },
      actions: { top: 341, bottom: 385 },
      trigger: { top: 300, bottom: 344 },
      editInset: { top: 200, bottom: 397 },
      editActions: { top: 341, bottom: 385 },
      ...initial,
    };
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const dialog = this.closest('[role="dialog"]');
      const title = dialog?.querySelector("h2, h3, h4")?.textContent ?? "";
      const isEnd = title === "End this ride?";
      const isEdit = title === "Replace your current draft?";
      if (dialog === this) {
        if (isEnd) return rect(geometry.inset.top, geometry.inset.bottom);
        if (isEdit) return rect(geometry.editInset.top, geometry.editInset.bottom);
      }
      if (dialog && this.classList.contains("route-delete-confirm-actions")) {
        if (isEnd) return rect(geometry.actions.top, geometry.actions.bottom);
        if (isEdit) return rect(geometry.editActions.top, geometry.editActions.bottom);
      }
      if (
        !dialog &&
        this.tagName === "BUTTON" &&
        (this.getAttribute("aria-label") ?? this.textContent.trim()) === "End ride"
      ) {
        return rect(geometry.trigger.top, geometry.trigger.bottom);
      }
      if (this.tagName === "HEADER" && this.parentElement === document.body) {
        return rect(0, 60);
      }
      return rect(0, 0);
    };
    return geometry;
  }

  /** Focus calls and deliberate scrolls in one ordered log. Delegates to
   * the real focus. */
  function captureLog() {
    const log: string[] = [];
    HTMLElement.prototype.focus = function focus(
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      log.push(
        `focus:${this.textContent.trim().slice(0, 12)}:${options?.preventScroll === true ? "noscroll" : "scroll"}`,
      );
      originalFocus.call(this, options);
    };
    window.scrollBy = (options?: ScrollToOptions | number) => {
      if (typeof options === "object") {
        log.push(
          `scrollBy:${String(options.top)}:${String(options.left)}:${String(options.behavior)}`,
        );
      }
    };
    return log;
  }

  const scrolls = (log: readonly string[]) =>
    log.filter((entry) => entry.startsWith("scrollBy"));
  /** What the app did from `start` on, leaving out the focus user-event
   * itself gives the control it clicks. */
  const appEntriesSince = (log: readonly string[], start: number, clicked: string) =>
    log.slice(start).filter((entry) => entry !== `focus:${clicked}:scroll`);

  function renderWithHeader() {
    const header = document.createElement("header");
    document.body.appendChild(header);
    const headerRef: { current: HTMLElement | null } = { current: header };
    const fake = buildFakeGeolocationSource();
    const mapFactory = createMockMapFactory().factory;
    const element = () => (
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={mapFactory}
        stickyHeaderRef={headerRef}
      />
    );
    const utils = render(element());
    return {
      ...utils,
      header,
      headerRef,
      fake,
      rerenderScreen: () => {
        utils.rerender(element());
      },
    };
  }

  const storedPausedRide: StoredRouteRideState = {
    id: "active",
    routeId: route.id,
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: { coordinate: MIDPOINT_COORDINATE, accuracyMetres: 6, timestampMs: 1000 },
    lastMatchedPointIndex: 10,
    matchedDistanceFromStartMetres: route.distanceMetres / 2,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
  };

  /** The paused route screen, reached as item 132's restored session is. */
  async function renderPaused() {
    await setActiveRideState(storedPausedRide);
    const rendered = renderWithHeader();
    await screen.findByRole("button", { name: "Resume ride" });
    return rendered;
  }

  /** Active riding with a persisted fix, the riding header's End ride
   * showing. */
  async function renderRiding() {
    const user = userEvent.setup();
    const rendered = renderWithHeader();
    await user.click(screen.getByRole("button", { name: "Start riding" }));
    act(() => {
      rendered.fake.watches[0]?.emitFix(midpointFix(1000));
    });
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });
    return { ...rendered, user };
  }

  const endConfirm = () => screen.findByRole("dialog", { name: "End this ride?" });
  const cancelIn = (dialog: HTMLElement) =>
    within(dialog).getByRole("button", { name: "Cancel" });
  const panelTrigger = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>(".ride-end-ride-panel-row > button");

  function holdPauseWrite(): { release: () => Promise<void>; fail: () => Promise<void> } {
    let resolveWrite: () => void = () => undefined;
    let rejectWrite: (error: Error) => void = () => undefined;
    vi.spyOn(rideStateRepository, "setActiveRideState").mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          resolveWrite = resolve;
          rejectWrite = reject;
        }),
    );
    const settle = async (action: () => void) => {
      await act(async () => {
        action();
        await Promise.resolve();
        await Promise.resolve();
      });
    };
    return {
      release: () =>
        settle(() => {
          resolveWrite();
        }),
      fail: () =>
        settle(() => {
          rejectWrite(new Error("held write failed"));
        }),
    };
  }

  it("focuses Cancel without scrolling, then makes one instant minimal reveal measured below the sticky header", async () => {
    const user = userEvent.setup();
    await renderPaused();
    // Fits the 692px band, but its bottom is 140px below it.
    stubGeometry({
      inset: { top: 600, bottom: 900 },
      actions: { top: 840, bottom: 884 },
    });
    const log = captureLog();

    const start = log.length;
    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await endConfirm();

    expect(appEntriesSince(log, start, "End ride")).toEqual([
      "focus:Cancel:noscroll",
      "scrollBy:140:0:auto",
    ]);
    expect(cancelIn(dialog)).toHaveFocus();
  });

  it("does not move the page when the whole confirmation already fits", async () => {
    const user = userEvent.setup();
    await renderPaused();
    stubGeometry();
    const log = captureLog();

    const start = log.length;
    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await endConfirm();

    expect(appEntriesSince(log, start, "End ride")).toEqual(["focus:Cancel:noscroll"]);
    expect(cancelIn(dialog)).toHaveFocus();
  });

  it("does not move an oversized confirmation whose complete action row already shows, and otherwise moves only the row into the band", async () => {
    const user = userEvent.setup();
    await renderPaused();
    const geometry = stubGeometry({
      inset: { top: -100, bottom: 760 },
      actions: { top: 690, bottom: 734 },
    });
    const log = captureLog();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    await user.click(cancelIn(await endConfirm()));
    expect(scrolls(log)).toEqual([]);

    // Oversized again, but now the row is 40px below the band: exactly that
    // much, not the confirmation's own padding below it as well.
    geometry.inset = { top: 100, bottom: 1000 };
    geometry.actions = { top: 756, bottom: 800 };
    await user.click(screen.getByRole("button", { name: "End ride" }));
    await endConfirm();
    expect(scrolls(log)).toEqual(["scrollBy:40:0:auto"]);
  });

  it("reveals once per opening — never on an unrelated re-render — and re-measures on reopening", async () => {
    const user = userEvent.setup();
    const { rerenderScreen } = await renderPaused();
    const geometry = stubGeometry({
      inset: { top: 600, bottom: 900 },
      actions: { top: 840, bottom: 884 },
    });
    const log = captureLog();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await endConfirm();
    rerenderScreen();
    rerenderScreen();
    expect(scrolls(log)).toEqual(["scrollBy:140:0:auto"]);

    await user.click(cancelIn(dialog));
    geometry.inset = { top: 650, bottom: 950 };
    geometry.actions = { top: 890, bottom: 934 };
    await user.click(screen.getByRole("button", { name: "End ride" }));
    await endConfirm();
    expect(scrolls(log)).toEqual(["scrollBy:140:0:auto", "scrollBy:190:0:auto"]);
  });

  it("Cancel and Escape return focus to End ride without scrolling, moving only as far as reveals End ride itself, and keep the ride paused", async () => {
    const user = userEvent.setup();
    const { container } = await renderPaused();
    // End ride comes back 38px under the 68px top of the band.
    const geometry = stubGeometry({ trigger: { top: 30, bottom: 74 } });
    const stored = await getActiveRideState();
    const log = captureLog();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    let start = log.length;
    await user.click(cancelIn(await endConfirm()));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(appEntriesSince(log, start, "Cancel")).toEqual([
      "focus:End ride:noscroll",
      "scrollBy:-38:0:auto",
    ]);
    expect(panelTrigger(container)).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    await endConfirm();
    start = log.length;
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(appEntriesSince(log, start, "Cancel")).toEqual([
      "focus:End ride:noscroll",
      "scrollBy:-38:0:auto",
    ]);
    expect(panelTrigger(container)).toHaveFocus();

    // Already inside the band: focus only, the page left where it is.
    geometry.trigger = { top: 300, bottom: 344 };
    await user.click(screen.getByRole("button", { name: "End ride" }));
    start = log.length;
    await user.click(cancelIn(await endConfirm()));
    expect(appEntriesSince(log, start, "Cancel")).toEqual(["focus:End ride:noscroll"]);

    expect(await getActiveRideState()).toEqual(stored);
    expect(screen.getByRole("button", { name: "Resume ride" })).toBeInTheDocument();
  });

  it("refuses Cancel and Escape while the ending runs, and a failed ending keeps its plain focus return with no reveal", async () => {
    const user = userEvent.setup();
    const { container } = await renderPaused();
    stubGeometry({ trigger: { top: 30, bottom: 74 } });
    let rejectClear: (error: Error) => void = () => undefined;
    vi.spyOn(rideStateRepository, "clearActiveRideState").mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectClear = reject;
        }),
    );
    const log = captureLog();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await endConfirm();
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));
    expect(within(dialog).getByRole("button", { name: "Ending ride…" })).toBeDisabled();
    const start = log.length;
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "End this ride?" })).toBe(dialog);
    expect(log.slice(start)).toEqual([]);

    await act(async () => {
      rejectClear(new Error("boom"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ride could not be ended on this device. Try again.",
    );
    // Unchanged by C-11: the browser's own focus scroll, and no reveal,
    // even though End ride is under the navigation here.
    expect(log.slice(start)).toEqual(["focus:End ride:scroll"]);
    expect(panelTrigger(container)).toHaveFocus();
  });

  it("leaves the riding header's confirmation (C-10) exactly as it was: autoFocus, no reveal, and a plain focus back to End ride", async () => {
    const { user } = await renderRiding();
    // Geometry that would warrant movement in the paused panel.
    stubGeometry({
      inset: { top: 600, bottom: 900 },
      actions: { top: 840, bottom: 884 },
      trigger: { top: 30, bottom: 74 },
    });
    const log = captureLog();

    let start = log.length;
    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await endConfirm();
    expect(appEntriesSince(log, start, "End ride")).toEqual(["focus:Cancel:scroll"]);

    start = log.length;
    await user.click(cancelIn(dialog));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();
    });
    expect(appEntriesSince(log, start, "Cancel")).toEqual(["focus:End ride:scroll"]);

    await user.click(screen.getByRole("button", { name: "End ride" }));
    await endConfirm();
    start = log.length;
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();
    });
    expect(appEntriesSince(log, start, "Cancel")).toEqual(["focus:End ride:scroll"]);
    expect(scrolls(log)).toEqual([]);
  });

  it("a paused confirmation carried into riding by Resume ride is not revealed there", async () => {
    const user = userEvent.setup();
    await renderPaused();
    stubGeometry();
    const log = captureLog();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    await endConfirm();
    const start = log.length;
    await user.click(screen.getByRole("button", { name: "Resume ride" }));
    const dialog = await endConfirm();
    // The riding header's own plain autoFocus, as before C-11.
    expect(appEntriesSince(log, start, "Resume ride")).toEqual(["focus:Cancel:scroll"]);
    expect(cancelIn(dialog)).toHaveFocus();
    expect(scrolls(log)).toEqual([]);
  });

  // The separately recorded survivor (not fixed here): a confirmation left
  // open in the riding header survives Pause and reappears in the panel.
  // App puts the sticky navigation back a commit later, so the header ref is
  // emptied here while riding, as App's own header unmounts then.
  it("reveals a confirmation that reappears on Pause only once the sticky navigation is back, focusing Cancel without scrolling", async () => {
    const { user, header, headerRef, rerenderScreen } = await renderRiding();
    stubGeometry({
      inset: { top: 600, bottom: 900 },
      actions: { top: 840, bottom: 884 },
    });
    headerRef.current = null;
    await user.click(screen.getByRole("button", { name: "End ride" }));
    await endConfirm();
    const log = captureLog();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await screen.findByRole("button", { name: "Resume ride" });
    const dialog = await endConfirm();
    expect(cancelIn(dialog)).toHaveFocus();
    expect(log).toContain("focus:Cancel:noscroll");
    expect(scrolls(log)).toEqual([]);

    headerRef.current = header;
    rerenderScreen();
    expect(scrolls(log)).toEqual(["scrollBy:140:0:auto"]);
    rerenderScreen();
    expect(scrolls(log)).toEqual(["scrollBy:140:0:auto"]);
  });

  it("when Edit copy's confirmation reappears with it, End ride's is revealed last and keeps focus", async () => {
    const user = userEvent.setup();
    await saveDraft({
      waypoints: [
        { id: "existing-a", coordinate: [1, 52] },
        { id: "existing-b", coordinate: [1.01, 52] },
      ],
      routeName: "Unsaved plan",
      avoidFerries: true,
      profile: "cycling-road",
    });
    const { header, headerRef, fake, rerenderScreen } = await renderPaused();
    stubGeometry({
      editInset: { top: 600, bottom: 900 },
      editActions: { top: 840, bottom: 884 },
      inset: { top: 650, bottom: 950 },
      actions: { top: 890, bottom: 934 },
    });
    await user.click(screen.getByRole("button", { name: "Edit copy" }));
    await screen.findByRole("dialog", { name: "Replace your current draft?" });
    await user.click(screen.getByRole("button", { name: "End ride" }));
    await endConfirm();

    await user.click(screen.getByRole("button", { name: "Resume ride" }));
    headerRef.current = null;
    act(() => {
      fake.watches[0]?.emitFix(midpointFix(2000));
    });
    await waitFor(async () => {
      expect((await getActiveRideState())?.lastFix?.timestampMs).toBe(2000);
    });
    const log = captureLog();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await screen.findByRole("button", { name: "Resume ride" });
    await screen.findByRole("dialog", { name: "Replace your current draft?" });
    const dialog = await endConfirm();
    expect(scrolls(log)).toEqual([]);

    headerRef.current = header;
    rerenderScreen();
    expect(scrolls(log)).toEqual(["scrollBy:140:0:auto", "scrollBy:190:0:auto"]);
    expect(cancelIn(dialog)).toHaveFocus();
  });

  describe("a Cancel made while a Pause is still being saved", () => {
    it("returns focus to the paused screen's End ride, without scrolling and with the minimal reveal, once the navigation is back — if the rider did nothing meanwhile", async () => {
      const { user, header, headerRef, rerenderScreen, container } = await renderRiding();
      stubGeometry({ trigger: { top: 30, bottom: 74 } });
      headerRef.current = null;
      await user.click(screen.getByRole("button", { name: "End ride" }));
      const dialog = await endConfirm();
      const write = holdPauseWrite();
      await user.click(screen.getByRole("button", { name: "Pause" }));
      expect(screen.getByRole("button", { name: "Pausing…" })).toBeDisabled();
      const log = captureLog();

      await user.click(cancelIn(dialog));
      expect(screen.queryByRole("dialog")).toBeNull();
      await write.release();
      await screen.findByRole("button", { name: "Resume ride" });
      expect(appEntriesSince(log, 0, "Cancel")).toEqual([]);

      headerRef.current = header;
      rerenderScreen();
      expect(appEntriesSince(log, 0, "Cancel")).toEqual([
        "focus:End ride:noscroll",
        "scrollBy:-38:0:auto",
      ]);
      expect(panelTrigger(container)).toHaveFocus();
    });

    it.each([
      [
        "a tap",
        () => {
          fireEvent.pointerDown(document.body);
        },
      ],
      [
        "a key",
        () => {
          fireEvent.keyDown(document.body, { key: "Tab" });
        },
      ],
      [
        "a wheel scroll",
        () => {
          fireEvent.wheel(document.body, { deltaY: 120 });
        },
      ],
    ])(
      "takes neither focus nor the page once the rider has moved on with %s",
      async (_label, moveOn) => {
        const { user, header, headerRef, rerenderScreen } = await renderRiding();
        stubGeometry({ trigger: { top: 30, bottom: 74 } });
        headerRef.current = null;
        await user.click(screen.getByRole("button", { name: "End ride" }));
        const dialog = await endConfirm();
        const write = holdPauseWrite();
        await user.click(screen.getByRole("button", { name: "Pause" }));
        const log = captureLog();
        await user.click(cancelIn(dialog));

        moveOn();
        await write.release();
        await screen.findByRole("button", { name: "Resume ride" });
        headerRef.current = header;
        rerenderScreen();

        expect(appEntriesSince(log, 0, "Cancel")).toEqual([]);
        expect(screen.getByRole("button", { name: "End ride" })).not.toHaveFocus();
      },
    );

    it("takes neither focus nor the page once focus has moved elsewhere", async () => {
      const { user, header, headerRef, rerenderScreen } = await renderRiding();
      stubGeometry({ trigger: { top: 30, bottom: 74 } });
      const elsewhere = document.createElement("button");
      elsewhere.className = "c11-elsewhere";
      elsewhere.textContent = "Elsewhere";
      document.body.appendChild(elsewhere);
      headerRef.current = null;
      await user.click(screen.getByRole("button", { name: "End ride" }));
      const dialog = await endConfirm();
      const write = holdPauseWrite();
      await user.click(screen.getByRole("button", { name: "Pause" }));
      await user.click(cancelIn(dialog));
      const log = captureLog();

      elsewhere.focus();
      await write.release();
      await screen.findByRole("button", { name: "Resume ride" });
      headerRef.current = header;
      rerenderScreen();

      expect(log).toEqual(["focus:Elsewhere:scroll"]);
      expect(elsewhere).toHaveFocus();
    });

    it("keeps the riding header's own plain focus return when the Pause fails", async () => {
      const { user } = await renderRiding();
      stubGeometry({ trigger: { top: 30, bottom: 74 } });
      await user.click(screen.getByRole("button", { name: "End ride" }));
      const dialog = await endConfirm();
      const write = holdPauseWrite();
      await user.click(screen.getByRole("button", { name: "Pause" }));
      const log = captureLog();
      await user.click(cancelIn(dialog));

      await write.fail();
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();
      });
      expect(log.filter((entry) => entry.startsWith("focus:End ride"))).toEqual([
        "focus:End ride:scroll",
      ]);
      expect(scrolls(log)).toEqual([]);
    });

    it("detaches its guard, taking nothing later, when the screen unmounts while it waits", async () => {
      const armSpy = vi.spyOn(guardModule, "armOperationInteractionGuard");
      const { user, unmount } = await renderRiding();
      stubGeometry({ trigger: { top: 30, bottom: 74 } });
      await user.click(screen.getByRole("button", { name: "End ride" }));
      const dialog = await endConfirm();
      const write = holdPauseWrite();
      await user.click(screen.getByRole("button", { name: "Pause" }));
      await user.click(cancelIn(dialog));
      const guard = armSpy.mock.results.at(-1)?.value as OperationInteractionGuard;
      expect(guard.armed).toBe(true);
      const log = captureLog();

      unmount();
      expect(guard.armed).toBe(false);
      await write.release();
      expect(log).toEqual([]);
    });
  });
});
