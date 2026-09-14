import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyDocumentLanguage,
  readNavigatorLanguages,
  resolveLanguage,
  type LanguagePreference,
} from "./language.ts";
import { catalogueFor } from "./catalogues.ts";
import { createTranslator } from "./translate.ts";
import { LanguageContext, type LanguageContextValue } from "./languageContext.ts";

export interface LanguageProviderProps {
  children: ReactNode;
  /**
   * Controlled. There is exactly one source of truth for the preference —
   * the stored row — and this component never holds its own copy. That is
   * what makes a late storage read correct the interface for free: the
   * owner re-renders with the value it eventually read, and nothing here
   * has to reconcile two versions of the same fact.
   */
  preference: LanguagePreference;
  /** Invoked when the rider chooses; the owner persists it. */
  onSelectPreference?: (preference: LanguagePreference) => void;
  /** Overridable for tests; defaults to the real navigator. */
  readLanguages?: () => readonly string[];
  /** Overridable for tests; defaults to the real document element. */
  documentElement?: Pick<HTMLElement, "lang"> | null;
}

export function LanguageProvider({
  children,
  preference,
  onSelectPreference,
  readLanguages = defaultReadLanguages,
  documentElement = typeof document === "undefined" ? null : document.documentElement,
}: LanguageProviderProps) {
  const [deviceLanguages, setDeviceLanguages] =
    useState<readonly string[]>(readLanguages);

  /**
   * The device's own preferences can change while the application runs — a
   * rider changing the system language and returning to an already-open
   * PWA. That only matters while the preference is "device": an explicit
   * override always wins, so the listener is not attached at all under
   * one, rather than attached and then ignored.
   */
  useEffect(() => {
    if (preference !== "device") return;
    const handleLanguageChange = () => {
      setDeviceLanguages(readLanguages());
    };
    window.addEventListener("languagechange", handleLanguageChange);
    return () => {
      window.removeEventListener("languagechange", handleLanguageChange);
    };
  }, [preference, readLanguages]);

  const language = resolveLanguage(preference, deviceLanguages);

  useEffect(() => {
    applyDocumentLanguage(documentElement, language);
  }, [language, documentElement]);

  const selectPreference = useCallback(
    (next: LanguagePreference) => {
      // Re-read the device list on every explicit change, so returning to
      // "device" uses the list as it is now rather than as it was when
      // this component mounted.
      setDeviceLanguages(readLanguages());
      onSelectPreference?.(next);
    },
    [onSelectPreference, readLanguages],
  );

  /**
   * Memoised on the language ALONE, deliberately not folded into the
   * context value below.
   *
   * Backlog item 113 stage 4. Riding's components call `useTranslate()`,
   * and Riding's effects start a geolocation watch, acquire a wake lock
   * and create the map and its camera. A translator whose identity moved
   * whenever some unrelated part of the context did would put a new value
   * into any dependency array containing it, restarting exactly those
   * lifecycles for no reason.
   *
   * Keying it on `selectPreference` — which is what folding it into the
   * value object effectively did — was the concrete hazard: that callback
   * changes whenever a caller passes an inline `readLanguages`, which is
   * easy to do and silently destabilises every consumer. The translator
   * depends on the language and nothing else, so that is what it is keyed
   * on, and `translatorStability.test.tsx` asserts the consequence rather
   * than trusting the reasoning.
   */
  const translator = useMemo(
    () => createTranslator(language, catalogueFor(language)),
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ translator, preference, language, selectPreference }),
    [translator, language, preference, selectPreference],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

function defaultReadLanguages(): readonly string[] {
  return readNavigatorLanguages();
}
