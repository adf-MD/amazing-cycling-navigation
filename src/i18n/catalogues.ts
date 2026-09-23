import { de } from "./messages.de.ts";
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
 * German joined this map in stage 6b, after its wording was reviewed.
 * The signature stays `Partial` deliberately: `catalogueFor` must remain
 * total whatever `AppLanguage` grows to, and English is the complete
 * fallback this project requires.
 */
export const CATALOGUES: Partial<Readonly<Record<AppLanguage, Catalogue>>> = {
  en,
  de,
};

/**
 * The catalogue for a language, falling back to English. Total by
 * construction: English is always present, and is the complete fallback
 * this project requires.
 */
export function catalogueFor(language: AppLanguage): Catalogue {
  return CATALOGUES[language] ?? en;
}
