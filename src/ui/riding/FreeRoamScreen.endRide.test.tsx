// Deliberately separate from FreeRoamScreen.test.tsx — mirrors
// RidingScreen.finishEndRide.test.tsx's own established file-size/
// organisation-hygiene precedent for a split test file, using the exact
// same real-Dexie/fake-indexeddb backend plus targeted vi.spyOn approach.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FreeRoamScreen } from "./FreeRoamScreen.tsx";
import { db } from "../../storage/db.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { clearErrorLog, getRecentErrors } from "../../platform/errorLog.ts";

/** A minimal local MapLibreLike stub, mirroring
 * RidingScreen.finishEndRide.test.tsx's own identical, deliberately
 * duplicated (not shared) convention. */
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
  await db.rideState.clear();
  clearErrorLog();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FreeRoamScreen End ride", () => {
  it("shows the End-ride button immediately — free roam auto-starts, so there is no pre-ride idle state to gate it behind", () => {
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
  });

  it("the confirmation copy does not mention a saved route", async () => {
    const user = userEvent.setup();
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("End this ride?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Your free roam position and camera state will be cleared.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/saved route/i)).toBeNull();
  });

  it("cancelling and Escape both preserve state and restore focus to the trigger", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );
    act(() => {
      fake.watches[0]?.emitFix({
        coordinate: [0, 51],
        accuracyMetres: 8,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
    });

    const endRideButton = screen.getByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // The trigger genuinely unmounts while the confirmation is open
    // (backlog item 50's in-place confirmation morph), so the button
    // re-queried here is a freshly remounted DOM node, not the one captured
    // before the click.
    const restoredEndRideButton = screen.getByRole("button", { name: "End ride" });
    expect(restoredEndRideButton).toHaveFocus();
    expect(await getActiveRideState()).toBeDefined();

    await user.click(restoredEndRideButton);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();
  });

  it("the alertdialog replaces the End-ride trigger inside its own action-row slot, with the heading, status and map staying mounted (backlog item 50)", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const { container } = render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );
    act(() => {
      fake.watches[0]?.emitFix({
        coordinate: [0, 51],
        accuracyMetres: 8,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
    });

    await user.click(await screen.findByRole("button", { name: "End ride" }));

    // .ride-end-ride-row is a persistent action-slot container: it stays
    // mounted and now contains the confirmation directly, rather than the
    // confirmation being appended elsewhere on the page.
    const endRideRow = container.querySelector(".ride-end-ride-row");
    const dialog = await screen.findByRole("alertdialog");
    expect(endRideRow).not.toBeNull();
    expect(endRideRow?.contains(dialog)).toBe(true);
    // The trigger never coexists with the confirmation.
    expect(screen.getAllByRole("button", { name: "End ride" })).toEqual([
      within(dialog).getByRole("button", { name: "End ride" }),
    ]);
    // Surrounding content stays visible and unaffected while the
    // confirmation is open.
    expect(screen.getByRole("heading", { name: "Free roam" })).toBeInTheDocument();
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
  });

  it("confirming End ride clears the persisted session and calls onRideFinalized only after storage is genuinely cleared", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRideFinalized = vi.fn();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );
    act(() => {
      fake.watches[0]?.emitFix({
        coordinate: [0, 51],
        accuracyMetres: 8,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
    });
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(onRideFinalized).toHaveBeenCalledTimes(1);
    expect(fake.watches[0]?.disposed).toBe(true);
  });

  it("a storage-clear failure retains the session, shows a retryable error, never calls onRideFinalized, and a subsequent retry succeeds", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRideFinalized = vi.fn();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );
    act(() => {
      fake.watches[0]?.emitFix({
        coordinate: [0, 51],
        accuracyMetres: 8,
        timestampMs: 1000,
        speedMetresPerSecond: null,
        headingDegrees: null,
      });
    });
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });

    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    const endRideButton = screen.getByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ride could not be ended on this device. Try again.",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await getActiveRideState()).toBeDefined();
    expect(onRideFinalized).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();

    clearSpy.mockRestore();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const retryDialog = await screen.findByRole("alertdialog");
    await user.click(within(retryDialog).getByRole("button", { name: "End ride" }));
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(onRideFinalized).toHaveBeenCalledTimes(1);
  });

  it("a rapid double confirm click clears storage and calls onRideFinalized at most once", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRideFinalized = vi.fn();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirmButton = within(dialog).getByRole("button", { name: "End ride" });
    await user.dblClick(confirmButton);

    await waitFor(() => {
      expect(onRideFinalized).toHaveBeenCalled();
    });
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(onRideFinalized).toHaveBeenCalledTimes(1);
  });

  it("a throwing onRideFinalized still reaches the clean state with no finalizeError shown, and is logged", async () => {
    const user = userEvent.setup();
    const onRideFinalized = vi.fn(() => {
      throw new Error("caller bug");
    });
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      getRecentErrors().some(
        (entry) => entry.context === "free-roam-ride-finalized-callback",
      ),
    ).toBe(true);
  });
});
