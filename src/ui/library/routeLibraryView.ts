import type { LibraryRoute, PlannedRoute } from "../../domain/types.ts";
import { countRoutesByTagIdentity, tagIdentityKey } from "../../domain/routeTags.ts";
import type { RouteLibrarySortOrder } from "../../storage/mapping.ts";
import { formatRouteCount } from "./routeCountCopy.ts";

// Pinned to en-GB rather than the runtime default (see
// providerKeyStatus.ts's DATE_TIME_FORMATTER for the same convention) so
// ordering is deterministic across machines/CI, not dependent on the
// host's default locale. Module-level: Collator construction isn't free
// and the instance is stateless/reusable.
const NAME_COLLATOR = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

// Strips Unicode combining diacritical marks (the U+0300-U+036F block)
// left behind by NFD decomposition, so e.g. "Hütte" normalises to the
// same text as "hutte" for substring matching. Written as an explicit
// \u escape range, not literal combining characters, so it stays legible
// and unambiguous in source.
const COMBINING_DIACRITICS_PATTERN = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_PATTERN, "");
}

/** Case- and diacritic-insensitive substring match on route name only. An
 * empty/whitespace-only query matches every route. Never mutates or
 * returns the same array reference as `routes`. Generic over T so a
 * caller holding the stronger LibraryRoute guarantee (item 100 stage 2)
 * gets it back unweakened, while existing PlannedRoute[] callers are
 * unaffected. */
export function filterRoutesByName<T extends PlannedRoute>(
  routes: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [...routes];
  }
  return routes.filter((route) =>
    normalizeSearchText(route.name).includes(normalizedQuery),
  );
}

/** Narrows `routes` to those carrying EVERY selected tag (AND semantics),
 * matched by identity (tagIdentityKey), never display-string equality — a
 * filter chip selected as "Gravel" still matches a route whose own stored
 * tag is "gravel". `tagKeys` is a set of ALREADY-canonicalised
 * tagIdentityKey outputs, never raw display spellings — the caller
 * computes these once, so this function never re-derives identity logic
 * itself, matching domain/routeTags.ts's own single-normalisation-
 * authority contract. An empty `tagKeys` matches every route (mirrors
 * filterRoutesByName's own empty-query passthrough) via a vacuous
 * `.every()`, not a special case.
 *
 * Bound to LibraryRoute (guaranteed `tags: string[]`), not a defensively-
 * optional PlannedRoute — the only real caller (selectRouteLibraryGroups,
 * below) always supplies LibraryRoute[]. Legacy/malformed-row
 * compatibility is already proven at storage/routesRepository.ts's own
 * boundary, where a Dexie row becomes a canonical LibraryRoute; it is not
 * re-proven here. Never mutates or returns the same array reference as
 * `routes`. */
export function filterRoutesByTags<T extends LibraryRoute>(
  routes: readonly T[],
  tagKeys: ReadonlySet<string>,
): T[] {
  return routes.filter((route) => {
    const routeKeys = new Set(route.tags.map(tagIdentityKey));
    return [...tagKeys].every((key) => routeKeys.has(key));
  });
}

/** Sorts a copy of `routes` (never mutates the input — Array.prototype.sort
 * is in-place and `routes` may be the exact array reference React state
 * holds). "most-recent" preserves PlannedRoute.createdAt descending, the
 * app's pre-existing meaning; "name-asc" uses locale-aware, case-
 * insensitive, numeric-aware collation (so "Route 2" sorts before
 * "Route 10"); "distance-desc"/"ascent-desc" order by the route's own
 * canonical distanceMetres/ascentMetres, descending. Every order is
 * tie-broken deterministically by route id. */
export function sortRoutesForLibrary<T extends PlannedRoute>(
  routes: readonly T[],
  sortOrder: RouteLibrarySortOrder,
): T[] {
  const copy = [...routes];
  copy.sort((a, b) => compareRoutesForSort(a, b, sortOrder));
  return copy;
}

/** An exhaustive switch, not an if/else chain, so a future RouteLibrarySortOrder
 * value that's added without a case here is a TypeScript compile error (the
 * `default` branch's `never` assignment) rather than silently falling
 * through to "most-recent" behaviour. */
function compareRoutesForSort(
  a: PlannedRoute,
  b: PlannedRoute,
  sortOrder: RouteLibrarySortOrder,
): number {
  switch (sortOrder) {
    case "most-recent": {
      const timeDifference =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return timeDifference !== 0 ? timeDifference : compareIds(a.id, b.id);
    }
    case "name-asc":
      return NAME_COLLATOR.compare(a.name, b.name) || compareIds(a.id, b.id);
    case "distance-desc":
      return b.distanceMetres - a.distanceMetres || compareIds(a.id, b.id);
    case "ascent-desc":
      return (
        compareAscentDescendingWithUnknownLast(a.ascentMetres, b.ascentMetres) ||
        compareIds(a.id, b.id)
      );
    default: {
      const exhaustive: never = sortOrder;
      throw new Error(`Unhandled RouteLibrarySortOrder: ${String(exhaustive)}`);
    }
  }
}

/** A route's total ascent can be unknown (null, e.g. a legacy/imported route
 * with no usable elevation summary) rather than merely small — null must
 * never be conflated with zero, and it always sorts after every known
 * value (a descending sort must not resurrect unknown routes to the
 * front). Two unknown values are treated as equal here; the caller's own
 * compareIds tie-break then orders them deterministically. */
function compareAscentDescendingWithUnknownLast(
  a: number | null,
  b: number | null,
): number {
  if (a === null || b === null) {
    if (a === null && b === null) return 0;
    return a === null ? 1 : -1;
  }
  return b - a;
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export interface RouteLibraryGroups<T extends PlannedRoute = PlannedRoute> {
  pinned: readonly (T & { pinnedAt: string })[];
  unpinned: readonly T[];
}

/** A route counts as pinned only when pinnedAt is a string that parses to
 * a finite timestamp — missing, null, or malformed local data is treated
 * as unpinned rather than destabilising ordering. */
export function isPinnedRoute<T extends PlannedRoute>(
  route: T,
): route is T & { pinnedAt: string } {
  return (
    typeof route.pinnedAt === "string" && Number.isFinite(Date.parse(route.pinnedAt))
  );
}

/** Sorts a copy of `routes` by pinnedAt descending (most recently pinned
 * first), tie-broken by id; never mutates the input. Takes the type
 * `isPinnedRoute` narrows to, rather than plain `PlannedRoute`, so
 * `pinnedAt` is known to be a `string` here with no assertion needed. */
function sortPinnedRoutes<T extends PlannedRoute>(
  routes: readonly (T & { pinnedAt: string })[],
): (T & { pinnedAt: string })[] {
  const copy = [...routes];
  copy.sort((a, b) => {
    const timeDifference = Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    return timeDifference !== 0 ? timeDifference : compareIds(a.id, b.id);
  });
  return copy;
}

/** The full Route Library pipeline: normalise query -> filter by name ->
 * filter by tag identity (AND semantics, item 100 stage 3) -> partition
 * pinned/unpinned -> sort pinned by pin recency (never by sortOrder) ->
 * sort unpinned via the rider's chosen order -> return as two explicit
 * groups, since each still needs its own sort policy — the caller
 * (RouteLibrary.tsx) flattens them into one combined, pinned-first render
 * order rather than rendering them as separate visual groups. Both groups
 * are partitioned from the SAME post-name-and-tag-filter set, so a tag
 * filter narrows pinned and unpinned identically, by construction rather
 * than incidentally. Neither group mutates or aliases `routes`; the
 * partition is exhaustive and disjoint by construction, so no route can
 * appear in both groups.
 *
 * Bound to LibraryRoute (not the looser PlannedRoute filterRoutesByName/
 * sortRoutesForLibrary/isPinnedRoute themselves stay bound to) because
 * filterRoutesByTags needs tags guaranteed present, and this function's
 * only real caller (RouteLibrary.tsx) already always supplies
 * LibraryRoute[]. tagKeys has no default, matching `query`'s own existing
 * convention of no default — every caller passes the quiescent value
 * (`new Set()`) explicitly rather than relying on parameter omission. */
export function selectRouteLibraryGroups<T extends LibraryRoute>(
  routes: readonly T[],
  query: string,
  sortOrder: RouteLibrarySortOrder,
  tagKeys: ReadonlySet<string>,
): RouteLibraryGroups<T> {
  const nameFiltered = filterRoutesByName(routes, query);
  const filtered = filterRoutesByTags(nameFiltered, tagKeys);
  const pinned = sortPinnedRoutes(filtered.filter(isPinnedRoute));
  const unpinned = sortRoutesForLibrary(
    filtered.filter((route) => !isPinnedRoute(route)),
    sortOrder,
  );
  return { pinned, unpinned };
}

/**
 * The prospective ("if I added this tag too") route count for every
 * UNSELECTED tag identity — backlog item 111's contextual tag-filter
 * counts. Returned as identity key -> route count, for chips to read.
 *
 * The whole calculation is a composition of the three helpers this
 * module and domain/routeTags.ts already own, deliberately rather than a
 * second interpretation of search, identity or AND:
 *
 *   1. filterRoutesByName applies the ACTIVE NAME SEARCH, with exactly
 *      the normalisation the visible list uses (see normalizeSearchText —
 *      NFD plus combining-mark stripping, which is NOT tag identity's own
 *      NFC rule). A search that matches nothing therefore drives every
 *      prospective count to zero, which is the honest answer.
 *   2. filterRoutesByTags narrows to the CURRENT selection under the same
 *      AND semantics and the same tagIdentityKey matching the list uses.
 *   3. countRoutesByTagIdentity tallies ROUTES (never occurrences) per
 *      identity over what is left.
 *
 * One pass answers every candidate, and that is a property of AND rather
 * than an optimisation: because AND-narrowing is monotone, the routes
 * matching `selected ∪ {candidate}` are exactly the routes matching
 * `selected` that also carry `candidate` — so a candidate's tally WITHIN
 * the already-narrowed set IS its prospective count. Running
 * selectRouteLibraryGroups once per candidate would compute the same
 * numbers while also partitioning and sorting, neither of which can
 * change membership.
 *
 * Every selected key is removed from the result, so a selected chip can
 * never be handed a prospective count at all: its meaning is removal, not
 * "what would happen if added". (Its entry would otherwise equal the
 * whole current result size, since it is already applied.)
 *
 * A candidate that survives nowhere is simply ABSENT from the map rather
 * than present as 0 — the tag list comes from the full unfiltered corpus
 * while this map comes from the narrowed subset, so absence is the normal
 * representation of a zero-result candidate and the caller resolves it
 * with `?? 0`.
 *
 * Pinned and unpinned routes contribute identically (there is no pin
 * logic here at all), and sort order is irrelevant to membership.
 * Nothing passed in is mutated.
 */
export function selectProspectiveTagFilterCounts(
  routes: readonly LibraryRoute[],
  query: string,
  selectedTagKeys: ReadonlySet<string>,
): Map<string, number> {
  const counts = countRoutesByTagIdentity(
    filterRoutesByTags(filterRoutesByName(routes, query), selectedTagKeys),
  );
  for (const key of selectedTagKeys) {
    counts.delete(key);
  }
  return counts;
}

/**
 * How many digits the filter chips must reserve for a prospective count
 * (backlog item 111), given the size of the FULL route corpus.
 *
 * The corpus size, not the largest count currently on screen, and that is
 * the whole point: a prospective count can never exceed the number of
 * saved routes, so this is a genuine upper bound that is ALSO stable
 * across every search and tag-filter change. Sizing the slot from the
 * visible maximum instead would reflow every chip row each time the
 * rider typed a character. It changes only when routes are added or
 * removed, and then only across a power-of-ten boundary.
 *
 * There is no 999-route cap anywhere in this application, so the answer
 * is derived rather than assumed.
 */
export function tagFilterCountSlotDigits(routeCount: number): number {
  return String(routeCount).length;
}

/**
 * An unselected filter chip's accessible description (backlog item 111):
 * what adding that tag to the current selection would leave. The chip's
 * accessible NAME stays the tag itself — voice control, this project's
 * own group-scoped test queries and four e2e specs all address a chip by
 * exactly that — so the number is carried as a description instead of
 * being appended to the name.
 *
 * Zero is spelled out rather than rendered as "0 routes would remain":
 * the visible chip already shows a literal 0, and this is the string that
 * has to make the unavailability unmistakable when read aloud.
 */
export function describeProspectiveTagFilterCount(count: number): string {
  if (count === 0) return "No routes would remain";
  return `${formatRouteCount(count)} would remain`;
}

/**
 * The collapsed filter chooser's active-count copy (backlog item 106).
 * Collapsed filtering must never be invisible filtering — a route missing
 * from the list has to have a visible reason — so this pairs with a real
 * Clear action in the same row. Singular/plural is spelled out rather than
 * "1 filter(s)", matching this project's other counted copy.
 */
export function describeActiveTagFilterCount(count: number): string {
  return count === 1 ? "1 filter active" : `${String(count)} filters active`;
}
