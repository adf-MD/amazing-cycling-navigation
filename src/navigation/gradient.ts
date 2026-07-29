import type { RoutePoint } from "../domain/types.ts";
import {
  RESAMPLE_STEP_METRES,
  centredMovingAverage,
  hasAnyElevation,
} from "./elevation.ts";

/** Distance beyond which two consecutive known-elevation points are no
 * longer treated as one continuous, analysable run — the gap in between is
 * left `unknown` rather than presented as a measured grade over an
 * unmeasured stretch. */
export const MAX_ELEVATION_GAP_METRES = 500;
/** A short, ~40 m-span pre-smooth applied before grade calculation, on top
 * of (not instead of) the resampling step — distinct in purpose and window
 * size from elevation.ts's own ~100 m ascent/descent smoothing, since a
 * grade (a derivative) is far more noise-sensitive than a cumulative sum. */
export const GRADIENT_SMOOTHING_WINDOW_SAMPLES = 3;
/** The centred horizontal baseline over which a displayed grade is
 * measured — deliberately much wider than the 20 m resample step, so
 * gradient reflects a genuine road-length feature rather than
 * sample-to-sample noise. Shifted, never shrunk, near a run's own edges. */
export const GRADE_BASELINE_WINDOW_METRES = 160;
/** A run shorter than this can't support even one full baseline window and
 * is left `unknown` in its entirety, rather than implying a slope from too
 * little horizontal span (this also covers the "single known point" case,
 * since a run must have at least two points spanning this distance). */
export const MIN_GRADE_WINDOW_METRES = 40;
/** A classified segment shorter than this is treated as flicker and
 * absorbed into whichever neighbouring segment is closer in severity,
 * rather than left as an isolated sliver. */
export const MIN_SEGMENT_LENGTH_METRES = 60;

export type GradientClass =
  | "steep-descent"
  | "descent"
  | "flat"
  | "gentle-climb"
  | "moderate-climb"
  | "hard-climb"
  | "very-steep-climb"
  | "unknown";

export interface GradientSegment {
  startDistanceMetres: number;
  endDistanceMetres: number;
  averageGradientPercent: number | null;
  classification: GradientClass;
}

/** Classifications ordered from steepest descent to steepest climb, used to
 * measure how many bands apart two classes are when suppressing flicker.
 * `"unknown"` is deliberately excluded — it never participates in a
 * severity comparison, since absorbing a real reading into "no data" would
 * erase information rather than merely reclassifying it. */
const CLASS_SEVERITY_ORDER: readonly GradientClass[] = [
  "steep-descent",
  "descent",
  "flat",
  "gentle-climb",
  "moderate-climb",
  "hard-climb",
  "very-steep-climb",
];

/** Deterministic grade→class mapping. Every upper bound is exclusive, so a
 * value exactly on a boundary belongs to the steeper/higher band. */
export function classifyGrade(gradePercent: number): GradientClass {
  if (gradePercent < -6) return "steep-descent";
  if (gradePercent < -2) return "descent";
  if (gradePercent < 2) return "flat";
  if (gradePercent < 4) return "gentle-climb";
  if (gradePercent < 7) return "moderate-climb";
  if (gradePercent < 10) return "hard-climb";
  return "very-steep-climb";
}

interface KnownElevationPoint {
  distanceMetres: number;
  elevationMetres: number;
}

function unknownSegment(
  startDistanceMetres: number,
  endDistanceMetres: number,
): GradientSegment {
  return {
    startDistanceMetres,
    endDistanceMetres,
    averageGradientPercent: null,
    classification: "unknown",
  };
}

/** Filters to points with known, finite elevation and a strictly-increasing
 * distance from the previously *kept* point — a decreasing, repeated, or
 * non-finite distance silently drops that point from the analysable series
 * rather than corrupting a resampled grade with a zero/negative span. */
function buildMonotonicKnownPoints(points: readonly RoutePoint[]): KnownElevationPoint[] {
  const known: KnownElevationPoint[] = [];
  for (const point of points) {
    if (point.elevationMetres === null) continue;
    if (
      !Number.isFinite(point.distanceFromStartMetres) ||
      !Number.isFinite(point.elevationMetres)
    ) {
      continue;
    }
    const previous = known.at(-1);
    if (
      previous !== undefined &&
      point.distanceFromStartMetres <= previous.distanceMetres
    ) {
      continue;
    }
    known.push({
      distanceMetres: point.distanceFromStartMetres,
      elevationMetres: point.elevationMetres,
    });
  }
  return known;
}

/** Splits a monotonic known-elevation series into runs that can each be
 * legitimately treated as one continuous analysable stretch: a new run
 * starts whenever the gap to the previous known point exceeds
 * MAX_ELEVATION_GAP_METRES. A run of a single point can't support any
 * resampling and is dropped (its span becomes an `unknown` gap instead). */
function splitIntoRuns(known: readonly KnownElevationPoint[]): KnownElevationPoint[][] {
  const runs: KnownElevationPoint[][] = [];
  let current: KnownElevationPoint[] = [];
  for (const point of known) {
    const previous = current.at(-1);
    if (
      previous !== undefined &&
      point.distanceMetres - previous.distanceMetres > MAX_ELEVATION_GAP_METRES
    ) {
      runs.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) runs.push(current);
  return runs.filter((run) => run.length >= 2);
}

/**
 * Resamples one run's known (distance, elevation) pairs at a fixed step
 * from the run's own first to last known distance (always including the
 * exact last distance as a final sample). Deliberately not a reuse of
 * elevation.ts's resampleElevations: that function's flat-extrapolation
 * branches (for a target before the first / after the last known point)
 * are structurally unreachable here, since a run's bounds are its own
 * known bounds — reusing it would carry dead, misleading semantics into
 * this module. This is a small, dedicated interpolator instead.
 */
function resampleRun(
  run: readonly KnownElevationPoint[],
  stepMetres: number,
): { distances: number[]; elevations: number[] } {
  const first = run[0];
  const last = run.at(-1);
  if (first === undefined || last === undefined) {
    return { distances: [], elevations: [] };
  }
  const startDistance = first.distanceMetres;
  const endDistance = last.distanceMetres;

  const distances: number[] = [];
  for (let d = startDistance; d < endDistance; d += stepMetres) {
    distances.push(d);
  }
  distances.push(endDistance);

  const elevations: number[] = [];
  let i = 0;
  for (const targetDistance of distances) {
    while (i + 1 < run.length) {
      const next = run[i + 1];
      if (next === undefined || next.distanceMetres > targetDistance) break;
      i += 1;
    }
    const before = run[i];
    if (before === undefined) break;
    const after = run[i + 1];
    if (after === undefined || targetDistance <= before.distanceMetres) {
      elevations.push(before.elevationMetres);
      continue;
    }
    const span = after.distanceMetres - before.distanceMetres;
    const t = span === 0 ? 0 : (targetDistance - before.distanceMetres) / span;
    elevations.push(
      before.elevationMetres + t * (after.elevationMetres - before.elevationMetres),
    );
  }
  return { distances, elevations };
}

/** Linear interpolation of `values` at `target`, given the parallel,
 * ascending `distances` they were sampled at. Assumes target falls within
 * distances' own bounds (true for every caller in this module, since grade
 * windows are always shifted to stay inside a run's bounds). */
function interpolateAt(
  distances: readonly number[],
  values: readonly number[],
  target: number,
): number {
  for (let i = 0; i < distances.length - 1; i += 1) {
    const d0 = distances[i];
    const d1 = distances[i + 1];
    if (d0 === undefined || d1 === undefined || target < d0 || target > d1) continue;
    const span = d1 - d0;
    const t = span === 0 ? 0 : (target - d0) / span;
    const v0 = values[i] ?? 0;
    const v1 = values[i + 1] ?? 0;
    return v0 + t * (v1 - v0);
  }
  return values.at(-1) ?? 0;
}

function computeGradeBetween(d1: number, e1: number, d2: number, e2: number): number {
  const span = d2 - d1;
  if (span <= 0) return 0;
  return ((e2 - e1) / span) * 100;
}

/**
 * Grade at every resampled point in a run, using a centred baseline window
 * that is shifted (never shrunk) to stay inside the run's own bounds near
 * an edge — this is what avoids exaggerated start/finish grades from only
 * half a window. A run shorter than MIN_GRADE_WINDOW_METRES yields
 * `null` (unknown) throughout; a run shorter than the full baseline window
 * but at least MIN_GRADE_WINDOW_METRES yields one single grade estimate
 * over its own full extent for every point.
 */
function computeGradesForRun(
  distances: readonly number[],
  smoothed: readonly number[],
): (number | null)[] {
  const runStart = distances[0];
  const runEnd = distances.at(-1);
  if (runStart === undefined || runEnd === undefined) return [];
  const runLengthMetres = runEnd - runStart;

  if (runLengthMetres < MIN_GRADE_WINDOW_METRES) {
    return distances.map(() => null);
  }
  if (runLengthMetres < GRADE_BASELINE_WINDOW_METRES) {
    const grade = computeGradeBetween(
      runStart,
      smoothed[0] ?? 0,
      runEnd,
      smoothed.at(-1) ?? 0,
    );
    return distances.map(() => grade);
  }

  const halfWindow = GRADE_BASELINE_WINDOW_METRES / 2;
  return distances.map((targetDistance) => {
    let windowStart = targetDistance - halfWindow;
    let windowEnd = targetDistance + halfWindow;
    if (windowStart < runStart) {
      const shift = runStart - windowStart;
      windowStart += shift;
      windowEnd += shift;
    }
    if (windowEnd > runEnd) {
      const shift = windowEnd - runEnd;
      windowStart -= shift;
      windowEnd -= shift;
    }
    return computeGradeBetween(
      windowStart,
      interpolateAt(distances, smoothed, windowStart),
      windowEnd,
      interpolateAt(distances, smoothed, windowEnd),
    );
  });
}

/** Combines two adjacent segments' average grades as a length-weighted
 * mean — a close, deliberately simple approximation to the true combined
 * rise/run that avoids re-threading raw elevation samples through the
 * merge step. The approximation error is bounded by each input segment's
 * own internal grade variance, which is small since every input segment
 * already represents an already-smoothed, roughly-linear stretch. */
function combineAverageGradient(a: GradientSegment, b: GradientSegment): number | null {
  if (a.averageGradientPercent === null || b.averageGradientPercent === null) return null;
  const aLength = a.endDistanceMetres - a.startDistanceMetres;
  const bLength = b.endDistanceMetres - b.startDistanceMetres;
  const totalLength = aLength + bLength;
  if (totalLength <= 0) return a.averageGradientPercent;
  return (
    (a.averageGradientPercent * aLength + b.averageGradientPercent * bLength) /
    totalLength
  );
}

/** Merges consecutive segments sharing the same classification into one,
 * extending the distance range and combining averageGradientPercent.
 * Never merges across a classification change, so "unknown" gaps always
 * stay distinct from their classified neighbours. */
function mergeAdjacent(segments: readonly GradientSegment[]): GradientSegment[] {
  const result: GradientSegment[] = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    if (previous?.classification === segment.classification) {
      result[result.length - 1] = {
        startDistanceMetres: previous.startDistanceMetres,
        endDistanceMetres: segment.endDistanceMetres,
        classification: previous.classification,
        averageGradientPercent: combineAverageGradient(previous, segment),
      };
    } else {
      result.push({ ...segment });
    }
  }
  return result;
}

/** Grade-classified segments for one continuous run, already merged so no
 * two adjacent segments share a classification. */
function analyzeRun(run: readonly KnownElevationPoint[]): GradientSegment[] {
  const { distances, elevations } = resampleRun(run, RESAMPLE_STEP_METRES);
  if (distances.length < 2) return [];
  const smoothed = centredMovingAverage(elevations, GRADIENT_SMOOTHING_WINDOW_SAMPLES);
  const grades = computeGradesForRun(distances, smoothed);

  const pointSegments: GradientSegment[] = [];
  for (let i = 0; i < distances.length - 1; i += 1) {
    const start = distances[i];
    const end = distances[i + 1];
    const grade = grades[i];
    if (start === undefined || end === undefined) continue;
    pointSegments.push({
      startDistanceMetres: start,
      endDistanceMetres: end,
      averageGradientPercent: null,
      classification:
        grade === null || grade === undefined ? "unknown" : classifyGrade(grade),
    });
  }

  return mergeAdjacent(pointSegments).map((segment) =>
    segment.classification === "unknown"
      ? segment
      : {
          ...segment,
          averageGradientPercent: computeGradeBetween(
            segment.startDistanceMetres,
            interpolateAt(distances, smoothed, segment.startDistanceMetres),
            segment.endDistanceMetres,
            interpolateAt(distances, smoothed, segment.endDistanceMetres),
          ),
        },
  );
}

function severityDistance(a: GradientClass, b: GradientClass): number {
  const ai = CLASS_SEVERITY_ORDER.indexOf(a);
  const bi = CLASS_SEVERITY_ORDER.indexOf(b);
  if (ai === -1 || bi === -1) return Number.POSITIVE_INFINITY;
  return Math.abs(ai - bi);
}

/** One reassign-then-merge pass: absorbs short, non-`unknown` segments into
 * whichever *original* neighbour (as of the start of this pass) is closer
 * in severity, a tie preferring the following segment. `unknown` segments
 * are never a reassignment target's source nor absorbed themselves, so a
 * real reading is never silently erased into "no data", and a genuinely
 * isolated short reading with only unknown neighbours on both sides is
 * left untouched rather than forced to merge. Every reassignment target is
 * an existing adjacent value, so any segment actually reassigned this pass
 * is guaranteed to merge with that neighbour — `changed` tracks whether
 * that happened, so the caller knows whether another pass could help. */
function suppressFlickerPass(segments: readonly GradientSegment[]): {
  result: GradientSegment[];
  changed: boolean;
} {
  let changed = false;
  const reassigned = segments.map((segment, index) => {
    const length = segment.endDistanceMetres - segment.startDistanceMetres;
    if (segment.classification === "unknown" || length >= MIN_SEGMENT_LENGTH_METRES) {
      return segment;
    }
    const previous = segments[index - 1];
    const next = segments[index + 1];
    const previousEligible =
      previous !== undefined && previous.classification !== "unknown";
    const nextEligible = next !== undefined && next.classification !== "unknown";
    if (!previousEligible && !nextEligible) return segment;

    let targetClassification: GradientClass;
    if (previousEligible && nextEligible) {
      const previousDistance = severityDistance(
        segment.classification,
        previous.classification,
      );
      const nextDistance = severityDistance(segment.classification, next.classification);
      targetClassification =
        nextDistance <= previousDistance ? next.classification : previous.classification;
    } else if (previousEligible) {
      targetClassification = previous.classification;
    } else if (next) {
      targetClassification = next.classification;
    } else {
      return segment;
    }
    if (targetClassification === segment.classification) return segment;
    changed = true;
    return { ...segment, classification: targetClassification };
  });
  return { result: mergeAdjacent(reassigned), changed };
}

/**
 * Repeats reassign-then-merge passes until a pass makes no further change.
 * Two short segments flanking one real feature can each tie-break toward
 * each other's original class in the same pass without either matching
 * their shared, longer far neighbour yet — a second pass resolves this,
 * since the first pass's merge has already removed the segment they were
 * ties against. Each changed pass strictly reduces the segment count (a
 * reassignment always matches an existing adjacent value, so it always
 * merges), so this is bounded by the initial segment count and always
 * terminates. */
function suppressFlicker(segments: readonly GradientSegment[]): GradientSegment[] {
  let current: GradientSegment[] = [...segments];
  for (let pass = 0; pass <= segments.length; pass += 1) {
    const { result, changed } = suppressFlickerPass(current);
    current = result;
    if (!changed) break;
  }
  return current;
}

/**
 * Provider-independent, noise-resistant gradient analysis of a route's
 * points, expressed as contiguous, non-overlapping segments covering
 * [0, totalDistanceMetres] exactly. Never mutates `points`, never sends
 * data anywhere, and is derived purely from already-normalised
 * RoutePoint.elevationMetres — safe to recompute entirely offline.
 */
export function analyzeGradient(points: readonly RoutePoint[]): GradientSegment[] {
  const totalDistanceMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
  if (totalDistanceMetres <= 0) return [];
  if (points.length < 2 || !hasAnyElevation(points)) {
    return [unknownSegment(0, totalDistanceMetres)];
  }

  const known = buildMonotonicKnownPoints(points);
  const runs = splitIntoRuns(known);

  const rawSegments: GradientSegment[] = [];
  let cursor = 0;
  for (const run of runs) {
    const first = run[0];
    const last = run.at(-1);
    if (first === undefined || last === undefined) continue;
    if (first.distanceMetres > cursor) {
      rawSegments.push(unknownSegment(cursor, first.distanceMetres));
    }
    rawSegments.push(...analyzeRun(run));
    cursor = last.distanceMetres;
  }
  if (cursor < totalDistanceMetres) {
    rawSegments.push(unknownSegment(cursor, totalDistanceMetres));
  }
  if (rawSegments.length === 0) {
    return [unknownSegment(0, totalDistanceMetres)];
  }

  return suppressFlicker(rawSegments);
}

/**
 * Clips gradient segments to [startDistanceMetres, endDistanceMetres],
 * truncating any segment that straddles a boundary rather than
 * re-analysing the windowed range — so a windowed (2/5/10 km) view always
 * agrees with the Full-route analysis at every shared distance, by
 * construction rather than by coincidence.
 */
export function clipGradientSegments(
  segments: readonly GradientSegment[],
  startDistanceMetres: number,
  endDistanceMetres: number,
): GradientSegment[] {
  const clampedStart = Math.min(startDistanceMetres, endDistanceMetres);
  const clampedEnd = Math.max(startDistanceMetres, endDistanceMetres);
  const result: GradientSegment[] = [];
  for (const segment of segments) {
    const start = Math.max(segment.startDistanceMetres, clampedStart);
    const end = Math.min(segment.endDistanceMetres, clampedEnd);
    if (end <= start) continue;
    result.push({ ...segment, startDistanceMetres: start, endDistanceMetres: end });
  }
  return result;
}
