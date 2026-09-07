import { describe, expect, it } from "vitest";
import type { PlannedRoute } from "../../domain/types.ts";
import {
  filterRoutesByName,
  isPinnedRoute,
  normalizeSearchText,
  selectRouteLibraryGroups,
  sortRoutesForLibrary,
} from "./routeLibraryView.ts";

/** `overrides` is a single trailing object (rather than more positional
 * parameters) so a test sets distanceMetres/ascentMetres/pinnedAt
 * explicitly by name — reduces the chance of a test value landing in the
 * wrong field as fields are added (item 99). `pinnedAt` is only included in
 * the built route when the caller supplies the key at all (whether `null`
 * or a string), matching a real unpinned route's own shape (no `pinnedAt`
 * key), distinct from an explicit `null`. */
function buildRoute(
  id: string,
  name: string,
  createdAt = "2026-01-01T00:00:00.000Z",
  overrides: Partial<
    Pick<PlannedRoute, "pinnedAt" | "distanceMetres" | "ascentMetres">
  > = {},
): PlannedRoute {
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

    const result = selectRouteLibraryGroups(routes, "", "most-recent");

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

    const result = selectRouteLibraryGroups(routes, "", "most-recent");

    expect(result.pinned.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks pinned ties deterministically by id", () => {
    const routes = [
      buildRoute("b", "Second", undefined, { pinnedAt: "2026-02-01T00:00:00.000Z" }),
      buildRoute("a", "First", undefined, { pinnedAt: "2026-02-01T00:00:00.000Z" }),
    ];

    const result = selectRouteLibraryGroups(routes, "", "most-recent");

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

    const mostRecent = selectRouteLibraryGroups(routes, "", "most-recent");
    const nameAsc = selectRouteLibraryGroups(routes, "", "name-asc");

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

    const distanceDesc = selectRouteLibraryGroups(routes, "", "distance-desc");

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

    const result = selectRouteLibraryGroups(routes, "alpine", "most-recent");

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

    const result = selectRouteLibraryGroups(routes, "", "most-recent");
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

    selectRouteLibraryGroups(routes, "", "most-recent");

    expect(routes).toEqual(copy);
  });
});
