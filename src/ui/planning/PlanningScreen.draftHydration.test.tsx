// Deliberately separate from PlanningScreen.test.tsx, which never mocks the
// draft repository and never uses fake timers (it exercises the real
// Dexie/fake-indexeddb stack plus real-time waitFor polling). This file
// needs manually-controlled promises and fake timers to hold a draft read
// open indefinitely and assert no premature write occurs — see CLAUDE.md's
// "Planning draft hydration/autosave race" entry for the invariant this
// proves.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlanningScreen } from "./PlanningScreen.tsx";
import type { Coordinate } from "../../domain/types.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import { computeBoundingBox } from "../../map/routeLayer.ts";
import { db } from "../../storage/db.ts";
import type { PlanningDraftContent } from "../../storage/mapping.ts";
import type { RoutingProvider } from "../../routing/provider.ts";

vi.mock("../../storage/planningDraftRepository.ts", () => ({
  getDraft: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
}));
vi.mock("../../storage/planningPreferencesRepository.ts", () => ({
  getPlanningPreferences: vi.fn(),
}));

import {
  clearDraft,
  getDraft,
  saveDraft,
} from "../../storage/planningDraftRepository.ts";
import { getPlanningPreferences } from "../../storage/planningPreferencesRepository.ts";

const mockedGetDraft = vi.mocked(getDraft);
const mockedSaveDraft = vi.mocked(saveDraft);
const mockedClearDraft = vi.mocked(clearDraft);
const mockedGetPlanningPreferences = vi.mocked(getPlanningPreferences);

// Mirrors PlanningScreen.tsx's own DRAFT_DEBOUNCE_MS — kept as a local
// literal rather than importing an unexported constant.
const DRAFT_DEBOUNCE_MS = 900;

function createStubRoutingProvider(): {
  provider: RoutingProvider;
  calculateRouteSpy: ReturnType<typeof vi.fn>;
} {
  const calculateRouteSpy = vi.fn(() =>
    Promise.reject(new Error("routing must not be requested by hydration tests")),
  );
  return { provider: { calculateRoute: calculateRouteSpy }, calculateRouteSpy };
}

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerMapTap: (coordinate: Coordinate) => void;
  fitBoundsSpy: ReturnType<typeof vi.fn>;
}

// A minimal local MapLibreLike stub, trimmed from PlanningScreen.test.tsx's
// own createMockMapFactory (kept local/duplicated rather than shared, to
// keep this file's diff strictly additive) — only load, a bare map tap and
// (for the restored/seeded-waypoint camera fit) fitBounds matter for
// hydration tests, so every hit-testing method is fixed to "always miss"
// rather than configurable.
function createMockMapFactory(): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let mapTapListener: ((coordinate: Coordinate) => void) | undefined;
  const sources = new Map<string, GeoJSON.FeatureCollection>();
  const fitBoundsSpy = vi.fn();

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
      fitBounds: fitBoundsSpy,
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
    fitBoundsSpy,
  };
}

function buildDraftContent(
  overrides: Partial<PlanningDraftContent> = {},
): PlanningDraftContent {
  return {
    waypoints: [
      { id: "wp-a", coordinate: [1, 51] },
      { id: "wp-b", coordinate: [2, 52] },
    ],
    routeName: "Distinctive stored route",
    avoidFerries: false,
    profile: "cycling-regular",
    ...overrides,
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
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advancePastDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 50);
  });
}

function renderPlanningScreen(map: MockMapHandle, provider: RoutingProvider) {
  return render(
    <PlanningScreen
      onNavigateToSettings={vi.fn()}
      mapFactory={map.factory}
      routingProvider={provider}
    />,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockedSaveDraft.mockResolvedValue(undefined);
  mockedClearDraft.mockResolvedValue(undefined);
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PlanningScreen draft hydration lifecycle", () => {
  it("does not write while an existing-draft read is pending, and restores every field once it resolves", async () => {
    const { promise, resolve } = createControlledPromise<
      PlanningDraftContent | undefined
    >();
    mockedGetDraft.mockReturnValue(promise);
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();

    await advancePastDebounce();
    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(mockedClearDraft).not.toHaveBeenCalled();

    await act(async () => {
      resolve(buildDraftContent());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByDisplayValue("Distinctive stored route")).toBeInTheDocument();
    expect(
      screen.getByText(/Routing: General cycling · Ferries allowed/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Change"));
    expect(screen.getByRole("button", { name: "General cycling" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("applies genuinely-fresh defaults exactly once, then autosaves a subsequent edit normally", async () => {
    mockedGetDraft.mockResolvedValueOnce(undefined);
    mockedGetPlanningPreferences.mockResolvedValueOnce({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-regular",
    });
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    await flushAsync();

    expect(
      screen.getByText(/Routing: General cycling · Ferries allowed/),
    ).toBeInTheDocument();
    expect(mockedSaveDraft).not.toHaveBeenCalled();
    // A genuinely fresh, empty draft has nothing to fit — the regional
    // geolocation fit is a separate, unrelated mechanism (see
    // PlanningScreen.test.tsx) and this test never mocks geolocation, so
    // getApproximateLocationOnce resolves null in jsdom regardless.
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();

    map.triggerMapTap([10, 50]);
    await advancePastDebounce();

    expect(mockedSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockedSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        waypoints: [expect.objectContaining({ coordinate: [10, 50] })],
        avoidFerries: false,
        profile: "cycling-regular",
      }),
    );
    // Placing the very first waypoint manually in a fresh session must
    // never trigger the restored/seeded-waypoint hydration fit either.
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();
  });

  it("survives a delayed hydration read for an editable-copy draft with zero premature writes", async () => {
    const { promise, resolve } = createControlledPromise<
      PlanningDraftContent | undefined
    >();
    mockedGetDraft.mockReturnValue(promise);
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();

    await advancePastDebounce();
    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(mockedClearDraft).not.toHaveBeenCalled();

    await act(async () => {
      resolve(
        buildDraftContent({
          routeName: "Evening loop",
          editCopySourceRouteId: "route-123",
          editCopyWaypointsOrigin: "exact",
          editCopyOperation: "forward",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByDisplayValue("Evening loop")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
      ),
    ).toBeInTheDocument();
  });

  it("survives a delayed hydration read for a reversed-copy draft with zero premature writes and zero routing requests", async () => {
    const { promise, resolve } = createControlledPromise<
      PlanningDraftContent | undefined
    >();
    mockedGetDraft.mockReturnValue(promise);
    const map = createMockMapFactory();
    const { provider, calculateRouteSpy } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();

    await advancePastDebounce();
    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(mockedClearDraft).not.toHaveBeenCalled();

    await act(async () => {
      resolve(
        buildDraftContent({
          routeName: "Evening loop (reversed)",
          editCopySourceRouteId: "route-123",
          editCopyWaypointsOrigin: "derived",
          editCopyOperation: "reverse",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByDisplayValue("Evening loop (reversed)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Reversed waypoints were estimated from this route. Recalculation may follow different roads, especially around one-way restrictions. The saved route remains unchanged.",
      ),
    ).toBeInTheDocument();
    expect(calculateRouteSpy).not.toHaveBeenCalled();
  });

  it("blocks autosave and shows an accessible failure state when the draft read fails; retry recovers and frames the restored waypoints exactly once", async () => {
    mockedGetDraft.mockRejectedValueOnce(new Error("boom"));
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    await flushAsync();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/could not be loaded/i);

    await advancePastDebounce();
    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(mockedClearDraft).not.toHaveBeenCalled();
    // The failed first attempt never reached a restore, so it can never
    // have framed anything — and, since a rejected promise can never also
    // later resolve, this failed attempt's own generation is permanently
    // dead and can contribute no later, stale fit either.
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();

    const recoveredDraft = buildDraftContent({ routeName: "Recovered route" });
    mockedGetDraft.mockResolvedValueOnce(recoveredDraft);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flushAsync();

    expect(screen.getByDisplayValue("Recovered route")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // A failed first read followed by one successful retry frames the
    // restored waypoints exactly once.
    expect(map.fitBoundsSpy).toHaveBeenCalledTimes(1);
    expect(map.fitBoundsSpy).toHaveBeenCalledWith(
      computeBoundingBox(recoveredDraft.waypoints.map((waypoint) => waypoint.coordinate)),
    );
  });

  it("discards a hydration result that resolves after the component has unmounted", async () => {
    const { promise, resolve } = createControlledPromise<
      PlanningDraftContent | undefined
    >();
    mockedGetDraft.mockReturnValue(promise);
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    const { unmount } = renderPlanningScreen(map, provider);
    map.triggerLoad();
    unmount();

    await act(async () => {
      resolve(buildDraftContent());
      await Promise.resolve();
      await Promise.resolve();
    });
    await advancePastDebounce();

    expect(mockedSaveDraft).not.toHaveBeenCalled();
    expect(mockedClearDraft).not.toHaveBeenCalled();
    // A stale/superseded result — here, one resolving after unmount —
    // never applies the restored-waypoint camera fit either, via the same
    // generation guard that already blocks the draft-field restore above.
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();
  });

  it("keeps a rider's own edit rather than losing it to a later-resolving restore", async () => {
    const { promise, resolve } = createControlledPromise<
      PlanningDraftContent | undefined
    >();
    mockedGetDraft.mockReturnValue(promise);
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    map.triggerMapTap([7, 57]);

    await act(async () => {
      resolve(buildDraftContent({ routeName: "Should never appear" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByDisplayValue("Should never appear")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Planned route")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    // The rider's own edit wins: the discarded stored waypoints must never
    // be framed, and the rider's own camera (at whatever position they
    // used to place their own waypoint) must be left alone.
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();

    await advancePastDebounce();

    expect(mockedSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockedSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        waypoints: [expect.objectContaining({ coordinate: [7, 57] })],
      }),
    );
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();
  });

  it("blocks the entire restore, not just avoidFerries, when only the ferries checkbox is edited before a slow restore resolves", async () => {
    const { promise, resolve } = createControlledPromise<
      PlanningDraftContent | undefined
    >();
    mockedGetDraft.mockReturnValue(promise);
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    fireEvent.click(screen.getByText("Change"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Avoid ferries for this draft" }),
    );

    await act(async () => {
      resolve(buildDraftContent({ routeName: "Should never appear" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The atomic restore guard covers all four fields — touching only
    // avoidFerries must still block the whole restore, not merely skip
    // re-applying avoidFerries while still restoring waypoints/routeName.
    expect(screen.queryByDisplayValue("Should never appear")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Planned route")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();
  });

  it("applies the Settings avoid-ferries default even when a waypoint edit lands before the fresh-session preferences read resolves", async () => {
    mockedGetDraft.mockResolvedValueOnce(undefined);
    const { promise: preferencesPromise, resolve: resolvePreferences } =
      createControlledPromise<{
        avoidFerriesByDefault: boolean;
        profileByDefault: "cycling-road" | "cycling-regular";
      }>();
    mockedGetPlanningPreferences.mockReturnValue(preferencesPromise);
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    // Lands before getDraft()'s own promise has even had a chance to
    // settle — the strongest form of "races the fresh-session read".
    map.triggerMapTap([3, 53]);

    await act(async () => {
      resolvePreferences({
        avoidFerriesByDefault: false,
        profileByDefault: "cycling-regular",
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both untouched Settings defaults still seed, since a waypoint edit
    // never gates the fresh-session branch's profile/avoidFerries checks.
    expect(
      screen.getByText(/Routing: General cycling · Ferries allowed/),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    // The waypoint placed before hydration finished must never be framed —
    // this is a genuinely fresh session (no draft), so no restore ever
    // happens, and the rider's own manually-placed first waypoint always
    // retains whatever camera they used to place it.
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();
  });

  it("editing only the current-draft profile before the fresh-session preferences read resolves still lets the untouched ferry default seed", async () => {
    mockedGetDraft.mockResolvedValueOnce(undefined);
    const { promise: preferencesPromise, resolve: resolvePreferences } =
      createControlledPromise<{
        avoidFerriesByDefault: boolean;
        profileByDefault: "cycling-road" | "cycling-regular";
      }>();
    mockedGetPlanningPreferences.mockReturnValue(preferencesPromise);
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    fireEvent.click(screen.getByText("Change"));
    fireEvent.click(screen.getByRole("button", { name: "General cycling" }));

    await act(async () => {
      resolvePreferences({
        avoidFerriesByDefault: false,
        profileByDefault: "cycling-road",
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The rider's own profile choice (General cycling) survives, but the
    // untouched ferry default (allowed) still seeds from the resolved
    // preferences.
    expect(
      screen.getByText(/Routing: General cycling · Ferries allowed/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General cycling" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("editing only the current-draft ferries checkbox before the fresh-session preferences read resolves still lets the untouched profile default seed", async () => {
    mockedGetDraft.mockResolvedValueOnce(undefined);
    const { promise: preferencesPromise, resolve: resolvePreferences } =
      createControlledPromise<{
        avoidFerriesByDefault: boolean;
        profileByDefault: "cycling-road" | "cycling-regular";
      }>();
    mockedGetPlanningPreferences.mockReturnValue(preferencesPromise);
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    fireEvent.click(screen.getByText("Change"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Avoid ferries for this draft" }),
    );

    await act(async () => {
      resolvePreferences({
        avoidFerriesByDefault: true,
        profileByDefault: "cycling-regular",
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The rider's own ferries choice (unchecked -> allowed) survives, but
    // the untouched profile default (General cycling) still seeds from the
    // resolved preferences.
    expect(
      screen.getByText(/Routing: General cycling · Ferries allowed/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Avoid ferries for this draft" }),
    ).not.toBeChecked();
  });

  it("a getPlanningPreferences rejection on a fresh session leaves profile/avoidFerries at their safe fallback values and still reaches ready", async () => {
    mockedGetDraft.mockResolvedValueOnce(undefined);
    mockedGetPlanningPreferences.mockRejectedValueOnce(new Error("boom"));
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    await flushAsync();

    // Safe fallbacks: Road bike, ferries avoided — the same values the
    // useState initial defaults, and the Settings default itself, already
    // resolve to when nothing has been saved.
    expect(screen.getByText(/Routing: Road bike · Ferries avoided/)).toBeInTheDocument();

    // hydrationStatus still reaches "ready" — autosave is unblocked.
    map.triggerMapTap([15, 55]);
    await advancePastDebounce();
    expect(mockedSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("continues to debounce-save normal edits after hydration completes", async () => {
    mockedGetDraft.mockResolvedValueOnce(undefined);
    mockedGetPlanningPreferences.mockResolvedValueOnce({
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-road",
    });
    const map = createMockMapFactory();
    const { provider } = createStubRoutingProvider();

    renderPlanningScreen(map, provider);
    map.triggerLoad();
    await flushAsync();

    map.triggerMapTap([20, 60]);
    await advancePastDebounce();

    expect(mockedSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockedSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        waypoints: [expect.objectContaining({ coordinate: [20, 60] })],
      }),
    );
  });
});
