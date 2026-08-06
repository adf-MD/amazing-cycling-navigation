import { describe, expect, it } from "vitest";
import type { PlannedRoute } from "../../domain/types.ts";
import {
  filterRoutesByName,
  normalizeSearchText,
  selectRouteLibraryView,
  sortRoutesForLibrary,
} from "./routeLibraryView.ts";

function buildRoute(
  id: string,
  name: string,
  createdAt = "2026-01-01T00:00:00.000Z",
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

describe("selectRouteLibraryView", () => {
  it("filters then sorts", () => {
    const routes = [
      buildRoute("a", "Zebra Loop", "2026-01-01T00:00:00.000Z"),
      buildRoute("b", "Alpine Climb", "2026-01-02T00:00:00.000Z"),
      buildRoute("c", "Mountain Pass", "2026-01-03T00:00:00.000Z"),
    ];

    const result = selectRouteLibraryView(routes, "loop", "name-asc");

    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("applies sort to the full list when the query is empty", () => {
    const routes = [buildRoute("a", "Zebra"), buildRoute("b", "Alpine")];

    expect(selectRouteLibraryView(routes, "", "name-asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
