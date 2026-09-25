// Item 113's 25 September 2026 follow-up. On the installed iPhone a German
// Planning draft was named "Planned route", and reversing appended the
// literal " (reversed)": both were English literals in code rather than
// catalogue entries. Newly generated names now follow the rider's
// language; a name that already exists — typed, restored or saved — is
// never retranslated. Harness duplicated from
// PlanningScreen.clearDraft.test.tsx per this project's
// no-shared-test-helpers convention.
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
import { LanguageProvider } from "../../i18n/LanguageProvider.tsx";
import { createTranslator, type Translator } from "../../i18n/translate.ts";
import { en } from "../../i18n/messages.en.ts";
import { de } from "../../i18n/messages.de.ts";
import { findEnglishLeaks } from "../../test/englishLeaks.ts";

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

const english = createTranslator("en", en);
const german = createTranslator("de", de);

function draftWith(routeName: string): PlanningDraftContent {
  return {
    waypoints: [
      { id: "wp-a", coordinate: [1, 51] },
      { id: "wp-b", coordinate: [1.02, 51.01] },
    ],
    routeName,
    avoidFerries: true,
    profile: "cycling-road",
  };
}

async function renderPlanning(
  language: "en" | "de",
  options: { draft?: PlanningDraftContent; provider?: RoutingProvider } = {},
): Promise<{ map: MockMapHandle; translator: Translator }> {
  const translator = language === "de" ? german : english;
  const map = createMockMapFactory();
  mockedGetDraft.mockResolvedValueOnce(options.draft);
  const provider =
    options.provider ??
    ({ calculateRoute: () => Promise.reject(new Error("unused")) } as const);
  render(
    <LanguageProvider
      preference={language}
      readLanguages={() => ["en-GB"]}
      documentElement={{ lang: "" }}
    >
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={provider}
      />
    </LanguageProvider>,
  );
  map.triggerLoad();
  const expectedName =
    options.draft?.routeName ?? translator.t("planning.defaultRouteName");
  await waitUntil(
    () => screen.queryByDisplayValue(expectedName) !== null,
    `the draft name "${expectedName}" to appear`,
  );
  return { map, translator };
}

function nameField(translator: Translator): HTMLInputElement {
  return screen.getByLabelText(translator.t("planning.save.nameLabel"));
}

async function calculate(translator: Translator): Promise<void> {
  fireEvent.click(
    screen.getByRole("button", { name: translator.t("planning.calculate") }),
  );
  await waitUntil(
    () =>
      screen.queryByRole("region", {
        name: translator.t("routeSummary.landmarkLabel"),
      }) !== null,
    "the route summary to appear",
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
  vi.restoreAllMocks();
});

describe("generated Planning names follow the rider's language", () => {
  it("names a fresh draft in English", async () => {
    const { translator } = await renderPlanning("en");
    expect(nameField(translator)).toHaveValue("Planned route");
    // The leak detector sees this screen: the English render shows
    // English-only phrases, including the name field's value.
    expect(findEnglishLeaks(document.body)).toContain("Planned route");
  });

  it("names a fresh draft in German, with no English anywhere on the screen", async () => {
    const { translator } = await renderPlanning("de");
    expect(nameField(translator)).toHaveValue("Geplante Route");
    expect(findEnglishLeaks(document.body)).toEqual([]);
  });

  it("keeps a restored draft's own name, even one generated in English", async () => {
    // Stored names are the rider's: a draft started in English and
    // reopened in German is not retranslated.
    const { translator } = await renderPlanning("de", {
      draft: draftWith("Planned route"),
    });
    await advancePastDebounce();
    expect(nameField(translator)).toHaveValue("Planned route");
  });

  it("resets to the German default after Clear draft", async () => {
    const { translator } = await renderPlanning("de", { draft: draftWith("Hausrunde") });
    fireEvent.click(
      screen.getByRole("button", { name: translator.t("planning.clearDraft") }),
    );
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: translator.t("planning.clearDraft") }),
    );
    await waitUntil(
      () => screen.queryByDisplayValue("Geplante Route") !== null,
      "the cleared draft's German default name",
    );
  });

  it("suggests the German reversed name", async () => {
    const { translator } = await renderPlanning("de", { draft: draftWith("Hausrunde") });
    fireEvent.click(
      screen.getByRole("button", { name: translator.t("planning.actions.reverse") }),
    );
    await waitUntil(
      () => screen.queryByDisplayValue("Hausrunde (umgekehrt)") !== null,
      "the German reversed name",
    );
  });

  it("saves a blank name under the German default, then resets to it", async () => {
    await saveProviderKey("dummy-test-key");
    const route = buildRoute();
    const { translator } = await renderPlanning("de", {
      draft: draftWith("Hausrunde"),
      provider: { calculateRoute: () => Promise.resolve(route) },
    });
    await calculate(translator);
    fireEvent.change(nameField(translator), { target: { value: "   " } });

    fireEvent.click(
      screen.getByRole("button", { name: translator.t("planning.save.save") }),
    );
    await waitUntil(() => mockedSaveRoute.mock.calls.length === 1, "the save");
    expect(mockedSaveRoute.mock.calls[0]?.[0].name).toBe("Geplante Route");
    await waitUntil(
      () => screen.queryByDisplayValue("Geplante Route") !== null,
      "the saved draft's reset to the German default",
    );
  });

  it("exports a blank name as Geplante Route.gpx", async () => {
    await saveProviderKey("dummy-test-key");
    const route = buildRoute();
    const { translator } = await renderPlanning("de", {
      draft: draftWith("Hausrunde"),
      provider: { calculateRoute: () => Promise.resolve(route) },
    });
    await calculate(translator);
    fireEvent.change(nameField(translator), { target: { value: "" } });

    const downloads: string[] = [];
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    fireEvent.click(
      screen.getByRole("button", { name: translator.t("planning.save.export") }),
    );
    await waitUntil(() => downloads.length === 1, "the export download");
    expect(downloads).toEqual(["Geplante Route.gpx"]);
  });
});
