import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import settingsSource from "../ui/settings/SettingsScreen.tsx?raw";
import { LanguageProvider } from "./LanguageProvider.tsx";
import { CATALOGUES } from "./catalogues.ts";
import { SUPPORTED_LANGUAGES, resolveLanguage } from "./language.ts";
import { en } from "./messages.en.ts";
import { RouteTagManager } from "./../ui/library/RouteTagManager.tsx";

/**
 * Backlog item 113. The gate that keeps German unreachable until its
 * catalogue is complete and has passed linguistic review, asserted at the
 * boundary and against a real migrated screen.
 *
 * Several assertions here flip when German ships. That is the point: it
 * must not be possible to enable German quietly.
 */

describe("German cannot be reached", () => {
  it("is not an available language", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["en"]);
  });

  it("has no bundled catalogue", () => {
    expect(Object.keys(CATALOGUES)).toEqual(["en"]);
    expect(CATALOGUES.de).toBeUndefined();
  });

  it("has no production German catalogue module on disk", () => {
    // Not a partial one, not a copied-English stub. German wording is
    // authored once, in the stage that also reviews it.
    // Vite's own module graph rather than a filesystem read: it resolves
    // exactly what the bundle would include, which is the thing that
    // actually matters for "no German catalogue ships".
    const messageModules = Object.keys(
      import.meta.glob("./messages.*.ts", { eager: false }),
    ).sort();
    expect(messageModules).toEqual(["./messages.en.ts"]);
  });

  it("offers no language selector anywhere in the interface", () => {
    // Stage 1 deliberately shipped no selector: a control offering only
    // English would be rider-facing noise. Its absence is also the second,
    // independent reason German is unreachable.
    expect(settingsSource).not.toContain("selectPreference");
    expect(Object.keys(en)).not.toContain("settings.language.heading");
  });

  it("resolves a German device to English", () => {
    for (const languages of [["de"], ["de-DE"], ["de-AT"], ["de-CH"], ["de", "en"]]) {
      expect(resolveLanguage("device", languages)).toBe("en");
    }
  });

  it("resolves an explicitly stored German preference to English", () => {
    expect(resolveLanguage("de", ["de-DE"])).toBe("en");
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

  it("still renders English with a German device language", () => {
    const { unmount } = renderTagManager("device");
    expect(screen.getByRole("heading", { name: "Manage tags" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Hills (2 routes)" })).toBeInTheDocument();
    unmount();
  });

  it("still renders English with a stored German preference", () => {
    const { unmount } = renderTagManager("de");
    expect(screen.getByRole("heading", { name: "Manage tags" })).toBeInTheDocument();
    unmount();
  });

  it("declares en-GB on the document even under a German preference", () => {
    const documentElement = { lang: "" };
    render(
      <LanguageProvider
        preference="de"
        readLanguages={() => ["de-DE"]}
        documentElement={documentElement}
      >
        <span />
      </LanguageProvider>,
    );
    expect(documentElement.lang).toBe("en-GB");
  });
});
