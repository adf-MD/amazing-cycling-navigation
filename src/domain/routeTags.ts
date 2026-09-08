const WHITESPACE_RUN_PATTERN = /\s+/gu;

/**
 * Deterministic normalisation for Route Library tags (backlog item 100).
 * Every write and read path in storage/routesRepository.ts funnels tags
 * through this function so identity never drifts between call sites.
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
 *   locales). This is deterministic but is NOT full Unicode case
 *   folding: some linguistically case-equivalent pairs in some languages
 *   (e.g. German "ß"/"ss", Turkish dotted/dotless "İ"/"i") are not
 *   unified by plain `toLowerCase()`. Do not describe this as universal
 *   case equivalence.
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
    const key = normalized.toLowerCase();
    if (!firstSpellingByKey.has(key)) firstSpellingByKey.set(key, normalized);
  }
  return [...firstSpellingByKey.values()];
}
