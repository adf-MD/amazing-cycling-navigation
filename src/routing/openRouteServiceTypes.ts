/**
 * Raw OpenRouteService v2 directions (geojson) request/response shapes.
 * Not an exhaustive schema — only the fields this project actually reads.
 * Never imported outside routing/ — UI and domain code only ever see the
 * normalised PlannedRoute (see normalizeOpenRouteServiceRoute.ts).
 */

export interface OrsDirectionsRequestBody {
  coordinates: readonly (readonly [number, number])[];
  elevation: boolean;
  extra_info: readonly string[];
  instructions: boolean;
  options?: { avoid_features: readonly string[] };
}

export interface OrsSummary {
  distance: number;
  duration: number;
  ascent?: number;
  descent?: number;
}

export interface OrsStep {
  distance: number;
  duration: number;
  type: number | string;
  instruction: string;
  way_points: readonly [number, number];
}

export interface OrsSegment {
  distance: number;
  duration: number;
  steps: readonly OrsStep[];
}

/** [startIndex, endIndex, valueCode] — indexes into the same geometry
 * coordinate array as the feature this extra belongs to. */
export type OrsExtraInfoTriple = readonly [
  startIndex: number,
  endIndex: number,
  valueCode: number,
];

export interface OrsExtraInfoEntry {
  values: readonly OrsExtraInfoTriple[];
}

/** The three extra_info categories this project requests and reads.
 * "roadaccessrestrictions" is deliberately absent: ORS does not document it
 * as available for the cycling-road profile, so it is never requested. */
export interface OrsExtras {
  surface?: OrsExtraInfoEntry;
  waytype?: OrsExtraInfoEntry;
  waycategory?: OrsExtraInfoEntry;
}

export interface OrsRouteProperties {
  summary: OrsSummary;
  segments?: readonly OrsSegment[];
  extras?: OrsExtras;
}

export interface OrsFeature {
  type: "Feature";
  properties: OrsRouteProperties;
  geometry: {
    type: "LineString";
    /** Each coordinate is [lon, lat] or [lon, lat, elevationMetres] — a
     * missing third element means "no elevation for this point", not an
     * error. */
    coordinates: readonly (readonly number[])[];
  };
}

export interface OrsFeatureCollectionResponse {
  type: "FeatureCollection";
  features: readonly OrsFeature[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOrsFeature(value: unknown): value is OrsFeature {
  if (!isRecord(value) || value.type !== "Feature") return false;
  if (!isRecord(value.properties) || !isRecord(value.properties.summary)) return false;
  const geometry = value.geometry;
  if (!isRecord(geometry)) return false;
  return geometry.type === "LineString" && Array.isArray(geometry.coordinates);
}

/**
 * Structural validation only — enough to safely proceed with
 * normalisation, not a full schema check. Anything that fails this is
 * reported as RoutingError("malformed-response") rather than throwing a
 * raw TypeError deep inside normalisation.
 */
export function isOrsFeatureCollection(
  value: unknown,
): value is OrsFeatureCollectionResponse {
  if (!isRecord(value) || value.type !== "FeatureCollection") return false;
  if (!Array.isArray(value.features)) return false;
  return value.features.every(isOrsFeature);
}
