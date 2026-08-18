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
// literal rather than importing an unexported constant, matching this
// project's own established sibling-file precedent.
const DRAFT_DEBOUNCE_MS = 900;

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerMapTap: (coordinate: Coordinate) => void;
  fitBoundsSpy: ReturnType<typeof vi.fn>;
}

// A minimal local MapLibreLike stub, duplicated rather than shared per this
// project's established no-shared-test-helpers-across-files convention —
// only load, a bare map tap, and (for the camera-re-eligibility test)
// fitBounds matter here.
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

    const dialog = screen.getByRole("alertdialog");
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
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
    const dialog = screen.getByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));

    await waitUntil(
      () => screen.queryByDisplayValue("Planned route") !== null,
      "route name to reset to Planned route",
    );

    expect(mockedClearDraft).toHaveBeenCalledTimes(1);
    expect(mockedGetPlanningPreferences).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
    const dialog = screen.getByRole("alertdialog");
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
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear draft" }));

    await waitUntil(
      () => screen.queryByRole("alert") !== null,
      "an accessible error after the rejected clear",
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The draft could not be cleared on this device. Try again.",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
    const retryDialog = screen.getByRole("alertdialog");
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
    const dialog = screen.getByRole("alertdialog");
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
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

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
    const dialog = screen.getByRole("alertdialog");
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
    const dialog = screen.getByRole("alertdialog");
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
    const dialog = screen.getByRole("alertdialog");
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
    const dialog = screen.getByRole("alertdialog");
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
    const dialog = screen.getByRole("alertdialog");
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
