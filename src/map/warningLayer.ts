import type {
  Coordinate,
  RoutePoint,
  RouteWarning,
  RouteWarningKind,
} from "../domain/types.ts";
import { sliceRoutePointsForRange } from "../navigation/warningGeometry.ts";
import { computeBoundingBox, type BoundingBox } from "./routeLayer.ts";

/** Visual grouping of the 8 RouteWarningKinds into the treatments the
 * project's design calls for — access/steps/ford share one "high-contrast
 * obstacle" treatment rather than needing to be told apart from each
 * other on the map. */
export type WarningCategory =
  | "unknown-surface"
  | "questionable-surface"
  | "unsuitable-surface"
  | "obstacle"
  | "ferry"
  | "other";

/** A `Record` over the closed RouteWarningKind union, so TypeScript
 * enforces exhaustiveness — a future 9th kind fails to compile here until
 * it's given a category. */
const KIND_TO_CATEGORY: Readonly<Record<RouteWarningKind, WarningCategory>> = {
  "unknown-surface": "unknown-surface",
  "questionable-surface": "questionable-surface",
  "unsuitable-surface": "unsuitable-surface",
  access: "obstacle",
  steps: "obstacle",
  ford: "obstacle",
  ferry: "ferry",
  other: "other",
};

/** The order MapView adds each category's layer in — later entries paint
 * on top when warnings visually overlap. Obstacle (access/steps/ford) is
 * topmost: a physically blocking/dismount-required condition must never
 * be hidden under a mere surface-quality warning. */
export const WARNING_CATEGORIES_IN_PAINT_ORDER: readonly WarningCategory[] = [
  "unknown-surface",
  "other",
  "ferry",
  "questionable-surface",
  "unsuitable-surface",
  "obstacle",
];

function toGeoJsonCoordinate(coordinate: Coordinate): [number, number] {
  return [coordinate[0], coordinate[1]];
}

function emptyLineFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return { type: "FeatureCollection", features: [] };
}

/** The one safe, provider-independent identity fact stamped onto every
 * hit-testable warning feature: its index into the flat `warnings` array
 * MapView/PlanningScreen share. Stamped once, at build time, while
 * iterating that array with its own index — never reconstructed later
 * from a feature's position within its per-category bucket (not the same
 * thing, since a category groups only a subset of warnings) and never
 * derived from message text/coordinates/distance, none of which are
 * guaranteed unique. */
export interface WarningFeatureProperties {
  warningIndex: number;
}

function warningLineFeature(
  coordinates: readonly [number, number][],
  warningIndex: number,
): GeoJSON.Feature<GeoJSON.LineString, WarningFeatureProperties> {
  return {
    type: "Feature",
    properties: { warningIndex },
    geometry: { type: "LineString", coordinates: [...coordinates] },
  };
}

/**
 * Builds one FeatureCollection per visual category, each containing one
 * Feature per warning in that category (never one concatenated
 * LineString — a category can hold multiple non-adjacent warnings, e.g.
 * two separate fords, and joining their coordinates would draw a
 * spurious connecting line across the gap between them). A warning whose
 * sliced geometry has fewer than 2 points (too short to draw, or wholly
 * out of the route's bounds) is safely omitted, never rendered as a
 * degenerate single-point line.
 */
export function buildWarningFeatureCollectionsByCategory(
  points: readonly RoutePoint[],
  warnings: readonly RouteWarning[],
): Record<
  WarningCategory,
  GeoJSON.FeatureCollection<GeoJSON.LineString, WarningFeatureProperties>
> {
  const featuresByCategory: Record<
    WarningCategory,
    GeoJSON.Feature<GeoJSON.LineString, WarningFeatureProperties>[]
  > = {
    "unknown-surface": [],
    "questionable-surface": [],
    "unsuitable-surface": [],
    obstacle: [],
    ferry: [],
    other: [],
  };

  warnings.forEach((warning, warningIndex) => {
    const segment = sliceRoutePointsForRange(
      points,
      warning.startDistanceMetres,
      warning.endDistanceMetres,
    );
    if (segment.length < 2) return;
    const category = KIND_TO_CATEGORY[warning.kind];
    featuresByCategory[category].push(
      warningLineFeature(
        segment.map((point) => toGeoJsonCoordinate(point.coordinate)),
        warningIndex,
      ),
    );
  });

  return {
    "unknown-surface": {
      type: "FeatureCollection",
      features: featuresByCategory["unknown-surface"],
    },
    "questionable-surface": {
      type: "FeatureCollection",
      features: featuresByCategory["questionable-surface"],
    },
    "unsuitable-surface": {
      type: "FeatureCollection",
      features: featuresByCategory["unsuitable-surface"],
    },
    obstacle: { type: "FeatureCollection", features: featuresByCategory.obstacle },
    ferry: { type: "FeatureCollection", features: featuresByCategory.ferry },
    other: { type: "FeatureCollection", features: featuresByCategory.other },
  };
}

/** The single selected warning's own line, or an empty collection when
 * nothing is selected or the index is out of range. */
export function buildSelectedWarningFeatureCollection(
  points: readonly RoutePoint[],
  warnings: readonly RouteWarning[],
  selectedWarningIndex: number | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  if (selectedWarningIndex === null) return emptyLineFeatureCollection();
  const warning = warnings[selectedWarningIndex];
  if (!warning) return emptyLineFeatureCollection();

  const segment = sliceRoutePointsForRange(
    points,
    warning.startDistanceMetres,
    warning.endDistanceMetres,
  );
  if (segment.length < 2) return emptyLineFeatureCollection();

  return {
    type: "FeatureCollection",
    features: [
      warningLineFeature(
        segment.map((point) => toGeoJsonCoordinate(point.coordinate)),
        selectedWarningIndex,
      ),
    ],
  };
}

/** Validates a hit-tested feature's raw `warningIndex` property against
 * the exact `warnings` array MapView currently holds — the map adapter
 * has no visibility into that array, so it cannot do this itself.
 * Returns the safe integer index, or null for anything else: a missing
 * property, a non-number, a fractional or negative value, or an index
 * at/beyond `warningsLength` (a stale hit — e.g. a recalculation shrank
 * the warnings array between the feature being drawn and the tap
 * landing). Never throws. */
export function resolveWarningIndexHit(
  rawWarningIndex: unknown,
  warningsLength: number,
): number | null {
  if (typeof rawWarningIndex !== "number") return null;
  if (!Number.isInteger(rawWarningIndex)) return null;
  if (rawWarningIndex < 0 || rawWarningIndex >= warningsLength) return null;
  return rawWarningIndex;
}

/** The bounding box of the selected warning's own sliced geometry (for
 * framing it), or null when nothing is selected, the index is out of
 * range, or the geometry is too short to have a meaningful box. */
export function computeSelectedWarningBounds(
  points: readonly RoutePoint[],
  warnings: readonly RouteWarning[],
  selectedWarningIndex: number | null,
): BoundingBox | null {
  if (selectedWarningIndex === null) return null;
  const warning = warnings[selectedWarningIndex];
  if (!warning) return null;

  const segment = sliceRoutePointsForRange(
    points,
    warning.startDistanceMetres,
    warning.endDistanceMetres,
  );
  if (segment.length < 2) return null;

  return computeBoundingBox(segment.map((point) => point.coordinate));
}
