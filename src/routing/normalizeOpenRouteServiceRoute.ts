import { createRouteId } from "../domain/id.ts";
import type {
  Coordinate,
  Manoeuvre,
  PlannedRoute,
  RoutePoint,
  RouteWarning,
  SurfaceSummary,
} from "../domain/types.ts";
import { normalizeGpxPoints } from "../gpx/normalizeGpx.ts";
import type { RawGpxPoint } from "../gpx/parseGpx.ts";
import { analyzeElevation } from "../navigation/elevation.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
import type { RoutingProfile } from "./provider.ts";
import { classifySurfaceCode, type SurfaceClassification } from "./surfaceCodes.ts";
import type {
  OrsExtras,
  OrsFeatureCollectionResponse,
  OrsSegment,
} from "./openRouteServiceTypes.ts";

export interface NormalizeOrsRouteOptions {
  name: string;
  createdAt: string;
  profile: RoutingProfile;
  providerId: string;
}

function buildManoeuvres(
  segments: readonly OrsSegment[] | undefined,
  points: readonly RoutePoint[],
): Manoeuvre[] {
  if (!segments) return [];
  const manoeuvres: Manoeuvre[] = [];
  for (const segment of segments) {
    for (const step of segment.steps) {
      const distanceFromStartMetres =
        points[step.way_points[0]]?.distanceFromStartMetres ?? 0;
      manoeuvres.push({
        distanceFromStartMetres,
        type: String(step.type),
        ...(step.instruction ? { instruction: step.instruction } : {}),
      });
    }
  }
  return manoeuvres;
}

const SURFACE_WARNING_MESSAGES: Record<
  "questionable-surface" | "unsuitable-surface",
  string
> = {
  "questionable-surface": "Questionable surface for a road bike.",
  "unsuitable-surface": "Unsuitable surface for a road bike.",
};

interface ClassifiedRange {
  start: number;
  end: number;
  classification: SurfaceClassification | "unknown";
}

/**
 * Builds a SurfaceSummary + inspectable RouteWarning list from ORS's
 * surface extra_info triples. Triples are sorted, coalesced when adjacent
 * ranges share a classification, and any gap (including before the first
 * triple or after the last) is filled as "unknown" — so the four buckets
 * always sum to the route's total distance, and missing data is never
 * silently treated as paved or unsuitable.
 */
function buildSurfaceSummaryAndWarnings(
  extras: OrsExtras | undefined,
  points: readonly RoutePoint[],
): { surfaceSummary: SurfaceSummary; warnings: RouteWarning[] } {
  const totalDistanceMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
  const values = extras?.surface?.values;

  if (!values || values.length === 0) {
    return {
      surfaceSummary: {
        pavedMetres: 0,
        questionableMetres: 0,
        unsuitableMetres: 0,
        unknownMetres: totalDistanceMetres,
      },
      warnings: [],
    };
  }

  const distanceAt = (pointIndex: number): number =>
    points[pointIndex]?.distanceFromStartMetres ?? totalDistanceMetres;

  const sorted = [...values].sort((a, b) => a[0] - b[0]);
  const ranges: ClassifiedRange[] = [];
  let cursor = 0;

  for (const [startIndex, endIndex, valueCode] of sorted) {
    const start = distanceAt(startIndex);
    const end = Math.max(start, distanceAt(endIndex));
    if (start > cursor) {
      ranges.push({ start: cursor, end: start, classification: "unknown" });
    }
    const classification = classifySurfaceCode(valueCode);
    const previous = ranges.at(-1);
    if (previous?.classification === classification && previous.end >= start) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end, classification });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < totalDistanceMetres) {
    ranges.push({ start: cursor, end: totalDistanceMetres, classification: "unknown" });
  }

  let pavedMetres = 0;
  let questionableMetres = 0;
  let unsuitableMetres = 0;
  let unknownMetres = 0;
  const warnings: RouteWarning[] = [];

  for (const range of ranges) {
    const length = range.end - range.start;
    if (length <= 0) continue;
    switch (range.classification) {
      case "paved":
        pavedMetres += length;
        break;
      case "questionable-surface":
        questionableMetres += length;
        warnings.push({
          kind: "questionable-surface",
          startDistanceMetres: range.start,
          endDistanceMetres: range.end,
          message: SURFACE_WARNING_MESSAGES["questionable-surface"],
        });
        break;
      case "unsuitable-surface":
        unsuitableMetres += length;
        warnings.push({
          kind: "unsuitable-surface",
          startDistanceMetres: range.start,
          endDistanceMetres: range.end,
          message: SURFACE_WARNING_MESSAGES["unsuitable-surface"],
        });
        break;
      case "unknown":
        unknownMetres += length;
        break;
    }
  }

  return {
    surfaceSummary: { pavedMetres, questionableMetres, unsuitableMetres, unknownMetres },
    warnings,
  };
}

/**
 * Normalises a raw OpenRouteService directions (geojson) response into
 * this project's provider-independent PlannedRoute. Reuses the project's
 * existing GPX-import normalisation pipeline (normalizeGpxPoints,
 * analyzeElevation) rather than reimplementing distance/ascent maths, so
 * a routed and an imported route are held to exactly the same documented
 * smoothing policy — the provider's own summary.ascent/summary.descent/
 * summary.distance are read but deliberately discarded.
 */
export function normalizeOpenRouteServiceRoute(
  response: OrsFeatureCollectionResponse,
  options: NormalizeOrsRouteOptions,
): PlannedRoute {
  const feature = response.features[0];
  if (!feature || feature.geometry.coordinates.length === 0) {
    throw new RoutingError(
      "no-geometry",
      "The routing response contained no usable route geometry.",
    );
  }

  const rawPoints: RawGpxPoint[] = feature.geometry.coordinates.map((coordinate) => ({
    coordinate: [coordinate[0] ?? 0, coordinate[1] ?? 0] as Coordinate,
    elevationMetres: coordinate.length >= 3 ? (coordinate[2] ?? null) : null,
  }));

  const { points, distanceMetres } = normalizeGpxPoints(rawPoints);
  const { ascentMetres, descentMetres } = analyzeElevation(points);
  const manoeuvres = buildManoeuvres(feature.properties.segments, points);
  const { surfaceSummary, warnings } = buildSurfaceSummaryAndWarnings(
    feature.properties.extras,
    points,
  );

  return {
    id: createRouteId(),
    name: options.name,
    createdAt: options.createdAt,
    points,
    manoeuvres,
    distanceMetres,
    ascentMetres,
    descentMetres,
    surfaceSummary,
    warnings,
    source: { kind: "planner", provider: options.providerId, profile: options.profile },
  };
}
