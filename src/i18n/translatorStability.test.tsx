import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { LanguageProvider } from "./LanguageProvider.tsx";
import { en } from "./messages.en.ts";
import { useTranslate } from "./useTranslate.ts";
import { englishTranslator } from "./englishTranslator.ts";

/**
 * Backlog item 113 stage 4. Riding's own effects start a geolocation
 * watch, acquire a wake lock and create the map and its camera. Several
 * of those components now call `useTranslate()`, so the translator's
 * identity becomes part of their render — and an identity that changed on
 * every render would put a new value into any dependency array that
 * included it, restarting exactly the lifecycles this application spends
 * most of its care protecting.
 *
 * The guarantee is therefore asserted directly rather than assumed: the
 * translator is one memoised object while the language is unchanged, and
 * one shared module constant when no provider is mounted.
 */

function useTranslatorIdentities(record: (translator: unknown) => void) {
  const translator = useTranslate();
  useEffect(() => {
    record(translator);
  });
  return translator;
}

describe("translator identity", () => {
  it("does not change across ordinary rerenders under a provider", () => {
    const seen: unknown[] = [];
    function Probe() {
      const [, setTick] = useState(0);
      useTranslatorIdentities((translator) => seen.push(translator));
      return (
        <button
          type="button"
          onClick={() => {
            setTick((tick) => tick + 1);
          }}
        >
          rerender
        </button>
      );
    }

    const { getByRole, rerender } = render(
      <LanguageProvider
        preference="device"
        readLanguages={() => ["en-GB"]}
        documentElement={{ lang: "" }}
      >
        <Probe />
      </LanguageProvider>,
    );

    getByRole("button").click();
    rerender(
      <LanguageProvider
        preference="device"
        readLanguages={() => ["en-GB"]}
        documentElement={{ lang: "" }}
      >
        <Probe />
      </LanguageProvider>,
    );

    expect(seen.length).toBeGreaterThan(1);
    for (const translator of seen) {
      expect(translator).toBe(seen[0]);
    }
  });

  it("is one shared constant when no provider is mounted", () => {
    // The path every existing single-screen component test takes.
    const seen: unknown[] = [];
    function Probe() {
      useTranslatorIdentities((translator) => seen.push(translator));
      return null;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    expect(seen.length).toBeGreaterThan(1);
    for (const translator of seen) {
      expect(translator).toBe(englishTranslator);
    }
  });

  it("does not re-run an effect that depends on it, across rerenders", () => {
    // The property that actually matters: a lifecycle effect keyed on the
    // translator must fire once, not once per render. This is what keeps
    // a copy change from restarting a geolocation watch or a wake lock.
    const effect = vi.fn();
    function Probe() {
      const [, setTick] = useState(0);
      const translator = useTranslate();
      useEffect(() => {
        effect();
      }, [translator]);
      return (
        <button
          type="button"
          onClick={() => {
            setTick((tick) => tick + 1);
          }}
        >
          rerender
        </button>
      );
    }

    const { getByRole } = render(
      <LanguageProvider
        preference="device"
        readLanguages={() => ["en-GB"]}
        documentElement={{ lang: "" }}
      >
        <Probe />
      </LanguageProvider>,
    );
    getByRole("button").click();
    getByRole("button").click();

    expect(effect).toHaveBeenCalledTimes(1);
  });
});

describe("stage 5 lifecycles never depend on copy", () => {
  const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(
      import.meta.glob("../{pwa,storage,platform}/*.ts", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    ).map(([path, source]) => [path, source]),
  );

  it("keeps the translator out of service-worker, storage and platform modules", () => {
    // The strongest guarantee available: these modules never see a
    // translator, so nothing about copy can reach a dependency array that
    // registers a service worker, opens IndexedDB or starts a watch.
    // `geolocation.ts` is deliberately included — its retained English
    // messages are diagnostics, and no screen renders them.
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.includes(".test.")) continue;
      expect(source, path).not.toContain("useTranslate");
      expect(source, path).not.toContain("i18n/translate.ts");
      expect(source, path).not.toContain("englishTranslator");
    }
  });

  it("registers the update hook once, however many times copy rerenders", async () => {
    // A real render of the shell: the update hook must be called on each
    // render (it is a hook) while the registration it wraps runs once.
    const register = vi.fn();
    function useFakeRegistration() {
      useEffect(() => {
        register();
      }, []);
      return null;
    }
    function Probe() {
      const [, setTick] = useState(0);
      useTranslate();
      useFakeRegistration();
      return (
        <button
          type="button"
          onClick={() => {
            setTick((tick) => tick + 1);
          }}
        >
          rerender
        </button>
      );
    }
    const { getByRole } = render(
      <LanguageProvider
        preference="device"
        readLanguages={() => ["en-GB"]}
        documentElement={{ lang: "" }}
      >
        <Probe />
      </LanguageProvider>,
    );
    getByRole("button").click();
    getByRole("button").click();
    await Promise.resolve();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("keeps the update prompt's copy in the catalogue and its mechanism out", () => {
    const pwa = Object.entries(SOURCES).find(([path]) => path.endsWith("/registerSW.ts"));
    expect(pwa).toBeDefined();
    const source = pwa?.[1] ?? "";
    // The mechanism: registration, update detection, reload and dismissal
    // all stay exactly where they were.
    for (const kept of [
      "useRegisterSW",
      "updateServiceWorker(true)",
      "setNeedRefresh(false)",
    ]) {
      expect(source, kept).toContain(kept);
    }
    // And it authors no copy at all — the shell renders the catalogue.
    expect(source).not.toContain("An update is ready");
    expect(en["update.ready"]).toBe("An update is ready.");
    expect(en["update.now"]).toBe("Update now");
    expect(en["update.later"]).toBe("Later");
  });
});
