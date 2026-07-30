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
import { coalesceAdjacentWarnings } from "../navigation/warningGeometry.ts";
import { decodeOrsManoeuvreType } from "./manoeuvreTypes.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
import type { RoutingProfile } from "./provider.ts";
import {
  decodeSurfaceCode,
  UNKNOWN_SURFACE,
  type DecodedSurface,
} from "./surfaceCodes.ts";
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

/** A safe upper bound on a stored manoeuvre instruction's length — plain
 * text only (React already prevents any HTML injection), this simply
 * guards against an unreasonably long provider string reaching storage or
 * the Riding UI. */
const MAX_MANOEUVRE_INSTRUCTION_LENGTH = 200;

function truncateInstruction(instruction: string): string {
  return instruction.length > MAX_MANOEUVRE_INSTRUCTION_LENGTH
    ? instruction.slice(0, MAX_MANOEUVRE_INSTRUCTION_LENGTH)
    : instruction;
}

/** Builds canonical Manoeuvre entries from ORS's own segments[].steps[].
 * A step whose way_points[0] is not a genuinely valid in-bounds index into
 * this route's own points array is dropped entirely rather than defaulted
 * to distance 0 — an invalid index carries no trustworthy position, and
 * defaulting would misplace it at the route start. Once validated, the
 * lookup itself reuses distanceAtPointIndex (the same primitive every
 * other index->distance conversion in this file uses) rather than
 * inlining a second fallback. Result is sorted by distance ascending,
 * defensively — ORS's own per-leg step order is expected to already be
 * ascending, but nothing downstream should have to re-verify that. */
function buildManoeuvres(
  segments: readonly OrsSegment[] | undefined,
  points: readonly RoutePoint[],
): Manoeuvre[] {
  if (!segments) return [];
  const totalDistanceMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
  const manoeuvres: Manoeuvre[] = [];
  for (const segment of segments) {
    for (const step of segment.steps) {
      const pointIndex = step.way_points[0];
      if (
        !Number.isInteger(pointIndex) ||
        pointIndex < 0 ||
        pointIndex >= points.length
      ) {
        continue;
      }
      const distanceFromStartMetres = distanceAtPointIndex(
        points,
        totalDistanceMetres,
        pointIndex,
      );
      manoeuvres.push({
        distanceFromStartMetres,
        type: decodeOrsManoeuvreType(step.type),
        ...(step.instruction
          ? { instruction: truncateInstruction(step.instruction) }
          : {}),
      });
    }
  }
  manoeuvres.sort((a, b) => a.distanceFromStartMetres - b.distanceFromStartMetres);
  return manoeuvres;
}

const UNKNOWN_SURFACE_MESSAGE = "Surface data is unavailable for this segment.";

const SURFACE_BASE_MESSAGES: Record<
  "questionable-surface" | "unsuitable-surface",
  string
> = {
  "questionable-surface": "Questionable surface for a road bike",
  "unsuitable-surface": "Unsuitable surface for a road bike",
};

type SurfaceWarningKind =
  "unknown-surface" | "questionable-surface" | "unsuitable-surface";

function lowercaseFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** Builds the message for a classified surface range. unknown-surface
 * keeps the exact pre-existing generic sentence — there is no specific
 * detail to add. questionable/unsuitable append the decoded surface's
 * own label, e.g. "Questionable surface for a road bike: compacted
 * gravel." */
function buildSurfaceWarningMessage(
  kind: SurfaceWarningKind,
  surface: DecodedSurface,
): string {
  if (kind === "unknown-surface") return UNKNOWN_SURFACE_MESSAGE;
  return `${SURFACE_BASE_MESSAGES[kind]}: ${lowercaseFirst(surface.label)}.`;
}

/** Appends a RouteWarning for a classified surface range, stamping the
 * decoded surface's type/label onto it (never its routing-internal
 * classification) so the rider-facing detail survives sorting,
 * coalescing and per-leg stitching downstream. */
function pushSurfaceWarning(
  warnings: RouteWarning[],
  kind: SurfaceWarningKind,
  range: { start: number; end: number },
  surface: DecodedSurface,
): void {
  warnings.push({
    kind,
    startDistanceMetres: range.start,
    endDistanceMetres: range.end,
    message: buildSurfaceWarningMessage(kind, surface),
    surface: { type: surface.type, label: surface.label },
  });
}

/** A point index's route distance, falling back to totalDistanceMetres for
 * a malformed or out-of-range index — the one safe conversion every
 * extra_info range (surface, waytype, waycategory) is built from. */
function distanceAtPointIndex(
  points: readonly RoutePoint[],
  totalDistanceMetres: number,
  pointIndex: number,
): number {
  return points[pointIndex]?.distanceFromStartMetres ?? totalDistanceMetres;
}

interface ClassifiedRange {
  start: number;
  end: number;
  surface: DecodedSurface;
}

/** Sub-metre gaps/overlaps between provider ranges are floating-point or
 * GPS-precision noise, not a genuine "unknown" stretch or a real double
 * count — absorbed via the cursor clamp below rather than surfaced. */
const GAP_TOLERANCE_METRES = 0.5;

/**
 * Builds a SurfaceSummary + inspectable RouteWarning list from ORS's
 * surface extra_info triples. Triples are sorted by start index, then
 * walked with a monotonic `cursor` (the distance already accounted for):
 * a genuine overlap between two differently-classified ranges is resolved
 * by giving precedence to whichever range's distance was already claimed
 * by an earlier-sorted range ("earlier-sorted range wins the overlap" — a
 * range can never re-claim distance already attributed to one that
 * sorted before it). A sub-metre gap between `cursor` and a new range's
 * raw start is noise rather than a genuine "unknown" stretch, and is
 * absorbed into the new range instead of spawning a spurious sliver.
 * Both rules collapse to one clamp: a new range's start is never earlier
 * than `cursor`. Any remaining gap (before the first triple, between
 * ranges, or after the last) is filled as "unknown" — so the four
 * buckets always sum to the route's total distance, and missing data is
 * never silently treated as paved or unsuitable.
 */
function buildSurfaceSummaryAndWarnings(
  extras: OrsExtras | undefined,
  points: readonly RoutePoint[],
): { surfaceSummary: SurfaceSummary; warnings: RouteWarning[] } {
  const totalDistanceMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
  const values = extras?.surface?.values;

  if (!values || values.length === 0) {
    const warnings: RouteWarning[] = [];
    if (totalDistanceMetres > 0) {
      pushSurfaceWarning(
        warnings,
        "unknown-surface",
        { start: 0, end: totalDistanceMetres },
        UNKNOWN_SURFACE,
      );
    }
    return {
      surfaceSummary: {
        pavedMetres: 0,
        questionableMetres: 0,
        unsuitableMetres: 0,
        unknownMetres: totalDistanceMetres,
      },
      warnings,
    };
  }

  const sorted = [...values].sort((a, b) => a[0] - b[0]);
  const ranges: ClassifiedRange[] = [];
  let cursor = 0;

  for (const [startIndex, endIndex, valueCode] of sorted) {
    const rawStart = distanceAtPointIndex(points, totalDistanceMetres, startIndex);
    const rawEnd = Math.max(
      rawStart,
      distanceAtPointIndex(points, totalDistanceMetres, endIndex),
    );
    const start = rawStart - cursor <= GAP_TOLERANCE_METRES ? cursor : rawStart;
    const end = Math.max(start, rawEnd);
    // Wholly covered by an earlier-sorted range (or a degenerate/
    // out-of-range index pair) — skip safely, cursor unchanged.
    if (end <= start) continue;

    if (start > cursor) {
      ranges.push({ start: cursor, end: start, surface: UNKNOWN_SURFACE });
    }
    const surface = decodeSurfaceCode(valueCode);
    const previous = ranges.at(-1);
    if (previous?.surface.type === surface.type && previous.end >= start) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end, surface });
    }
    cursor = Math.max(cursor, end);
  }
  if (totalDistanceMetres - cursor > GAP_TOLERANCE_METRES) {
    ranges.push({ start: cursor, end: totalDistanceMetres, surface: UNKNOWN_SURFACE });
  } else if (cursor < totalDistanceMetres) {
    // A trailing noise-level gap is absorbed into the last range rather
    // than spawning its own spurious sliver.
    const last = ranges.at(-1);
    if (last) {
      last.end = totalDistanceMetres;
    } else {
      ranges.push({ start: cursor, end: totalDistanceMetres, surface: UNKNOWN_SURFACE });
    }
  }

  let pavedMetres = 0;
  let questionableMetres = 0;
  let unsuitableMetres = 0;
  let unknownMetres = 0;
  const warnings: RouteWarning[] = [];

  for (const range of ranges) {
    const length = range.end - range.start;
    if (length <= 0) continue;
    switch (range.surface.classification) {
      case "paved":
        pavedMetres += length;
        break;
      case "questionable-surface":
        questionableMetres += length;
        pushSurfaceWarning(warnings, "questionable-surface", range, range.surface);
        break;
      case "unsuitable-surface":
        unsuitableMetres += length;
        pushSurfaceWarning(warnings, "unsuitable-surface", range, range.surface);
        break;
      case "unknown":
        unknownMetres += length;
        pushSurfaceWarning(warnings, "unknown-surface", range, range.surface);
        break;
    }
  }

  return {
    surfaceSummary: { pavedMetres, questionableMetres, unsuitableMetres, unknownMetres },
    warnings,
  };
}

/** Raw (pre-cursor-clamp) distance range for an extra_info point-index
 * triple, using the same safe out-of-range fallback as every other
 * index→distance conversion in this file. Returns null for a degenerate
 * (zero or negative length) range rather than a range whose end precedes
 * its start. */
function convertIndexRangeToDistanceRange(
  points: readonly RoutePoint[],
  totalDistanceMetres: number,
  startIndex: number,
  endIndex: number,
): { start: number; end: number } | null {
  const start = distanceAtPointIndex(points, totalDistanceMetres, startIndex);
  const end = Math.max(
    start,
    distanceAtPointIndex(points, totalDistanceMetres, endIndex),
  );
  return end > start ? { start, end } : null;
}

// ORS waytype codes this project acts on — see
// https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/waytype
const WAYTYPE_STEPS = 8;
const WAYTYPE_FERRY = 9;
const WAYTYPE_CONSTRUCTION = 10;

// ORS waycategory is a bit field — see
// https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/waycategory
const WAYCATEGORY_BIT_STEPS = 4;
const WAYCATEGORY_BIT_FERRY = 8;
const WAYCATEGORY_BIT_FORD = 16;

const STRUCTURAL_WARNING_MESSAGES: Record<"steps" | "ferry" | "ford" | "other", string> =
  {
    steps: "Route includes steps.",
    ferry: "Route includes a ferry.",
    ford: "Route includes a ford.",
    other: "Route includes a construction-designated way.",
  };

type StructuralWarningKind = keyof typeof STRUCTURAL_WARNING_MESSAGES;

function pushStructuralWarning(
  warnings: RouteWarning[],
  kind: StructuralWarningKind,
  range: { start: number; end: number },
): void {
  warnings.push({
    kind,
    startDistanceMetres: range.start,
    endDistanceMetres: range.end,
    message: STRUCTURAL_WARNING_MESSAGES[kind],
  });
}

/**
 * Normalises ORS's waytype/waycategory extra_info into steps/ferry/ford/
 * other (construction) warnings. These describe evidence the provider
 * returned for this route, not a live/current-conditions claim and not a
 * legal-access claim — roadaccessrestrictions is not available for
 * cycling-road, so no access warning is ever produced here. A composite
 * waycategory bit field can legitimately yield more than one warning for
 * the same range; duplicate observations of the same hazard from waytype
 * and waycategory are merged via coalesceAdjacentWarnings.
 */
function buildStructuralWarnings(
  extras: OrsExtras | undefined,
  points: readonly RoutePoint[],
): RouteWarning[] {
  const totalDistanceMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
  const warnings: RouteWarning[] = [];

  for (const [startIndex, endIndex, rawValue] of extras?.waytype?.values ?? []) {
    if (!Number.isInteger(rawValue)) continue;
    const range = convertIndexRangeToDistanceRange(
      points,
      totalDistanceMetres,
      startIndex,
      endIndex,
    );
    if (!range) continue;
    if (rawValue === WAYTYPE_STEPS) pushStructuralWarning(warnings, "steps", range);
    else if (rawValue === WAYTYPE_FERRY) pushStructuralWarning(warnings, "ferry", range);
    else if (rawValue === WAYTYPE_CONSTRUCTION)
      pushStructuralWarning(warnings, "other", range);
  }

  for (const [startIndex, endIndex, rawValue] of extras?.waycategory?.values ?? []) {
    if (!Number.isInteger(rawValue) || rawValue === 0) continue;
    const range = convertIndexRangeToDistanceRange(
      points,
      totalDistanceMetres,
      startIndex,
      endIndex,
    );
    if (!range) continue;
    if ((rawValue & WAYCATEGORY_BIT_STEPS) !== 0)
      pushStructuralWarning(warnings, "steps", range);
    if ((rawValue & WAYCATEGORY_BIT_FERRY) !== 0)
      pushStructuralWarning(warnings, "ferry", range);
    if ((rawValue & WAYCATEGORY_BIT_FORD) !== 0)
      pushStructuralWarning(warnings, "ford", range);
  }

  return coalesceAdjacentWarnings(warnings);
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
    throw new RoutingError({
      reason: "no-geometry",
      message: "The routing response contained no usable route geometry.",
    });
  }

  const rawPoints: RawGpxPoint[] = feature.geometry.coordinates.map((coordinate) => ({
    coordinate: [coordinate[0] ?? 0, coordinate[1] ?? 0] as Coordinate,
    elevationMetres: coordinate.length >= 3 ? (coordinate[2] ?? null) : null,
  }));

  const { points, distanceMetres } = normalizeGpxPoints(rawPoints);
  const { ascentMetres, descentMetres } = analyzeElevation(points);
  const manoeuvres = buildManoeuvres(feature.properties.segments, points);
  const { surfaceSummary, warnings: surfaceWarnings } = buildSurfaceSummaryAndWarnings(
    feature.properties.extras,
    points,
  );
  const structuralWarnings = buildStructuralWarnings(feature.properties.extras, points);
  const warnings = [...surfaceWarnings, ...structuralWarnings].sort(
    (a, b) => a.startDistanceMetres - b.startDistanceMetres,
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
