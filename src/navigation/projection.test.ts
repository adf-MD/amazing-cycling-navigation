import { describe, expect, it } from "vitest";
import {
  projectFixOntoRoute,
  LATERAL_TIE_TOLERANCE_METRES,
  CONTINUITY_PREFERENCE_METRES,
  PROGRESS_EPSILON_METRES,
} from "./projection.ts";
import type { ProjectionMatch, ProjectionResult } from "./types.ts";
import type { Coordinate, RoutePoint } from "../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import {
  OUT_AND_BACK_ROUTE_POINTS,
  OUT_AND_BACK_TURNAROUND_INDEX,
} from "../test/fixtures/outAndBackRoute.ts";
import { SELF_INTERSECTING_ROUTE_POINTS } from "../test/fixtures/selfIntersectingRoute.ts";
import { CLOSED_LOOP_ROUTE_POINTS } from "../test/fixtures/closedLoopRoute.ts";
import {
  OUT_AND_BACK_COINCIDENT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX,
  OUT_AND_BACK_COINCIDENT_SPARSE_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_SPARSE_TURNAROUND_INDEX,
  OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_SHORT_TURNAROUND_INDEX,
} from "../test/fixtures/outAndBackCoincidentRoute.ts";
import {
  REPEATED_PASS_ROUTE_POINTS,
  REPEATED_PASS_SECOND_STEM_START_INDEX,
} from "../test/fixtures/repeatedPassRoute.ts";
import { OFF_ROUTE_BASE_METRES } from "./offRoute.ts";

const STRAIGHT_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
);

/** A longer straight route (~3.5 km) — long enough that a lastMatch placed
 * mid-route produces a WINDOW_RADIUS_METRES (400 m) window genuinely
 * clipped on BOTH sides, for exercising isClippedAtEdge's two edges
 * independently of one another. */
const LONG_STRAIGHT_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.05, 51],
  ],
  100,
);

function expectResult(result: ProjectionResult | null): ProjectionResult {
  if (result === null) {
    throw new Error("expected a projection result");
  }
  return result;
}

/** Walks fixes (exactly at each route point) through the whole route in
 * order, feeding each result's match back in as the next lastMatch, and
 * returns every result in sequence. */
function walkRoute(points: readonly RoutePoint[]): ProjectionResult[] {
  const results: ProjectionResult[] = [];
  let lastMatch: ProjectionMatch | null = null;

  for (const routePoint of points) {
    const result = expectResult(
      projectFixOntoRoute(routePoint.coordinate, points, lastMatch),
    );
    results.push(result);
    lastMatch = result;
  }

  return results;
}

/** Latitude-51 longitude-degrees-per-metre, matching
 * outAndBackCoincidentRoute.ts's own constant-latitude equirectangular
 * approximation — used only to place synthetic fix coordinates a given
 * metres beyond a fixture's own physical extent (Trace C's overshoot). */
const METRES_PER_DEGREE_LONGITUDE_AT_51 = 111_320 * Math.cos((51 * Math.PI) / 180);

/** Linearly interpolates the coordinate at a given along-route distance,
 * bracketed by the two fixture points either side of it. Used so tests
 * can be written in terms of route distance (e.g. "20 m before the
 * turnaround") without hand-computing coordinates, and so they stay
 * correct if a fixture's own exact computed distances shift slightly. */
function coordinateAtDistance(
  points: readonly RoutePoint[],
  targetDistanceMetres: number,
): Coordinate {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    if (
      targetDistanceMetres >= a.distanceFromStartMetres &&
      targetDistanceMetres <= b.distanceFromStartMetres
    ) {
      const span = b.distanceFromStartMetres - a.distanceFromStartMetres;
      const fraction =
        span === 0 ? 0 : (targetDistanceMetres - a.distanceFromStartMetres) / span;
      return [
        a.coordinate[0] + fraction * (b.coordinate[0] - a.coordinate[0]),
        a.coordinate[1] + fraction * (b.coordinate[1] - a.coordinate[1]),
      ];
    }
  }
  throw new Error(`distance ${String(targetDistanceMetres)} outside fixture range`);
}

describe("projectFixOntoRoute", () => {
  it("returns null for a route with fewer than 2 points", () => {
    expect(projectFixOntoRoute([0, 51], [], null)).toBeNull();
    expect(
      projectFixOntoRoute(
        [0, 51],
        [{ coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 }],
        null,
      ),
    ).toBeNull();
  });

  it("matches a fix exactly on the route with ~0 lateral distance", () => {
    const midpoint = STRAIGHT_ROUTE_POINTS[10];
    if (!midpoint) throw new Error("fixture missing expected point");

    const result = expectResult(
      projectFixOntoRoute(midpoint.coordinate, STRAIGHT_ROUTE_POINTS, null),
    );

    expect(result.lateralDistanceMetres).toBeLessThan(0.01);
    expect(result.distanceFromStartMetres).toBeCloseTo(
      midpoint.distanceFromStartMetres,
      1,
    );
    expect(result.reacquired).toBe(true); // no lastMatch => whole-route search
  });

  it("finds a fix offset a small distance to the side of the route", () => {
    const fixCoordinate: Coordinate = [0.005, 51.0005];
    const result = expectResult(
      projectFixOntoRoute(fixCoordinate, STRAIGHT_ROUTE_POINTS, null),
    );

    expect(result.lateralDistanceMetres).toBeGreaterThan(0);
    expect(result.lateralDistanceMetres).toBeLessThan(100);
  });

  describe("continuity", () => {
    it("keeps distanceFromStartMetres monotonically increasing through a self-intersection", () => {
      const results = walkRoute(SELF_INTERSECTING_ROUTE_POINTS);

      for (let i = 1; i < results.length; i += 1) {
        const previous = results[i - 1];
        const current = results[i];
        expect(current?.distanceFromStartMetres).toBeGreaterThanOrEqual(
          previous?.distanceFromStartMetres ?? 0,
        );
      }
    });

    it("stays locked to each pass near the self-intersection rather than jumping to the other one", () => {
      const results = walkRoute(SELF_INTERSECTING_ROUTE_POINTS);

      // Walking forward, the matched point index should never regress by
      // more than a small amount (no snapping back to the earlier pass).
      for (let i = 1; i < results.length; i += 1) {
        const previous = results[i - 1];
        const current = results[i];
        expect(current?.pointIndex ?? 0).toBeGreaterThanOrEqual(
          (previous?.pointIndex ?? 0) - 1,
        );
      }
    });

    it("keeps distanceFromStartMetres monotonically increasing on an out-and-back route", () => {
      const results = walkRoute(OUT_AND_BACK_ROUTE_POINTS);

      for (let i = 1; i < results.length; i += 1) {
        const previous = results[i - 1];
        const current = results[i];
        expect(current?.distanceFromStartMetres).toBeGreaterThanOrEqual(
          previous?.distanceFromStartMetres ?? 0,
        );
      }
    });

    it("stays on the return leg after the turnaround despite the outbound leg being geographically close", () => {
      const results = walkRoute(OUT_AND_BACK_ROUTE_POINTS);

      for (let i = OUT_AND_BACK_TURNAROUND_INDEX; i < results.length; i += 1) {
        expect(results[i]?.pointIndex ?? 0).toBeGreaterThanOrEqual(
          OUT_AND_BACK_TURNAROUND_INDEX - 1,
        );
      }
    });

    it("keeps distanceFromStartMetres monotonically increasing around a closed loop, including at the shared start/finish coordinate", () => {
      const results = walkRoute(CLOSED_LOOP_ROUTE_POINTS);

      for (let i = 1; i < results.length; i += 1) {
        const previous = results[i - 1];
        const current = results[i];
        expect(current?.distanceFromStartMetres).toBeGreaterThanOrEqual(
          previous?.distanceFromStartMetres ?? 0,
        );
      }
    });
  });

  describe("windowing and reacquire", () => {
    it("does not reacquire when the fix is a normal small step from the last match", () => {
      const first = expectResult(
        projectFixOntoRoute(
          STRAIGHT_ROUTE_POINTS[5]?.coordinate ?? [0, 51],
          STRAIGHT_ROUTE_POINTS,
          null,
        ),
      );
      const second = expectResult(
        projectFixOntoRoute(
          STRAIGHT_ROUTE_POINTS[6]?.coordinate ?? [0, 51],
          STRAIGHT_ROUTE_POINTS,
          first,
        ),
      );

      expect(second.reacquired).toBe(false);
    });

    it("reacquires via a whole-route search when the last match is far from the new fix", () => {
      const farAwayLastMatch: ProjectionMatch = {
        pointIndex: 0,
        distanceFromStartMetres: 0,
      };
      const farFixCoordinate = STRAIGHT_ROUTE_POINTS.at(-1)?.coordinate ?? [0, 51];

      const result = expectResult(
        projectFixOntoRoute(farFixCoordinate, STRAIGHT_ROUTE_POINTS, farAwayLastMatch),
      );

      expect(result.reacquired).toBe(true);
      expect(result.lateralDistanceMetres).toBeLessThan(1);
    });

    // Regression coverage for a real field defect: near a closed loop's
    // finish, the search window is clipped only on its lower (start) side
    // (there's nothing beyond the route's own total distance to clip on
    // the upper side). A windowed match sitting at the route's genuine,
    // un-clipped final boundary must not be rejected on the strength of
    // the unrelated lower-side clip — see isClippedAtEdge's own doc
    // comment in projection.ts.
    describe("closed-loop start/finish coincidence", () => {
      const lastMatchNearFinish: ProjectionMatch = {
        pointIndex: 79,
        distanceFromStartMetres:
          CLOSED_LOOP_ROUTE_POINTS[79]?.distanceFromStartMetres ?? 0,
      };
      const routeTotalDistanceMetres =
        CLOSED_LOOP_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0;

      it("does not fall back to a whole-route reacquire when the fix is exactly at the shared finish coordinate", () => {
        const finishCoordinate = CLOSED_LOOP_ROUTE_POINTS.at(-1)?.coordinate ?? [0, 51];

        const result = expectResult(
          projectFixOntoRoute(
            finishCoordinate,
            CLOSED_LOOP_ROUTE_POINTS,
            lastMatchNearFinish,
          ),
        );

        expect(result.reacquired).toBe(false);
        expect(result.distanceFromStartMetres).toBeCloseTo(routeTotalDistanceMetres, 0);
      });

      it("does not fall back to a whole-route reacquire when the fix is a few metres past the shared finish coordinate", () => {
        // ~16.7 m past [0, 51] continuing in the closing segment's own
        // direction of travel (decreasing latitude at longitude 0) — the
        // "rider continued a few metres past the finish looking for
        // parking" field scenario.
        const pastFinishCoordinate: Coordinate = [0, 50.99985];

        const result = expectResult(
          projectFixOntoRoute(
            pastFinishCoordinate,
            CLOSED_LOOP_ROUTE_POINTS,
            lastMatchNearFinish,
          ),
        );

        expect(result.reacquired).toBe(false);
        expect(result.distanceFromStartMetres).toBeCloseTo(routeTotalDistanceMetres, 0);
      });

      it("resolves a fresh ride's first fix at the shared coordinate to the start, not the finish", () => {
        // With no lastMatch, projectFixOntoRoute always does a whole-route
        // search — isClippedAtEdge is never reached, so this is unaffected
        // by the fix above and must keep working exactly as before. It
        // depends on @turf/nearest-point-on-line's own internal (strict
        // less-than) tie-break resolving an exact geometric coincidence to
        // the first-encountered vertex, i.e. the route's start — an
        // undocumented implementation detail, not a public contract, so a
        // future turf version bump (package.json pins it via a caret
        // range) that changes this result is a legible, expected flag
        // point for this test, not a mystery regression.
        const startCoordinate = CLOSED_LOOP_ROUTE_POINTS[0]?.coordinate ?? [0, 51];

        const result = expectResult(
          projectFixOntoRoute(startCoordinate, CLOSED_LOOP_ROUTE_POINTS, null),
        );

        expect(result.distanceFromStartMetres).toBeCloseTo(0, 0);
      });
    });

    describe("genuine window-edge clipping", () => {
      const lastMatchMidRoute: ProjectionMatch = {
        pointIndex: 50,
        distanceFromStartMetres:
          LONG_STRAIGHT_ROUTE_POINTS[50]?.distanceFromStartMetres ?? 0,
      };

      it("still reacquires when the windowed match sits at a genuinely clipped start edge", () => {
        const fixCoordinate = LONG_STRAIGHT_ROUTE_POINTS[36]?.coordinate ?? [0, 51];

        const result = expectResult(
          projectFixOntoRoute(
            fixCoordinate,
            LONG_STRAIGHT_ROUTE_POINTS,
            lastMatchMidRoute,
          ),
        );

        expect(result.reacquired).toBe(true);
      });

      it("still reacquires when the windowed match sits at a genuinely clipped end edge", () => {
        const fixCoordinate = LONG_STRAIGHT_ROUTE_POINTS[64]?.coordinate ?? [0, 51];

        const result = expectResult(
          projectFixOntoRoute(
            fixCoordinate,
            LONG_STRAIGHT_ROUTE_POINTS,
            lastMatchMidRoute,
          ),
        );

        expect(result.reacquired).toBe(true);
      });
    });
  });

  // Backlog item 104: preserve route progress through exactly overlapping
  // out-and-back turnarounds. Unlike outAndBackRoute.ts's ~11 m-offset
  // return leg, OUT_AND_BACK_COINCIDENT_ROUTE_POINTS's return leg is an
  // EXACT coordinate-for-coordinate retrace of the outbound leg, so the
  // outbound and return occurrences of the same physical point are
  // genuinely, not merely approximately, tied in lateral distance —
  // confirmed by direct measurement to differ only by floating-point
  // noise on the order of 1e-7 m or less (see LATERAL_TIE_TOLERANCE_METRES's
  // own doc comment in projection.ts).
  //
  // A fresh whole-route reacquire (lastMatch: null) on this fixture is
  // itself subject to that same floating-point-noise-driven tie-break —
  // every point on the coincident stretch has a tied mirror somewhere
  // else in the array, so which occurrence a fresh reacquire lands on is
  // not reliably predictable (this is unchanged, out-of-scope behaviour,
  // see item 46's own precedent for why a fresh-start tie is accepted).
  // Tests below therefore seed a known starting `lastMatch` directly via
  // `outboundMatchAtDistance`, never via a real `projectFixOntoRoute(...,
  // null)` call, so each test's own decisive fix is the only ambiguous
  // step being exercised.
  describe("out-and-back with an exactly coincident return leg (backlog item 104)", () => {
    const DENSE_POINTS = OUT_AND_BACK_COINCIDENT_ROUTE_POINTS;
    const DENSE_T_IDX = OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX;
    const DENSE_T = DENSE_POINTS[DENSE_T_IDX]?.distanceFromStartMetres ?? 0;

    /** Deterministically constructs a ProjectionMatch on the OUTBOUND
     * side only (searching array indices strictly before
     * `turnaroundIndex`), so it can never accidentally land on the
     * coincident return occurrence — unlike a real `projectFixOntoRoute`
     * call, which (per the module comment above) is not reliably
     * deterministic for a target on the coincident stretch. */
    function outboundMatchAtDistance(
      points: readonly RoutePoint[],
      turnaroundIndex: number,
      targetDistanceMetres: number,
    ): ProjectionMatch {
      for (let i = 0; i < turnaroundIndex; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (!a || !b) continue;
        if (
          targetDistanceMetres >= a.distanceFromStartMetres &&
          targetDistanceMetres <= b.distanceFromStartMetres
        ) {
          return { pointIndex: i, distanceFromStartMetres: targetDistanceMetres };
        }
      }
      throw new Error(`distance ${String(targetDistanceMetres)} outside outbound range`);
    }

    it("normal forward approach does not prematurely switch to the return leg", () => {
      const lastMatch = outboundMatchAtDistance(DENSE_POINTS, DENSE_T_IDX, DENSE_T - 30);
      const next = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, DENSE_T - 20),
          DENSE_POINTS,
          lastMatch,
        ),
      );

      expect(next.distanceFromStartMetres).toBeGreaterThan(
        lastMatch.distanceFromStartMetres,
      );
      expect(next.distanceFromStartMetres).toBeLessThan(DENSE_T);
      expect(next.pointIndex).toBeLessThan(DENSE_T_IDX);
    });

    it("normal forward approach on sparse/irregular spacing does not prematurely switch, with lastMatch in either half of the final segment", () => {
      const points = OUT_AND_BACK_COINCIDENT_SPARSE_ROUTE_POINTS;
      const turnaroundIndex = OUT_AND_BACK_COINCIDENT_SPARSE_TURNAROUND_INDEX;
      const T = points[turnaroundIndex]?.distanceFromStartMetres ?? 0;

      // lastMatch closer to the EARLIER vertex of the final ~50 m segment.
      const lastMatchEarlyHalf = outboundMatchAtDistance(points, turnaroundIndex, T - 40);
      const nextEarlyHalf = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(points, T - 30),
          points,
          lastMatchEarlyHalf,
        ),
      );
      expect(nextEarlyHalf.distanceFromStartMetres).toBeGreaterThan(
        lastMatchEarlyHalf.distanceFromStartMetres,
      );
      expect(nextEarlyHalf.pointIndex).toBeLessThan(turnaroundIndex);

      // lastMatch closer to the LATER (turnaround) vertex of the same segment.
      const lastMatchLateHalf = outboundMatchAtDistance(points, turnaroundIndex, T - 15);
      const nextLateHalf = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(points, T - 8),
          points,
          lastMatchLateHalf,
        ),
      );
      expect(nextLateHalf.distanceFromStartMetres).toBeGreaterThan(
        lastMatchLateHalf.distanceFromStartMetres,
      );
      expect(nextLateHalf.pointIndex).toBeLessThan(turnaroundIndex);
    });

    it("Trace A: approach, an exact fix at the turnaround, then return — progress advances past the turnaround", () => {
      const approachLastMatch = outboundMatchAtDistance(
        DENSE_POINTS,
        DENSE_T_IDX,
        DENSE_T - 20,
      );

      const atTurnaround = expectResult(
        projectFixOntoRoute(
          DENSE_POINTS[DENSE_T_IDX]?.coordinate ?? [0, 51],
          DENSE_POINTS,
          approachLastMatch,
        ),
      );
      expect(atTurnaround.distanceFromStartMetres).toBeCloseTo(DENSE_T, 0);
      expect(atTurnaround.reacquired).toBe(false);

      const firstReturnFix = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, DENSE_T + 20),
          DENSE_POINTS,
          atTurnaround,
        ),
      );
      expect(firstReturnFix.distanceFromStartMetres).toBeGreaterThan(
        atTurnaround.distanceFromStartMetres,
      );
      expect(firstReturnFix.pointIndex).toBeGreaterThanOrEqual(DENSE_T_IDX);
      expect(firstReturnFix.lateralDistanceMetres).toBeLessThan(1);

      const secondReturnFix = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, DENSE_T + 40),
          DENSE_POINTS,
          firstReturnFix,
        ),
      );
      expect(secondReturnFix.distanceFromStartMetres).toBeGreaterThan(
        firstReturnFix.distanceFromStartMetres,
      );
    });

    it("Trace B: no exact turnaround fix — progress never decreases across the sequence and transfers to the return leg", () => {
      const nearTurn = outboundMatchAtDistance(DENSE_POINTS, DENSE_T_IDX, DENSE_T - 8);

      // A gap in fixes: the rider reaches and passes the turnaround
      // unobserved, and the next fixes land progressively further along
      // the return leg — never exactly at the apex itself. `nearTurn`
      // (only 8 m short of the turnaround) is the prior evidence.
      const sequenceDistances = [DENSE_T + 25, DENSE_T + 45, DENSE_T + 65];
      let previous: ProjectionMatch = nearTurn;
      let transferred = false;
      for (const targetDistance of sequenceDistances) {
        const result = expectResult(
          projectFixOntoRoute(
            coordinateAtDistance(DENSE_POINTS, targetDistance),
            DENSE_POINTS,
            previous,
          ),
        );
        expect(result.distanceFromStartMetres).toBeGreaterThanOrEqual(
          previous.distanceFromStartMetres,
        );
        if (result.pointIndex >= DENSE_T_IDX) {
          transferred = true;
        }
        previous = result;
      }
      expect(transferred).toBe(true);
    });

    it("Trace C: continuing past the turnaround raises lateral distance appropriately, then a genuine return advances again", () => {
      const approachLastMatch = outboundMatchAtDistance(
        DENSE_POINTS,
        DENSE_T_IDX,
        DENSE_T - 5,
      );
      const atTurnaround = expectResult(
        projectFixOntoRoute(
          DENSE_POINTS[DENSE_T_IDX]?.coordinate ?? [0, 51],
          DENSE_POINTS,
          approachLastMatch,
        ),
      );

      // ~100 m further east of the turnaround, continuing in the original
      // outbound direction — there is no route geometry out there.
      const overshootCoordinate: Coordinate = [
        0.03 + 100 / METRES_PER_DEGREE_LONGITUDE_AT_51,
        51,
      ];
      const overshoot = expectResult(
        projectFixOntoRoute(overshootCoordinate, DENSE_POINTS, atTurnaround),
      );
      expect(overshoot.reacquired).toBe(false);
      expect(overshoot.lateralDistanceMetres).toBeGreaterThan(OFF_ROUTE_BASE_METRES);
      expect(overshoot.pointIndex).toBeGreaterThanOrEqual(DENSE_T_IDX - 1);
      expect(overshoot.pointIndex).toBeLessThanOrEqual(DENSE_T_IDX + 1);

      const backOnReturn = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, DENSE_T + 30),
          DENSE_POINTS,
          overshoot,
        ),
      );
      expect(backOnReturn.distanceFromStartMetres).toBeGreaterThan(
        atTurnaround.distanceFromStartMetres,
      );
      expect(backOnReturn.lateralDistanceMetres).toBeLessThan(1);
    });

    it("Trace D: genuine backtracking well before the turnaround is preserved, with no premature forward jump", () => {
      const beforeBacktrack = outboundMatchAtDistance(
        DENSE_POINTS,
        DENSE_T_IDX,
        DENSE_T - 200,
      );
      const backtracked = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, DENSE_T - 260),
          DENSE_POINTS,
          beforeBacktrack,
        ),
      );

      expect(backtracked.distanceFromStartMetres).toBeLessThan(
        beforeBacktrack.distanceFromStartMetres,
      );
      expect(backtracked.pointIndex).toBeLessThanOrEqual(beforeBacktrack.pointIndex);
      expect(backtracked.lateralDistanceMetres).toBeLessThan(1);
    });

    it("Trace D variant: closer genuine backtracking, with a tied leading candidate present in-window, is still preserved", () => {
      // lastMatch 50 m short of the turnaround, backtracking a further
      // 40 m away — comfortably outside the accepted near-crossover
      // ambiguity zone (see CONTINUITY_PREFERENCE_METRES's own doc
      // comment), but close enough that the return-leg mirror of the
      // backtracked position is still inside the ±400 m window, so a
      // genuinely tied leading candidate exists and must still lose.
      const lastMatch = outboundMatchAtDistance(DENSE_POINTS, DENSE_T_IDX, DENSE_T - 50);
      const backtracked = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, DENSE_T - 90),
          DENSE_POINTS,
          lastMatch,
        ),
      );

      expect(backtracked.distanceFromStartMetres).toBeLessThan(
        lastMatch.distanceFromStartMetres,
      );
      expect(backtracked.pointIndex).toBeLessThan(DENSE_T_IDX);
      expect(backtracked.lateralDistanceMetres).toBeLessThan(1);
    });

    it("a repeated identical fix near the crossover retains the continuity-nearest occurrence (no flapping)", () => {
      const seed = outboundMatchAtDistance(DENSE_POINTS, DENSE_T_IDX, DENSE_T - 15);
      const fixCoordinate = coordinateAtDistance(DENSE_POINTS, DENSE_T - 15);
      let previous: ProjectionMatch = seed;
      for (let i = 0; i < 5; i += 1) {
        const result = expectResult(
          projectFixOntoRoute(fixCoordinate, DENSE_POINTS, previous),
        );
        expect(result.pointIndex).toBe(previous.pointIndex);
        expect(result.distanceFromStartMetres).toBeCloseTo(
          previous.distanceFromStartMetres,
          1,
        );
        previous = result;
      }
    });

    it("small jitter near the crossover retains the continuity-nearest occurrence rather than flapping onto the return leg", () => {
      const seed = outboundMatchAtDistance(DENSE_POINTS, DENSE_T_IDX, DENSE_T - 10);
      let previous: ProjectionMatch = seed;
      // Small back-and-forth jitter (each individual step's own
      // resulting regression stays comfortably under any plausible
      // PROGRESS_EPSILON_METRES) — must not be read as evidence the
      // turnaround was reached.
      const jitterTargets = [
        DENSE_T - 9,
        DENSE_T - 11,
        DENSE_T - 9.5,
        DENSE_T - 10.5,
        DENSE_T - 9,
        DENSE_T - 11.5,
      ];
      for (const target of jitterTargets) {
        const result = expectResult(
          projectFixOntoRoute(
            coordinateAtDistance(DENSE_POINTS, target),
            DENSE_POINTS,
            previous,
          ),
        );
        expect(result.pointIndex).toBeLessThan(DENSE_T_IDX);
        previous = result;
      }
    });

    it("return-vs-backtracking ambiguity characterisation near a sparse, irregular turnaround (not a normal-approach case)", () => {
      // T ~= 2098, vertices at ~2048/2098, lastMatch = T-27 (~2071), tied
      // candidates at T-37 (~2061, a genuine 10 m regression from
      // lastMatch) and T+37 (~2135, a genuine 64 m advance). This is
      // deliberately NOT the clean "normal forward approach" case above —
      // the continuity-nearest occurrence here (T-37) IS a genuine
      // regression, so the outcome depends on whether the advancing
      // alternative's own gap (64 m) falls within CONTINUITY_PREFERENCE_METRES
      // (pinned at 30 m) of the regressing candidate's own gap (10 m): it
      // does not (54 m > 30 m), so the override does not fire and the
      // continuity-nearest (regressing) candidate wins — i.e. this
      // fixture/offset combination is read as "still approaching, wobbled
      // backward" rather than "already turned around", which is the
      // correct, conservative reading given no other evidence. A
      // different CONTINUITY_PREFERENCE_METRES value could legitimately
      // flip this — if the pinned constants change, recompute and update
      // this assertion and its reasoning together, do not just widen it.
      const points = OUT_AND_BACK_COINCIDENT_SPARSE_ROUTE_POINTS;
      const turnaroundIndex = OUT_AND_BACK_COINCIDENT_SPARSE_TURNAROUND_INDEX;
      const T = points[turnaroundIndex]?.distanceFromStartMetres ?? 0;
      const lastMatch = outboundMatchAtDistance(points, turnaroundIndex, T - 27);
      const tiedFixCoordinate = coordinateAtDistance(points, T - 37);
      const result = expectResult(
        projectFixOntoRoute(tiedFixCoordinate, points, lastMatch),
      );

      expect(result.lateralDistanceMetres).toBeLessThan(1);
      expect(result.pointIndex).toBeLessThan(turnaroundIndex);
      expect(result.distanceFromStartMetres).toBeLessThan(
        lastMatch.distanceFromStartMetres,
      );
    });
  });

  // Backlog item 104: permanent boundary tests for the three new
  // constants, derived from their own exported values (never hardcoded
  // literals), mirroring offRoute.test.ts's own
  // POSSIBLY_OFF_ROUTE_BASE_METRES - 1 convention.
  describe("tie-tolerance, continuity-preference and progress-epsilon boundaries (backlog item 104)", () => {
    const DENSE_POINTS = OUT_AND_BACK_COINCIDENT_ROUTE_POINTS;
    const DENSE_T_IDX = OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX;
    const DENSE_T = DENSE_POINTS[DENSE_T_IDX]?.distanceFromStartMetres ?? 0;

    function outboundMatchAtDistance(
      points: readonly RoutePoint[],
      turnaroundIndex: number,
      targetDistanceMetres: number,
    ): ProjectionMatch {
      for (let i = 0; i < turnaroundIndex; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (!a || !b) continue;
        if (
          targetDistanceMetres >= a.distanceFromStartMetres &&
          targetDistanceMetres <= b.distanceFromStartMetres
        ) {
          return { pointIndex: i, distanceFromStartMetres: targetDistanceMetres };
        }
      }
      throw new Error(`distance ${String(targetDistanceMetres)} outside outbound range`);
    }

    /** Builds an out-and-back route whose return leg is offset by a
     * CONSTANT `offsetMetres` in latitude from the outbound leg —
     * mirroring outAndBackRoute.ts's own convention (a small step
     * immediately after the turnaround onto a parallel return leg, not a
     * gradually-growing offset), so the offset is fully established by
     * the time the fix under test is reached. Used to place the two
     * candidates' lateral-distance delta precisely on either side of
     * LATERAL_TIE_TOLERANCE_METRES. Waypoint indices: 0 (start), 150
     * (turnaround), 300 (start of the offset return leg, same longitude
     * as the turnaround), 450 (finish). */
    function buildOffsetOutAndBackPoints(offsetMetres: number): RoutePoint[] {
      const offsetDegreesLatitude = offsetMetres / 111_320;
      return buildRoutePointsFromWaypoints(
        [
          [0.0, 51.0],
          [0.03, 51.0],
          [0.03, 51.0 + offsetDegreesLatitude],
          [0.0, 51.0 + offsetDegreesLatitude],
        ],
        150,
      );
    }

    it("LATERAL_TIE_TOLERANCE_METRES boundary: an offset just under the tolerance is still read as a tie; just over, it is not", () => {
      const turnaroundIndex = 150;

      // The offset fixture's own outbound leg is identical to
      // DENSE_POINTS's own (same waypoints [0,51]->[0.03,51]), so DENSE_T
      // is also its turnaround distance. The fix coordinate is computed
      // from DENSE_POINTS's own exactly-coincident geometry — i.e.
      // exactly ON the (unmodified) outbound line's own mirror, and
      // therefore exactly `offsetMetres` off the offset fixture's actual,
      // shifted return leg.
      function resultWithOffset(offsetMetres: number): ProjectionResult {
        const offsetPoints = buildOffsetOutAndBackPoints(offsetMetres);
        const atTurnaround = expectResult(
          projectFixOntoRoute(
            offsetPoints[turnaroundIndex]?.coordinate ?? [0, 51],
            offsetPoints,
            null,
          ),
        );
        const fixCoordinate = coordinateAtDistance(DENSE_POINTS, DENSE_T + 20);
        return expectResult(
          projectFixOntoRoute(fixCoordinate, offsetPoints, atTurnaround),
        );
      }

      // Offset within tolerance: read as a genuine tie between the
      // exact, unmodified outbound-mirror candidate (lateral 0) and the
      // offset return-leg candidate (lateral ~= offsetMetres), so the
      // direction-aware override fires and progress advances, exactly as
      // it does for the exactly-coincident fixture's own Trace A.
      const resultSmall = resultWithOffset(LATERAL_TIE_TOLERANCE_METRES / 2);
      expect(resultSmall.distanceFromStartMetres).toBeGreaterThan(DENSE_T);

      // Offset beyond tolerance: not read as a tie, so only the single,
      // strictly-closer (outbound-mirror, lateral 0) candidate is ever
      // considered — the same behaviour outAndBackRoute.ts's own much
      // larger offset already relies on, confirming this item's new
      // logic does not widen scope to geometry that merely happens to be
      // close.
      const resultLarge = resultWithOffset(LATERAL_TIE_TOLERANCE_METRES * 3);
      expect(resultLarge.distanceFromStartMetres).toBeLessThan(DENSE_T);
    });

    it("CONTINUITY_PREFERENCE_METRES boundary: the forward override fires at the margin and not just past it", () => {
      const half = CONTINUITY_PREFERENCE_METRES / 2;
      const regressionTarget = half + 10; // comfortably a genuine regression in both cases below

      const lastMatchUnder = outboundMatchAtDistance(
        DENSE_POINTS,
        DENSE_T_IDX,
        DENSE_T - (half - 0.1),
      );
      const resultUnder = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, DENSE_T - regressionTarget),
          DENSE_POINTS,
          lastMatchUnder,
        ),
      );
      // gap difference = 2*(half-0.1), just under CONTINUITY_PREFERENCE_METRES: override fires.
      expect(resultUnder.pointIndex).toBeGreaterThanOrEqual(DENSE_T_IDX);
      expect(resultUnder.distanceFromStartMetres).toBeGreaterThan(
        lastMatchUnder.distanceFromStartMetres,
      );

      const lastMatchOver = outboundMatchAtDistance(
        DENSE_POINTS,
        DENSE_T_IDX,
        DENSE_T - (half + 0.1),
      );
      const resultOver = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, DENSE_T - regressionTarget),
          DENSE_POINTS,
          lastMatchOver,
        ),
      );
      // gap difference = 2*(half+0.1), just over CONTINUITY_PREFERENCE_METRES: override does not fire.
      expect(resultOver.pointIndex).toBeLessThan(DENSE_T_IDX);
      expect(resultOver.distanceFromStartMetres).toBeLessThan(
        lastMatchOver.distanceFromStartMetres,
      );
    });

    it("PROGRESS_EPSILON_METRES boundary: a regression just over epsilon triggers the override, just under does not", () => {
      const lastMatchDistanceOffset = 5; // small, fixed — keeps the resulting gap margin (2x this) comfortably under CONTINUITY_PREFERENCE_METRES regardless of its own pinned value, isolating epsilon as the only varying factor
      const lastMatch = outboundMatchAtDistance(
        DENSE_POINTS,
        DENSE_T_IDX,
        DENSE_T - lastMatchDistanceOffset,
      );

      const justUnderTarget =
        DENSE_T - (lastMatchDistanceOffset + (PROGRESS_EPSILON_METRES - 0.1));
      const resultUnder = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, justUnderTarget),
          DENSE_POINTS,
          lastMatch,
        ),
      );
      // Regression magnitude just under epsilon: not a genuine
      // regression, so the override never activates — stays trailing.
      expect(resultUnder.pointIndex).toBeLessThan(DENSE_T_IDX);

      const justOverTarget =
        DENSE_T - (lastMatchDistanceOffset + (PROGRESS_EPSILON_METRES + 0.1));
      const resultOver = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(DENSE_POINTS, justOverTarget),
          DENSE_POINTS,
          lastMatch,
        ),
      );
      // Regression magnitude just over epsilon: genuine regression, and
      // the gap margin (2x lastMatchDistanceOffset = 10) is comfortably
      // within CONTINUITY_PREFERENCE_METRES, so the override fires.
      expect(resultOver.pointIndex).toBeGreaterThanOrEqual(DENSE_T_IDX);
      expect(resultOver.distanceFromStartMetres).toBeGreaterThan(
        lastMatch.distanceFromStartMetres,
      );
    });
  });

  // Backlog item 104 follow-up. The boundary test directly above pins the
  // defect this block exists to close: a tied regression of less than
  // PROGRESS_EPSILON_METRES leaves the selector's forward override
  // completely unengaged and the trailing (outbound) occurrence is
  // returned. That is correct as a *projection* — but because every
  // accepted match becomes the next fix's own lastMatch, the epsilon then
  // gets applied per fix and never cumulatively, so a rider moving slowly
  // enough (walking, or any cadence producing sub-epsilon route-distance
  // steps) walks the match backwards down the mirror indefinitely, five
  // metres at a time, with the override never once evaluated.
  //
  // projectFixOntoRoute therefore does not change what it *returns* here;
  // it only labels the result, so the navigation core can decline to adopt
  // it as progress and keep measuring the next fix's regression against
  // the same stable anchor. See ProjectionDisposition in types.ts and
  // processFix in rideNavigationCore.ts, which is where the hold actually
  // happens — selectAmongOccurrences itself is unchanged and holds nothing.
  describe("tied sub-epsilon regression disposition (backlog item 104 follow-up)", () => {
    const SHORT_POINTS = OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS;
    const SHORT_T_IDX = OUT_AND_BACK_COINCIDENT_SHORT_TURNAROUND_INDEX;
    const SHORT_T = SHORT_POINTS[SHORT_T_IDX]?.distanceFromStartMetres ?? 0;

    /** lastMatch exactly at the short fixture's turnaround, expressed on
     * the outbound side (pointIndex before the turnaround), matching the
     * seeding discipline the block above documents. */
    function atShortTurnaround(): ProjectionMatch {
      return { pointIndex: SHORT_T_IDX - 1, distanceFromStartMetres: SHORT_T };
    }

    /** How far short of the turnaround the boundary tests below anchor
     * lastMatch. Deliberately non-zero: with lastMatch exactly AT the
     * turnaround, the two mirrored occurrences of any return fix are
     * equidistant from it, and which one wins is then decided by
     * sub-millimetre floating-point asymmetry in two great-circle
     * calculations — fine in practice (both readings are the rider's true
     * position and progress never regresses either way) but far too
     * knife-edge to pin a documented boundary against. Offsetting the
     * anchor makes the trailing occurrence unambiguously the nearer one,
     * so each test exercises exactly the comparison it names. */
    const ANCHOR_OFFSET_METRES = 2;

    function shortlyBeforeShortTurnaround(): ProjectionMatch {
      return {
        pointIndex: SHORT_T_IDX - 1,
        distanceFromStartMetres: SHORT_T - ANCHOR_OFFSET_METRES,
      };
    }

    it("detects the tie on short, sparse, DIAGONAL exact-retrace geometry, not just along a line of constant latitude", () => {
      // A regression comfortably over epsilon: if — and only if — both
      // mirrored occurrences of this fix are found and tied, the existing
      // override fires and progress advances past the turnaround. On an
      // 8-point, sub-400 m route the window always spans the whole route,
      // so this cannot be a whole-route reacquire in disguise.
      const result = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(SHORT_POINTS, SHORT_T + 20),
          SHORT_POINTS,
          atShortTurnaround(),
        ),
      );

      expect(result.reacquired).toBe(false);
      expect(result.distanceFromStartMetres).toBeGreaterThan(SHORT_T);
      expect(result.disposition).toBe("resolved");
    });

    it("labels a tied regression of exactly PROGRESS_EPSILON_METRES as an unresolved hold, still reporting the current geometric candidate", () => {
      // Physical distance past the turnaround at which the trailing
      // occurrence sits exactly PROGRESS_EPSILON_METRES behind the anchor.
      const beyondTurnMetres = ANCHOR_OFFSET_METRES + PROGRESS_EPSILON_METRES;
      const fixCoordinate = coordinateAtDistance(
        SHORT_POINTS,
        SHORT_T + beyondTurnMetres,
      );
      const result = expectResult(
        projectFixOntoRoute(fixCoordinate, SHORT_POINTS, shortlyBeforeShortTurnaround()),
      );

      expect(result.disposition).toBe("tied-sub-epsilon-regression");
      // The returned projection is still the honest current geometry: the
      // trailing occurrence's own route distance, and this fix's own
      // (essentially zero) lateral distance. Nothing is synthesised.
      expect(result.distanceFromStartMetres).toBeCloseTo(SHORT_T - beyondTurnMetres, 3);
      expect(result.lateralDistanceMetres).toBeLessThan(0.1);
      expect(result.matchedCoordinate[0]).toBeCloseTo(fixCoordinate[0], 8);
      expect(result.matchedCoordinate[1]).toBeCloseTo(fixCoordinate[1], 8);
    });

    it("labels the first tied regression past PROGRESS_EPSILON_METRES as resolved, letting the unchanged selector transfer forward", () => {
      const result = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(
            SHORT_POINTS,
            SHORT_T + ANCHOR_OFFSET_METRES + PROGRESS_EPSILON_METRES + 0.1,
          ),
          SHORT_POINTS,
          shortlyBeforeShortTurnaround(),
        ),
      );

      expect(result.disposition).toBe("resolved");
      expect(result.distanceFromStartMetres).toBeGreaterThan(SHORT_T);
    });

    it("labels a tied ADVANCE as resolved — only a genuine backwards step is ever held", () => {
      const lastMatch: ProjectionMatch = {
        pointIndex: SHORT_T_IDX - 1,
        distanceFromStartMetres: SHORT_T - 40,
      };
      const result = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(SHORT_POINTS, SHORT_T - 30),
          SHORT_POINTS,
          lastMatch,
        ),
      );

      expect(result.disposition).toBe("resolved");
      expect(result.distanceFromStartMetres).toBeGreaterThan(
        lastMatch.distanceFromStartMetres,
      );
    });

    it("leaves an ordinary small regression on non-tied geometry completely unaffected", () => {
      const lastMatch: ProjectionMatch = { pointIndex: 4, distanceFromStartMetres: 100 };
      const result = expectResult(
        projectFixOntoRoute(
          coordinateAtDistance(STRAIGHT_ROUTE_POINTS, 98),
          STRAIGHT_ROUTE_POINTS,
          lastMatch,
        ),
      );

      // A single-occurrence route can never be held: the disposition is
      // gated on there being more than one tied occurrence at all, so
      // genuine backwards movement anywhere else still moves progress.
      expect(result.disposition).toBe("resolved");
      expect(result.distanceFromStartMetres).toBeLessThan(
        lastMatch.distanceFromStartMetres,
      );
    });

    it("labels a whole-route reacquire as resolved", () => {
      const farAwayLastMatch: ProjectionMatch = {
        pointIndex: 0,
        distanceFromStartMetres: 0,
      };
      const farFixCoordinate: Coordinate = [0.005, 51.02];
      const result = expectResult(
        projectFixOntoRoute(farFixCoordinate, STRAIGHT_ROUTE_POINTS, farAwayLastMatch),
      );

      expect(result.reacquired).toBe(true);
      expect(result.disposition).toBe("resolved");
    });

    describe("same-direction coincident passes", () => {
      const REPEAT_POINTS = REPEATED_PASS_ROUTE_POINTS;
      const SECOND_STEM_START =
        REPEAT_POINTS[REPEATED_PASS_SECOND_STEM_START_INDEX]?.distanceFromStartMetres ??
        0;

      it("does not disturb ordinary forward progress across either pass of the repeated stretch", () => {
        // Walk the whole route in small steps, feeding each result back
        // in — the same discipline a real ride uses.
        let lastMatch: ProjectionMatch = { pointIndex: 0, distanceFromStartMetres: 0 };
        const total = REPEAT_POINTS.at(-1)?.distanceFromStartMetres ?? 0;
        for (let distance = 5; distance <= total - 5; distance += 5) {
          const result = expectResult(
            projectFixOntoRoute(
              coordinateAtDistance(REPEAT_POINTS, distance),
              REPEAT_POINTS,
              lastMatch,
            ),
          );
          expect(result.distanceFromStartMetres).toBeGreaterThanOrEqual(
            lastMatch.distanceFromStartMetres - PROGRESS_EPSILON_METRES,
          );
          lastMatch = result;
        }
        // Finished on the SECOND pass, not re-matched onto the first.
        expect(lastMatch.distanceFromStartMetres).toBeGreaterThan(SECOND_STEM_START);
      });

      it("holds a jitter-sized regression on the shared stretch and then resolves forward, never latching onto the earlier pass", () => {
        const onSecondPass: ProjectionMatch = {
          pointIndex: REPEATED_PASS_SECOND_STEM_START_INDEX + 4,
          distanceFromStartMetres: SECOND_STEM_START + 40,
        };
        const jitterBack = expectResult(
          projectFixOntoRoute(
            coordinateAtDistance(REPEAT_POINTS, SECOND_STEM_START + 38),
            REPEAT_POINTS,
            onSecondPass,
          ),
        );
        expect(jitterBack.disposition).toBe("tied-sub-epsilon-regression");

        // Holding, the anchor stays put; once the rider is genuinely
        // further back than epsilon the unchanged selector resolves it —
        // and with both occurrences pointing the same way there is no
        // advancing alternative within the margin, so it correctly stays
        // on this pass rather than jumping to the earlier one.
        const resolved = expectResult(
          projectFixOntoRoute(
            coordinateAtDistance(REPEAT_POINTS, SECOND_STEM_START + 30),
            REPEAT_POINTS,
            onSecondPass,
          ),
        );
        expect(resolved.disposition).toBe("resolved");
        expect(resolved.distanceFromStartMetres).toBeGreaterThan(SECOND_STEM_START);
      });
    });
  });
});
