import {
  classifyRunGrades,
  clipClassifiedSegments,
  type ClassifiedSegment,
  type ElevationRun,
} from "./gradient.ts";
import {
  CLIMB_GRADIENT_BAND_SEVERITY_ORDER,
  DESCENT_LOCAL_KEY_SEVERITY_ORDER,
  classifyClimbGradientBand,
  classifyDescentLocalKey,
  type RouteFeature,
} from "./routeFeatures.ts";
import type { MicroDetailVisualKey } from "./routeFeaturePalette.ts";

/** The one run (from RouteElevationProfile.runs) whose own resampled
 * bounds contain `feature`'s distance range — a recognised feature can
 * never straddle a run boundary, since detectRouteFeatures only ever
 * derives features from within a single run (see routeFeatures.ts's own
 * doc comment), so at most one run can ever match. Returns undefined in
 * the defensive case of no match (e.g. a stale feature from a previous
 * analysis). */
function findOwningRun(
  runs: readonly ElevationRun[],
  feature: RouteFeature,
): ElevationRun | undefined {
  return runs.find((run) => {
    const start = run.distances[0];
    const end = run.distances.at(-1);
    return (
      start !== undefined &&
      end !== undefined &&
      start <= feature.startDistanceMetres &&
      end >= feature.endDistanceMetres
    );
  });
}

/**
 * Builds the detailed local-gradient segments for a single selected or
 * currently active recognised climb/descent — a climb gets the 5-band
 * Garmin-style scale (classifyClimbGradientBand), a descent gets the
 * 3-band-plus-neutral scale (classifyDescentLocalKey), both reusing the
 * exact same smoothed ~100 m regression grades already computed by
 * gradient.ts's analyzeRouteElevationProfile (ElevationRun.gradesPercent)
 * — no second gradient calculation. Returns an empty array if `feature`'s
 * owning run can't be found (defensive; not expected in practice).
 *
 * Unlike the cheap clip-only `clipClassifiedSegments`, this does real
 * classify+merge+flicker-suppress work over one run — callers MUST memoize
 * this (e.g. `useMemo` keyed on `[feature, runs]`), not call it inline on
 * every render, since a naive call would re-run on every GPS tick during
 * active Riding.
 */
export function buildFeatureDetailSegments(
  feature: RouteFeature,
  runs: readonly ElevationRun[],
): ClassifiedSegment<MicroDetailVisualKey>[] {
  const run = findOwningRun(runs, feature);
  if (!run) return [];

  const classified: ClassifiedSegment<MicroDetailVisualKey>[] =
    feature.kind === "climb"
      ? classifyRunGrades(
          run,
          classifyClimbGradientBand,
          "gentle-or-descending",
          CLIMB_GRADIENT_BAND_SEVERITY_ORDER,
        )
      : classifyRunGrades(
          run,
          classifyDescentLocalKey,
          "neutral",
          DESCENT_LOCAL_KEY_SEVERITY_ORDER,
        );

  return clipClassifiedSegments(
    classified,
    feature.startDistanceMetres,
    feature.endDistanceMetres,
  );
}

/** Where the rider's frozen/reliable presentation distance sits relative to
 * a selected feature's own boundaries — ahead of it, inside it, or already
 * past it (backlog item 85's active-standard compact summary). */
export type FeatureRelativePosition =
  | { kind: "ahead"; distanceUntilStartMetres: number }
  | { kind: "within"; distanceRemainingMetres: number }
  | { kind: "passed"; distanceSincePassedMetres: number };

/**
 * Pure ahead/within/passed classification for an explicitly selected
 * feature, given only the rider's existing frozen/reliable presentation
 * distance — never raw/live progress, so the result stays stable through
 * stale-fix or off-route freezing exactly like every other Riding
 * presentation value. "Within" is inclusive of both bounds, mirroring
 * findFeatureAtDistance's own convention (a distance exactly at a
 * feature's start is that feature's own active range, never "ahead").
 * Returns null only when there is no presentation distance yet (e.g. an
 * explicit selection made before the first GPS fix lands), mirroring
 * computeClimbProgressMetrics's own `| null` convention — callers should
 * omit the relative-position line entirely in that case rather than
 * fabricate one.
 */
export function computeFeatureRelativePosition(
  feature: RouteFeature,
  presentationDistanceFromStartMetres: number | null,
): FeatureRelativePosition | null {
  if (presentationDistanceFromStartMetres === null) {
    return null;
  }
  if (presentationDistanceFromStartMetres < feature.startDistanceMetres) {
    return {
      kind: "ahead",
      distanceUntilStartMetres:
        feature.startDistanceMetres - presentationDistanceFromStartMetres,
    };
  }
  if (presentationDistanceFromStartMetres <= feature.endDistanceMetres) {
    return {
      kind: "within",
      distanceRemainingMetres:
        feature.endDistanceMetres - presentationDistanceFromStartMetres,
    };
  }
  return {
    kind: "passed",
    distanceSincePassedMetres:
      presentationDistanceFromStartMetres - feature.endDistanceMetres,
  };
}
