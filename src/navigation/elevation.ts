import type { RoutePoint } from "../domain/types.ts";

/** Distance step used when resampling elevation before smoothing/ascent. */
export const RESAMPLE_STEP_METRES = 20;
/** Centred moving-average window, in resampled steps (~100 m). */
export const SMOOTHING_WINDOW_SAMPLES = 5;
/** Minimum confirmed reversal before an excursion counts as ascent/descent. */
export const MIN_ASCENT_DELTA_METRES = 1;

export interface ElevationAnalysis {
  ascentMetres: number | null;
  descentMetres: number | null;
}

interface KnownElevationPoint {
  distanceMetres: number;
  elevationMetres: number;
}

export function hasAnyElevation(points: readonly RoutePoint[]): boolean {
  return points.some((point) => point.elevationMetres !== null);
}

function isKnownElevationPoint(
  point: RoutePoint,
): point is RoutePoint & { elevationMetres: number } {
  return point.elevationMetres !== null;
}

function buildSampleDistances(totalDistanceMetres: number, stepMetres: number): number[] {
  if (totalDistanceMetres <= 0) {
    return [0];
  }
  const distances: number[] = [];
  for (let d = 0; d < totalDistanceMetres; d += stepMetres) {
    distances.push(d);
  }
  distances.push(totalDistanceMetres);
  return distances;
}

/**
 * Resamples known (distance, elevation) pairs onto `sampleDistances` by
 * linear interpolation. A target distance before the first known point or
 * after the last is flat-extrapolated from the nearest known point, since
 * there's no bracketing pair to interpolate between there.
 */
function resampleElevations(
  known: readonly KnownElevationPoint[],
  sampleDistances: readonly number[],
): number[] {
  if (known.length === 0) {
    throw new Error("resampleElevations requires at least one known elevation point");
  }

  const resampled: number[] = [];
  let i = 0;

  for (const targetDistance of sampleDistances) {
    while (i + 1 < known.length) {
      const next = known[i + 1];
      if (next === undefined || next.distanceMetres > targetDistance) break;
      i += 1;
    }

    const before = known[i];
    if (before === undefined) {
      throw new Error("unreachable: resampleElevations index invariant violated");
    }
    const after = known[i + 1];

    if (after === undefined || targetDistance <= before.distanceMetres) {
      resampled.push(before.elevationMetres);
      continue;
    }

    const span = after.distanceMetres - before.distanceMetres;
    const t = span === 0 ? 0 : (targetDistance - before.distanceMetres) / span;
    resampled.push(
      before.elevationMetres + t * (after.elevationMetres - before.elevationMetres),
    );
  }

  return resampled;
}

function centredMovingAverage(values: readonly number[], windowSize: number): number[] {
  const halfWindow = Math.floor(windowSize / 2);

  return values.map((_, index) => {
    const start = Math.max(0, index - halfWindow);
    const end = Math.min(values.length - 1, index + halfWindow);
    let sum = 0;
    let count = 0;
    for (let i = start; i <= end; i += 1) {
      const value = values[i];
      if (value !== undefined) {
        sum += value;
        count += 1;
      }
    }
    return count > 0 ? sum / count : 0;
  });
}

/**
 * Elevation-gain algorithm: walks the smoothed series tracking the running
 * extremum since the last confirmed reversal, only banking an ascent or
 * descent once the elevation has moved back from that extremum by at
 * least `minDeltaMetres`. This is what lets a long, gentle climb whose
 * individual sample-to-sample steps are each smaller than the threshold
 * still accumulate correctly (a naive per-sample delta filter would
 * discard every step and undercount the climb to zero), while short
 * GPS/barometric jitter below the threshold never registers at all.
 */
function computeAscentDescent(
  smoothed: readonly number[],
  minDeltaMetres: number,
): { ascentMetres: number; descentMetres: number } {
  const first = smoothed[0];
  if (first === undefined) {
    return { ascentMetres: 0, descentMetres: 0 };
  }

  let ascentMetres = 0;
  let descentMetres = 0;
  let referenceElevation = first;
  let extremumElevation = first;
  let direction: "up" | "down" | null = null;

  for (let i = 1; i < smoothed.length; i += 1) {
    const elevation = smoothed[i];
    if (elevation === undefined) continue;

    if (direction === null) {
      if (elevation - referenceElevation >= minDeltaMetres) {
        direction = "up";
        extremumElevation = elevation;
      } else if (referenceElevation - elevation >= minDeltaMetres) {
        direction = "down";
        extremumElevation = elevation;
      }
      continue;
    }

    if (direction === "up") {
      if (elevation >= extremumElevation) {
        extremumElevation = elevation;
      } else if (extremumElevation - elevation >= minDeltaMetres) {
        ascentMetres += extremumElevation - referenceElevation;
        referenceElevation = extremumElevation;
        direction = "down";
        extremumElevation = elevation;
      }
    } else {
      if (elevation <= extremumElevation) {
        extremumElevation = elevation;
      } else if (elevation - extremumElevation >= minDeltaMetres) {
        descentMetres += referenceElevation - extremumElevation;
        referenceElevation = extremumElevation;
        direction = "up";
        extremumElevation = elevation;
      }
    }
  }

  if (direction === "up") {
    ascentMetres += extremumElevation - referenceElevation;
  } else if (direction === "down") {
    descentMetres += referenceElevation - extremumElevation;
  }

  return { ascentMetres, descentMetres };
}

/**
 * Ascent/descent from a route's points. Raw `RoutePoint.elevationMetres`
 * values are never mutated by this pipeline — it only reads them into a
 * separate resampled/smoothed series used purely for this calculation.
 */
export function analyzeElevation(points: readonly RoutePoint[]): ElevationAnalysis {
  if (!hasAnyElevation(points)) {
    return { ascentMetres: null, descentMetres: null };
  }

  const known: KnownElevationPoint[] = points
    .filter(isKnownElevationPoint)
    .map((point) => ({
      distanceMetres: point.distanceFromStartMetres,
      elevationMetres: point.elevationMetres,
    }));

  const totalDistance = points.at(-1)?.distanceFromStartMetres ?? 0;
  const sampleDistances = buildSampleDistances(totalDistance, RESAMPLE_STEP_METRES);
  const resampled = resampleElevations(known, sampleDistances);
  const smoothed = centredMovingAverage(resampled, SMOOTHING_WINDOW_SAMPLES);

  return computeAscentDescent(smoothed, MIN_ASCENT_DELTA_METRES);
}
