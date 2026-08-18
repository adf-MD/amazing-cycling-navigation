import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.tsx";
import type { MapFactory, MapLibreLike } from "./map/mapAdapter.ts";
import { db } from "./storage/db.ts";
import { getActiveRideState, setActiveRideState } from "./storage/rideStateRepository.ts";
import * as rideStateRepository from "./storage/rideStateRepository.ts";
import { trackWithElevationGpx } from "./test/fixtures/gpx.ts";

describe("App", () => {
  it("does not render the persistent product-name heading, and shows the Routes screen's own heading instead", () => {
    render(<App />);
    expect(
      screen.queryByRole("heading", { name: /amazing cycling navigation/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
  });

  it("navigates to Settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OpenRouteService" })).toBeInTheDocument();
  });

  it("shows the empty Ride state, and Choose a route returns to Routes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Ride" }));
    expect(screen.getByRole("heading", { name: "Ride" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Choose a route" }));
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
  });

  // Deliberately excludes "Plan": PlanningScreen mounts a real, unmocked
  // MapView here (unlike PlanningScreen's own test suite, which injects a
  // mock map factory), and jsdom has no WebGL2 support — mounting then
  // unmounting it races MapView's WebGL-failure fallback path and throws
  // an unrelated, pre-existing error. That's a MapView/mapAdapter lifecycle
  // issue, not something this visual-foundation slice touches; Planning's
  // own heading is unaffected and doesn't need app-level re-verification.
  it("switching every navigation destination shows that screen's own primary heading", async () => {
    const user = userEvent.setup();
    render(<App />);

    const destinations: [string, string][] = [
      ["Routes", "Routes"],
      ["Diagnostics", "Diagnostics"],
      ["Settings", "Settings"],
    ];

    for (const [navLabel, headingName] of destinations) {
      await user.click(screen.getByRole("button", { name: navLabel }));
      expect(screen.getByRole("heading", { name: headingName })).toBeInTheDocument();
    }
  });

  it("applies the app-shell class, so the header/nav stay clear of the iOS status bar and notch via safe-area-inset padding", () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".app-shell");
    expect(shell).toBeInTheDocument();
    expect(shell?.querySelector("header")).toBeInTheDocument();
  });
});

// A minimal MapLibreLike stub with no-op methods — deliberately not shared
// with RidingScreen.test.tsx's own richer buildStubMapFactory (which adds
// spies/trigger helpers for camera/tile-load testing these scroll tests
// don't need). Injected as App's mapFactory so opening a route into a real
// RidingScreen doesn't mount a real, unmocked MapView — the same jsdom/
// WebGL2 hazard the "switching every navigation destination" test above
// documents for why "Plan" is excluded.
function buildNoopMapFactory(): MapFactory {
  return () => {
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
      getCenter: () => [0, 0],
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
}

function installScrollToSpy() {
  window.scrollY = 0;
  return vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
    const [a, b] = args;
    if (typeof a === "object" && a !== null && "top" in a) {
      const top = (a as ScrollToOptions).top;
      if (typeof top === "number") window.scrollY = top;
    } else if (typeof b === "number") {
      window.scrollY = b;
    }
  });
}

function buildGpxFile(name: string, content: string): File {
  return new File([content], name, { type: "application/gpx+xml" });
}

async function importFixture(user: ReturnType<typeof userEvent.setup>, name: string) {
  const file = buildGpxFile(name, trackWithElevationGpx);
  const expectedName = name.replace(/\.gpx$/i, "");
  await user.upload(screen.getByLabelText("Import GPX file"), file);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: expectedName })).toBeInTheDocument();
  });
}

describe("App — document scroll around Ride content", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has no stale in-memory restoration on a fresh application load", () => {
    const scrollToSpy = installScrollToSpy();
    render(<App mapFactory={buildNoopMapFactory()} />);

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("opening a route far down a scrolled library resets to the top; returning to Routes restores the offset once; opening a different route resets again", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");

    window.scrollY = 9000; // simulates having scrolled far down a long library
    await user.click(screen.getByRole("button", { name: "Route A" }));

    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenNthCalledWith(1, { top: 0, left: 0, behavior: "auto" });

    window.scrollY = 900; // simulates scrolling while on Riding — must not be reused as the library offset
    await user.click(screen.getByRole("button", { name: "Routes" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Route B" })).toBeInTheDocument();
    });

    expect(scrollToSpy).toHaveBeenCalledTimes(2);
    expect(scrollToSpy).toHaveBeenNthCalledWith(2, {
      top: 9000,
      left: 0,
      behavior: "auto",
    });

    // Selecting a different route must reset to the top again, not reuse
    // Riding-A's leftover offset or fail to re-fire because a reset
    // already happened once before.
    await user.click(screen.getByRole("button", { name: "Route B" }));

    expect(screen.getByRole("heading", { name: "Route B" })).toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(3);
    expect(scrollToSpy).toHaveBeenNthCalledWith(3, { top: 0, left: 0, behavior: "auto" });
  });

  it("opening the topmost, just-imported route (no prior scroll) still resets to the top", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");

    expect(window.scrollY).toBe(0);
    await user.click(screen.getByRole("button", { name: "Route A" }));

    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenNthCalledWith(1, { top: 0, left: 0, behavior: "auto" });
  });

  it("a plain nav-tab return to an already-open ride does not re-fire the reset", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Diagnostics" }));
    await user.click(screen.getByRole("button", { name: "Ride" }));

    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });
});

describe("App — immersive Riding shell", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    // Explicit cleanup() BEFORE unstubbing globals, not just relying on
    // React Testing Library's own automatic post-test unmount: that
    // automatic cleanup is registered as a root-level afterEach (at
    // @testing-library/react's own import time), which Vitest runs
    // *after* this describe-scoped afterEach — too late, since a
    // genuinely-started watch's unmount cleanup calls
    // navigator.geolocation.clearWatch, which needs the stub still in
    // place. Calling cleanup() here first unmounts while the stub is
    // still live; the later automatic cleanup then finds nothing left.
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stickyHeader(): Element {
    const nav = screen.getByRole("navigation", { name: "Main" });
    const header = nav.closest("header");
    if (!header) throw new Error("expected the nav to be wrapped in a header");
    return header;
  }

  /** Genuinely absent, not merely non-sticky (backlog item 55 supersedes
   * item 24's old "static-but-visible" nav state — MainNavigation now
   * either renders sticky, or doesn't render at all). */
  function expectMainNavigationAbsent() {
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  }

  /** A geolocation stub that, unlike the "Back to Ride options" describe
   * block's own simpler same-named helper, also exposes emitFix — most
   * callers here don't need a fix merely to flip geolocationStatus to
   * "watching" (set synchronously inside start(), before any fix
   * arrives), but Pause's own "preserves progress" contract needs a real
   * captured position to prove "Resume riding" (not "Start riding") is
   * what the pre-ride panel shows afterwards. */
  function stubGeolocationWatch() {
    const watchPositionSpy = vi.fn();
    let onFixListener: ((position: GeolocationPosition) => void) | undefined;
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: (onFix: (position: GeolocationPosition) => void): number => {
          onFixListener = onFix;
          watchPositionSpy(onFix);
          return 1;
        },
        getCurrentPosition: vi.fn(),
        // Pause/stop() always calls the watch's own cleanup, which in turn
        // calls navigator.geolocation.clearWatch — required here, unlike
        // the "Back to Ride options" describe block's own identical-looking
        // stub, which never actually starts (and so never stops) a watch.
        clearWatch: vi.fn(),
      },
    });
    return {
      watchPositionSpy,
      emitFix: () => {
        onFixListener?.({
          coords: {
            longitude: 0,
            latitude: 51,
            accuracy: 8,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: 1000,
        } as GeolocationPosition);
      },
    };
  }

  it("renders the wrapping header sticky on the initial Routes screen", () => {
    render(<App />);
    expect(stickyHeader()).toHaveClass("app-header--sticky");
  });

  it("keeps the header sticky on every top-level screen reachable without GPS, including the empty Ride state", async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const label of ["Ride", "Diagnostics", "Settings", "Routes"]) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(stickyHeader()).toHaveClass("app-header--sticky");
    }
  });

  it("keeps the header sticky on the pre-ride Riding screen (idle, route selected, Start riding not tapped)", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));

    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(stickyHeader()).toHaveClass("app-header--sticky");
  });

  it("renders exactly one <nav aria-label='Main'>, regardless of screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const label of ["Ride", "Diagnostics", "Settings", "Routes"]) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(1);
    }
  });

  it("active route Riding omits MainNavigation from the DOM and renders the immersive header instead", async () => {
    const user = userEvent.setup();
    stubGeolocationWatch();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));
    await user.click(screen.getByRole("button", { name: "Start riding" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });
    expectMainNavigationAbsent();
    expect(
      screen.getByRole("heading", { level: 1, name: "Route A" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
  });

  it("active free roam omits MainNavigation from the DOM and renders the immersive header instead", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await user.click(screen.getByRole("button", { name: "Ride" }));
    await user.click(await screen.findByRole("button", { name: "Start free roam" }));

    // Unlike RidingScreen, FreeRoamScreen's own immersive header (and its
    // Pause button) renders unconditionally, so it appears before
    // onRidingActiveChange(true) has necessarily propagated up to App and
    // re-rendered isImmersive — waiting on the header/Pause button alone
    // would be too early. Wait on MainNavigation's own absence instead,
    // the actual condition this test is about.
    await waitFor(() => {
      expectMainNavigationAbsent();
    });
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Free roam" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
  });

  it("a transient GPS error mid-ride stays immersive — the underlying watch is never torn down for it", async () => {
    const user = userEvent.setup();
    let onErrorListener:
      ((error: { reason: string; message: string }) => void) | undefined;
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: (
          _onFix: unknown,
          onError: (error: { reason: string; message: string }) => void,
        ) => {
          onErrorListener = onError;
          return vi.fn();
        },
        getCurrentPosition: vi.fn(),
        // RTL's own automatic post-test unmount calls the watch's
        // cleanup, which reaches navigator.geolocation.clearWatch.
        clearWatch: vi.fn(),
      },
    });
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));
    await user.click(screen.getByRole("button", { name: "Start riding" }));
    await screen.findByRole("button", { name: "Pause" });

    onErrorListener?.({ reason: "timeout", message: "Getting your location timed out." });

    await screen.findByRole("alert");
    expectMainNavigationAbsent();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("MainNavigation is restored after a successful Pause of a route session, which preserves progress and returns to a launcher offering Resume route with no new geolocation watch", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy, emitFix } = stubGeolocationWatch();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));
    await user.click(screen.getByRole("button", { name: "Start riding" }));
    await screen.findByRole("button", { name: "Pause" });
    expect(watchPositionSpy).toHaveBeenCalledOnce();
    emitFix();

    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resume route" })).toBeInTheDocument();
    });
    expect(stickyHeader()).toHaveClass("app-header--sticky");
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    // Merely showing the paused launcher never issues a new watch.
    expect(watchPositionSpy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Resume route" }));
    // Resuming opens the pre-ride recovery state — the captured fix
    // survived the pause, so this reads "Resume riding" (progress
    // preserved), not "Start riding"; Resume riding is what actually
    // restarts geolocation, not merely landing on this state.
    expect(
      await screen.findByRole("button", { name: "Resume riding" }),
    ).toBeInTheDocument();
    expect(watchPositionSpy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Resume riding" }));
    await waitFor(() => {
      expect(watchPositionSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("MainNavigation is restored after a successful Pause of a free-roam session, which returns to Resume free roam without a silent restart", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await user.click(screen.getByRole("button", { name: "Ride" }));
    await user.click(await screen.findByRole("button", { name: "Start free roam" }));
    await screen.findByRole("button", { name: "Pause" });

    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Resume free roam" }),
      ).toBeInTheDocument();
    });
    expect(stickyHeader()).toHaveClass("app-header--sticky");
    expect(screen.queryByRole("heading", { level: 1, name: "Free roam" })).toBeNull();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
  });
});

describe("App — Route Library search restoration across navigation", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("typing a search query, navigating away, and returning to Routes restores the search and filtered list", async () => {
    const user = userEvent.setup();
    render(<App />);

    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");

    await user.type(screen.getByLabelText("Search routes"), "alpine");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Routes" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Search routes")).toHaveValue("alpine");
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
  });

  it("a full App remount (simulating reload) does not restore the search query", async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await importFixture(user, "Alpine Climb.gpx");
    await user.type(screen.getByLabelText("Search routes"), "alpine");
    await waitFor(() => {
      expect(screen.getByLabelText("Search routes")).toHaveValue("alpine");
    });
    first.unmount();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText("Search routes")).toHaveValue("");
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("a full App remount (simulating reload) still restores a persisted sort order", async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await user.selectOptions(screen.getByLabelText("Sort by"), "name-asc");
    await waitFor(() => {
      expect(screen.getByLabelText("Sort by")).toHaveValue("name-asc");
    });
    first.unmount();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText("Sort by")).toHaveValue("name-asc");
    });
  });
});

describe("App — Ride launcher session recovery", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stickyHeader(): Element {
    const nav = screen.getByRole("navigation", { name: "Main" });
    const header = nav.closest("header");
    if (!header) throw new Error("expected the nav to be wrapped in a header");
    return header;
  }

  it("a resumable session (never selectedRoute) drives the launcher, and Resume route opens the existing recovery state", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");

    await setActiveRideState({
      id: "active",
      routeId: importedRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });

    // Navigate to "Ride" directly — never through Routes/selectedRoute —
    // proving the launcher discovers the session from persisted storage
    // itself, not from any in-memory App state.
    await user.click(screen.getByRole("button", { name: "Ride" }));

    expect(await screen.findByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume route" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Resume route" }));

    expect(
      await screen.findByRole("button", { name: "Resume riding" }),
    ).toBeInTheDocument();
  });

  it("a successful End ride from the resumed state clears selectedRoute, resets scroll, and returns to the empty launcher", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");

    await setActiveRideState({
      id: "active",
      routeId: importedRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });

    await user.click(screen.getByRole("button", { name: "Ride" }));
    await user.click(await screen.findByRole("button", { name: "Resume route" }));
    await screen.findByRole("button", { name: "Resume riding" });
    const scrollCallsBeforeEndRide = scrollToSpy.mock.calls.length;

    expect(stickyHeader()).toHaveClass("app-header--sticky");

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Route A" })).toBeNull();
    expect(scrollToSpy.mock.calls.length).toBeGreaterThan(scrollCallsBeforeEndRide);
    // isRidingActive genuinely flips back to false via RidingScreen's own
    // unmount-driven onRidingActiveChange cleanup, not merely because the
    // route is gone — proven by the header returning to sticky (it's
    // static only while screen === "riding" && isRidingActive).
    expect(stickyHeader()).toHaveClass("app-header--sticky");
  });

  it("a storage-clear failure during End ride leaves the same route selected and RidingScreen still shown", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");

    await setActiveRideState({
      id: "active",
      routeId: importedRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });

    await user.click(screen.getByRole("button", { name: "Ride" }));
    await user.click(await screen.findByRole("button", { name: "Resume route" }));
    await screen.findByRole("button", { name: "Resume riding" });

    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(await getActiveRideState()).toBeDefined();

    clearSpy.mockRestore();
  });
});

describe("App — Back to Ride options (item 51)", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubGeolocationWatch() {
    const watchPositionSpy = vi.fn();
    // Preserve navigator.onLine (read explicitly, as a primitive, rather
    // than spreading the Navigator instance — which would both lose its
    // prototype and, since onLine is typically an inherited accessor
    // rather than an own property, likely not even carry the value across)
    // so RidingScreen's offline banner (useOnlineStatus) isn't perturbed as
    // a side effect of stubbing geolocation.watchPosition.
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: { watchPosition: watchPositionSpy, getCurrentPosition: vi.fn() },
    });
    return watchPositionSpy;
  }

  it("returns a clean pre-ride route screen to the empty Ride launcher, without starting geolocation or touching storage", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();
    const watchPositionSpy = stubGeolocationWatch();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));

    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();

    const scrollCallsBeforeReturn = scrollToSpy.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Back to Ride options" }));

    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Route A" })).toBeNull();
    expect(watchPositionSpy).not.toHaveBeenCalled();
    expect(scrollToSpy.mock.calls.length).toBeGreaterThan(scrollCallsBeforeReturn);
    expect(await getActiveRideState()).toBeUndefined();
    expect(await db.routes.count()).toBe(1);
  });

  it("returns a resumed (still-idle) route screen to the launcher, leaving the persisted session exactly as it was", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");

    await setActiveRideState({
      id: "active",
      routeId: importedRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });

    await user.click(screen.getByRole("button", { name: "Ride" }));
    await user.click(await screen.findByRole("button", { name: "Resume route" }));

    // Mounting RidingScreen on an existing resumable row already normalises/
    // expands its stored fields (camera, wake-lock, elevation view, etc.)
    // via useRideNavigation's own mount-time hydration — unrelated to this
    // action. Snapshot once that settles, so this test proves only that
    // returning to the launcher itself causes no further write.
    expect(
      await screen.findByRole("button", { name: "Resume riding" }),
    ).toBeInTheDocument();
    const settledState = await getActiveRideState();

    await user.click(screen.getByRole("button", { name: "Back to Ride options" }));

    expect(
      await screen.findByRole("button", { name: "Resume route" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume riding" })).toBeNull();
    expect(watchPositionSpy).not.toHaveBeenCalled();
    expect(await getActiveRideState()).toEqual(settledState);
  });
});

describe("App — Free roam", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    // See the "App — immersive Riding shell" describe block's identical
    // afterEach for why cleanup() must run before unstubbing globals.
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stickyHeader(): Element {
    const nav = screen.getByRole("navigation", { name: "Main" });
    const header = nav.closest("header");
    if (!header) throw new Error("expected the nav to be wrapped in a header");
    return header;
  }

  it("Start free roam opens FreeRoamScreen, with no route selected", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await user.click(screen.getByRole("button", { name: "Ride" }));
    await user.click(await screen.findByRole("button", { name: "Start free roam" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Free roam" }),
    ).toBeInTheDocument();
  });

  it("onRideFinalized from FreeRoamScreen clears the ride content, resets scroll, and restores the sticky header", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await user.click(screen.getByRole("button", { name: "Ride" }));
    await user.click(await screen.findByRole("button", { name: "Start free roam" }));
    await screen.findByRole("heading", { level: 1, name: "Free roam" });
    // MainNavigation becomes genuinely absent (backlog item 55) only once
    // the mount effect's nav.start() call has actually flipped
    // geolocationStatus away from "idle" and propagated through
    // onRidingActiveChange — not necessarily settled at the exact
    // microtask the heading itself first appears at.
    await waitFor(() => {
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    });
    const scrollCallsBeforeEndRide = scrollToSpy.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Free roam" })).toBeNull();
    expect(scrollToSpy.mock.calls.length).toBeGreaterThan(scrollCallsBeforeEndRide);
    expect(stickyHeader()).toHaveClass("app-header--sticky");
  });

  it("pausing an active free-roam session shows the launcher (Resume free roam), never a silently-still-active FreeRoamScreen, and starts no new watch merely by landing there", async () => {
    // Backlog item 55 supersedes this test's own former mechanism: leaving
    // via MainNavigation ("Routes" then "Ride") is no longer reachable
    // while free roam is genuinely active, since MainNavigation is
    // genuinely absent throughout (see the "App — immersive Riding shell"
    // describe block above) — Pause is now the only way to leave an
    // active free-roam session, and is what this test drives instead. The
    // property this test has always protected — no silent GPS restart —
    // is unchanged.
    const user = userEvent.setup();
    const watchPositionSpy = vi.fn();
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        // Pause's own stop() calls the watch's cleanup, which reaches
        // navigator.geolocation.clearWatch.
        clearWatch: vi.fn(),
      },
    });
    render(<App mapFactory={buildNoopMapFactory()} />);

    await user.click(screen.getByRole("button", { name: "Ride" }));
    await user.click(await screen.findByRole("button", { name: "Start free roam" }));
    await screen.findByRole("heading", { level: 1, name: "Free roam" });
    expect(watchPositionSpy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Pause" }));

    // Never the still-selected FreeRoamScreen — the launcher, re-hydrated
    // from the still-persisted row, requiring a fresh explicit tap before
    // GPS can restart.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Resume free roam" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { level: 1, name: "Free roam" })).toBeNull();
    // Merely landing on the launcher issues no new watch.
    expect(watchPositionSpy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Resume free roam" }));
    await waitFor(() => {
      expect(watchPositionSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("the identical navigate-away-and-back sequence leaves an open ROUTE session untouched (RidingScreen stays shown directly)", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));
    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Routes" }));
    await user.click(screen.getByRole("button", { name: "Ride" }));

    // Unlike free roam, a route session's own idle panel (not the
    // launcher) is what's shown — this behaviour must be completely
    // unaffected by the free-roam-specific reset in App.tsx's
    // handleNavigate.
    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a route" })).toBeNull();
  });

  it("a saved route cannot silently replace an unfinished free-roam session — Routes is blocked with an explanation, and can open normally once free roam is ended", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await setActiveRideState({
      id: "active",
      kind: "free-roam",
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: null,
    });

    await user.click(screen.getByRole("button", { name: "Route A" }));

    // Blocked: redirected to Ride, never opened into RidingScreen.
    expect(screen.queryByRole("heading", { name: "Route A" })).toBeNull();
    expect(
      await screen.findByText(
        "You have an unfinished free roam session. End it before opening a saved route.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Resume free roam" }),
    ).toBeInTheDocument();
    // The row must genuinely still be there — nothing was cleared.
    expect(await getActiveRideState()).toBeDefined();

    // End the conflicting session, then the same route opens normally.
    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });

    await user.click(screen.getByRole("button", { name: "Routes" }));
    await user.click(await screen.findByRole("button", { name: "Route A" }));
    expect(await screen.findByRole("heading", { name: "Route A" })).toBeInTheDocument();
  });

  it("a failed conflict check also blocks opening a route (fails closed), never silently proceeding", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const readSpy = vi
      .spyOn(rideStateRepository, "getActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await user.click(screen.getByRole("button", { name: "Route A" }));

    expect(screen.queryByRole("heading", { name: "Route A" })).toBeNull();
    expect(
      await screen.findByText(
        "Whether a free roam session is still active could not be checked, so the route was not opened. Try again.",
      ),
    ).toBeInTheDocument();

    readSpy.mockRestore();
  });

  it("Start free roam is unavailable while a route session is unfinished — the launcher shows only Resume route/End ride", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");
    await setActiveRideState({
      id: "active",
      routeId: importedRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });

    await user.click(screen.getByRole("button", { name: "Ride" }));

    expect(
      await screen.findByRole("button", { name: "Resume route" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start free roam" })).toBeNull();
  });
});
