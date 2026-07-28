import type { RoutePoint, RouteWarning } from "../domain/types.ts";

function interpolatePointAtDistance(
  before: RoutePoint,
  after: RoutePoint,
  targetDistanceMetres: number,
): RoutePoint {
  const span = after.distanceFromStartMetres - before.distanceFromStartMetres;
  const t =
    span === 0 ? 0 : (targetDistanceMetres - before.distanceFromStartMetres) / span;
  const [beforeLon, beforeLat] = before.coordinate;
  const [afterLon, afterLat] = after.coordinate;

  return {
    coordinate: [
      beforeLon + t * (afterLon - beforeLon),
      beforeLat + t * (afterLat - beforeLat),
    ],
    elevationMetres:
      before.elevationMetres !== null && after.elevationMetres !== null
        ? before.elevationMetres + t * (after.elevationMetres - before.elevationMetres)
        : null,
    distanceFromStartMetres: targetDistanceMetres,
  };
}

/** The point at `targetDistanceMetres`, taken directly from `points` when
 * it lands exactly on one, otherwise linearly interpolated between the
 * pair of points that bracket it. Never compares coordinates — always
 * keyed off each point's own distanceFromStartMetres — so a target near a
 * loop's turnaround or an out-and-back's return leg resolves against the
 * correct occurrence, not whichever point happens to be geographically
 * nearest. */
function pointAtDistance(
  points: readonly RoutePoint[],
  targetDistanceMetres: number,
): RoutePoint {
  for (let i = 0; i < points.length - 1; i += 1) {
    const before = points[i];
    const after = points[i + 1];
    if (!before || !after) continue;
    if (targetDistanceMetres === before.distanceFromStartMetres) return before;
    if (
      targetDistanceMetres > before.distanceFromStartMetres &&
      targetDistanceMetres < after.distanceFromStartMetres
    ) {
      return interpolatePointAtDistance(before, after, targetDistanceMetres);
    }
  }
  const last = points[points.length - 1];
  if (last) return last;
  const first = points[0];
  if (first) return first;
  throw new Error("pointAtDistance requires at least one point");
}

/**
 * The RoutePoints spanning [startDistanceMetres, endDistanceMetres] of a
 * route's own points, clamped to the route's bounds (and reordered if the
 * range is inverted), including an interpolated point at each boundary
 * that falls strictly between two existing points — deduplicated when a
 * boundary lands exactly on an existing point's distance, so the result
 * never contains two coincident points. Elevation at a synthesised
 * boundary is interpolated only when both surrounding points have
 * elevation; otherwise left null rather than invented. Returns an empty
 * array for fewer than two route points, or when the clamped range
 * collapses to zero or negative length — covering an empty, inverted, or
 * wholly out-of-bounds warning safely, with no special-case branching
 * needed for any of those. Never mutates `points`.
 */
export function sliceRoutePointsForRange(
  points: readonly RoutePoint[],
  startDistanceMetres: number,
  endDistanceMetres: number,
): RoutePoint[] {
  if (points.length < 2) return [];

  const totalDistanceMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
  const clampToRoute = (distanceMetres: number): number =>
    Math.min(Math.max(distanceMetres, 0), totalDistanceMetres);
  const clampedStart = clampToRoute(Math.min(startDistanceMetres, endDistanceMetres));
  const clampedEnd = clampToRoute(Math.max(startDistanceMetres, endDistanceMetres));
  if (clampedEnd <= clampedStart) return [];

  const between = points.filter(
    (point) =>
      point.distanceFromStartMetres > clampedStart &&
      point.distanceFromStartMetres < clampedEnd,
  );

  return [
    pointAtDistance(points, clampedStart),
    ...between,
    pointAtDistance(points, clampedEnd),
  ];
}

/**
 * Merges adjacent RouteWarnings of the same kind and message whose gap (or
 * overlap) is within toleranceMetres, so display never shows a long list
 * of near-identical tiny warnings split apart by noise. This is a
 * display-time, source-agnostic concern — distinct from
 * normalizeOpenRouteServiceRoute.ts's own, tighter-tolerance coalescing of
 * raw surface *ranges* at production time — applied uniformly to any
 * RouteWarning list regardless of producer, including synthetic fixtures
 * for kinds no producer emits yet. Returns warnings sorted by
 * startDistanceMetres (callers must not assume input order survives), and
 * drops any zero/negative-length warning. Never mutates the input.
 */
export function coalesceAdjacentWarnings(
  warnings: readonly RouteWarning[],
  toleranceMetres = 1,
): RouteWarning[] {
  const sorted = [...warnings]
    .filter((warning) => warning.endDistanceMetres > warning.startDistanceMetres)
    .sort((a, b) => a.startDistanceMetres - b.startDistanceMetres);

  const result: RouteWarning[] = [];
  for (const warning of sorted) {
    const previous = result.at(-1);
    // Structured surface identity, not just message-string equality: two
    // different surface types happen to always produce different message
    // text today (the label is baked in), but this check is explicit and
    // independent of that, so it stays correct even if message wording
    // ever changes. Both undefined (any non-surface, or legacy
    // pre-feature, warning) compares equal, so existing behaviour for
    // every structural/legacy warning is unaffected.
    const sameSurfaceType =
      (previous?.surface?.type ?? null) === (warning.surface?.type ?? null);
    if (
      previous?.kind === warning.kind &&
      previous.message === warning.message &&
      sameSurfaceType &&
      warning.startDistanceMetres - previous.endDistanceMetres <= toleranceMetres
    ) {
      result[result.length - 1] = {
        ...previous,
        endDistanceMetres: Math.max(
          previous.endDistanceMetres,
          warning.endDistanceMetres,
        ),
      };
    } else {
      result.push({ ...warning });
    }
  }
  return result;
}
