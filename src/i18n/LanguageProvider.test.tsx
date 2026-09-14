import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LanguageProvider } from "./LanguageProvider.tsx";
import { useLanguageContext, useTranslate } from "./useTranslate.ts";
import type { LanguagePreference } from "./language.ts";

function Probe() {
  const { t } = useTranslate();
  const context = useLanguageContext();
  return (
    <>
      <p data-testid="label">{t("nav.settings")}</p>
      <p data-testid="language">{context?.language ?? "no-provider"}</p>
      <p data-testid="preference">{context?.preference ?? "no-provider"}</p>
    </>
  );
}

function renderWithLanguages(
  preference: LanguagePreference,
  languages: readonly string[],
  documentElement: { lang: string } = { lang: "" },
) {
  const view = render(
    <LanguageProvider
      preference={preference}
      readLanguages={() => languages}
      documentElement={documentElement}
    >
      <Probe />
    </LanguageProvider>,
  );
  return { view, documentElement };
}

describe("LanguageProvider", () => {
  it("renders English for a device that asks for English", () => {
    renderWithLanguages("device", ["en-GB"]);
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(screen.getByTestId("label")).toHaveTextContent("Settings");
  });

  it("renders English for a German device, because German is not available yet", () => {
    // The supported-language gate, end to end through the provider. This
    // assertion flips when German's catalogue ships and its own gate
    // constant changes — deliberately, so enabling German cannot happen
    // quietly.
    renderWithLanguages("device", ["de-DE", "en-GB"]);
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(screen.getByTestId("label")).toHaveTextContent("Settings");
  });

  it("keeps a stored German preference visible while still rendering English", () => {
    // What the rider chose and what they get are different facts, and the
    // context exposes both. The choice is never rewritten to match the
    // outcome.
    renderWithLanguages("de", ["de-DE"]);
    expect(screen.getByTestId("preference")).toHaveTextContent("de");
    expect(screen.getByTestId("language")).toHaveTextContent("en");
  });

  it("declares the document language for the resolved language", () => {
    const documentElement = { lang: "" };
    renderWithLanguages("device", ["en-GB"], documentElement);
    expect(documentElement.lang).toBe("en-GB");
  });

  it("updates the document language when the preference changes", () => {
    const documentElement = { lang: "" };
    const { rerender } = render(
      <LanguageProvider
        preference="device"
        readLanguages={() => ["en-GB"]}
        documentElement={documentElement}
      >
        <Probe />
      </LanguageProvider>,
    );
    expect(documentElement.lang).toBe("en-GB");
    rerender(
      <LanguageProvider
        preference="en"
        readLanguages={() => ["de-DE"]}
        documentElement={documentElement}
      >
        <Probe />
      </LanguageProvider>,
    );
    expect(documentElement.lang).toBe("en-GB");
  });
});

describe("languagechange", () => {
  it("re-reads the device list while the preference follows the device", () => {
    let languages: readonly string[] = ["fr-FR"];
    const readLanguages = vi.fn(() => languages);
    render(
      <LanguageProvider
        preference="device"
        readLanguages={readLanguages}
        documentElement={{ lang: "" }}
      >
        <Probe />
      </LanguageProvider>,
    );
    const callsBefore = readLanguages.mock.calls.length;

    languages = ["en-GB"];
    act(() => {
      window.dispatchEvent(new Event("languagechange"));
    });

    expect(readLanguages.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.getByTestId("language")).toHaveTextContent("en");
  });

  it("does not listen at all while an explicit override is selected", () => {
    // An override always wins, so the listener is not attached rather than
    // attached and then ignored — which is also what makes this testable
    // by counting reads.
    const readLanguages = vi.fn(() => ["fr-FR"]);
    render(
      <LanguageProvider
        preference="en"
        readLanguages={readLanguages}
        documentElement={{ lang: "" }}
      >
        <Probe />
      </LanguageProvider>,
    );
    const callsBefore = readLanguages.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event("languagechange"));
    });

    expect(readLanguages.mock.calls.length).toBe(callsBefore);
  });

  it("removes its listener on unmount", () => {
    const readLanguages = vi.fn(() => ["en-GB"]);
    const { unmount } = render(
      <LanguageProvider
        preference="device"
        readLanguages={readLanguages}
        documentElement={{ lang: "" }}
      >
        <Probe />
      </LanguageProvider>,
    );
    unmount();
    const callsAfterUnmount = readLanguages.mock.calls.length;

    window.dispatchEvent(new Event("languagechange"));

    expect(readLanguages.mock.calls.length).toBe(callsAfterUnmount);
  });
});

describe("useTranslate without a provider", () => {
  it("falls back to English rather than throwing", () => {
    // A very large body of existing component tests renders single screens
    // directly. English is this application's complete fallback, so an
    // unwrapped render is English, never a crash.
    render(<Probe />);
    expect(screen.getByTestId("label")).toHaveTextContent("Settings");
    expect(screen.getByTestId("language")).toHaveTextContent("no-provider");
  });
});

describe("selectPreference", () => {
  it("hands the choice to its owner rather than storing one itself", () => {
    // Controlled on purpose: the stored row is the single source of truth,
    // which is what lets a late bootstrap read correct the interface with
    // no reconciliation.
    const onSelectPreference = vi.fn();
    function Chooser() {
      const context = useLanguageContext();
      return (
        <button
          type="button"
          onClick={() => {
            context?.selectPreference("de");
          }}
        >
          choose
        </button>
      );
    }
    render(
      <LanguageProvider
        preference="device"
        onSelectPreference={onSelectPreference}
        readLanguages={() => ["en-GB"]}
        documentElement={{ lang: "" }}
      >
        <Chooser />
      </LanguageProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "choose" }).click();
    });
    expect(onSelectPreference).toHaveBeenCalledWith("de");
  });
});
