import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { LanguageProvider } from "./LanguageProvider.tsx";
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
