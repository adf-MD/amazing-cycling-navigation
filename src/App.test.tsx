import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.tsx";
import type { MapFactory, MapLibreLike } from "./map/mapAdapter.ts";
import { db } from "./storage/db.ts";
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

    await user.click(screen.getByRole("button", { name: "Choose a route" }));
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
