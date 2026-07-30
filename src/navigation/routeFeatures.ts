import type { ClassifiedSegment, RouteElevationProfile } from "./gradient.ts";
import { findClassifiedSegmentAtDistance } from "./gradient.ts";

/** A route length shorter than this can never be a recognised climb or
 * descent, regardless of gradient — matches both Garmin's own climb
 * eligibility and this app's app-specific descent recognition, which the
 * spec deliberately gives no separate length constant for. */
export const MIN_FEATURE_LENGTH_METRES = 500;
/** A climb candidate's net average gradient must be at least this to be
 * recognised, mirroring Garmin's published climb eligibility. */
export const MIN_CLIMB_AVERAGE_GRADIENT_PERCENT = 3;
/** climbScore = lengthMetres * averageGradientPercent must be at least
 * this to be recognised. Note: given MIN_FEATURE_LENGTH_METRES (500) and
 * MIN_CLIMB_AVERAGE_GRADIENT_PERCENT (3), climbScore is always >= 1500
 * whenever the other two eligibility checks already pass (500 * 3 =
 * 1500) — this check is therefore mathematically redundant given the
 * other two, but is kept as an explicit, independently-testable gate
 * (cheap, self-documenting, and a defensive backstop if either other
 * constant is ever tuned independently). */
export const MIN_CLIMB_SCORE = 1500;
/** A descent candidate's net average gradient must be at most this
 * (i.e. at least this steep, since gradient is negative) to be
 * recognised. App-specific — Garmin publishes no descent eligibility. */
export const MAX_DESCENT_AVERAGE_GRADIENT_PERCENT = -3;
/** Garmin-style climb score boundaries: score < 8000 is "uncategorised",
 * score >= 80000 is "HC". Every upper bound is exclusive, matching this
 * module's own classifyClimbGradientBand/classifyDescentBand convention. */
const CLIMB_CATEGORY_4_SCORE = 8000;
const CLIMB_CATEGORY_3_SCORE = 16000;
const CLIMB_CATEGORY_2_SCORE = 32000;
const CLIMB_CATEGORY_1_SCORE = 64000;
const CLIMB_CATEGORY_HC_SCORE = 80000;
/** Descent severity boundaries, by average gradient percent (more
 * negative = more severe). App-specific — Garmin publishes no descent
 * severity scheme. */
const DESCENT_STEEP_GRADIENT_PERCENT = -6;
const DESCENT_VERY_STEEP_GRADIENT_PERCENT = -9;
/** A brief reversal shorter than this distance, AND shallower than
 * REVERSAL_BRIDGE_ELEVATION_METRES, is bridged (ignored) rather than
 * splitting one climb/descent into several — either threshold alone
 * confirms a genuine reversal. */
export const REVERSAL_BRIDGE_DISTANCE_METRES = 200;
export const REVERSAL_BRIDGE_ELEVATION_METRES = 10;

export type ClimbCategory =
  "uncategorised" | "category-4" | "category-3" | "category-2" | "category-1" | "hc";

/** App-specific naming for descents, deliberately not "category-N" —
 * Garmin publishes no descent classification, so this app invents its own,
 * clearly distinct scheme (see CLAUDE.md). Used identically at both the
 * macro (whole-feature, by average gradient) and local (selected/active,
 * by smoothed local gradient) level — see classifyDescentBand/
 * classifyDescentLocalKey below — unlike a climb's macro category (a
 * length+average-gradient score) and local band (a plain gradient
 * threshold), which are genuinely different scales that only happen to
 * share colour tokens. */
export type DescentBand = "moderate" | "steep" | "very-steep";

/**
 * Garmin-ClimbPro-style local-gradient bands for a *selected or currently
 * active* recognised climb — a different concept from ClimbCategory (which
 * scores the climb's own overall length+average-gradient), describing only
 * the smoothed local gradient at one point within it. Deliberately not
 * reusing GradientClass's old climb member names (that scheme's thresholds
 * were 2/4/7/10%, this one's are 3/6/9/12%) — see classifyClimbGradientBand.
 */
export type ClimbGradientBand =
  | "gentle-or-descending"
  | "moderate-climb"
  | "hard-climb"
  | "very-hard-climb"
  | "extremely-steep-climb";

/** Deterministic grade→band mapping for a climb's *detailed* local
 * presentation. Every upper bound is exclusive. Brief flat or descending
 * sections within a climb fall into the lowest ("below 3%") band, matching
 * Garmin's own ClimbPro approach — there is no separate "descent"/"flat"
 * concept at this local level, unlike the retired whole-route
 * GradientClass scheme. */
export function classifyClimbGradientBand(gradePercent: number): ClimbGradientBand {
  if (gradePercent < 3) return "gentle-or-descending";
  if (gradePercent < 6) return "moderate-climb";
  if (gradePercent < 9) return "hard-climb";
  if (gradePercent < 12) return "very-hard-climb";
  return "extremely-steep-climb";
}

/** Ordered light-to-dark, for flicker-suppression severity comparisons
 * (see gradient.ts's classifyRunGrades) and for legend/UI enumeration. */
export const CLIMB_GRADIENT_BAND_SEVERITY_ORDER: readonly ClimbGradientBand[] = [
  "gentle-or-descending",
  "moderate-climb",
  "hard-climb",
  "very-hard-climb",
  "extremely-steep-climb",
];

/** A selected/active descent's local presentation: one of the same three
 * DescentBand values used at the macro level, or "neutral" for a local
 * stretch shallower than the descent eligibility threshold (a flat or
 * brief rise within an otherwise-recognised descent) — deliberately NOT
 * banded the way a climb's shallow sections are, since a descent's local
 * detail should read as "just the ordinary route" there rather than
 * implying a fourth descent-severity colour. */
export type DescentLocalKey = DescentBand | "neutral";

interface RouteFeatureCommon {
  /** Deterministic, derived from kind + start distance — stable across
   * repeated analysis of the same route, but not guaranteed to survive a
   * route edit/re-route (a new analysis simply produces a fresh list). */
  id: string;
  startDistanceMetres: number;
  endDistanceMetres: number;
  lengthMetres: number;
  /** The net average gradient over the complete feature, signed (positive
   * for a climb, negative for a descent). */
  averageGradientPercent: number;
}

export interface ClimbFeature extends RouteFeatureCommon {
  kind: "climb";
  elevationGainMetres: number;
  /** The steepest smoothed local gradient anywhere in the climb, drawn
   * from the same regression-fitted per-point grades used to classify
   * local-gradient segments — never a raw two-point spike. */
  maxGradientPercent: number;
  climbScore: number;
  category: ClimbCategory;
}

export interface DescentFeature extends RouteFeatureCommon {
  kind: "descent";
  elevationLossMetres: number;
  /** The steepest (most negative) smoothed local gradient anywhere in the
   * descent, signed to match averageGradientPercent's own convention. */
  maxGradientPercent: number;
  band: DescentBand;
}

export type RouteFeature = ClimbFeature | DescentFeature;

/** Garmin-style score-to-category mapping. Every upper bound is
 * exclusive, matching this module's own house style. */
export function classifyClimbScore(score: number): ClimbCategory {
  if (score < CLIMB_CATEGORY_4_SCORE) return "uncategorised";
  if (score < CLIMB_CATEGORY_3_SCORE) return "category-4";
  if (score < CLIMB_CATEGORY_2_SCORE) return "category-3";
  if (score < CLIMB_CATEGORY_1_SCORE) return "category-2";
  if (score < CLIMB_CATEGORY_HC_SCORE) return "category-1";
  return "hc";
}

/** Shared grade→band mapping used at BOTH the macro (whole-feature average
 * gradient) and local (selected/active, smoothed local gradient) level —
 * see classifyDescentBand/classifyDescentLocalKey below, the only two
 * public entry points. Assumes the caller's gradient is already at least
 * as steep as MAX_DESCENT_AVERAGE_GRADIENT_PERCENT (checked by
 * classifyDescentLocalKey for the local case, and by feature eligibility
 * for the macro case). */
function descentBandFromGradient(gradePercent: number): DescentBand {
  if (gradePercent > DESCENT_STEEP_GRADIENT_PERCENT) return "moderate";
  if (gradePercent > DESCENT_VERY_STEEP_GRADIENT_PERCENT) return "steep";
  return "very-steep";
}

/** App-specific average-gradient-to-band mapping for a complete recognised
 * descent (macro level). More negative gradient is more severe;
 * `averageGradientPercent` is assumed to already satisfy
 * MAX_DESCENT_AVERAGE_GRADIENT_PERCENT eligibility. */
export function classifyDescentBand(averageGradientPercent: number): DescentBand {
  return descentBandFromGradient(averageGradientPercent);
}

/** Local-gradient view of the same scheme, for a selected/active descent's
 * detailed presentation: a point shallower than the descent eligibility
 * threshold (a flat or brief rise within the descent) is "neutral" —
 * deliberately not banded — rather than being force-fit into "moderate".
 */
export function classifyDescentLocalKey(gradePercent: number): DescentLocalKey {
  if (gradePercent > MAX_DESCENT_AVERAGE_GRADIENT_PERCENT) return "neutral";
  return descentBandFromGradient(gradePercent);
}

/** Ordered light-to-dark plus "neutral" first (least severe), for
 * flicker-suppression severity comparisons (see gradient.ts's
 * classifyRunGrades). */
export const DESCENT_LOCAL_KEY_SEVERITY_ORDER: readonly DescentLocalKey[] = [
  "neutral",
  "moderate",
  "steep",
  "very-steep",
];

/**
 * Confirmed leg-boundary indices within one run's own (distances,
 * smoothed) arrays: a running extremum is tracked in the current trend
 * direction; a move against that trend only confirms a genuine reversal
 * (banking the extremum as a boundary and flipping trend) once EITHER the
 * elevation moved back by at least REVERSAL_BRIDGE_ELEVATION_METRES OR
 * the distance since the extremum reached REVERSAL_BRIDGE_DISTANCE_METRES
 * — while both stay under threshold, the movement is bridged (ignored):
 * the extremum itself doesn't move, so if the series later resumes past
 * it before either threshold trips, the dip is silently absorbed into the
 * ongoing leg. Always closes the final leg at the run's own last point,
 * deterministically, even mid-unconfirmed-reversal. Returns strictly
 * ascending indices, always starting at 0 and ending at the last index.
 *
 * A point within FLAT_EPSILON_METRES of the current extremum is treated
 * as neither extending it nor reversing away from it — this is what
 * stops a genuinely flat plateau (no reversal at all, so a naive
 * "extend while >=/<=" comparison would silently swallow it) from being
 * mis-anchored: a flat lead-in before a climb starts would otherwise pull
 * the eventual climb's own start boundary all the way back to the run's
 * very first point (index 0), and a flat plateau at the top of a climb
 * would otherwise pull its end boundary forward through the whole
 * plateau — both wrong, since neither stretch is actually part of the
 * rise. Using a strict (not >=/<=) comparison for extending, with an
 * explicit no-op middle case for a near-exact tie, means the boundary
 * anchors at the *first* point reaching a given height, not the last.
 */
const FLAT_EPSILON_METRES = 0.01;

function findLegBoundaryIndices(
  distances: readonly number[],
  smoothed: readonly number[],
): number[] {
  const pointCount = distances.length;
  const boundaries: number[] = [0];
  if (pointCount < 2) return boundaries;

  let referenceIndex = 0;
  let extremumIndex = 0;
  let trend: "up" | "down" | null = null;

  for (let i = 1; i < pointCount; i += 1) {
    const currentElevation = smoothed[i];
    if (currentElevation === undefined) continue;

    if (trend === null) {
      const referenceElevation = smoothed[referenceIndex];
      if (referenceElevation === undefined) continue;
      if (currentElevation > referenceElevation + FLAT_EPSILON_METRES) {
        trend = "up";
        extremumIndex = i;
      } else if (currentElevation < referenceElevation - FLAT_EPSILON_METRES) {
        trend = "down";
        extremumIndex = i;
      } else {
        // Still an undifferentiated flat lead-in — slide the pending
        // start-of-run boundary forward to this point, so whichever
        // trend eventually commits anchors at the plateau's own end, not
        // the run's absolute start.
        referenceIndex = i;
        boundaries[0] = i;
      }
      continue;
    }

    const extremumElevation = smoothed[extremumIndex];
    if (extremumElevation === undefined) continue;

    const extending =
      trend === "up"
        ? currentElevation > extremumElevation + FLAT_EPSILON_METRES
        : currentElevation < extremumElevation - FLAT_EPSILON_METRES;
    if (extending) {
      extremumIndex = i;
      continue;
    }

    const isFlat = Math.abs(currentElevation - extremumElevation) <= FLAT_EPSILON_METRES;
    if (isFlat) {
      // A plateau at the current extremum's own height — neither a new
      // high/low (so extremumIndex stays at the *first* point that
      // reached it) nor a genuine reversal (nothing has actually moved
      // back yet). Left as a no-op rather than falling into the reversal
      // check below, which would otherwise eventually confirm a false
      // "reversal" purely from elapsed distance once the plateau
      // exceeds REVERSAL_BRIDGE_DISTANCE_METRES, despite zero actual
      // elevation change having happened.
      continue;
    }

    const reversalElevationMetres = Math.abs(extremumElevation - currentElevation);
    const extremumDistance = distances[extremumIndex];
    const currentDistance = distances[i];
    const reversalDistanceMetres =
      extremumDistance === undefined || currentDistance === undefined
        ? 0
        : currentDistance - extremumDistance;

    if (
      reversalElevationMetres >= REVERSAL_BRIDGE_ELEVATION_METRES ||
      reversalDistanceMetres >= REVERSAL_BRIDGE_DISTANCE_METRES
    ) {
      boundaries.push(extremumIndex);
      referenceIndex = extremumIndex;
      trend = trend === "up" ? "down" : "up";
      extremumIndex = i;
    }
    // else: bridge — do nothing. extremumIndex stays put; `extending`
    // fires again above once the series resumes past it, silently
    // absorbing this dip into the ongoing leg.
  }

  // The run may end mid-trend without ever confirming a final reversal —
  // e.g. a climb topping out into a flat/bridged-shallow tail with no
  // more data. `extremumIndex` already tracks the best (highest/lowest)
  // point actually reached; closing there — rather than blindly at the
  // run's raw last point — keeps a trailing flat/bridged stretch out of
  // the climb, mirroring the flat-lead-in fix above. Any leftover
  // distance between that and the run's true last point becomes its own
  // (typically ineligible, since ~flat) trailing leg in Step 2, rather
  // than being silently folded into the feature that preceded it.
  if (trend !== null && boundaries.at(-1) !== extremumIndex) {
    boundaries.push(extremumIndex);
  }
  if (boundaries.at(-1) !== pointCount - 1) {
    boundaries.push(pointCount - 1);
  }
  return boundaries;
}

/** The most extreme (max for a climb, min for a descent) non-null grade
 * in [startIdx, endIdx] inclusive, falling back to `fallback`
 * (averageGradientPercent) on the defensive/expected-unreachable case
 * that every grade in range is null — a feature's own length always
 * exceeds gradient.ts's MIN_GRADE_WINDOW_METRES by a wide margin, so a
 * run long enough to contain a recognised feature always has non-null
 * grades throughout it. */
function extremeGradeInRange(
  gradesPercent: readonly (number | null)[],
  startIdx: number,
  endIdx: number,
  mode: "max" | "min",
  fallback: number,
): number {
  let result: number | null = null;
  for (let i = startIdx; i <= endIdx; i += 1) {
    const value = gradesPercent[i];
    if (value === null || value === undefined) continue;
    if (result === null || (mode === "max" ? value > result : value < result)) {
      result = value;
    }
  }
  return result ?? fallback;
}

function detectFeaturesForRun(
  run: RouteElevationProfile["runs"][number],
): RouteFeature[] {
  const { distances, smoothed, elevations, gradesPercent } = run;
  // Boundary DETECTION uses the smoothed series (noise-resistant, avoids
  // spurious reversals from raw jitter); the elevation VALUES used below
  // to compute a feature's own gain/loss/average-gradient use `elevations`
  // (raw resampled), not `smoothed` — see ElevationRun.elevations' own
  // doc comment for why the smoothed series would bias a delta computed
  // at a run's own edge.
  const boundaryIndices = findLegBoundaryIndices(distances, smoothed);
  const features: RouteFeature[] = [];

  for (let i = 0; i < boundaryIndices.length - 1; i += 1) {
    const startIdx = boundaryIndices[i];
    const endIdx = boundaryIndices[i + 1];
    if (startIdx === undefined || endIdx === undefined) continue;
    const startDistance = distances[startIdx];
    const endDistance = distances[endIdx];
    const startElevation = elevations[startIdx];
    const endElevation = elevations[endIdx];
    if (
      startDistance === undefined ||
      endDistance === undefined ||
      startElevation === undefined ||
      endElevation === undefined
    ) {
      continue;
    }

    const lengthMetres = endDistance - startDistance;
    if (lengthMetres <= 0) continue;
    const deltaElevationMetres = endElevation - startElevation;
    if (deltaElevationMetres === 0) continue; // flat leg — no feature emitted
    const averageGradientPercent = (deltaElevationMetres / lengthMetres) * 100;

    if (deltaElevationMetres > 0) {
      const climbScore = lengthMetres * averageGradientPercent;
      // length>=500 && avgGrade>=3 already implies climbScore>=1500 (see
      // MIN_CLIMB_SCORE's own doc comment) — kept as an explicit,
      // independently-testable gate regardless.
      const eligible =
        lengthMetres >= MIN_FEATURE_LENGTH_METRES &&
        averageGradientPercent >= MIN_CLIMB_AVERAGE_GRADIENT_PERCENT &&
        climbScore >= MIN_CLIMB_SCORE;
      if (!eligible) continue;
      features.push({
        id: `climb-${String(Math.round(startDistance))}`,
        kind: "climb",
        startDistanceMetres: startDistance,
        endDistanceMetres: endDistance,
        lengthMetres,
        elevationGainMetres: deltaElevationMetres,
        averageGradientPercent,
        maxGradientPercent: extremeGradeInRange(
          gradesPercent,
          startIdx,
          endIdx,
          "max",
          averageGradientPercent,
        ),
        climbScore,
        category: classifyClimbScore(climbScore),
      });
    } else {
      const eligible =
        lengthMetres >= MIN_FEATURE_LENGTH_METRES &&
        averageGradientPercent <= MAX_DESCENT_AVERAGE_GRADIENT_PERCENT;
      if (!eligible) continue;
      features.push({
        id: `descent-${String(Math.round(startDistance))}`,
        kind: "descent",
        startDistanceMetres: startDistance,
        endDistanceMetres: endDistance,
        lengthMetres,
        elevationLossMetres: -deltaElevationMetres,
        averageGradientPercent,
        maxGradientPercent: extremeGradeInRange(
          gradesPercent,
          startIdx,
          endIdx,
          "min",
          averageGradientPercent,
        ),
        band: classifyDescentBand(averageGradientPercent),
      });
    }
  }

  return features;
}

/**
 * Detects complete recognised climbs and descents from the shared
 * full-route elevation analysis (see analyzeRouteElevationProfile in
 * gradient.ts) — never re-resamples or re-smooths elevation itself. Runs
 * are processed independently and in order, so a feature never bridges a
 * >500 m elevation-data gap (the run boundary IS the bridge limit), and
 * the result is non-overlapping and ascending by construction. Unlike
 * GradientSegment[], the result is sparse: a route section that is
 * neither a recognised climb nor descent (too short, too shallow, or
 * genuinely flat) simply has no feature covering it, rather than an
 * explicit "ordinary" entry. Must always be called with the full-route
 * profile, never a windowed slice — a feature's own stats describe the
 * complete climb/descent, and only rendering (map/chart) is ever clipped
 * to a window afterwards, never the feature record itself.
 */
export function detectRouteFeatures(profile: RouteElevationProfile): RouteFeature[] {
  const features: RouteFeature[] = [];
  for (const run of profile.runs) {
    features.push(...detectFeaturesForRun(run));
  }
  return features;
}

/** The climbs within `features`, in route order (ascending start
 * distance) — safe to rely on detectRouteFeatures's own ascending/
 * non-overlapping-by-construction guarantee rather than re-sorting.
 * Used to number and order the pre-ride climb selector. */
export function listClimbsInRouteOrder(
  features: readonly RouteFeature[],
): readonly ClimbFeature[] {
  return features.filter((feature): feature is ClimbFeature => feature.kind === "climb");
}

/** The recognised feature containing `distanceMetres` (inclusive of both
 * ends), or `null` when the distance falls in an ordinary (non-feature)
 * section or outside every feature's range. */
export function findFeatureAtDistance(
  features: readonly RouteFeature[],
  distanceMetres: number,
): RouteFeature | null {
  for (const feature of features) {
    if (
      distanceMetres >= feature.startDistanceMetres &&
      distanceMetres <= feature.endDistanceMetres
    ) {
      return feature;
    }
  }
  return null;
}

export type ElevationChartTapResolution<Class extends string> =
  | { kind: "feature"; feature: RouteFeature }
  | { kind: "segment"; segment: ClassifiedSegment<Class> }
  | null;

/**
 * Resolves an elevation-chart tap (already converted to a route distance
 * by the caller) to whichever range the route analysis already produced
 * — never inventing a new boundary from the tapped coordinate. If the
 * tap falls inside the feature currently shown in micro detail (selected
 * or active), it resolves to the specific local-gradient segment there
 * (a finer-grained selection than the feature itself); otherwise it
 * resolves to whichever macro feature contains the tap, if any. A tap on
 * an ordinary section (no feature, or no micro segment despite being
 * inside the detail feature) resolves to `null` — deliberately a no-op
 * for the caller, not a "clear selection" signal, mirroring the existing
 * warnings convention of a dedicated Clear-selection control rather than
 * tap-empty-to-clear. Generic over the micro segment's own classification
 * type — this function never inspects a segment's visualKey, it only
 * looks up which one (if any) contains the tapped distance.
 */
export function resolveElevationChartTap<Class extends string>(
  distanceMetres: number,
  routeFeatures: readonly RouteFeature[],
  microDetailFeature: RouteFeature | null,
  microDetailSegments: readonly ClassifiedSegment<Class>[],
): ElevationChartTapResolution<Class> {
  if (
    microDetailFeature !== null &&
    distanceMetres >= microDetailFeature.startDistanceMetres &&
    distanceMetres <= microDetailFeature.endDistanceMetres
  ) {
    const segment = findClassifiedSegmentAtDistance(microDetailSegments, distanceMetres);
    if (segment !== null) return { kind: "segment", segment };
  }
  const feature = findFeatureAtDistance(routeFeatures, distanceMetres);
  if (feature !== null) return { kind: "feature", feature };
  return null;
}
