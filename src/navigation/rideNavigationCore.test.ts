import { describe, expect, it } from "vitest";
import {
  INITIAL_RIDE_NAVIGATION_CORE_STATE,
  processFix,
  type RideNavigationCoreState,
} from "./rideNavigationCore.ts";
import type { ProjectionResult } from "./types.ts";
import { buildRoutePointsFromWaypoints } from "../test/fixtures/routeGeometry.ts";
import { CLOSED_LOOP_ROUTE_POINTS } from "../test/fixtures/closedLoopRoute.ts";
import {
  CONSECUTIVE_TO_ESCALATE,
  OFF_ROUTE_BASE_METRES,
  POSSIBLY_OFF_ROUTE_BASE_METRES,
} from "./offRoute.ts";
import {
  OUT_AND_BACK_COINCIDENT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX,
  OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS,
  OUT_AND_BACK_COINCIDENT_SHORT_TURNAROUND_INDEX,
} from "../test/fixtures/outAndBackCoincidentRoute.ts";
import { CONTINUITY_PREFERENCE_METRES, PROGRESS_EPSILON_METRES } from "./projection.ts";
import { selectNextManoeuvre } from "./nextManoeuvre.ts";
import type { Coordinate, Manoeuvre, RoutePoint } from "../domain/types.ts";
import type { ProjectionMatch } from "./types.ts";

const ROUTE_POINTS = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
);

describe("processFix", () => {
  it("returns the input state unchanged when the route has fewer than 2 points", () => {
    const result = processFix([], [0, 51], 5, INITIAL_RIDE_NAVIGATION_CORE_STATE);
    expect(result.coreState).toBe(INITIAL_RIDE_NAVIGATION_CORE_STATE);
    expect(result.projection).toBeNull();
  });

  it("projects the fix and starts on-route for a fix directly on the route", () => {
    const firstPoint = ROUTE_POINTS[0];
    if (!firstPoint) throw new Error("fixture missing point");

    const result = processFix(
      ROUTE_POINTS,
      firstPoint.coordinate,
      5,
      INITIAL_RIDE_NAVIGATION_CORE_STATE,
    );

    expect(result.projection?.lateralDistanceMetres).toBeLessThan(1);
    expect(result.coreState.offRouteMachineState.level).toBe("on-route");
    expect(result.coreState.lastMatch).not.toBeNull();
  });

  it("escalates to off-route only after enough consecutive far fixes", () => {
    const onRoutePoint = ROUTE_POINTS[5];
    if (!onRoutePoint) throw new Error("fixture missing point");
    const farCoordinate: [number, number] = [
      0.005,
      51 + OFF_ROUTE_BASE_METRES / 111_000 + 0.001,
    ];

    // Prime lastMatch with an on-route fix first: a fix with no prior
    // match always does a whole-route reacquire search, which is itself
    // always treated as untrusted and so wouldn't count toward a streak.
    let state: RideNavigationCoreState = processFix(
      ROUTE_POINTS,
      onRoutePoint.coordinate,
      5,
      INITIAL_RIDE_NAVIGATION_CORE_STATE,
    ).coreState;

    for (let i = 0; i < 2; i += 1) {
      state = processFix(ROUTE_POINTS, farCoordinate, 5, state).coreState;
      expect(state.offRouteMachineState.level).toBe("on-route");
    }
    state = processFix(ROUTE_POINTS, farCoordinate, 5, state).coreState;
    expect(state.offRouteMachineState.level).toBe("off-route");
  });

  it("carries the matched distance forward across consecutive fixes", () => {
    const first = ROUTE_POINTS[5];
    const second = ROUTE_POINTS[6];
    if (!first || !second) throw new Error("fixture missing points");

    const afterFirst = processFix(
      ROUTE_POINTS,
      first.coordinate,
      5,
      INITIAL_RIDE_NAVIGATION_CORE_STATE,
    );
    const afterSecond = processFix(
      ROUTE_POINTS,
      second.coordinate,
      5,
      afterFirst.coreState,
    );

    expect(afterSecond.coreState.lastMatch?.distanceFromStartMetres ?? 0).toBeGreaterThan(
      afterFirst.coreState.lastMatch?.distanceFromStartMetres ?? 0,
    );
  });

  describe("lastReliableMatch", () => {
    const onRoutePoint = ROUTE_POINTS[5];
    if (!onRoutePoint) throw new Error("fixture missing point");
    const farCoordinate: [number, number] = [
      0.005,
      51 + OFF_ROUTE_BASE_METRES / 111_000 + 0.001,
    ];

    it("advances alongside lastMatch while on-route", () => {
      const result = processFix(
        ROUTE_POINTS,
        onRoutePoint.coordinate,
        5,
        INITIAL_RIDE_NAVIGATION_CORE_STATE,
      );

      expect(result.coreState.offRouteMachineState.level).toBe("on-route");
      expect(result.coreState.lastReliableMatch).toEqual(result.coreState.lastMatch);
    });

    it("freezes from the first raw off-route fix, before the debounced warning escalates, then resumes on the very next good fix", () => {
      // Prime with an on-route fix so lastReliableMatch has a known value.
      let state: RideNavigationCoreState = processFix(
        ROUTE_POINTS,
        onRoutePoint.coordinate,
        5,
        INITIAL_RIDE_NAVIGATION_CORE_STATE,
      ).coreState;
      const reliableWhileOnRoute = state.lastReliableMatch;
      expect(reliableWhileOnRoute).not.toBeNull();

      // First far fix: raw classification is already "off-route" (that's
      // how this fixture is constructed), even though the *debounced*
      // offRouteMachineState.level needs 3 consecutive fixes to escalate
      // and still reads "on-route" here. lastReliableMatch freezes
      // immediately rather than waiting for the debounce, since by the
      // time the debounce catches up lastMatch may already have advanced
      // to an unrelated nearby section.
      state = processFix(ROUTE_POINTS, farCoordinate, 5, state).coreState;
      expect(state.offRouteMachineState.level).toBe("on-route");
      expect(state.lastReliableMatch).toEqual(reliableWhileOnRoute);
      expect(state.lastMatch).not.toEqual(reliableWhileOnRoute);

      // Two more far fixes complete the escalation to a displayed
      // off-route warning; lastReliableMatch stays pinned throughout.
      for (let i = 0; i < 2; i += 1) {
        state = processFix(ROUTE_POINTS, farCoordinate, 5, state).coreState;
      }
      expect(state.offRouteMachineState.level).toBe("off-route");
      expect(state.lastReliableMatch).toEqual(reliableWhileOnRoute);

      // Recover: the very next fix whose raw classification isn't
      // "off-route" immediately resumes lastReliableMatch, ahead of the
      // debounced level (which still needs 2 consecutive fixes to flip the
      // displayed warning back to "on-route").
      state = processFix(ROUTE_POINTS, onRoutePoint.coordinate, 5, state).coreState;
      expect(state.lastReliableMatch).toEqual(state.lastMatch);
      expect(state.lastReliableMatch).not.toEqual(reliableWhileOnRoute);
    });

    it("does not freeze while only possibly-off-route", () => {
      // Comfortably between the possibly (20 m) and off-route (50 m)
      // thresholds at 5 m reported accuracy.
      const possiblyFarCoordinate: [number, number] = [
        0.005,
        51 + (POSSIBLY_OFF_ROUTE_BASE_METRES + OFF_ROUTE_BASE_METRES) / 2 / 111_000,
      ];

      const state: RideNavigationCoreState = processFix(
        ROUTE_POINTS,
        onRoutePoint.coordinate,
        5,
        INITIAL_RIDE_NAVIGATION_CORE_STATE,
      ).coreState;

      const result = processFix(ROUTE_POINTS, possiblyFarCoordinate, 5, state);
      expect(result.coreState.offRouteMachineState.level).not.toBe("off-route");
      expect(result.coreState.lastReliableMatch).toEqual(result.coreState.lastMatch);
    });
  });

  describe("closed loop", () => {
    it("keeps lastMatch and lastReliableMatch advancing near the shared start/finish coordinate, with no reacquire at the finish", () => {
      // Regression coverage one layer above projection.test.ts's own
      // direct proof: walks every fixture point through processFix in
      // sequence (mirroring how real fixes arrive), confirming the fixed
      // projection layer's correctness survives into the values Riding
      // actually presents. Deliberately does NOT assert on
      // offRouteMachineState staying "on-route" as a proxy for "no false
      // reacquire" — a reacquired fix classifies as "untrusted", not
      // "off-route", and nextOffRouteState leaves the machine's state
      // completely unchanged on "untrusted" either way, so that assertion
      // would not have caught the original bug (it's exactly why the
      // field defect produced no off-route warning at all).
      let state: RideNavigationCoreState = INITIAL_RIDE_NAVIGATION_CORE_STATE;
      let lastProjection: ProjectionResult | null = null;

      for (const routePoint of CLOSED_LOOP_ROUTE_POINTS) {
        const previousMatchDistance = state.lastMatch?.distanceFromStartMetres ?? 0;
        const previousReliableDistance =
          state.lastReliableMatch?.distanceFromStartMetres ?? 0;

        const result = processFix(
          CLOSED_LOOP_ROUTE_POINTS,
          routePoint.coordinate,
          5,
          state,
        );

        expect(
          result.coreState.lastMatch?.distanceFromStartMetres ?? 0,
        ).toBeGreaterThanOrEqual(previousMatchDistance);
        expect(
          result.coreState.lastReliableMatch?.distanceFromStartMetres ?? 0,
        ).toBeGreaterThanOrEqual(previousReliableDistance);

        state = result.coreState;
        lastProjection = result.projection;
      }

      const routeTotalDistanceMetres =
        CLOSED_LOOP_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0;

      expect(lastProjection?.reacquired).toBe(false);
      expect(state.lastMatch?.distanceFromStartMetres).toBeCloseTo(
        routeTotalDistanceMetres,
        0,
      );
      expect(state.lastReliableMatch?.distanceFromStartMetres).toBeCloseTo(
        routeTotalDistanceMetres,
        0,
      );
    });
  });

  describe("out-and-back with an exactly coincident return leg (backlog item 104)", () => {
    const POINTS = OUT_AND_BACK_COINCIDENT_ROUTE_POINTS;
    const TURNAROUND_INDEX = OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX;
    const T = POINTS[TURNAROUND_INDEX]?.distanceFromStartMetres ?? 0;

    it("keeps lastMatch and lastReliableMatch advancing through approach, the turnaround and the return leg, with no false reacquire", () => {
      let state: RideNavigationCoreState = INITIAL_RIDE_NAVIGATION_CORE_STATE;

      for (const routePoint of POINTS) {
        const previousMatchDistance = state.lastMatch?.distanceFromStartMetres ?? 0;
        const previousReliableDistance =
          state.lastReliableMatch?.distanceFromStartMetres ?? 0;

        const result = processFix(POINTS, routePoint.coordinate, 5, state);

        expect(
          result.coreState.lastMatch?.distanceFromStartMetres ?? 0,
        ).toBeGreaterThanOrEqual(previousMatchDistance);
        expect(
          result.coreState.lastReliableMatch?.distanceFromStartMetres ?? 0,
        ).toBeGreaterThanOrEqual(previousReliableDistance);

        state = result.coreState;
      }

      const routeTotalDistanceMetres = POINTS.at(-1)?.distanceFromStartMetres ?? 0;
      expect(state.lastMatch?.distanceFromStartMetres).toBeCloseTo(
        routeTotalDistanceMetres,
        0,
      );
      expect(state.lastReliableMatch?.distanceFromStartMetres).toBeCloseTo(
        routeTotalDistanceMetres,
        0,
      );
    });

    it("distinguishes raw classification from the debounced level through a beyond-turn excursion, and resumes reliable progress on the return leg", () => {
      // Seeded directly (not via a fresh reacquire, which is itself
      // ambiguous on this exactly-coincident fixture — see
      // outAndBackCoincidentRoute.ts's own module comment) at a known
      // point 5 m short of the turnaround, already on-route.
      const seedMatch: ProjectionMatch = {
        pointIndex: TURNAROUND_INDEX - 1,
        distanceFromStartMetres: T - 5,
      };
      let state: RideNavigationCoreState = {
        lastMatch: seedMatch,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatch: seedMatch,
      };

      // Reach the turnaround exactly.
      const atTurnaround = processFix(
        POINTS,
        POINTS[TURNAROUND_INDEX]?.coordinate ?? [0, 51],
        5,
        state,
      );
      state = atTurnaround.coreState;
      expect(state.offRouteMachineState.level).toBe("on-route");
      expect(state.lastMatch?.distanceFromStartMetres).toBeCloseTo(T, 0);

      // Continue ~100 m past the turnaround in the original outbound
      // direction — off the route entirely. CONSECUTIVE_TO_ESCALATE (3)
      // consecutive raw off-route fixes are required before the
      // debounced, displayed level flips; lastReliableMatch freezes from
      // the FIRST one regardless (existing, unrelated behaviour).
      const overshootCoordinate: [number, number] = [
        0.03 + 100 / (111_320 * Math.cos((51 * Math.PI) / 180)),
        51,
      ];
      const reliableAtTurnaround = state.lastReliableMatch;

      for (let i = 0; i < 2; i += 1) {
        const step = processFix(POINTS, overshootCoordinate, 5, state);
        state = step.coreState;
        expect(state.offRouteMachineState.level).toBe("on-route");
        expect(state.lastReliableMatch).toEqual(reliableAtTurnaround);
      }
      const thirdOvershoot = processFix(POINTS, overshootCoordinate, 5, state);
      state = thirdOvershoot.coreState;
      expect(state.offRouteMachineState.level).toBe("off-route");
      expect(state.lastReliableMatch).toEqual(reliableAtTurnaround);

      // Turn back for real: a genuine return-leg fix clears the debounced
      // warning (per the existing, unmodified off-route recovery rules)
      // and lastMatch/lastReliableMatch both resume, advancing beyond the
      // turnaround on the return leg rather than reverting to the
      // outbound occurrence.
      const backOnReturn = processFix(
        POINTS,
        POINTS[TURNAROUND_INDEX + 3]?.coordinate ?? [0, 51],
        5,
        state,
      );
      state = backOnReturn.coreState;
      expect(state.lastMatch?.distanceFromStartMetres ?? 0).toBeGreaterThan(T);
      expect(state.lastReliableMatch?.distanceFromStartMetres ?? 0).toBeGreaterThan(
        reliableAtTurnaround?.distanceFromStartMetres ?? 0,
      );
    });
  });

  // Backlog item 104 follow-up. Item 104's own coverage above steps 25 m,
  // 42 m or 100 m at a time; the block below steps 1.4 m, the cadence a
  // rider actually produces on foot (and the cadence at which the deployed
  // 0.4.8 failed its first physical acceptance). Because every accepted
  // match becomes the next fix's anchor, a per-fix regression smaller than
  // PROGRESS_EPSILON_METRES never registers as a regression at all, so the
  // selector's forward override is never evaluated and progress walks
  // backwards down the mirror indefinitely. processFix therefore declines
  // to adopt a projection labelled "tied-sub-epsilon-regression", holding
  // BOTH anchors so the next fix's regression is measured cumulatively
  // against the same stable match. The hold is bounded by 5 m of
  // *cumulative tied route-distance regression from that anchor* — not by
  // elapsed time, fix count or physical travel: a stationary or
  // sub-threshold-jittering rider stays held for as long as they supply no
  // movement evidence, which is the correct outcome, not a stall.
  describe("walking-cadence turnaround (backlog item 104 follow-up)", () => {
    const SHORT_POINTS = OUT_AND_BACK_COINCIDENT_SHORT_ROUTE_POINTS;
    const SHORT_T_IDX = OUT_AND_BACK_COINCIDENT_SHORT_TURNAROUND_INDEX;
    const SHORT_T = SHORT_POINTS[SHORT_T_IDX]?.distanceFromStartMetres ?? 0;
    const SHORT_TOTAL = SHORT_POINTS.at(-1)?.distanceFromStartMetres ?? 0;
    const WALKING_STEP_METRES = 1.4;
    /** How far short of a turnaround the boundary tests below anchor
     * lastMatch. Deliberately non-zero: anchored exactly AT a turnaround,
     * the two mirrored occurrences of a return fix are equidistant and
     * which wins is decided by sub-millimetre floating-point asymmetry —
     * harmless in practice (progress never regresses either way) but far
     * too knife-edge to pin a documented boundary against. */
    const ANCHOR_OFFSET_METRES = 2;

    /** Synthetic trusted manoeuvres for this fixture: the finish cue is
     * what the field report actually showed running backwards (150 m ->
     * 180 m), so the cue path is asserted here rather than assumed. */
    const SHORT_MANOEUVRES: Manoeuvre[] = [
      { distanceFromStartMetres: 0, type: "start" },
      { distanceFromStartMetres: SHORT_T, type: "waypoint" },
      { distanceFromStartMetres: SHORT_TOTAL, type: "finish" },
    ];

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

    /** Seeds a known outbound-side state, per the seeding discipline
     * outAndBackCoincidentRoute.ts's own module comment documents. */
    function seedOutboundState(distanceFromStartMetres: number): RideNavigationCoreState {
      const match: ProjectionMatch = {
        pointIndex: SHORT_T_IDX - 1,
        distanceFromStartMetres,
      };
      return {
        lastMatch: match,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatch: match,
      };
    }

    it("never regresses committed progress or the trusted finish cue at ANY intermediate walking-pace fix across the turnaround", () => {
      let state = seedOutboundState(SHORT_T - 7);
      let reachedManoeuvreIndex = 0;
      let previousCommitted = state.lastReliableMatch?.distanceFromStartMetres ?? 0;
      let previousCueMetres = Number.POSITIVE_INFINITY;
      let transferred = false;

      const distances = [SHORT_T];
      for (let x = WALKING_STEP_METRES; x <= 35; x += WALKING_STEP_METRES) {
        distances.push(SHORT_T + x);
      }

      for (const targetDistance of distances) {
        state = processFix(
          SHORT_POINTS,
          coordinateAtDistance(SHORT_POINTS, targetDistance),
          14,
          state,
        ).coreState;

        const committed = state.lastReliableMatch?.distanceFromStartMetres ?? 0;
        expect(committed).toBeGreaterThanOrEqual(previousCommitted);
        previousCommitted = committed;

        const { reachedIndex, selection } = selectNextManoeuvre(
          SHORT_MANOEUVRES,
          committed,
          reachedManoeuvreIndex,
        );
        reachedManoeuvreIndex = reachedIndex;
        if (selection) {
          expect(selection.remainingDistanceMetres).toBeLessThanOrEqual(
            previousCueMetres,
          );
          previousCueMetres = selection.remainingDistanceMetres;
        }

        if (committed > SHORT_T) transferred = true;
        expect(state.offRouteMachineState.level).toBe("on-route");
      }

      // Freezing at the turnaround for ever is not sufficient: progress
      // must genuinely transfer onto the return leg and keep going.
      expect(transferred).toBe(true);
      expect(state.lastReliableMatch?.distanceFromStartMetres ?? 0).toBeGreaterThan(
        SHORT_T + 25,
      );
    });

    it("during a hold, reports the current geometric candidate while leaving both anchors at their stable previous values", () => {
      const state = seedOutboundState(SHORT_T - ANCHOR_OFFSET_METRES);
      const previousLastMatch = state.lastMatch;
      const previousReliable = state.lastReliableMatch;
      const beyondTurnMetres = ANCHOR_OFFSET_METRES + 2;
      const fixCoordinate = coordinateAtDistance(
        SHORT_POINTS,
        SHORT_T + beyondTurnMetres,
      );

      const result = processFix(SHORT_POINTS, fixCoordinate, 14, state);

      // The projection is the honest current geometry — the trailing
      // occurrence's own route distance and this fix's own lateral
      // distance and matched coordinate. Nothing is recombined.
      expect(result.projection?.disposition).toBe("tied-sub-epsilon-regression");
      expect(result.projection?.distanceFromStartMetres).toBeCloseTo(
        SHORT_T - beyondTurnMetres,
        3,
      );
      expect(result.projection?.lateralDistanceMetres ?? 1).toBeLessThan(0.1);
      expect(result.projection?.matchedCoordinate[0]).toBeCloseTo(fixCoordinate[0], 8);

      // Committed state is untouched — the very same objects, not merely
      // equal values.
      expect(result.coreState.lastMatch).toBe(previousLastMatch);
      expect(result.coreState.lastReliableMatch).toBe(previousReliable);
    });

    it("holds at exactly PROGRESS_EPSILON_METRES of cumulative regression and resolves just past it", () => {
      const anchorDistance = SHORT_T - ANCHOR_OFFSET_METRES;
      const atExactly = processFix(
        SHORT_POINTS,
        coordinateAtDistance(
          SHORT_POINTS,
          SHORT_T + ANCHOR_OFFSET_METRES + PROGRESS_EPSILON_METRES,
        ),
        14,
        seedOutboundState(anchorDistance),
      );
      expect(atExactly.coreState.lastMatch?.distanceFromStartMetres).toBeCloseTo(
        anchorDistance,
        6,
      );

      const justPast = processFix(
        SHORT_POINTS,
        coordinateAtDistance(
          SHORT_POINTS,
          SHORT_T + ANCHOR_OFFSET_METRES + PROGRESS_EPSILON_METRES + 0.1,
        ),
        14,
        seedOutboundState(anchorDistance),
      );
      expect(
        justPast.coreState.lastReliableMatch?.distanceFromStartMetres ?? 0,
      ).toBeGreaterThan(SHORT_T);
    });

    it("keeps holding through stationary and sub-threshold jitter, then resolves once real movement arrives", () => {
      let state = seedOutboundState(SHORT_T - ANCHOR_OFFSET_METRES);
      const anchor = state.lastMatch;

      for (let i = 0; i < 20; i += 1) {
        // Always strictly past the anchor's own distance from the
        // turnaround, and always well inside epsilon.
        const beyondTurnMetres = ANCHOR_OFFSET_METRES + 0.3 + (i % 8) * 0.4;
        state = processFix(
          SHORT_POINTS,
          coordinateAtDistance(SHORT_POINTS, SHORT_T + beyondTurnMetres),
          14,
          state,
        ).coreState;
      }
      // Twenty fixes' worth of jitter supplies no movement evidence, so
      // the anchor is still exactly where it was — held, not stalled. The
      // bound on a hold is 5 m of cumulative tied regression, never a fix
      // count or elapsed time.
      expect(state.lastMatch).toBe(anchor);
      expect(state.lastReliableMatch).toBe(anchor);

      state = processFix(
        SHORT_POINTS,
        coordinateAtDistance(
          SHORT_POINTS,
          SHORT_T + ANCHOR_OFFSET_METRES + PROGRESS_EPSILON_METRES + 1,
        ),
        14,
        state,
      ).coreState;
      expect(state.lastReliableMatch?.distanceFromStartMetres ?? 0).toBeGreaterThan(
        SHORT_T,
      );
    });

    it("preserves genuine backtracking that begins beyond the existing ambiguity boundary, and resolves forward inside it", () => {
      const halfMargin = CONTINUITY_PREFERENCE_METRES / 2;

      /** Walks backwards from `startShortOfTurnaround` at walking pace
       * until the hold resolves, then reports committed progress. */
      function backtrackFrom(startShortOfTurnaround: number): number {
        let state = seedOutboundState(SHORT_T - startShortOfTurnaround);
        for (
          let x = startShortOfTurnaround + WALKING_STEP_METRES;
          x <= startShortOfTurnaround + 20;
          x += WALKING_STEP_METRES
        ) {
          state = processFix(
            SHORT_POINTS,
            coordinateAtDistance(SHORT_POINTS, SHORT_T - x),
            14,
            state,
          ).coreState;
        }
        return state.lastReliableMatch?.distanceFromStartMetres ?? 0;
      }

      // Beyond the boundary the advancing alternative is further than
      // CONTINUITY_PREFERENCE_METRES away, so the unchanged selector keeps
      // the outbound branch and progress correctly runs backwards.
      expect(backtrackFrom(halfMargin + 1)).toBeLessThan(SHORT_T);

      // Inside it, the geometry is genuinely ambiguous from route distance
      // alone and item 104 already resolves that narrow zone forward. This
      // boundary is inherited unchanged; the follow-up adds no constant of
      // its own.
      expect(backtrackFrom(halfMargin)).toBeGreaterThan(SHORT_T);
    });

    it("keeps classifying the current fix's own lateral distance while progress is held", () => {
      // The dense, constant-latitude coincident fixture, so a latitude
      // offset is exactly perpendicular to the mirrored leg.
      const points = OUT_AND_BACK_COINCIDENT_ROUTE_POINTS;
      const turnaroundIndex = OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX;
      const denseT = points[turnaroundIndex]?.distanceFromStartMetres ?? 0;
      const seed: ProjectionMatch = {
        pointIndex: turnaroundIndex - 1,
        distanceFromStartMetres: denseT - ANCHOR_OFFSET_METRES,
      };
      let state: RideNavigationCoreState = {
        lastMatch: seed,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatch: seed,
      };

      const accuracyMetres = 5;
      const lateralOffsetMetres = POSSIBLY_OFF_ROUTE_BASE_METRES + accuracyMetres + 5;
      const beyondTurnMetres = ANCHOR_OFFSET_METRES + 2;
      const driftedCoordinate: Coordinate = [
        0.03 - beyondTurnMetres / (111_320 * Math.cos((51 * Math.PI) / 180)),
        51 + lateralOffsetMetres / 111_132,
      ];

      for (let i = 0; i < CONSECUTIVE_TO_ESCALATE; i += 1) {
        const step = processFix(points, driftedCoordinate, accuracyMetres, state);
        expect(step.projection?.disposition).toBe("tied-sub-epsilon-regression");
        expect(step.projection?.lateralDistanceMetres ?? 0).toBeGreaterThan(
          POSSIBLY_OFF_ROUTE_BASE_METRES,
        );
        state = step.coreState;
      }

      // Progress held throughout, yet the debounced level still escalated
      // from this fix's own lateral distance — the hold changes what is
      // adopted as progress, never what is classified.
      expect(state.offRouteMachineState.level).toBe("possibly-off-route");
      expect(state.lastMatch).toBe(seed);
      expect(state.lastReliableMatch).toBe(seed);
    });
  });
});
