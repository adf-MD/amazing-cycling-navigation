// Deliberately separate from PlanningScreen.test.tsx (real Dexie/fake-
// indexeddb, real timers), PlanningScreen.draftHydration.test.tsx (item
// 31's own hydration-race coverage) and PlanningScreen.saveAutosaveRace.test.tsx
// (item 30's own Save-versus-autosave coverage) — this file proves CLAUDE.md
// future-backlog item 37's own Clear draft contract: a destructive,
// confirmed action that wipes the entire mutable Planning draft (waypoints,
// history, routed/stale result, name, edit-copy/reversal provenance,
// selection state) back to a genuinely fresh session, sequenced against the
// same save/autosave races items 30/31 already hardened, using the
// mocked-repository/fake-timer/controlled-promise harness those two sibling
// files already established.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PlanningScreen } from "./PlanningScreen.tsx";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import type { MapTapInput } from "../../map/mapTapInput.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { RoutingProvider } from "../../routing/provider.ts";
import { db } from "../../storage/db.ts";
import type { PlanningDraftContent } from "../../storage/mapping.ts";
import { saveProviderKey } from "../../storage/providerKeyRepository.ts";
import * as guardModule from "../shared/operationInteractionGuard.ts";

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
// literal rather than importing an unexported constant, matching this
// project's own established sibling-file precedent.
const DRAFT_DEBOUNCE_MS = 900;

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerMapTap: (coordinate: Coordinate, input?: MapTapInput) => void;
  fitBoundsSpy: ReturnType<typeof vi.fn>;
}

// A minimal local MapLibreLike stub, duplicated rather than shared per this
// project's established no-shared-test-helpers-across-files convention —
// only load, a bare map tap, and (for the camera-re-eligibility test)
// fitBounds matter here.
function createMockMapFactory(): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let mapTapListener: ((coordinate: Coordinate, input: MapTapInput) => void) | undefined;
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
    triggerMapTap: (coordinate, input = "mouse") => {
      act(() => {
        mapTapListener?.(coordinate, input);
      });
    },
    fitBoundsSpy,
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

/** A restored/seeded draft with every distinguishing field populated —
 * waypoints, a custom name, a non-default profile/ferries combination, and
 * edit-copy provenance — so a successful Clear draft's own reset of each
 * field is independently provable, not merely coincidental. */
function buildMeaningfulDraftContent(
  overrides: Partial<PlanningDraftContent> = {},
): PlanningDraftContent {
  return {
    waypoints: [
      { id: "wp-a", coordinate: [1, 51] },
      { id: "wp-b", coordinate: [1.02, 51.01] },
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

/** A RoutingProvider whose single calculateRoute() call stays pending until
 * resolveNext is invoked — for proving a late provider response cannot
 * restore state after Clear draft has already reset it. */
function buildControllableProvider(): {
  provider: RoutingProvider;
  resolveNext: (route: PlannedRoute) => void;
} {
  let pendingResolve: ((route: PlannedRoute) => void) | undefined;
  const provider: RoutingProvider = {
    calculateRoute: () =>
      new Promise<PlannedRoute>((resolve) => {
        pendingResolve = resolve;
      }),
  };
  return {
    provider,
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

function clearDraftTriggerButton(): HTMLElement {
  return screen.getByRole("button", { name: /^clear draft$/i });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /^save route$/i });
}

/** Renders PlanningScreen with a restored, meaningful draft already
 * seeded via getDraft() — the restore branch never calls
 * getPlanningPreferences() itself, so that mock is left free for
 * handleClearDraftConfirm's own call. */
async function renderWithMeaningfulDraft(
  map: MockMapHandle,
  options: {
    draft?: PlanningDraftContent;
    provider?: RoutingProvider;
    requestApproximateLocation?: () => Promise<Coordinate | null>;
  } = {},
): Promise<ReturnType<typeof render>> {
  const draft = options.draft ?? buildMeaningfulDraftContent();
  mockedGetDraft.mockResolvedValueOnce(draft);
  const provider =
    options.provider ??
    ({ calculateRoute: () => Promise.reject(new Error("unused")) } as const);
  const rendered = render(
    <PlanningScreen
      onNavigateToSettings={vi.fn()}
      mapFactory={map.factory}
      routingProvider={provider}
      requestApproximateLocation={options.requestApproximateLocation}
    />,
  );
  map.triggerLoad();
  await waitUntil(
    () => screen.queryByDisplayValue(draft.routeName) !== null,
    `restored draft "${draft.routeName}" to hydrate`,
  );
  return rendered;
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

describe("PlanningScreen Clear draft (backlog item 37)", () => {
  it("opens the confirmation with the exact required copy, focused on Cancel", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map);

    fireEvent.click(clearDraftTriggerButton());

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Clear this draft?");
    expect(dialog).toHaveTextContent(
      "This removes all waypoints, the calculated route and other unsaved draft details. Saved routes are not affected.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Clear draft" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("Cancel preserves the draft exactly, issues no storage call, and restores focus to the trigger", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map);

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The trigger genuinely unmounts while the dialog is open (backlog
    // item 49's in-place morph), so the button re-queried here is a
    // freshly remounted DOM node, not the one captured before the click.
    expect(clearDraftTriggerButton()).toHaveFocus();
    expect(mockedClearDraft).not.toHaveBeenCalled();
    expect(mockedGetPlanningPreferences).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Evening loop")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
      ),
    ).toBeInTheDocument();
  });

  it("Escape preserves the draft exactly and issues no storage call", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map);

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedClearDraft).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Evening loop")).toBeInTheDocument();
  });

  it("successfully clears a populated, calculated, edit-copy-provenanced draft to a genuinely fresh session using the current Settings defaults", async () => {
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute();
    const provider: RoutingProvider = { calculateRoute: () => Promise.resolve(route) };
    await renderWithMeaningfulDraft(map, { provider });

    // Build up genuine undo/redo history and a calculated route, so their
    // reset is meaningfully proved rather than vacuously already-empty.
    fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
    await waitUntil(
      () => screen.queryByRole("region", { name: "Route summary" }) !== null,
      "Route summary to appear",
    );
    map.triggerMapTap([1.05, 51.02]);
    await flushAsync();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    // Genuinely click the routing controls (not merely seed the mock draft
    // with a non-default profile) — this is what actually marks
    // hasUserModifiedDraftFieldsRef.current.profile/avoidFerries true via
    // noteHydrationOverriddenByUserEdit, the exact real-UI path that once
    // silently skipped Clear draft's own reseed-from-Settings-defaults
    // logic when it was (incorrectly) gated on the same, never-reset ref.
    fireEvent.click(screen.getByText("Change", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "General cycling" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Avoid ferries for this draft" }),
    );

    // The fresh session's profile/ferries must come from THIS call, not
    // from the cleared draft's own now-customised values, and not from a
    // hardcoded fallback that would coincidentally match either.
    mockedGetPlanningPreferences.mockResolvedValueOnce({
      profileByDefault: "cycling-road",
      avoidFerriesByDefault: true,
    });

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));

    await waitUntil(
      () => screen.queryByDisplayValue("Planned route") !== null,
      "route name to reset to Planned route",
    );

    expect(mockedClearDraft).toHaveBeenCalledTimes(1);
    expect(mockedGetPlanningPreferences).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/no waypoints yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(
      screen.queryByRole("region", { name: "Route summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
      ),
    ).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    // The "Change" disclosure is a plain, uncontrolled native <details>
    // element that was already opened above and stays open across Clear
    // draft's own state reset, since it is never unmounted — clicking it
    // again here would toggle it closed instead.
    expect(screen.getByRole("button", { name: "Road bike" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "Avoid ferries for this draft" }),
    ).toBeChecked();
  });

  it("falls back to safe hardcoded defaults, without surfacing an error, when the Settings-preferences read fails", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map);
    mockedGetPlanningPreferences.mockRejectedValueOnce(new Error("boom"));

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));

    await waitUntil(
      () => screen.queryByDisplayValue("Planned route") !== null,
      "route name to reset despite the preferences read failing",
    );

    expect(mockedClearDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/no waypoints yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Change", { exact: true }));
    expect(screen.getByRole("button", { name: "Road bike" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "Avoid ferries for this draft" }),
    ).toBeChecked();
  });

  it("a clearDraft() rejection preserves the exact draft, shows an accessible error, and permits retry with focus restored", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map);
    mockedClearDraft.mockRejectedValueOnce(new Error("boom"));

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));

    await waitUntil(
      () => screen.queryByRole("alert") !== null,
      "an accessible error after the rejected clear",
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The draft could not be cleared on this device. Try again.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Nothing was touched: the draft is exactly as it was.
    expect(screen.getByDisplayValue("Evening loop")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
      ),
    ).toBeInTheDocument();
    // A failed clear closes the dialog and remounts the trigger (backlog
    // item 49) — re-query it, then confirm focus only lands once it is
    // genuinely re-enabled, i.e. the DOM has committed isClearing back
    // to false by the time the focus-restoration effect runs.
    const triggerAfterFailure = clearDraftTriggerButton();
    expect(triggerAfterFailure).not.toBeDisabled();
    expect(triggerAfterFailure).toHaveFocus();

    // Retry succeeds.
    fireEvent.click(triggerAfterFailure);
    const retryDialog = screen.getByRole("dialog");
    fireEvent.click(within(retryDialog).getByRole("button", { name: "Clear draft" }));
    await waitUntil(
      () => screen.queryByDisplayValue("Planned route") !== null,
      "the retried clear to succeed",
    );
    expect(mockedClearDraft).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("issues exactly one clearDraft() call for a rapid double confirm", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map);
    const { promise, resolve } = createControlledPromise<undefined>();
    mockedClearDraft.mockReturnValue(promise);

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Clear draft" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(mockedClearDraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(mockedClearDraft).toHaveBeenCalledTimes(1);
  });

  it("Save and Clear draft are mutually exclusive: Save in flight blocks Clear, and vice versa is unreachable via a disabled trigger", async () => {
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute();
    const provider: RoutingProvider = { calculateRoute: () => Promise.resolve(route) };
    await renderWithMeaningfulDraft(map, { provider });

    fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
    await waitUntil(
      () => screen.queryByRole("region", { name: "Route summary" }) !== null,
      "Route summary to appear",
    );

    const { promise: saveRoutePromise, resolve: resolveSave } =
      createControlledPromise<undefined>();
    mockedSaveRoute.mockReturnValue(saveRoutePromise);

    fireEvent.click(saveButton());
    await flushAsync();

    expect(clearDraftTriggerButton()).toBeDisabled();
    // Defence in depth: even a click that somehow reached the handler
    // (e.g. a future regression removing the disabled attribute) must
    // still be rejected by the synchronous isSavingRef guard.
    fireEvent.click(clearDraftTriggerButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      resolveSave(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(clearDraftTriggerButton()).toBeEnabled();
  });

  it("cancels a pending autosave timer synchronously at Clear, so it cannot fire and resurrect the row", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map);

    // A route-name edit re-arms the autosave timer immediately before
    // Clear draft is pressed.
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Renamed just before Clear" },
    });

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));
    await waitUntil(
      () => screen.queryByDisplayValue("Planned route") !== null,
      "the clear to succeed",
    );

    // The pending autosave timer was cancelled synchronously by Clear —
    // advancing fake time past the debounce must never fire it with the
    // stale, pre-clear route name.
    await advancePastDebounce();
    expect(mockedSaveDraft).not.toHaveBeenCalled();
    // The post-clear autosave (state.present is now []) is a harmless,
    // idempotent re-clear.
    expect(mockedClearDraft).toHaveBeenCalledTimes(2);
  });

  it("a delayed original hydration read cannot resurrect old content after Clear draft has already run", async () => {
    const { promise, resolve } = createControlledPromise<
      PlanningDraftContent | undefined
    >();
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
    await flushAsync();

    // Hydration is still "loading" — nothing has been applied yet, but
    // Clear draft is still reachable and still does real, protective work.
    expect(screen.getByText(/loading your draft/i)).toBeInTheDocument();

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));
    await waitUntil(
      () => screen.queryByDisplayValue("Planned route") !== null,
      "Clear draft to succeed even while the original hydration read is still pending",
    );
    expect(mockedClearDraft).toHaveBeenCalledTimes(1);

    // The original mount-time getDraft() read finally resolves, with old,
    // pre-clear-looking content — must never be applied, since Clear
    // draft's own dispatchWaypointAction already marked
    // hasUserModifiedDraftFieldsRef.waypoints, which the restore branch's
    // existing atomic gate checks.
    await act(async () => {
      resolve(buildMeaningfulDraftContent({ routeName: "Stale pre-clear route" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(screen.queryByDisplayValue("Stale pre-clear route")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Planned route")).toBeInTheDocument();
    expect(screen.getByText(/no waypoints yet/i)).toBeInTheDocument();
  });

  it("a delayed routing-provider result cannot restore the old route after Clear draft has already run", async () => {
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const { provider, resolveNext } = buildControllableProvider();
    await renderWithMeaningfulDraft(map, { provider });

    fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
    await flushAsync();
    expect(screen.getByRole("button", { name: /calculating/i })).toBeInTheDocument();

    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));
    await waitUntil(
      () => screen.queryByDisplayValue("Planned route") !== null,
      "Clear draft to succeed while a calculation is still in flight",
    );
    expect(screen.getByRole("button", { name: /calculate route/i })).toBeInTheDocument();

    // The stale in-flight provider response finally resolves — must not
    // revive the routed result for an already-cleared draft.
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

  it("makes the fresh-session regional camera fit eligible again exactly once, not repeatedly during later editing", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map, {
      requestApproximateLocation: () => Promise.resolve([2, 53] as Coordinate),
    });

    // The restored waypoint set's own one-time hydration fit.
    await waitUntil(
      () => map.fitBoundsSpy.mock.calls.length >= 1,
      "the initial waypoint fit",
    );
    expect(map.fitBoundsSpy).toHaveBeenCalledTimes(1);

    mockedGetPlanningPreferences.mockResolvedValueOnce({
      profileByDefault: "cycling-road",
      avoidFerriesByDefault: true,
    });
    fireEvent.click(clearDraftTriggerButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));
    await waitUntil(
      () => screen.queryByDisplayValue("Planned route") !== null,
      "the clear to succeed",
    );

    // Re-eligible exactly once: the fresh-session geolocation fit fires.
    await waitUntil(
      () => map.fitBoundsSpy.mock.calls.length >= 2,
      "the post-clear fresh-session fit",
    );
    expect(map.fitBoundsSpy).toHaveBeenCalledTimes(2);

    // An ordinary later edit must not trigger a further fit.
    map.triggerMapTap([2.01, 53.01]);
    await flushAsync();
    expect(map.fitBoundsSpy).toHaveBeenCalledTimes(2);
  });

  it("uses draft terminology, not plan, in the hydration loading/failure states", async () => {
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
    await flushAsync();
    expect(screen.getByText("Loading your draft…")).toBeInTheDocument();

    mockedGetDraft.mockRejectedValueOnce(new Error("boom"));
    const map2 = createMockMapFactory();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map2.factory}
        routingProvider={{ calculateRoute: () => Promise.reject(new Error("unused")) }}
      />,
    );
    map2.triggerLoad();
    await flushAsync();
    expect(
      screen.getByText(
        "Your saved draft could not be loaded. Nothing in storage has been changed.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the confirmation in the trigger's own action-card slot, replacing it in place (backlog item 49)", async () => {
    const map = createMockMapFactory();
    await renderWithMeaningfulDraft(map);

    // Anchor on the "Change" disclosure itself via its visible text, not
    // a CSS class — the trigger's slot is the very next sibling of it,
    // both closed and open. A post-deployment item 48 follow-up removed
    // the single-child wrapper <div> this test previously traversed
    // through (changeDetails.parentElement) — the disclosure is now a
    // direct child of the action card, so this is a strictly simpler,
    // equally-precise expression of the same "renders immediately after
    // the routing disclosure" fact.
    const changeDetails = screen.getByText("Change", { exact: true }).closest("details");
    if (!changeDetails)
      throw new Error("expected the Change disclosure to have a details ancestor");

    function clearDraftSlot(afterElement: HTMLElement): HTMLElement {
      const slot = afterElement.nextElementSibling;
      if (!(slot instanceof HTMLElement)) {
        throw new Error("expected the routing disclosure to have a next sibling");
      }
      return slot;
    }

    expect(
      within(clearDraftSlot(changeDetails)).getByRole("button", {
        name: "Clear draft",
      }),
    ).toBeInTheDocument();

    fireEvent.click(clearDraftTriggerButton());

    // Open: the confirmation occupies the exact same slot — nothing else
    // was inserted between the routing disclosure and it, and the only
    // "Clear draft"-named button left anywhere is the dialog's own
    // confirm button — the trigger itself is gone, not merely duplicated.
    const dialog = screen.getByRole("dialog");
    expect(changeDetails.nextElementSibling).toBe(dialog);
    expect(screen.getAllByRole("button", { name: "Clear draft" })).toEqual([
      within(dialog).getByRole("button", { name: "Clear draft" }),
    ]);

    // The rest of the action card stays rendered and visible.
    expect(screen.getByRole("group", { name: "Waypoint actions" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /calculate route|try again|calculating/i }),
    ).toBeInTheDocument();
    expect(
      within(changeDetails).getByText("Change", { exact: true }),
    ).toBeInTheDocument();

    // Cancel: the trigger reappears in the same slot, focused.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      within(clearDraftSlot(changeDetails)).getByRole("button", {
        name: "Clear draft",
      }),
    ).toBeInTheDocument();
    expect(clearDraftTriggerButton()).toHaveFocus();
  });
});

// Backlog item 124, slice 1: the Clear-draft confirmation's reveal on
// opening and its focus return on Cancel/Escape. jsdom has no layout, so
// geometry is stubbed per element exactly as SettingsScreen.test.tsx's
// item 118 reveal tests do; real-browser geometry is proved in
// e2e/confirmationReveal.smoke.spec.ts.
describe("PlanningScreen Clear draft reveal and focus return (backlog item 124)", () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalFocus = HTMLElement.prototype.focus;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollBy = window.scrollBy;

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    HTMLElement.prototype.focus = originalFocus;
    window.scrollBy = originalScrollBy;
  });

  function rect(top: number, bottom: number): DOMRect {
    return {
      top,
      bottom,
      left: 0,
      right: 358,
      width: 358,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => "",
    };
  }

  interface Geometry {
    header: { top: number; bottom: number };
    inset: { top: number; bottom: number };
    actions: { top: number; bottom: number };
    trigger: { top: number; bottom: number };
    /** The trigger's own row: the button and, after a failure, its message
     * (D-01). */
    row: { top: number; bottom: number };
  }

  /** Mutable, so a test can change what the next measurement sees (a
   * reopen, or the remounted trigger's position) between steps. jsdom's
   * window.innerHeight is 768 and it has no visualViewport, so with a 60px
   * header the usable band is 68..760 (the 8px gap below the header; an 8px
   * cushion above the bottom, with no safe-area inset). */
  function stubGeometry(initial: Partial<Geometry> = {}): Geometry {
    const geometry: Geometry = {
      header: { top: 0, bottom: 60 },
      inset: { top: 200, bottom: 500 },
      actions: { top: 440, bottom: 484 },
      trigger: { top: 300, bottom: 344 },
      row: { top: 300, bottom: 404 },
      ...initial,
    };
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute("role") === "dialog") {
        return rect(geometry.inset.top, geometry.inset.bottom);
      }
      if (this.classList.contains("route-delete-confirm-actions")) {
        return rect(geometry.actions.top, geometry.actions.bottom);
      }
      if (this.tagName === "HEADER") {
        return rect(geometry.header.top, geometry.header.bottom);
      }
      if (
        this.tagName === "BUTTON" &&
        this.textContent.trim() === "Clear draft" &&
        this.closest('[role="dialog"]') === null
      ) {
        return rect(geometry.trigger.top, geometry.trigger.bottom);
      }
      // The specific .row holding the trigger; Planning has others.
      if (
        this.classList.contains("row") &&
        Array.from(this.children).some(
          (child) =>
            child.tagName === "BUTTON" && child.textContent.trim() === "Clear draft",
        )
      ) {
        return rect(geometry.row.top, geometry.row.bottom);
      }
      return rect(0, 0);
    };
    return geometry;
  }

  /** Focus and deliberate scrolls in one ordered log, with each focus's
   * options, so "focused without scrolling, then one deliberate scroll"
   * is pinned as a fact. Delegates to the real focus. */
  function captureLog() {
    const log: string[] = [];
    HTMLElement.prototype.focus = function focus(
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      const name =
        this.tagName === "SUMMARY"
          ? "summary"
          : this.tagName === "INPUT"
            ? `input#${this.id}`
            : this.textContent.trim().slice(0, 12);
      log.push(
        `focus:${name}:${options?.preventScroll === true ? "noscroll" : "scroll"}`,
      );
      originalFocus.call(this, options);
    };
    window.scrollBy = (options?: ScrollToOptions | number) => {
      if (typeof options === "object") {
        log.push(
          `scrollBy:${String(options.top)}:${String(options.left)}:${String(options.behavior)}`,
        );
      }
    };
    return log;
  }

  const scrolls = (log: string[]) => log.filter((entry) => entry.startsWith("scrollBy"));

  async function renderWithHeader(
    map: MockMapHandle,
    options: { provider?: RoutingProvider } = {},
  ): Promise<void> {
    const header = document.createElement("header");
    document.body.appendChild(header);
    const draft = buildMeaningfulDraftContent();
    mockedGetDraft.mockResolvedValueOnce(draft);
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={
          options.provider ?? {
            calculateRoute: () => Promise.reject(new Error("unused")),
          }
        }
        stickyHeaderRef={{ current: header }}
      />,
    );
    map.triggerLoad();
    await waitUntil(
      () => screen.queryByDisplayValue(draft.routeName) !== null,
      "restored draft to hydrate",
    );
  }

  afterEach(() => {
    document.querySelectorAll("body > header").forEach((node) => {
      node.remove();
    });
  });

  it("focuses Cancel without scrolling, then makes one instant minimal reveal measured below the sticky header", async () => {
    const map = createMockMapFactory();
    await renderWithHeader(map);
    // Fits the 692px band, but its bottom is 140px below it.
    stubGeometry({
      inset: { top: 600, bottom: 900 },
      actions: { top: 840, bottom: 884 },
    });
    const log = captureLog();

    fireEvent.click(clearDraftTriggerButton());

    expect(log).toEqual(["focus:Cancel:noscroll", "scrollBy:140:0:auto"]);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
  });

  it("parks focus on the routing disclosure first when the trigger itself held focus", async () => {
    const map = createMockMapFactory();
    await renderWithHeader(map);
    stubGeometry();
    clearDraftTriggerButton().focus();
    const log = captureLog();

    fireEvent.click(clearDraftTriggerButton());

    // The trigger is destroyed by the swap; focus never falls to <body>.
    expect(log).toEqual(["focus:summary:noscroll", "focus:Cancel:noscroll"]);
  });

  it("does not move the page when the whole confirmation already fits", async () => {
    const map = createMockMapFactory();
    await renderWithHeader(map);
    stubGeometry({ inset: { top: 200, bottom: 500 } });
    const log = captureLog();

    fireEvent.click(clearDraftTriggerButton());

    expect(scrolls(log)).toEqual([]);
  });

  it("does not move an oversized confirmation whose complete action row already shows, and otherwise moves only the row into the band", async () => {
    const map = createMockMapFactory();
    await renderWithHeader(map);
    const geometry = stubGeometry({
      inset: { top: -100, bottom: 760 },
      actions: { top: 690, bottom: 734 },
    });
    const log = captureLog();

    fireEvent.click(clearDraftTriggerButton());
    expect(scrolls(log)).toEqual([]);

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    // Oversized again, but now the row is 40px below the band: exactly
    // that much, not the inset's own bottom padding as well.
    geometry.inset = { top: 100, bottom: 1000 };
    geometry.actions = { top: 756, bottom: 800 };
    log.length = 0;
    fireEvent.click(clearDraftTriggerButton());
    expect(scrolls(log)).toEqual(["scrollBy:40:0:auto"]);
  });

  it("does not reveal again on an unrelated re-render, and re-measures on reopening", async () => {
    const map = createMockMapFactory();
    await renderWithHeader(map);
    const geometry = stubGeometry({
      inset: { top: 600, bottom: 900 },
      actions: { top: 840, bottom: 884 },
    });
    const log = captureLog();

    fireEvent.click(clearDraftTriggerButton());
    expect(scrolls(log)).toEqual(["scrollBy:140:0:auto"]);

    // A real state change in PlanningScreen while the confirmation is open.
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Renamed while open" },
    });
    expect(screen.getByDisplayValue("Renamed while open")).toBeInTheDocument();
    expect(scrolls(log)).toEqual(["scrollBy:140:0:auto"]);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    geometry.inset = { top: 650, bottom: 950 };
    geometry.actions = { top: 890, bottom: 934 };
    fireEvent.click(clearDraftTriggerButton());
    expect(scrolls(log)).toEqual(["scrollBy:140:0:auto", "scrollBy:190:0:auto"]);
  });

  it.each([
    [
      "Cancel",
      (dialog: HTMLElement) => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      },
    ],
    [
      "Escape",
      (dialog: HTMLElement) => {
        fireEvent.keyDown(dialog, { key: "Escape" });
      },
    ],
  ])(
    "%s: parks focus, reveals the remounted button itself by the minimum, then focuses it without scrolling",
    async (_label, close) => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      const geometry = stubGeometry();
      const log = captureLog();
      fireEvent.click(clearDraftTriggerButton());
      expect(scrolls(log)).toEqual([]);

      // The rider scrolled while it was open: the button will remount 30px
      // under the sticky header.
      geometry.trigger = { top: 38, bottom: 82 };
      log.length = 0;
      close(screen.getByRole("dialog"));

      expect(log).toEqual([
        "focus:summary:noscroll",
        "scrollBy:-30:0:auto",
        "focus:Clear draft:noscroll",
      ]);
      expect(clearDraftTriggerButton()).toHaveFocus();
      expect(mockedClearDraft).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue("Evening loop")).toBeInTheDocument();
    },
  );

  it("keeps the current position when the remounted button is already visible", async () => {
    const map = createMockMapFactory();
    await renderWithHeader(map);
    stubGeometry({ trigger: { top: 300, bottom: 344 } });
    const log = captureLog();
    fireEvent.click(clearDraftTriggerButton());
    log.length = 0;

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(scrolls(log)).toEqual([]);
    expect(clearDraftTriggerButton()).toHaveFocus();
  });

  it("neither scrolls nor takes focus when focus is not at the park as the confirmation closes", async () => {
    const map = createMockMapFactory();
    await renderWithHeader(map);
    const geometry = stubGeometry();
    const log = captureLog();
    fireEvent.click(clearDraftTriggerButton());
    geometry.trigger = { top: 38, bottom: 82 };
    // Simulates focus being elsewhere when the close commits: the park's
    // own focus() does nothing, so the destroyed Cancel drops focus to
    // <body> rather than to the park.
    HTMLElement.prototype.focus = function focus(
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (this.tagName === "SUMMARY") return;
      originalFocus.call(this, options);
    };
    log.length = 0;

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(scrolls(log)).toEqual([]);
    expect(clearDraftTriggerButton()).not.toHaveFocus();
  });

  it("corrects once while focus waits for a disabled button, never again, and drops the focus once the rider moves it", async () => {
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute();
    await renderWithHeader(map, {
      provider: { calculateRoute: () => Promise.resolve(route) },
    });
    fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
    await waitUntil(
      () => screen.queryByRole("region", { name: "Route summary" }) !== null,
      "Route summary to appear",
    );
    const geometry = stubGeometry();
    const log = captureLog();
    fireEvent.click(clearDraftTriggerButton());

    // A Save started while the confirmation is open keeps the remounted
    // button disabled after Cancel.
    const { promise: saveRoutePromise, resolve: resolveSave } =
      createControlledPromise<undefined>();
    mockedSaveRoute.mockReturnValue(saveRoutePromise);
    fireEvent.click(saveButton());
    await flushAsync();

    geometry.trigger = { top: 38, bottom: 82 };
    log.length = 0;
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(clearDraftTriggerButton()).toBeDisabled();
    // The correction happened in the close commit, once.
    expect(log).toEqual(["focus:summary:noscroll", "scrollBy:-30:0:auto"]);

    // Further renders while it waits never repeat it.
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Renamed while waiting" },
    });
    expect(scrolls(log)).toEqual(["scrollBy:-30:0:auto"]);

    // The rider moves on before the Save finishes.
    screen.getByLabelText("Route name").focus();
    await act(async () => {
      resolveSave(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(clearDraftTriggerButton()).toBeEnabled();
    expect(clearDraftTriggerButton()).not.toHaveFocus();
    expect(screen.getByLabelText("Route name")).toHaveFocus();
    expect(scrolls(log)).toEqual(["scrollBy:-30:0:auto"]);
  });

  it("moves focus to the button once it is enabled when the rider has not moved focus meanwhile, without scrolling", async () => {
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute();
    await renderWithHeader(map, {
      provider: { calculateRoute: () => Promise.resolve(route) },
    });
    fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
    await waitUntil(
      () => screen.queryByRole("region", { name: "Route summary" }) !== null,
      "Route summary to appear",
    );
    stubGeometry();
    const log = captureLog();
    fireEvent.click(clearDraftTriggerButton());
    const { promise: saveRoutePromise, resolve: resolveSave } =
      createControlledPromise<undefined>();
    mockedSaveRoute.mockReturnValue(saveRoutePromise);
    fireEvent.click(saveButton());
    await flushAsync();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(clearDraftTriggerButton()).not.toHaveFocus();
    log.length = 0;

    await act(async () => {
      resolveSave(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(clearDraftTriggerButton()).toHaveFocus();
    expect(log.filter((entry) => entry.startsWith("focus:Clear draft"))).toEqual([
      "focus:Clear draft:noscroll",
    ]);
    expect(scrolls(log)).toEqual([]);
  });

  describe("a failure (backlog item 124, D-01)", () => {
    /** Confirms Clear draft with its storage call held, so the test decides
     * when, and whether, it fails. */
    function confirmHeld(): ControlledPromise<undefined> {
      const pending = createControlledPromise<undefined>();
      mockedClearDraft.mockReturnValueOnce(pending.promise);
      fireEvent.click(clearDraftTriggerButton());
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Clear draft" }),
      );
      return pending;
    }

    async function fail(pending: ControlledPromise<undefined>): Promise<void> {
      await act(async () => {
        pending.reject(new Error("boom"));
        await pending.promise.catch(() => undefined);
      });
      await waitUntil(() => screen.queryByRole("alert") !== null, "the failure alert");
    }

    function expectMessageInTheTriggerRow(): void {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(
        "The draft could not be cleared on this device. Try again.",
      );
      expect(alert.parentElement).toBe(clearDraftTriggerButton().parentElement);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }

    const triggerFocuses = (log: string[]) =>
      log.filter((entry) => entry.startsWith("focus:Clear draft"));

    /** Wraps every guard the screen arms, recording its detaches. */
    function spyOnGuards(): { armed: number; detaches: number[] } {
      const record = { armed: 0, detaches: [] as number[] };
      const arm = guardModule.armOperationInteractionGuard;
      vi.spyOn(guardModule, "armOperationInteractionGuard").mockImplementation(
        (getArea) => {
          const guard = arm(getArea);
          const index = record.armed;
          record.armed += 1;
          record.detaches.push(0);
          return {
            get armed() {
              return guard.armed;
            },
            detach: () => {
              record.detaches[index] = (record.detaches[index] ?? 0) + 1;
              guard.detach();
            },
          };
        },
      );
      return record;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("parks focus on the confirmation's title without scrolling while the clear runs, and still refuses Escape there", async () => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      stubGeometry();
      const log = captureLog();
      const pending = confirmHeld();

      const dialog = screen.getByRole("dialog");
      expect(log).toContain("focus:Clear this d:noscroll");
      expect(
        within(dialog).getByRole("heading", { name: "Clear this draft?" }),
      ).toHaveFocus();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Clearing…" })).toBeDisabled();

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await fail(pending);
      // The refused Escape was still this interaction.
      expect(clearDraftTriggerButton()).toHaveFocus();
    });

    it("an immediate failure while the rider waits focuses Clear draft without scrolling, then reveals it and its message by the minimum", async () => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      mockedClearDraft.mockRejectedValueOnce(new Error("boom"));
      // The message ends 44px below the 760px band bottom.
      const geometry = stubGeometry();
      const log = captureLog();
      fireEvent.click(clearDraftTriggerButton());
      geometry.trigger = { top: 700, bottom: 744 };
      geometry.row = { top: 700, bottom: 804 };
      log.length = 0;

      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Clear draft" }),
      );
      await waitUntil(() => screen.queryByRole("alert") !== null, "the failure alert");

      expectMessageInTheTriggerRow();
      expect(clearDraftTriggerButton()).toHaveFocus();
      expect(log).toEqual([
        "focus:Clear this d:noscroll",
        "focus:Clear draft:noscroll",
        "scrollBy:44:0:auto",
      ]);
    });

    it("a delayed failure while the rider waits does the same, moving up when the row is under the header", async () => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      const geometry = stubGeometry();
      const log = captureLog();
      const pending = confirmHeld();
      geometry.trigger = { top: 20, bottom: 64 };
      geometry.row = { top: 20, bottom: 124 };
      log.length = 0;

      await fail(pending);

      expectMessageInTheTriggerRow();
      expect(clearDraftTriggerButton()).toHaveFocus();
      expect(log).toEqual(["focus:Clear draft:noscroll", "scrollBy:-48:0:auto"]);
    });

    it("does not move the page when the button and its message already show", async () => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      stubGeometry();
      const log = captureLog();
      const pending = confirmHeld();
      log.length = 0;

      await fail(pending);

      expect(clearDraftTriggerButton()).toHaveFocus();
      expect(log).toEqual(["focus:Clear draft:noscroll"]);
    });

    it("when the button and its message cannot both fit, brings only the button in, leaving the message reachable by scrolling", async () => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      const geometry = stubGeometry();
      const log = captureLog();
      const pending = confirmHeld();
      // An 800px row against a 692px band; the button ends 24px below it.
      geometry.trigger = { top: 740, bottom: 784 };
      geometry.row = { top: 740, bottom: 1540 };
      log.length = 0;

      await fail(pending);

      expect(clearDraftTriggerButton()).toHaveFocus();
      expect(scrolls(log)).toEqual(["scrollBy:24:0:auto"]);
    });

    it.each([
      ["a wheel", () => fireEvent.wheel(document.body)],
      ["a touch scroll", () => fireEvent.touchMove(document.body)],
      [
        "a tap outside the Clear draft area",
        () => fireEvent.pointerDown(screen.getByLabelText("Route name")),
      ],
      ["a tap on blank space", () => fireEvent.pointerDown(document.body)],
      [
        "a key other than Escape inside the confirmation",
        () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" }),
      ],
    ])(
      "after %s while the clear runs, a failure takes no focus and moves nothing, and its message stays",
      async (_label, moveOn) => {
        const map = createMockMapFactory();
        await renderWithHeader(map);
        const geometry = stubGeometry();
        const log = captureLog();
        const pending = confirmHeld();
        geometry.trigger = { top: 20, bottom: 64 };
        geometry.row = { top: 20, bottom: 124 };
        moveOn();
        log.length = 0;

        await fail(pending);

        expectMessageInTheTriggerRow();
        expect(clearDraftTriggerButton()).not.toHaveFocus();
        expect(log).toEqual([]);
      },
    );

    it("leaves focus in Route name when the rider moved it there, and keeps what they type there", async () => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      const geometry = stubGeometry();
      const log = captureLog();
      const pending = confirmHeld();
      geometry.trigger = { top: 20, bottom: 64 };
      geometry.row = { top: 20, bottom: 124 };
      // Moved by script, so no input event reaches the guard: only the
      // focus check can see it.
      const routeName = screen.getByLabelText("Route name");
      routeName.focus();
      log.length = 0;

      await fail(pending);
      fireEvent.change(routeName, { target: { value: "Evening loop, longer" } });

      expectMessageInTheTriggerRow();
      expect(routeName).toHaveFocus();
      expect(routeName).toHaveValue("Evening loop, longer");
      expect(log).toEqual([]);
    });

    it("still counts a tap on the disabled actions as waiting", async () => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      stubGeometry();
      const log = captureLog();
      const pending = confirmHeld();
      fireEvent.pointerDown(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Clearing…" }),
      );
      log.length = 0;

      await fail(pending);

      expect(clearDraftTriggerButton()).toHaveFocus();
      expect(triggerFocuses(log)).toEqual(["focus:Clear draft:noscroll"]);
    });

    it("renews the guard for every attempt: moving on once does not stop a later attempt's focus, nor the reverse, and a successful retry clears the message", async () => {
      const map = createMockMapFactory();
      await renderWithHeader(map);
      stubGeometry();
      const log = captureLog();

      // Moved on, then waiting.
      const first = confirmHeld();
      fireEvent.wheel(document.body);
      await fail(first);
      expect(clearDraftTriggerButton()).not.toHaveFocus();
      const second = confirmHeld();
      log.length = 0;
      await fail(second);
      expect(clearDraftTriggerButton()).toHaveFocus();
      expect(triggerFocuses(log)).toEqual(["focus:Clear draft:noscroll"]);

      // Waiting, then moved on.
      const third = confirmHeld();
      fireEvent.wheel(document.body);
      log.length = 0;
      await fail(third);
      expect(clearDraftTriggerButton()).not.toHaveFocus();
      expect(triggerFocuses(log)).toEqual([]);

      // A successful retry.
      const fourth = confirmHeld();
      log.length = 0;
      await act(async () => {
        fourth.resolve(undefined);
        await fourth.promise;
      });
      await waitUntil(
        () => screen.queryByDisplayValue("Planned route") !== null,
        "the retried clear to succeed",
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(triggerFocuses(log)).toEqual([]);
      expect(mockedClearDraft).toHaveBeenCalledTimes(4);
    });

    it("arms one guard per confirmed attempt, none for a refused second confirm, and detaches each once it has ended or been decided", async () => {
      const guards = spyOnGuards();
      const map = createMockMapFactory();
      await renderWithHeader(map);
      stubGeometry();

      // A refused rapid second confirm arms nothing.
      const failing = confirmHeld();
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Clearing…" }),
      );
      expect(guards.armed).toBe(1);
      expect(guards.detaches).toEqual([0]);
      // A failure: detached once its focus return is decided.
      await fail(failing);
      expect(guards.detaches[0]).toBeGreaterThanOrEqual(1);

      // A success: detached when the attempt ends.
      const succeeding = confirmHeld();
      await act(async () => {
        succeeding.resolve(undefined);
        await succeeding.promise;
      });
      await waitUntil(
        () => screen.queryByDisplayValue("Planned route") !== null,
        "the clear to succeed",
      );
      expect(guards.armed).toBe(2);
      expect(guards.detaches[1]).toBeGreaterThanOrEqual(1);
    });

    it("leaving Planning while the clear runs detaches its guard, and a late failure takes no focus and moves nothing", async () => {
      const guards = spyOnGuards();
      const map = createMockMapFactory();
      const header = document.createElement("header");
      document.body.appendChild(header);
      mockedGetDraft.mockResolvedValueOnce(buildMeaningfulDraftContent());
      const { unmount } = render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={{ calculateRoute: () => Promise.reject(new Error("unused")) }}
          stickyHeaderRef={{ current: header }}
        />,
      );
      map.triggerLoad();
      await waitUntil(
        () => screen.queryByDisplayValue("Evening loop") !== null,
        "restored draft to hydrate",
      );
      stubGeometry();
      const log = captureLog();
      const pending = confirmHeld();
      expect(guards.armed).toBe(1);

      unmount();
      expect(guards.detaches[0]).toBeGreaterThanOrEqual(1);
      log.length = 0;
      await act(async () => {
        pending.reject(new Error("boom"));
        await pending.promise.catch(() => undefined);
      });
      await flushAsync();

      expect(log).toEqual([]);
      expect(document.activeElement).toBe(document.body);
    });
  });
});
