import type { Coordinate, RoutePoint } from "../domain/types.ts";
import { EARTH_RADIUS_METRES, haversineDistanceMetres } from "./distance.ts";

/** Hard cap on the number of waypoints this module will ever return,
 * including the first and last. Bounds mobile-UI clutter and the number of
 * per-leg routing requests a recalculated copy would issue. Never raised to
 * fit a particular route — see deriveWaypointsFromRoute's own doc comment. */
export const MAX_DERIVED_WAYPOINTS = 20;

/** Below this separation, a routed loop's snapped start/finish are treated
 * as "the same place" rather than two distinct nearby points. */
const LOOP_CLOSURE_THRESHOLD_METRES = 50;

/** Target maximum spacing between consecutive derived waypoints, used only
 * to insert extra anchors into an otherwise-oversized gap once simplification
 * has already converged under the waypoint cap. A documented midpoint of the
 * "every 5-10km" guidance this module was asked to satisfy. */
const GAP_FILL_TARGET_METRES = 8_000;

/** Below this separation, two candidate waypoints are treated as the same
 * point and the later one is dropped (never the first or last waypoint). */
const NEAR_DUPLICATE_METRES = 20;

/** Bounds the adaptive epsilon search below. Ramer-Douglas-Peucker's output
 * point count is monotonically non-increasing as epsilon grows, and is
 * guaranteed to reach exactly two points (first and last) once epsilon
 * exceeds the route's own maximum perpendicular deviation — doubling from 1m
 * for this many iterations comfortably exceeds any possible route's extent
 * on Earth's surface, so the search is guaranteed to succeed well within
 * this bound and the loop's own fallback return is unreachable in practice. */
const MAX_EPSILON_SEARCH_ITERATIONS = 25;

interface MetricPoint {
  x: number;
  y: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Projects coordinates onto a local equirectangular metric plane centred
 * on the route's own mean latitude, so perpendicular-distance simplification
 * operates in metres rather than being distorted by latitude/longitude
 * degrees' varying physical scale. Adequate for a single recreational
 * route's extent; not a general-purpose map projection. */
function projectToMetricPlane(coordinates: readonly Coordinate[]): MetricPoint[] {
  const meanLatitude =
    coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length;
  const cosMeanLatitude = Math.cos(toRadians(meanLatitude));

  return coordinates.map(([lon, lat]) => ({
    x: toRadians(lon) * cosMeanLatitude * EARTH_RADIUS_METRES,
    y: toRadians(lat) * EARTH_RADIUS_METRES,
  }));
}

function perpendicularDistanceMetres(
  point: MetricPoint,
  segmentStart: MetricPoint,
  segmentEnd: MetricPoint,
): number {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
  }

  const cross = Math.abs(
    dy * point.x -
      dx * point.y +
      segmentEnd.x * segmentStart.y -
      segmentEnd.y * segmentStart.x,
  );
  return cross / Math.sqrt(lengthSquared);
}

function rdpSelectIndices(
  points: readonly MetricPoint[],
  startIndex: number,
  endIndex: number,
  epsilonMetres: number,
  keep: Set<number>,
): void {
  if (endIndex <= startIndex + 1) {
    return;
  }

  const start = points[startIndex];
  const end = points[endIndex];
  if (!start || !end) {
    return;
  }

  let maxDistance = -1;
  let maxIndex = -1;
  for (let i = startIndex + 1; i < endIndex; i += 1) {
    const candidate = points[i];
    if (!candidate) continue;
    const distance = perpendicularDistanceMetres(candidate, start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance > epsilonMetres && maxIndex !== -1) {
    keep.add(maxIndex);
    rdpSelectIndices(points, startIndex, maxIndex, epsilonMetres, keep);
    rdpSelectIndices(points, maxIndex, endIndex, epsilonMetres, keep);
  }
}

/** Runs Ramer-Douglas-Peucker once at a given epsilon, returning the kept
 * point indices in ascending order (always including the first and last). */
function simplifyIndices(
  points: readonly MetricPoint[],
  epsilonMetres: number,
): number[] {
  if (points.length <= 2) {
    return points.map((_, index) => index);
  }
  const keep = new Set<number>([0, points.length - 1]);
  rdpSelectIndices(points, 0, points.length - 1, epsilonMetres, keep);
  return Array.from(keep).sort((a, b) => a - b);
}

/** Adaptive epsilon search: tries epsilon 0 first (drops only exactly
 * collinear/duplicate points), then 1m, 2m, 4m, ... doubling, until the
 * simplified point count is within the cap. Guaranteed to terminate well
 * within MAX_EPSILON_SEARCH_ITERATIONS by RDP's monotonicity property, so no
 * separate truncation step is needed afterwards. */
function findSimplifiedIndices(points: readonly MetricPoint[]): number[] {
  let epsilon = 0;
  for (let iteration = 0; iteration <= MAX_EPSILON_SEARCH_ITERATIONS; iteration += 1) {
    const indices = simplifyIndices(points, epsilon);
    if (indices.length <= MAX_DERIVED_WAYPOINTS) {
      return indices;
    }
    epsilon = epsilon === 0 ? 1 : epsilon * 2;
  }
  // Unreachable in practice — see MAX_EPSILON_SEARCH_ITERATIONS's doc comment.
  return [0, points.length - 1];
}

function nearestIndexToDistanceBetween(
  points: readonly RoutePoint[],
  lowIndex: number,
  highIndex: number,
  targetDistanceMetres: number,
): number {
  let bestIndex = lowIndex + 1;
  let bestDelta = Infinity;
  for (let i = lowIndex + 1; i < highIndex; i += 1) {
    const delta = Math.abs(
      (points[i]?.distanceFromStartMetres ?? 0) - targetDistanceMetres,
    );
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** While capacity remains under the waypoint cap, inserts the route's own
 * actual point nearest the midpoint of the largest remaining oversized gap,
 * repeating until no gap exceeds GAP_FILL_TARGET_METRES or capacity runs
 * out. Never invents a coordinate — always selects an existing route point. */
function fillGaps(points: readonly RoutePoint[], indices: readonly number[]): number[] {
  const result = [...indices];

  while (result.length < MAX_DERIVED_WAYPOINTS) {
    let bestGapMetres = GAP_FILL_TARGET_METRES;
    let bestInsertAt = -1;
    let bestMidIndex = -1;

    for (let i = 0; i < result.length - 1; i += 1) {
      const startIdx = result[i];
      const endIdx = result[i + 1];
      if (startIdx === undefined || endIdx === undefined || endIdx <= startIdx + 1) {
        continue;
      }
      const startPoint = points[startIdx];
      const endPoint = points[endIdx];
      if (!startPoint || !endPoint) continue;

      const gapMetres =
        endPoint.distanceFromStartMetres - startPoint.distanceFromStartMetres;
      if (gapMetres > bestGapMetres) {
        const midDistance =
          (startPoint.distanceFromStartMetres + endPoint.distanceFromStartMetres) / 2;
        const midIndex = nearestIndexToDistanceBetween(
          points,
          startIdx,
          endIdx,
          midDistance,
        );
        bestGapMetres = gapMetres;
        bestInsertAt = i;
        bestMidIndex = midIndex;
      }
    }

    if (bestInsertAt === -1) {
      break;
    }
    result.splice(bestInsertAt + 1, 0, bestMidIndex);
  }

  return result;
}

/** Drops any candidate within NEAR_DUPLICATE_METRES of the immediately
 * preceding retained point, never dropping the first waypoint. The finish
 * is always kept; if its immediate predecessor turns out to be a near
 * duplicate of it, that predecessor is dropped in its favour instead. */
function removeNearDuplicates(
  points: readonly RoutePoint[],
  indices: readonly number[],
): number[] {
  if (indices.length <= 2) {
    return [...indices];
  }

  const first = indices[0];
  if (first === undefined) return [...indices];
  const result: number[] = [first];

  for (let i = 1; i < indices.length; i += 1) {
    const candidate = indices[i];
    const previous = result[result.length - 1];
    if (candidate === undefined || previous === undefined) continue;

    const candidatePoint = points[candidate];
    const previousPoint = points[previous];
    if (!candidatePoint || !previousPoint) continue;

    const distance = haversineDistanceMetres(
      previousPoint.coordinate,
      candidatePoint.coordinate,
    );
    const isFinish = i === indices.length - 1;

    if (isFinish) {
      if (distance < NEAR_DUPLICATE_METRES && result.length > 1) {
        result.pop();
      }
      result.push(candidate);
    } else if (distance >= NEAR_DUPLICATE_METRES) {
      result.push(candidate);
    }
  }

  return result;
}

/**
 * Derives a manageable, editable set of Planning waypoints from a route's
 * dense geometry — used when a saved or imported route has no exact
 * `PlanningProvenance` to recover (see domain/editableWaypoints.ts, which is
 * the module's only intended caller). Deterministic and network-free: an
 * adaptive Ramer-Douglas-Peucker simplification in a local metric
 * projection favours genuine direction changes over evenly-spaced samples,
 * followed by gap-filling from any remaining capacity so long, straight
 * stretches still get intermediate anchors, followed by near-duplicate
 * removal. Always preserves the route's original order, and (subject only
 * to the near-duplicate/loop-closure adjustments above) its first and last
 * positions. A detected closed loop's final waypoint is forced to exactly
 * the first waypoint's coordinate, mirroring Planning's own "return to
 * start" action. Returns at most MAX_DERIVED_WAYPOINTS coordinates, and
 * `null` when the route has fewer than two distinct, finite positions to
 * build an editable draft from at all.
 *
 * This is a practical editing scaffold, not a promise of exact
 * reconstruction — recalculating a route from these waypoints may follow
 * different roads than the original geometry.
 */
export function deriveWaypointsFromRoute(
  points: readonly RoutePoint[],
): Coordinate[] | null {
  const validPoints = points.filter(
    (point) =>
      Number.isFinite(point.coordinate[0]) && Number.isFinite(point.coordinate[1]),
  );
  const firstValidPoint = validPoints[0];
  const lastValidPoint = validPoints[validPoints.length - 1];
  if (validPoints.length < 2 || !firstValidPoint || !lastValidPoint) {
    return null;
  }

  const [firstLon, firstLat] = firstValidPoint.coordinate;
  const hasDistinctPoint = validPoints.some(
    (point) => point.coordinate[0] !== firstLon || point.coordinate[1] !== firstLat,
  );
  if (!hasDistinctPoint) {
    return null;
  }

  const metricPoints = projectToMetricPlane(validPoints.map((point) => point.coordinate));
  const simplifiedIndices = findSimplifiedIndices(metricPoints);
  const gapFilledIndices = fillGaps(validPoints, simplifiedIndices);
  const finalIndices = removeNearDuplicates(validPoints, gapFilledIndices);

  const coordinates: Coordinate[] = [];
  for (const index of finalIndices) {
    const point = validPoints[index];
    if (!point) continue;
    const [lon, lat] = point.coordinate;
    coordinates.push([lon, lat]);
  }

  const isLoop =
    haversineDistanceMetres(firstValidPoint.coordinate, lastValidPoint.coordinate) <
    LOOP_CLOSURE_THRESHOLD_METRES;
  const firstCoordinate = coordinates[0];
  if (isLoop && coordinates.length >= 2 && firstCoordinate) {
    coordinates[coordinates.length - 1] = [firstCoordinate[0], firstCoordinate[1]];
  }

  return coordinates;
}
