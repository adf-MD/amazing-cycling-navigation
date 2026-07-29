import type { Coordinate, RoutePoint } from "../domain/types.ts";
import type { GradientClass, GradientSegment } from "../navigation/gradient.ts";
import { sliceRoutePointsForRange } from "../navigation/warningGeometry.ts";

/** The one project-owned property stamped onto every gradient feature —
 * consumed by mapAdapter.ts's DataDrivenLineColor `match` expression to
 * pick each feature's paint colour. */
export interface GradientFeatureProperties {
  gradientClass: GradientClass;
}

function toGeoJsonCoordinate(coordinate: Coordinate): [number, number] {
  return [coordinate[0], coordinate[1]];
}

/**
 * Builds one LineString feature per gradient segment overlapping
 * [clipStartDistanceMetres, clipEndDistanceMetres], each carrying its own
 * `gradientClass` property for a single data-driven line layer to colour
 * (see mapAdapter.ts's addLineLayer) — avoiding both a `lineMetrics`
 * continuous gradient and one MapLibre layer per class. Reuses
 * sliceRoutePointsForRange (navigation/warningGeometry.ts), the same
 * general-purpose interpolated-range-slicer warningLayer.ts already uses,
 * so segment boundaries land on exact, interpolated route coordinates and
 * adjacent features share exact seam coordinates — never routeLayer.ts's
 * splitRouteAtDistance, which is a special-purpose two-way splitter built
 * for the completed/remaining route line, not a many-way slice. A segment
 * whose sliced geometry has fewer than 2 points (clipped to nothing, or
 * wholly out of range) is safely omitted, mirroring
 * buildWarningFeatureCollectionsByCategory's own identical guard. Never
 * mutates `points` or `segments`.
 */
export function buildGradientFeatureCollection(
  points: readonly RoutePoint[],
  segments: readonly GradientSegment[],
  clipStartDistanceMetres: number,
  clipEndDistanceMetres: number,
): GeoJSON.FeatureCollection<GeoJSON.LineString, GradientFeatureProperties> {
  const clampedStart = Math.min(clipStartDistanceMetres, clipEndDistanceMetres);
  const clampedEnd = Math.max(clipStartDistanceMetres, clipEndDistanceMetres);

  const features: GeoJSON.Feature<GeoJSON.LineString, GradientFeatureProperties>[] = [];
  for (const segment of segments) {
    const start = Math.max(segment.startDistanceMetres, clampedStart);
    const end = Math.min(segment.endDistanceMetres, clampedEnd);
    if (end <= start) continue;

    const slice = sliceRoutePointsForRange(points, start, end);
    if (slice.length < 2) continue;

    features.push({
      type: "Feature",
      properties: { gradientClass: segment.classification },
      geometry: {
        type: "LineString",
        coordinates: slice.map((point) => toGeoJsonCoordinate(point.coordinate)),
      },
    });
  }

  return { type: "FeatureCollection", features };
}
