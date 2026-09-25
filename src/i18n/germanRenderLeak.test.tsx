import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { LanguageProvider } from "./LanguageProvider.tsx";
import { createTranslator, type Translator } from "./translate.ts";
import { en } from "./messages.en.ts";
import { de } from "./messages.de.ts";
import { ENGLISH_ONLY_PHRASES, findEnglishLeaks } from "../test/englishLeaks.ts";
import { RidingScreen } from "../ui/riding/RidingScreen.tsx";
import { FreeRoamScreen } from "../ui/riding/FreeRoamScreen.tsx";
import { db } from "../storage/db.ts";
import { setActiveRideState } from "../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../map/mapAdapter.ts";
import type { PlannedRoute } from "../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import { buildFakeGeolocationSource } from "../test/fixtures/geolocationSource.ts";
import type { GeolocationFix } from "../platform/geolocation.ts";

/**
 * Item 113's 25 September 2026 follow-up: a German render must not show
 * English copy. The installed-iPhone pass found the route-ride `End ride`
 * trigger and the too-short-geometry hint still English, both invisible to
 * every source-text allowlist because nobody had listed them.
 *
 * Every state is rendered twice. The English render must show at least one
 * English-only phrase, which proves the state was actually reached and the
 * detector sees it; the German render of the same state must show none.
 * Route names are German fixtures so rider content can never be mistaken
 * for copy.
 */

const english = createTranslator("en", en);
const german = createTranslator("de", de);
const LANGUAGES = [
  ["en", english],
  ["de", german],
] as const;

function withLanguage(language: "en" | "de", node: ReactNode) {
  return render(
    <LanguageProvider
      preference={language}
      readLanguages={() => ["en-GB"]}
      documentElement={{ lang: "" }}
    >
      {node}
    </LanguageProvider>,
  );
}

function expectLanguageClean(language: "en" | "de", root: Element) {
  const leaks = findEnglishLeaks(root);
  if (language === "en") {
    expect(
      leaks.length,
      "the English render proves the state was reached",
    ).toBeGreaterThan(0);
  } else {
    expect(leaks).toEqual([]);
  }
}

/** The compact riding header shows `ride.endRideCompact` (German `Beenden`)
 * while the button keeps the full `ride.endRide` as its accessible name. */
function expectCompactHeaderLabel(translator: Translator, button: HTMLElement) {
  expect(button).toHaveAccessibleName(translator.t("ride.endRide"));
  expect(button.textContent).toBe(translator.t("ride.endRideCompact"));
}

const routePoints = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
);

const route: PlannedRoute = {
  id: "route-1",
  name: "Abendrunde am See",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: routePoints,
  manoeuvres: [],
  distanceMetres: routePoints.at(-1)?.distanceFromStartMetres ?? 0,
  ascentMetres: 2,
  descentMetres: 0,
  warnings: [],
  source: { kind: "gpx-import" },
};

const MIDPOINT_COORDINATE = routePoints[10]?.coordinate ?? [0, 51];

function midpointFix(timestampMs: number): GeolocationFix {
  return {
    coordinate: MIDPOINT_COORDINATE,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function createMockMapFactory(): MapFactory {
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
      getCenter: () => [0, 51],
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

function headerEndButton(container: HTMLElement): HTMLElement {
  const button = container.querySelector<HTMLElement>(
    ".riding-immersive-header-end button",
  );
  if (!button) throw new Error("no header end action");
  return button;
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the English-only phrase set", () => {
  it("is derived from the catalogues and excludes shared values", () => {
    expect(ENGLISH_ONLY_PHRASES).toContain("End ride");
    expect(ENGLISH_ONLY_PHRASES).toContain(en["riding.editCopyTooShort"]);
    // Identical in both catalogues, so never evidence of a leak.
    expect(ENGLISH_ONLY_PHRASES).not.toContain("English");
    expect(ENGLISH_ONLY_PHRASES).not.toContain("Deutsch");
    expect(ENGLISH_ONLY_PHRASES).not.toContain("OpenRouteService");
  });

  it("matches whole phrases only", () => {
    const element = document.createElement("p");
    element.textContent = "Fahrt beenden";
    expect(findEnglishLeaks(element)).toEqual([]);
    element.textContent = "End ride";
    expect(findEnglishLeaks(element)).toContain("End ride");
  });
});

describe("route Riding renders no English in German", () => {
  for (const [language, translator] of LANGUAGES) {
    it(`the active header (${language})`, async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      const { container } = withLanguage(
        language,
        <RidingScreen
          route={route}
          geolocationSource={fake.source}
          mapFactory={createMockMapFactory()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: translator.t("riding.startRiding") }),
      );
      act(() => {
        fake.watches[0]?.emitFix(midpointFix(1000));
      });
      await screen.findByRole("button", { name: translator.t("ride.endRide") });

      expectLanguageClean(language, headerEndButton(container));
      expectLanguageClean(language, container);
      expectCompactHeaderLabel(translator, headerEndButton(container));
    });

    it(`the paused panel (${language})`, async () => {
      await setActiveRideState({
        id: "active",
        routeId: route.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: {
          coordinate: MIDPOINT_COORDINATE,
          accuracyMetres: 6,
          timestampMs: 1000,
        },
        lastMatchedPointIndex: 10,
        matchedDistanceFromStartMetres: route.distanceMetres / 2,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      });
      const { container } = withLanguage(
        language,
        <RidingScreen
          route={route}
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={createMockMapFactory()}
        />,
      );

      await screen.findByRole("button", { name: translator.t("riding.resumeRide") });
      const panel = container.querySelector(".ride-end-ride-panel-row");
      if (!panel) throw new Error("no paused-panel End action");
      const panelButton = within(panel as HTMLElement).getByRole("button", {
        name: translator.t("ride.endRide"),
      });
      // The panel has the width for the full label, so it needs no
      // separate accessible name.
      expect(panelButton).toHaveTextContent(translator.t("ride.endRide"));
      expect(panelButton).not.toHaveAttribute("aria-label");
      expectLanguageClean(language, panel);
    });

    it(`the too-short-geometry hint (${language})`, async () => {
      const shortRoute: PlannedRoute = {
        ...route,
        points: [
          { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
        ],
      };
      const { container } = withLanguage(
        language,
        <RidingScreen
          route={shortRoute}
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={createMockMapFactory()}
        />,
      );

      await screen.findByRole("button", { name: translator.t("riding.editCopy") });
      const hint = container.querySelector(".ride-start-panel .field-hint");
      if (!hint) throw new Error("no too-short hint");
      expectLanguageClean(language, hint);
    });
  }
});

describe("free roam renders no English in German", () => {
  for (const [language, translator] of LANGUAGES) {
    it(`the header (${language})`, () => {
      const { container } = withLanguage(
        language,
        <FreeRoamScreen
          geolocationSource={buildFakeGeolocationSource().source}
          mapFactory={createMockMapFactory()}
        />,
      );

      expect(
        screen.getByRole("button", { name: translator.t("ride.endRide") }),
      ).toBeInTheDocument();
      expectLanguageClean(language, headerEndButton(container));
      expectCompactHeaderLabel(translator, headerEndButton(container));
    });
  }
});
