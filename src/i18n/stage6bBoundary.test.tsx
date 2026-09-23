import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "./LanguageProvider.tsx";
import { en } from "./messages.en.ts";
import { de } from "./messages.de.ts";
import { createTranslator } from "./translate.ts";
import { SettingsScreen } from "../ui/settings/SettingsScreen.tsx";
import { DiagnosticsScreen } from "../ui/diagnostics/DiagnosticsScreen.tsx";
import { saveProviderKey } from "../storage/providerKeyRepository.ts";
import type { PlannedRoute } from "../domain/types.ts";
import { RidingWakeLockControl } from "../ui/riding/RidingWakeLockControl.tsx";
import { buildFakeWakeLockSource } from "../test/fixtures/wakeLockSource.ts";
import planningRoute from "../ui/planning/usePlanningRoute.ts?raw";

/**
 * Backlog item 113 stage 6b: enabling German.
 *
 * The catalogue's own correctness is proved in `messages.de.test.ts`.
 * This file covers what stage 6b *adds*: the selector, the announcements
 * that were previously hard-coded, the surfaces that behave differently
 * per language, and the safeguards that keep a language change from
 * spending a routing request.
 */

const english = createTranslator("en", en);
const german = createTranslator("de", de);

function withLanguage(preference: "device" | "en" | "de", node: React.ReactNode) {
  return render(
    <LanguageProvider
      preference={preference}
      readLanguages={() => ["en-GB"]}
      documentElement={{ lang: "" }}
    >
      {node}
    </LanguageProvider>,
  );
}

describe("the Language card", () => {
  it("offers the three approved options, in both languages", async () => {
    const view = withLanguage("en", <SettingsScreen />);
    const group = await screen.findByRole("group", { name: "Interface language" });
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Device language",
      "English",
      "Deutsch",
    ]);
    view.unmount();

    withLanguage("de", <SettingsScreen />);
    const germanGroup = await screen.findByRole("group", {
      name: "Sprache der Oberfläche",
    });
    expect([...germanGroup.querySelectorAll("button")].map((b) => b.textContent)).toEqual(
      ["Gerätesprache", "English", "Deutsch"],
    );
  });

  it("shows the endonyms unchanged in both languages", () => {
    // A rider who cannot read the current interface must still recognise
    // their own language.
    expect(english.t("settings.language.english")).toBe(
      german.t("settings.language.english"),
    );
    expect(english.t("settings.language.german")).toBe(
      german.t("settings.language.german"),
    );
  });

  it("marks the active preference, and only that one, as pressed", async () => {
    withLanguage("de", <SettingsScreen />);
    const group = await screen.findByRole("group", { name: "Sprache der Oberfläche" });
    const pressed = [...group.querySelectorAll("button")].filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toBe("Deutsch");
  });

  it("reports the rider's choice rather than storing it itself", async () => {
    const user = userEvent.setup();
    const onSelectPreference = vi.fn<(next: string) => void>();
    render(
      <LanguageProvider
        preference="en"
        readLanguages={() => ["en-GB"]}
        documentElement={{ lang: "" }}
        onSelectPreference={onSelectPreference}
      >
        <SettingsScreen />
      </LanguageProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Deutsch" }));
    expect(onSelectPreference).toHaveBeenCalledWith("de");
  });

  it("is the first panel under Preferences, since it governs every other word", async () => {
    withLanguage("en", <SettingsScreen />);
    const preferences = await screen.findByRole("region", { name: "Preferences" });
    expect([...preferences.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([
      "Language",
      "Route planning",
      "OpenRouteService",
    ]);
  });
});

describe("the wake-lock announcement", () => {
  const fixedClock = { now: () => 1_000 };

  async function renderActive(preference: "en" | "de") {
    const fake = buildFakeWakeLockSource();
    const view = withLanguage(
      preference,
      <RidingWakeLockControl
        desired={true}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );
    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });
    return view;
  }

  it("announces in the active language, from the catalogue", async () => {
    // Stage 5 missed this one: the sentence was hard-coded English inside
    // the visually-hidden status, so a German rider would have heard an
    // English announcement.
    const view = await renderActive("en");
    expect(screen.getByText("Screen staying awake.")).toBeInTheDocument();
    view.unmount();

    await renderActive("de");
    expect(screen.getByText("Das Display bleibt an.")).toBeInTheDocument();
  });

  it("stays visually hidden and politely announced, never a visible status line", async () => {
    await renderActive("de");
    const announcement = screen.getByText("Das Display bleibt an.");
    expect(announcement).toHaveAttribute("role", "status");
    expect(announcement).toHaveClass("visually-hidden");
  });
});

describe("the copied-report language notice", () => {
  it("exists in both catalogues, for key and shape parity", () => {
    expect(en["status.copyReportLanguage"]).toBe(
      "The copied diagnostic report is in English.",
    );
    expect(de["status.copyReportLanguage"]).toBe(
      "Der kopierte Diagnosebericht ist auf Englisch.",
    );
  });

  async function runConnectionTest(preference: "en" | "de") {
    await saveProviderKey("dummy-test-key");
    const user = userEvent.setup();
    const route: PlannedRoute = {
      id: "r",
      name: "r",
      createdAt: "2026-01-01T00:00:00.000Z",
      points: [
        { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
        { coordinate: [0.01, 51], elevationMetres: 12, distanceFromStartMetres: 700 },
      ],
      manoeuvres: [],
      distanceMetres: 700,
      ascentMetres: 2,
      descentMetres: 0,
      warnings: [],
      source: { kind: "planner" },
    };
    const view = withLanguage(
      preference,
      <DiagnosticsScreen
        routingProvider={{ calculateRoute: vi.fn(() => Promise.resolve(route)) }}
      />,
    );
    const label =
      preference === "de" ? "Routing-Verbindung testen" : "Test routing connection";
    const button = await screen.findByRole("button", { name: label });
    await vi.waitFor(() => {
      expect(button).toBeEnabled();
    });
    await user.click(button);
    await screen.findByRole("button", {
      name:
        de["status.copyReport"] === label
          ? label
          : preference === "de"
            ? "Diagnosebericht kopieren"
            : "Copy diagnostic report",
    });
    return view;
  }

  it("is shown in German, where it tells the reader something", async () => {
    await runConnectionTest("de");
    expect(
      screen.getByText("Der kopierte Diagnosebericht ist auf Englisch."),
    ).toBeInTheDocument();
  });

  it("is absent in English, where it would only be noise", async () => {
    // The report is English in every language (decision R4). Telling an
    // English reader that an English report is in English says nothing.
    await runConnectionTest("en");
    expect(
      screen.getByRole("button", { name: "Copy diagnostic report" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("The copied diagnostic report is in English.")).toBeNull();
  });
});

describe("a language change never spends a routing request", () => {
  it("keeps the language out of the calculation fingerprint and the debounce", () => {
    // Safeguard 6 of the accepted plan: switching language must not mark a
    // route stale, and must not trigger a recalculation. The language is
    // read from the ref at call time instead.
    const fingerprint = /function computeRouteCalculationFingerprint\([\s\S]*?\n}/.exec(
      planningRoute,
    );
    expect(fingerprint, "fingerprint function").not.toBeNull();
    expect(fingerprint?.[0]).not.toContain("language");

    const debounceDeps =
      /\}, \[waypoints, profile, avoidFerries, runCalculation\]\);/.exec(planningRoute);
    expect(debounceDeps, "debounce dependency array unchanged").not.toBeNull();
  });

  it("supplies the language to the calculation, captured once at its start", () => {
    expect(planningRoute).toContain("language: translator.language");
  });
});
