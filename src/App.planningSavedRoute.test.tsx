import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.tsx";
import type { PlannedRoute } from "./domain/types.ts";
import type { MapFactory, MapLibreLike } from "./map/mapAdapter.ts";
import { db } from "./storage/db.ts";
import { getActiveRideState, setActiveRideState } from "./storage/rideStateRepository.ts";
import * as rideStateRepository from "./storage/rideStateRepository.ts";
import * as planningDraftRepository from "./storage/planningDraftRepository.ts";
import * as routesRepository from "./storage/routesRepository.ts";
import { trackWithElevationGpx } from "./test/fixtures/gpx.ts";
import type { SavedRouteSwitchPrompt } from "./ui/planning/PlanningScreen.tsx";

// Backlog item 124, slice 3 (inventory C-14): App's side of Planning's Open
// saved route. The real PlanningScreen cannot be mounted in this jsdom
// suite (App does not thread a map factory to it; see App.test.tsx's item
// 73 note), so it is replaced by a small stub that does exactly what the
// real screen does at this boundary: it calls onOpenSavedRoute with its
// saved route, presents the prompt App passes it while it still has its
// anchor, and — like the real screen after a remount — reports a prompt
// it has no anchor for. The real screen's own presentation, reveal and
// focus behaviour are covered by PlanningScreen.savedRoute.test.tsx and
// e2e/planningSavedRoute.smoke.spec.ts. Like the real screen, it also
// reports its content ready to App's screen scroll memory and offers the
// missing-key notice's Open Settings (backlog item 125).
interface PlanningStubState {
  hasAnchor: boolean;
  savedRoute: PlannedRoute | null;
  prompts: SavedRouteSwitchPrompt[];
}
const stub = vi.hoisted((): PlanningStubState => ({
  hasAnchor: true,
  savedRoute: null,
  prompts: [],
}));

vi.mock("./platform/mapSupport.ts", () => ({
  isMapRenderingSupported: vi.fn(() => true),
}));

vi.mock("./ui/planning/PlanningScreen.tsx", async () => {
  const { useEffect } = await import("react");
  const { useScreenScrollRestoration } =
    await import("./ui/shared/screenScrollMemory.ts");
  function PlanningScreen(props: {
    onOpenSavedRoute?: (route: PlannedRoute) => void;
    onNavigateToSettings?: () => void;
    savedRouteSwitchPrompt?: SavedRouteSwitchPrompt | null;
  }) {
    const prompt = props.savedRouteSwitchPrompt ?? null;
    if (prompt && !stub.prompts.includes(prompt)) stub.prompts.push(prompt);
    useEffect(() => {
      if (prompt && !stub.hasAnchor) prompt.onAnchorMissing(prompt.requestId);
    }, [prompt]);
    useScreenScrollRestoration(true);
    return (
      <section aria-label="Planning stub">
        <button type="button" onClick={() => props.onNavigateToSettings?.()}>
          Open Settings
        </button>
        <button
          type="button"
          onClick={() => {
            if (stub.savedRoute) props.onOpenSavedRoute?.(stub.savedRoute);
          }}
        >
          Open saved route
        </button>
        {prompt && stub.hasAnchor ? (
          <div role="group" aria-label="Planning inline prompt">
            <p>{prompt.title}</p>
            <p>{prompt.message}</p>
            <button type="button" disabled={prompt.busy} onClick={prompt.onCancel}>
              Cancel
            </button>
            <button type="button" disabled={prompt.busy} onClick={prompt.onConfirm}>
              {prompt.confirmLabel}
            </button>
          </div>
        ) : null}
      </section>
    );
  }
  return { PlanningScreen };
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

function inlinePrompt() {
  return screen.queryByRole("group", { name: "Planning inline prompt" });
}

function latestPrompt(): SavedRouteSwitchPrompt {
  const prompt = stub.prompts.at(-1);
  if (!prompt) throw new Error("Planning has not received a switch prompt");
  return prompt;
}

function controlledPromise<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("App — Planning's Open saved route (item 124, slice 3)", () => {
  let watchPositionSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
    stub.hasAnchor = true;
    stub.savedRoute = null;
    stub.prompts = [];
    window.scrollY = 0;
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Element.prototype.scrollIntoView = vi.fn();
    watchPositionSpy = vi.fn();
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: watchPositionSpy,
        getCurrentPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setUp(user: ReturnType<typeof userEvent.setup>) {
    render(<App mapFactory={buildNoopMapFactory()} />);
    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    const routeA = routes.find((route) => route.name === "Route A");
    const routeB = routes.find((route) => route.name === "Route B");
    if (!routeA || !routeB) throw new Error("expected Route A and Route B");
    stub.savedRoute = routeB;
    return { routeA, routeB };
  }

  // A current-format row, with the identity every session has had since
  // item 140; rows without one are covered in RidingLauncher.test.tsx and
  // rideStateRepository.test.ts.
  async function pauseRouteA(routeId: string) {
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

  async function openFromPlanning(user: ReturnType<typeof userEvent.setup>) {
    await user.click(navButton("Plan"));
    await user.click(screen.getByRole("button", { name: "Open saved route" }));
  }

  it("with nothing unfinished, opens the saved route's pre-ride screen, with no dialog and no location tracking", async () => {
    const user = userEvent.setup();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideStateIfSession");
    await setUp(user);

    await openFromPlanning(user);

    expect(await screen.findByRole("heading", { name: "Route B" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start riding" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(watchPositionSpy).not.toHaveBeenCalled();
  });

  it("with a route ride paused, hands the prompt to Planning inline — never page-level — and leaves the stored ride untouched", async () => {
    const user = userEvent.setup();
    const { routeA } = await setUp(user);
    const routeARow = await pauseRouteA(routeA.id);

    await openFromPlanning(user);

    const prompt = await waitFor(() => {
      const group = inlinePrompt();
      if (!group) throw new Error("expected the inline prompt");
      return group;
    });
    expect(within(prompt).getByText('Switch to "Route B"?')).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Route B" })).toBeNull();
    expect(await getActiveRideState()).toEqual(routeARow);
  });

  it("with free roam unfinished, presents it inline too; End and switch clears it once and then opens the saved route", async () => {
    const user = userEvent.setup();
    const clearSpy = vi.spyOn(rideStateRepository, "clearActiveRideStateIfSession");
    await setUp(user);
    await setActiveRideState({
      id: "active",
      kind: "free-roam",
      startedAt: "2026-01-01T08:00:00.000Z",
      sessionId: "free-roam-session-seeded",
      lastFix: null,
    });

    await openFromPlanning(user);
    const prompt = await waitFor(() => {
      const group = inlinePrompt();
      if (!group) throw new Error("expected the inline prompt");
      return group;
    });
    expect(
      within(prompt).getByText(/an unfinished free roam session/),
    ).toBeInTheDocument();

    await user.click(within(prompt).getByRole("button", { name: "End and switch" }));
    expect(await screen.findByRole("heading", { name: "Route B" })).toBeInTheDocument();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(await getActiveRideState()).toBeUndefined();
    expect(watchPositionSpy).not.toHaveBeenCalled();
  });

  it("Cancel withdraws the prompt without App moving focus, keeping the paused ride", async () => {
    const user = userEvent.setup();
    const { routeA } = await setUp(user);
    const routeARow = await pauseRouteA(routeA.id);
    await openFromPlanning(user);
    const prompt = await waitFor(() => {
      const group = inlinePrompt();
      if (!group) throw new Error("expected the inline prompt");
      return group;
    });

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));

    expect(inlinePrompt()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(await getActiveRideState()).toEqual(routeARow);
  });

  it("falls back to the page-level dialog when the rider leaves Planning, as a route-card prompt does", async () => {
    const user = userEvent.setup();
    const { routeA } = await setUp(user);
    await pauseRouteA(routeA.id);
    await openFromPlanning(user);
    await waitFor(() => {
      expect(inlinePrompt()).not.toBeNull();
    });

    await user.click(navButton("Routes"));

    expect(
      await screen.findByRole("dialog", { name: 'Switch to "Route B"?' }),
    ).toBeInTheDocument();
  });

  it("withdraws an idle prompt whose anchor is gone after Planning remounts, leaving the paused ride", async () => {
    const user = userEvent.setup();
    const { routeA } = await setUp(user);
    const routeARow = await pauseRouteA(routeA.id);
    await openFromPlanning(user);
    await waitFor(() => {
      expect(inlinePrompt()).not.toBeNull();
    });

    await user.click(navButton("Routes"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    stub.hasAnchor = false;
    await user.click(navButton("Plan"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(inlinePrompt()).toBeNull();
    expect(await getActiveRideState()).toEqual(routeARow);
  });

  it("keeps an End and switch that is clearing represented when the anchor vanishes, and opens the saved route once the clear succeeds", async () => {
    const user = userEvent.setup();
    const { routeA } = await setUp(user);
    await pauseRouteA(routeA.id);
    const realClear = rideStateRepository.clearActiveRideStateIfSession;
    const held = controlledPromise<undefined>();
    vi.spyOn(rideStateRepository, "clearActiveRideStateIfSession").mockImplementation(
      async (sessionId) => {
        await held.promise;
        return realClear(sessionId);
      },
    );

    await openFromPlanning(user);
    const prompt = await waitFor(() => {
      const group = inlinePrompt();
      if (!group) throw new Error("expected the inline prompt");
      return group;
    });
    await user.click(within(prompt).getByRole("button", { name: "End and switch" }));

    await user.click(navButton("Routes"));
    stub.hasAnchor = false;
    await user.click(navButton("Plan"));

    // Not withdrawn: the running clear is still represented, page-level,
    // and cannot be cancelled while it runs.
    const dialog = await screen.findByRole("dialog", { name: 'Switch to "Route B"?' });
    expect(within(dialog).getByText("Ending your current ride…")).toBeInTheDocument();
    const lastPrompt = latestPrompt();
    act(() => {
      lastPrompt.onCancel();
    });
    expect(
      screen.getByRole("dialog", { name: 'Switch to "Route B"?' }),
    ).toBeInTheDocument();

    await act(async () => {
      held.resolve(undefined);
      await held.promise;
    });
    expect(await screen.findByRole("heading", { name: "Route B" })).toBeInTheDocument();
    expect(await getActiveRideState()).toBeUndefined();
  });

  it("keeps a failed clear's outcome represented when the anchor vanished while it ran, with the original ride kept", async () => {
    const user = userEvent.setup();
    const { routeA } = await setUp(user);
    const routeARow = await pauseRouteA(routeA.id);
    const held = controlledPromise<undefined>();
    vi.spyOn(rideStateRepository, "clearActiveRideStateIfSession").mockImplementation(
      async () => {
        await held.promise;
        return "cleared" as const;
      },
    );

    await openFromPlanning(user);
    const prompt = await waitFor(() => {
      const group = inlinePrompt();
      if (!group) throw new Error("expected the inline prompt");
      return group;
    });
    await user.click(within(prompt).getByRole("button", { name: "End and switch" }));
    await user.click(navButton("Routes"));
    stub.hasAnchor = false;
    await user.click(navButton("Plan"));
    await screen.findByRole("dialog", { name: 'Switch to "Route B"?' });

    await act(async () => {
      held.reject(new Error("clear failed"));
      await held.promise.catch(() => undefined);
    });

    const dialog = await screen.findByRole("dialog", { name: 'Switch to "Route B"?' });
    expect(
      within(dialog).getByText(
        "This unfinished ride could not be ended on this device. Try again.",
      ),
    ).toBeInTheDocument();
    expect(await getActiveRideState()).toEqual(routeARow);
  });

  it("keeps a held Retry read represented when the anchor vanishes, and lets its outcome open the saved route", async () => {
    const user = userEvent.setup();
    await setUp(user);
    const realGet = rideStateRepository.getActiveRideStateWithSessionId;
    let mode: "reject" | "hold" | "real" = "real";
    const heldRead = controlledPromise<undefined>();
    vi.spyOn(rideStateRepository, "getActiveRideStateWithSessionId").mockImplementation(
      async () => {
        if (mode === "reject") throw new Error("read failed");
        if (mode === "hold") return heldRead.promise;
        return realGet();
      },
    );

    mode = "reject";
    await openFromPlanning(user);
    const prompt = await waitFor(() => {
      const group = inlinePrompt();
      if (!group) throw new Error("expected the inline prompt");
      return group;
    });
    expect(
      within(prompt).getByText("Couldn't check for an unfinished ride"),
    ).toBeInTheDocument();

    mode = "hold";
    await user.click(within(prompt).getByRole("button", { name: "Retry" }));
    mode = "real";
    await user.click(navButton("Routes"));
    stub.hasAnchor = false;
    await user.click(navButton("Plan"));

    // The Retry is still running (its status still reads check-failed):
    // the prompt is kept, page-level, rather than withdrawn behind it.
    expect(
      await screen.findByRole("dialog", {
        name: "Couldn't check for an unfinished ride",
      }),
    ).toBeInTheDocument();

    await act(async () => {
      heldRead.resolve(undefined);
      await heldRead.promise;
    });
    expect(await screen.findByRole("heading", { name: "Route B" })).toBeInTheDocument();
  });

  it("protects a newer request from a held Retry: the old read's outcome does nothing once the rider has opened again", async () => {
    const user = userEvent.setup();
    const { routeA } = await setUp(user);
    const routeARow = await pauseRouteA(routeA.id);
    const realGet = rideStateRepository.getActiveRideStateWithSessionId;
    let mode: "reject" | "hold" | "real" = "real";
    const heldRead = controlledPromise<undefined>();
    vi.spyOn(rideStateRepository, "getActiveRideStateWithSessionId").mockImplementation(
      async () => {
        if (mode === "reject") throw new Error("read failed");
        if (mode === "hold") return heldRead.promise;
        return realGet();
      },
    );

    mode = "reject";
    await openFromPlanning(user);
    const prompt = await waitFor(() => {
      const group = inlinePrompt();
      if (!group) throw new Error("expected the inline prompt");
      return group;
    });
    mode = "hold";
    await user.click(within(prompt).getByRole("button", { name: "Retry" }));
    mode = "real";
    // A newer request for the same saved route, while the Retry still runs.
    await user.click(screen.getByRole("button", { name: "Open saved route" }));
    await waitFor(() => {
      expect(
        within(inlinePrompt() ?? document.body).getByText('Switch to "Route B"?'),
      ).toBeInTheDocument();
    });

    await act(async () => {
      heldRead.resolve(undefined);
      await heldRead.promise;
    });
    // The stale Retry's "nothing stored" outcome opened nothing.
    expect(screen.queryByRole("heading", { name: "Route B" })).toBeNull();
    expect(inlinePrompt()).not.toBeNull();
    expect(await getActiveRideState()).toEqual(routeARow);
  });

  it("ignores a stale anchor report for an older request, even one for the same route", async () => {
    const user = userEvent.setup();
    const { routeA } = await setUp(user);
    await pauseRouteA(routeA.id);
    await openFromPlanning(user);
    await waitFor(() => {
      expect(inlinePrompt()).not.toBeNull();
    });
    const first = latestPrompt();

    fireEvent.click(
      within(inlinePrompt() ?? document.body).getByRole("button", { name: "Cancel" }),
    );
    expect(inlinePrompt()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open saved route" }));
    await waitFor(() => {
      expect(inlinePrompt()).not.toBeNull();
    });
    const second = latestPrompt();
    expect(second.requestId).toBeGreaterThan(first.requestId);
    expect(second.routeId).toBe(first.routeId);

    act(() => {
      first.onAnchorMissing(first.requestId);
    });
    expect(inlinePrompt()).not.toBeNull();
  });

  // Backlog item 132: opening the route that is itself paused carries a
  // "restore" intent, so a failed restoration is explained, never offered
  // as a fresh start.
  it("opening the paused route itself explains a failed restoration instead of offering Start riding, with no tracking", async () => {
    const user = userEvent.setup();
    const { routeB } = await setUp(user);
    // The helper pauses whichever route it is given: here the saved route.
    await pauseRouteA(routeB.id);
    const realRead = rideStateRepository.getActiveRideStateWithSessionId;
    vi.spyOn(rideStateRepository, "getActiveRideStateWithSessionId")
      .mockImplementationOnce(realRead)
      .mockRejectedValueOnce(new Error("boom"));

    await openFromPlanning(user);

    const riding = await screen.findByRole("region", { name: "Riding" });
    expect(
      within(riding).getByRole("heading", { level: 1, name: "Route B" }),
    ).toBeInTheDocument();
    expect(await within(riding).findByRole("alert")).toHaveTextContent(
      "Your ride could not be restored on this device. Try again.",
    );
    expect(screen.queryByRole("button", { name: "Start riding" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(watchPositionSpy).not.toHaveBeenCalled();
  });
});

// Backlog item 125, at App's boundary with Planning (the stub above, which
// reports its content ready as the real screen does once its draft has
// loaded). jsdom has no layout, so the document is stubbed as 20,000 px tall
// and scrollTo clamps as a browser would.
describe("App — per-screen scroll restoration around Planning (backlog item 125)", () => {
  function spyOnScrollTo() {
    return vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const [options] = args;
      const top = (options as ScrollToOptions).top;
      if (typeof top === "number") window.scrollY = Math.min(top, 19_200);
    });
  }
  let scrollToSpy: ReturnType<typeof spyOnScrollTo>;

  beforeEach(async () => {
    await db.routes.clear();
    await db.rideState.clear();
    await db.routeLibraryPreferences.clear();
    await db.planningDrafts.clear();
    stub.hasAnchor = true;
    stub.savedRoute = null;
    stub.prompts = [];
    window.scrollY = 0;
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("navigator", {
      onLine: navigator.onLine,
      geolocation: {
        watchPosition: vi.fn(),
        getCurrentPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    const root = document.documentElement;
    Object.defineProperty(root, "scrollHeight", { configurable: true, value: 20_000 });
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 800 });
    scrollToSpy = spyOnScrollTo();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    const root = document.documentElement as unknown as Record<string, unknown>;
    delete root.scrollHeight;
    delete root.clientHeight;
  });

  /** A rider's own scroll: genuine input first, as on a device, so a settle
   * loop still running from an arrival stops rather than undoing it. */
  function riderScrollsTo(y: number) {
    window.dispatchEvent(new Event("wheel"));
    window.scrollY = y;
  }

  function scrolledTo(): number[] {
    return scrollToSpy.mock.calls.map(
      (args: unknown[]) => (args[0] as ScrollToOptions | undefined)?.top ?? 0,
    );
  }

  async function setUpLibrary(user: ReturnType<typeof userEvent.setup>) {
    render(<App mapFactory={buildNoopMapFactory()} />);
    await importFixture(user, "Route A.gpx");
    await importFixture(user, "Route B.gpx");
    const routes = await db.routes.toArray();
    stub.savedRoute = routes.find((route) => route.name === "Route B") ?? null;
    return routes.find((route) => route.name === "Route A");
  }

  it("Planning's Open saved route never hands Routes Planning's offset: Routes comes back where Routes was left", async () => {
    const user = userEvent.setup();
    await setUpLibrary(user);
    riderScrollsTo(1000);
    await user.click(navButton("Plan"));
    riderScrollsTo(3000);
    scrollToSpy.mockClear();

    await user.click(screen.getByRole("button", { name: "Open saved route" }));
    expect(await screen.findByRole("heading", { name: "Route B" })).toBeInTheDocument();
    expect(window.scrollY).toBe(0);
    await user.click(navButton("Routes"));
    await waitFor(() => {
      expect(window.scrollY).toBe(1000);
    });

    expect(scrolledTo()).not.toContain(3000);
  });

  it("Edit copy opens Planning at the top: the replaced draft's position is discarded", async () => {
    const user = userEvent.setup();
    await setUpLibrary(user);
    await user.click(navButton("Plan"));
    riderScrollsTo(2500);
    await user.click(navButton("Routes"));
    await user.click(await screen.findByRole("button", { name: "Route A" }));
    riderScrollsTo(700);
    scrollToSpy.mockClear();

    await user.click(await screen.findByRole("button", { name: "Edit copy" }));

    expect(
      await screen.findByRole("region", { name: "Planning stub" }),
    ).toBeInTheDocument();
    expect(window.scrollY).toBe(0);
    expect(scrolledTo()).not.toContain(2500);
  });

  it("an Edit copy that completes after the rider has left Ride for Planning never moves Planning, and Planning's next arrival starts at the top", async () => {
    const user = userEvent.setup();
    await setUpLibrary(user);
    await user.click(navButton("Plan"));
    riderScrollsTo(2500);
    await user.click(navButton("Routes"));
    await user.click(await screen.findByRole("button", { name: "Route A" }));

    const write = controlledPromise<undefined>();
    const originalSaveDraft = planningDraftRepository.saveDraft;
    const saveDraftSpy = vi
      .spyOn(planningDraftRepository, "saveDraft")
      .mockImplementation(async (draft) => {
        await write.promise;
        await originalSaveDraft(draft);
      });
    await user.click(await screen.findByRole("button", { name: "Edit copy" }));
    await waitFor(() => {
      expect(saveDraftSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(navButton("Plan"));
    await waitFor(() => {
      expect(window.scrollY).toBe(2500); // Planning's own position, restored
    });
    riderScrollsTo(2650); // and the rider scrolls on
    scrollToSpy.mockClear();

    write.resolve(undefined);
    await waitFor(async () => {
      expect(
        (await planningDraftRepository.getDraft())?.editCopySourceRouteId,
      ).toBeDefined();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(2650);
    expect(screen.getByRole("region", { name: "Planning stub" })).toBeInTheDocument();

    await user.click(navButton("Routes"));
    riderScrollsTo(400);
    await user.click(navButton("Plan"));
    expect(window.scrollY).toBe(0);
  });

  it("a page-level switch dialog that takes focus on arrival wins over Routes' restore", async () => {
    const user = userEvent.setup();
    const routeA = await setUpLibrary(user);
    if (!routeA) throw new Error("expected Route A");
    riderScrollsTo(1000);
    await user.click(navButton("Plan"));
    await setActiveRideState({
      id: "active",
      routeId: routeA.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      sessionId: "session-seeded",
      lastFix: { coordinate: [0, 51], accuracyMetres: 6, timestampMs: 1000 },
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });
    await user.click(screen.getByRole("button", { name: "Open saved route" }));
    await waitFor(() => {
      expect(inlinePrompt()).not.toBeNull();
    });
    riderScrollsTo(300);
    scrollToSpy.mockClear();

    await user.click(navButton("Routes"));

    const dialog = await screen.findByRole("dialog", { name: 'Switch to "Route B"?' });
    expect(await screen.findByRole("button", { name: "Route A" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(scrolledTo()).not.toContain(1000);
  });

  it("leaving Routes before its list has loaded keeps Routes' position for the next arrival", async () => {
    const user = userEvent.setup();
    await setUpLibrary(user);
    riderScrollsTo(1500);
    await user.click(navButton("Plan"));

    const list = controlledPromise<undefined>();
    const originalListRoutes = routesRepository.listRoutes;
    const listSpy = vi
      .spyOn(routesRepository, "listRoutes")
      .mockImplementation(async () => {
        await list.promise;
        return originalListRoutes();
      });
    await user.click(navButton("Routes"));
    expect(screen.getByText("Loading routes…")).toBeInTheDocument();
    await user.click(navButton("Plan"));
    list.resolve(undefined);
    listSpy.mockRestore();

    await user.click(navButton("Routes"));
    await waitFor(() => {
      expect(window.scrollY).toBe(1500);
    });
  });

  it("Planning's Open Settings opens Settings at the top, discarding Settings' own position", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await user.click(navButton("Settings"));
    riderScrollsTo(1800);
    await user.click(navButton("Plan"));
    riderScrollsTo(600);
    scrollToSpy.mockClear();

    await user.click(screen.getByRole("button", { name: "Open Settings" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(window.scrollY).toBe(0);
    expect(scrolledTo()).not.toContain(1800);
  });
});
