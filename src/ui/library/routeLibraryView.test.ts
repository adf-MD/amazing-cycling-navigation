import { describe, expect, it } from "vitest";
import type { LibraryRoute, PlannedRoute } from "../../domain/types.ts";
import {
  describeProspectiveTagFilterCount,
  filterRoutesByName,
  filterRoutesByTags,
  isPinnedRoute,
  normalizeSearchText,
  selectProspectiveTagFilterCounts,
  selectRouteLibraryGroups,
  sortRoutesForLibrary,
  tagFilterCountSlotDigits,
} from "./routeLibraryView.ts";

const NO_TAG_FILTERS = new Set<string>();

/** `overrides` is a single trailing object (rather than more positional
 * parameters) so a test sets distanceMetres/ascentMetres/pinnedAt/tags
 * explicitly by name — reduces the chance of a test value landing in the
 * wrong field as fields are added (item 99). `pinnedAt` is only included in
 * the built route when the caller supplies the key at all (whether `null`
 * or a string), matching a real unpinned route's own shape (no `pinnedAt`
 * key), distinct from an explicit `null`. Returns LibraryRoute (tags always
 * present, defaulting to `[]`), matching the only real production shape
 * (item 100 stage 3) rather than the looser PlannedRoute. */
function buildRoute(
  id: string,
  name: string,
  createdAt = "2026-01-01T00:00:00.000Z",
  overrides: Partial<
    Pick<PlannedRoute, "pinnedAt" | "distanceMetres" | "ascentMetres">
  > & { tags?: string[] } = {},
): LibraryRoute {
  return {
    id,
    name,
    createdAt,
    points: [],
    manoeuvres: [],
    distanceMetres: overrides.distanceMetres ?? 0,
    ascentMetres: overrides.ascentMetres ?? null,
    descentMetres: null,
    warnings: [],
    source: { kind: "gpx-import" },
    tags: overrides.tags ?? [],
    ...("pinnedAt" in overrides ? { pinnedAt: overrides.pinnedAt } : {}),
  };
}

describe("normalizeSearchText", () => {
  it("trims and lowercases", () => {
    expect(normalizeSearchText("  Sunday Loop  ")).toBe("sunday loop");
  });

  it("strips diacritics after NFD decomposition", () => {
    expect(normalizeSearchText("Hütte")).toBe("hutte");
    expect(normalizeSearchText("Ávila Hills")).toBe("avila hills");
  });

  it("returns an empty string for empty or whitespace-only input", () => {
    expect(normalizeSearchText("")).toBe("");
    expect(normalizeSearchText("   ")).toBe("");
  });
});

describe("filterRoutesByName", () => {
  const routes = [
    buildRoute("a", "Zebra Loop"),
    buildRoute("b", "Alpine Climb"),
    buildRoute("c", "Hütte Loop"),
  ];

  it("returns every route, copied, for an empty query", () => {
    const result = filterRoutesByName(routes, "");
    expect(result).toEqual(routes);
    expect(result).not.toBe(routes);
  });

  it("returns every route for a whitespace-only query", () => {
    expect(filterRoutesByName(routes, "   ")).toEqual(routes);
  });

  it("matches a substring case-insensitively", () => {
    expect(filterRoutesByName(routes, "ALPINE").map((r) => r.id)).toEqual(["b"]);
  });

  it("matches diacritic-insensitively", () => {
    expect(filterRoutesByName(routes, "hutte").map((r) => r.id)).toEqual(["c"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterRoutesByName(routes, "mountain")).toEqual([]);
  });

  it("never mutates the input array", () => {
    const copy = [...routes];
    filterRoutesByName(routes, "loop");
    expect(routes).toEqual(copy);
  });
});

describe("filterRoutesByTags", () => {
  const routes = [
    buildRoute("a", "Zebra Loop", undefined, { tags: ["Gravel", "Weekend"] }),
    buildRoute("b", "Alpine Climb", undefined, { tags: ["Weekend"] }),
    buildRoute("c", "Hütte Loop", undefined, { tags: [] }),
  ];

  it("returns every route, copied, for an empty tag-key selection", () => {
    const result = filterRoutesByTags(routes, NO_TAG_FILTERS);
    expect(result).toEqual(routes);
    expect(result).not.toBe(routes);
  });

  it("matches a single selected identity", () => {
    expect(filterRoutesByTags(routes, new Set(["gravel"])).map((r) => r.id)).toEqual([
      "a",
    ]);
  });

  it("applies AND semantics across several selected identities", () => {
    expect(
      filterRoutesByTags(routes, new Set(["gravel", "weekend"])).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("excludes a route missing even one of several selected identities", () => {
    expect(filterRoutesByTags(routes, new Set(["weekend"])).map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("matches by identity across case, whitespace and NFC spelling variants", () => {
    const spelled = [
      buildRoute("a", "Alpine Climb", undefined, { tags: ["  GRAVEL  Path"] }),
    ];
    expect(
      filterRoutesByTags(spelled, new Set(["gravel path"])).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("keeps diacritic variants distinct, matching tagIdentityKey's own rules", () => {
    const cafe = [buildRoute("a", "Alpine Climb", undefined, { tags: ["café"] })];
    expect(filterRoutesByTags(cafe, new Set(["cafe"]))).toEqual([]);
  });

  it("treats an explicitly untagged route (tags: []) as excluded by any selection", () => {
    expect(
      filterRoutesByTags(routes, new Set(["gravel"])).map((r) => r.id),
    ).not.toContain("c");
  });

  it("returns an empty array when no route satisfies every selected tag", () => {
    expect(filterRoutesByTags(routes, new Set(["mountain"]))).toEqual([]);
  });

  it("never mutates the input array or any route's own tags array", () => {
    const copy = routes.map((route) => ({ ...route, tags: [...route.tags] }));
    filterRoutesByTags(routes, new Set(["weekend"]));
    expect(routes).toEqual(copy);
  });
});

describe("sortRoutesForLibrary", () => {
  it("orders most-recent by createdAt descending", () => {
    const routes = [
      buildRoute("a", "First", "2026-01-01T00:00:00.000Z"),
      buildRoute("b", "Second", "2026-01-03T00:00:00.000Z"),
      buildRoute("c", "Third", "2026-01-02T00:00:00.000Z"),
    ];

    expect(sortRoutesForLibrary(routes, "most-recent").map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("breaks most-recent ties deterministically by id", () => {
    const routes = [
      buildRoute("b", "Second", "2026-01-01T00:00:00.000Z"),
      buildRoute("a", "First", "2026-01-01T00:00:00.000Z"),
    ];

    expect(sortRoutesForLibrary(routes, "most-recent").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("orders name-asc case-insensitively", () => {
    const routes = [buildRoute("a", "zebra"), buildRoute("b", "Alpine")];

    expect(sortRoutesForLibrary(routes, "name-asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("orders name-asc with numeric-aware comparison", () => {
    const routes = [buildRoute("a", "Route 10"), buildRoute("b", "Route 2")];

    expect(sortRoutesForLibrary(routes, "name-asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("orders name-asc diacritic-insensitively", () => {
    const routes = [buildRoute("a", "Zebra"), buildRoute("b", "Ávila")];

    expect(sortRoutesForLibrary(routes, "name-asc").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("breaks name-asc ties deterministically by id", () => {
    const routes = [buildRoute("b", "Same Name"), buildRoute("a", "Same Name")];

    expect(sortRoutesForLibrary(routes, "name-asc").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("never mutates the input array", () => {
    const routes = [buildRoute("a", "Zebra"), buildRoute("b", "Alpine")];
    const copy = [...routes];
    sortRoutesForLibrary(routes, "name-asc");
    expect(routes).toEqual(copy);
  });

  // Item 99: distance and total-ascent sorting. Every fixture below is
  // deliberately built so name/createdAt order disagrees with the order
  // under test, so a passing assertion can only be explained by the new
  // comparator actually reading distanceMetres/ascentMetres.
  describe("distance-desc (item 99, narrowed to descending-only by the item 99 follow-up)", () => {
    const routes = [
      buildRoute("a", "Zebra", "2026-01-03T00:00:00.000Z", { distanceMetres: 30_000 }),
      buildRoute("b", "Mid", "2026-01-02T00:00:00.000Z", { distanceMetres: 10_000 }),
      buildRoute("c", "Alpine", "2026-01-01T00:00:00.000Z", { distanceMetres: 20_000 }),
    ];

    it("orders longest first", () => {
      expect(sortRoutesForLibrary(routes, "distance-desc").map((r) => r.id)).toEqual([
        "a",
        "c",
        "b",
      ]);
    });

    it("breaks equal-distance ties deterministically by id", () => {
      const tied = [
        buildRoute("b", "Second", undefined, { distanceMetres: 5_000 }),
        buildRoute("a", "First", undefined, { distanceMetres: 5_000 }),
      ];

      expect(sortRoutesForLibrary(tied, "distance-desc").map((r) => r.id)).toEqual([
        "a",
        "b",
      ]);
    });

    it("never mutates the input array", () => {
      const copy = [...routes];
      sortRoutesForLibrary(routes, "distance-desc");
      expect(routes).toEqual(copy);
    });
  });

  describe("ascent-desc (item 99, narrowed to descending-only by the item 99 follow-up)", () => {
    // Known zero must stay distinct from unknown (null), and unknown must
    // always sort last, even under descending order.
    const withUnknown = [
      buildRoute("zero", "Zebra flat", "2026-01-03T00:00:00.000Z", { ascentMetres: 0 }),
      buildRoute("mid", "Mid climb", "2026-01-02T00:00:00.000Z", { ascentMetres: 250 }),
      buildRoute("unknown", "Alpine unknown", "2026-01-01T00:00:00.000Z", {
        ascentMetres: null,
      }),
    ];

    it("orders most-known-ascent first, unknown last (not resurrected to first)", () => {
      expect(sortRoutesForLibrary(withUnknown, "ascent-desc").map((r) => r.id)).toEqual([
        "mid",
        "zero",
        "unknown",
      ]);
    });

    it("breaks equal-known-ascent ties deterministically by id", () => {
      const tied = [
        buildRoute("b", "Second", undefined, { ascentMetres: 400 }),
        buildRoute("a", "First", undefined, { ascentMetres: 400 }),
      ];

      expect(sortRoutesForLibrary(tied, "ascent-desc").map((r) => r.id)).toEqual([
        "a",
        "b",
      ]);
    });

    it("breaks ties between multiple unknown-ascent routes deterministically by id", () => {
      const routes = [
        buildRoute("z", "Second unknown", undefined, { ascentMetres: null }),
        buildRoute("k", "First unknown", undefined, { ascentMetres: null }),
        buildRoute("m", "Known", undefined, { ascentMetres: 100 }),
      ];

      expect(sortRoutesForLibrary(routes, "ascent-desc").map((r) => r.id)).toEqual([
        "m",
        "k",
        "z",
      ]);
    });

    it("never mutates the input array", () => {
      const copy = [...withUnknown];
      sortRoutesForLibrary(withUnknown, "ascent-desc");
      expect(withUnknown).toEqual(copy);
    });
  });
});

describe("isPinnedRoute", () => {
  it("is false when pinnedAt is absent", () => {
    expect(isPinnedRoute(buildRoute("a", "Route"))).toBe(false);
  });

  it("is false when pinnedAt is null", () => {
    expect(isPinnedRoute(buildRoute("a", "Route", undefined, { pinnedAt: null }))).toBe(
      false,
    );
  });

  it("is false when pinnedAt is a malformed string", () => {
    expect(
      isPinnedRoute(buildRoute("a", "Route", undefined, { pinnedAt: "not-a-date" })),
    ).toBe(false);
  });

  it("is true when pinnedAt is a valid ISO timestamp", () => {
    expect(
      isPinnedRoute(
        buildRoute("a", "Route", undefined, { pinnedAt: "2026-02-01T00:00:00.000Z" }),
      ),
    ).toBe(true);
  });
});

describe("selectRouteLibraryGroups", () => {
  it("groups matching pinned routes above matching unpinned routes", () => {
    const routes = [
      buildRoute("a", "Alpine Climb", "2026-01-01T00:00:00.000Z"),
      buildRoute("b", "Zebra Loop", "2026-01-02T00:00:00.000Z", {
        pinnedAt: "2026-02-01T00:00:00.000Z",
      }),
    ];

    const result = selectRouteLibraryGroups(routes, "", "most-recent", NO_TAG_FILTERS);

    expect(result.pinned.map((r) => r.id)).toEqual(["b"]);
    expect(result.unpinned.map((r) => r.id)).toEqual(["a"]);
  });

  it("orders pinned routes by pinnedAt descending", () => {
    const routes = [
      buildRoute("a", "First pinned", undefined, {
        pinnedAt: "2026-02-01T00:00:00.000Z",
      }),
      buildRoute("b", "Second pinned", undefined, {
        pinnedAt: "2026-02-03T00:00:00.000Z",
      }),
      buildRoute("c", "Third pinned", undefined, {
        pinnedAt: "2026-02-02T00:00:00.000Z",
      }),
    ];

    const result = selectRouteLibraryGroups(routes, "", "most-recent", NO_TAG_FILTERS);

    expect(result.pinned.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks pinned ties deterministically by id", () => {
    const routes = [
      buildRoute("b", "Second", undefined, { pinnedAt: "2026-02-01T00:00:00.000Z" }),
      buildRoute("a", "First", undefined, { pinnedAt: "2026-02-01T00:00:00.000Z" }),
    ];

    const result = selectRouteLibraryGroups(routes, "", "most-recent", NO_TAG_FILTERS);

    expect(result.pinned.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("changing sortOrder reorders only the unpinned group", () => {
    const routes = [
      buildRoute("a", "Zebra pinned", undefined, {
        pinnedAt: "2026-02-01T00:00:00.000Z",
      }),
      buildRoute("b", "Alpine pinned", undefined, {
        pinnedAt: "2026-02-02T00:00:00.000Z",
      }),
      buildRoute("c", "Zebra plain", "2026-01-03T00:00:00.000Z"),
      buildRoute("d", "Alpine plain", "2026-01-01T00:00:00.000Z"),
    ];

    const mostRecent = selectRouteLibraryGroups(
      routes,
      "",
      "most-recent",
      NO_TAG_FILTERS,
    );
    const nameAsc = selectRouteLibraryGroups(routes, "", "name-asc", NO_TAG_FILTERS);

    expect(mostRecent.pinned.map((r) => r.id)).toEqual(["b", "a"]);
    expect(nameAsc.pinned.map((r) => r.id)).toEqual(["b", "a"]);
    expect(mostRecent.unpinned.map((r) => r.id)).toEqual(["c", "d"]);
    expect(nameAsc.unpinned.map((r) => r.id)).toEqual(["d", "c"]);
  });

  // Item 99: the pinned group's own pinnedAt-descending order must survive
  // a distance/ascent sort untouched, even when the pinned routes'
  // distance/ascent order actively disagrees with their pin-recency order
  // — proving the sort is applied to the unpinned partition only, not to
  // both.
  it("changing sortOrder to distance-desc still reorders only the unpinned group, leaving pinned order unchanged (item 99)", () => {
    const routes = [
      // Pinned most recently (should stay first) but the SMALLEST distance
      // — if distance-desc leaked into the pinned group this would move
      // to the bottom of the pinned pair.
      buildRoute("newer-pin-short", "Newer pin, short", undefined, {
        pinnedAt: "2026-02-02T00:00:00.000Z",
        distanceMetres: 1_000,
      }),
      // Pinned earlier (should stay second) but the LARGEST distance.
      buildRoute("older-pin-long", "Older pin, long", undefined, {
        pinnedAt: "2026-02-01T00:00:00.000Z",
        distanceMetres: 50_000,
      }),
      buildRoute("unpinned-mid", "Unpinned mid", undefined, { distanceMetres: 20_000 }),
      buildRoute("unpinned-short", "Unpinned short", undefined, {
        distanceMetres: 5_000,
      }),
    ];

    const distanceDesc = selectRouteLibraryGroups(
      routes,
      "",
      "distance-desc",
      NO_TAG_FILTERS,
    );

    expect(distanceDesc.pinned.map((r) => r.id)).toEqual([
      "newer-pin-short",
      "older-pin-long",
    ]);
    expect(distanceDesc.unpinned.map((r) => r.id)).toEqual([
      "unpinned-mid",
      "unpinned-short",
    ]);
  });

  it("filters both groups by name", () => {
    const routes = [
      buildRoute("a", "Alpine pinned", undefined, {
        pinnedAt: "2026-02-01T00:00:00.000Z",
      }),
      buildRoute("b", "Zebra pinned", undefined, {
        pinnedAt: "2026-02-02T00:00:00.000Z",
      }),
      buildRoute("c", "Alpine plain"),
      buildRoute("d", "Zebra plain"),
    ];

    const result = selectRouteLibraryGroups(
      routes,
      "alpine",
      "most-recent",
      NO_TAG_FILTERS,
    );

    expect(result.pinned.map((r) => r.id)).toEqual(["a"]);
    expect(result.unpinned.map((r) => r.id)).toEqual(["c"]);
  });

  it("every matching route appears in exactly one group, with no route in both", () => {
    const routes = [
      buildRoute("a", "Pinned one", undefined, { pinnedAt: "2026-02-01T00:00:00.000Z" }),
      buildRoute("b", "Pinned two", undefined, { pinnedAt: "2026-02-02T00:00:00.000Z" }),
      buildRoute("c", "Plain one"),
      buildRoute("d", "Plain two", undefined, { pinnedAt: null }),
      buildRoute("e", "Malformed pin", undefined, { pinnedAt: "not-a-date" }),
    ];

    const result = selectRouteLibraryGroups(routes, "", "most-recent", NO_TAG_FILTERS);
    const pinnedIds = new Set(result.pinned.map((r) => r.id));
    const unpinnedIds = new Set(result.unpinned.map((r) => r.id));

    expect(pinnedIds.size + unpinnedIds.size).toBe(routes.length);
    for (const id of pinnedIds) {
      expect(unpinnedIds.has(id)).toBe(false);
    }
  });

  it("never mutates or aliases the input array", () => {
    const routes = [
      buildRoute("a", "Alpine", undefined, { pinnedAt: "2026-02-01T00:00:00.000Z" }),
      buildRoute("b", "Zebra"),
    ];
    const copy = [...routes];

    selectRouteLibraryGroups(routes, "", "most-recent", NO_TAG_FILTERS);

    expect(routes).toEqual(copy);
  });

  // Item 100 stage 3: tag filtering.
  it("filters both pinned and unpinned groups by tag identity before partitioning", () => {
    const routes = [
      buildRoute("a", "Alpine pinned", undefined, {
        pinnedAt: "2026-02-01T00:00:00.000Z",
        tags: ["Gravel"],
      }),
      buildRoute("b", "Zebra pinned", undefined, {
        pinnedAt: "2026-02-02T00:00:00.000Z",
        tags: ["Road"],
      }),
      buildRoute("c", "Alpine plain", undefined, { tags: ["Gravel"] }),
      buildRoute("d", "Zebra plain", undefined, { tags: ["Road"] }),
    ];

    const result = selectRouteLibraryGroups(
      routes,
      "",
      "most-recent",
      new Set(["gravel"]),
    );

    expect(result.pinned.map((r) => r.id)).toEqual(["a"]);
    expect(result.unpinned.map((r) => r.id)).toEqual(["c"]);
  });

  it("applies AND semantics across two selected tags through the full pipeline", () => {
    const routes = [
      buildRoute("a", "Both tags", undefined, { tags: ["Gravel", "Weekend"] }),
      buildRoute("b", "One tag", undefined, { tags: ["Gravel"] }),
    ];

    const result = selectRouteLibraryGroups(
      routes,
      "",
      "most-recent",
      new Set(["gravel", "weekend"]),
    );

    expect(result.unpinned.map((r) => r.id)).toEqual(["a"]);
  });

  it("composes name query and tag filter as an intersection, not a union", () => {
    const routes = [
      buildRoute("a", "Alpine Climb", undefined, { tags: ["Gravel"] }),
      buildRoute("b", "Alpine Descent", undefined, { tags: ["Road"] }),
      buildRoute("c", "Zebra Loop", undefined, { tags: ["Gravel"] }),
    ];

    const result = selectRouteLibraryGroups(
      routes,
      "alpine",
      "most-recent",
      new Set(["gravel"]),
    );

    expect(result.unpinned.map((r) => r.id)).toEqual(["a"]);
  });

  it("preserves sort order and tie-breaking within the unpinned group under an active tag filter", () => {
    const routes = [
      buildRoute("b", "Route 10", undefined, { tags: ["Gravel"] }),
      buildRoute("a", "Route 2", undefined, { tags: ["Gravel"] }),
      buildRoute("c", "Excluded", undefined, { tags: ["Road"] }),
    ];

    const result = selectRouteLibraryGroups(routes, "", "name-asc", new Set(["gravel"]));

    expect(result.unpinned.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

// Backlog item 111: contextual ("if I added this tag too") tag-filter
// counts. The two open semantics the backlog entry recorded are settled
// here in tests, not only in prose: the count DOES respect the active
// name search, and a candidate that survives nowhere is absent from the
// map rather than present as 0.
describe("selectProspectiveTagFilterCounts", () => {
  // Deliberately mixes pinned and unpinned, two spellings of one identity
  // on a single route, and a route with no tags at all.
  const corpus = [
    buildRoute("a", "Alpine Climb", undefined, { tags: ["Gravel", "Long"] }),
    buildRoute("b", "Zebra Loop", undefined, {
      tags: ["Gravel", "Weekend"],
      pinnedAt: "2026-01-02T00:00:00.000Z",
    }),
    buildRoute("c", "Coastal Ride", undefined, { tags: ["Weekend"] }),
    buildRoute("d", "Untagged Ride", undefined, {}),
  ];

  function asObject(counts: ReadonlyMap<string, number>): Record<string, number> {
    return Object.fromEntries(counts);
  }

  it("returns an empty map for an empty corpus", () => {
    expect(asObject(selectProspectiveTagFilterCounts([], "", NO_TAG_FILTERS))).toEqual(
      {},
    );
  });

  it("counts every tag's own routes when nothing is selected", () => {
    expect(
      asObject(selectProspectiveTagFilterCounts(corpus, "", NO_TAG_FILTERS)),
    ).toEqual({ gravel: 2, long: 1, weekend: 2 });
  });

  it("narrows every candidate to the intersection with one selected filter", () => {
    // Gravel selected -> routes a and b remain, so Long (a) is 1 and
    // Weekend (b) is 1. Gravel itself is absent: it is already applied.
    expect(
      asObject(selectProspectiveTagFilterCounts(corpus, "", new Set(["gravel"]))),
    ).toEqual({ long: 1, weekend: 1 });
  });

  it("applies AND, not OR, across several selected filters", () => {
    // Gravel AND Weekend -> only route b. Under OR the base set would be
    // a, b and c, and Long would wrongly report 1.
    expect(
      asObject(
        selectProspectiveTagFilterCounts(corpus, "", new Set(["gravel", "weekend"])),
      ),
    ).toEqual({});
  });

  it("omits a candidate that would leave no routes, rather than reporting it as zero", () => {
    const counts = selectProspectiveTagFilterCounts(corpus, "", new Set(["long"]));
    // Long selected -> only route a, which carries Gravel but not Weekend.
    expect(counts.get("gravel")).toBe(1);
    expect(counts.has("weekend")).toBe(false);
    expect(counts.get("weekend") ?? 0).toBe(0);
  });

  it("leaves every candidate at zero once the selection itself matches nothing", () => {
    const counts = selectProspectiveTagFilterCounts(
      corpus,
      "",
      new Set(["long", "weekend"]),
    );
    expect(asObject(counts)).toEqual({});
    expect(counts.get("gravel") ?? 0).toBe(0);
  });

  it("respects the active name search", () => {
    // "loop" matches Zebra Loop alone, so Gravel and Weekend drop to 1
    // and Long — carried only by Alpine Climb — disappears entirely.
    expect(
      asObject(selectProspectiveTagFilterCounts(corpus, "loop", NO_TAG_FILTERS)),
    ).toEqual({ gravel: 1, weekend: 1 });
  });

  it("drives every candidate to zero when the name search matches nothing", () => {
    expect(
      asObject(selectProspectiveTagFilterCounts(corpus, "no such route", NO_TAG_FILTERS)),
    ).toEqual({});
  });

  it("uses the existing name-search normalisation rather than a plain substring match", () => {
    // A bare `name.includes(query)` fails both of these: the stored name
    // is capitalised and carries a diacritic, while the query is neither.
    const routes = [buildRoute("a", "Hütte Loop", undefined, { tags: ["Gravel"] })];
    expect(
      asObject(selectProspectiveTagFilterCounts(routes, "hutte", NO_TAG_FILTERS)),
    ).toEqual({ gravel: 1 });
  });

  it("matches tags by identity across case and whitespace spelling variants", () => {
    const routes = [
      buildRoute("a", "Alpine Climb", undefined, { tags: ["  GRAVEL  Path", "Long"] }),
      buildRoute("b", "Zebra Loop", undefined, { tags: ["gravel path"] }),
    ];
    expect(
      asObject(selectProspectiveTagFilterCounts(routes, "", NO_TAG_FILTERS)),
    ).toEqual({
      "gravel path": 2,
      long: 1,
    });
    expect(
      asObject(selectProspectiveTagFilterCounts(routes, "", new Set(["gravel path"]))),
    ).toEqual({ long: 1 });
  });

  it("counts routes, never tag occurrences", () => {
    // One route listing two spellings of one identity must count once.
    const routes = [
      buildRoute("a", "Alpine Climb", undefined, { tags: ["Gravel", "GRAVEL"] }),
    ];
    expect(
      asObject(selectProspectiveTagFilterCounts(routes, "", NO_TAG_FILTERS)),
    ).toEqual({
      gravel: 1,
    });
  });

  it("counts pinned and unpinned routes equally", () => {
    const routes = [
      buildRoute("a", "Alpine Climb", undefined, {
        tags: ["Gravel"],
        pinnedAt: "2026-01-02T00:00:00.000Z",
      }),
      buildRoute("b", "Zebra Loop", undefined, { tags: ["Gravel"], pinnedAt: null }),
      buildRoute("c", "Coastal Ride", undefined, { tags: ["Gravel"] }),
    ];
    expect(
      selectProspectiveTagFilterCounts(routes, "", NO_TAG_FILTERS).get("gravel"),
    ).toBe(3);
  });

  it("never reports a prospective count for an already-selected tag", () => {
    const counts = selectProspectiveTagFilterCounts(corpus, "", new Set(["gravel"]));
    expect(counts.has("gravel")).toBe(false);
  });

  it("agrees with the real view pipeline for every candidate", () => {
    // The oracle: whatever the rider would actually see. Also pins the
    // irrelevance of sort order and pin grouping to membership.
    const selected = new Set(["gravel"]);
    const counts = selectProspectiveTagFilterCounts(corpus, "", selected);
    for (const candidate of ["long", "weekend"]) {
      const groups = selectRouteLibraryGroups(
        corpus,
        "",
        "name-asc",
        new Set([...selected, candidate]),
      );
      expect(counts.get(candidate) ?? 0).toBe(
        groups.pinned.length + groups.unpinned.length,
      );
    }
  });

  it("never mutates the routes array or the selected-key set", () => {
    const routes = [...corpus];
    const selected = new Set(["gravel"]);
    selectProspectiveTagFilterCounts(routes, "loop", selected);
    expect(routes).toEqual(corpus);
    expect([...selected]).toEqual(["gravel"]);
  });
});

describe("describeProspectiveTagFilterCount", () => {
  it("spells out unavailability rather than saying '0 routes'", () => {
    expect(describeProspectiveTagFilterCount(0)).toBe("No routes would remain");
  });

  it("uses the singular for exactly one route", () => {
    expect(describeProspectiveTagFilterCount(1)).toBe("1 route would remain");
  });

  it("uses the plural beyond one", () => {
    expect(describeProspectiveTagFilterCount(2)).toBe("2 routes would remain");
    expect(describeProspectiveTagFilterCount(1234)).toBe("1234 routes would remain");
  });
});

describe("tagFilterCountSlotDigits", () => {
  it("reserves one digit for an empty or single-digit corpus", () => {
    expect(tagFilterCountSlotDigits(0)).toBe(1);
    expect(tagFilterCountSlotDigits(1)).toBe(1);
    expect(tagFilterCountSlotDigits(9)).toBe(1);
  });

  it("grows on each power-of-ten boundary, with no upper cap", () => {
    expect(tagFilterCountSlotDigits(10)).toBe(2);
    expect(tagFilterCountSlotDigits(99)).toBe(2);
    expect(tagFilterCountSlotDigits(100)).toBe(3);
    expect(tagFilterCountSlotDigits(999)).toBe(3);
    // Deliberately past the three digits it would be tempting to assume:
    // nothing in this application caps the library at 999 routes.
    expect(tagFilterCountSlotDigits(1000)).toBe(4);
    expect(tagFilterCountSlotDigits(9999)).toBe(4);
    expect(tagFilterCountSlotDigits(10_000)).toBe(5);
  });
});
