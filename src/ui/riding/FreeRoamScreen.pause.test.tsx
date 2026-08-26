// Deliberately separate from FreeRoamScreen.test.tsx and
// FreeRoamScreen.endRide.test.tsx — mirrors RidingScreen.pause.test.tsx's
// own established file-size/organisation-hygiene precedent for a split
// test file, using the exact same real-Dexie/fake-indexeddb backend plus
// targeted vi.spyOn approach. See CLAUDE.md's item 55 entry for the
// feature this proves (Immersive active-Riding shell and Pause lifecycle).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FreeRoamScreen } from "./FreeRoamScreen.tsx";
import { db } from "../../storage/db.ts";
import { getActiveRideState } from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";

/** Mirrors FreeRoamScreen.endRide.test.tsx's identical local stub. */
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FreeRoamScreen Pause (backlog item 55)", () => {
  it("shows Pause with the title 'Free roam' immediately — free roam auto-starts, no pre-ride idle state", () => {
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Free roam" }),
    ).toBeInTheDocument();
  });

  it("has no confirmation — pressing Pause never shows an alertdialog", async () => {
    const user = userEvent.setup();
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a successful Pause writes a resumable row and calls onRidePaused only after nav.pause() resolves", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRidePaused = vi.fn();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRidePaused={onRidePaused}
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
    // Let the ordinary fix-triggered persistence effect's own write settle
    // first, so the deferred mock installed below is only ever consumed by
    // pause()'s own explicit write.
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });

    let resolveWrite: (() => void) | undefined;
    const setSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      );

    await user.click(screen.getByRole("button", { name: "Pause" }));

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

  it("does not call onRideFinalized or clear storage", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    const onRidePaused = vi.fn();
    const onRideFinalized = vi.fn();
    render(
      <FreeRoamScreen
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
        onRidePaused={onRidePaused}
        onRideFinalized={onRideFinalized}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(onRidePaused).toHaveBeenCalledOnce();
    });
    expect(onRideFinalized).not.toHaveBeenCalled();

    const stored = await getActiveRideState();
    expect(stored).toBeDefined();
  });

  it("a storage failure shows a retryable, accessible error and keeps the session active", async () => {
    const user = userEvent.setup();
    const setSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Free roam could not be paused on this device. Try again.",
    );
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled();

    setSpy.mockRestore();
    await user.click(screen.getByRole("button", { name: "Pause" }));

    // Mirrors the identical rationale above: this component has no
    // idle-gate of its own, so the retry's success is proven via storage,
    // not the header disappearing from the DOM.
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled();
  });

  it("moves focus to the Pause button after a failed pause", async () => {
    const user = userEvent.setup();
    vi.spyOn(rideStateRepository, "setActiveRideState").mockRejectedValueOnce(
      new Error("boom"),
    );

    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));

    await screen.findByRole("alert");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
    });
  });

  it("End ride still opens/cancels correctly from the immersive header's own slot", async () => {
    const user = userEvent.setup();
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "End ride" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();
    });
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled();
  });

  it("mutual exclusion: Pause is disabled while an End-ride finalisation is genuinely in flight", async () => {
    const user = userEvent.setup();
    let resolveClear: (() => void) | undefined;
    vi.spyOn(rideStateRepository, "clearActiveRideState").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve;
        }),
    );

    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "End ride" }));
    await user.click(await screen.findByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("button", { name: "Ending ride…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();

    await act(async () => {
      resolveClear?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    // This component has no idle-gate of its own (unlike RidingScreen) —
    // it relies on its parent (App.tsx) to unmount it once onRideFinalized
    // fires, so the finalisation's own success is proven via storage
    // rather than the header disappearing from the DOM, mirroring
    // FreeRoamScreen.endRide.test.tsx's own established convention.
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
  });

  it("mutual exclusion: End ride is disabled while a Pause is genuinely in flight", async () => {
    const user = userEvent.setup();
    let resolveWrite: (() => void) | undefined;
    vi.spyOn(rideStateRepository, "setActiveRideState").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
      />,
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
    const fakeWakeLock = buildFakeWakeLockSource();
    render(
      <FreeRoamScreen
        geolocationSource={buildFakeGeolocationSource().source}
        mapFactory={createMockMapFactory().factory}
        wakeLockSource={fakeWakeLock.source}
      />,
    );

    const toggle = await screen.findByRole("button", { name: "Screen on" });
    await user.click(toggle);
    act(() => {
      fakeWakeLock.instances[0]?.resolveRequest();
    });
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    });
    expect(fakeWakeLock.requestSpy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Screen on" })).toBeNull();
    });
    expect(fakeWakeLock.instances[0]?.released).toBe(true);

    const stored = await getActiveRideState();
    if (stored && "wakeLockDesired" in stored) {
      expect(stored.wakeLockDesired).toBe(true);
    } else {
      throw new Error("expected a free-roam ride-state row with wakeLockDesired");
    }
  });
});
