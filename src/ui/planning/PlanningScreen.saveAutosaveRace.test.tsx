// Deliberately separate from PlanningScreen.test.tsx (real Dexie/fake-
// indexeddb, real timers) and from PlanningScreen.draftHydration.test.tsx
// (item 31's own, unrelated hydration-race coverage) — this file proves
// CLAUDE.md future-backlog item 30's Save-versus-autosave coordination: an
// explicit Save must synchronously cancel any pending draft-autosave timer
// and invalidate stale continuations, so neither can write to the singleton
// draft row after handleSave's own clearDraft() has run.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
// literal rather than importing an unexported constant, matching
// PlanningScreen.draftHydration.test.tsx's own precedent.
const DRAFT_DEBOUNCE_MS = 900;

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerMapTap: (coordinate: Coordinate) => void;
}

// A minimal local MapLibreLike stub, trimmed and duplicated from
// PlanningScreen.draftHydration.test.tsx rather than shared, per this
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
      changeZoomBy: () => undefined,
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
    id: "route-1",
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

interface ControlledPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createControlledPromise<T>(): ControlledPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /save route/i });
}

/** Renders PlanningScreen with a fresh session, places two waypoints and
 * calculates a route so routing.state.kind === "routed" and Save becomes
 * available. usePlanningRoute's calculateNow() (wired to the Calculate
 * button) runs immediately with no debounce of its own, unlike automatic
 * post-edit recalculation, so no fake-timer advancement of the routing
 * debounce is needed. RTL's findBy/waitFor is deliberately avoided here:
 * its own internal timeout is a real setTimeout, which this file's fake
 * timers (toFake: ["setTimeout", "clearTimeout"]) freeze, so a query that
 * hasn't resolved yet would hang instead of failing fast — flushAsync is
 * called repeatedly instead, mirroring PlanningScreen.draftHydration.test.tsx's
 * own established synchronous-getBy-after-flushing convention. */
async function establishRoutedPlan(
  onRouteSaved?: (route: PlannedRoute) => void,
): Promise<{ map: MockMapHandle; route: PlannedRoute; unmount: () => void }> {
  mockedGetDraft.mockResolvedValueOnce(undefined);
  mockedGetPlanningPreferences.mockResolvedValueOnce({
    avoidFerriesByDefault: true,
    profileByDefault: "cycling-road",
  });
  await saveProviderKey("dummy-test-key");
  const map = createMockMapFactory();
  const route = buildRoute();
  const provider: RoutingProvider = { calculateRoute: () => Promise.resolve(route) };

  const { unmount } = render(
    <PlanningScreen
      onNavigateToSettings={vi.fn()}
      onRouteSaved={onRouteSaved}
      mapFactory={map.factory}
      routingProvider={provider}
    />,
  );
  map.triggerLoad();
  // useLiveQuery's underlying Dexie liveQuery kicks off its first query via
  // a real setTimeout(fn, 0) — advancing fake time by exactly 0ms doesn't
  // reliably fire a same-instant timer, so flushAsync advances by 1ms
  // instead (see its own definition above). A short poll loop, rather than
  // a fixed count, absorbs any further ticks the key/preferences queries
  // need to settle.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!screen.queryByText(/Road routing requires/i)) break;
    await flushAsync();
  }

  map.triggerMapTap([0, 51]);
  map.triggerMapTap([0.01, 51]);
  await flushAsync();

  fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (screen.queryByRole("region", { name: "Route summary" })) break;
    await flushAsync();
  }
  if (!screen.queryByRole("region", { name: "Route summary" })) {
    throw new Error("Route summary never appeared after Calculate route");
  }
  return { map, route, unmount };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockedSaveDraft.mockResolvedValue(undefined);
  mockedClearDraft.mockResolvedValue(undefined);
  mockedSaveRoute.mockResolvedValue(undefined);
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PlanningScreen Save-versus-autosave coordination (backlog item 30)", () => {
  it("cancels a pending autosave timer synchronously at Save, before it can fire", async () => {
    await establishRoutedPlan();
    const { promise: saveRoutePromise } = createControlledPromise<undefined>();
    mockedSaveRoute.mockReturnValue(saveRoutePromise);

    // Re-arms the autosave timer immediately before Save is pressed.
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Renamed just before Save" },
    });
    fireEvent.click(saveButton());
    await flushAsync();

    // The pending timer is cancelled synchronously by handleSave — advancing
    // fake time past the debounce must never fire it.
    await advancePastDebounce();

    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(mockedClearDraft).not.toHaveBeenCalled();
  });

  it("writes no autosave for the whole successful Save sequence, and never resurrects the draft afterward", async () => {
    const onRouteSaved = vi.fn();
    await establishRoutedPlan(onRouteSaved);
    const { promise: clearPromise, resolve: resolveClear } =
      createControlledPromise<undefined>();
    mockedClearDraft.mockReturnValue(clearPromise);

    fireEvent.click(saveButton());
    await flushAsync();
    expect(mockedSaveRoute).toHaveBeenCalledTimes(1);
    expect(mockedClearDraft).toHaveBeenCalledTimes(1);

    // clearDraft() is still pending — advance well past the debounce and
    // confirm the (isSaving-gated) autosave effect never wrote in the
    // meantime.
    await advancePastDebounce();
    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(onRouteSaved).not.toHaveBeenCalled();

    await act(async () => {
      resolveClear(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRouteSaved).toHaveBeenCalledTimes(1);
    expect(mockedClearDraft).toHaveBeenCalledTimes(1);

    // The post-reset autosave (state.present is now []) is a harmless,
    // idempotent re-clear — never a recreation with the stale, pre-save
    // waypoints.
    await advancePastDebounce();
    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(mockedClearDraft).toHaveBeenCalledTimes(2);
  });

  it("issues exactly one saveRoute/clearDraft pair for a rapid double Save click", async () => {
    await establishRoutedPlan();
    const { promise: saveRoutePromise, resolve: resolveSave } =
      createControlledPromise<undefined>();
    mockedSaveRoute.mockReturnValue(saveRoutePromise);

    // A single button reference, clicked repeatedly — re-querying by role
    // between clicks wouldn't reflect a real rapid double-tap, and the
    // button's own accessible name changes to "Saving…" after the first
    // click lands anyway.
    const button = saveButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockedSaveRoute).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(mockedSaveRoute).toHaveBeenCalledTimes(1);
    expect(mockedClearDraft).toHaveBeenCalledTimes(1);
  });

  it("shows Saving… and disables the button while a save is in flight, then restores it", async () => {
    await establishRoutedPlan();
    const { promise: saveRoutePromise, resolve: resolveSave } =
      createControlledPromise<undefined>();
    mockedSaveRoute.mockReturnValue(saveRoutePromise);

    fireEvent.click(saveButton());
    await flushAsync();

    const inFlightButton = screen.getByRole("button", { name: "Saving…" });
    expect(inFlightButton).toBeDisabled();

    await act(async () => {
      resolveSave(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save route" })).toBeInTheDocument();
  });

  it("resumes autosave with the current in-memory plan after saveRoute rejects", async () => {
    await establishRoutedPlan();
    mockedSaveRoute.mockRejectedValueOnce(new Error("boom"));
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Still unsaved" },
    });

    fireEvent.click(saveButton());
    await flushAsync();

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/i);
    expect(saveButton()).toBeEnabled();
    expect(screen.getByDisplayValue("Still unsaved")).toBeInTheDocument();
    expect(mockedSaveDraft).not.toHaveBeenCalled();

    await advancePastDebounce();

    expect(mockedSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockedSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ routeName: "Still unsaved" }),
    );
  });

  it("resumes autosave after saveRoute succeeds but the explicit clearDraft rejects, without a cross-store rollback", async () => {
    await establishRoutedPlan();
    mockedClearDraft.mockRejectedValueOnce(new Error("boom"));
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Route saved, draft clear failed" },
    });

    fireEvent.click(saveButton());
    await flushAsync();

    // The route was already written to the routes store; this slice does
    // not attempt a cross-store rollback of that already-completed write —
    // only the draft-clear step failed, and normal autosave resumes
    // protecting the still-open (unreset) plan.
    expect(mockedSaveRoute).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/i);
    expect(saveButton()).toBeEnabled();
    expect(
      screen.getByDisplayValue("Route saved, draft clear failed"),
    ).toBeInTheDocument();

    await advancePastDebounce();

    expect(mockedSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockedSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ routeName: "Route saved, draft clear failed" }),
    );
  });

  it("discards a Save attempt's continuation that resolves after unmount", async () => {
    const onRouteSaved = vi.fn();
    const { unmount } = await establishRoutedPlan(onRouteSaved);
    const { promise: saveRoutePromise, resolve: resolveSave } =
      createControlledPromise<undefined>();
    mockedSaveRoute.mockReturnValue(saveRoutePromise);

    fireEvent.click(saveButton());
    await flushAsync();
    unmount();

    await act(async () => {
      resolveSave(undefined);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await advancePastDebounce();

    expect(onRouteSaved).not.toHaveBeenCalled();
  });

  it("never fires a pending autosave timer after unmount", async () => {
    const { unmount } = await establishRoutedPlan();
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Edited then unmounted" },
    });
    unmount();

    await advancePastDebounce();

    expect(mockedSaveDraft).not.toHaveBeenCalled();
  });

  it("still autosaves a normal post-hydration edit once after the debounce (ordinary autosave unchanged)", async () => {
    await establishRoutedPlan();
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Ordinary edit" },
    });

    await advancePastDebounce();

    expect(mockedSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockedSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ routeName: "Ordinary edit" }),
    );
  });

  it("still blocks autosave while draft hydration has not completed (item 31 invariant, unmodified)", async () => {
    const { promise } = createControlledPromise<PlanningDraftContent | undefined>();
    mockedGetDraft.mockReturnValue(promise);
    const map = createMockMapFactory();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={{ calculateRoute: () => Promise.reject(new Error("unused")) }}
      />,
    );
    map.triggerLoad();

    await advancePastDebounce();

    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(mockedClearDraft).not.toHaveBeenCalled();
  });
});
