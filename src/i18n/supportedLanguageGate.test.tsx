import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import settingsSource from "../ui/settings/SettingsScreen.tsx?raw";
import { LanguageProvider } from "./LanguageProvider.tsx";
import { CATALOGUES } from "./catalogues.ts";
import { SUPPORTED_LANGUAGES, resolveLanguage } from "./language.ts";
import { en } from "./messages.en.ts";
import { RouteTagManager } from "./../ui/library/RouteTagManager.tsx";

/**
 * Backlog item 113. The supported-language gate, now that stage 6b has
 * opened it.
 *
 * Through stages 1 to 6a this file asserted German was unreachable. Those
 * assertions have flipped, which is exactly what they were for: enabling
 * German could not be done quietly, and each flip below is a deliberate,
 * reviewed change rather than a silent one.
 *
 * What the gate still governs has not changed, and is what the rest of
 * this file pins: `resolveLanguage` returns only a member of
 * `SUPPORTED_LANGUAGES`, from either branch; an unrecognised tag is
 * skipped rather than treated as a fallback trigger; and a stored
 * preference is never rewritten by being read.
 */

describe("German is available", () => {
  it("is a supported language", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["en", "de"]);
  });

  it("has a bundled catalogue", () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual(["de", "en"]);
    expect(CATALOGUES.de).toBeDefined();
  });

  it("is offered by a language selector in Settings", () => {
    expect(settingsSource).toContain("selectPreference");
    expect(Object.keys(en)).toContain("settings.language.heading");
  });

  it("resolves a German device to German, at every regional tag", () => {
    for (const languages of [["de"], ["de-DE"], ["de-AT"], ["de-CH"], ["de", "en"]]) {
      expect(resolveLanguage("device", languages), languages.join(",")).toBe("de");
    }
  });

  it("resolves an explicitly stored German preference to German", () => {
    expect(resolveLanguage("de", ["en-GB"])).toBe("de");
  });
});

describe("the gate still governs what is reachable", () => {
  it("returns only a supported language, from either branch", () => {
    for (const preference of ["device", "en", "de"] as const) {
      expect(SUPPORTED_LANGUAGES).toContain(resolveLanguage(preference, ["fr-FR"]));
    }
  });

  it("still prefers the first supported device entry, in order", () => {
    expect(resolveLanguage("device", ["en-GB", "de-DE"])).toBe("en");
    expect(resolveLanguage("device", ["de-DE", "en-GB"])).toBe("de");
  });

  it("still skips an unsupported entry rather than falling back at it", () => {
    expect(resolveLanguage("device", ["fr-FR", "de-DE"])).toBe("de");
    expect(resolveLanguage("device", ["fr-FR", "es-ES"])).toBe("en");
  });

  it("still falls back to English for an unknown explicit preference", () => {
    expect(resolveLanguage("fr" as never, ["fr-FR"])).toBe("en");
  });
});

describe("a migrated screen under a German device", () => {
  function renderTagManager(preference: "device" | "en" | "de") {
    return render(
      <LanguageProvider
        preference={preference}
        readLanguages={() => ["de-DE", "de"]}
        documentElement={{ lang: "" }}
      >
        <RouteTagManager
          panelId="p"
          tags={["Hills"]}
          routeCountsByTagKey={new Map([["hills", 2]])}
          sourceKey=""
          newName=""
          isBusy={false}
          errorMessage={null}
          confirmation={null}
          onSourceKeyChange={vi.fn<(key: string) => void>()}
          onNewNameChange={vi.fn<(name: string) => void>()}
          onRenameRequest={vi.fn<() => void>()}
          onDeleteRequest={vi.fn<() => void>()}
          onConfirm={vi.fn<() => void>()}
          onCancelConfirm={vi.fn<() => void>()}
          onClose={vi.fn<() => void>()}
        />
      </LanguageProvider>,
    );
  }

  it("renders German with a German device language", () => {
    const { unmount } = renderTagManager("device");
    expect(screen.getByRole("heading", { name: "Tags verwalten" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Hills (2 Routen)" })).toBeInTheDocument();
    unmount();
  });

  it("renders German with a stored German preference", () => {
    const { unmount } = renderTagManager("de");
    expect(screen.getByRole("heading", { name: "Tags verwalten" })).toBeInTheDocument();
    unmount();
  });

  it("renders English when English is chosen explicitly, whatever the device says", () => {
    // The override wins over a German device list; the negative control
    // for the resolution order.
    const { unmount } = renderTagManager("en");
    expect(screen.getByRole("heading", { name: "Manage tags" })).toBeInTheDocument();
    unmount();
  });

  it("renders the rider's own tag verbatim in both languages", () => {
    // The tag is user content and is never translated, only surrounded by
    // different words.
    const german = renderTagManager("de");
    expect(screen.getByRole("option", { name: "Hills (2 Routen)" })).toBeInTheDocument();
    german.unmount();
    renderTagManager("en");
    expect(screen.getByRole("option", { name: "Hills (2 routes)" })).toBeInTheDocument();
  });

  it("declares de on the document under a German preference, and en-GB under English", () => {
    const germanElement = { lang: "" };
    const german = render(
      <LanguageProvider
        preference="de"
        readLanguages={() => ["de-DE"]}
        documentElement={germanElement}
      >
        <span />
      </LanguageProvider>,
    );
    expect(germanElement.lang).toBe("de");
    german.unmount();

    const englishElement = { lang: "" };
    render(
      <LanguageProvider
        preference="en"
        readLanguages={() => ["de-DE"]}
        documentElement={englishElement}
      >
        <span />
      </LanguageProvider>,
    );
    expect(englishElement.lang).toBe("en-GB");
  });
});
