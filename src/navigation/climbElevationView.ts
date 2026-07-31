import type { RoutePoint } from "../domain/types.ts";
import type { ClassifiedSegment } from "./gradient.ts";
import { findClassifiedSegmentAtDistance } from "./gradient.ts";
import type { ClimbFeature } from "./routeFeatures.ts";
import type { MicroDetailVisualKey } from "./routeFeaturePalette.ts";
import type { ElevationViewMode } from "./types.ts";
import { interpolateRoutePointAt } from "./upcomingElevation.ts";

/**
 * The elevation view actually shown: either the rider's own standard
 * preference (Full or a rolling 2/5/10 km window, unchanged from
 * `ElevationViewMode`) or the transient "Climb" presentation for whichever
 * recognised climb the rider is currently riding through. `featureId` is
 * carried for self-documentation only — it always equals the `activeClimb`
 * a caller already has in hand, never an independent source of truth.
 * "Climb" is never itself persisted as a standing preference; see
 * `selectEffectiveElevationView`.
 */
export type EffectiveElevationView =
  ElevationViewMode | { kind: "climb"; featureId: string };

/**
 * Pure derivation of the elevation view to display — deliberately holds no
 * "has this climb already been auto-shown" state of its own. Auto-open,
 * "no repeated reset while still in the same climb", "manual dismissal
 * suppresses reopening for the rest of that climb", and "leaving all
 * climbs returns to the standard view" all fall out for free from
 * comparing `dismissedClimbFeatureId` against the currently active climb's
 * own stable id on every call:
 *
 * - No active climb: always the standard view.
 * - An active climb whose id was NOT the one most recently dismissed:
 *   Climb view (this covers first entry to a climb, repeated fixes within
 *   it, and entering a genuinely different climb after an earlier one was
 *   dismissed — the old dismissal simply no longer matches).
 * - An active climb whose id IS the one most recently dismissed: the
 *   standard view, for as long as the rider stays in that same climb.
 *
 * `dismissedClimbFeatureId` is set by the caller when the rider manually
 * picks a standard view while inside a climb, and cleared (`null`) when
 * the rider manually re-selects Climb — both are simple, unconditionally
 * safe writes since a dismissal only ever matters when it matches the
 * currently active climb.
 */
export function selectEffectiveElevationView(
  standardMode: ElevationViewMode,
  activeClimb: ClimbFeature | null,
  dismissedClimbFeatureId: string | null,
): EffectiveElevationView {
  if (activeClimb === null) {
    return standardMode;
  }
  if (dismissedClimbFeatureId === activeClimb.id) {
    return standardMode;
  }
  return { kind: "climb", featureId: activeClimb.id };
}

export interface ClimbElevationWindow {
  points: RoutePoint[];
  startDistanceMetres: number;
  endDistanceMetres: number;
}

/**
 * The slice of route points spanning exactly [startDistanceMetres,
 * endDistanceMetres] — a recognised climb's own bounds — with both
 * boundaries interpolated via `interpolateRoutePointAt` so the window's
 * first/last point sit at the exact climb start/finish even when those
 * fall mid-segment. Mirrors `selectUpcomingElevationWindow`'s own
 * interior-points + interpolated-seam construction, but parameterised by
 * an explicit end distance rather than a forward window: a climb's bounds
 * are always within the route's own bounds (detectRouteFeatures only ever
 * derives a feature from within one analysed run), so there is no
 * clamp-to-route-end case to handle here.
 */
export function selectClimbElevationWindow(
  points: readonly RoutePoint[],
  startDistanceMetres: number,
  endDistanceMetres: number,
): ClimbElevationWindow {
  const startPoint = interpolateRoutePointAt(points, startDistanceMetres);
  if (startPoint === null) {
    return { points: [], startDistanceMetres, endDistanceMetres };
  }

  if (startDistanceMetres === endDistanceMetres) {
    return {
      points: [startPoint],
      startDistanceMetres: startPoint.distanceFromStartMetres,
      endDistanceMetres: startPoint.distanceFromStartMetres,
    };
  }

  const endPoint = interpolateRoutePointAt(points, endDistanceMetres);
  if (endPoint === null) {
    return { points: [], startDistanceMetres, endDistanceMetres };
  }

  const interiorPoints = points.filter(
    (point) =>
      point.distanceFromStartMetres > startPoint.distanceFromStartMetres &&
      point.distanceFromStartMetres < endPoint.distanceFromStartMetres,
  );

  return {
    points: [startPoint, ...interiorPoints, endPoint],
    startDistanceMetres: startPoint.distanceFromStartMetres,
    endDistanceMetres: endPoint.distanceFromStartMetres,
  };
}

export interface ClimbProgressMetrics {
  /** The presentation distance clamped to [climb.startDistanceMetres,
   * climb.endDistanceMetres] — used as the chart marker's own distance. */
  clampedPresentationDistanceMetres: number;
  distanceCompletedMetres: number;
  distanceRemainingMetres: number;
  /** Smoothed elevation at the clamped presentation distance, or null when
   * the shared profile has no known elevation there. */
  currentElevationMetres: number | null;
  /** Smoothed elevation at the climb's own detected finish. */
  finishElevationMetres: number | null;
  /** max(0, finishElevationMetres - currentElevationMetres) over the
   * smoothed series — a net vertical difference to the detected climb
   * finish, not a new cumulative-ascent calculation, and not the same
   * value as `elevationGainMetres` (dips within the climb are not
   * re-summed). Null whenever either elevation input is null. */
  elevationRemainingMetres: number | null;
  /** The average gradient of the classified local-gradient segment
   * (already analysed/merged/flicker-suppressed) containing the clamped
   * presentation distance — never a new two-point calculation. */
  currentGradientPercent: number | null;
}

/**
 * Climb-relative progress metrics for the active climb, derived entirely
 * from the shared smoothed elevation profile and the already-classified
 * local-gradient segments for this feature (see
 * `routeFeatureDetail.ts`'s `buildFeatureDetailSegments`) — no new
 * elevation/gradient calculation. Returns null only when there is no
 * presentation distance to measure from yet (mirrors
 * `buildFullProfileMarker`'s own `| null` convention), pushing that
 * null-check into one place rather than requiring callers to prove
 * non-nullness across two separately-derived values.
 */
export function computeClimbProgressMetrics(
  feature: ClimbFeature,
  displayPoints: readonly RoutePoint[],
  microDetailSegments: readonly ClassifiedSegment<MicroDetailVisualKey>[],
  presentationDistanceFromStartMetres: number | null,
): ClimbProgressMetrics | null {
  if (presentationDistanceFromStartMetres === null) {
    return null;
  }

  const clampedPresentationDistanceMetres = Math.min(
    Math.max(presentationDistanceFromStartMetres, feature.startDistanceMetres),
    feature.endDistanceMetres,
  );

  const currentElevationMetres =
    interpolateRoutePointAt(displayPoints, clampedPresentationDistanceMetres)
      ?.elevationMetres ?? null;
  const finishElevationMetres =
    interpolateRoutePointAt(displayPoints, feature.endDistanceMetres)?.elevationMetres ??
    null;
  const elevationRemainingMetres =
    currentElevationMetres !== null && finishElevationMetres !== null
      ? Math.max(0, finishElevationMetres - currentElevationMetres)
      : null;

  const currentGradientPercent =
    findClassifiedSegmentAtDistance(
      microDetailSegments,
      clampedPresentationDistanceMetres,
    )?.averageGradientPercent ?? null;

  return {
    clampedPresentationDistanceMetres,
    distanceCompletedMetres:
      clampedPresentationDistanceMetres - feature.startDistanceMetres,
    distanceRemainingMetres:
      feature.endDistanceMetres - clampedPresentationDistanceMetres,
    currentElevationMetres,
    finishElevationMetres,
    elevationRemainingMetres,
    currentGradientPercent,
  };
}
