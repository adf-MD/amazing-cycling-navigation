import type {
  Coordinate,
  Manoeuvre,
  PlannedRoute,
  RoutePoint,
  RouteWarning,
  SurfaceSummary,
} from "../domain/types.ts";
import {
  cumulativeDistancesMetres,
  haversineDistanceMetres,
} from "../navigation/distance.ts";
import { analyzeElevation } from "../navigation/elevation.ts";
import { coalesceAdjacentWarnings } from "../navigation/warningGeometry.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";

/** Generous versus ORS's own sub-metre coordinate re-snap jitter between
 * two independently-requested legs sharing a waypoint, while still
 * rejecting a genuine mismatch (an accidental join of unrelated segments
 * would differ by tens to hundreds of metres or more). Based on
 * haversineDistanceMetres, the project's one geographic-distance
 * primitive — never compared via JSON stringification or display
 * rounding. */
export const SEAM_TOLERANCE_METRES = 10;

/** Matches coalesceAdjacentWarnings' own default tolerance — the
 * codebase's already-established definition of "close enough to be the
 * same point" — rather than inventing a second, uncoordinated precision
 * constant for manoeuvre seam deduplication. Used to confirm a leg
 * boundary's "finish" (previous leg's own arrival) and "start" (next
 * leg's own departure) manoeuvres genuinely land at the same point before
 * collapsing them — see the manoeuvres-building loop below. */
export const MANOEUVRE_SEAM_DEDUP_TOLERANCE_METRES = 1;

export interface StitchRouteMetadata {
  id: string;
  name: string;
  createdAt: string;
}

interface StagedPoint {
  coordinate: Coordinate;
  elevationMetres: number | null;
}

/** A leg's own local point distances paired with where each of those same
 * points landed in the final stitched geometry — the basis for rebasing
 * that leg's manoeuvre/warning distances. Always the same length as the
 * leg's own points array, including the point dropped at a seam (whose
 * global distance is simply wherever the previous leg's retained point
 * landed). */
interface LegDistanceMapping {
  localDistances: readonly number[];
  globalDistances: readonly number[];
}

function clampDistance(value: number, totalDistanceMetres: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), totalDistanceMetres);
}

/** Piecewise-linear interpolation from a leg's own local distance space
 * into the stitched route's global distance space, clamped to
 * [0, totalDistanceMetres] and safe for zero-length spans or a
 * degenerate (empty) mapping. */
function mapLegDistance(
  mapping: LegDistanceMapping,
  localDistanceMetres: number,
  totalDistanceMetres: number,
): number {
  const { localDistances, globalDistances } = mapping;
  const lastIndex = localDistances.length - 1;
  if (lastIndex < 0) return 0;

  const firstLocal = localDistances[0] ?? 0;
  const firstGlobal = globalDistances[0] ?? 0;
  if (localDistanceMetres <= firstLocal) {
    return clampDistance(firstGlobal, totalDistanceMetres);
  }

  const lastLocal = localDistances[lastIndex];
  const lastGlobal = globalDistances[lastIndex] ?? firstGlobal;
  if (lastLocal !== undefined && localDistanceMetres >= lastLocal) {
    return clampDistance(lastGlobal, totalDistanceMetres);
  }

  for (let i = 0; i < lastIndex; i += 1) {
    const startLocal = localDistances[i];
    const endLocal = localDistances[i + 1];
    if (startLocal === undefined || endLocal === undefined) continue;
    if (localDistanceMetres < startLocal || localDistanceMetres > endLocal) continue;
    const startGlobal = globalDistances[i] ?? firstGlobal;
    const endGlobal = globalDistances[i + 1] ?? startGlobal;
    const span = endLocal - startLocal;
    const t = span === 0 ? 0 : (localDistanceMetres - startLocal) / span;
    return clampDistance(
      startGlobal + t * (endGlobal - startGlobal),
      totalDistanceMetres,
    );
  }

  return clampDistance(lastGlobal, totalDistanceMetres);
}

/**
 * Combines consecutive, separately-calculated route legs (each a
 * PlannedRoute from a two-waypoint provider call) into one canonical
 * PlannedRoute, never exposing the individual leg objects to callers.
 *
 * Distances are never leg-distance-summed: seam points are deduplicated
 * and the whole stitched geometry's distances are recomputed fresh via
 * cumulativeDistancesMetres, exactly the primitive used everywhere else
 * in the codebase, so the result can't drift from the true geometry.
 * Ascent/descent are recalculated once over the complete stitched point
 * array via analyzeElevation — never summed per leg, since smoothing and
 * threshold behaviour at a seam would otherwise be inconsistent with a
 * genuinely continuous route. Manoeuvre and warning distances are rebased
 * through a per-leg piecewise-linear distance mapping; a leg-boundary
 * "finish"+"start" manoeuvre pair (every leg's own independently-normalised
 * arrival/departure) collapses into a single "waypoint" manoeuvre rather
 * than surfacing both (see the manoeuvres-building loop below); warnings
 * are then run through the existing coalesceAdjacentWarnings so a hazard
 * reported by both legs at a shared seam merges into one.
 *
 * Throws a RoutingError with reason "leg-stitching-failed" — a purely
 * local, non-network condition — for an empty leg list or a seam gap
 * exceeding SEAM_TOLERANCE_METRES, rather than silently drawing a
 * straight connector across a genuine mismatch.
 */
export function stitchPlannedRouteLegs(
  legs: readonly PlannedRoute[],
  metadata: StitchRouteMetadata,
): PlannedRoute {
  const firstLeg = legs[0];
  if (!firstLeg) {
    throw new RoutingError({
      reason: "leg-stitching-failed",
      message: "No route sections were available to combine.",
    });
  }

  const stagedPoints: StagedPoint[] = [];
  const legGlobalIndices: number[][] = [];

  legs.forEach((leg, legIndex) => {
    const legPoints = leg.points;
    const globalIndices: number[] = [];

    if (legIndex === 0) {
      for (const point of legPoints) {
        globalIndices.push(stagedPoints.length);
        stagedPoints.push({
          coordinate: point.coordinate,
          elevationMetres: point.elevationMetres,
        });
      }
      legGlobalIndices.push(globalIndices);
      return;
    }

    const previousLast = stagedPoints.at(-1);
    const firstOfThisLeg = legPoints[0];
    if (!previousLast || !firstOfThisLeg) {
      throw new RoutingError({
        reason: "leg-stitching-failed",
        message: "A route section had no usable geometry to join.",
      });
    }

    const seamGapMetres = haversineDistanceMetres(
      previousLast.coordinate,
      firstOfThisLeg.coordinate,
    );
    if (seamGapMetres > SEAM_TOLERANCE_METRES) {
      throw new RoutingError({
        reason: "leg-stitching-failed",
        message:
          "Two route sections could not be joined — their shared point moved too far.",
      });
    }
    // Prefer an available elevation reading at the merged seam point over
    // discarding it, without inventing a value neither side reported.
    if (
      previousLast.elevationMetres === null &&
      firstOfThisLeg.elevationMetres !== null
    ) {
      previousLast.elevationMetres = firstOfThisLeg.elevationMetres;
    }

    // leg.points[0] is the duplicate seam point — it maps onto the same
    // global index as the previous leg's already-retained last point,
    // rather than being pushed again.
    globalIndices.push(stagedPoints.length - 1);
    for (let i = 1; i < legPoints.length; i += 1) {
      const point = legPoints[i];
      if (!point) continue;
      globalIndices.push(stagedPoints.length);
      stagedPoints.push({
        coordinate: point.coordinate,
        elevationMetres: point.elevationMetres,
      });
    }
    legGlobalIndices.push(globalIndices);
  });

  if (stagedPoints.length === 0) {
    throw new RoutingError({
      reason: "leg-stitching-failed",
      message: "No route geometry was available to combine.",
    });
  }

  const finalDistances = cumulativeDistancesMetres(
    stagedPoints.map((point) => point.coordinate),
  );
  const totalDistanceMetres = finalDistances.at(-1) ?? 0;

  const points: RoutePoint[] = stagedPoints.map((point, index) => ({
    coordinate: point.coordinate,
    elevationMetres: point.elevationMetres,
    distanceFromStartMetres: finalDistances[index] ?? 0,
  }));

  const legMappings: LegDistanceMapping[] = legs.map((leg, legIndex) => {
    const globalIndices = legGlobalIndices[legIndex] ?? [];
    return {
      localDistances: leg.points.map((point) => point.distanceFromStartMetres),
      globalDistances: globalIndices.map(
        (index) => finalDistances[index] ?? totalDistanceMetres,
      ),
    };
  });

  const manoeuvres: Manoeuvre[] = [];
  legs.forEach((leg, legIndex) => {
    const mapping = legMappings[legIndex];
    if (!mapping) return;
    leg.manoeuvres.forEach((manoeuvre, manoeuvreIndex) => {
      const rebased: Manoeuvre = {
        distanceFromStartMetres: mapLegDistance(
          mapping,
          manoeuvre.distanceFromStartMetres,
          totalDistanceMetres,
        ),
        type: manoeuvre.type,
        ...(manoeuvre.instruction !== undefined
          ? { instruction: manoeuvre.instruction }
          : {}),
      };
      // Every leg is itself a normalised two-waypoint PlannedRoute, so its
      // own trailing manoeuvre always decodes to canonical "finish" (ORS's
      // own arrive/goal step) and its own leading manoeuvre to "start"
      // (ORS's own depart step) — context-free, regardless of where that
      // leg sits in the overall stitched route. At an internal waypoint
      // this produces exactly the spurious pair CLAUDE.md warns about: the
      // previous leg's own "finish" immediately followed by this leg's own
      // "start", at (near enough) the same point. Collapse that specific
      // pair into a single "waypoint" manoeuvre — dropping any instruction,
      // since neither leg's own arrive/depart text ("Arrive at your
      // destination" / "Head north…") is correct mid-route; the UI derives
      // its own generic per-type label instead. The very first leg's
      // leading "start" and the very last leg's trailing "finish" are never
      // touched by this rule (nothing precedes/follows to trigger it).
      const previous = manoeuvres.at(-1);
      const isLegBoundarySeam =
        legIndex > 0 &&
        manoeuvreIndex === 0 &&
        previous?.type === "finish" &&
        rebased.type === "start" &&
        Math.abs(rebased.distanceFromStartMetres - previous.distanceFromStartMetres) <=
          MANOEUVRE_SEAM_DEDUP_TOLERANCE_METRES;
      if (previous && isLegBoundarySeam) {
        manoeuvres[manoeuvres.length - 1] = {
          distanceFromStartMetres: previous.distanceFromStartMetres,
          type: "waypoint",
        };
        return;
      }
      manoeuvres.push(rebased);
    });
  });

  const rebasedWarnings: RouteWarning[] = [];
  legs.forEach((leg, legIndex) => {
    const mapping = legMappings[legIndex];
    if (!mapping) return;
    for (const warning of leg.warnings) {
      const start = mapLegDistance(
        mapping,
        warning.startDistanceMetres,
        totalDistanceMetres,
      );
      const end = Math.max(
        start,
        mapLegDistance(mapping, warning.endDistanceMetres, totalDistanceMetres),
      );
      rebasedWarnings.push({
        ...warning,
        startDistanceMetres: start,
        endDistanceMetres: end,
      });
    }
  });
  const warnings = coalesceAdjacentWarnings(rebasedWarnings);

  const { ascentMetres, descentMetres } = analyzeElevation(points);

  const definedSurfaceSummaries: SurfaceSummary[] = [];
  let everyLegHasSurfaceSummary = true;
  for (const leg of legs) {
    if (leg.surfaceSummary) {
      definedSurfaceSummaries.push(leg.surfaceSummary);
    } else {
      everyLegHasSurfaceSummary = false;
    }
  }

  let surfaceSummary: SurfaceSummary | undefined;
  if (everyLegHasSurfaceSummary && definedSurfaceSummaries.length > 0) {
    const summed = definedSurfaceSummaries.reduce(
      (acc, summary) => ({
        pavedMetres: acc.pavedMetres + summary.pavedMetres,
        questionableMetres: acc.questionableMetres + summary.questionableMetres,
        unsuitableMetres: acc.unsuitableMetres + summary.unsuitableMetres,
        unknownMetres: acc.unknownMetres + summary.unknownMetres,
      }),
      { pavedMetres: 0, questionableMetres: 0, unsuitableMetres: 0, unknownMetres: 0 },
    );
    const summedTotal =
      summed.pavedMetres +
      summed.questionableMetres +
      summed.unsuitableMetres +
      summed.unknownMetres;
    // Any tiny difference between the legs' own reported distances and
    // their final stitched span is applied deterministically to the
    // catch-all "unknown" bucket, so the four buckets sum to the
    // stitched route's total distance rather than silently drifting.
    const residual = totalDistanceMetres - summedTotal;
    surfaceSummary = {
      ...summed,
      unknownMetres: Math.max(0, summed.unknownMetres + residual),
    };
  }

  return {
    id: metadata.id,
    name: metadata.name,
    createdAt: metadata.createdAt,
    points,
    manoeuvres,
    distanceMetres: totalDistanceMetres,
    ascentMetres,
    descentMetres,
    ...(surfaceSummary ? { surfaceSummary } : {}),
    warnings,
    source: firstLeg.source,
  };
}
