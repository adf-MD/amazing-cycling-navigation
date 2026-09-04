import { lineString, point } from "@turf/helpers";
import { nearestPointOnLine } from "@turf/nearest-point-on-line";
import type { Coordinate, RoutePoint } from "../domain/types.ts";
import type { ProjectionMatch, ProjectionResult } from "./types.ts";

/** Half-width of the route-distance search window around the last match. */
export const WINDOW_RADIUS_METRES = 400;
/** A windowed match farther than this from the fix is distrusted and triggers a whole-route reacquire. */
export const MAX_ACCEPTABLE_LATERAL_METRES = 300;

/**
 * Backlog item 104. Two windowed candidates are treated as the same
 * physical occurrence (a true geometric coincidence, such as an
 * out-and-back turnaround's outbound and return legs retracing identical
 * coordinates) only when their own lateralDistanceMetres differ by no
 * more than this. It must reflect measured floating-point/great-circle
 * rounding noise between two candidates on genuinely identical, reversed
 * geometry — not an arbitrary "small" number. Measured directly (see
 * projection.test.ts's calibration evidence and item 104's history entry):
 * across on-line, mid-segment-interior, laterally-offset and
 * endpoint-clamped cases on this project's own exact-overlap fixture, the
 * largest observed delta between two genuinely coincident candidates was
 * on the order of 1e-7 m. This constant is set at 1 cm — around five
 * orders of magnitude above that measured noise floor, comfortably below
 * outAndBackRoute.ts's own deliberate ~11 m offset (which must stay
 * distinguishable, not absorbed into a tie), and far below any
 * nearly-parallel-but-physically-distinct geometry (separate
 * carriageways, an adjacent cycleway), which this item does not attempt
 * to handle and must not accidentally start treating as coincident.
 */
export const LATERAL_TIE_TOLERANCE_METRES = 0.01;

/**
 * Backlog item 104. When two occurrences are geometrically tied (see
 * LATERAL_TIE_TOLERANCE_METRES), how much farther in route-distance the
 * candidate that would ADVANCE progress may sit, beyond the candidate
 * closest to lastMatch, before continuity gives up and keeps the closer
 * one. This margin is only ever consulted once the closer ("continuity-
 * nearest") candidate has already been established as a genuine
 * regression relative to lastMatch (see PROGRESS_EPSILON_METRES) — it
 * does not by itself decide anything, and a small route-distance gap
 * between two tied candidates does NOT by itself prove lastMatch was
 * close to a turnaround: gapAdvancing - gapNearest can be small either
 * because lastMatch was close to the crossover, or merely because the new
 * fix itself is (the two are symmetric); see selectAmongOccurrences's own
 * comment. Scaled to realistic fix-to-fix route-distance movement at
 * road-bike speeds with ordinary GPS sampling gaps, not GPS accuracy
 * directly.
 */
export const CONTINUITY_PREFERENCE_METRES = 30;

/**
 * Backlog item 104. The minimum route-distance a candidate must sit
 * beyond lastMatch (in either direction) to count as a genuine advance or
 * regression, rather than noise. Without this, a stationary rider, a
 * repeated identical fix, or ordinary GPS jitter near a turnaround could
 * make the continuity-nearest candidate look like a "regression" purely
 * from float/measurement noise and incorrectly trigger a forward
 * transfer. Scaled to realistic GPS/coordinate jitter at a stationary or
 * near-stationary fix — small, and deliberately smaller than
 * CONTINUITY_PREFERENCE_METRES.
 */
export const PROGRESS_EPSILON_METRES = 5;

/**
 * Backlog item 104. Minimum route-distance gap, in the qualifying
 * candidates' own reported distanceFromStartMetres, for two
 * array-adjacent qualifying segments to be treated as genuinely distinct
 * occurrences rather than the same physical vertex approached from
 * either side (see findTiedOccurrences). Near a turnaround, the last
 * outbound segment and the first return segment share that turnaround
 * vertex and so are always array-adjacent, even when they represent two
 * occurrences many metres apart on opposite sides of the crossover — array
 * adjacency alone cannot distinguish "one vertex, two segment framings"
 * from "two distinct nearby occurrences". Kept small and well under
 * PROGRESS_EPSILON_METRES, since a genuine single-occurrence discrepancy
 * between adjacent segment framings is expected to be at most a small
 * fraction of a metre (both converge on essentially the same point), far
 * smaller than any occurrence separation this item needs to detect.
 */
export const OCCURRENCE_SEPARATION_METRES = 1;

interface IndexRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Finds the index range of points within `radiusMetres` of
 * `centreDistanceMetres` along the route. Searching in route-distance
 * space (not geographic space) is what keeps self-intersections and
 * out-and-back sections from snapping to the wrong pass: a geographically
 * close point on a different part of the route usually has a very
 * different distanceFromStartMetres, so it falls outside the window.
 */
function findWindowRange(
  points: readonly RoutePoint[],
  centreDistanceMetres: number,
  radiusMetres: number,
): IndexRange {
  const loDistance = centreDistanceMetres - radiusMetres;
  const hiDistance = centreDistanceMetres + radiusMetres;

  let startIndex = 0;
  while (startIndex < points.length - 1) {
    const current = points[startIndex];
    if (current === undefined || current.distanceFromStartMetres >= loDistance) break;
    startIndex += 1;
  }

  let endIndex = points.length - 1;
  while (endIndex > startIndex) {
    const current = points[endIndex];
    if (current === undefined || current.distanceFromStartMetres <= hiDistance) break;
    endIndex -= 1;
  }

  return { startIndex, endIndex };
}

interface NearestMatch {
  pointIndex: number;
  distanceFromStartMetres: number;
  matchedCoordinate: Coordinate;
  lateralDistanceMetres: number;
}

function nearestWithinRange(
  points: readonly RoutePoint[],
  range: IndexRange,
  fixCoordinate: Coordinate,
): NearestMatch | null {
  const slice = points.slice(range.startIndex, range.endIndex + 1);
  const sliceStart = slice[0];
  if (slice.length < 2 || sliceStart === undefined) {
    return null;
  }

  const line = lineString(slice.map((routePoint) => [...routePoint.coordinate]));
  const fixPoint = point([...fixCoordinate]);
  const nearest = nearestPointOnLine(line, fixPoint, { units: "metres" });

  const [longitude, latitude] = nearest.geometry.coordinates;

  return {
    pointIndex: range.startIndex + nearest.properties.segmentIndex,
    distanceFromStartMetres:
      sliceStart.distanceFromStartMetres + nearest.properties.totalDistance,
    matchedCoordinate: [longitude ?? fixCoordinate[0], latitude ?? fixCoordinate[1]],
    lateralDistanceMetres: nearest.properties.pointDistance,
  };
}

/**
 * Backlog item 104. Scans every individual segment in `range` for
 * candidates whose own nearest-point lateral distance is within
 * LATERAL_TIE_TOLERANCE_METRES of `primary`'s (the single windowed
 * search's own global-best result), and clusters qualifying segments into
 * one occurrence each (keeping the lowest-lateral-distance point per
 * cluster). Two qualifying segments are the same occurrence only when
 * they are BOTH array-index-adjacent AND their own matched points are
 * close in route-distance (see OCCURRENCE_SEPARATION_METRES) — index
 * adjacency alone is not enough: right at a turnaround, the last outbound
 * segment and the first return segment are always array-adjacent (they
 * share the turnaround vertex) even when the fix is genuinely several
 * metres from the turnaround on each side, in which case they represent
 * two distinct occurrences whose own matched points are far apart in
 * route-distance despite the shared vertex.
 *
 * A single call to nearestPointOnLine over the whole window (as
 * nearestWithinRange already does) only ever returns Turf's own single
 * winning candidate — silently discarding any other exact or
 * near-exact tie via its internal strict-less-than comparison. This scan
 * exists so every materially tied occurrence is exposed to this file's
 * own decision logic instead.
 *
 * Bounded to the window (not the whole route): one extra Turf call per
 * segment inside `range`, not per route point.
 */
function findTiedOccurrences(
  points: readonly RoutePoint[],
  range: IndexRange,
  fixCoordinate: Coordinate,
  primary: NearestMatch,
): NearestMatch[] {
  const toleranceThreshold = primary.lateralDistanceMetres + LATERAL_TIE_TOLERANCE_METRES;
  const fixPoint = point([...fixCoordinate]);
  const occurrences: NearestMatch[] = [];
  let currentCluster: NearestMatch | null = null;
  let previousQualifyingIndex = Number.NEGATIVE_INFINITY;
  let previousCandidateDistanceMetres = Number.NaN;

  for (let i = range.startIndex; i < range.endIndex; i += 1) {
    const segmentStart = points[i];
    const segmentEnd = points[i + 1];
    if (!segmentStart || !segmentEnd) continue;

    const segmentLine = lineString([
      [...segmentStart.coordinate],
      [...segmentEnd.coordinate],
    ]);
    const nearest = nearestPointOnLine(segmentLine, fixPoint, { units: "metres" });
    const lateralDistanceMetres = nearest.properties.pointDistance;
    if (lateralDistanceMetres > toleranceThreshold) continue;

    const [longitude, latitude] = nearest.geometry.coordinates;
    const candidate: NearestMatch = {
      pointIndex: i + nearest.properties.segmentIndex,
      distanceFromStartMetres:
        segmentStart.distanceFromStartMetres + nearest.properties.totalDistance,
      matchedCoordinate: [longitude ?? fixCoordinate[0], latitude ?? fixCoordinate[1]],
      lateralDistanceMetres,
    };

    // Array-index adjacency alone is not sufficient: near a turnaround, a
    // qualifying segment on the outbound approach and a qualifying
    // segment on the return departure can be array-adjacent (both touch
    // the shared turnaround vertex) while representing two genuinely
    // distinct, far-apart occurrences (e.g. 20 m before and 20 m after
    // the turnaround). Two segments are only the SAME occurrence when
    // they are both array-adjacent AND their own matched points are
    // themselves close in route-distance — within one true occurrence,
    // adjacent segment framings converge on essentially the same point,
    // never a jump of many metres.
    const isSameOccurrenceAsPrevious =
      currentCluster !== null &&
      i - previousQualifyingIndex === 1 &&
      Math.abs(candidate.distanceFromStartMetres - previousCandidateDistanceMetres) <=
        OCCURRENCE_SEPARATION_METRES;

    if (!isSameOccurrenceAsPrevious && currentCluster) {
      occurrences.push(currentCluster);
      currentCluster = null;
    }

    if (
      !currentCluster ||
      candidate.lateralDistanceMetres < currentCluster.lateralDistanceMetres
    ) {
      currentCluster = candidate;
    }
    previousQualifyingIndex = i;
    previousCandidateDistanceMetres = candidate.distanceFromStartMetres;
  }

  if (currentCluster) {
    occurrences.push(currentCluster);
  }

  return occurrences;
}

/**
 * Backlog item 104. Chooses between multiple geometrically tied
 * occurrences (see findTiedOccurrences) using route-distance continuity
 * and direction relative to `lastMatch`, never GPS accuracy (accuracy
 * plays no part in this decision anywhere — it participates only in
 * offRoute.ts's separate, unchanged classification).
 *
 * Default: the occurrence closest in route-distance to lastMatch (the
 * "continuity-nearest" occurrence) wins.
 *
 * Override: only when the continuity-nearest occurrence is a GENUINE
 * regression relative to lastMatch — its own distanceFromStartMetres is
 * more than PROGRESS_EPSILON_METRES below lastMatch's, not merely equal
 * to or infinitesimally below it (equality, a repeated fix, and ordinary
 * jitter must never trigger this) — do we look for an alternative: the
 * occurrence that is itself a genuine ADVANCE (more than
 * PROGRESS_EPSILON_METRES above lastMatch's own distance) with the
 * smallest such advance. If that alternative's own gap from lastMatch is
 * within CONTINUITY_PREFERENCE_METRES of the continuity-nearest
 * occurrence's own gap, prefer the advancing alternative instead.
 *
 * A small gap difference between two tied occurrences does NOT, on its
 * own, prove lastMatch was close to the crossover: for occurrences at
 * lastMatch-a and lastMatch+b (a genuine regression/advance pair), the
 * gap difference is `(a+b) - |a-b| = 2*min(a,b)`, which is small whenever
 * EITHER a or b is small — including when the new fix itself merely
 * happens to be close to the crossover while lastMatch was not. That is
 * exactly why the regression/advance test above is evaluated on each
 * occurrence's own distance relative to lastMatch, not on the gap
 * difference alone; the gap-difference margin only bounds how far a
 * transfer already justified by direction is allowed to jump.
 *
 * Backtracking that begins very close to the crossover, where the
 * regressing candidate's own gap also happens to fall inside the margin,
 * is an accepted, irreducible ambiguity from route-distance evidence
 * alone (see CONTINUITY_PREFERENCE_METRES/PROGRESS_EPSILON_METRES). This
 * design deliberately resolves that narrow zone forward, to avoid the
 * strictly worse "progress runs backward while riding home" symptom.
 */
function selectAmongOccurrences(
  occurrences: readonly NearestMatch[],
  lastMatch: ProjectionMatch,
): NearestMatch | undefined {
  if (occurrences.length === 0) {
    return undefined;
  }

  let continuityNearest = occurrences[0];
  if (!continuityNearest) {
    return undefined;
  }
  let nearestGap = Math.abs(
    continuityNearest.distanceFromStartMetres - lastMatch.distanceFromStartMetres,
  );

  for (const occurrence of occurrences) {
    const gap = Math.abs(
      occurrence.distanceFromStartMetres - lastMatch.distanceFromStartMetres,
    );
    if (gap < nearestGap) {
      continuityNearest = occurrence;
      nearestGap = gap;
    }
  }

  const isGenuineRegression =
    lastMatch.distanceFromStartMetres - continuityNearest.distanceFromStartMetres >
    PROGRESS_EPSILON_METRES;
  if (!isGenuineRegression) {
    return continuityNearest;
  }

  let bestAdvancingAlternative: NearestMatch | undefined;
  let bestAdvancingGap = Number.POSITIVE_INFINITY;
  for (const occurrence of occurrences) {
    if (occurrence === continuityNearest) continue;
    const isGenuineAdvance =
      occurrence.distanceFromStartMetres - lastMatch.distanceFromStartMetres >
      PROGRESS_EPSILON_METRES;
    if (!isGenuineAdvance) continue;

    const gap = Math.abs(
      occurrence.distanceFromStartMetres - lastMatch.distanceFromStartMetres,
    );
    if (gap < bestAdvancingGap) {
      bestAdvancingAlternative = occurrence;
      bestAdvancingGap = gap;
    }
  }

  if (
    bestAdvancingAlternative &&
    bestAdvancingGap - nearestGap <= CONTINUITY_PREFERENCE_METRES
  ) {
    return bestAdvancingAlternative;
  }

  return continuityNearest;
}

/**
 * A windowed match is only distrusted as "clipped" when the specific edge
 * it sits near was itself truncated by the search window — never merely
 * because the *other* edge happened to be. Near a closed loop's finish,
 * for example, the window's lower bound excludes the earlier part of the
 * route (a genuine clip) while its upper bound sits exactly at the
 * route's own natural, un-clipped final point; a match there must not be
 * rejected on the strength of the unrelated lower-side clip, or a
 * legitimate near-finish match falls through to a whole-route reacquire
 * that can snap onto the geographically coincident start instead.
 */
function isClippedAtEdge(
  match: NearestMatch,
  range: IndexRange,
  pointCount: number,
): boolean {
  const clippedAtStart = range.startIndex > 0 && match.pointIndex <= range.startIndex;
  const clippedAtEnd =
    range.endIndex < pointCount - 1 && match.pointIndex >= range.endIndex - 1;
  return clippedAtStart || clippedAtEnd;
}

/**
 * Projects a GPS fix onto the route. When `lastMatch` is available, only a
 * window of the route around it is searched first; if that windowed match
 * looks unreliable (too far away, or sitting at the edge of a window that
 * was actually clipped), a whole-route search is used instead and the
 * result is flagged `reacquired`.
 */
export function projectFixOntoRoute(
  fixCoordinate: Coordinate,
  points: readonly RoutePoint[],
  lastMatch: ProjectionMatch | null,
): ProjectionResult | null {
  if (points.length < 2) {
    return null;
  }

  if (lastMatch) {
    const windowRange = findWindowRange(
      points,
      lastMatch.distanceFromStartMetres,
      WINDOW_RADIUS_METRES,
    );
    const primary = nearestWithinRange(points, windowRange, fixCoordinate);

    if (primary) {
      // Backlog item 104: primary is Turf's own single winning candidate
      // for the whole window, which silently discards any other exact or
      // near-exact geometric tie (e.g. an out-and-back turnaround's
      // outbound/return occurrences of the same point). Only when more
      // than one occurrence is found does this differ from today's
      // single-call result — see findTiedOccurrences/selectAmongOccurrences.
      const occurrences = findTiedOccurrences(
        points,
        windowRange,
        fixCoordinate,
        primary,
      );
      const windowed =
        occurrences.length <= 1
          ? primary
          : (selectAmongOccurrences(occurrences, lastMatch) ?? primary);

      if (
        windowed.lateralDistanceMetres <= MAX_ACCEPTABLE_LATERAL_METRES &&
        !isClippedAtEdge(windowed, windowRange, points.length)
      ) {
        return { ...windowed, reacquired: false };
      }
    }
  }

  const wholeRoute = nearestWithinRange(
    points,
    { startIndex: 0, endIndex: points.length - 1 },
    fixCoordinate,
  );
  if (!wholeRoute) {
    return null;
  }
  return { ...wholeRoute, reacquired: true };
}
