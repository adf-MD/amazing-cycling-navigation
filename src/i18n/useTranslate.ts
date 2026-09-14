import { useContext } from "react";
import { englishTranslator } from "./englishTranslator.ts";
import { LanguageContext, type LanguageContextValue } from "./languageContext.ts";
import type { Translator } from "./translate.ts";

/**
 * The translator for the active language.
 *
 * Falls back to an English translator when no provider is mounted, rather
 * than throwing. A large body of existing component tests renders single
 * screens directly, and English is this application's complete fallback by
 * design — so an unwrapped render is English, never a crash. A test that
 * cares about the language wraps its subject in a provider explicitly.
 */
export function useTranslate(): Translator {
  const context = useContext(LanguageContext);
  return context?.translator ?? englishTranslator;
}

/** The full language context, for the parts of the UI that change it. */
export function useLanguageContext(): LanguageContextValue | null {
  return useContext(LanguageContext);
}
