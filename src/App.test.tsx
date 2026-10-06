import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.tsx";
import type { MapFactory, MapLibreLike } from "./map/mapAdapter.ts";
import { db } from "./storage/db.ts";
import { getActiveRideState, setActiveRideState } from "./storage/rideStateRepository.ts";
import { saveProviderKey } from "./storage/providerKeyRepository.ts";
import * as rideStateRepository from "./storage/rideStateRepository.ts";
import * as routesRepository from "./storage/routesRepository.ts";
import { trackWithElevationGpx } from "./test/fixtures/gpx.ts";
import { holdIdbStore, releaseAllIdbHolds } from "./test/idbHold.ts";
import { clearErrorLog, getRecentErrors } from "./platform/errorLog.ts";

// Several tests below navigate to Status, mounting the real
// DiagnosticsScreen, whose inline isMapRenderingSupported() call would
// otherwise hit jsdom's unimplemented WebGL context and log a warning —
// mirrors DiagnosticsScreen.test.tsx's own identical stub (see that
// file's comment for why this is a capability-result stub, not a fake
// WebGL implementation). No test here asserts on the specific
// Supported/Not-supported text, so a static true is enough.
vi.mock("./platform/mapSupport.ts", () => ({
  isMapRenderingSupported: vi.fn(() => true),
}));

// jsdom doesn't implement scrollIntoView at all — mirrors
// RouteSummaryPanel.test.tsx's/RouteListItem.test.tsx's own identical
// precedent. Global here (not per-describe) since the item 73 follow-up's
// inline switch prompt can now mount anywhere Routes is rendered.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

// jsdom doesn't implement window.scrollTo either (see
// useResetScrollForNewRideContent.ts, which App wires up for every
// screen, not only Riding-specific describe blocks below) — global for
// the same reason as scrollIntoView above: any test that navigates to
// Riding can trigger the real, unmocked call otherwise. restoreMocks in
// vite.config.ts's test config auto-restores this vi.spyOn between
// tests, so no matching afterEach is needed here (unlike scrollIntoView's
// manual reassignment above, which restoreMocks doesn't cover).
beforeEach(() => {
  installScrollToSpy();
});

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

    // Status is reached through the Settings/Status switcher (backlog item
    // 121); its heading, like Settings', is visually hidden but remains the
    // page's first heading for assistive technology.
    const steps: [() => HTMLElement, string][] = [
      [() => navButton("Routes"), "Routes"],
      [() => navButton("Settings"), "Settings"],
      [() => switcherButton("Status"), "Status"],
      [() => switcherButton("Settings"), "Settings"],
      [() => navButton("Routes"), "Routes"],
    ];

    for (const [button, headingName] of steps) {
      await user.click(button());
      expect(
        screen.getByRole("heading", { level: 1, name: headingName }),
      ).toBeInTheDocument();
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

/** A primary-navigation tab. Scoped to the "Main" landmark: since backlog
 * item 121, the Settings and Status views also show a Settings/Status
 * switcher, whose Settings button has the same name as the tab. */
function navButton(name: string) {
  return within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", {
    name,
  });
}

/** A button of the Settings/Status switcher (backlog item 121), the only
 * route to Status now that it is not a primary destination. */
function switcherButton(name: "Settings" | "Status") {
  return within(
    screen.getByRole("navigation", { name: "Settings and Status" }),
  ).getByRole("button", { name });
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

// jsdom's default getBoundingClientRect() is all-zero, which trivially
// satisfies isCardAlreadyFullyVisible and means RouteListItem's own
// scroll-into-view effect never actually calls scrollIntoView here at
// all — mirrors RouteListItem.test.tsx's own stubRect() shape (tall
// enough to exceed jsdom's default 768 innerHeight) so a test that needs
// to prove something about a REAL scrollIntoView call (or the deliberate
// absence of one) exercises the "must scroll" branch instead of a
// vacuously-already-satisfied one.
function stubOffscreenCardGeometry() {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 900,
    left: 0,
    right: 320,
    width: 320,
    height: 800,
    x: 0,
    y: 100,
    toJSON: () => "",
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

/** Backlog item 132: the first Ride entry with a stored route ride opens
 * that route's own paused screen, so the launcher's summary — its Resume
 * ride, which carries the one-use resume instruction (items 72 and 131),
 * and its End ride — is reached through that screen's Back to Ride
 * options. Returns the launcher's region, so a caller presses the
 * launcher's Resume ride and never the paused screen's identically named
 * one. */
async function openLauncherFromPausedScreen(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(navButton("Ride"));
  const riding = await screen.findByRole("region", { name: "Riding" });
  await user.click(
    await within(riding).findByRole("button", { name: "Back to Ride options" }),
  );
  const launcher = await screen.findByRole("region", { name: "Ride" });
  await within(launcher).findByText("You have an unfinished ride on this route.");
  return launcher;
}

// Mirrors RouteLibrary.test.tsx's own identical helper — the item 73
// follow-up's inline switch prompt renders inside a specific route card.
function getListItemByRouteId(id: string): HTMLElement {
  const item = document.querySelector(`[data-route-id="${id}"]`);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`No list item found for route id ${id}`);
  }
  return item;
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

    // Simulates scrolling while on Riding — must not be reused as the
    // library offset. A real user scroll is always preceded by a genuine
    // input event (touch/wheel/pointer), which is exactly what the item
    // 95 follow-up's reassertion loop (useResetScrollForNewRideContent)
    // uses to recognise "this is deliberate, stop correcting it" rather
    // than a leftover animation frame — dispatched here so this scroll is
    // not fought even if that loop happens to still be active.
    window.dispatchEvent(new Event("wheel"));
    window.scrollY = 900;
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

    // Settings applies its own interim top reset on entry (backlog item
    // 121), so the count is taken after arriving there: what must not
    // happen is a further reset when the rider returns to the open ride.
    await user.click(navButton("Settings"));
    const callsBeforeReturn = scrollToSpy.mock.calls.length;
    await user.click(navButton("Ride"));

    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(callsBeforeReturn);
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
    for (const button of [
      () => navButton("Ride"),
      () => navButton("Settings"),
      () => switcherButton("Status"),
      () => navButton("Routes"),
    ]) {
      await user.click(button());
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
    for (const button of [
      () => navButton("Ride"),
      () => navButton("Settings"),
      () => switcherButton("Status"),
      () => navButton("Routes"),
    ]) {
      await user.click(button());
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

  it("MainNavigation is restored after a successful Pause of a route session, which stays on the same route and resumes with one further tap (backlog item 72)", async () => {
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

    // Stays on the same route screen — never bounces through the empty Ride
    // launcher — with the global nav restored and the resumable panel
    // showing directly. The "Resume ride" button and MainNavigation's
    // return are driven by two separate state updates (RidingScreen's own
    // geolocationStatus, then App's isRidingActive via the
    // onRidingActiveChange effect) — poll for both together rather than
    // asserting the second synchronously right after the first resolves.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resume ride" })).toBeInTheDocument();
      expect(stickyHeader()).toHaveClass("app-header--sticky");
    });
    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    // Merely showing the paused panel never issues a new watch.
    expect(watchPositionSpy).toHaveBeenCalledOnce();

    // One further tap — no launcher round-trip — restarts GPS.
    await user.click(screen.getByRole("button", { name: "Resume ride" }));
    await screen.findByRole("button", { name: "Pause" });
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

    await user.click(navButton("Settings"));
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();

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

// Backlog item 124, D-02: App owns the confirmed route deletion, so leaving
// Routes while it runs never brings the rider back to an ordinary, fully
// enabled card, and a failure that lands while they are away is still
// shown beside its route on return — without taking focus. Real holds on
// the app's IndexedDB stores (src/test/idbHold.ts) keep it pending; each
// return to Routes is well inside Dexie's three-second cache window, after
// which a real read would wait behind the hold.
describe("App — a confirmed route deletion across navigation (item 124, D-02)", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
    clearErrorLog();
  });

  afterEach(async () => {
    await releaseAllIdbHolds();
    vi.restoreAllMocks();
    clearErrorLog();
  });

  async function importTwoRoutes(user: ReturnType<typeof userEvent.setup>) {
    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    return { routeA, routeB };
  }

  async function confirmHeldDelete(
    user: ReturnType<typeof userEvent.setup>,
    routeId: string,
    options: { captureDeletes?: boolean } = {},
  ) {
    await user.click(
      within(getListItemByRouteId(routeId)).getByRole("button", { name: "Delete" }),
    );
    const hold = await holdIdbStore("routes", options);
    await user.click(screen.getByRole("button", { name: "Delete route" }));
    return hold;
  }

  it("shows a deletion still running as Deleting…, with its actions unavailable and no focus taken, after leaving Routes and returning", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const { routeA } = await importTwoRoutes(user);
    const hold = await confirmHeldDelete(user, routeA.id);

    await user.click(navButton("Settings"));
    expect(screen.queryByRole("button", { name: "Route A" })).toBeNull();
    await user.click(navButton("Routes"));

    const card = await waitFor(() => getListItemByRouteId(routeA.id));
    expect(within(card).getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Route A" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(navButton("Routes")).toHaveFocus();

    await hold.release();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Route A" })).toBeNull();
    });
    expect(navButton("Routes")).toHaveFocus();
  });

  it("shows a failure that landed while the rider was away beside its route on return, without taking focus, and logs it", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const { routeA } = await importTwoRoutes(user);
    const hold = await confirmHeldDelete(user, routeA.id, { captureDeletes: true });

    await user.click(navButton("Settings"));
    await hold.release({ abortCapturedDeletes: true });
    await waitFor(() => {
      expect(getRecentErrors().map((entry) => entry.context)).toContain("route-delete");
    });
    await user.click(navButton("Routes"));

    const card = await waitFor(() => getListItemByRouteId(routeA.id));
    expect(within(card).getByRole("alert")).toHaveTextContent(
      "That route could not be deleted.",
    );
    expect(within(card).getByRole("button", { name: "Delete route" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(navButton("Routes")).toHaveFocus();
    expect(await db.routes.count()).toBe(2);
  });

  it("never lets a route card's switch prompt clear a running deletion, but lets a later one supersede its failure", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const { routeA, routeB } = await importTwoRoutes(user);
    // A paused free-roam session: Route B's prompt then needs no route read,
    // which would otherwise wait behind the held deletion.
    await setActiveRideState({
      id: "active",
      kind: "free-roam",
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: null,
    });
    const hold = await confirmHeldDelete(user, routeA.id, { captureDeletes: true });

    await user.click(screen.getByRole("button", { name: "Route B" }));
    await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    expect(
      within(getListItemByRouteId(routeA.id)).getByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();

    await hold.release({ abortCapturedDeletes: true });
    await waitFor(() => {
      expect(
        within(getListItemByRouteId(routeA.id)).getByRole("alert"),
      ).toBeInTheDocument();
    });
    await user.click(
      within(getListItemByRouteId(routeB.id)).getByRole("button", { name: "Cancel" }),
    );
    await user.click(screen.getByRole("button", { name: "Route B" }));
    await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    expect(within(getListItemByRouteId(routeA.id)).queryByRole("dialog")).toBeNull();
  });

  it("never opens a route whose deletion started after its name was tapped", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const { routeA } = await importTwoRoutes(user);
    // Holds the switch guard's ride-state read, so the tap's transition is
    // still unresolved when the deletion starts.
    const rideStateHold = await holdIdbStore("rideState");
    await user.click(screen.getByRole("button", { name: "Route A" }));
    const routesHold = await confirmHeldDelete(user, routeA.id);

    await rideStateHold.release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("heading", { level: 1, name: "Routes" })).toBeInTheDocument();
    expect(
      within(getListItemByRouteId(routeA.id)).getByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();

    await routesHold.release();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Route A" })).toBeNull();
    });
    expect(screen.getByRole("heading", { level: 1, name: "Routes" })).toBeInTheDocument();
  });
});

// Backlog item 100 stage 3: the tag-filter counterpart of the search-
// restoration describe block above — same session-mount-lifetime
// contract (restores across navigate-away/return, resets on a full
// remount), proven through the real import/tag-editor/filter UI rather
// than seeded component state.
describe("App — Route Library tag-filter restoration across navigation", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getListItemForName(name: string): HTMLElement {
    const title =
      screen.queryByRole("button", { name }) ?? screen.getByRole("heading", { name });
    const item = title.closest("li");
    if (!item) throw new Error(`No list item found for route named ${name}`);
    return item;
  }

  async function tagRoute(
    user: ReturnType<typeof userEvent.setup>,
    routeName: string,
    tag: string,
  ) {
    await user.click(
      within(getListItemForName(routeName)).getByRole("button", { name: "Add tags" }),
    );
    await user.type(screen.getByLabelText("Add a tag"), `${tag}{Enter}`);
    await user.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => {
      expect(
        within(getListItemForName(routeName)).getByRole("button", { name: "Edit tags" }),
      ).toBeInTheDocument();
    });
  }

  /** Backlog item 106 made the filter chooser a disclosure that starts
   * collapsed on every mount — including on a return to Routes, which is a
   * fresh RouteLibrary mount. The SELECTION is still restored (and still
   * filtering); only the chooser's own open state is not. */
  async function expandTagFilters(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    const disclosure = screen.getByRole("button", { name: "Filter by tags" });
    if (disclosure.getAttribute("aria-expanded") === "true") return;
    await user.click(disclosure);
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Filter by tags" })).toBeInTheDocument();
    });
  }

  async function clickTagFilter(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ): Promise<void> {
    await expandTagFilters(user);
    await user.click(
      within(screen.getByRole("group", { name: "Filter by tags" })).getByRole("button", {
        name,
      }),
    );
  }

  it("selecting a tag filter, navigating away, and returning to Routes restores the same filter and narrowed list", async () => {
    const user = userEvent.setup();
    render(<App />);

    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
    });

    await user.click(navButton("Settings"));
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Routes" }));

    // The chooser comes back collapsed, but the selection is restored and
    // still filtering — proven first from the collapsed summary, then from
    // the chip itself once expanded.
    await waitFor(() => {
      expect(screen.getByText("1 filter active")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
    await expandTagFilters(user);
    expect(
      within(screen.getByRole("group", { name: "Filter by tags" })).getByRole("button", {
        name: "Gravel",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("a full App remount (simulating reload) does not restore the tag-filter selection", async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(
        within(screen.getByRole("group", { name: "Filter by tags" })).getByRole(
          "button",
          {
            name: "Gravel",
          },
        ),
      ).toHaveAttribute("aria-pressed", "true");
    });
    first.unmount();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Filter by tags" })).toBeInTheDocument();
    });
    // Nothing restored across a genuine remount: no active-filter summary,
    // and the chip itself is unpressed once expanded.
    expect(screen.queryByText("1 filter active")).not.toBeInTheDocument();
    await expandTagFilters(user);
    expect(
      within(screen.getByRole("group", { name: "Filter by tags" })).getByRole("button", {
        name: "Gravel",
      }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("tag-filter and search restoration compose without clobbering each other", async () => {
    const user = userEvent.setup();
    render(<App />);

    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Alpine Descent.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    await user.type(screen.getByLabelText("Search routes"), "alpine");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Alpine Descent" })).toBeInTheDocument();

    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Alpine Descent" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();

    await user.click(navButton("Settings"));
    await user.click(navButton("Routes"));

    await waitFor(() => {
      expect(screen.getByLabelText("Search routes")).toHaveValue("alpine");
    });
    expect(screen.getByText("1 filter active")).toBeInTheDocument();
    await expandTagFilters(user);
    expect(
      within(screen.getByRole("group", { name: "Filter by tags" })).getByRole("button", {
        name: "Gravel",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alpine Descent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
  });
});

describe("App — Ride launcher session recovery", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    // cleanup() BEFORE unstubbing globals — see the "immersive Riding
    // shell" describe block's identical comment: a genuinely-started
    // watch's unmount cleanup calls navigator.geolocation.clearWatch,
    // which needs the stub still in place.
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

  function stubGeolocationWatch() {
    const watchPositionSpy = vi.fn();
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        // These tests genuinely reach "watching" (unlike the "Back to Ride
        // options" describe block's identical-looking stub, which never
        // starts a watch) — unmount's own cleanup calls
        // navigator.geolocation.clearWatch, which must exist here.
        clearWatch: vi.fn(),
      },
    });
    return watchPositionSpy;
  }

  it("a resumable session (never selectedRoute) drives the launcher's summary, reached through the paused screen's Back to Ride options, and its Resume ride opens it directly into active tracking (backlog items 72 and 132)", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
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

    // Navigate to "Ride" directly — never through Routes/selectedRoute. The
    // first entry shows the paused screen (backlog item 132); its Back to
    // Ride options then shows the launcher, which discovers the session
    // from persisted storage itself, not from any in-memory App state.
    const launcher = await openLauncherFromPausedScreen(user);

    expect(
      within(launcher).getByRole("heading", { name: "Route A" }),
    ).toBeInTheDocument();
    expect(
      within(launcher).getByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(
      within(launcher).getByRole("button", { name: "End ride" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    expect(watchPositionSpy).not.toHaveBeenCalled();

    // One tap — no intermediate "Resume riding" idle screen — reaches
    // active tracking directly. Same-session recovery (backlog item 73)
    // must never show the destructive-switch dialog or clear storage.
    await user.click(within(launcher).getByRole("button", { name: "Resume ride" }));

    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
    expect(watchPositionSpy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("a successful End ride from the resumed state clears selectedRoute, resets scroll, and returns to the empty launcher", async () => {
    const user = userEvent.setup();
    stubGeolocationWatch();
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

    const launcher = await openLauncherFromPausedScreen(user);
    await user.click(within(launcher).getByRole("button", { name: "Resume ride" }));
    await screen.findByRole("button", { name: "Pause" });
    const scrollCallsBeforeEndRide = scrollToSpy.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("dialog");
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
    stubGeolocationWatch();
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

    const launcher = await openLauncherFromPausedScreen(user);
    await user.click(within(launcher).getByRole("button", { name: "Resume ride" }));
    await screen.findByRole("button", { name: "Pause" });

    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(await getActiveRideState()).toBeDefined();

    clearSpy.mockRestore();
  });
});

// Backlog item 132: the first Ride entry after a cold start — here, a
// freshly mounted App, which is all a cold start or a reload is — shows a
// stored route ride's own paused screen instead of the launcher's summary
// of it. Restoring it starts no tracking; Resume stays an explicit tap.
describe("App — first Ride entry after a cold start (item 132)", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubGeolocation() {
    const watchPositionSpy = vi.fn();
    const clearWatchSpy = vi.fn();
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        clearWatch: clearWatchSpy,
      },
    });
    return { watchPositionSpy, clearWatchSpy };
  }

  const SESSION_EXTRAS = {
    elevationViewMode: { kind: "upcoming", windowMetres: 10000 },
    wakeLockDesired: true,
    dismissedClimbFeatureId: "climb-dismissed-before-pause",
    completionArmed: true,
    cameraMode: "following",
    cameraZoom: 15.5,
  } as const;

  function routeRow(routeId: string) {
    return {
      id: "active" as const,
      routeId,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: [0, 51] as const, accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 2,
      matchedDistanceFromStartMetres: 40,
      offRouteMachineState: {
        level: "on-route" as const,
        candidateLevel: null,
        streak: 0,
      },
      ...SESSION_EXTRAS,
    };
  }

  async function seedPausedRoute(user: ReturnType<typeof userEvent.setup>) {
    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");
    await setActiveRideState(routeRow(importedRoute.id));
    return importedRoute;
  }

  /** Samples, never stopping at the first success, that the watch count
   * stays where it is. */
  async function expectWatchCountToStay(spy: ReturnType<typeof vi.fn>, count: number) {
    for (let sample = 0; sample < 10; sample += 1) {
      expect(spy).toHaveBeenCalledTimes(count);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  /** Samples that the launcher's summary stays, with no route screen
   * reopened behind the rider's back. */
  async function expectLauncherSummaryToStay() {
    for (let sample = 0; sample < 10; sample += 1) {
      const launcher = screen.getByRole("region", { name: "Ride" });
      expect(
        within(launcher).getByText("You have an unfinished ride on this route."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Riding" })).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  async function findPausedScreen(): Promise<HTMLElement> {
    const riding = await screen.findByRole("region", { name: "Riding" });
    await within(riding).findByRole("button", { name: "Resume ride" });
    return riding;
  }

  /** Holds every ride-state read until released, in call order: the
   * launcher's (getActiveRideStateWithSessionId, since item 140) and the
   * screen's (getActiveRideState). */
  function holdRideStateReads() {
    const realRead = rideStateRepository.getActiveRideState;
    const realLauncherRead = rideStateRepository.getActiveRideStateWithSessionId;
    const pending: (() => Promise<void>)[] = [];
    vi.spyOn(rideStateRepository, "getActiveRideState").mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          pending.push(() => realRead().then(resolve, reject));
        }),
    );
    vi.spyOn(rideStateRepository, "getActiveRideStateWithSessionId").mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          pending.push(() => realLauncherRead().then(resolve, reject));
        }),
    );
    return {
      count: () => pending.length,
      releaseNext: async () => {
        const next = pending.shift();
        if (!next) throw new Error("no held read to release");
        await act(async () => {
          await next();
        });
      },
    };
  }

  it("shows the full paused route screen, with its restored progress, Edit copy and Back to Ride options, and starts no watch", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);

    await user.click(navButton("Ride"));

    const riding = await findPausedScreen();
    expect(
      within(riding).getByRole("heading", { level: 1, name: "Route A" }),
    ).toBeInTheDocument();
    expect(within(riding).getByRole("button", { name: "Edit copy" })).toBeInTheDocument();
    expect(within(riding).getByRole("button", { name: "End ride" })).toBeInTheDocument();
    expect(
      within(riding).getByRole("button", { name: "Back to Ride options" }),
    ).toBeInTheDocument();
    // The restored fix is shown, as stale: the status card is the paused
    // ride's, not a fresh pre-ride.
    expect(within(riding).getByText(/Stale/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ride" })).toBeNull();
    expect(screen.queryByText("You have an unfinished ride on this route.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    await expectWatchCountToStay(watchPositionSpy, 0);
  });

  it("shows Checking while the launcher reads, then Restoring while the screen restores, and only then the paused controls — never Start riding", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    const reads = holdRideStateReads();

    await user.click(navButton("Ride"));
    await waitFor(() => {
      expect(reads.count()).toBe(1);
    });
    expect(screen.getByText("Checking for an unfinished ride…")).toBeInTheDocument();

    await reads.releaseNext();
    const riding = await screen.findByRole("region", { name: "Riding" });
    await waitFor(() => {
      expect(reads.count()).toBe(1);
    });
    expect(
      within(riding).getByText("Restoring your unfinished ride…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit copy" })).toBeNull();

    await reads.releaseNext();
    expect(
      await within(riding).findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Restoring your unfinished ride…")).toBeNull();
    await expectWatchCountToStay(watchPositionSpy, 0);
  });

  it("a failed launcher check offers Retry, and a successful Retry opens the paused screen without a watch", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    // The launcher's own read (item 140).
    vi.spyOn(
      rideStateRepository,
      "getActiveRideStateWithSessionId",
    ).mockRejectedValueOnce(new Error("boom"));

    await user.click(navButton("Ride"));
    const launcher = await screen.findByRole("region", { name: "Ride" });
    expect(await within(launcher).findByRole("alert")).toHaveTextContent(
      "Your unfinished ride status could not be checked. Nothing has been changed.",
    );
    expect(screen.queryByRole("button", { name: "Choose a route" })).toBeNull();

    await user.click(within(launcher).getByRole("button", { name: "Retry" }));
    await findPausedScreen();
    await expectWatchCountToStay(watchPositionSpy, 0);
  });

  it("a failed screen restoration shows the restore alert, and its Retry restores the paused screen without a watch", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const importedRoute = await seedPausedRoute(user);
    // The screen's restore is the first getActiveRideState read: since item
    // 140 the launcher reads through getActiveRideStateWithSessionId.
    vi.spyOn(rideStateRepository, "getActiveRideState").mockRejectedValueOnce(
      new Error("boom"),
    );

    await user.click(navButton("Ride"));
    const riding = await screen.findByRole("region", { name: "Riding" });
    const alert = await within(riding).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your ride could not be restored on this device. Try again.",
    );
    expect(
      within(alert).getByRole("button", { name: "Back to Ride options" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();

    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    await findPausedScreen();
    await expectWatchCountToStay(watchPositionSpy, 0);
    expect(await getActiveRideState()).toMatchObject(routeRow(importedRoute.id));
  });

  it("a missing route, an unsupported session and a free roam keep the launcher's own recovery, and free roam's Resume still works", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await importFixture(user, "Route A.gpx");

    await setActiveRideState(routeRow("route-no-longer-in-the-library"));
    await user.click(navButton("Ride"));
    expect(
      await screen.findByRole("button", { name: "Discard unfinished ride" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Riding" })).toBeNull();
    await user.click(navButton("Routes"));

    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");
    await db.rideState.put({ ...routeRow(importedRoute.id), kind: "training-session" });
    await user.click(navButton("Ride"));
    expect(
      await screen.findByText(
        "This unfinished ride can't be recovered by this version of the app.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Riding" })).toBeNull();
    await user.click(navButton("Routes"));

    await db.rideState.clear();
    await setActiveRideState({
      id: "active",
      kind: "free-roam",
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: null,
    });
    await user.click(navButton("Ride"));
    await user.click(await screen.findByRole("button", { name: "Resume free roam" }));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(watchPositionSpy).toHaveBeenCalledOnce();
  });

  it("Back to Ride options shows the launcher's summary and it stays, also after Routes and back, with no watch", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);

    await user.click(navButton("Ride"));
    const riding = await findPausedScreen();
    await user.click(
      within(riding).getByRole("button", { name: "Back to Ride options" }),
    );
    await screen.findByText("You have an unfinished ride on this route.");
    await expectLauncherSummaryToStay();

    await user.click(navButton("Routes"));
    await screen.findByRole("heading", { name: "Routes" });
    await user.click(navButton("Ride"));
    await screen.findByText("You have an unfinished ride on this route.");
    await expectLauncherSummaryToStay();
    expect(watchPositionSpy).not.toHaveBeenCalled();
  });

  it("after opening the paused route from its Routes card, Back to Ride options shows the launcher's summary and it stays", async () => {
    const user = userEvent.setup();
    stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);

    await user.click(screen.getByRole("button", { name: "Route A" }));
    const riding = await findPausedScreen();
    await user.click(
      within(riding).getByRole("button", { name: "Back to Ride options" }),
    );
    await screen.findByText("You have an unfinished ride on this route.");
    await expectLauncherSummaryToStay();
  });

  it("a launcher check that settles after the rider has left Ride is discarded, and returning shows what storage holds now", async () => {
    const user = userEvent.setup();
    stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    const storedRow = await getActiveRideState();
    if (!storedRow) throw new Error("expected the seeded row");
    const staleRow = { ...storedRow, sessionId: "session-stale" };
    let settleHeldRead!: (
      value: Awaited<
        ReturnType<typeof rideStateRepository.getActiveRideStateWithSessionId>
      >,
    ) => void;
    vi.spyOn(rideStateRepository, "getActiveRideStateWithSessionId").mockReturnValueOnce(
      new Promise((resolve) => {
        settleHeldRead = resolve;
      }),
    );

    await user.click(navButton("Ride"));
    expect(
      await screen.findByText("Checking for an unfinished ride…"),
    ).toBeInTheDocument();
    await user.click(navButton("Routes"));
    await screen.findByRole("heading", { name: "Routes" });

    // The ride ends elsewhere; the old check then settles with the row it
    // read before that — a stale result for a launcher that has gone.
    await db.rideState.clear();
    await act(async () => {
      settleHeldRead(staleRow);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Riding" })).toBeNull();

    // Had the stale check opened its route, the click itself would render
    // that route's screen: content survives leaving Ride.
    await user.click(navButton("Ride"));
    expect(screen.queryByRole("region", { name: "Riding" })).toBeNull();
    expect(screen.getByRole("region", { name: "Ride" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Riding" })).toBeNull();
  });

  it("when the stored session changes between the launcher's read and the screen's, returns to the launcher showing what is stored, never Start riding", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    const realRead = rideStateRepository.getActiveRideState;
    // The screen's restore is the first getActiveRideState read: since item
    // 140 the launcher reads through getActiveRideStateWithSessionId.
    vi.spyOn(rideStateRepository, "getActiveRideState").mockImplementationOnce(
      async () => {
        // Replaced elsewhere, just before the screen restores.
        await setActiveRideState({
          id: "active",
          kind: "free-roam",
          startedAt: "2026-01-02T08:00:00.000Z",
          lastFix: null,
        });
        return realRead();
      },
    );

    await user.click(navButton("Ride"));
    expect(
      await screen.findByRole("button", { name: "Resume free roam" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Riding" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    await expectWatchCountToStay(watchPositionSpy, 0);
  });

  it("while a ride-switch prompt is pending, the first Ride entry shows the launcher's guarded summary; once it is cancelled, the next entry shows the paused screen", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await setActiveRideState(routeRow(routeA.id));
    await user.click(screen.getByRole("button", { name: "Route B" }));
    await within(getListItemByRouteId(routeB.id)).findByRole("dialog");

    await user.click(navButton("Ride"));
    const launcher = await screen.findByRole("region", { name: "Ride" });
    await within(launcher).findByText("You have an unfinished ride on this route.");
    expect(screen.queryByRole("region", { name: "Riding" })).toBeNull();
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(navButton("Routes"));
    await user.click(navButton("Ride"));
    await findPausedScreen();
    await expectWatchCountToStay(watchPositionSpy, 0);
  });

  it("Resume, Pause, Routes and back (restoring first), a second Resume and a second Pause each start or stop exactly one watch, and keep the session's own state", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy, clearWatchSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const importedRoute = await seedPausedRoute(user);

    await user.click(navButton("Ride"));
    let riding = await findPausedScreen();
    await expectWatchCountToStay(watchPositionSpy, 0);

    await user.click(within(riding).getByRole("button", { name: "Resume ride" }));
    await screen.findByRole("button", { name: "Pause" });
    expect(watchPositionSpy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(clearWatchSpy).toHaveBeenCalledOnce();
    });
    await user.click(await screen.findByRole("button", { name: "Routes" }));
    await screen.findByRole("heading", { name: "Routes" });

    // Returning restores first: Restoring, never Start riding, no watch.
    const reads = holdRideStateReads();
    await user.click(navButton("Ride"));
    riding = await screen.findByRole("region", { name: "Riding" });
    await waitFor(() => {
      expect(reads.count()).toBe(1);
    });
    expect(
      within(riding).getByText("Restoring your unfinished ride…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    await reads.releaseNext();
    vi.mocked(rideStateRepository.getActiveRideState).mockRestore();
    await findPausedScreen();
    await expectWatchCountToStay(watchPositionSpy, 1);

    await user.click(screen.getByRole("button", { name: "Resume ride" }));
    await screen.findByRole("button", { name: "Pause" });
    expect(watchPositionSpy).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(clearWatchSpy).toHaveBeenCalledTimes(2);
    await expectWatchCountToStay(watchPositionSpy, 2);
    expect(await getActiveRideState()).toMatchObject({
      routeId: importedRoute.id,
      lastMatchedPointIndex: 2,
      matchedDistanceFromStartMetres: 40,
      ...SESSION_EXTRAS,
    });
  });

  // Amendment 1, on real rider paths: the knowledge that a session is
  // stored outlives a consumed launcher Resume, and a fresh ride gains it
  // once its first fix is stored — so a later return to Ride restores
  // first, whatever the entry that began the ride.
  async function expectRestoringOnReturn(
    user: ReturnType<typeof userEvent.setup>,
    watchPositionSpy: ReturnType<typeof vi.fn>,
    watchesSoFar: number,
  ) {
    await user.click(await screen.findByRole("button", { name: "Routes" }));
    await screen.findByRole("heading", { name: "Routes" });
    const reads = holdRideStateReads();
    await user.click(navButton("Ride"));
    const riding = await screen.findByRole("region", { name: "Riding" });
    await waitFor(() => {
      expect(reads.count()).toBe(1);
    });
    expect(
      within(riding).getByText("Restoring your unfinished ride…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
    await reads.releaseNext();
    vi.mocked(rideStateRepository.getActiveRideState).mockRestore();
    expect(
      await within(riding).findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    await expectWatchCountToStay(watchPositionSpy, watchesSoFar);
  }

  it("after a launcher Resume and a Pause, returning to Ride restores first, though the one-use instruction was retired, and starts no watch", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy, clearWatchSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);

    const launcher = await openLauncherFromPausedScreen(user);
    await user.click(within(launcher).getByRole("button", { name: "Resume ride" }));
    await screen.findByRole("button", { name: "Pause" });
    expect(watchPositionSpy).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(clearWatchSpy).toHaveBeenCalledOnce();
    });

    await expectRestoringOnReturn(user, watchPositionSpy, 1);
  });

  it("a ride freshly started from its Routes card is known once its first fix is stored: after a Pause, returning to Ride restores first, with no watch", async () => {
    const user = userEvent.setup();
    let onFix: ((position: GeolocationPosition) => void) | undefined;
    const watchPositionSpy = vi.fn(
      (listener: (position: GeolocationPosition) => void) => {
        onFix = listener;
        return 1;
      },
    );
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    render(<App mapFactory={buildNoopMapFactory()} />);
    await importFixture(user, "Route A.gpx");

    await user.click(screen.getByRole("button", { name: "Route A" }));
    await user.click(await screen.findByRole("button", { name: "Start riding" }));
    await screen.findByRole("button", { name: "Pause" });
    act(() => {
      onFix?.({
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
    });
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();

    await expectRestoringOnReturn(user, watchPositionSpy, 1);
  });

  it("merely showing a paused ride's screen leaves its stored camera state untouched", async () => {
    const user = userEvent.setup();
    stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const importedRoute = await seedPausedRoute(user);

    // From its Routes card, and then as a return to Ride.
    await user.click(screen.getByRole("button", { name: "Route A" }));
    await findPausedScreen();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await getActiveRideState()).toEqual(routeRow(importedRoute.id));

    await user.click(navButton("Routes"));
    await user.click(navButton("Ride"));
    await findPausedScreen();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await getActiveRideState()).toEqual(routeRow(importedRoute.id));
  });

  it("a Routes-card or Return-to-paused-ride open of the paused route explains a failed restoration instead of offering Start riding", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await setActiveRideState(routeRow(routeA.id));
    const realRead = rideStateRepository.getActiveRideState;

    // Routes card: the guard's read succeeds, the screen's fails.
    const readSpy = vi
      .spyOn(rideStateRepository, "getActiveRideState")
      .mockImplementationOnce(realRead)
      .mockRejectedValueOnce(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Route A" }));
    let riding = await screen.findByRole("region", { name: "Riding" });
    expect(await within(riding).findByRole("alert")).toHaveTextContent(
      "Your ride could not be restored on this device. Try again.",
    );
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    readSpy.mockRestore();

    // Return to paused ride: from Route B's prompt, whose revalidation read
    // succeeds before the screen's fails.
    // The library lists its routes asynchronously after a remount.
    await user.click(navButton("Routes"));
    await user.click(await screen.findByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    vi.spyOn(rideStateRepository, "getActiveRideState")
      .mockImplementationOnce(realRead)
      .mockRejectedValueOnce(new Error("boom"));
    await user.click(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    );
    riding = await screen.findByRole("region", { name: "Riding" });
    expect(
      within(riding).getByRole("heading", { level: 1, name: "Route A" }),
    ).toBeInTheDocument();
    expect(await within(riding).findByRole("alert")).toHaveTextContent(
      "Your ride could not be restored on this device. Try again.",
    );
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    await expectWatchCountToStay(watchPositionSpy, 0);
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

    // A current-format row, with the identity every session has had since
    // item 140: the launcher gives a row without one an identity when it
    // reads it, which is a write of its own (covered in
    // RidingLauncher.test.tsx), and this test is about returning causing
    // none.
    await setActiveRideState({
      id: "active",
      routeId: importedRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      sessionId: "session-seeded",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });

    // Reopens via the Routes-card (handleOpenRoute), not the launcher's
    // one-tap "Resume ride" action (backlog item 72 leaves this path
    // unaffected — it's an ordinary Routes-card reopen, not launcher-driven
    // cold recovery) — this is what still genuinely reaches an idle,
    // restored-but-not-yet-started screen for this test to exercise.
    await user.click(screen.getByRole("button", { name: "Route A" }));

    // Mounting RidingScreen on an existing resumable row already normalises/
    // expands its stored fields (camera, wake-lock, elevation view, etc.)
    // via useRideNavigation's own mount-time hydration — unrelated to this
    // action. Snapshot once that settles, so this test proves only that
    // returning to the launcher itself causes no further write.
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    const settledState = await getActiveRideState();

    await user.click(screen.getByRole("button", { name: "Back to Ride options" }));

    // The persisted row still matches this route, so the launcher
    // re-hydrates directly into its resumable state.
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
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

  it("a direct free-roam write failure with no prior conflict shows an inline retryable error in the launcher itself, never a dialog, and starts no watch (backlog item 73)", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = vi.fn();
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    const writeSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));
    render(<App mapFactory={buildNoopMapFactory()} />);

    await user.click(screen.getByRole("button", { name: "Ride" }));
    const startFreeRoamButton = await screen.findByRole("button", {
      name: "Start free roam",
    });
    await user.click(startFreeRoamButton);

    const errorText = await screen.findByRole("alert");
    expect(errorText).toHaveTextContent(
      "Free roam could not be started on this device. Try again.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText(
        "No route selected yet. Choose a route from Routes to start riding.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start free roam" })).toBeInTheDocument();
    expect(watchPositionSpy).not.toHaveBeenCalled();
    expect(await db.rideState.toArray()).toEqual([]);

    // No separate "Try again" affordance exists for this direct,
    // undialogued failure — retrying via the SAME button falls through to
    // the real implementation once the one-shot rejection is exhausted.
    await user.click(screen.getByRole("button", { name: "Start free roam" }));

    await waitFor(() => {
      expect(watchPositionSpy).toHaveBeenCalledOnce();
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Free roam" }),
    ).toBeInTheDocument();
    expect(writeSpy).toHaveBeenCalledTimes(2);
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
    const dialog = await screen.findByRole("dialog");
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

  it("a saved route cannot silently replace an unfinished free-roam session — Routes shows a confirmation in place, Cancel preserves the row, and confirming clears it before the route opens (backlog item 73)", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const freeRoamRow = {
      id: "active" as const,
      kind: "free-roam" as const,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: null,
    };
    await setActiveRideState(freeRoamRow);

    const [routeA] = await db.routes.toArray();
    if (!routeA) throw new Error("expected an imported route");
    const routeButton = await screen.findByRole("button", { name: "Route A" });
    await user.click(routeButton);

    // Blocked: stays on Routes — never redirected merely to show an error
    // or ask for confirmation. Item 73 follow-up: the prompt is a
    // descendant of Route A's own card, not a page-level dialog.
    expect(screen.queryByRole("heading", { name: "Route A" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
    const routeACard = getListItemByRouteId(routeA.id);
    const dialog = await within(routeACard).findByRole("dialog");
    expect(within(dialog).getByText(/unfinished free roam session/i)).toBeInTheDocument();
    // No Return action — there's no resolvable paused ROUTE to return to.
    expect(
      within(dialog).queryByRole("button", { name: "Return to paused ride" }),
    ).toBeNull();
    // Nothing was cleared or replaced before confirmation — the row is
    // still exactly what it was.
    expect(await getActiveRideState()).toEqual(freeRoamRow);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Cancel preserves the row exactly and restores focus to the trigger.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await getActiveRideState()).toEqual(freeRoamRow);
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Route A" })).toHaveFocus();

    // Confirming clears the free-roam session before the route opens.
    await user.click(screen.getByRole("button", { name: "Route A" }));
    const confirmDialog = await within(routeACard).findByRole("dialog");
    await user.click(
      within(confirmDialog).getByRole("button", { name: "End and switch" }),
    );

    expect(await screen.findByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
    // The free-roam row was genuinely cleared, and the new route session
    // hasn't started GPS (no persistence write happens until then) — so
    // nothing is stored yet at all.
    expect(await getActiveRideState()).toBeUndefined();
  });

  it("a failed conflict check fails closed (never silently proceeding), stays on Routes rather than redirecting, and a retry then opens the route (backlog item 73)", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [routeA] = await db.routes.toArray();
    if (!routeA) throw new Error("expected an imported route");
    const readSpy = vi
      .spyOn(rideStateRepository, "getActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await user.click(screen.getByRole("button", { name: "Route A" }));

    // Stays on Routes — never redirected merely to show an error. Item 73
    // follow-up: still inline inside Route A's own card.
    expect(screen.queryByRole("heading", { name: "Route A" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
    const dialog = await within(getListItemByRouteId(routeA.id)).findByRole("dialog");
    // Distinct, honest copy for a read failure — never worded as a
    // confirmed conflict ("Switch to...?", "must be ended").
    expect(
      within(dialog).getByText("Couldn't check for an unfinished ride"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Whether you have an unfinished ride could not be checked, so nothing has opened yet.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeInTheDocument();

    readSpy.mockRestore();
    await user.click(within(dialog).getByRole("button", { name: "Retry" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("heading", { name: "Route A" })).toBeInTheDocument();
  });

  it("Start free roam is unavailable while a route session is unfinished — neither the paused screen nor the launcher behind it offers it, the launcher only Resume ride/End ride", async () => {
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
    const riding = await screen.findByRole("region", { name: "Riding" });
    expect(
      await within(riding).findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start free roam" })).toBeNull();

    await user.click(
      within(riding).getByRole("button", { name: "Back to Ride options" }),
    );
    const launcher = await screen.findByRole("region", { name: "Ride" });
    expect(
      await within(launcher).findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(
      within(launcher).getByRole("button", { name: "End ride" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start free roam" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose a route" })).toBeNull();
  });
});

// Backlog item 131: a launcher Resume's one-use instruction, end to end
// through the real App and RidingScreen. Pause and the round trip through
// Routes are deliberately separate tests, so the paused screen (the
// display) and the retained instruction (its lifetime) are each observable
// even when the other is broken.
describe("App — a launcher Resume's one-use instruction (item 131)", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    // cleanup() before unstubbing: unmounting a watching screen calls
    // navigator.geolocation.clearWatch, which needs the stub.
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubGeolocation() {
    const watchPositionSpy = vi.fn();
    const clearWatchSpy = vi.fn();
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        clearWatch: clearWatchSpy,
      },
    });
    return { watchPositionSpy, clearWatchSpy };
  }

  const SESSION_EXTRAS = {
    elevationViewMode: { kind: "upcoming", windowMetres: 10000 },
    wakeLockDesired: true,
    dismissedClimbFeatureId: "climb-dismissed-before-pause",
    completionArmed: true,
    cameraMode: "following",
    cameraZoom: 15.5,
  } as const;

  async function seedPausedRoute(user: ReturnType<typeof userEvent.setup>) {
    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");
    await setActiveRideState({
      id: "active",
      routeId: importedRoute.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 2,
      matchedDistanceFromStartMetres: 40,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      ...SESSION_EXTRAS,
    });
    return importedRoute;
  }

  /** Launcher → one-tap Resume ride → actively tracking. The launcher is
   * reached through the paused screen's Back to Ride options (backlog item
   * 132), so this keeps exercising the launcher's one-use instruction. */
  async function resumeFromLauncher(user: ReturnType<typeof userEvent.setup>) {
    const launcher = await openLauncherFromPausedScreen(user);
    await user.click(within(launcher).getByRole("button", { name: "Resume ride" }));
    await screen.findByRole("button", { name: "Pause" });
  }

  /** Samples for a while, never stopping at the first success, that no
   * further watch has started. */
  async function expectWatchCountToStay(spy: ReturnType<typeof vi.fn>, count: number) {
    for (let sample = 0; sample < 10; sample += 1) {
      expect(spy).toHaveBeenCalledTimes(count);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(spy).toHaveBeenCalledTimes(count);
  }

  it("Pause after a launcher Resume shows the ordinary Resume controls, stops the watch and keeps the resumable session", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy, clearWatchSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const importedRoute = await seedPausedRoute(user);
    await resumeFromLauncher(user);
    expect(watchPositionSpy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    expect(screen.queryByText("Resuming your ride…")).toBeNull();
    expect(clearWatchSpy).toHaveBeenCalledOnce();
    expect(await getActiveRideState()).toMatchObject({ routeId: importedRoute.id });
  });

  it("after that Pause, leaving for Routes and returning keeps the ride paused and starts no watch", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy, clearWatchSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    await resumeFromLauncher(user);

    await user.click(screen.getByRole("button", { name: "Pause" }));
    // Waits only on the Pause itself — the watch stopped and the main
    // navigation back — never on the paused screen's own controls.
    await waitFor(() => {
      expect(clearWatchSpy).toHaveBeenCalledOnce();
    });
    await user.click(await screen.findByRole("button", { name: "Routes" }));
    await screen.findByRole("heading", { name: "Routes" });
    await user.click(screen.getByRole("button", { name: "Ride" }));

    // Restoration has settled once either control shows: the paused
    // screen's Resume ride, or — were the instruction replayed — Pause.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Resume ride" }) ??
          screen.queryByRole("button", { name: "Pause" }),
      ).not.toBeNull();
    });
    await expectWatchCountToStay(watchPositionSpy, 1);
    expect(screen.getByRole("button", { name: "Resume ride" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("a fresh, explicit Resume starts exactly one more watch, a second Pause still works, and the session's own state survives both", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy, clearWatchSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const importedRoute = await seedPausedRoute(user);
    await resumeFromLauncher(user);
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(clearWatchSpy).toHaveBeenCalledOnce();
    });
    await user.click(await screen.findByRole("button", { name: "Routes" }));
    await user.click(screen.getByRole("button", { name: "Ride" }));

    await user.click(await screen.findByRole("button", { name: "Resume ride" }));
    await screen.findByRole("button", { name: "Pause" });
    expect(watchPositionSpy).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Resuming your ride…")).toBeNull();
    expect(clearWatchSpy).toHaveBeenCalledTimes(2);
    await expectWatchCountToStay(watchPositionSpy, 2);
    expect(await getActiveRideState()).toMatchObject({
      routeId: importedRoute.id,
      lastMatchedPointIndex: 2,
      matchedDistanceFromStartMetres: 40,
      ...SESSION_EXTRAS,
    });
  });

  it("opening the same route from its Routes card, with no instruction, starts no watch and offers Resume ride", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);

    await user.click(screen.getByRole("button", { name: "Route A" }));
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    await expectWatchCountToStay(watchPositionSpy, 0);
  });

  it("a failed Pause after a launcher Resume keeps tracking, shows its retryable error and leaves the watch running", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy, clearWatchSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    await resumeFromLauncher(user);

    const setSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockRejectedValue(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ride could not be paused on this device. Try again.",
    );
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled();
    expect(clearWatchSpy).not.toHaveBeenCalled();
    expect(watchPositionSpy).toHaveBeenCalledOnce();
    setSpy.mockRestore();
  });

  it("a still-pending instruction survives leaving Riding, is honoured once on return, and a later Pause and round trip stay paused", async () => {
    const user = userEvent.setup();
    const { watchPositionSpy, clearWatchSpy } = stubGeolocation();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const importedRoute = await seedPausedRoute(user);

    // Holds the screen's restoration read: once armed, the guard's own
    // check is the first read and restoration the second.
    const realRead = rideStateRepository.getActiveRideState;
    let armed = false;
    let readsSinceArmed = 0;
    let resolveHeld!: (value: Awaited<ReturnType<typeof realRead>>) => void;
    const held = new Promise<Awaited<ReturnType<typeof realRead>>>((resolve) => {
      resolveHeld = resolve;
    });
    vi.spyOn(rideStateRepository, "getActiveRideState").mockImplementation(() => {
      if (armed) {
        readsSinceArmed += 1;
        if (readsSinceArmed === 2) return held;
      }
      return realRead();
    });

    // The launcher is behind the paused screen (backlog item 132); the
    // count is armed only once its summary shows, so the reads before it —
    // the launcher's, the paused screen's restoration, the launcher's
    // again — never count.
    const launcher = await openLauncherFromPausedScreen(user);
    const resume = await within(launcher).findByRole("button", { name: "Resume ride" });
    armed = true;
    await user.click(resume);

    // Proof the held read is the restoration one: the screen is pending.
    expect(await screen.findByText("Resuming your ride…")).toBeInTheDocument();
    expect(readsSinceArmed).toBe(2);
    expect(watchPositionSpy).not.toHaveBeenCalled();

    // Leave while it is pending, and let the held read finish while away.
    await user.click(screen.getByRole("button", { name: "Routes" }));
    await screen.findByRole("heading", { name: "Routes" });
    resolveHeld(await realRead());
    await expectWatchCountToStay(watchPositionSpy, 0);

    // Returning honours the still-pending instruction, exactly once.
    await user.click(screen.getByRole("button", { name: "Ride" }));
    await screen.findByRole("button", { name: "Pause" });
    await expectWatchCountToStay(watchPositionSpy, 1);

    // Handled now: Pause and a round trip stay paused.
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(clearWatchSpy).toHaveBeenCalledOnce();
    await user.click(await screen.findByRole("button", { name: "Routes" }));
    await user.click(screen.getByRole("button", { name: "Ride" }));
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    await expectWatchCountToStay(watchPositionSpy, 1);
    expect(await realRead()).toMatchObject({ routeId: importedRoute.id });
  });
});

// Covers the remainder of backlog item 73's required transition matrix not
// already exercised above: same-route/free-roam recovery and the
// free-roam-blocks-route/check-failed directions are covered by the
// "App — Ride launcher session recovery" and "App — Free roam" describe
// blocks above (some of those existing tests were themselves rewritten for
// the new dialog-based lifecycle). handleOpenRoute and
// handleOpenSavedRoute both route through requestRouteTransition(route, {
// stampResumeIntent: false }) (see App.tsx), differing only in the
// prompt's origin — since item 124's slice 3, Planning's Open saved route,
// not Save itself, reaches the guard. Its own placement, anchor and busy
// handling are covered by App.planningSavedRoute.test.tsx (with Planning
// stubbed) and by real-browser scenarios in
// e2e/rideSessionSwitchGuard.spec.ts and
// e2e/planningSavedRoute.smoke.spec.ts; PlanningScreen cannot be mounted in
// this jsdom suite without a mock map factory that App.tsx does not
// currently thread through to it (confirmed empirically — a real,
// unmocked MapView throws in jsdom on unmount), so this file does not
// attempt to force that specific entry point through the full Planning UI.
describe("App — Ride switch guard (item 73)", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubGeolocationWatch() {
    const watchPositionSpy = vi.fn();
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    return watchPositionSpy;
  }

  // A current-format row, with the identity every session has had since
  // item 140, so a launcher read in these tests changes nothing stored;
  // rows without one are covered in RidingLauncher.test.tsx.
  async function seedRouteRow(routeId: string) {
    await setActiveRideState({
      id: "active",
      routeId,
      startedAt: "2026-01-01T08:00:00.000Z",
      sessionId: "session-seeded",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });
    return getActiveRideState();
  }

  it("no stored session — opening a route proceeds immediately, with no dialog and no clear", async () => {
    const user = userEvent.setup();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));

    expect(await screen.findByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("route A unfinished + route B opened: confirmation inside B's own card before any replacement, names A and offers Return, Cancel leaves A's exact row and screen untouched, confirming clears once then opens B idle with no watch until Start riding", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    const routeARow = await seedRouteRow(routeA.id);

    const routeBButton = screen.getByRole("button", { name: "Route B" });
    await user.click(routeBButton);

    expect(screen.queryByRole("heading", { name: "Route B" })).toBeNull();
    // Item 73 follow-up: the prompt is a descendant of B's own card, not a
    // page-level dialog, and names the paused route directly.
    const routeBCard = getListItemByRouteId(routeB.id);
    const dialog = await within(routeBCard).findByRole("dialog");
    expect(
      within(dialog).getByText(
        '"Route A" is paused. Return to it, or end it and switch to "Route B". Ending it will clear ride progress; the saved route will remain in Routes.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
    expect(await getActiveRideState()).toEqual(routeARow);
    expect(watchPositionSpy).not.toHaveBeenCalled();

    // Cancel preserves everything exactly and restores focus.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await getActiveRideState()).toEqual(routeARow);
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
    expect(routeBButton).toHaveFocus();
    expect(clearSpy).not.toHaveBeenCalled();

    // Confirming clears exactly once, then opens B idle with no watch.
    await user.click(routeBButton);
    const confirmDialog = await within(routeBCard).findByRole("dialog");
    await user.click(
      within(confirmDialog).getByRole("button", { name: "End and switch" }),
    );

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(await screen.findByRole("heading", { name: "Route B" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
    expect(watchPositionSpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it("End and switch's busy 'clearing' state does not trigger a second card scroll while clearActiveRideState is still pending (item 95 follow-up)", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await seedRouteRow(routeA.id);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const scrollIntoViewMock = Element.prototype.scrollIntoView as ReturnType<
      typeof vi.fn
    >;
    stubOffscreenCardGeometry();

    await user.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    // Opening the prompt is itself an actionable, non-busy state that
    // must genuinely have scrolled the (deliberately off-screen) card
    // into view — the baseline this test's later assertion compares
    // against.
    expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(0);
    const scrollCallsAtOpen = scrollIntoViewMock.mock.calls.length;

    let resolveClear: (() => void) | undefined;
    vi.spyOn(rideStateRepository, "clearActiveRideState").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveClear = () => {
            resolve(undefined);
          };
        }),
    );

    await user.click(within(dialog).getByRole("button", { name: "End and switch" }));

    // Now busy ("clearing", "Ending your current ride…") while the write
    // is held open — the same busy-gate that protects Return to paused
    // ride's own "returning" status must protect this shared status too,
    // since both go through RouteListItem's one scroll effect.
    expect(within(dialog).getByText(/ending your current ride/i)).toBeInTheDocument();
    expect(scrollIntoViewMock.mock.calls.length).toBe(scrollCallsAtOpen);

    resolveClear?.();

    expect(await screen.findByRole("heading", { name: "Route B" })).toBeInTheDocument();
  });

  it("a stale launcher render exposing Start free roam is still guarded when a route session became active after hydration — clear happens before the fresh free-roam row is written and before the watch starts", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
    const writeSpy = vi.spyOn(rideStateRepository, "setActiveRideState");
    const readSpy = vi.spyOn(rideStateRepository, "getActiveRideState");
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");

    // Reach the launcher's genuinely empty "none" state first (hydration
    // resolves before any session exists).
    await user.click(screen.getByRole("button", { name: "Ride" }));
    const startFreeRoamButton = await screen.findByRole("button", {
      name: "Start free roam",
    });

    // Simulate storage changing after the launcher's own hydration already
    // resolved to "none" — the launcher's in-memory sessionState is now
    // stale, but nothing has re-rendered it.
    const readCallsBeforeClick = readSpy.mock.calls.length;
    const routeRow = await seedRouteRow(importedRoute.id);

    await user.click(startFreeRoamButton);

    // The guard re-reads storage at click time rather than trusting the
    // stale render — it must not silently overwrite the route row.
    expect(readSpy.mock.calls.length).toBeGreaterThan(readCallsBeforeClick);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/unfinished ride on another route/i),
    ).toBeInTheDocument();
    expect(await getActiveRideState()).toEqual(routeRow);

    await user.click(within(dialog).getByRole("button", { name: "End and switch" }));

    await waitFor(() => {
      expect(watchPositionSpy).toHaveBeenCalledOnce();
    });
    expect(clearSpy).toHaveBeenCalledOnce();
    // Clear happened before the fresh free-roam write, which happened
    // before the watch started.
    const clearOrder = clearSpy.mock.invocationCallOrder[0] ?? Infinity;
    const writeOrder = writeSpy.mock.invocationCallOrder.find(
      (order) => order > clearOrder,
    );
    const watchOrder = watchPositionSpy.mock.invocationCallOrder[0] ?? -Infinity;
    if (writeOrder === undefined) throw new Error("expected a write order");
    expect(writeOrder).toBeLessThan(watchOrder);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Free roam" }),
    ).toBeInTheDocument();
  });

  it("a rejected clear preserves the exact original row and target; a retry succeeds without a duplicate transition", async () => {
    const user = userEvent.setup();
    stubGeolocationWatch();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    const routeARow = await seedRouteRow(routeA.id);

    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));
    const getRouteSpy = vi.spyOn(routesRepository, "getRoute");
    const routeBRecordBefore = await db.routes.get(routeB.id);

    const routeBCard = getListItemByRouteId(routeB.id);
    await user.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(routeBCard).findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End and switch" }));

    expect(
      await screen.findByText(
        "This unfinished ride could not be ended on this device. Try again.",
      ),
    ).toBeInTheDocument();
    expect(await getActiveRideState()).toEqual(routeARow);
    expect(screen.queryByRole("heading", { name: "Route B" })).toBeNull();
    const getRouteCallsAfterFailure = getRouteSpy.mock.calls.length;

    // clearActiveRideState's mockRejectedValueOnce is now exhausted — the
    // retry click falls through to the real implementation without needing
    // to restore/re-spy, so call-count tracking on the same spy stays
    // valid throughout.
    await user.click(screen.getByRole("button", { name: "End and switch" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(await screen.findByRole("heading", { name: "Route B" })).toBeInTheDocument();
    // Exactly two clear attempts total (the rejected one, then the retry) —
    // never a duplicate successful clear/transition.
    expect(clearSpy).toHaveBeenCalledTimes(2);
    // The retry's own getRoute() call count is unchanged from right after
    // the failure — it does not repeat the conflict's own route-resolution
    // step (resolveExistingRouteForConflict). This does not, on its own,
    // prove checkRideTransition itself was never re-run: that function
    // reads ride state via getActiveRideState(), not routes.
    expect(getRouteSpy.mock.calls.length).toBe(getRouteCallsAfterFailure);
    expect(await db.routes.get(routeB.id)).toEqual(routeBRecordBefore);
  });

  it("a failed new free-roam write after a successful old-session clear starts no watch and reports an honest retryable state, without fabricating the old session's return", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");

    await user.click(screen.getByRole("button", { name: "Ride" }));
    const startFreeRoamButton = await screen.findByRole("button", {
      name: "Start free roam",
    });
    // Storage changes after hydration (as in the stale-launcher test
    // above) so the guard has a route conflict to resolve.
    await seedRouteRow(importedRoute.id);

    const writeSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    await user.click(startFreeRoamButton);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End and switch" }));

    expect(
      await screen.findByText(/free roam could not be started on this device/i),
    ).toBeInTheDocument();
    expect(watchPositionSpy).not.toHaveBeenCalled();
    // The old route session was genuinely ended — not fabricated back —
    // and the write failure left nothing else in its place.
    expect(await getActiveRideState()).toBeUndefined();

    // mockRejectedValueOnce's one-shot rejection is now exhausted — the
    // retry falls through to the real implementation, so leave the spy
    // attached (not .mockRestore()'d) to keep its call count meaningful.
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(watchPositionSpy).toHaveBeenCalledOnce();
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Free roam" }),
    ).toBeInTheDocument();
    // Exactly one original clear across the whole failure+retry sequence —
    // Try again retries only the write step, never a second clear.
    expect(clearSpy).toHaveBeenCalledOnce();
    // Exactly two write attempts: the failed one, then the successful retry.
    expect(writeSpy).toHaveBeenCalledTimes(2);
    const [clearOrder] = clearSpy.mock.invocationCallOrder;
    if (clearOrder === undefined) throw new Error("expected one clear call");
    expect(writeSpy.mock.invocationCallOrder.every((order) => order > clearOrder)).toBe(
      true,
    );
    // GPS starts only after the successful replacement row's own write
    // resolves, not merely after some write attempt happens.
    const [, successfulWriteOrder] = writeSpy.mock.invocationCallOrder;
    const [watchOrder] = watchPositionSpy.mock.invocationCallOrder;
    if (successfulWriteOrder === undefined) throw new Error("expected two write calls");
    if (watchOrder === undefined) throw new Error("expected the watch to have started");
    expect(successfulWriteOrder).toBeLessThan(watchOrder);
    // The replacement row itself, read directly, is a genuine free-roam
    // row, not a stale leftover.
    const finalRows = await db.rideState.toArray();
    expect(finalRows).toHaveLength(1);
    expect(finalRows[0]).toMatchObject({ kind: "free-roam" });
  });

  it("an interrupted new free-roam write (never resolves) leaves the real rideState table genuinely empty — not partially written — while the dialog stays in its own busy state", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    const [importedRoute] = await db.routes.toArray();
    if (!importedRoute) throw new Error("expected an imported route");

    await user.click(screen.getByRole("button", { name: "Ride" }));
    const startFreeRoamButton = await screen.findByRole("button", {
      name: "Start free roam",
    });
    // Storage changes after hydration (as in the stale-launcher test above)
    // so the guard has a route conflict to resolve.
    await seedRouteRow(importedRoute.id);

    // The replacement write never settles — neither resolves nor rejects —
    // simulating an interrupted/crashed second step of the two-step
    // clear-then-create sequence. A plain never-resolving promise schedules
    // no timer/handle and never rejects, so this needs no fake timers and
    // leaves nothing for Vitest/jsdom to clean up at teardown.
    const writeSpy = vi
      .spyOn(rideStateRepository, "setActiveRideState")
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- deliberately never settles
      .mockImplementationOnce(() => new Promise(() => {}));

    await user.click(startFreeRoamButton);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End and switch" }));

    expect(await screen.findByText("Starting free roam…")).toBeInTheDocument();
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledOnce();
    // The real table, read directly (not a mock-call count), is genuinely
    // empty — the clear succeeded and the stuck write never landed a row.
    expect(await db.rideState.toArray()).toEqual([]);
    expect(await getActiveRideState()).toBeUndefined();
    expect(watchPositionSpy).not.toHaveBeenCalled();
    // The dialog reflects this stuck-but-safe state honestly — both
    // actions stay disabled, never silently re-enabled as though nothing
    // were wrong.
    expect(within(dialog).getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("rapid double clicks on two different routes never clear twice or open the older, superseded target", async () => {
    const user = userEvent.setup();
    stubGeolocationWatch();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    await importFixture(user, "Route C.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    const routeC = routes.find((route) => route.name === "Route C");
    if (!routeA || !routeB || !routeC) throw new Error("expected Route A, B and C");
    const routeARow = await seedRouteRow(routeA.id);

    let resolveFirstRead:
      ((value: Awaited<ReturnType<typeof getActiveRideState>>) => void) | undefined;
    // Overrides only the FIRST call (Route B's own check) to hang; Route
    // C's later check falls through to the real implementation and reads
    // current storage directly.
    vi.spyOn(rideStateRepository, "getActiveRideState").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstRead = resolve;
        }),
    );

    // Click Route B first (its check is held open), then Route C before B's
    // check has resolved at all.
    await user.click(screen.getByRole("button", { name: "Route B" }));
    await user.click(screen.getByRole("button", { name: "Route C" }));

    // Now let B's stale check resolve, deliberately last, with what a real
    // read would have returned at the time it was issued.
    resolveFirstRead?.(routeARow);

    // Only C's own (newer) outcome may ever be applied — inside C's own
    // card, never B's (a stale result must never reopen an older card).
    const dialog = await within(getListItemByRouteId(routeC.id)).findByRole("dialog");
    expect(within(dialog).getByText(/Switch to "Route C"/)).toBeInTheDocument();
    expect(within(getListItemByRouteId(routeB.id)).queryByRole("dialog")).toBeNull();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Route B" })).toBeNull();
  });

  it("a delayed getRoute() resolving a conflict's paused-route name cannot clobber a newer, different pending switch", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    await importFixture(user, "Route C.gpx");
    // The real production accessor, not the raw db.routes.toArray() read
    // used elsewhere in this file for plain id/name lookups: routeA below
    // stands in for a real getRoute() resolution, so it must carry the
    // same canonical LibraryRoute shape a genuine call would return.
    const routes = await routesRepository.listRoutes();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    const routeC = routes.find((route) => route.name === "Route C");
    if (!routeA || !routeB || !routeC) throw new Error("expected Route A, B and C");
    await seedRouteRow(routeA.id);

    let resolveFirstGetRoute:
      | ((value: Awaited<ReturnType<typeof routesRepository.getRoute>>) => void)
      | undefined;
    // Overrides only the FIRST call (Route B's own existingRoute
    // resolution, for its inline card's name/Return action) to hang;
    // Route C's later resolution falls through to the real implementation.
    vi.spyOn(routesRepository, "getRoute").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstGetRoute = resolve;
        }),
    );

    // Route B's own storage read/classification completes (real, fast) and
    // reaches "conflict", but its getRoute(A.id) call is held open — so no
    // dialog has appeared for B at all yet.
    await user.click(screen.getByRole("button", { name: "Route B" }));
    // A newer request (Route C) supersedes it before B's getRoute() has
    // resolved at all.
    await user.click(screen.getByRole("button", { name: "Route C" }));

    // Now let B's stale getRoute() resolve, deliberately last, with what a
    // real lookup would have returned.
    resolveFirstGetRoute?.(routeA);

    const dialog = await within(getListItemByRouteId(routeC.id)).findByRole("dialog");
    expect(within(dialog).getByText('Switch to "Route C"?')).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    ).toBeInTheDocument();
    expect(within(getListItemByRouteId(routeB.id)).queryByRole("dialog")).toBeNull();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Route B" })).toBeNull();
  });

  it("a failed conflict check, retried after a different route becomes paused in the meantime, resolves into a genuine conflict — not a stale 'proceed'", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");

    vi.spyOn(rideStateRepository, "getActiveRideState").mockRejectedValueOnce(
      new Error("boom"),
    );

    await user.click(screen.getByRole("button", { name: "Route A" }));
    const dialog = await within(getListItemByRouteId(routeA.id)).findByRole("dialog");
    expect(
      within(dialog).getByText("Couldn't check for an unfinished ride"),
    ).toBeInTheDocument();

    // Route B becomes paused between the failed check and the retry — the
    // retry must classify this as a genuine conflict, not the "proceed" a
    // plain re-check-against-empty-storage would have produced.
    const routeBRow = await seedRouteRow(routeB.id);

    await user.click(within(dialog).getByRole("button", { name: "Retry" }));

    const conflictDialog = await within(getListItemByRouteId(routeA.id)).findByRole(
      "dialog",
    );
    expect(within(conflictDialog).getByText('Switch to "Route A"?')).toBeInTheDocument();
    expect(
      within(conflictDialog).getByText(
        '"Route B" is paused. Return to it, or end it and switch to "Route A". Ending it will clear ride progress; the saved route will remain in Routes.',
      ),
    ).toBeInTheDocument();
    expect(
      within(conflictDialog).getByRole("button", { name: "End and switch" }),
    ).toBeInTheDocument();
    expect(
      within(conflictDialog).getByRole("button", { name: "Return to paused ride" }),
    ).toBeInTheDocument();
    expect(await getActiveRideState()).toEqual(routeBRow);

    await user.click(within(conflictDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await getActiveRideState()).toEqual(routeBRow);
  });

  it("retrying a failed free-roam conflict check performs a fresh no-session classification, persists the free-roam row, and only then opens Free roam and starts GPS", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    render(<App mapFactory={buildNoopMapFactory()} />);

    // No stored session at all — reach the launcher's empty "none" state.
    await user.click(screen.getByRole("button", { name: "Ride" }));
    const startFreeRoamButton = await screen.findByRole("button", {
      name: "Start free roam",
    });

    vi.spyOn(rideStateRepository, "getActiveRideState").mockRejectedValueOnce(
      new Error("boom"),
    );

    await user.click(startFreeRoamButton);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Couldn't check for an unfinished ride"),
    ).toBeInTheDocument();
    expect(await db.rideState.toArray()).toEqual([]);

    const writeSpy = vi.spyOn(rideStateRepository, "setActiveRideState");

    // The one-shot rejection is exhausted — the retry re-runs the real
    // classification against genuinely empty storage, resolving to a fresh
    // "proceed" rather than reusing anything from the failed attempt.
    await user.click(within(dialog).getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(watchPositionSpy).toHaveBeenCalledOnce();
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Free roam" }),
    ).toBeInTheDocument();
    expect(writeSpy).toHaveBeenCalledOnce();
    const [writeOrder] = writeSpy.mock.invocationCallOrder;
    const [watchOrder] = watchPositionSpy.mock.invocationCallOrder;
    if (writeOrder === undefined)
      throw new Error("expected the write to have been called");
    if (watchOrder === undefined) throw new Error("expected the watch to have started");
    expect(writeOrder).toBeLessThan(watchOrder);
    const rows = await db.rideState.toArray();
    expect(rows).toHaveLength(1);
    // The new session's own identity (backlog item 140) is written with it.
    expect(rows[0]).toMatchObject({ kind: "free-roam" });
    expect(typeof rows[0]?.sessionId).toBe("string");
  });

  it("an unsupported/corrupt stored session fails closed as a conflict requiring discard, and Cancel preserves the row exactly", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await setActiveRideState({
      id: "active",
      routeId: routeA.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: null,
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      kind: "totally-unknown-future-kind",
    });
    const unsupportedRow = await getActiveRideState();

    await user.click(screen.getByRole("button", { name: "Route B" }));

    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    expect(
      within(dialog).getByText(/can't be recovered by this version of the app/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Discard and continue" }),
    ).toBeInTheDocument();
    // "Unsupported" is never a resolvable route — no Return offered.
    expect(
      within(dialog).queryByRole("button", { name: "Return to paused ride" }),
    ).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await getActiveRideState()).toEqual(unsupportedRow);
    expect(screen.queryByRole("heading", { name: "Route B" })).toBeNull();
  });

  it("shows only Cancel and End and switch — with the existing generic wording — when the paused route can't be resolved before the conflict is even detected", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await seedRouteRow(routeA.id);
    // Route A is deleted from the library entirely before the conflict is
    // ever checked — its stored session row still exists, but there is no
    // PlannedRoute left to resolve or return to.
    await db.routes.delete(routeA.id);

    await user.click(screen.getByRole("button", { name: "Route B" }));

    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    expect(
      within(dialog).getByText(/unfinished ride on another route/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Return to paused ride" }),
    ).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "End and switch" }),
    ).toBeInTheDocument();
  });

  it("Return to paused ride reopens the paused route in its idle 'Resume ride' state, without clearing storage, stamping a resume token, or starting geolocation", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    const routeARow = await seedRouteRow(routeA.id);
    if (!routeARow) throw new Error("expected a seeded route row");

    await user.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    );

    expect(await screen.findByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    // RidingScreen's own restoration independently enriches the row with
    // camera/view defaults on mount — unrelated to Return's own no-clear
    // guarantee, so this checks the original progress fields are still
    // intact (toMatchObject), not a strict snapshot equality.
    expect(await getActiveRideState()).toMatchObject(routeARow);
    expect(clearSpy).not.toHaveBeenCalled();
    expect(watchPositionSpy).not.toHaveBeenCalled();
  });

  it("Return to paused ride resets the document scroll to the top exactly once — with no second card scroll during the busy 'returning' window — and preserves the Library's own saved offset for later restoration (item 95 follow-up)", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    const routeARow = await seedRouteRow(routeA.id);
    if (!routeARow) throw new Error("expected a seeded route row");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const scrollIntoViewMock = Element.prototype.scrollIntoView as ReturnType<
      typeof vi.fn
    >;
    const scrollToSpy = installScrollToSpy();
    stubOffscreenCardGeometry();

    window.scrollY = 4000; // simulates a meaningful scrolled Library position
    await user.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    // Opening the prompt is itself an actionable, non-busy state that
    // must genuinely have scrolled the (deliberately off-screen) card
    // into view — the baseline this test's later assertion compares
    // against.
    expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(0);
    const scrollCallsAtOpen = scrollIntoViewMock.mock.calls.length;

    let resolveActiveRideStateRead:
      ((value: Awaited<ReturnType<typeof getActiveRideState>>) => void) | undefined;
    vi.spyOn(rideStateRepository, "getActiveRideState").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveActiveRideStateRead = resolve;
        }),
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    );

    // Now busy ("returning", "Opening your paused ride…") while the read
    // is held open — must not have triggered a further card scroll (item
    // 95 follow-up), and the reset must not have fired yet either, since
    // the screen has not actually transitioned to Riding.
    expect(within(dialog).getByText(/opening your paused ride/i)).toBeInTheDocument();
    expect(scrollIntoViewMock.mock.calls.length).toBe(scrollCallsAtOpen);
    expect(scrollToSpy).not.toHaveBeenCalled();

    resolveActiveRideStateRead?.(routeARow);

    expect(await screen.findByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(watchPositionSpy).not.toHaveBeenCalled();

    // The scroll-reset fires exactly once, at the correct transition —
    // the new Ride content actually committing, not any earlier status
    // change.
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenNthCalledWith(1, { top: 0, left: 0, behavior: "auto" });

    // The Library's own saved scroll position — captured from the moment
    // Return actually succeeded, per openRideTarget's existing contract —
    // must still be available and restored the next time Routes is
    // shown, not discarded by this fix.
    await user.click(screen.getByRole("button", { name: "Routes" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Route B" })).toBeInTheDocument();
    });
    expect(scrollToSpy).toHaveBeenCalledTimes(2);
    expect(scrollToSpy).toHaveBeenNthCalledWith(2, {
      top: 4000,
      left: 0,
      behavior: "auto",
    });
  });

  it("Return to paused ride resolves the paused route via the routes repository after a cold remount, with no in-memory route object available", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = stubGeolocationWatch();
    const { unmount } = render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    const routeARow = await seedRouteRow(routeA.id);
    if (!routeARow) throw new Error("expected a seeded route row");

    // A cold remount — App has no in-memory pointer to Route A at all; the
    // guard has never even seen it this session.
    unmount();
    cleanup();
    const user2 = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await screen.findByRole("button", { name: "Route B" });

    await user2.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    await user2.click(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    );

    expect(await screen.findByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Resume ride" }),
    ).toBeInTheDocument();
    expect(await getActiveRideState()).toMatchObject(routeARow);
    expect(watchPositionSpy).not.toHaveBeenCalled();
  });

  it("Return to paused ride re-validates storage at click time — if the row changed since the prompt opened, it fails safely to Check again rather than trusting the stale snapshot", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await seedRouteRow(routeA.id);

    await user.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");

    // The stored session changes after the prompt opened but before Return
    // is pressed — the row is gone entirely.
    await rideStateRepository.clearActiveRideState();

    await user.click(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    );

    expect(
      await within(dialog).findByText(
        /this paused ride has changed since this screen opened/i,
      ),
    ).toBeInTheDocument();
    const checkAgainButton = within(dialog).getByRole("button", { name: "Check again" });
    expect(checkAgainButton).toHaveClass("btn-secondary");
    expect(checkAgainButton).not.toHaveClass("btn-danger");
    expect(within(dialog).queryByRole("button", { name: "End and switch" })).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Return to paused ride" }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Route A" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Route B" })).toBeNull();
  });

  it("Return to paused ride re-validates the target route at click time — if it was deleted since the prompt opened, it fails safely and Cancel remains usable", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await seedRouteRow(routeA.id);

    await user.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");

    // Route A's saved route is deleted after the prompt opened but before
    // Return is pressed — the stored session row still matches by id, but
    // there is no route left to open.
    await db.routes.delete(routeA.id);

    await user.click(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    );

    expect(
      await within(dialog).findByText(/no longer in your library/i),
    ).toBeInTheDocument();

    // Cancel remains usable and preserves the (still-present) session row.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
  });

  it("returnToPausedRide's own status check failing outright (a genuine rejection) fails safely to Check again, preserves the row, and Check again genuinely re-runs the guard", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    const routeARow = await seedRouteRow(routeA.id);

    await user.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    // Only the Return click's own status-check read fails — not the
    // conflict check that already opened this dialog and resolved
    // existingRoute for it.
    vi.spyOn(rideStateRepository, "getActiveRideState").mockRejectedValueOnce(
      new Error("boom"),
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    );

    expect(
      await within(dialog).findByText(
        "This paused ride's status could not be checked. Try again.",
      ),
    ).toBeInTheDocument();
    const checkAgainButton = within(dialog).getByRole("button", { name: "Check again" });
    expect(checkAgainButton).toHaveClass("btn-secondary");
    expect(checkAgainButton).not.toHaveClass("btn-danger");
    expect(
      within(dialog).queryByRole("button", { name: "Return to paused ride" }),
    ).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "End and switch" })).toBeNull();
    expect(await getActiveRideState()).toEqual(routeARow);

    // Genuinely re-runs retryPendingSwitchCheck end-to-end — unlike the
    // existing stillMatches-false test above, which only asserts this
    // button's presence/styling and never clicks it.
    await user.click(checkAgainButton);

    const conflictDialog = await within(getListItemByRouteId(routeB.id)).findByRole(
      "dialog",
    );
    expect(within(conflictDialog).getByText('Switch to "Route B"?')).toBeInTheDocument();
    expect(
      within(conflictDialog).getByRole("button", { name: "Return to paused ride" }),
    ).toBeInTheDocument();
    expect(
      within(conflictDialog).getByRole("button", { name: "End and switch" }),
    ).toBeInTheDocument();
    expect(await getActiveRideState()).toEqual(routeARow);
  });

  it("returnToPausedRide's own paused-route lookup failing outright (a genuine rejection) fails safely to Check again and preserves the row exactly", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    const routeARow = await seedRouteRow(routeA.id);

    await user.click(screen.getByRole("button", { name: "Route B" }));
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    // Only the Return click's own route lookup fails — not the conflict
    // check's own earlier getRoute() call, which already resolved
    // successfully to power this dialog's "Route A is paused..." copy.
    vi.spyOn(routesRepository, "getRoute").mockRejectedValueOnce(new Error("boom"));

    await user.click(
      within(dialog).getByRole("button", { name: "Return to paused ride" }),
    );

    expect(
      await within(dialog).findByText(
        "This paused ride's route could not be checked. Try again.",
      ),
    ).toBeInTheDocument();
    const checkAgainButton = within(dialog).getByRole("button", { name: "Check again" });
    expect(checkAgainButton).toHaveClass("btn-secondary");
    expect(checkAgainButton).not.toHaveClass("btn-danger");
    expect(
      within(dialog).queryByRole("button", { name: "Return to paused ride" }),
    ).toBeNull();
    expect(await getActiveRideState()).toEqual(routeARow);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
  });

  it("Cancel and Escape restore focus via the single existing trigger-based mechanism — no separate focus call races it", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await seedRouteRow(routeA.id);

    const routeBButton = screen.getByRole("button", { name: "Route B" });
    await user.click(routeBButton);
    const dialog = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(routeBButton).toHaveFocus();

    await user.click(routeBButton);
    const dialog2 = await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(routeBButton).toHaveFocus();
    expect(dialog2).not.toBeInTheDocument();
  });

  it("A-card/B-card: a switch prompt appearing on B cancels A's own open delete confirmation — only one dialog exists throughout", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");

    await user.click(
      within(getListItemByRouteId(routeA.id)).getByRole("button", { name: "Delete" }),
    );
    expect(
      within(getListItemByRouteId(routeA.id)).getByRole("dialog"),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);

    // Route A itself is the one paused, and selecting B is what produces
    // the conflict — the field defect's own A-card/B-card scenario.
    await seedRouteRow(routeA.id);
    await user.click(screen.getByRole("button", { name: "Route B" }));

    await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    expect(within(getListItemByRouteId(routeA.id)).queryByRole("dialog")).toBeNull();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
  });

  it("the reverse: requesting delete on A while B's switch prompt is open cancels B's switch prompt first, then opens A's own delete confirmation — only one dialog exists throughout", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await seedRouteRow(routeA.id);

    await user.click(screen.getByRole("button", { name: "Route B" }));
    await within(getListItemByRouteId(routeB.id)).findByRole("dialog");
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);

    await user.click(
      within(getListItemByRouteId(routeA.id)).getByRole("button", { name: "Delete" }),
    );

    expect(within(getListItemByRouteId(routeB.id)).queryByRole("dialog")).toBeNull();
    expect(
      within(getListItemByRouteId(routeA.id)).getByText("Delete “Route A”?"),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
  });

  it("handleSwitchTargetMissing: an inline switch prompt cancels safely (no dialog anywhere) when its target route is filtered out of search, and does not reappear merely because the route becomes visible again", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    const routeARow = await seedRouteRow(routeA.id);

    await user.click(screen.getByRole("button", { name: "Route B" }));
    await within(getListItemByRouteId(routeB.id)).findByRole("dialog");

    // Route B itself is filtered out of the current search results — its
    // card, and the prompt inside it, are no longer renderable at all.
    await user.type(screen.getByLabelText("Search routes"), "Route A");
    await waitFor(() => {
      expect(document.querySelector(`[data-route-id="${routeB.id}"]`)).toBeNull();
    });
    // Not conclusive on its own — a filtered-out card has no dialog either
    // way, whether or not handleSwitchTargetMissing actually ran. The
    // re-appearance check below is the load-bearing proof.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await getActiveRideState()).toEqual(routeARow);

    // Clearing the search makes Route B's card renderable again. If
    // handleSwitchTargetMissing had NOT nulled pendingRideSwitch (a bug),
    // this is exactly where a stale prompt would silently reappear.
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    const routeBButton = await screen.findByRole("button", { name: "Route B" });
    expect(screen.queryByRole("dialog")).toBeNull();

    // The coordinator isn't wedged — a fresh, unrelated request against the
    // same target still works normally afterwards.
    await user.click(routeBButton);
    const freshDialog = await within(getListItemByRouteId(routeB.id)).findByRole(
      "dialog",
    );
    expect(within(freshDialog).getByText('Switch to "Route B"?')).toBeInTheDocument();
    expect(await getActiveRideState()).toEqual(routeARow);
  });

  it("navigating away from Routes while a route-card prompt is pending falls back to the page-level dialog rather than leaving it invisible", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);

    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    await seedRouteRow(routeA.id);

    await user.click(screen.getByRole("button", { name: "Route B" }));
    await within(getListItemByRouteId(routeB.id)).findByRole("dialog");

    // The sticky nav stays clickable throughout — this prompt is
    // deliberately not a true modal.
    await user.click(navButton("Settings"));

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    // The generic wording, never the named-route inline copy — this is
    // the page-level ConfirmDialog, not the inline card presentation.
    expect(
      within(dialog).getByText(/unfinished ride on another route/i),
    ).toBeInTheDocument();
  });

  // Backlog item 119. Confirmations are queried role-agnostically here
  // (dialog or dialog) so these tests describe the defect itself —
  // duplicate title ids, one dialog announced as another, an asserted
  // modality nothing enforces, a switch prompt outliving the ride choice
  // that superseded it — rather than one particular role.
  describe("item 119: confirmation naming and a pending switch that yields", () => {
    beforeEach(async () => {
      await db.providerKeys.clear();
    });

    function openConfirmations(): HTMLElement[] {
      return [
        ...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]'),
      ];
    }

    function confirmationNamed(name: string | RegExp): HTMLElement {
      const match = openConfirmations().find((element) =>
        typeof name === "string"
          ? element.querySelector("h2,h3,h4")?.textContent === name
          : name.test(element.querySelector("h2,h3,h4")?.textContent ?? ""),
      );
      if (!match) throw new Error(`no open confirmation titled ${String(name)}`);
      return match;
    }

    function expectIdReferencesIntact(): void {
      const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
      for (const confirmation of openConfirmations()) {
        for (const attribute of ["aria-labelledby", "aria-describedby"]) {
          const references = (confirmation.getAttribute(attribute) ?? "")
            .split(" ")
            .filter(Boolean);
          expect(references.length, attribute).toBeGreaterThan(0);
          for (const id of references) {
            expect(
              document.querySelectorAll(`[id="${id}"]`),
              `${attribute} ${id}`,
            ).toHaveLength(1);
            expect(confirmation.contains(document.getElementById(id))).toBe(true);
          }
        }
      }
    }

    function deferred() {
      let release: () => void = () => undefined;
      let fail: (error: Error) => void = () => undefined;
      const promise = new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      return { promise, release, fail };
    }

    async function armSwitchFromRouteCard(user: ReturnType<typeof userEvent.setup>) {
      await importFixture(user, "Route A.gpx");
      await importFixture(user, "Route B.gpx");
      const routes = await db.routes.toArray();
      const routeA = routes.find((route) => route.name === "Route A");
      const routeB = routes.find((route) => route.name === "Route B");
      if (!routeA || !routeB) throw new Error("expected Route A and Route B");
      const seededRow = await seedRouteRow(routeA.id);
      await user.click(screen.getByRole("button", { name: "Route B" }));
      await waitFor(() => {
        expect(
          getListItemByRouteId(routeB.id).querySelector(
            '[role="dialog"],[role="alertdialog"]',
          ),
        ).not.toBeNull();
      });
      return { routeA, routeB, seededRow };
    }

    it("the switch prompt's page-level fallback and Settings' Delete key confirmation each carry their own name and description, with unique ids and no asserted modality", async () => {
      const user = userEvent.setup();
      await saveProviderKey("dummy-key");
      render(<App mapFactory={buildNoopMapFactory()} />);
      await armSwitchFromRouteCard(user);

      await user.click(navButton("Settings"));
      await user.click(await screen.findByRole("button", { name: "Delete key" }));

      expect(openConfirmations()).toHaveLength(2);
      const switchPrompt = confirmationNamed('Switch to "Route B"?');
      const deleteKey = confirmationNamed("Delete OpenRouteService key");
      expect(switchPrompt).toHaveAccessibleName('Switch to "Route B"?');
      expect(deleteKey).toHaveAccessibleName("Delete OpenRouteService key");
      expect(switchPrompt).toHaveAccessibleDescription(
        /unfinished ride on another route/i,
      );
      expect(deleteKey).toHaveAccessibleDescription(
        /removes your saved key from this device/i,
      );
      for (const confirmation of openConfirmations()) {
        expect(confirmation).toHaveAttribute("role", "dialog");
        expect(confirmation).not.toHaveAttribute("aria-modal");
      }
      expectIdReferencesIntact();
    });

    it("returning to Routes brings the pending switch back inside its card instead of dropping it", async () => {
      const user = userEvent.setup();
      render(<App mapFactory={buildNoopMapFactory()} />);
      const { routeB } = await armSwitchFromRouteCard(user);

      await user.click(navButton("Settings"));
      expect(confirmationNamed('Switch to "Route B"?')).toBeInTheDocument();
      await user.click(navButton("Routes"));

      await waitFor(() => {
        expect(
          getListItemByRouteId(routeB.id).querySelector(
            '[role="dialog"],[role="alertdialog"]',
          ),
        ).not.toBeNull();
      });
      expect(openConfirmations()).toHaveLength(1);
    });

    it("resuming the paused ride from the launcher withdraws the older switch prompt and keeps the paused ride", async () => {
      const user = userEvent.setup();
      const watchPositionSpy = stubGeolocationWatch();
      const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
      render(<App mapFactory={buildNoopMapFactory()} />);
      const { routeA } = await armSwitchFromRouteCard(user);

      await user.click(navButton("Ride"));
      expect(confirmationNamed('Switch to "Route B"?')).toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: "Resume ride" }));

      expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(openConfirmations()).toEqual([]);
      expect(watchPositionSpy).toHaveBeenCalledOnce();
      expect(clearSpy).not.toHaveBeenCalled();
      expect(await getActiveRideState()).toMatchObject({ routeId: routeA.id });
    });

    it("starting to ride the open paused route from its own screen withdraws the older switch prompt", async () => {
      const user = userEvent.setup();
      stubGeolocationWatch();
      const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
      render(<App mapFactory={buildNoopMapFactory()} />);
      const { routeB } = await armSwitchFromRouteCard(user);

      // Put Route A's own screen behind the Ride tab, then arm B again.
      await user.click(
        within(getListItemByRouteId(routeB.id)).getByRole("button", { name: "Cancel" }),
      );
      await user.click(screen.getByRole("button", { name: "Route A" }));
      await screen.findByRole("heading", { name: "Route A" });
      await user.click(navButton("Routes"));
      await user.click(await screen.findByRole("button", { name: "Route B" }));
      await waitFor(() => {
        expect(openConfirmations()).toHaveLength(1);
      });
      await user.click(navButton("Ride"));
      expect(confirmationNamed('Switch to "Route B"?')).toBeInTheDocument();

      await user.click(
        await screen.findByRole("button", { name: /^(Resume ride|Start riding)$/ }),
      );

      expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(openConfirmations()).toEqual([]);
      expect(clearSpy).not.toHaveBeenCalled();
    });

    it("a superseded prompt's End and switch never shows a busy state and never clears storage", async () => {
      const user = userEvent.setup();
      stubGeolocationWatch();
      const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideState");
      render(<App mapFactory={buildNoopMapFactory()} />);
      const { routeA, seededRow } = await armSwitchFromRouteCard(user);
      await user.click(navButton("Ride"));
      const resumeButton = await screen.findByRole("button", { name: "Resume ride" });

      // Hold the newer request's storage read, so the older prompt is
      // still on screen after that request has superseded it.
      const readGate = deferred();
      const realGetActiveRideState = rideStateRepository.getActiveRideState;
      vi.spyOn(rideStateRepository, "getActiveRideState").mockImplementationOnce(
        async () => {
          await readGate.promise;
          return realGetActiveRideState();
        },
      );
      await user.click(resumeButton);
      const stalePrompt = confirmationNamed('Switch to "Route B"?');
      await user.click(
        within(stalePrompt).getByRole("button", { name: "End and switch" }),
      );

      expect(screen.queryByRole("button", { name: "Ending…" })).toBeNull();
      expect(clearSpy).not.toHaveBeenCalled();
      expect(await getActiveRideState()).toEqual(seededRow);

      readGate.release();
      expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(openConfirmations()).toEqual([]);
      expect(clearSpy).not.toHaveBeenCalled();
      expect(await getActiveRideState()).toMatchObject({ routeId: routeA.id });
    });

    it("Resume ride during an older End and switch's clear waits for it, then opens a plain pre-ride that agrees with the emptied storage", async () => {
      const user = userEvent.setup();
      const watchPositionSpy = stubGeolocationWatch();
      render(<App mapFactory={buildNoopMapFactory()} />);
      await armSwitchFromRouteCard(user);
      await user.click(navButton("Ride"));
      const resumeButton = await screen.findByRole("button", { name: "Resume ride" });

      const clearGate = deferred();
      const realClear = rideStateRepository.clearActiveRideState;
      const clearSpy = vi
        .spyOn(rideStateRepository, "clearActiveRideState")
        .mockImplementationOnce(async () => {
          await clearGate.promise;
          await realClear();
        });
      await user.click(
        within(confirmationNamed('Switch to "Route B"?')).getByRole("button", {
          name: "End and switch",
        }),
      );
      expect(clearSpy).toHaveBeenCalledOnce();
      await user.click(resumeButton);

      clearGate.release();

      expect(
        await screen.findByRole("button", { name: "Start riding" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 1, name: "Route A" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1, name: "Route B" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
      expect(openConfirmations()).toEqual([]);
      expect(watchPositionSpy).not.toHaveBeenCalled();
      expect(await getActiveRideState()).toBeUndefined();
    });

    it("Resume ride during an older End and switch whose clear then fails reopens the paused ride with its progress and its row intact", async () => {
      const user = userEvent.setup();
      const watchPositionSpy = stubGeolocationWatch();
      render(<App mapFactory={buildNoopMapFactory()} />);
      const { routeA, seededRow } = await armSwitchFromRouteCard(user);
      await user.click(navButton("Ride"));
      const resumeButton = await screen.findByRole("button", { name: "Resume ride" });

      const clearGate = deferred();
      vi.spyOn(rideStateRepository, "clearActiveRideState").mockImplementationOnce(
        async () => {
          await clearGate.promise;
        },
      );
      await user.click(
        within(confirmationNamed('Switch to "Route B"?')).getByRole("button", {
          name: "End and switch",
        }),
      );
      await user.click(resumeButton);

      clearGate.fail(new Error("clear failed"));

      expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(watchPositionSpy).toHaveBeenCalledOnce();
      expect(openConfirmations()).toEqual([]);
      expect(await getActiveRideState()).toMatchObject({ routeId: routeA.id });
      expect(await getActiveRideState()).toMatchObject({
        startedAt: seededRow?.startedAt,
      });
    });

    it("an older clear that fails after a newer route request has raised its own prompt never replaces that prompt", async () => {
      const user = userEvent.setup();
      stubGeolocationWatch();
      render(<App mapFactory={buildNoopMapFactory()} />);
      await importFixture(user, "Route C.gpx");
      const { seededRow } = await armSwitchFromRouteCard(user);

      const clearGate = deferred();
      vi.spyOn(rideStateRepository, "clearActiveRideState").mockImplementationOnce(
        async () => {
          await clearGate.promise;
        },
      );
      await user.click(
        within(confirmationNamed('Switch to "Route B"?')).getByRole("button", {
          name: "End and switch",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Route C" }));

      clearGate.fail(new Error("clear failed"));

      await waitFor(() => {
        expect(confirmationNamed('Switch to "Route C"?')).toBeInTheDocument();
      });
      const newerPrompt = confirmationNamed('Switch to "Route C"?');
      expect(
        within(newerPrompt).getByRole("button", { name: "End and switch" }),
      ).toBeEnabled();
      expect(screen.queryByText(/could not be ended/i)).toBeNull();
      expect(openConfirmations()).toHaveLength(1);
      expect(screen.queryByRole("heading", { level: 1, name: "Route B" })).toBeNull();
      expect(await getActiveRideState()).toEqual(seededRow);
    });

    it("an older clear that succeeds after a newer route request has started opens only the newer route, against the emptied storage", async () => {
      const user = userEvent.setup();
      stubGeolocationWatch();
      render(<App mapFactory={buildNoopMapFactory()} />);
      await importFixture(user, "Route C.gpx");
      await armSwitchFromRouteCard(user);

      const clearGate = deferred();
      const realClear = rideStateRepository.clearActiveRideState;
      vi.spyOn(rideStateRepository, "clearActiveRideState").mockImplementationOnce(
        async () => {
          await clearGate.promise;
          await realClear();
        },
      );
      await user.click(
        within(confirmationNamed('Switch to "Route B"?')).getByRole("button", {
          name: "End and switch",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Route C" }));

      clearGate.release();

      expect(
        await screen.findByRole("heading", { level: 1, name: "Route C" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
      expect(openConfirmations()).toEqual([]);
      expect(await getActiveRideState()).toBeUndefined();
    });

    // Item 119 follow-up (installed-iPhone check of 0.4.47): after a Pause
    // the paused route's own screen stays mounted under Ride, and an End
    // and switch confirmed there swapped its route in place, carrying A's
    // fix and progress into B's pre-ride — and into storage under B's id.
    async function openPausedRouteAThenArmBAndGoToRide(
      user: ReturnType<typeof userEvent.setup>,
    ) {
      const armed = await armSwitchFromRouteCard(user);
      await user.click(
        within(getListItemByRouteId(armed.routeB.id)).getByRole("button", {
          name: "Cancel",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Route A" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Route A" }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Resume ride" }),
      ).toBeInTheDocument();
      await user.click(navButton("Routes"));
      await user.click(await screen.findByRole("button", { name: "Route B" }));
      await waitFor(() => {
        expect(openConfirmations()).toHaveLength(1);
      });
      await user.click(navButton("Ride"));
      expect(
        screen.getByRole("heading", { level: 1, name: "Route A" }),
      ).toBeInTheDocument();
      return armed;
    }

    it("End and switch confirmed from Ride opens the new route as its own session, with nothing of the paused route stored or resumable", async () => {
      const user = userEvent.setup();
      const watchPositionSpy = stubGeolocationWatch();
      const { unmount } = render(<App mapFactory={buildNoopMapFactory()} />);
      await openPausedRouteAThenArmBAndGoToRide(user);

      await user.click(
        within(confirmationNamed('Switch to "Route B"?')).getByRole("button", {
          name: "End and switch",
        }),
      );

      expect(
        await screen.findByRole("heading", { level: 1, name: "Route B" }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Start riding" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
      expect(watchPositionSpy).not.toHaveBeenCalled();
      // Sampled more than once: a write carrying A's state would land after
      // the switch's own clear, not before it.
      for (let sample = 0; sample < 3; sample += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await getActiveRideState()).toBeUndefined();
      }

      // A fresh App over the same storage stands in for a reload.
      unmount();
      render(<App mapFactory={buildNoopMapFactory()} />);
      await user.click(navButton("Ride"));
      expect(
        await screen.findByRole("button", { name: "Choose a route" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
    });

    it("End and switch confirmed from the Routes card opens the new route fresh as well (control)", async () => {
      const user = userEvent.setup();
      stubGeolocationWatch();
      render(<App mapFactory={buildNoopMapFactory()} />);
      const { routeB } = await openPausedRouteAThenArmBAndGoToRide(user);
      await user.click(navButton("Routes"));
      await waitFor(() => {
        expect(
          getListItemByRouteId(routeB.id).querySelector('[role="dialog"]'),
        ).not.toBeNull();
      });

      await user.click(
        within(getListItemByRouteId(routeB.id)).getByRole("button", {
          name: "End and switch",
        }),
      );

      expect(
        await screen.findByRole("heading", { level: 1, name: "Route B" }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Start riding" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await getActiveRideState()).toBeUndefined();
    });
  });
});

describe("App — Settings section (backlog item 121)", () => {
  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
    await db.providerKeys.clear();
    await db.providerKeyVerifications.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function switcherLandmark() {
    return screen.queryByRole("navigation", { name: "Settings and Status" });
  }

  it("shows the Settings/Status switcher on both views of the section and nowhere else", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(switcherLandmark()).toBeNull();

    await user.click(navButton("Settings"));
    expect(switcherLandmark()).not.toBeNull();
    await user.click(switcherButton("Status"));
    expect(switcherLandmark()).not.toBeNull();

    await user.click(navButton("Ride"));
    expect(switcherLandmark()).toBeNull();
  });

  it("keeps an unsaved key across Status and back — by the switcher, and by the Settings tab from Status", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navButton("Settings"));
    const input = await screen.findByLabelText("OpenRouteService API key");
    await user.type(input, "test-dummy-typed-in-app-0000");

    await user.click(switcherButton("Status"));
    await screen.findByRole("heading", { level: 1, name: "Status" });
    await user.click(switcherButton("Settings"));
    expect(await screen.findByLabelText("OpenRouteService API key")).toHaveValue(
      "test-dummy-typed-in-app-0000",
    );

    await user.click(switcherButton("Status"));
    await screen.findByRole("heading", { level: 1, name: "Status" });
    await user.click(navButton("Settings"));
    expect(await screen.findByLabelText("OpenRouteService API key")).toHaveValue(
      "test-dummy-typed-in-app-0000",
    );
    expect(await db.providerKeys.count()).toBe(0);
  });

  it("reopens the last-viewed view from another tab, while the tab from Status opens Settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(navButton("Settings"));
    await user.click(switcherButton("Status"));
    await user.click(navButton("Routes"));
    await user.click(navButton("Settings"));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Status" }),
    ).toBeInTheDocument();
    expect(switcherButton("Status")).toHaveAttribute("aria-current", "page");
    expect(navButton("Settings")).toHaveAttribute("aria-current", "true");

    await user.click(navButton("Settings"));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(navButton("Settings")).toHaveAttribute("aria-current", "page");

    // The Settings view is now the last one seen.
    await user.click(navButton("Routes"));
    await user.click(navButton("Settings"));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("forgets the last-viewed view on a reload, starting at Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navButton("Settings"));
    await user.click(switcherButton("Status"));
    await user.click(navButton("Routes"));

    cleanup();
    render(<App />);
    await user.click(navButton("Settings"));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("starts each newly shown view at the top, but a tap on the Settings tab while Settings is showing changes nothing", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();
    render(<App />);
    expect(scrollToSpy).not.toHaveBeenCalled();

    await user.click(navButton("Settings"));
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    await user.click(switcherButton("Status"));
    expect(scrollToSpy).toHaveBeenCalledTimes(2);
    await user.click(navButton("Settings"));
    expect(scrollToSpy).toHaveBeenCalledTimes(3);
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();

    await user.click(navButton("Settings"));

    expect(scrollToSpy).toHaveBeenCalledTimes(3);
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("leaves an open route session exactly where it was across a visit to Settings and Status", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await importFixture(user, "Route A.gpx");
    await user.click(screen.getByRole("button", { name: "Route A" }));
    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();

    await user.click(navButton("Settings"));
    await user.click(switcherButton("Status"));
    await user.click(navButton("Ride"));

    expect(screen.getByRole("heading", { name: "Route A" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Start riding" }),
    ).toBeInTheDocument();
  });

  it("still requires Resume free roam after a paused free-roam session visits Settings and Status", async () => {
    const user = userEvent.setup();
    const watchPositionSpy = vi.fn(() => 1);
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    render(<App mapFactory={buildNoopMapFactory()} />);
    await user.click(navButton("Ride"));
    await user.click(await screen.findByRole("button", { name: "Start free roam" }));
    await user.click(await screen.findByRole("button", { name: "Pause" }));
    await screen.findByRole("button", { name: "Resume free roam" });
    const watchesBeforeVisit = watchPositionSpy.mock.calls.length;

    await user.click(navButton("Settings"));
    await user.click(switcherButton("Status"));
    await user.click(navButton("Ride"));

    expect(
      await screen.findByRole("button", { name: "Resume free roam" }),
    ).toBeInTheDocument();
    expect(watchPositionSpy).toHaveBeenCalledTimes(watchesBeforeVisit);
  });
});
