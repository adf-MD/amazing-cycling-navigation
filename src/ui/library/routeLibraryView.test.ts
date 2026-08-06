import { describe, expect, it } from "vitest";
import type { PlannedRoute } from "../../domain/types.ts";
import {
  filterRoutesByName,
  isPinnedRoute,
  normalizeSearchText,
  selectRouteLibraryGroups,
  sortRoutesForLibrary,
} from "./routeLibraryView.ts";

function buildRoute(
  id: string,
  name: string,
  createdAt = "2026-01-01T00:00:00.000Z",
  pinnedAt?: string | null,
): PlannedRoute {
  return {
    id,
    name,
    createdAt,
    points: [],
    manoeuvres: [],
    distanceMetres: 0,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "gpx-import" },
    ...(pinnedAt !== undefined ? { pinnedAt } : {}),
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
});

describe("isPinnedRoute", () => {
  it("is false when pinnedAt is absent", () => {
    expect(isPinnedRoute(buildRoute("a", "Route"))).toBe(false);
  });

  it("is false when pinnedAt is null", () => {
    expect(isPinnedRoute(buildRoute("a", "Route", undefined, null))).toBe(false);
  });

  it("is false when pinnedAt is a malformed string", () => {
    expect(isPinnedRoute(buildRoute("a", "Route", undefined, "not-a-date"))).toBe(false);
  });

  it("is true when pinnedAt is a valid ISO timestamp", () => {
    expect(
      isPinnedRoute(buildRoute("a", "Route", undefined, "2026-02-01T00:00:00.000Z")),
    ).toBe(true);
  });
});

describe("selectRouteLibraryGroups", () => {
  it("groups matching pinned routes above matching unpinned routes", () => {
    const routes = [
      buildRoute("a", "Alpine Climb", "2026-01-01T00:00:00.000Z"),
      buildRoute(
        "b",
        "Zebra Loop",
        "2026-01-02T00:00:00.000Z",
        "2026-02-01T00:00:00.000Z",
      ),
    ];

    const result = selectRouteLibraryGroups(routes, "", "most-recent");

    expect(result.pinned.map((r) => r.id)).toEqual(["b"]);
    expect(result.unpinned.map((r) => r.id)).toEqual(["a"]);
  });

  it("orders pinned routes by pinnedAt descending", () => {
    const routes = [
      buildRoute("a", "First pinned", undefined, "2026-02-01T00:00:00.000Z"),
      buildRoute("b", "Second pinned", undefined, "2026-02-03T00:00:00.000Z"),
      buildRoute("c", "Third pinned", undefined, "2026-02-02T00:00:00.000Z"),
    ];

    const result = selectRouteLibraryGroups(routes, "", "most-recent");

    expect(result.pinned.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks pinned ties deterministically by id", () => {
    const routes = [
      buildRoute("b", "Second", undefined, "2026-02-01T00:00:00.000Z"),
      buildRoute("a", "First", undefined, "2026-02-01T00:00:00.000Z"),
    ];

    const result = selectRouteLibraryGroups(routes, "", "most-recent");

    expect(result.pinned.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("changing sortOrder reorders only the unpinned group", () => {
    const routes = [
      buildRoute("a", "Zebra pinned", undefined, "2026-02-01T00:00:00.000Z"),
      buildRoute("b", "Alpine pinned", undefined, "2026-02-02T00:00:00.000Z"),
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

  it("filters both groups by name", () => {
    const routes = [
      buildRoute("a", "Alpine pinned", undefined, "2026-02-01T00:00:00.000Z"),
      buildRoute("b", "Zebra pinned", undefined, "2026-02-02T00:00:00.000Z"),
      buildRoute("c", "Alpine plain"),
      buildRoute("d", "Zebra plain"),
    ];

    const result = selectRouteLibraryGroups(routes, "alpine", "most-recent");

    expect(result.pinned.map((r) => r.id)).toEqual(["a"]);
    expect(result.unpinned.map((r) => r.id)).toEqual(["c"]);
  });

  it("every matching route appears in exactly one group, with no route in both", () => {
    const routes = [
      buildRoute("a", "Pinned one", undefined, "2026-02-01T00:00:00.000Z"),
      buildRoute("b", "Pinned two", undefined, "2026-02-02T00:00:00.000Z"),
      buildRoute("c", "Plain one"),
      buildRoute("d", "Plain two", undefined, null),
      buildRoute("e", "Malformed pin", undefined, "not-a-date"),
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
      buildRoute("a", "Alpine", undefined, "2026-02-01T00:00:00.000Z"),
      buildRoute("b", "Zebra"),
    ];
    const copy = [...routes];

    selectRouteLibraryGroups(routes, "", "most-recent");

    expect(routes).toEqual(copy);
  });
});
