import type { Manoeuvre } from "../domain/types.ts";

/**
 * How far past a manoeuvre's own distance the rider's presentation
 * distance must be before it counts as reliably passed. Order-of-magnitude
 * comparable to offRoute.ts's POSSIBLY_OFF_ROUTE_BASE_METRES (20 m) — both
 * exist to absorb GPS/projection uncertainty rather than trust a single
 * fix's distance to the metre. Deliberately a "must be past by at least
 * this much" comparison, not "within this much of" — the latter would
 * wrongly let a second manoeuvre that is still genuinely ahead, but within
 * this same tolerance distance of one just passed, be skipped too.
 */
export const MANOEUVRE_REACHED_TOLERANCE_METRES = 15;

export interface NextManoeuvreSelection {
  /** Index of the presented manoeuvre in the original manoeuvres array.
   * Diverges from NextManoeuvreResult.reachedIndex whenever one or more
   * synthetic waypoint-seam entries (stitchPlannedRouteLegs.ts) sit between
   * reachedIndex and the next presentable manoeuvre — index always points
   * at the latter, reachedIndex always tracks the former. */
  index: number;
  manoeuvre: Manoeuvre;
  remainingDistanceMetres: number;
}

export interface NextManoeuvreResult {
  /** Feed this back in as previousReachedIndex on the next call. Tracks
   * physical distance-based progress only — never adjusted for synthetic
   * waypoint-seam entries, unlike NextManoeuvreSelection.index. */
  reachedIndex: number;
  selection: NextManoeuvreSelection | null;
}

/**
 * Selects the next manoeuvre a rider has not yet reliably passed, from the
 * frozen/reliable presentationDistanceFromStartMetres — never the live
 * matched distance — so this inherits the same off-route-freeze and
 * stale-fix-restore behaviour as every other presentation value already
 * keyed off that same distance (e.g. RidingScreen's activeFeature).
 *
 * previousReachedIndex makes advancement monotonic: the result never
 * regresses to an earlier manoeuvre because of a small backward jitter in
 * presentationDistanceFromStartMetres. Callers should pass 0 initially and
 * feed reachedIndex back in on every subsequent call (see RidingScreen's
 * derive-during-render + conditional setState pattern, mirroring its
 * existing explicitFeatureSelection state).
 *
 * Returns selection: null when there is nothing to show — an empty
 * manoeuvre list, no reliable presentation distance yet, or every
 * manoeuvre already reliably passed (end of route) — in every case
 * reachedIndex is still returned so the caller's state stays consistent.
 */
export function selectNextManoeuvre(
  manoeuvres: readonly Manoeuvre[],
  presentationDistanceFromStartMetres: number | null,
  previousReachedIndex: number,
): NextManoeuvreResult {
  if (manoeuvres.length === 0 || presentationDistanceFromStartMetres === null) {
    return { reachedIndex: previousReachedIndex, selection: null };
  }

  let reachedIndex = previousReachedIndex;
  while (
    reachedIndex < manoeuvres.length &&
    presentationDistanceFromStartMetres >=
      (manoeuvres[reachedIndex]?.distanceFromStartMetres ?? 0) +
        MANOEUVRE_REACHED_TOLERANCE_METRES
  ) {
    reachedIndex += 1;
  }
  // Never regress below what was already reliably reached, even if a
  // stray fix briefly reduced the scan above (defensive — the while loop
  // above is already monotonic non-decreasing from previousReachedIndex,
  // but this keeps the invariant explicit and cheap to verify).
  reachedIndex = Math.max(reachedIndex, previousReachedIndex);
  reachedIndex = Math.min(reachedIndex, manoeuvres.length);

  // A synthetic waypoint-seam entry (stitchPlannedRouteLegs.ts, collapsing
  // an internal leg boundary) carries no instruction and no actionable
  // content, so it must never be presented — scan forward from reachedIndex
  // to the next presentable manoeuvre. Deliberately distance-independent
  // (type only, no MANOEUVRE_REACHED_TOLERANCE_METRES check): this both
  // lets a seam be skipped pre-emptively, well before it is physically
  // reached, and guarantees a real manoeuvre near a seam is never swallowed
  // by proximity alone. displayIndex is a pure function of
  // (manoeuvres, reachedIndex); since reachedIndex is already non-decreasing
  // across calls, displayIndex inherits that same monotonicity for free —
  // no separate state is needed to avoid regressing to an already-skipped
  // seam.
  let displayIndex = reachedIndex;
  while (
    displayIndex < manoeuvres.length &&
    manoeuvres[displayIndex]?.type === "waypoint"
  ) {
    displayIndex += 1;
  }

  const manoeuvre = manoeuvres[displayIndex];
  if (!manoeuvre) {
    return { reachedIndex, selection: null };
  }

  return {
    reachedIndex,
    selection: {
      index: displayIndex,
      manoeuvre,
      remainingDistanceMetres: Math.max(
        0,
        manoeuvre.distanceFromStartMetres - presentationDistanceFromStartMetres,
      ),
    },
  };
}

export type ManoeuvreUrgency = "normal" | "near" | "imminent";

const IMMINENT_THRESHOLD_METRES = 100;
const NEAR_THRESHOLD_METRES = 500;

/** CLAUDE.md's own figure (500 m) marks the "near" boundary; 100 m is this
 * slice's own extra sub-band for the strongest presentation. */
export function classifyManoeuvreUrgency(
  remainingDistanceMetres: number,
): ManoeuvreUrgency {
  if (remainingDistanceMetres < IMMINENT_THRESHOLD_METRES) return "imminent";
  if (remainingDistanceMetres < NEAR_THRESHOLD_METRES) return "near";
  return "normal";
}
