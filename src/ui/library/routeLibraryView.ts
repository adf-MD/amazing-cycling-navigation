import type { PlannedRoute } from "../../domain/types.ts";
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
 * returns the same array reference as `routes`. */
export function filterRoutesByName(
  routes: readonly PlannedRoute[],
  query: string,
): PlannedRoute[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [...routes];
  }
  return routes.filter((route) =>
    normalizeSearchText(route.name).includes(normalizedQuery),
  );
}

/** Sorts a copy of `routes` (never mutates the input — Array.prototype.sort
 * is in-place and `routes` may be the exact array reference React state
 * holds). "most-recent" preserves PlannedRoute.createdAt descending, the
 * app's pre-existing meaning; "name-asc" uses locale-aware, case-
 * insensitive, numeric-aware collation (so "Route 2" sorts before
 * "Route 10"). Both orders are tie-broken deterministically by route id. */
export function sortRoutesForLibrary(
  routes: readonly PlannedRoute[],
  sortOrder: RouteLibrarySortOrder,
): PlannedRoute[] {
  const copy = [...routes];
  if (sortOrder === "name-asc") {
    copy.sort((a, b) => NAME_COLLATOR.compare(a.name, b.name) || compareIds(a.id, b.id));
  } else {
    copy.sort((a, b) => {
      const timeDifference =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return timeDifference !== 0 ? timeDifference : compareIds(a.id, b.id);
    });
  }
  return copy;
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export interface RouteLibraryGroups {
  pinned: readonly PlannedRoute[];
  unpinned: readonly PlannedRoute[];
}

/** A route counts as pinned only when pinnedAt is a string that parses to
 * a finite timestamp — missing, null, or malformed local data is treated
 * as unpinned rather than destabilising ordering. */
export function isPinnedRoute(
  route: PlannedRoute,
): route is PlannedRoute & { pinnedAt: string } {
  return (
    typeof route.pinnedAt === "string" && Number.isFinite(Date.parse(route.pinnedAt))
  );
}

/** Sorts a copy of `routes` by pinnedAt descending (most recently pinned
 * first), tie-broken by id; never mutates the input. Takes the type
 * `isPinnedRoute` narrows to, rather than plain `PlannedRoute`, so
 * `pinnedAt` is known to be a `string` here with no assertion needed. */
function sortPinnedRoutes(
  routes: readonly (PlannedRoute & { pinnedAt: string })[],
): (PlannedRoute & { pinnedAt: string })[] {
  const copy = [...routes];
  copy.sort((a, b) => {
    const timeDifference = Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    return timeDifference !== 0 ? timeDifference : compareIds(a.id, b.id);
  });
  return copy;
}

/** The full Route Library pipeline: normalise query -> filter by name ->
 * partition pinned/unpinned -> sort pinned by pin recency (never by
 * sortOrder) -> sort unpinned via the rider's chosen order -> return as two
 * explicit groups so a caller can render/heading them separately. Neither
 * group mutates or aliases `routes`; the partition is exhaustive and
 * disjoint by construction, so no route can appear in both groups. */
export function selectRouteLibraryGroups(
  routes: readonly PlannedRoute[],
  query: string,
  sortOrder: RouteLibrarySortOrder,
): RouteLibraryGroups {
  const filtered = filterRoutesByName(routes, query);
  const pinned = sortPinnedRoutes(filtered.filter(isPinnedRoute));
  const unpinned = sortRoutesForLibrary(
    filtered.filter((route) => !isPinnedRoute(route)),
    sortOrder,
  );
  return { pinned, unpinned };
}
