import { en } from "./messages.en.ts";
import type { AppLanguage } from "./language.ts";
import type { Catalogue } from "./translate.ts";

/**
 * Every available catalogue, keyed by language.
 *
 * Backlog item 113. Bundled, never fetched: the application's own
 * Content-Security-Policy allows `connect-src` only to the tile and
 * routing hosts, so a network-loaded catalogue could not work offline and
 * could not be requested at all.
 *
 * **German is deliberately absent.** Its catalogue is authored and
 * reviewed in a later stage; until then `SUPPORTED_LANGUAGES` in
 * language.ts cannot resolve to it, so nothing can ask for it here. The
 * partial signature is what makes those two facts one fact rather than
 * two that could drift apart.
 */
export const CATALOGUES: Partial<Readonly<Record<AppLanguage, Catalogue>>> = {
  en,
};

/**
 * The catalogue for a language, falling back to English. Total by
 * construction: English is always present, and is the complete fallback
 * this project requires.
 */
export function catalogueFor(language: AppLanguage): Catalogue {
  return CATALOGUES[language] ?? en;
}
