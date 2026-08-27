import type { Coordinate, RoutePoint } from "../domain/types.ts";
import { haversineDistanceMetres } from "../navigation/distance.ts";
import type { DistanceBadgeMarkerSpec } from "./mapAdapter.ts";

/**
 * Route-orientation kilometre badges: absolute cumulative distance from
 * the route's original start (RoutePoint.distanceFromStartMetres), never
 * renumbered relative to rider progress, zoom or camera mode. Pure,
 * MapLibre-free — sibling to routeLayer.ts/planningLayer.ts/warningLayer.ts.
 */

/** Real-world clearance kept between a badge and the route's own finish,
 * so a target that lands exactly (or almost) on an interval boundary at
 * the very end of the route never renders on top of the finish marker.
 * Small relative to every family interval (10% of the finest, 1 km) —
 * enough to avoid unreadable overlap without hiding a meaningful stretch
 * of the route. */
export const DISTANCE_BADGE_FINISH_CLEARANCE_METRES = 100;

/** Real-world distance below which two badge coordinates are treated as
 * "the same place on the ground" for collision purposes (a loop's shared
 * start/finish area, or an out-and-back's overlapping leg) — distinct
 * from, and deliberately smaller than, routeLayer.ts's own isLoopRoute
 * threshold (50m, calibrated for GPS drift identifying the route's
 * start≈finish), and larger than planningLayer.ts's manual-placement
 * WAYPOINT_COINCIDENCE_THRESHOLD_METRES (3m) — this one is about whether
 * two small on-screen badges would visually overlap. */
export const DISTANCE_BADGE_COINCIDENCE_THRESHOLD_METRES = 15;

/** Conservative hard cap on simultaneously-rendered badge DOM markers for
 * whole-route presentation (Planning, the pre-ride overview, free roam) —
 * each is a real DOM node plus a MapLibre Marker instance, not a cheap
 * WebGL symbol, so this stays low enough to be cheap on an iPhone while
 * comfortably covering even a long audax-length route at the coarsest
 * (20 km) interval. selectDistanceBadgeIntervalMetres is expected to keep
 * counts near or under this on its own; this is a defensive backstop for
 * any caller that bypasses it. See MAX_ACTIVE_UPCOMING_DISTANCE_BADGES for
 * active-Riding's own, much smaller, rolling-window cap. */
export const MAX_WHOLE_ROUTE_DISTANCE_BADGES = 24;

/** Rolling-window cap for active-Riding's own "next upcoming badges" mode
 * (see selectActiveUpcomingBadgeSpacingMetres / buildActiveUpcomingDistance
 * BadgeMarkerSpecs) — deliberately far smaller than
 * MAX_WHOLE_ROUTE_DISTANCE_BADGES, since active mode never needs the whole
 * route's badges at once, only a handful of genuinely upcoming landmarks. */
export const MAX_ACTIVE_UPCOMING_DISTANCE_BADGES = 10;

/** The approved whole-route badge intervals — chosen by zoom and route
 * length, never by rider progress. Used by Planning, the pre-ride
 * overview and free roam. Active-Riding uses a separate, zoom-only family
 * — see ACTIVE_UPCOMING_BADGE_SPACINGS_METRES. */
export const DISTANCE_BADGE_INTERVALS_METRES = [1000, 5000, 10000, 20000] as const;
export type DistanceBadgeIntervalMetres =
  (typeof DISTANCE_BADGE_INTERVALS_METRES)[number];

// Provisional starting points for the approved 1/5/10/20 km whole-route
// family — picked as reasonable bands, NOT yet verified against a real
// iPhone viewport. Adjust only these three constants, if a real device
// shows clutter or excessive thinning at a natural zoom level, without
// changing the family or the escalation/de-escalation logic below.
export const DISTANCE_BADGE_STREET_ZOOM_MIN = 15; // >= this: 1 km
export const DISTANCE_BADGE_INTERMEDIATE_ZOOM_MIN = 12; // >= this: 5 km
export const DISTANCE_BADGE_REGIONAL_ZOOM_MIN = 9; // >= this: 10 km
// below DISTANCE_BADGE_REGIONAL_ZOOM_MIN: 20 km

/** Active-Riding's own zoom-only spacing family (item 84 follow-up) —
 * deliberately separate from DISTANCE_BADGE_INTERVALS_METRES: it includes
 * a 2 km spacing the whole-route family doesn't have, and its zoom bands
 * (below) don't line up with the whole-route thresholds (14 is its own
 * band here, folded into the whole-route family's 5 km band). Never
 * mix the two families or their threshold constants — see
 * selectActiveUpcomingBadgeSpacingMetres's own differential test against
 * selectDistanceBadgeIntervalMetres at zoom 14. */
export const ACTIVE_UPCOMING_BADGE_SPACINGS_METRES = [
  1000, 2000, 5000, 10000, 20000,
] as const;
export type ActiveUpcomingBadgeSpacingMetres =
  (typeof ACTIVE_UPCOMING_BADGE_SPACINGS_METRES)[number];

export const ACTIVE_UPCOMING_BADGE_CLOSE_ZOOM_MIN = 15; // >= this: 1 km
export const ACTIVE_UPCOMING_BADGE_NEAR_ZOOM_MIN = 14; // == this band: 2 km
export const ACTIVE_UPCOMING_BADGE_INTERMEDIATE_ZOOM_MIN = 12; // >= this: 5 km
export const ACTIVE_UPCOMING_BADGE_REGIONAL_ZOOM_MIN = 9; // >= this: 10 km
// below ACTIVE_UPCOMING_BADGE_REGIONAL_ZOOM_MIN: 20 km

export interface DistanceBadgeCandidate {
  distanceFromStartMetres: number;
  coordinate: Coordinate;
}

/**
 * The exact target coordinate for every positive multiple of
 * `intervalMetres` up to (route length − finish clearance), found by a
 * single forward pass over `points` — the cursor only ever advances,
 * never restarts from the beginning for a later target, so this is
 * O(n + m) total (n = points, m = targets), not O(n·m). Never mutates
 * `points`.
 *
 * Sanitises defensively before placing anything: a point with a
 * non-finite coordinate/distance, or a distanceFromStartMetres that
 * decreases relative to the last *kept* point, is dropped from the
 * bracketing sequence entirely (not merely skipped as a target) — so
 * malformed/corrupted data can never produce a wrong-looking badge, an
 * infinite loop, or a crash; it can only ever produce fewer badges.
 * Consecutive points with *equal* cumulative distance are kept (only a
 * genuine decrease is dropped) — a zero-length segment is a normal
 * occurrence in this codebase's distance model, not an error.
 *
 * A target exactly equal to an existing (sanitised) point's own distance
 * uses that point's stored coordinate directly — never re-derived by
 * interpolation, so it can't drift from the point the route line itself
 * renders. A target strictly between two points linearly interpolates
 * their coordinates (same lerp as upcomingElevation.ts's
 * interpolateRoutePointAt and routeLayer.ts's interpolateSplitCoordinate),
 * with the same `span === 0 ? 0 : ratio` zero-span guard kept for
 * consistency with those siblings, even though the forward-only cursor
 * used here means a zero span is not actually reachable in this specific
 * algorithm (the bracketing "before" point is always strictly earlier
 * than the target once the exact-match case above is excluded).
 *
 * Returns [] for: an empty route; a single point; a route whose
 * (sanitised) total length, minus the finish clearance, is below the
 * first requested multiple of `intervalMetres` (covers "shorter than the
 * interval" and "exactly one interval" — the latter's sole candidate
 * collides with the finish clearance and is correctly suppressed, not a
 * bug); a non-finite or non-positive `intervalMetres`.
 */
export function placeDistanceBadgeCandidates(
  points: readonly RoutePoint[],
  intervalMetres: number,
  finishClearanceMetres: number = DISTANCE_BADGE_FINISH_CLEARANCE_METRES,
): DistanceBadgeCandidate[] {
  if (!Number.isFinite(intervalMetres) || intervalMetres <= 0) return [];

  const sanitised: RoutePoint[] = [];
  let lastKeptDistance = -Infinity;
  for (const point of points) {
    const [lon, lat] = point.coordinate;
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(point.distanceFromStartMetres) ||
      point.distanceFromStartMetres < lastKeptDistance
    ) {
      continue;
    }
    sanitised.push(point);
    lastKeptDistance = point.distanceFromStartMetres;
  }
  const lastSanitised = sanitised.at(-1);
  if (lastSanitised === undefined) return [];

  function sanitisedAt(index: number): RoutePoint {
    const point = sanitised[index];
    if (point === undefined) {
      throw new Error(
        "unreachable: cursor index out of range during distance-badge placement",
      );
    }
    return point;
  }

  const totalDistanceMetres = lastSanitised.distanceFromStartMetres;
  const maxPlaceableDistanceMetres = totalDistanceMetres - finishClearanceMetres;
  if (maxPlaceableDistanceMetres < intervalMetres) return [];

  const candidates: DistanceBadgeCandidate[] = [];
  let cursor = 0;
  for (
    let target = intervalMetres;
    target <= maxPlaceableDistanceMetres;
    target += intervalMetres
  ) {
    while (cursor < sanitised.length - 1) {
      if (sanitisedAt(cursor).distanceFromStartMetres >= target) break;
      cursor += 1;
    }
    const after = sanitisedAt(cursor);
    if (after.distanceFromStartMetres === target) {
      candidates.push({ distanceFromStartMetres: target, coordinate: after.coordinate });
      continue;
    }
    const before = sanitised[cursor - 1];
    if (!before) continue; // unreachable: target >= intervalMetres > 0 implies an earlier point exists
    const span = after.distanceFromStartMetres - before.distanceFromStartMetres;
    const t = span === 0 ? 0 : (target - before.distanceFromStartMetres) / span;
    candidates.push({
      distanceFromStartMetres: target,
      coordinate: [
        before.coordinate[0] + t * (after.coordinate[0] - before.coordinate[0]),
        before.coordinate[1] + t * (after.coordinate[1] - before.coordinate[1]),
      ],
    });
  }
  return candidates;
}

function naiveCandidateCount(routeLengthMetres: number, intervalMetres: number): number {
  const maxPlaceable = routeLengthMetres - DISTANCE_BADGE_FINISH_CLEARANCE_METRES;
  if (maxPlaceable < intervalMetres) return 0;
  return Math.floor(maxPlaceable / intervalMetres);
}

function zoomToBandIndex(zoom: number): number {
  if (zoom >= DISTANCE_BADGE_STREET_ZOOM_MIN) return 0; // 1 km
  if (zoom >= DISTANCE_BADGE_INTERMEDIATE_ZOOM_MIN) return 1; // 5 km
  if (zoom >= DISTANCE_BADGE_REGIONAL_ZOOM_MIN) return 2; // 10 km
  return 3; // 20 km — also the safe fallback for a non-finite zoom, since
  // every comparison above is false for NaN.
}

function intervalAtBand(bandIndex: number): DistanceBadgeIntervalMetres {
  const interval = DISTANCE_BADGE_INTERVALS_METRES[bandIndex];
  if (interval === undefined) {
    throw new Error("unreachable: band index out of range");
  }
  return interval;
}

/**
 * Whole-route policy only (Planning, the pre-ride overview, free roam) —
 * see selectActiveUpcomingBadgeSpacingMetres for active-Riding's separate,
 * zoom-only policy. Zoom → interval band, then two escalation passes:
 *  - cap escalation: while the naive candidate count (ignoring merging)
 *    over the whole route would exceed MAX_WHOLE_ROUTE_DISTANCE_BADGES,
 *    step to the next coarser family member ("route length may increase
 *    the interval");
 *  - minimum-usefulness de-escalation: while the resulting interval would
 *    place *zero* candidates on the route, step to the next finer family
 *    member, never going finer than 1 km ("a route of at least 1 km
 *    should receive at least one useful marker where practical"). A
 *    route too short even for a 1 km badge is simply left with zero
 *    candidates once placement runs — there is no finer interval to fall
 *    back to.
 *
 * These two passes can never conflict: the first only fires when the
 * naive count is large (never zero); the second only fires when it's
 * exactly zero.
 *
 * Stabilisation against zoom jitter is deliberately NOT this function's
 * job — see MapView.tsx, which only ever calls this with an
 * already-settled, already-integer-rounded zoom value (settled-only +
 * quantisation, not hysteresis). This function itself is a pure,
 * deterministic lookup: the same zoom always yields the same band.
 *
 * Never depends on rider progress (no such parameter exists here).
 * Always returns a family member, never throws: a non-finite zoom (NaN,
 * ±Infinity) resolves to the safest 20 km band before escalation runs
 * (every comparison in zoomToBandIndex is false for NaN); a non-finite
 * or negative routeLengthMetres is clamped to 0.
 */
export function selectDistanceBadgeIntervalMetres(
  zoom: number,
  routeLengthMetres: number,
): DistanceBadgeIntervalMetres {
  const safeLength = Number.isFinite(routeLengthMetres)
    ? Math.max(routeLengthMetres, 0)
    : 0;
  let bandIndex = zoomToBandIndex(zoom);

  while (
    bandIndex < DISTANCE_BADGE_INTERVALS_METRES.length - 1 &&
    naiveCandidateCount(safeLength, intervalAtBand(bandIndex)) >
      MAX_WHOLE_ROUTE_DISTANCE_BADGES
  ) {
    bandIndex += 1;
  }

  while (
    bandIndex > 0 &&
    naiveCandidateCount(safeLength, intervalAtBand(bandIndex)) === 0
  ) {
    bandIndex -= 1;
  }

  return intervalAtBand(bandIndex);
}

/**
 * Active-Riding's own zoom-only spacing selector (item 84 follow-up) —
 * unlike selectDistanceBadgeIntervalMetres, this never takes route length
 * as input and never escalates/de-escalates: it is a pure zoom→spacing
 * lookup. The rolling MAX_ACTIVE_UPCOMING_DISTANCE_BADGES cap (applied by
 * buildActiveUpcomingDistanceBadgeMarkerSpecs, after placement, active-
 * progress filtering and coincidence merging) is active mode's only
 * count-limiting mechanism — a long route must never coarsen this
 * selector's result.
 *
 * A non-finite zoom (NaN, ±Infinity) is guarded explicitly and resolves to
 * the safest, coarsest 20 km spacing: without the explicit guard, +Infinity
 * would incorrectly satisfy the `>= ACTIVE_UPCOMING_BADGE_CLOSE_ZOOM_MIN`
 * check and wrongly select 1 km.
 */
export function selectActiveUpcomingBadgeSpacingMetres(
  zoom: number,
): ActiveUpcomingBadgeSpacingMetres {
  if (!Number.isFinite(zoom)) return 20000;
  if (zoom >= ACTIVE_UPCOMING_BADGE_CLOSE_ZOOM_MIN) return 1000;
  if (zoom >= ACTIVE_UPCOMING_BADGE_NEAR_ZOOM_MIN) return 2000;
  if (zoom >= ACTIVE_UPCOMING_BADGE_INTERMEDIATE_ZOOM_MIN) return 5000;
  if (zoom >= ACTIVE_UPCOMING_BADGE_REGIONAL_ZOOM_MIN) return 10000;
  return 20000;
}

/**
 * Active-Riding ahead/completed policy: hides a candidate once the
 * rider's frozen/reliable progress has passed it — "omit", not "retain
 * subdued" (see the plan's own rationale: both are equally simple to
 * implement here, so the brief's default applies). `null` (no reliable
 * progress yet — before Start riding, or Riding's full-route overview)
 * returns every candidate unchanged, which is also exactly what Planning
 * gets, since Planning never supplies a progress value at all. A
 * candidate exactly AT the current progress is kept (>=, not >), so the
 * badge nearest the current position never briefly vanishes on an exact
 * boundary hit. Never invents a second progress estimate — this is the
 * only place rider progress enters this whole module.
 */
export function filterActiveRidingCandidates(
  candidates: readonly DistanceBadgeCandidate[],
  presentationDistanceFromStartMetres: number | null,
): DistanceBadgeCandidate[] {
  if (
    presentationDistanceFromStartMetres === null ||
    !Number.isFinite(presentationDistanceFromStartMetres)
  ) {
    return [...candidates];
  }
  return candidates.filter(
    (candidate) =>
      candidate.distanceFromStartMetres >= presentationDistanceFromStartMetres,
  );
}

function formatKilometreList(kmValues: readonly number[]): string {
  if (kmValues.length === 1) {
    const [km] = kmValues;
    if (km === undefined) {
      throw new Error("unreachable: the length check above guarantees a first element");
    }
    return `${String(km)} kilometre${km === 1 ? "" : "s"}`;
  }
  return `${kmValues.join(" and ")} kilometres`;
}

function buildMarkerSpecForGroup(
  group: readonly DistanceBadgeCandidate[],
): DistanceBadgeMarkerSpec {
  const sorted = [...group].sort(
    (a, b) => a.distanceFromStartMetres - b.distanceFromStartMetres,
  );
  const kmValues = sorted.map((candidate) =>
    Math.round(candidate.distanceFromStartMetres / 1000),
  );
  // Any member's coordinate suffices — every member of a group is
  // already within the coincidence threshold of every other.
  const anchor = sorted[0];
  if (anchor === undefined) {
    throw new Error("unreachable: a group is never empty");
  }
  return {
    id: `distance-badge-${kmValues.join("-")}`,
    coordinate: anchor.coordinate,
    label: kmValues.join(" / "),
    ariaLabel: `${formatKilometreList(kmValues)} from route start`,
  };
}

/**
 * Groups candidates whose coordinates mutually fall within
 * `coincidenceThresholdMetres` of one another (checked against every
 * existing group member, not just the first, so a chain of 3+
 * near-coincident points on a self-intersecting route is still caught as
 * one group) and renders each group as a single spec: a combined label
 * ("10 / 30", ascending — the caller appends the "km" unit), a combined
 * aria-label ("10 and 30 kilometres from route start"), and an id
 * derived only from the sorted distances (never array index), e.g.
 * "distance-badge-10-30". A non-coincident candidate simply becomes a
 * group of one, so a normal single badge is just this function's common
 * case rather than a separately-implemented path.
 *
 * Callers always run filterActiveRidingCandidates first, so a completed
 * candidate can never survive into a group here — "prefer upcoming over
 * completed at the same place" falls out with no special-case code.
 *
 * Runs in O(n²) over the already interval-selected candidate list (at
 * most a few dozen entries even before capping), so an all-pairs
 * comparison is deliberately not optimised with a spatial index.
 *
 * The returned array preserves the ascending distance order of the
 * input (each group's earliest, smallest-distance member is encountered
 * in ascending order, and no group is ever reordered after creation) —
 * capDistanceBadgeMarkerSpecs relies on this to keep the nearest-to-start
 * survivors when truncating.
 */
export function mergeCoincidentDistanceBadges(
  candidates: readonly DistanceBadgeCandidate[],
  coincidenceThresholdMetres: number = DISTANCE_BADGE_COINCIDENCE_THRESHOLD_METRES,
): DistanceBadgeMarkerSpec[] {
  const groups: DistanceBadgeCandidate[][] = [];

  for (const candidate of candidates) {
    const group = groups.find((existing) =>
      existing.some(
        (member) =>
          haversineDistanceMetres(member.coordinate, candidate.coordinate) <=
          coincidenceThresholdMetres,
      ),
    );
    if (group) {
      group.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }

  return groups.map((group) => buildMarkerSpecForGroup(group));
}

/**
 * Hard, order-preserving truncation to at most `maxCount` entries,
 * keeping the nearest-to-start survivors (see mergeCoincidentDistanceBadges's
 * own ordering guarantee) — a defensive backstop for whole-route mode, not
 * the primary mechanism there (selectDistanceBadgeIntervalMetres is
 * expected to keep counts near the cap already), and the *primary*,
 * load-bearing mechanism for active-Riding's own rolling window (see
 * buildActiveUpcomingDistanceBadgeMarkerSpecs). Invalid `maxCount` (NaN,
 * zero, negative) yields [].
 */
export function capDistanceBadgeMarkerSpecs(
  specs: readonly DistanceBadgeMarkerSpec[],
  maxCount: number = MAX_WHOLE_ROUTE_DISTANCE_BADGES,
): DistanceBadgeMarkerSpec[] {
  if (!Number.isFinite(maxCount) || maxCount <= 0) return [];
  return specs.slice(0, maxCount);
}

/**
 * The shared pipeline both whole-route and active-Riding modes call:
 * placement → active-Riding filter → coincidence merge → cap, in that
 * fixed order. `intervalMetres` may be any valid positive spacing, not
 * only a member of DISTANCE_BADGE_INTERVALS_METRES — whole-route callers
 * are expected to pass a value from selectDistanceBadgeIntervalMetres,
 * and active-Riding callers a value from
 * selectActiveUpcomingBadgeSpacingMetres (including its 2 km spacing,
 * which is not a member of the whole-route family) — but this function
 * itself stays agnostic to which family a caller's value came from, so it
 * remains independently testable with any positive interval. `maxCount`
 * defaults to the whole-route cap; active-Riding passes
 * MAX_ACTIVE_UPCOMING_DISTANCE_BADGES explicitly.
 */
export function buildDistanceBadgeMarkerSpecs(
  points: readonly RoutePoint[],
  intervalMetres: number,
  presentationDistanceFromStartMetres: number | null,
  maxCount: number = MAX_WHOLE_ROUTE_DISTANCE_BADGES,
): DistanceBadgeMarkerSpec[] {
  const candidates = filterActiveRidingCandidates(
    placeDistanceBadgeCandidates(points, intervalMetres),
    presentationDistanceFromStartMetres,
  );
  return capDistanceBadgeMarkerSpecs(mergeCoincidentDistanceBadges(candidates), maxCount);
}

/**
 * Active-Riding's own pipeline entry point (item 84 follow-up): zoom-only
 * spacing (selectActiveUpcomingBadgeSpacingMetres, never route length) and
 * a rolling window of the next MAX_ACTIVE_UPCOMING_DISTANCE_BADGES
 * upcoming badges — deliberately never escalated by total route length,
 * so a 45/100/300 km route at a close zoom still gets fine spacing; the
 * rolling cap alone bounds how much is rendered.
 *
 * If `presentationDistanceFromStartMetres` is null or non-finite (GPS/
 * matching still starting after Start/Resume, before the first reliable
 * fix), there is no reliable progress yet to anchor a rolling window
 * around — this deliberately falls back to the exact whole-route policy
 * (family, escalation, cap) rather than fabricating a zero-progress
 * window, and switches to the active window once reliable progress
 * exists.
 */
export function buildActiveUpcomingDistanceBadgeMarkerSpecs(
  points: readonly RoutePoint[],
  zoom: number,
  presentationDistanceFromStartMetres: number | null,
): DistanceBadgeMarkerSpec[] {
  if (
    presentationDistanceFromStartMetres === null ||
    !Number.isFinite(presentationDistanceFromStartMetres)
  ) {
    const routeLengthMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
    const intervalMetres = selectDistanceBadgeIntervalMetres(zoom, routeLengthMetres);
    return buildDistanceBadgeMarkerSpecs(points, intervalMetres, null);
  }
  const intervalMetres = selectActiveUpcomingBadgeSpacingMetres(zoom);
  return buildDistanceBadgeMarkerSpecs(
    points,
    intervalMetres,
    presentationDistanceFromStartMetres,
    MAX_ACTIVE_UPCOMING_DISTANCE_BADGES,
  );
}
