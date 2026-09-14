import { createContext } from "react";
import type { AppLanguage, LanguagePreference } from "./language.ts";
import type { Translator } from "./translate.ts";

export interface LanguageContextValue {
  translator: Translator;
  /** What the rider chose, which is not always what they get. */
  preference: LanguagePreference;
  /** What they actually get, after the supported-language gate. */
  language: AppLanguage;
  selectPreference: (preference: LanguagePreference) => void;
}

/**
 * Kept in its own module, separate from both the provider component and
 * the hooks that read it, so neither of those files exports a mix of
 * components and non-components — which would cost Fast Refresh during
 * development.
 */
export const LanguageContext = createContext<LanguageContextValue | null>(null);
