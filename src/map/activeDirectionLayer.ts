import type { Coordinate, RoutePoint } from "../domain/types.ts";
import type { ClassifiedSegment } from "../navigation/gradient.ts";
import {
  clipClassifiedSegments,
  findClassifiedSegmentAtDistance,
} from "../navigation/gradient.ts";
import type { MicroDetailVisualKey } from "../navigation/routeFeaturePalette.ts";
import type { ActiveDirectionVisualKey } from "../navigation/routeFeaturePalette.ts";
import type { RouteFeature } from "../navigation/routeFeatures.ts";
import { findFeatureAtDistance } from "../navigation/routeFeatures.ts";
import { sliceRoutePointsForRange } from "../navigation/warningGeometry.ts";
import { visualKeyOf } from "./routeFeatureLayer.ts";

/**
 * How far ahead of canonical route progress the direction-aware overlay
 * reaches, measured in ROUTE distance (never screen pixels, never
 * geographic separation).
 *
 * Chosen against this project's own constants rather than as a round
 * number: it is comfortably below MIN_FEATURE_LENGTH_METRES (500 m,
 * routeFeatures.ts), so the overlay can never span an entire recognised
 * climb or descent and therefore always reads as a local emphasis rather
 * than a re-colouring of the route; and at road-bike speeds it is roughly
 * 40 seconds of riding, long enough to answer "which way am I going here?"
 * at a glance without committing a large distant portion of the map to the
 * current direction. The rendered on-screen extent of 300 m depends on the
 * follow camera's zoom, pitch and offset and is deliberately not part of
 * this definition.
 */
export const ACTIVE_DIRECTION_AHEAD_METRES = 300;

/**
 * There is deliberately NO look-back. Road behind the rider is legitimately
 * completed, and the completed/remaining split already meets the overlay
 * exactly at progress, so a look-back would both hide real progress and
 * destroy the outbound evidence that this correction is local rather than a
 * global completed/remaining layer reversal.
 */
const ACTIVE_DIRECTION_BEHIND_METRES = 0;

/** Sub-millimetre spans are numerical noise from boundary arithmetic, not
 * drawable geometry. */
const MIN_SPAN_METRES = 1e-6;

export interface ActiveDirectionSpan {
  startDistanceMetres: number;
  endDistanceMetres: number;
  visualKey: ActiveDirectionVisualKey;
  /**
   * Overlap priority within the overlay itself, bound to MapLibre's
   * `line-sort-key` layout property: higher paints above lower. Defined as
   * the negated route-distance separation between the span's start and
   * current progress, so the span nearest the rider in ROUTE order always
   * has the highest value and therefore wins wherever two spans are
   * geographically identical — which is exactly what happens when the
   * window crosses an out-and-back turnaround and contains both the
   * approach to the apex and the retrace away from it.
   */
  paintPriority: number;
}

export interface ActiveDirectionFeatureProperties {
  visualKey: ActiveDirectionVisualKey;
  paintPriority: number;
}

function toGeoJsonCoordinate(coordinate: Coordinate): [number, number] {
  return [coordinate[0], coordinate[1]];
}

/**
 * Composes the direction-aware overlay's spans for the route interval
 * [progress - behind, progress + ahead], clamped to the route.
 *
 * The composition rule reproduces EXACTLY what the existing layer stack
 * would paint for that route occurrence if nothing overlapped it: a micro
 * detail key wherever `microSegments` (the caller's already-narrowed
 * selected-or-active feature detail, the same array MapView's gradient
 * overlay receives) covers the span, otherwise the containing recognised
 * feature's own macro key, otherwise plain route. Nothing is recoloured;
 * the overlay only decides WHICH of two coincident route occurrences the
 * colour belongs to. On an unclassified route that makes every span the
 * ordinary remaining-route green, which is why the confirmed
 * completed-grey-over-remaining-green defect is fixed by a pure z-order
 * win with no colour change at all.
 *
 * A single composed layer is load-bearing rather than a convenience:
 * re-emitting the existing macro and micro collections clipped to the
 * window as two extra layers could not work, because at a turnaround the
 * farther piece may be micro while the nearer piece is macro, and
 * micro-above-macro across two layers would still let the wrong occurrence
 * win. Nearest-wins has to dominate the macro/micro nesting, and only one
 * layer can express that.
 *
 * Boundaries are resolved at span MIDPOINTS, never at endpoints: both
 * findFeatureAtDistance and findClassifiedSegmentAtDistance are inclusive
 * at both ends with first-match-wins, so evaluating exactly on a shared
 * boundary is ambiguous. Never mutates its inputs.
 */
export function buildActiveDirectionSpans({
  features,
  microSegments,
  progressDistanceMetres,
  routeLengthMetres,
}: {
  features: readonly RouteFeature[];
  microSegments: readonly ClassifiedSegment<MicroDetailVisualKey>[];
  progressDistanceMetres: number;
  routeLengthMetres: number;
}): ActiveDirectionSpan[] {
  if (!Number.isFinite(progressDistanceMetres) || routeLengthMetres <= 0) return [];

  const windowStart = Math.max(
    0,
    Math.min(progressDistanceMetres - ACTIVE_DIRECTION_BEHIND_METRES, routeLengthMetres),
  );
  const windowEnd = Math.min(
    progressDistanceMetres + ACTIVE_DIRECTION_AHEAD_METRES,
    routeLengthMetres,
  );
  if (windowEnd - windowStart <= MIN_SPAN_METRES) return [];

  const clippedMicro = clipClassifiedSegments(microSegments, windowStart, windowEnd);

  const boundaries = new Set<number>([windowStart, windowEnd]);
  function addBoundary(value: number): void {
    if (value > windowStart && value < windowEnd) boundaries.add(value);
  }
  for (const segment of clippedMicro) {
    addBoundary(segment.startDistanceMetres);
    addBoundary(segment.endDistanceMetres);
  }
  for (const feature of features) {
    addBoundary(feature.startDistanceMetres);
    addBoundary(feature.endDistanceMetres);
  }

  const ordered = [...boundaries].sort((a, b) => a - b);
  const spans: ActiveDirectionSpan[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (start === undefined || end === undefined) continue;
    if (end - start <= MIN_SPAN_METRES) continue;

    const midpoint = (start + end) / 2;
    const micro = findClassifiedSegmentAtDistance(clippedMicro, midpoint);
    const feature = micro ? null : findFeatureAtDistance(features, midpoint);
    const visualKey: ActiveDirectionVisualKey = micro
      ? micro.visualKey
      : feature
        ? visualKeyOf(feature)
        : "ordinary-route";

    const separation = Math.abs(start - progressDistanceMetres);
    const previous = spans.at(-1);
    if (previous?.visualKey === visualKey) {
      previous.endDistanceMetres = end;
      continue;
    }
    spans.push({
      startDistanceMetres: start,
      endDistanceMetres: end,
      visualKey,
      // Normalised so the nearest span's priority is +0 rather than -0:
      // numerically identical, but -0 is a needless surprise in a stamped
      // GeoJSON property and in test output.
      paintPriority: separation === 0 ? 0 : -separation,
    });
  }
  return spans;
}

/**
 * One LineString feature per span overlapping
 * [clipStartDistanceMetres, clipEndDistanceMetres], each carrying its own
 * `visualKey` and `paintPriority` properties for a single data-driven line
 * layer to colour and sort (see mapAdapter.ts's addLineLayer).
 *
 * Reuses sliceRoutePointsForRange — the same general-purpose interpolated
 * range slicer gradientRouteLayer.ts and warningLayer.ts already use — so
 * span boundaries land on exact interpolated route coordinates and adjacent
 * spans share exact seam coordinates. A span whose sliced geometry has
 * fewer than 2 points is safely omitted, mirroring those builders' own
 * identical guard.
 *
 * Features are emitted FARTHEST-first so the nearest span is last in the
 * source as well as highest by `paintPriority`. MapLibre's documented
 * contract is the sort key ("features with a higher sort key will appear
 * above features with a lower sort key"); the emission order merely agrees
 * with it rather than being relied upon.
 */
export function buildActiveDirectionFeatureCollection(
  points: readonly RoutePoint[],
  spans: readonly ActiveDirectionSpan[],
  clipStartDistanceMetres: number,
  clipEndDistanceMetres: number,
): GeoJSON.FeatureCollection<GeoJSON.LineString, ActiveDirectionFeatureProperties> {
  const clampedStart = Math.min(clipStartDistanceMetres, clipEndDistanceMetres);
  const clampedEnd = Math.max(clipStartDistanceMetres, clipEndDistanceMetres);

  const ordered = [...spans].sort((a, b) => a.paintPriority - b.paintPriority);

  const features: GeoJSON.Feature<
    GeoJSON.LineString,
    ActiveDirectionFeatureProperties
  >[] = [];
  for (const span of ordered) {
    const start = Math.max(span.startDistanceMetres, clampedStart);
    const end = Math.min(span.endDistanceMetres, clampedEnd);
    if (end <= start) continue;

    const slice = sliceRoutePointsForRange(points, start, end);
    if (slice.length < 2) continue;

    features.push({
      type: "Feature",
      properties: { visualKey: span.visualKey, paintPriority: span.paintPriority },
      geometry: {
        type: "LineString",
        coordinates: slice.map((point) => toGeoJsonCoordinate(point.coordinate)),
      },
    });
  }

  return { type: "FeatureCollection", features };
}
