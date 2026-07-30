import type { Coordinate, RoutePoint } from "../domain/types.ts";
import type { RouteFeature } from "../navigation/routeFeatures.ts";
import type { RouteFeatureVisualKey } from "../navigation/routeFeaturePalette.ts";
import { sliceRoutePointsForRange } from "../navigation/warningGeometry.ts";

/** The properties stamped onto every macro route-feature line feature —
 * `visualKey` drives mapAdapter.ts's DataDrivenLineColor `match`
 * expression (see routeFeaturePalette.ts's ROUTE_FEATURE_COLOURS);
 * `routeFeatureId` is read back on a map tap to resolve which feature was
 * hit (see resolveRouteFeatureIdHit below). */
export interface RouteFeatureProperties {
  routeFeatureId: string;
  visualKey: RouteFeatureVisualKey;
}

function toGeoJsonCoordinate(coordinate: Coordinate): [number, number] {
  return [coordinate[0], coordinate[1]];
}

function visualKeyOf(feature: RouteFeature): RouteFeatureVisualKey {
  return feature.kind === "climb" ? feature.category : feature.band;
}

function emptyRouteFeatureCollection(): GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  RouteFeatureProperties
> {
  return { type: "FeatureCollection", features: [] };
}

/**
 * Builds one LineString feature per recognised climb/descent overlapping
 * [clipStartDistanceMetres, clipEndDistanceMetres] — the macro layer's
 * source data. Mirrors gradientRouteLayer.ts's buildGradientFeatureCollection
 * exactly (same clip-intersect-then-slice approach, same
 * sliceRoutePointsForRange reuse, same <2-point-slice skip guard), since
 * this is structurally the same problem (turn a set of distance ranges
 * into rendered line features) applied to a sparse feature list instead
 * of an exhaustive segment list. Never mutates `points` or `features`.
 */
export function buildRouteFeatureFeatureCollection(
  points: readonly RoutePoint[],
  features: readonly RouteFeature[],
  clipStartDistanceMetres: number,
  clipEndDistanceMetres: number,
): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProperties> {
  const clampedStart = Math.min(clipStartDistanceMetres, clipEndDistanceMetres);
  const clampedEnd = Math.max(clipStartDistanceMetres, clipEndDistanceMetres);

  const geoJsonFeatures: GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProperties>[] =
    [];
  for (const feature of features) {
    const start = Math.max(feature.startDistanceMetres, clampedStart);
    const end = Math.min(feature.endDistanceMetres, clampedEnd);
    if (end <= start) continue;

    const slice = sliceRoutePointsForRange(points, start, end);
    if (slice.length < 2) continue;

    geoJsonFeatures.push({
      type: "Feature",
      properties: { routeFeatureId: feature.id, visualKey: visualKeyOf(feature) },
      geometry: {
        type: "LineString",
        coordinates: slice.map((point) => toGeoJsonCoordinate(point.coordinate)),
      },
    });
  }

  return { type: "FeatureCollection", features: geoJsonFeatures };
}

/** The single selected route feature's own complete line (never clipped
 * to the remaining portion — a selection halo should frame the whole
 * feature, matching buildSelectedWarningFeatureCollection's own
 * behaviour), or an empty collection when nothing is selected or the id
 * no longer matches any current feature (e.g. a stale selection after a
 * route change). */
export function buildSelectedRouteFeatureFeatureCollection(
  points: readonly RoutePoint[],
  features: readonly RouteFeature[],
  selectedFeatureId: string | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProperties> {
  if (selectedFeatureId === null) return emptyRouteFeatureCollection();
  const feature = features.find((candidate) => candidate.id === selectedFeatureId);
  if (!feature) return emptyRouteFeatureCollection();

  const slice = sliceRoutePointsForRange(
    points,
    feature.startDistanceMetres,
    feature.endDistanceMetres,
  );
  if (slice.length < 2) return emptyRouteFeatureCollection();

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { routeFeatureId: feature.id, visualKey: visualKeyOf(feature) },
        geometry: {
          type: "LineString",
          coordinates: slice.map((point) => toGeoJsonCoordinate(point.coordinate)),
        },
      },
    ],
  };
}

/** Validates a hit-tested feature's raw `routeFeatureId` property against
 * the exact `features` array the caller currently holds — the map
 * adapter has no visibility into that array, so it cannot do this
 * itself. Returns the id string, or null for anything else: a missing
 * property, a non-string, or an id that doesn't match any current
 * feature (a stale hit, e.g. a recalculation changed the feature list
 * between the feature being drawn and the tap landing). Never throws. */
export function resolveRouteFeatureIdHit(
  rawRouteFeatureId: unknown,
  features: readonly RouteFeature[],
): string | null {
  if (typeof rawRouteFeatureId !== "string") return null;
  const match = features.find((feature) => feature.id === rawRouteFeatureId);
  return match ? match.id : null;
}
