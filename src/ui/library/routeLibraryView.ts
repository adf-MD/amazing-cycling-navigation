import type { LibraryRoute, PlannedRoute } from "../../domain/types.ts";
import { tagIdentityKey } from "../../domain/routeTags.ts";
import type { RouteLibrarySortOrder } from "../../storage/mapping.ts";

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
 * The collapsed filter chooser's active-count copy (backlog item 106).
 * Collapsed filtering must never be invisible filtering — a route missing
 * from the list has to have a visible reason — so this pairs with a real
 * Clear action in the same row. Singular/plural is spelled out rather than
 * "1 filter(s)", matching this project's other counted copy.
 */
export function describeActiveTagFilterCount(count: number): string {
  return count === 1 ? "1 filter active" : `${String(count)} filters active`;
}
