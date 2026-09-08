const WHITESPACE_RUN_PATTERN = /\s+/gu;

// Pinned to en-GB rather than the runtime default (mirrors
// ui/library/routeLibraryView.ts's own NAME_COLLATOR precedent) so
// suggestion ordering is deterministic across machines/CI, not dependent
// on the host's default locale. Deliberately a fresh, separate instance
// here rather than importing routeLibraryView.ts's collator: domain must
// not depend on ui. Module-level: Collator construction isn't free and
// the instance is stateless/reusable.
const TAG_DISPLAY_COLLATOR = new Intl.Collator("en-GB", {
  sensitivity: "base",
  numeric: true,
});

/**
 * The single identity key for a tag: two tags are the same identity when
 * their keys are equal. Extracted from normalizeRouteTags's own dedup
 * logic so every comparison anywhere in the app — draft membership,
 * suggestion pressed-state, toggle add/remove, in-draft duplicate checks,
 * write/live-query sync — uses exactly this rule, never a raw `===` or an
 * ad hoc `.toLowerCase()` on display strings. See normalizeRouteTags's own
 * doc comment for exactly what this does and does not unify.
 */
export function tagIdentityKey(tag: string): string {
  return tag.normalize("NFC").trim().replace(WHITESPACE_RUN_PATTERN, " ").toLowerCase();
}

/**
 * Deterministic normalisation, identity comparison, suggestion collection,
 * spelling resolution and display ordering for Route Library tags
 * (backlog item 100). Every write and read path in
 * storage/routesRepository.ts funnels tags through normalizeRouteTags so
 * identity never drifts between call sites; the UI layer (item 100 stage
 * 2) uses tagIdentityKey/tagsEqualByIdentity/resolveTagSpelling/
 * collectTagSuggestions/sortTagsForDisplay below so it never reimplements
 * any of these rules itself.
 *
 * - Non-array input normalises to `[]`.
 * - Only string entries survive; anything else is silently discarded.
 * - Each surviving string is Unicode-NFC-normalised, then trimmed with
 *   internal whitespace runs collapsed to one ordinary space.
 * - Empty/whitespace-only results are discarded.
 * - Two tags are treated as the same identity when they are equal after
 *   (a) NFC normalisation, (b) the whitespace handling above, and (c)
 *   ECMAScript's built-in `String.prototype.toLowerCase()` (never
 *   `.toLocaleLowerCase()`, so identity is stable across machines/CI
 *   locales) — see tagIdentityKey above. This is deterministic but is NOT
 *   full Unicode case folding: some linguistically case-equivalent pairs
 *   in some languages (e.g. German "ß"/"ss", Turkish dotted/dotless
 *   "İ"/"i") are not unified by plain `toLowerCase()`. Do not describe
 *   this as universal case equivalence.
 * - The FIRST spelling seen per identity is kept; first-occurrence order
 *   is preserved for everything that survives.
 *
 * NFC unifies only genuinely-identical visible text written with a
 * different Unicode composition (precomposed vs. combining-mark forms).
 * It does NOT fold diacritics: "café" and "cafe" remain distinct tags.
 * This is deliberately narrower than ui/library/routeLibraryView.ts's
 * normalizeSearchText (fuzzy search matching) — tag identity and search
 * matching are different concerns.
 *
 * Never mutates `input`; always returns a new array.
 */
export function normalizeRouteTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const firstSpellingByKey = new Map<string, string>();
  for (const entry of input) {
    if (typeof entry !== "string") continue;
    const normalized = entry.normalize("NFC").trim().replace(WHITESPACE_RUN_PATTERN, " ");
    if (normalized.length === 0) continue;
    const key = tagIdentityKey(normalized);
    if (!firstSpellingByKey.has(key)) firstSpellingByKey.set(key, normalized);
  }
  return [...firstSpellingByKey.values()];
}

/** Order-independent, count-aware identity-set equality: true only when
 * `a` and `b` contain the same tags by identity (spelling differences
 * ignored), regardless of order. Used to detect when a live-queried
 * route's canonical tags have caught up with a just-saved draft — see
 * RouteListItem.tsx's write/live-query sync effect. */
export function tagsEqualByIdentity(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bKeys = new Set(b.map(tagIdentityKey));
  return a.every((tag) => bKeys.has(tagIdentityKey(tag)));
}

/** Sorts a copy of `tags` for display: case-insensitive, numeric-aware,
 * en-GB collation. Never mutates the input. */
export function sortTagsForDisplay(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => TAG_DISPLAY_COLLATOR.compare(a, b));
}

/** Resolves what a freshly-typed tag candidate should actually become:
 * `null` if the candidate is empty/whitespace-only after normalisation (a
 * no-op signal for the caller); otherwise the candidate's own normalised
 * spelling, UNLESS an identity-equivalent tag already exists in
 * `knownTags`, in which case that existing tag's own established spelling
 * is returned instead (so a typed case/whitespace/NFC variant of a known
 * tag adopts the known spelling rather than creating a second identity). */
export function resolveTagSpelling(
  candidate: string,
  knownTags: readonly string[],
): string | null {
  const [resolved] = normalizeRouteTags([candidate]);
  if (resolved === undefined) return null;
  const key = tagIdentityKey(resolved);
  const match = knownTags.find((tag) => tagIdentityKey(tag) === key);
  return match ?? resolved;
}

/** The reusable-tag suggestion corpus for the Route Library tag editor
 * (backlog item 100 stage 2): every tag used by any route, deduplicated
 * by identity (first-occurrence spelling wins, following `routes`' own
 * given order) and sorted for display. Takes a minimal structural type
 * rather than LibraryRoute so this module doesn't need to import it. */
export function collectTagSuggestions(
  routes: readonly { tags: readonly string[] }[],
): string[] {
  return sortTagsForDisplay(normalizeRouteTags(routes.flatMap((route) => route.tags)));
}
