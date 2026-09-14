/**
 * The language model: what languages exist, which are actually available,
 * and how an effective language is resolved from a stored preference plus
 * the device's own ordered preference list.
 *
 * Backlog item 113. Deliberately dependency-free and free of React, DOM
 * and storage imports, so it stays a pure, fixture-testable module the
 * bootstrap path (src/main.tsx) can call before anything is rendered.
 */

/** A language the application can actually present. */
export type AppLanguage = "en" | "de";

/**
 * What the rider chose, which is not the same thing as what they get.
 * "device" means "follow the device's own language preferences", and is
 * the default for a rider who has never chosen.
 */
export type LanguagePreference = "device" | AppLanguage;

export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "device";

/** Where resolution lands when nothing else matches. */
export const FALLBACK_LANGUAGE: AppLanguage = "en";

/**
 * The supported-language gate.
 *
 * German is a first-class `AppLanguage` in the type system from the very
 * first slice — the catalogue infrastructure, the storage boundary and
 * every test fixture are built around both languages — but it is not
 * *available* until its catalogue is complete and has passed linguistic
 * review. This constant is what makes that true at runtime, and it is
 * deliberately the only thing that needs to change to enable it.
 *
 * Hiding the selector would not have been enough on its own: a German
 * device, or a preference row seeded by a test or left behind by a
 * later build on the same installation, would otherwise resolve to a
 * catalogue that does not exist yet. Note this is *not* a cross-device
 * sync case — IndexedDB does not synchronise between devices — it is
 * seeded data, a build moving backwards on one installation, or a
 * downgrade.
 *
 * Typed as `readonly AppLanguage[]` rather than inferred from the literal,
 * so that adding "de" here is a one-word change and every `includes`
 * check below keeps compiling either way.
 */
export const SUPPORTED_LANGUAGES: readonly AppLanguage[] = ["en"];

/**
 * What `document.documentElement.lang` becomes for each language.
 *
 * English keeps the `en-GB` this project has always declared (see
 * index.html) — British spelling is the rule for its copy. German is the
 * unregioned `de`: there is one German catalogue, resolution normalises
 * regional tags to a bare language, and CSS `:lang(de)` prefix-matches,
 * so a region here would add a distinction nothing consumes.
 */
export const DOCUMENT_LANGUAGE_TAGS: Readonly<Record<AppLanguage, string>> = {
  en: "en-GB",
  de: "de",
};

/**
 * The locale passed to `Intl` formatters. Kept separate from the document
 * tag on purpose: they happen to be equal today, but one is a declaration
 * about the document and the other is a formatting choice, and a future
 * change to either should not silently move the other.
 */
export const INTL_LOCALES: Readonly<Record<AppLanguage, string>> = {
  en: "en-GB",
  de: "de-DE",
};

/**
 * The slice of `navigator` this module reads, so tests need no global.
 *
 * Both fields are optional deliberately, even though the DOM lib declares
 * them as always present: this is read on the bootstrap path, before
 * anything is rendered, and an environment that omits one must produce a
 * fallback rather than a crash. Declaring them optional is what makes the
 * defensive checks below meaningful rather than dead code.
 */
export interface LanguageSource {
  readonly languages?: readonly string[];
  readonly language?: string;
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "de";
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "device" || isAppLanguage(value);
}

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return isAppLanguage(value) && SUPPORTED_LANGUAGES.includes(value);
}

/**
 * The primary subtag of a BCP 47 tag, lowercased — "de" from "de-AT",
 * "en" from "en-GB" — or undefined when it is not a language this
 * application knows at all. Unknown tags are *skipped* by the caller, not
 * treated as a reason to give up.
 */
function primaryLanguageSubtag(tag: string): AppLanguage | undefined {
  const primary = tag.trim().toLowerCase().split("-")[0];
  return isAppLanguage(primary) ? primary : undefined;
}

/**
 * Resolves the language actually used, from the stored preference and the
 * device's ordered list.
 *
 * Two properties are load-bearing and each has its own test:
 *
 * 1. **Order matters.** The first *supported* entry in `languages` wins,
 *    so ["en-GB", "de-DE"] is English and ["de-DE", "en-GB"] is German.
 *    An unsupported entry is skipped rather than ending the search, so
 *    ["fr-FR", "de-DE"] is German — "contains German" is not the rule,
 *    "prefers German over anything else it knows" is.
 * 2. **The gate constrains both branches.** An explicit override is
 *    checked against SUPPORTED_LANGUAGES exactly as device resolution is.
 *    A stored "de" while German is unavailable therefore falls through to
 *    the device list and then to the fallback — while the stored value
 *    itself stays untouched, so the rider's choice returns intact the
 *    moment German is enabled.
 */
export function resolveLanguage(
  preference: LanguagePreference,
  languages: readonly string[] | undefined,
): AppLanguage {
  if (preference !== "device" && isSupportedLanguage(preference)) {
    return preference;
  }
  for (const tag of languages ?? []) {
    const primary = primaryLanguageSubtag(tag);
    if (primary !== undefined && isSupportedLanguage(primary)) {
      return primary;
    }
  }
  return FALLBACK_LANGUAGE;
}

/**
 * The device's ordered language list, defensively. `navigator.languages`
 * is the ordered one and is what resolution wants; `navigator.language`
 * is the single-value fallback for environments that omit it or report it
 * empty. Never throws, so the bootstrap path can call it unguarded.
 *
 * "No navigator at all" is spelled `null`, not `undefined`: `undefined`
 * would select the default parameter and silently read the real global,
 * which is the opposite of what a caller passing it usually means.
 */
export function readNavigatorLanguages(
  source: LanguageSource | null = typeof navigator === "undefined" ? null : navigator,
): readonly string[] {
  if (source === null) return [];
  // Deliberately not Array.isArray: it widens a `readonly string[]` to
  // `any[]`, which then flows unchecked into the return type.
  const ordered: readonly string[] | undefined = source.languages;
  if (ordered !== undefined && ordered.length > 0) return ordered;
  return typeof source.language === "string" && source.language !== ""
    ? [source.language]
    : [];
}

/**
 * Declares the document's language.
 *
 * A plain function rather than an inline assignment in an effect: the
 * element is a value from outside the component, and this project's lint
 * rules — rightly — refuse direct mutation of one there. Naming the
 * operation also makes it the single place the document tag is written.
 */
export function applyDocumentLanguage(
  element: Pick<HTMLElement, "lang"> | null,
  language: AppLanguage,
): void {
  if (element === null) return;
  element.lang = DOCUMENT_LANGUAGE_TAGS[language];
}
