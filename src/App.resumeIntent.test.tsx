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
interface ReceivedProps {
  route: PlannedRoute;
  resumeIntentToken?: number;
  onResumeIntentHandled?: (token: number) => void;
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

  async function resumeFromLauncher(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Resume ride" }));
    await screen.findByRole("region", { name: "Riding stub" });
  }

  it("retires the instruction it is told about, once, and leaves the route open", async () => {
    const user = userEvent.setup();
    render(<App mapFactory={buildNoopMapFactory()} />);
    await seedPausedRoute(user);
    await user.click(navButton("Ride"));
    await resumeFromLauncher(user);

    const token = latest().resumeIntentToken;
    if (token === undefined)
      throw new Error("expected a launcher Resume to carry a token");
    expect(shownToken()).toBe(String(token));

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
    await user.click(navButton("Ride"));

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
