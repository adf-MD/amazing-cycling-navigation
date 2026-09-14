import type { Translator } from "../../i18n/translate.ts";

/**
 * "1 route" / "3 routes" — the route tally used inside several longer
 * sentences and in the Manage tags list.
 *
 * Deliberately a neutral leaf module, not part of tagLifecycleMessages.ts,
 * whose header claims every count in it is the repository's own
 * authoritative value rather than a pre-submit UI count.
 *
 * Backlog item 113 stage 2: the singular/plural choice is now made by
 * `Intl.PluralRules` for the active locale rather than by an `=== 1`
 * test, so a language with different plural categories selects correctly.
 * English output is unchanged — `Intl.PluralRules("en-GB")` reports `one`
 * for 1 and `other` for everything else, which is exactly what the old
 * test did.
 *
 * The translator is passed explicitly rather than read from React
 * context, so this stays a pure function that a fixture test can call
 * without rendering anything.
 */
export function formatRouteCount(translator: Translator, count: number): string {
  return translator.plural("routes.count", count);
}
