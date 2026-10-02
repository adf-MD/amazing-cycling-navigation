import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.tsx";
import type { PlannedRoute } from "./domain/types.ts";
import type { MapFactory, MapLibreLike } from "./map/mapAdapter.ts";
import { db } from "./storage/db.ts";
import { setActiveRideState } from "./storage/rideStateRepository.ts";
import { trackWithElevationGpx } from "./test/fixtures/gpx.ts";

// Backlog item 131: App owns a launcher Resume's one-use instruction and
// retires it only when RidingScreen reports that exact instruction
// handled. The real RidingScreen reports from an effect, never on demand,
// so it is replaced here by a stub that records the props it receives and
// lets the test send a report whenever it chooses — including one from an
// obsolete screen about an older instruction. The real screen's own
// reporting is covered by RidingScreen.test.tsx, and the whole flow
// through the real screen by App.test.tsx.
//
// Backlog item 132 adds a "restore" intent with two reports of its own,
// tested here the same way. The stub never reports riding as active, so
// App's navigation stays available while the stub "rides": that makes a
// departure from Ride without Pause reachable here, though the real
// immersive shell hides the navigation while tracking.
interface ReceivedProps {
  route: PlannedRoute;
  resumeIntentToken?: number;
  onResumeIntentHandled?: (token: number) => void;
  restoreIntentToken?: number;
  onRestoredSessionMissing?: (token: number) => void;
  onStoredSessionKnown?: (routeId: string) => void;
  onReturnToRideLauncher?: () => void;
}
const stub = vi.hoisted(() => ({ received: [] as ReceivedProps[] }));

vi.mock("./platform/mapSupport.ts", () => ({
  isMapRenderingSupported: vi.fn(() => true),
}));

vi.mock("./ui/riding/RidingScreen.tsx", () => {
  function RidingScreen(props: ReceivedProps) {
    stub.received.push(props);
    return (
      <section aria-label="Riding stub">
        <p data-testid="resume-token">{String(props.resumeIntentToken ?? "none")}</p>
        <p data-testid="restore-token">{String(props.restoreIntentToken ?? "none")}</p>
        <button type="button" onClick={() => props.onReturnToRideLauncher?.()}>
          Back to Ride options
        </button>
      </section>
    );
  }
  return { RidingScreen };
});

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

function navButton(name: string) {
  return within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", {
    name,
  });
}

async function importFixture(user: ReturnType<typeof userEvent.setup>, name: string) {
  const file = new File([trackWithElevationGpx], name, { type: "application/gpx+xml" });
  const expectedName = name.replace(/\.gpx$/i, "");
  await user.upload(screen.getByLabelText("Import GPX file"), file);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: expectedName })).toBeInTheDocument();
  });
}

function latest(): ReceivedProps {
  const props = stub.received.at(-1);
  if (!props) throw new Error("RidingScreen has not been rendered");
  return props;
}

function shownToken(): string {
  return screen.getByTestId("resume-token").textContent;
}

function shownRestoreToken(): string {
  return screen.getByTestId("restore-token").textContent;
}

/** The first Ride entry opens the stub with a "restore" intent (backlog
 * item 132); its Back to Ride options shows the launcher's own summary. */
async function openLauncherThroughStub(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(navButton("Ride"));
  const stubRegion = await screen.findByRole("region", { name: "Riding stub" });
  await user.click(
    within(stubRegion).getByRole("button", { name: "Back to Ride options" }),
  );
  const launcher = await screen.findByRole("region", { name: "Ride" });
  await within(launcher).findByText("You have an unfinished ride on this route.");
  return launcher;
}

describe("App — retiring a launcher Resume's one-use instruction (item 131)", () => {
  beforeEach(async () => {
    stub.received = [];
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function seedPausedRoute(user: ReturnType<typeof userEvent.setup>) {
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
  }

  /** The launcher's own Resume ride — scoped to its region, never a
   * same-named control elsewhere. */
  async function resumeFromLauncher(user: ReturnType<typeof userEvent.setup>) {
    const launcher = await screen.findByRole("region", { name: "Ride" });
    await user.click(
      await within(launcher).findByRole("button", { name: "Resume ride" }),
    );
    await screen.findByRole("region", { name: "Riding stub" });
  }

  it("retires the instruction it is told about, once, and leaves the route open", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    await openLauncherThroughStub(user);
    await resumeFromLauncher(user);

    const token = latest().resumeIntentToken;
    if (token === undefined)
      throw new Error("expected a launcher Resume to carry a token");
    expect(shownToken()).toBe(String(token));
    // One intent at a time: a launcher Resume carries no restore token.
    expect(latest().restoreIntentToken).toBeUndefined();

    act(() => {
      latest().onResumeIntentHandled?.(token);
    });
    expect(shownToken()).toBe("none");
    expect(latest().route.name).toBe("Route A");

    // A repeated report, as Strict Mode or a re-run effect may send, is harmless.
    act(() => {
      latest().onResumeIntentHandled?.(token);
    });
    expect(shownToken()).toBe("none");
  });

  it("a report about an older instruction, from an obsolete screen, never retires a newer one", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    await openLauncherThroughStub(user);

    // A first Resume, then back to the launcher before that screen reports.
    await resumeFromLauncher(user);
    const first = latest();
    const firstToken = first.resumeIntentToken;
    if (firstToken === undefined) throw new Error("expected a first token");
    await user.click(screen.getByRole("button", { name: "Back to Ride options" }));

    // A second Resume of the same route: a new instruction.
    await resumeFromLauncher(user);
    const secondToken = latest().resumeIntentToken;
    if (secondToken === undefined) throw new Error("expected a second token");
    expect(secondToken).not.toBe(firstToken);

    // The obsolete screen's late report, through its own callback.
    act(() => {
      first.onResumeIntentHandled?.(firstToken);
    });
    expect(shownToken()).toBe(String(secondToken));

    // Only the current screen's report about the current instruction retires it.
    act(() => {
      latest().onResumeIntentHandled?.(secondToken);
    });
    expect(shownToken()).toBe("none");
  });
});

describe("App — the restore intent (item 132)", () => {
  beforeEach(async () => {
    stub.received = [];
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function seedPausedRoute(user: ReturnType<typeof userEvent.setup>) {
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
    return importedRoute;
  }

  /** Samples that the launcher stays, never stopping at the first success,
   * and that no screen is mounted behind the rider's back. */
  async function expectLauncherToStay() {
    const rendered = stub.received.length;
    for (let sample = 0; sample < 10; sample += 1) {
      expect(screen.getByRole("region", { name: "Ride" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Riding stub" })).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(stub.received.length).toBe(rendered);
  }

  it("the first Ride entry opens the route's screen with a restore token and no resume token, and Back to Ride options never reopens it", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);

    await user.click(navButton("Ride"));
    await screen.findByRole("region", { name: "Riding stub" });
    expect(latest().route.name).toBe("Route A");
    expect(latest().restoreIntentToken).toBeDefined();
    expect(latest().resumeIntentToken).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Back to Ride options" }));
    const launcher = await screen.findByRole("region", { name: "Ride" });
    await within(launcher).findByText("You have an unfinished ride on this route.");
    await expectLauncherToStay();

    // Leaving and returning is no first entry any more: still the launcher.
    await user.click(navButton("Routes"));
    await screen.findByRole("heading", { name: "Routes" });
    await user.click(navButton("Ride"));
    const again = await screen.findByRole("region", { name: "Ride" });
    await within(again).findByText("You have an unfinished ride on this route.");
    await expectLauncherToStay();
  });

  it("a missing-session report returns to the launcher only for the current restore token", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);

    await user.click(navButton("Ride"));
    await screen.findByRole("region", { name: "Riding stub" });
    const passive = latest();
    const restoreToken = passive.restoreIntentToken;
    if (restoreToken === undefined) throw new Error("expected a restore token");

    // A report naming any other token changes nothing.
    act(() => {
      passive.onRestoredSessionMissing?.(restoreToken + 100);
    });
    expect(screen.getByRole("region", { name: "Riding stub" })).toBeInTheDocument();
    expect(shownRestoreToken()).toBe(String(restoreToken));

    act(() => {
      passive.onRestoredSessionMissing?.(restoreToken);
    });
    const launcher = await screen.findByRole("region", { name: "Ride" });
    await within(launcher).findByText("You have an unfinished ride on this route.");
    await expectLauncherToStay();
  });

  it("an obsolete screen's missing-session report never returns a newer screen to the launcher", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);

    await user.click(navButton("Ride"));
    await screen.findByRole("region", { name: "Riding stub" });
    const passive = latest();
    const restoreToken = passive.restoreIntentToken;
    if (restoreToken === undefined) throw new Error("expected a restore token");

    // Back to the launcher, and a launcher Resume: a newer screen.
    await user.click(screen.getByRole("button", { name: "Back to Ride options" }));
    const launcher = await screen.findByRole("region", { name: "Ride" });
    await user.click(
      await within(launcher).findByRole("button", { name: "Resume ride" }),
    );
    await screen.findByRole("region", { name: "Riding stub" });
    const resumeToken = latest().resumeIntentToken;
    if (resumeToken === undefined) throw new Error("expected a resume token");

    act(() => {
      passive.onRestoredSessionMissing?.(restoreToken);
    });
    expect(screen.getByRole("region", { name: "Riding stub" })).toBeInTheDocument();
    expect(shownToken()).toBe(String(resumeToken));
  });

  // Amendment 1's App half. The real immersive shell hides the navigation
  // while tracking, so a rider cannot leave Ride without Pause today; the
  // stub never reports riding as active, which makes that departure
  // reachable here. What it proves is App's own bookkeeping: the knowledge
  // that a session is stored survives the one-use resume instruction, and
  // a remount gets it without any instruction to start tracking.
  it("after a launcher Resume, a departure from Ride without Pause remounts the screen with a restore token and no resume token (synthetic: the real shell hides the navigation while tracking)", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    const importedRoute = await seedPausedRoute(user);

    const launcher = await openLauncherThroughStub(user);
    await user.click(
      await within(launcher).findByRole("button", { name: "Resume ride" }),
    );
    await screen.findByRole("region", { name: "Riding stub" });
    const resumeToken = latest().resumeIntentToken;
    if (resumeToken === undefined) throw new Error("expected a resume token");

    // Known while the instruction is still pending: never overwrites it.
    act(() => {
      latest().onStoredSessionKnown?.(importedRoute.id);
    });
    expect(shownToken()).toBe(String(resumeToken));
    expect(shownRestoreToken()).toBe("none");

    // The instruction is handled (tracking started), then the screen
    // reports the stored session again, as its effect does.
    act(() => {
      latest().onResumeIntentHandled?.(resumeToken);
    });
    expect(shownToken()).toBe("none");
    act(() => {
      latest().onStoredSessionKnown?.(importedRoute.id);
    });
    const restoreToken = latest().restoreIntentToken;
    if (restoreToken === undefined) throw new Error("expected a restore token");

    // A report for another route, or a repeat, changes nothing.
    act(() => {
      latest().onStoredSessionKnown?.("some-other-route");
      latest().onStoredSessionKnown?.(importedRoute.id);
    });
    expect(shownRestoreToken()).toBe(String(restoreToken));

    // Leave Ride without any Pause, and return.
    await user.click(navButton("Routes"));
    await screen.findByRole("heading", { name: "Routes" });
    const rendered = stub.received.length;
    await user.click(navButton("Ride"));
    await screen.findByRole("region", { name: "Riding stub" });
    expect(stub.received.length).toBeGreaterThan(rendered);
    expect(latest().restoreIntentToken).toBe(restoreToken);
    expect(latest().resumeIntentToken).toBeUndefined();
  });
});
