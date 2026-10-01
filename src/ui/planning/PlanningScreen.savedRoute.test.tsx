// Backlog item 124, slice 3 (inventory C-14): Save only saves. Planning then
// shows which route was saved and offers Open saved route, beneath which
// App's ride-switch prompt for that route is presented. This file proves
// the screen's own side: the feedback, its narrow lifecycle, its one-off
// reveal and that reveal's guard, the inline prompt's reveal and focus
// return, and the anchor report. App's guard is covered by
// App.planningSavedRoute.test.tsx; real-browser geometry by
// e2e/planningSavedRoute.smoke.spec.ts. Storage is mocked, as in
// PlanningScreen.clearDraft.test.tsx, so saves can be held and failed.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  PlanningScreen,
  type PlanningScreenProps,
  type SavedRouteSwitchPrompt,
} from "./PlanningScreen.tsx";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import type { MapTapInput } from "../../map/mapTapInput.ts";
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

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerMapTap: (coordinate: Coordinate, input?: MapTapInput) => void;
}

function createMockMapFactory(): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let mapTapListener: ((coordinate: Coordinate, input: MapTapInput) => void) | undefined;
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
    triggerMapTap: (coordinate, input = "mouse") => {
      act(() => {
        mapTapListener?.(coordinate, input);
      });
    },
  };
}

function buildRoute(id: string, pointCount = 10): PlannedRoute {
  return {
    id,
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

const DRAFT: PlanningDraftContent = {
  waypoints: [
    { id: "wp-a", coordinate: [1, 51] },
    { id: "wp-b", coordinate: [1.02, 51.01] },
  ],
  routeName: "Evening loop",
  avoidFerries: true,
  profile: "cycling-road",
};

async function flushAsync(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await flushAsync();
  }
  throw new Error(`Timed out waiting for: ${description}`);
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

const SAVED_TEXT = /is saved in Routes\./;

function openSavedRouteButton(): HTMLElement {
  return screen.getByRole("button", { name: "Open saved route" });
}

/** Renders Planning with a restored two-waypoint draft and a provider that
 * returns a routed result, ready to Save. Returns a helper that re-renders
 * with a new prompt, as App does. */
async function renderReadyToSave(props: Partial<PlanningScreenProps> = {}): Promise<{
  map: MockMapHandle;
  setPrompt: (prompt: SavedRouteSwitchPrompt | null) => void;
  routeIds: string[];
}> {
  await saveProviderKey("dummy-test-key");
  mockedGetDraft.mockResolvedValueOnce(DRAFT);
  const map = createMockMapFactory();
  const routeIds: string[] = [];
  let counter = 0;
  const provider: RoutingProvider = {
    calculateRoute: () => {
      counter += 1;
      const id = `route-${String(counter)}`;
      routeIds.push(id);
      return Promise.resolve(buildRoute(id));
    },
  };
  const header = document.createElement("header");
  document.body.appendChild(header);
  const baseProps: PlanningScreenProps = {
    onNavigateToSettings: vi.fn(),
    mapFactory: map.factory,
    routingProvider: provider,
    stickyHeaderRef: { current: header },
    ...props,
  };
  const { rerender } = render(<PlanningScreen {...baseProps} />);
  map.triggerLoad();
  await waitUntil(
    () => screen.queryByDisplayValue("Evening loop") !== null,
    "restored draft to hydrate",
  );
  await calculate();
  return {
    map,
    routeIds,
    setPrompt: (prompt) => {
      rerender(<PlanningScreen {...baseProps} savedRouteSwitchPrompt={prompt} />);
    },
  };
}

async function calculate(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /calculate route/i }));
  await waitUntil(
    () =>
      !screen.getByRole<HTMLButtonElement>("button", { name: /save route/i }).disabled,
    "a routed result ready to save",
  );
}

async function save(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /save route/i }));
  await waitUntil(() => screen.queryByText(SAVED_TEXT) !== null, "the saved feedback");
}

/** The route Planning actually handed to saveRoute — Planning stamps its
 * own id at calculation time, so this, not the provider's id, is the
 * saved route's identity. */
function lastSavedRoute(): PlannedRoute | undefined {
  return mockedSaveRoute.mock.calls.at(-1)?.[0];
}

function buildPrompt(
  overrides: Partial<SavedRouteSwitchPrompt> = {},
): SavedRouteSwitchPrompt {
  return {
    requestId: 7,
    routeId: lastSavedRoute()?.id ?? "no-saved-route",
    title: 'Switch to "Evening loop"?',
    message:
      "You have an unfinished ride on another route. It must be ended before this can open — the saved route will remain in your library, but ride progress will be cleared.",
    confirmLabel: "End and switch",
    busy: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onAnchorMissing: vi.fn(),
    ...overrides,
  };
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
  document.querySelectorAll("body > header").forEach((node) => {
    node.remove();
  });
});

describe("Planning's saved-route feedback (item 124, slice 3)", () => {
  it("Save only saves: it stays in Planning, names the saved route, clears the draft and opens nothing", async () => {
    const onOpenSavedRoute = vi.fn();
    await renderReadyToSave({ onOpenSavedRoute });

    await save();

    expect(screen.getByText("“Evening loop” is saved in Routes.")).toHaveAttribute(
      "role",
      "status",
    );
    expect(openSavedRouteButton()).toBeInTheDocument();
    expect(mockedSaveRoute).toHaveBeenCalledTimes(1);
    expect(mockedClearDraft).toHaveBeenCalled();
    expect(onOpenSavedRoute).not.toHaveBeenCalled();
    expect(
      screen.getByText("No waypoints yet. Use the crosshair to add one."),
    ).toBeInTheDocument();
  });

  it("Open saved route opens exactly the route that was saved", async () => {
    const onOpenSavedRoute = vi.fn();
    await renderReadyToSave({ onOpenSavedRoute });
    await save();

    fireEvent.click(openSavedRouteButton());

    expect(onOpenSavedRoute).toHaveBeenCalledTimes(1);
    expect(onOpenSavedRoute.mock.calls[0]?.[0]).toBe(mockedSaveRoute.mock.calls[0]?.[0]);
    expect((onOpenSavedRoute.mock.calls[0]?.[0] as PlannedRoute).name).toBe(
      "Evening loop",
    );
  });

  it("clears once a new draft begins: the first waypoint", async () => {
    const { map } = await renderReadyToSave();
    await save();
    map.triggerMapTap([0, 51]);
    await flushAsync();
    expect(screen.queryByText(SAVED_TEXT)).toBeNull();
  });

  it("clears once a new draft begins: a renamed route", async () => {
    await renderReadyToSave();
    await save();
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Next ride" },
    });
    expect(screen.queryByText(SAVED_TEXT)).toBeNull();
  });

  it("clears after a successful Clear draft", async () => {
    await renderReadyToSave();
    await save();
    fireEvent.click(screen.getByRole("button", { name: /^clear draft$/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear draft" }),
    );
    await waitUntil(() => screen.queryByRole("dialog") === null, "Clear draft to finish");
    expect(screen.queryByText(SAVED_TEXT)).toBeNull();
  });

  it("is replaced by the next successful save", async () => {
    const onOpenSavedRoute = vi.fn();
    const { map } = await renderReadyToSave({ onOpenSavedRoute });
    await save();
    map.triggerMapTap([0, 51]);
    map.triggerMapTap([0.01, 51]);
    await flushAsync();
    await calculate();
    await save();

    expect(screen.getAllByText(SAVED_TEXT)).toHaveLength(1);
    expect(screen.getByText("“Planned route” is saved in Routes.")).toBeInTheDocument();
    fireEvent.click(openSavedRouteButton());
    expect(mockedSaveRoute).toHaveBeenCalledTimes(2);
    expect(onOpenSavedRoute.mock.calls[0]?.[0]).toBe(lastSavedRoute());
  });

  it("is never cleared while its switch prompt is shown, and clears once the prompt closes", async () => {
    const { map, setPrompt } = await renderReadyToSave();
    await save();
    setPrompt(buildPrompt());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    map.triggerMapTap([0, 51]);
    await flushAsync();
    expect(screen.getByText(SAVED_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    setPrompt(null);
    expect(screen.queryByText(SAVED_TEXT)).toBeNull();
  });

  it("reports a prompt it has no saved-route feedback for, with that prompt's own request id, and never one that matches", async () => {
    const { setPrompt } = await renderReadyToSave();
    const unmatched = buildPrompt({ routeId: "some-other-route", requestId: 11 });
    setPrompt(unmatched);
    expect(unmatched.onAnchorMissing).toHaveBeenCalledWith(11);
    expect(screen.queryByRole("dialog")).toBeNull();

    await save();
    const matched = buildPrompt({ requestId: 12 });
    setPrompt(matched);
    expect(matched.onAnchorMissing).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// jsdom has no layout: geometry is stubbed per element, as the item 118 and
// slice 1 reveal tests do. innerHeight is 768 and there is no
// visualViewport, so with a 60px header the usable band is 68..760.
describe("Planning's saved-route reveals and focus return (item 124, slice 3)", () => {
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
    feedback: { top: number; bottom: number };
    open: { top: number; bottom: number };
    heading: { top: number; bottom: number };
    inset: { top: number; bottom: number };
    actions: { top: number; bottom: number };
  }

  function stubGeometry(initial: Partial<Geometry> = {}): Geometry {
    const geometry: Geometry = {
      feedback: { top: 400, bottom: 460 },
      open: { top: 410, bottom: 454 },
      heading: { top: 300, bottom: 330 },
      inset: { top: 470, bottom: 670 },
      actions: { top: 610, bottom: 654 },
      ...initial,
    };
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute("role") === "dialog") {
        return rect(geometry.inset.top, geometry.inset.bottom);
      }
      if (this.classList.contains("route-delete-confirm-actions")) {
        return rect(geometry.actions.top, geometry.actions.bottom);
      }
      if (this.classList.contains("planning-saved-route")) {
        return rect(geometry.feedback.top, geometry.feedback.bottom);
      }
      if (this.tagName === "BUTTON" && this.textContent.trim() === "Open saved route") {
        return rect(geometry.open.top, geometry.open.bottom);
      }
      if (this.tagName === "H2" && this.textContent.trim() === "Save or export") {
        return rect(geometry.heading.top, geometry.heading.bottom);
      }
      if (this.tagName === "HEADER") return rect(0, 60);
      return rect(0, 0);
    };
    return geometry;
  }

  function captureLog() {
    const log: string[] = [];
    HTMLElement.prototype.focus = function focus(
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      log.push(
        `focus:${this.tagName === "H2" ? "heading" : this.textContent.trim().slice(0, 16)}:${options?.preventScroll === true ? "noscroll" : "scroll"}`,
      );
      originalFocus.call(this, options);
    };
    window.scrollBy = (options?: ScrollToOptions | number) => {
      if (typeof options === "object") log.push(`scrollBy:${String(options.top)}`);
    };
    return log;
  }

  const scrolls = (log: string[]) => log.filter((entry) => entry.startsWith("scrollBy"));

  it("reveals the saved feedback once, by the minimum, when it appears below the band", async () => {
    await renderReadyToSave();
    stubGeometry({ feedback: { top: 740, bottom: 800 } });
    const log = captureLog();
    await save();
    expect(scrolls(log)).toEqual(["scrollBy:40"]);
  });

  it("does not move the page when the saved feedback already shows", async () => {
    await renderReadyToSave();
    stubGeometry({ feedback: { top: 400, bottom: 460 } });
    const log = captureLog();
    await save();
    expect(scrolls(log)).toEqual([]);
  });

  it("does not reveal the feedback once the rider has moved on during the save, and leaves no listener behind", async () => {
    await renderReadyToSave();
    stubGeometry({ feedback: { top: 740, bottom: 800 } });
    const log = captureLog();
    const held = controlledPromise<undefined>();
    mockedSaveRoute.mockReturnValueOnce(held.promise);
    const removeSpy = vi.spyOn(window, "removeEventListener");

    fireEvent.click(screen.getByRole("button", { name: /save route/i }));
    // Newer rider input arrives after Save was pressed, before the save
    // has finished and before React has committed the feedback.
    window.dispatchEvent(new WheelEvent("wheel"));
    await act(async () => {
      held.resolve(undefined);
      await held.promise;
    });
    await waitUntil(() => screen.queryByText(SAVED_TEXT) !== null, "the saved feedback");

    expect(scrolls(log)).toEqual([]);
    expect(removeSpy.mock.calls.filter(([type]) => type === "wheel")).toHaveLength(1);
  });

  it("abandons the feedback reveal on a failed save, removing its listeners", async () => {
    await renderReadyToSave();
    const removeSpy = vi.spyOn(window, "removeEventListener");
    mockedSaveRoute.mockRejectedValueOnce(new Error("save failed"));
    fireEvent.click(screen.getByRole("button", { name: /save route/i }));
    await waitUntil(() => screen.queryByRole("alert") !== null, "the save error");
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      expect(removeSpy.mock.calls.filter(([t]) => t === type)).toHaveLength(1);
    }
    expect(screen.queryByText(SAVED_TEXT)).toBeNull();
  });

  it("presents the prompt directly beneath Open saved route, focuses Cancel without scrolling, and reveals it once by the minimum", async () => {
    const { setPrompt } = await renderReadyToSave();
    await save();
    const geometry = stubGeometry({
      inset: { top: 620, bottom: 820 },
      actions: { top: 760, bottom: 804 },
    });
    const log = captureLog();

    setPrompt(buildPrompt());
    const dialog = screen.getByRole("dialog");
    expect(document.querySelector(".planning-saved-route")?.nextElementSibling).toBe(
      dialog,
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(log).toEqual(["focus:Cancel:noscroll", "scrollBy:60"]);

    // An unrelated re-render — a new prompt object for the same request —
    // never reveals again.
    geometry.inset = { top: 700, bottom: 900 };
    setPrompt(buildPrompt());
    expect(scrolls(log)).toEqual(["scrollBy:60"]);
  });

  // jsdom's window is 768px tall, so the band is 68–760px. Oversized (the
  // confirmation taller than that), only the complete action row counts —
  // the case a browser cannot arrange here, since the save area ends the
  // page and the confirmation always opens below the window.
  it.each([
    ["already shows its complete action row", { top: 700, bottom: 744 }, []],
    ["has its action row below the band", { top: 1040, bottom: 1084 }, ["scrollBy:324"]],
  ])(
    "an oversized prompt that %s moves only as far as completes that row",
    async (_label, actions, expected) => {
      const { setPrompt } = await renderReadyToSave();
      await save();
      stubGeometry({
        // Padding below the row, so bottom-aligning the whole confirmation
        // (the fallback without an action row) would move it differently.
        inset: { top: actions.top - 650, bottom: actions.bottom + 40 },
        actions,
      });
      const log = captureLog();
      setPrompt(buildPrompt());
      expect(scrolls(log)).toEqual(expected);
    },
  );

  it.each([
    [
      "Cancel",
      () => {
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
        );
      },
    ],
    [
      "Escape",
      () => {
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      },
    ],
  ])(
    "%s returns focus to Open saved route without scrolling, then corrects only by the minimum once the prompt has closed",
    async (_label, close) => {
      const { setPrompt } = await renderReadyToSave();
      await save();
      const geometry = stubGeometry();
      const prompt = buildPrompt();
      setPrompt(prompt);
      const log = captureLog();
      // The rider scrolled while it was open: Open saved route is now 30px
      // under the sticky header.
      geometry.open = { top: 38, bottom: 82 };

      close();
      expect(prompt.onCancel).toHaveBeenCalledTimes(1);
      expect(openSavedRouteButton()).toHaveFocus();
      expect(scrolls(log)).toEqual([]);

      setPrompt(null);
      expect(log).toEqual(["focus:Open saved route:noscroll", "scrollBy:-30"]);
      setPrompt(null);
      expect(scrolls(log)).toEqual(["scrollBy:-30"]);
    },
  );

  it("keeps the position when Open saved route is visible after Cancel", async () => {
    const { setPrompt } = await renderReadyToSave();
    await save();
    stubGeometry();
    const prompt = buildPrompt();
    setPrompt(prompt);
    const log = captureLog();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    setPrompt(null);
    expect(scrolls(log)).toEqual([]);
    expect(openSavedRouteButton()).toHaveFocus();
  });

  it("ignores Cancel and Escape while the switch is busy", async () => {
    const { setPrompt } = await renderReadyToSave();
    await save();
    stubGeometry();
    const prompt = buildPrompt({ busy: true });
    setPrompt(prompt);
    const log = captureLog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(prompt.onCancel).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it.each([
    [
      "Cancel",
      () => {
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
        );
      },
    ],
    [
      "Escape",
      () => {
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      },
    ],
  ])(
    "%s after a new draft began while the prompt was open: focus goes to the save area's heading, never lost, and the feedback then clears",
    async (_label, close) => {
      const { map, setPrompt } = await renderReadyToSave();
      await save();
      stubGeometry();
      const prompt = buildPrompt();
      setPrompt(prompt);
      map.triggerMapTap([0, 51]);
      await flushAsync();
      expect(screen.getByText(SAVED_TEXT)).toBeInTheDocument();
      const log = captureLog();

      close();
      setPrompt(null);

      const heading = screen.getByRole("heading", { name: "Save or export" });
      expect(heading).toHaveFocus();
      expect(heading).toHaveAttribute("tabindex", "-1");
      expect(screen.queryByText(SAVED_TEXT)).toBeNull();
      expect(screen.queryByRole("button", { name: "Open saved route" })).toBeNull();
      // Heading visible (300..330, inside 68..760): no movement.
      expect(log).toEqual(["focus:heading:noscroll"]);
    },
  );

  it("corrects to the heading by the minimum when it is the fallback and lies under the header", async () => {
    const { map, setPrompt } = await renderReadyToSave();
    await save();
    const geometry = stubGeometry();
    setPrompt(buildPrompt());
    map.triggerMapTap([0, 51]);
    await flushAsync();
    geometry.heading = { top: 20, bottom: 50 };
    const log = captureLog();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    setPrompt(null);

    expect(log).toEqual(["focus:heading:noscroll", "scrollBy:-48"]);
  });
});
