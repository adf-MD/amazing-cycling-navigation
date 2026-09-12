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

/** True when `tags` carries a tag whose identity equals `key` (backlog
 * item 100 stage 4A). Takes `unknown` and routes through
 * normalizeRouteTags, so a raw, legacy or malformed stored Dexie row is
 * safe to pass directly — no caller has to assume `string[]`. `key` is
 * itself re-keyed (tagIdentityKey is idempotent), so a caller that
 * accidentally passes a display spelling still gets identity semantics. */
export function tagsContainIdentity(tags: unknown, key: string): boolean {
  const wanted = tagIdentityKey(key);
  return normalizeRouteTags(tags).some((tag) => tagIdentityKey(tag) === wanted);
}

/** Rewrites one route's tags for a global rename, merge or display-only
 * respelling (backlog item 100 stage 4A): every tag whose identity equals
 * `sourceKey` OR equals the target's own identity becomes
 * `targetSpelling`, and the result is normalised.
 *
 * Mapping the TARGET identity as well as the source is what makes a merge
 * correct WITHIN an affected row: a route carrying both tags collapses to
 * exactly one entry, and both spellings converge on targetSpelling. It is
 * deliberately not a row-SELECTION rule — storage/routesRepository.ts
 * selects candidate rows by the source identity alone, so a route that
 * only ever carried the target is left untouched.
 *
 * The surviving tag takes the earliest position of either occurrence and
 * unrelated tags keep their relative order, both falling out of
 * normalizeRouteTags's existing first-occurrence ordering rather than any
 * new ordering logic. Never mutates the input. */
export function applyTagRename(
  tags: unknown,
  sourceKey: string,
  targetSpelling: string,
): string[] {
  const wantedSource = tagIdentityKey(sourceKey);
  const wantedTarget = tagIdentityKey(targetSpelling);
  return normalizeRouteTags(
    normalizeRouteTags(tags).map((tag) => {
      const key = tagIdentityKey(tag);
      return key === wantedSource || key === wantedTarget ? targetSpelling : tag;
    }),
  );
}

/** Rewrites one route's tags for a global delete (backlog item 100 stage
 * 4A): every tag whose identity equals `sourceKey` is dropped and the
 * remainder normalised. Deleting a tag never deletes a route — a route
 * left with no tags stores `[]`. Never mutates the input. */
export function applyTagRemoval(tags: unknown, sourceKey: string): string[] {
  const wanted = tagIdentityKey(sourceKey);
  return normalizeRouteTags(
    normalizeRouteTags(tags).filter((tag) => tagIdentityKey(tag) !== wanted),
  );
}

/** How many ROUTES (never occurrences) carry each tag identity in THE
 * SUPPLIED ROUTE COLLECTION, keyed by tagIdentityKey (backlog item 100
 * stage 4A). Takes the same minimal structural type as
 * collectTagSuggestions, and reuses normalizeRouteTags per route so a
 * route listing two spellings of one identity still counts once.
 *
 * The scope is the caller's choice, and the two callers choose
 * differently on purpose:
 *
 * - The global tag manager deliberately supplies the FULL UNFILTERED
 *   corpus, so a tag hidden by the current search or tag filter is still
 *   manageable with its true route count.
 * - Backlog item 111's prospective tag-filter counts supply the CURRENT
 *   RESULT SET instead (name-searched, then narrowed by the selected tag
 *   identities). Because AND-narrowing is monotone, a candidate tag's
 *   count within that already-narrowed set is exactly the number of
 *   routes that would remain were it added to the selection — so one
 *   pass answers every candidate at once. See
 *   ui/library/routeLibraryView.ts's selectProspectiveTagFilterCounts.
 *
 * A tag absent from the supplied collection is simply absent from the
 * returned map; it is never reported as a zero entry. */
export function countRoutesByTagIdentity(
  routes: readonly { tags: readonly string[] }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const route of routes) {
    for (const tag of normalizeRouteTags(route.tags)) {
      const key = tagIdentityKey(tag);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}
