// Deliberately separate from PlanningScreen.test.tsx and the other
// PlanningScreen.*.test.tsx sibling files (item 30/31/37's own established
// per-concern split) — this file proves backlog item 38's "Reverse route
// inside Planning" contract: a local, undoable action that reverses
// waypoint order and the route name together as one atomic history entry,
// issues zero routing-provider requests until an explicit Calculate, and
// leaves seed provenance (editCopyMeta) untouched. Reuses the mocked-
// repository/fake-timer/controlled-promise harness PlanningScreen.clearDraft.
// test.tsx already established.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PlanningScreen } from "./PlanningScreen.tsx";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { RoutingProvider } from "../../routing/provider.ts";
import { db } from "../../storage/db.ts";
import type { PlanningDraftContent } from "../../storage/mapping.ts";
import { saveProviderKey } from "../../storage/providerKeyRepository.ts";

vi.mock("../../storage/planningDraftRepository.ts", () => ({
  getDraft: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
}));
vi.mock("../../storage/planningPreferencesRepository.ts", () => ({
  getPlanningPreferences: vi.fn(),
}));
vi.mock("../../storage/routesRepository.ts", () => ({
  saveRoute: vi.fn(),
}));

import {
  clearDraft,
  getDraft,
  saveDraft,
} from "../../storage/planningDraftRepository.ts";
import { getPlanningPreferences } from "../../storage/planningPreferencesRepository.ts";
import { saveRoute } from "../../storage/routesRepository.ts";

const mockedGetDraft = vi.mocked(getDraft);
const mockedSaveDraft = vi.mocked(saveDraft);
const mockedClearDraft = vi.mocked(clearDraft);
const mockedGetPlanningPreferences = vi.mocked(getPlanningPreferences);
const mockedSaveRoute = vi.mocked(saveRoute);

// Mirrors PlanningScreen.tsx's own DRAFT_DEBOUNCE_MS — kept as a local
// literal rather than importing an unexported constant, matching the
// sibling files' own established precedent.
const DRAFT_DEBOUNCE_MS = 900;

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerMapTap: (coordinate: Coordinate) => void;
}

// A minimal local MapLibreLike stub, duplicated rather than shared per this
// project's established no-shared-test-helpers-across-files convention.
function createMockMapFactory(): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let mapTapListener: ((coordinate: Coordinate) => void) | undefined;
  const sources = new Map<string, GeoJSON.FeatureCollection>();

  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: (listener) => {
        loadListener = listener;
      },
      onStyleLoaded: (listener) => {
        styleLoadedListener = listener;
      },
      onError: () => undefined,
      onSourceData: () => undefined,
      addGeoJsonSource: (id, data) => {
        sources.set(id, data);
      },
      setGeoJsonSourceData: (id, data) => {
        sources.set(id, data);
      },
      hasSource: (id) => sources.has(id),
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
      resize: () => undefined,
      onMapTap: (listener) => {
        mapTapListener = listener;
      },
      queryTopWarningFeatureAt: () => null,
      queryTopRouteFeatureAt: () => null,
      setMarkers: () => undefined,
      setDistanceBadges: () => undefined,
      remove: () => undefined,
    };
    return map;
  };

  return {
    factory,
    triggerLoad: () => {
      act(() => {
        styleLoadedListener?.();
        loadListener?.();
      });
    },
    triggerMapTap: (coordinate) => {
      act(() => {
        mapTapListener?.(coordinate);
      });
    },
  };
}

function buildRoute(pointCount = 10): PlannedRoute {
  return {
    id: "route-calc-1",
    name: "Planned route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: Array.from({ length: pointCount }, (_, i) => ({
      coordinate: [i * 0.001, 51] as Coordinate,
      elevationMetres: 10 + i,
      distanceFromStartMetres: i * 100,
    })),
    manoeuvres: [],
    distanceMetres: (pointCount - 1) * 100,
    ascentMetres: 12,
    descentMetres: 4,
    surfaceSummary: {
      pavedMetres: (pointCount - 1) * 100,
      questionableMetres: 0,
      unsuitableMetres: 0,
      unknownMetres: 0,
    },
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

const WAYPOINT_A: Coordinate = [1, 51];
const WAYPOINT_B: Coordinate = [1.02, 51.01];
const WAYPOINT_C: Coordinate = [1.04, 51.02];

/** A restored draft with two named waypoints and edit-copy provenance —
 * mirrors PlanningScreen.clearDraft.test.tsx's own buildMeaningfulDraftContent,
 * duplicated locally per this project's established convention. */
function buildDraftContent(
  overrides: Partial<PlanningDraftContent> = {},
): PlanningDraftContent {
  return {
    waypoints: [
      { id: "wp-a", coordinate: WAYPOINT_A },
      { id: "wp-b", coordinate: WAYPOINT_B },
    ],
    routeName: "Evening loop",
    avoidFerries: false,
    profile: "cycling-regular",
    editCopySourceRouteId: "route-1",
    editCopyWaypointsOrigin: "exact",
    editCopyOperation: "forward",
    ...overrides,
  };
}

/** A RoutingProvider whose single calculateRoute() call stays pending until
 * resolveNext is invoked — for proving a late provider response cannot
 * restore a routed result after a reversal has already invalidated it. */
function buildControllableProvider(): {
  provider: RoutingProvider;
  calculateRoute: ReturnType<typeof vi.fn>;
  resolveNext: (route: PlannedRoute) => void;
} {
  let pendingResolve: ((route: PlannedRoute) => void) | undefined;
  const calculateRoute = vi.fn(
    () =>
      new Promise<PlannedRoute>((resolve) => {
        pendingResolve = resolve;
      }),
  );
  return {
    provider: { calculateRoute },
    calculateRoute,
    resolveNext: (route) => {
      pendingResolve?.(route);
    },
  };
}

/** Flushes pending microtasks/timers under fake-timer control, wrapped in
 * act so any resulting React state updates are applied before the next
 * assertion. */
async function flushAsync(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

async function advancePastDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 50);
  });
}

/** Polls (via flushAsync) until the given predicate is true, mirroring the
 * sibling files' own established "poll loop absorbs further ticks"
 * convention rather than RTL's findBy/waitFor, whose own internal timeout
 * is a real setTimeout this file's fake timers would otherwise freeze. */
async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await flushAsync();
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

function reverseRouteButton(): HTMLElement {
  return screen.getByRole("button", { name: /^reverse route$/i });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /^save route$/i });
}

function exportButton(): HTMLElement {
  return screen.getByRole("button", { name: /^export gpx$/i });
}

/** The most recent saveDraft() call's payload, or throws if it was never
 * called — used throughout to verify waypoint order and route name after
 * the 900ms autosave debounce, since WaypointList's own "Start"/"Waypoint
 * N" labels are purely positional and reveal no coordinate information. */
function lastSavedDraft(): PlanningDraftContent {
  const lastCall = mockedSaveDraft.mock.calls.at(-1);
  if (!lastCall) throw new Error("saveDraft was never called");
  return lastCall[0];
}

/** Renders PlanningScreen with a restored draft already seeded via
 * getDraft(). */
async function renderWithDraft(
  map: MockMapHandle,
  options: {
    draft?: PlanningDraftContent;
    provider?: RoutingProvider;
  } = {},
): Promise<void> {
  const draft = options.draft ?? buildDraftContent();
  mockedGetDraft.mockResolvedValueOnce(draft);
  const provider =
    options.provider ??
    ({ calculateRoute: () => Promise.reject(new Error("unused")) } as const);
  render(
    <PlanningScreen
      onNavigateToSettings={vi.fn()}
      mapFactory={map.factory}
      routingProvider={provider}
    />,
  );
  map.triggerLoad();
  await waitUntil(
    () => screen.queryByDisplayValue(draft.routeName) !== null,
    `restored draft "${draft.routeName}" to hydrate`,
  );
}

/** Renders a genuinely fresh PlanningScreen session (no draft row). */
async function renderFresh(
  map: MockMapHandle,
  options: { provider?: RoutingProvider } = {},
): Promise<void> {
  mockedGetDraft.mockResolvedValueOnce(undefined);
  const provider =
    options.provider ??
    ({ calculateRoute: () => Promise.reject(new Error("unused")) } as const);
  render(
    <PlanningScreen
      onNavigateToSettings={vi.fn()}
      mapFactory={map.factory}
      routingProvider={provider}
    />,
  );
  map.triggerLoad();
  await waitUntil(
    () => screen.queryByText(/no waypoints yet/i) !== null,
    "fresh session to hydrate",
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockedSaveDraft.mockResolvedValue(undefined);
  mockedClearDraft.mockResolvedValue(undefined);
  mockedSaveRoute.mockResolvedValue(undefined);
  mockedGetPlanningPreferences.mockResolvedValue({
    profileByDefault: "cycling-road",
    avoidFerriesByDefault: true,
  });
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PlanningScreen Reverse route (backlog item 38)", () => {
  it("is disabled with zero or one waypoints and enabled once a second is placed", async () => {
    const map = createMockMapFactory();
    await renderFresh(map);

    expect(reverseRouteButton()).toBeDisabled();

    map.triggerMapTap(WAYPOINT_A);
    await flushAsync();
    expect(reverseRouteButton()).toBeDisabled();

    map.triggerMapTap(WAYPOINT_B);
    await flushAsync();
    expect(reverseRouteButton()).toBeEnabled();
  });

  it("sits in the Waypoint actions group, alongside Undo/Redo/Return to start", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map);

    const group = screen.getByRole("group", { name: "Waypoint actions" });
    expect(
      within(group).getByRole("button", { name: "Reverse route" }),
    ).toBeInTheDocument();
  });

  it("reverses waypoint order and appends the suffix to a named draft, persisted together", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map);

    fireEvent.click(reverseRouteButton());

    expect(screen.getByDisplayValue("Evening loop (reversed)")).toBeInTheDocument();
    await advancePastDebounce();
    const saved = lastSavedDraft();
    expect(saved.routeName).toBe("Evening loop (reversed)");
    expect(saved.waypoints.map((w) => w.coordinate)).toEqual([WAYPOINT_B, WAYPOINT_A]);
  });

  it("leaves a blank route name blank after reversal", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map, { draft: buildDraftContent({ routeName: "" }) });

    fireEvent.click(reverseRouteButton());
    await advancePastDebounce();

    expect(lastSavedDraft().routeName).toBe("");
  });

  it("appends a second suffix to an already-reversed name", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map, {
      draft: buildDraftContent({ routeName: "Evening loop (reversed)" }),
    });

    fireEvent.click(reverseRouteButton());
    await advancePastDebounce();

    expect(lastSavedDraft().routeName).toBe("Evening loop (reversed) (reversed)");
  });

  it("reverses a closed-loop draft, keeping the same start/finish coordinate", async () => {
    const map = createMockMapFactory();
    const draft = buildDraftContent({
      waypoints: [
        { id: "w1", coordinate: WAYPOINT_A },
        { id: "w2", coordinate: WAYPOINT_B },
        { id: "w3", coordinate: WAYPOINT_C },
        { id: "w4", coordinate: WAYPOINT_A },
      ],
    });
    await renderWithDraft(map, { draft });

    fireEvent.click(reverseRouteButton());
    await advancePastDebounce();

    const saved = lastSavedDraft();
    expect(saved.waypoints.map((w) => w.coordinate)).toEqual([
      WAYPOINT_A,
      WAYPOINT_C,
      WAYPOINT_B,
      WAYPOINT_A,
    ]);
    expect(saved.waypoints[0]?.coordinate).toEqual(saved.waypoints.at(-1)?.coordinate);
  });

  it("clears an active waypoint selection and a pending Move/Insert-after relocation", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Start actions" })).getByRole("button", {
        name: "Move",
      }),
    );
    expect(
      within(screen.getByRole("group", { name: "Start actions" })).getByRole("button", {
        name: "Move",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(reverseRouteButton());

    // Once reversed, "Start" now refers to a different waypoint, and no
    // waypoint is selected — the relocate sub-row/toggle (and its "Move"/
    // "Insert after" buttons, unambiguous names found nowhere else) must
    // be gone.
    expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Insert after" }),
    ).not.toBeInTheDocument();
  });

  it("issues zero routing-provider requests before Calculate, even past the normal recalculation debounce", async () => {
    const map = createMockMapFactory();
    const { provider, calculateRoute } = buildControllableProvider();
    await renderWithDraft(map, { provider });

    fireEvent.click(reverseRouteButton());
    await advancePastDebounce();
    await advancePastDebounce();

    expect(calculateRoute).not.toHaveBeenCalled();
  });

  it("issues zero routing-provider requests across Undo and Redo of a reversal", async () => {
    const map = createMockMapFactory();
    const { provider, calculateRoute } = buildControllableProvider();
    await renderWithDraft(map, { provider });

    fireEvent.click(reverseRouteButton());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await advancePastDebounce();

    expect(calculateRoute).not.toHaveBeenCalled();
  });

  it("invalidates a previously calculated result and blocks Save/Export until an explicit Calculate succeeds", async () => {
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute();
    const provider: RoutingProvider = { calculateRoute: () => Promise.resolve(route) };
    await renderWithDraft(map, { provider });

    fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
    await waitUntil(
      () => screen.queryByRole("region", { name: "Route summary" }) !== null,
      "Route summary to appear",
    );
    expect(saveButton()).toBeEnabled();
    expect(exportButton()).toBeEnabled();

    fireEvent.click(reverseRouteButton());
    await flushAsync();

    expect(
      screen.queryByRole("region", { name: "Route summary" }),
    ).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(exportButton()).toBeDisabled();

    // An explicit Calculate against the reversed order routes and
    // re-enables Save/Export.
    fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
    await waitUntil(
      () => screen.queryByRole("region", { name: "Route summary" }) !== null,
      "Route summary to reappear after recalculation",
    );
    expect(saveButton()).toBeEnabled();
    expect(exportButton()).toBeEnabled();
  });

  it("an in-flight calculation result resolved after a reversal cannot reappear", async () => {
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const { provider, resolveNext } = buildControllableProvider();
    await renderWithDraft(map, { provider });

    fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
    await flushAsync();
    expect(screen.getByRole("button", { name: /calculating/i })).toBeInTheDocument();

    fireEvent.click(reverseRouteButton());
    await flushAsync();

    await act(async () => {
      resolveNext(buildRoute());
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(
      screen.queryByRole("region", { name: "Route summary" }),
    ).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("reverse then undo then redo restores waypoint order and route name atomically", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map);

    fireEvent.click(reverseRouteButton());
    expect(screen.getByDisplayValue("Evening loop (reversed)")).toBeInTheDocument();
    await advancePastDebounce();
    expect(lastSavedDraft().waypoints.map((w) => w.coordinate)).toEqual([
      WAYPOINT_B,
      WAYPOINT_A,
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByDisplayValue("Evening loop")).toBeInTheDocument();
    await advancePastDebounce();
    expect(lastSavedDraft().waypoints.map((w) => w.coordinate)).toEqual([
      WAYPOINT_A,
      WAYPOINT_B,
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByDisplayValue("Evening loop (reversed)")).toBeInTheDocument();
    await advancePastDebounce();
    expect(lastSavedDraft().routeName).toBe("Evening loop (reversed)");
    expect(lastSavedDraft().waypoints.map((w) => w.coordinate)).toEqual([
      WAYPOINT_B,
      WAYPOINT_A,
    ]);
  });

  it("an ordinary edit after reversal, followed by two undos, crosses the reversal boundary correctly", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map);

    fireEvent.click(reverseRouteButton());
    expect(screen.getByDisplayValue("Evening loop (reversed)")).toBeInTheDocument();

    map.triggerMapTap(WAYPOINT_C);
    await flushAsync();
    expect(screen.getByDisplayValue("Evening loop (reversed)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // First undo reverts only the append, keeping the reversed name.
    expect(screen.getByDisplayValue("Evening loop (reversed)")).toBeInTheDocument();
    await advancePastDebounce();
    expect(lastSavedDraft().waypoints.map((w) => w.coordinate)).toEqual([
      WAYPOINT_B,
      WAYPOINT_A,
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // Second undo crosses the reversal boundary, restoring the original
    // order and name together.
    expect(screen.getByDisplayValue("Evening loop")).toBeInTheDocument();
    await advancePastDebounce();
    expect(lastSavedDraft().waypoints.map((w) => w.coordinate)).toEqual([
      WAYPOINT_A,
      WAYPOINT_B,
    ]);
  });

  it("does not disturb editCopyMeta or the rendered notice — a freshly Edit-copied-then-reversed draft shows the unchanged forward notice", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map, {
      draft: buildDraftContent({
        editCopyWaypointsOrigin: "exact",
        editCopyOperation: "forward",
      }),
    });

    const forwardNotice =
      "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.";
    expect(screen.getByText(forwardNotice)).toBeInTheDocument();

    fireEvent.click(reverseRouteButton());
    await advancePastDebounce();

    // The notice is unchanged — it describes seed provenance, not live
    // edit history — and editCopyMeta is carried through on the autosave
    // unchanged.
    expect(screen.getByText(forwardNotice)).toBeInTheDocument();
    const saved = lastSavedDraft();
    expect(saved.editCopySourceRouteId).toBe("route-1");
    expect(saved.editCopyWaypointsOrigin).toBe("exact");
    expect(saved.editCopyOperation).toBe("forward");
  });

  it("works identically for a hand-planned draft with no editCopyMeta at all", async () => {
    const map = createMockMapFactory();
    await renderFresh(map);

    map.triggerMapTap(WAYPOINT_A);
    await flushAsync();
    map.triggerMapTap(WAYPOINT_B);
    await flushAsync();

    expect(
      screen.queryByText(/editable copy created|waypoints were estimated/i),
    ).not.toBeInTheDocument();

    fireEvent.click(reverseRouteButton());
    await advancePastDebounce();

    expect(
      screen.queryByText(/editable copy created|waypoints were estimated/i),
    ).not.toBeInTheDocument();
    const saved = lastSavedDraft();
    expect(saved.editCopySourceRouteId).toBeUndefined();
    expect(saved.waypoints.map((w) => w.coordinate)).toEqual([WAYPOINT_B, WAYPOINT_A]);
  });

  it("persists the reversed waypoints and name together, and a fresh mount restores them from storage", async () => {
    const map = createMockMapFactory();
    await renderWithDraft(map);

    fireEvent.click(reverseRouteButton());
    await advancePastDebounce();
    const saved = lastSavedDraft();
    expect(saved.routeName).toBe("Evening loop (reversed)");

    // A later mount (mirroring a reload) restores exactly what was
    // persisted, from storage alone.
    const map2 = createMockMapFactory();
    await renderWithDraft(map2, { draft: saved });
    expect(screen.getByDisplayValue("Evening loop (reversed)")).toBeInTheDocument();
  });
});
