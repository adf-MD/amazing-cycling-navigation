import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("App — sticky/static main navigation", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  function stickyHeader(): Element {
    const nav = screen.getByRole("navigation", { name: "Main" });
    const header = nav.closest("header");
    if (!header) throw new Error("expected the nav to be wrapped in a header");
    return header;
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
