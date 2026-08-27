import { describe, expect, it } from "vitest";
import type { RoutePoint } from "../domain/types.ts";
import {
  buildActiveUpcomingDistanceBadgeMarkerSpecs,
  buildDistanceBadgeMarkerSpecs,
  capDistanceBadgeMarkerSpecs,
  DISTANCE_BADGE_INTERVALS_METRES,
  filterActiveRidingCandidates,
  MAX_ACTIVE_UPCOMING_DISTANCE_BADGES,
  MAX_WHOLE_ROUTE_DISTANCE_BADGES,
  mergeCoincidentDistanceBadges,
  placeDistanceBadgeCandidates,
  selectActiveUpcomingBadgeSpacingMetres,
  selectDistanceBadgeIntervalMetres,
  type DistanceBadgeCandidate,
} from "./distanceBadgeLayer.ts";
import type { DistanceBadgeMarkerSpec } from "./mapAdapter.ts";

function point(distanceFromStartMetres: number, lon: number, lat = 51): RoutePoint {
  return { coordinate: [lon, lat], elevationMetres: null, distanceFromStartMetres };
}

describe("placeDistanceBadgeCandidates", () => {
  it("returns no candidates for an empty route", () => {
    expect(placeDistanceBadgeCandidates([], 1000)).toEqual([]);
  });

  it("returns no candidates for a single point", () => {
    expect(placeDistanceBadgeCandidates([point(0, 0)], 1000)).toEqual([]);
  });

  it("returns no candidates for a route shorter than the interval", () => {
    const route = [point(0, 0), point(500, 0.005)];
    expect(placeDistanceBadgeCandidates(route, 1000)).toEqual([]);
  });

  it("returns no candidates for a route exactly one interval long (finish clearance suppresses it)", () => {
    const route = [point(0, 0), point(1000, 0.01)];
    expect(placeDistanceBadgeCandidates(route, 1000)).toEqual([]);
  });

  it("places multiple targets across irregularly spaced points, interpolating within segments", () => {
    const route = [
      point(0, 0),
      point(700, 0.007),
      point(1500, 0.015),
      point(2600, 0.026),
      point(3300, 0.033),
    ];
    const candidates = placeDistanceBadgeCandidates(route, 1000);
    expect(candidates.map((c) => c.distanceFromStartMetres)).toEqual([1000, 2000, 3000]);
    expect(candidates.map((c) => c.coordinate[0])).toEqual([
      expect.closeTo(0.01, 9),
      expect.closeTo(0.02, 9),
      expect.closeTo(0.03, 9),
    ]);
  });

  it("uses the stored point's own coordinate when a target lands exactly on it, without interpolating", () => {
    const route = [point(0, 0), point(1000, 0.01), point(2000, 0.02), point(3000, 0.03)];
    const candidates = placeDistanceBadgeCandidates(route, 1000);
    expect(candidates).toEqual([
      { distanceFromStartMetres: 1000, coordinate: [0.01, 51] },
      { distanceFromStartMetres: 2000, coordinate: [0.02, 51] },
    ]);
  });

  it("interpolates strictly within a segment", () => {
    const route = [point(0, 0), point(2000, 0.02), point(3000, 0.03)];
    const candidates = placeDistanceBadgeCandidates(route, 1000);
    expect(candidates[0]).toEqual({
      distanceFromStartMetres: 1000,
      coordinate: [0.01, 51],
    });
  });

  it("handles repeated adjacent coordinates / equal cumulative distances (zero-length segment) without corrupting neighbouring placements", () => {
    const route = [
      point(0, 0),
      point(1000, 0.01),
      point(1000, 0.01), // duplicate: same coordinate, same distance
      point(2000, 0.02),
      point(3000, 0.03),
    ];
    const candidates = placeDistanceBadgeCandidates(route, 1500);
    expect(candidates).toEqual([
      { distanceFromStartMetres: 1500, coordinate: [0.015, 51] },
    ]);
  });

  it("drops points with non-finite coordinates, leaving the rest to place correctly", () => {
    const route: RoutePoint[] = [
      point(0, 0),
      {
        coordinate: [Number.NaN, 51],
        elevationMetres: null,
        distanceFromStartMetres: 1000,
      },
      point(1000, 0.01),
      point(2000, 0.02),
      point(3000, 0.03),
    ];
    const candidates = placeDistanceBadgeCandidates(route, 1000);
    expect(candidates[0]).toEqual({
      distanceFromStartMetres: 1000,
      coordinate: [0.01, 51],
    });
  });

  it("drops points with a non-finite distance", () => {
    const route: RoutePoint[] = [
      point(0, 0),
      {
        coordinate: [0.01, 51],
        elevationMetres: null,
        distanceFromStartMetres: Number.POSITIVE_INFINITY,
      },
      point(2000, 0.02),
      point(3000, 0.03),
    ];
    const candidates = placeDistanceBadgeCandidates(route, 1000);
    expect(candidates[0]).toEqual({
      distanceFromStartMetres: 1000,
      coordinate: [0.01, 51],
    });
  });

  it("drops a point whose distance decreases relative to the last kept point", () => {
    const route = [point(0, 0), point(2000, 0.02), point(1500, 0.015), point(3000, 0.03)];
    const candidates = placeDistanceBadgeCandidates(route, 1000);
    expect(candidates).toEqual([
      { distanceFromStartMetres: 1000, coordinate: [0.01, 51] },
      { distanceFromStartMetres: 2000, coordinate: [0.02, 51] },
    ]);
  });

  it("respects finish clearance at the boundary (just inside vs just outside)", () => {
    const justInside = [point(0, 0), point(3100, 0.031)];
    expect(
      placeDistanceBadgeCandidates(justInside, 1000, 100).map(
        (c) => c.distanceFromStartMetres,
      ),
    ).toEqual([1000, 2000, 3000]);

    const justOutside = [point(0, 0), point(3099, 0.03099)];
    expect(
      placeDistanceBadgeCandidates(justOutside, 1000, 100).map(
        (c) => c.distanceFromStartMetres,
      ),
    ).toEqual([1000, 2000]);
  });

  it("never places a marker beyond the route finish", () => {
    const route = [point(0, 0), point(3050, 0.0305)];
    const candidates = placeDistanceBadgeCandidates(route, 1000, 100);
    for (const candidate of candidates) {
      expect(candidate.distanceFromStartMetres).toBeLessThan(3050);
    }
  });

  it("never mutates the input points", () => {
    const route = Object.freeze([
      Object.freeze(point(0, 0)),
      Object.freeze(point(2000, 0.02)),
      Object.freeze(point(3000, 0.03)),
    ]);
    expect(() => placeDistanceBadgeCandidates(route, 1000)).not.toThrow();
  });

  it("rejects a non-finite or non-positive interval", () => {
    const route = [point(0, 0), point(3000, 0.03)];
    expect(placeDistanceBadgeCandidates(route, 0)).toEqual([]);
    expect(placeDistanceBadgeCandidates(route, -1000)).toEqual([]);
    expect(placeDistanceBadgeCandidates(route, Number.NaN)).toEqual([]);
    expect(placeDistanceBadgeCandidates(route, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe("selectDistanceBadgeIntervalMetres", () => {
  // 22km route: naive candidate counts at 1/5/10/20km are 21/4/2/1 — all
  // within the cap and all non-zero, so band selection can be tested in
  // isolation from the escalation/de-escalation passes.
  const ISOLATED_ROUTE_LENGTH_METRES = 22_000;

  it("selects 1 km at street zoom", () => {
    expect(selectDistanceBadgeIntervalMetres(15, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      1000,
    );
    expect(selectDistanceBadgeIntervalMetres(20, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      1000,
    );
  });

  it("selects 5 km at intermediate zoom", () => {
    expect(selectDistanceBadgeIntervalMetres(12, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      5000,
    );
    expect(selectDistanceBadgeIntervalMetres(14.999, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      5000,
    );
  });

  it("selects 10 km at regional zoom", () => {
    expect(selectDistanceBadgeIntervalMetres(9, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      10000,
    );
    expect(selectDistanceBadgeIntervalMetres(11.999, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      10000,
    );
  });

  it("selects 20 km at wide overview zoom", () => {
    expect(selectDistanceBadgeIntervalMetres(0, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      20000,
    );
    expect(selectDistanceBadgeIntervalMetres(8.999, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      20000,
    );
  });

  it("is deterministic at exact threshold boundaries", () => {
    expect(selectDistanceBadgeIntervalMetres(15, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      1000,
    );
    expect(selectDistanceBadgeIntervalMetres(12, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      5000,
    );
    expect(selectDistanceBadgeIntervalMetres(9, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      10000,
    );
  });

  it("does not flicker across zoom values that stay within the same band", () => {
    expect(selectDistanceBadgeIntervalMetres(15.0, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      1000,
    );
    expect(selectDistanceBadgeIntervalMetres(15.9, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      1000,
    );
    expect(selectDistanceBadgeIntervalMetres(19.9, ISOLATED_ROUTE_LENGTH_METRES)).toBe(
      1000,
    );
  });

  it("escalates to a coarser interval when route length would exceed the marker cap", () => {
    // At street zoom (naive 1km band), a 100km route would need ~99
    // badges — escalates past the cap to 5km (~19 badges).
    expect(selectDistanceBadgeIntervalMetres(15, 100_000)).toBe(5000);
  });

  it("escalates all the way to the coarsest interval for a very long route, without exceeding the family", () => {
    expect(selectDistanceBadgeIntervalMetres(15, 1_000_000)).toBe(20000);
  });

  it("de-escalates to a finer interval so a short route still gets a useful marker", () => {
    // Wide-overview zoom would naively pick 20km, which places zero
    // badges on a 2km route — de-escalates down to 1km (2 badges).
    expect(selectDistanceBadgeIntervalMetres(0, 2000)).toBe(1000);
  });

  it("leaves a route too short even for the finest interval at 1 km, with zero badges expected downstream", () => {
    expect(selectDistanceBadgeIntervalMetres(0, 900)).toBe(1000);
  });

  it("only ever returns an approved family member", () => {
    const zooms = [-10, -1, 0, 5, 8, 9, 9.5, 11, 12, 13, 14, 15, 16, 22];
    const lengths = [0, 500, 1000, 5000, 22_000, 100_000, 500_000];
    for (const zoom of zooms) {
      for (const length of lengths) {
        expect(DISTANCE_BADGE_INTERVALS_METRES).toContain(
          selectDistanceBadgeIntervalMetres(zoom, length),
        );
      }
    }
  });

  it("handles non-finite zoom safely (falls back to the safest band before escalation)", () => {
    expect(
      selectDistanceBadgeIntervalMetres(Number.NaN, ISOLATED_ROUTE_LENGTH_METRES),
    ).toBe(20000);
    expect(
      selectDistanceBadgeIntervalMetres(
        Number.POSITIVE_INFINITY,
        ISOLATED_ROUTE_LENGTH_METRES,
      ),
    ).toBe(1000);
    expect(
      selectDistanceBadgeIntervalMetres(
        Number.NEGATIVE_INFINITY,
        ISOLATED_ROUTE_LENGTH_METRES,
      ),
    ).toBe(20000);
  });

  it("handles non-finite or negative route length safely", () => {
    expect(selectDistanceBadgeIntervalMetres(0, Number.NaN)).toBe(1000);
    expect(selectDistanceBadgeIntervalMetres(0, -500)).toBe(1000);
  });
});

describe("filterActiveRidingCandidates", () => {
  const candidates: DistanceBadgeCandidate[] = [
    { distanceFromStartMetres: 10000, coordinate: [0.1, 51] },
    { distanceFromStartMetres: 30000, coordinate: [0.3, 51] },
    { distanceFromStartMetres: 37000, coordinate: [0.37, 51] },
    { distanceFromStartMetres: 40000, coordinate: [0.4, 51] },
  ];

  it("passes every candidate through when progress is null (no reliable progress yet)", () => {
    expect(filterActiveRidingCandidates(candidates, null)).toEqual(candidates);
  });

  it("treats a non-finite progress value the same as null", () => {
    expect(filterActiveRidingCandidates(candidates, Number.NaN)).toEqual(candidates);
  });

  it("omits completed candidates once progress reaches 37 km, keeping 40 km as the next absolute value", () => {
    const result = filterActiveRidingCandidates(candidates, 37000);
    expect(result.map((c) => c.distanceFromStartMetres)).toEqual([37000, 40000]);
  });

  it("keeps a candidate exactly at the current progress", () => {
    const result = filterActiveRidingCandidates(candidates, 37000);
    expect(result.some((c) => c.distanceFromStartMetres === 37000)).toBe(true);
  });
});

describe("mergeCoincidentDistanceBadges", () => {
  it("merges two coincident candidates (a loop) into one combined label", () => {
    const candidates: DistanceBadgeCandidate[] = [
      { distanceFromStartMetres: 10000, coordinate: [0, 51] },
      { distanceFromStartMetres: 30000, coordinate: [0.0001, 51] }, // ~7m away
    ];
    const specs = mergeCoincidentDistanceBadges(candidates);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      id: "distance-badge-10-30",
      label: "10 / 30",
      ariaLabel: "10 and 30 kilometres from route start",
    });
  });

  it("merges an out-and-back overlap the same way", () => {
    const candidates: DistanceBadgeCandidate[] = [
      { distanceFromStartMetres: 5000, coordinate: [0.05, 51] },
      { distanceFromStartMetres: 15000, coordinate: [0.050001, 51] },
    ];
    const specs = mergeCoincidentDistanceBadges(candidates);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ label: "5 / 15" });
  });

  it("merges a chain of three mutually-coincident candidates, even when the outer two exceed the threshold directly", () => {
    // A-B ~10.5m, B-C ~10.5m, A-C ~21m (over the 15m threshold) — only
    // reachable as one group by checking against every group member.
    const candidates: DistanceBadgeCandidate[] = [
      { distanceFromStartMetres: 5000, coordinate: [0, 51] },
      { distanceFromStartMetres: 15000, coordinate: [0.00015, 51] },
      { distanceFromStartMetres: 25000, coordinate: [0.0003, 51] },
    ];
    const specs = mergeCoincidentDistanceBadges(candidates);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ label: "5 / 15 / 25" });
  });

  it("keeps non-coincident candidates separate and ascending", () => {
    const candidates: DistanceBadgeCandidate[] = [
      { distanceFromStartMetres: 1000, coordinate: [0.01, 51] },
      { distanceFromStartMetres: 5000, coordinate: [0.05, 51] },
    ];
    const specs = mergeCoincidentDistanceBadges(candidates);
    expect(specs.map((s) => s.label)).toEqual(["1", "5"]);
  });

  it("derives the id/label from sorted distances, not input array order", () => {
    const candidates: DistanceBadgeCandidate[] = [
      { distanceFromStartMetres: 30000, coordinate: [0, 51] },
      { distanceFromStartMetres: 10000, coordinate: [0, 51] },
    ];
    const specs = mergeCoincidentDistanceBadges(candidates);
    expect(specs).toEqual([
      {
        id: "distance-badge-10-30",
        coordinate: [0, 51],
        label: "10 / 30",
        ariaLabel: "10 and 30 kilometres from route start",
      },
    ]);
  });

  it("uses singular wording for a single 1 km badge", () => {
    const specs = mergeCoincidentDistanceBadges([
      { distanceFromStartMetres: 1000, coordinate: [0.01, 51] },
    ]);
    expect(specs[0]).toMatchObject({ ariaLabel: "1 kilometre from route start" });
  });

  it("uses plural wording for a single non-1 km badge", () => {
    const specs = mergeCoincidentDistanceBadges([
      { distanceFromStartMetres: 5000, coordinate: [0.05, 51] },
    ]);
    expect(specs[0]).toMatchObject({ ariaLabel: "5 kilometres from route start" });
  });
});

describe("capDistanceBadgeMarkerSpecs", () => {
  function spec(id: string): DistanceBadgeMarkerSpec {
    return { id, coordinate: [0, 51], label: id, ariaLabel: id };
  }

  it("truncates to maxCount, keeping the earliest (nearest-to-start) entries", () => {
    const specs = [spec("1"), spec("2"), spec("3"), spec("4")];
    expect(capDistanceBadgeMarkerSpecs(specs, 2)).toEqual([spec("1"), spec("2")]);
  });

  it("returns a list already within the cap unchanged", () => {
    const specs = [spec("1"), spec("2")];
    expect(capDistanceBadgeMarkerSpecs(specs, 5)).toEqual(specs);
  });

  it("returns no badges for an invalid maxCount", () => {
    const specs = [spec("1")];
    expect(capDistanceBadgeMarkerSpecs(specs, 0)).toEqual([]);
    expect(capDistanceBadgeMarkerSpecs(specs, -1)).toEqual([]);
    expect(capDistanceBadgeMarkerSpecs(specs, Number.NaN)).toEqual([]);
  });

  it("applies the default MAX_WHOLE_ROUTE_DISTANCE_BADGES cap when none is given", () => {
    const specs = Array.from({ length: MAX_WHOLE_ROUTE_DISTANCE_BADGES + 10 }, (_, i) =>
      spec(String(i)),
    );
    expect(capDistanceBadgeMarkerSpecs(specs)).toHaveLength(
      MAX_WHOLE_ROUTE_DISTANCE_BADGES,
    );
  });
});

describe("buildDistanceBadgeMarkerSpecs", () => {
  function longRoute(totalMetres: number, stepMetres = 5000): RoutePoint[] {
    const points: RoutePoint[] = [];
    for (let d = 0; d <= totalMetres; d += stepMetres) {
      points.push(point(d, d / 100_000));
    }
    return points;
  }

  it("shows every badge on the whole route when progress is null", () => {
    const route = longRoute(5000);
    const specs = buildDistanceBadgeMarkerSpecs(route, 1000, null);
    expect(specs.map((s) => s.label)).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps the next absolute badge ahead of progress — 37 km progress leaves 40 km, never renumbered", () => {
    const route = longRoute(45000);
    const specs = buildDistanceBadgeMarkerSpecs(route, 10000, 37000);
    expect(specs.map((s) => s.label)).toEqual(["40"]);
  });

  it("always formats labels as absolute whole-kilometre values regardless of progress", () => {
    const route = longRoute(45000);
    const specs = buildDistanceBadgeMarkerSpecs(route, 10000, 20000);
    expect(specs.map((s) => s.label)).toEqual(["20", "30", "40"]);
  });

  it("caps a long route's badge count", () => {
    const route = longRoute(500_000, 1000);
    const specs = buildDistanceBadgeMarkerSpecs(route, 1000, null);
    expect(specs).toHaveLength(MAX_WHOLE_ROUTE_DISTANCE_BADGES);
    expect(specs[0]).toMatchObject({ label: "1" });
  });

  it("merges an out-and-back overlap end-to-end, through real route placement", () => {
    // The 5km outbound point and the 15km return point sit at the exact
    // same coordinate; the route continues on afterwards so 15km isn't
    // itself suppressed by finish clearance.
    const points: RoutePoint[] = [
      point(0, 0),
      point(5000, 0.05),
      point(10000, 0.1),
      point(15000, 0.05),
      point(20000, 0.2),
    ];
    const specs = buildDistanceBadgeMarkerSpecs(points, 5000, null);
    const merged = specs.find((s) => s.label.includes("/"));
    expect(merged?.label).toBe("5 / 15");
  });

  it("prefers an upcoming marker over a completed one at the same place", () => {
    // Out-and-back: 5km outbound and 15km return share a coordinate.
    // Once progress passes 12km, the completed 5km badge is dropped
    // before the merge step runs, so 15km survives as its own true
    // absolute label rather than resurfacing merged with it.
    const points: RoutePoint[] = [
      point(0, 0),
      point(5000, 0.05),
      point(10000, 0.1),
      point(15000, 0.05),
      point(20000, 0.2),
      point(25000, 0.25),
    ];
    const specs = buildDistanceBadgeMarkerSpecs(points, 5000, 12000);
    expect(specs.map((s) => s.label)).toEqual(["15", "20"]);
  });

  it("accepts an explicit maxCount, capping below the default whole-route cap", () => {
    const route = longRoute(50_000, 1000);
    const specs = buildDistanceBadgeMarkerSpecs(route, 1000, null, 3);
    expect(specs.map((s) => s.label)).toEqual(["1", "2", "3"]);
  });
});

describe("selectActiveUpcomingBadgeSpacingMetres", () => {
  // Distinct from selectDistanceBadgeIntervalMetres's own
  // ISOLATED_ROUTE_LENGTH_METRES fixture — this selector never takes a
  // route length at all, so no such fixture is needed here.

  it("selects 20 km at wide overview zoom", () => {
    expect(selectActiveUpcomingBadgeSpacingMetres(8)).toBe(20000);
    expect(selectActiveUpcomingBadgeSpacingMetres(0)).toBe(20000);
    expect(selectActiveUpcomingBadgeSpacingMetres(-5)).toBe(20000);
  });

  it("selects 10 km at regional zoom", () => {
    expect(selectActiveUpcomingBadgeSpacingMetres(9)).toBe(10000);
    expect(selectActiveUpcomingBadgeSpacingMetres(10)).toBe(10000);
    expect(selectActiveUpcomingBadgeSpacingMetres(11)).toBe(10000);
  });

  it("selects 5 km at intermediate zoom", () => {
    expect(selectActiveUpcomingBadgeSpacingMetres(12)).toBe(5000);
    expect(selectActiveUpcomingBadgeSpacingMetres(13)).toBe(5000);
  });

  it("selects 2 km at the new near zoom band (exactly zoom 14)", () => {
    expect(selectActiveUpcomingBadgeSpacingMetres(14)).toBe(2000);
  });

  it("selects 1 km at street zoom and above", () => {
    expect(selectActiveUpcomingBadgeSpacingMetres(15)).toBe(1000);
    expect(selectActiveUpcomingBadgeSpacingMetres(16)).toBe(1000);
    expect(selectActiveUpcomingBadgeSpacingMetres(30)).toBe(1000);
  });

  it("is exact at every boundary, on both sides", () => {
    expect(selectActiveUpcomingBadgeSpacingMetres(8.99)).toBe(20000);
    expect(selectActiveUpcomingBadgeSpacingMetres(9.0)).toBe(10000);
    expect(selectActiveUpcomingBadgeSpacingMetres(11.99)).toBe(10000);
    expect(selectActiveUpcomingBadgeSpacingMetres(12.0)).toBe(5000);
    expect(selectActiveUpcomingBadgeSpacingMetres(13.99)).toBe(5000);
    expect(selectActiveUpcomingBadgeSpacingMetres(14.0)).toBe(2000);
    expect(selectActiveUpcomingBadgeSpacingMetres(14.99)).toBe(2000);
    expect(selectActiveUpcomingBadgeSpacingMetres(15.0)).toBe(1000);
  });

  it("handles non-finite zoom safely via an explicit guard (NaN, +Infinity, -Infinity all fall back to 20 km)", () => {
    expect(selectActiveUpcomingBadgeSpacingMetres(Number.NaN)).toBe(20000);
    // Without the explicit Number.isFinite guard, +Infinity would
    // incorrectly satisfy `zoom >= ACTIVE_UPCOMING_BADGE_CLOSE_ZOOM_MIN`
    // and wrongly select 1 km — this is the case the guard exists for.
    expect(selectActiveUpcomingBadgeSpacingMetres(Number.POSITIVE_INFINITY)).toBe(20000);
    expect(selectActiveUpcomingBadgeSpacingMetres(Number.NEGATIVE_INFINITY)).toBe(20000);
  });

  it("diverges from the whole-route selector at zoom 14, a band the whole-route family doesn't have", () => {
    expect(selectActiveUpcomingBadgeSpacingMetres(14)).toBe(2000);
    expect(selectDistanceBadgeIntervalMetres(14, 22_000)).toBe(5000);
  });
});

describe("buildActiveUpcomingDistanceBadgeMarkerSpecs", () => {
  function longRoute(totalMetres: number, stepMetres = 1000): RoutePoint[] {
    const points: RoutePoint[] = [];
    for (let d = 0; d <= totalMetres; d += stepMetres) {
      points.push(point(d, d / 100_000));
    }
    return points;
  }

  // Builds a route identical to longRoute, except the point at
  // `coincidentAtMetres` is given the same coordinate `longRoute` would
  // have generated for `sameCoordinateAsMetres` — a deliberate geometric
  // coincidence for exercising mergeCoincidentDistanceBadges end-to-end,
  // independent of any real out-and-back route shape.
  function longRouteWithCoincidence(
    totalMetres: number,
    stepMetres: number,
    [sameCoordinateAsMetres, coincidentAtMetres]: readonly [number, number],
  ): RoutePoint[] {
    const points: RoutePoint[] = [];
    for (let d = 0; d <= totalMetres; d += stepMetres) {
      const lon =
        d === coincidentAtMetres ? sameCoordinateAsMetres / 100_000 : d / 100_000;
      points.push(point(d, lon));
    }
    return points;
  }

  it("falls back to the exact whole-route policy when progress is null (no reliable fix yet)", () => {
    // Long enough that the whole-route selector's own escalation genuinely
    // fires — proves the *whole* whole-route policy is used, not just
    // interval-band lookup.
    const route = longRoute(100_000);
    const zoom = 16;
    const routeLengthMetres = route.at(-1)?.distanceFromStartMetres ?? 0;
    const expected = buildDistanceBadgeMarkerSpecs(
      route,
      selectDistanceBadgeIntervalMetres(zoom, routeLengthMetres),
      null,
    );
    expect(buildActiveUpcomingDistanceBadgeMarkerSpecs(route, zoom, null)).toEqual(
      expected,
    );
  });

  it("falls back to the whole-route policy for non-finite progress too (NaN, +/-Infinity)", () => {
    const route = longRoute(100_000);
    const zoom = 16;
    const routeLengthMetres = route.at(-1)?.distanceFromStartMetres ?? 0;
    const expected = buildDistanceBadgeMarkerSpecs(
      route,
      selectDistanceBadgeIntervalMetres(zoom, routeLengthMetres),
      null,
    );
    for (const progress of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(buildActiveUpcomingDistanceBadgeMarkerSpecs(route, zoom, progress)).toEqual(
        expected,
      );
    }
  });

  it("keeps exactly the next ten 1 km badges ahead of progress (42.3 km worked example)", () => {
    const route = longRoute(60_000);
    const specs = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, 16, 42_300);
    expect(specs.map((s) => s.label)).toEqual([
      "43",
      "44",
      "45",
      "46",
      "47",
      "48",
      "49",
      "50",
      "51",
      "52",
    ]);
  });

  it("rolls the window forward by exactly one once progress crosses a badge", () => {
    const route = longRoute(60_000);
    const specs = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, 16, 43_001);
    expect(specs.map((s) => s.label)).toEqual([
      "44",
      "45",
      "46",
      "47",
      "48",
      "49",
      "50",
      "51",
      "52",
      "53",
    ]);
  });

  it("keeps a badge exactly at the current progress (inclusive boundary, matching filterActiveRidingCandidates)", () => {
    const route = longRoute(60_000);
    const atExactly43km = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, 16, 43_000);
    const justBefore = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, 16, 42_300);
    // Same leading edge (43 km) as the 42.3 km worked example above.
    expect(atExactly43km).toEqual(justBefore);
  });

  it("caps after merging: an 11-raw/10-group window keeps every group, including the merged one", () => {
    const route = longRouteWithCoincidence(52_000, 1000, [45_000, 50_000]);
    const specs = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, 16, 40_500);
    expect(specs.map((s) => s.label)).toEqual([
      "41",
      "42",
      "43",
      "44",
      "45 / 50",
      "46",
      "47",
      "48",
      "49",
      "51",
    ]);
  });

  it("caps after merging: a 12-raw/11-group window drops the furthest unmerged group, not the merged one", () => {
    const route = longRouteWithCoincidence(53_000, 1000, [45_000, 50_000]);
    const specs = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, 16, 40_500);
    expect(specs).toHaveLength(MAX_ACTIVE_UPCOMING_DISTANCE_BADGES);
    expect(specs.map((s) => s.label)).toEqual([
      "41",
      "42",
      "43",
      "44",
      "45 / 50",
      "46",
      "47",
      "48",
      "49",
      "51",
    ]);
  });

  it("keeps 1 km spacing at zoom 15 and 16 regardless of total route length (45/100/300 km) — the core regression proof", () => {
    for (const zoom of [15, 16]) {
      for (const totalKm of [45, 100, 300]) {
        const route = longRoute(totalKm * 1000);
        const specs = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, zoom, 0);
        expect(specs).toHaveLength(MAX_ACTIVE_UPCOMING_DISTANCE_BADGES);
        const labels = specs.map((s) => Number(s.label));
        for (let i = 1; i < labels.length; i += 1) {
          expect((labels[i] ?? 0) - (labels[i - 1] ?? 0)).toBe(1);
        }
      }
    }
  });

  it("sweeps zoom bands on a fixed long route/progress, matching the documented spacing at each", () => {
    const route = longRoute(300_000);
    const expectedSpacingKm: readonly (readonly [number, number])[] = [
      [8, 20],
      [10, 10],
      [13, 5],
      [14, 2],
      [16, 1],
    ];
    for (const [zoom, spacingKm] of expectedSpacingKm) {
      const specs = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, zoom, 0);
      expect(specs.length).toBeLessThanOrEqual(MAX_ACTIVE_UPCOMING_DISTANCE_BADGES);
      const labels = specs.map((s) => Number(s.label));
      for (let i = 1; i < labels.length; i += 1) {
        expect((labels[i] ?? 0) - (labels[i - 1] ?? 0)).toBe(spacingKm);
      }
    }
  });

  it("does not pad the window when fewer than ten candidates remain near the route end", () => {
    const route = longRoute(50_000);
    const specs = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, 16, 47_500);
    expect(specs.map((s) => s.label)).toEqual(["48", "49"]);
  });

  it("returns no badges for a route shorter than the active interval at the current zoom", () => {
    const route = longRoute(500, 500);
    const specs = buildActiveUpcomingDistanceBadgeMarkerSpecs(route, 16, 0);
    expect(specs).toEqual([]);
  });
});
