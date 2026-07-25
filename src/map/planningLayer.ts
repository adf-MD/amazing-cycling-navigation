import type { Coordinate } from "../domain/types.ts";

export interface PlanningOverlayWaypoint {
  id: string;
  coordinate: Coordinate;
}

function toGeoJsonCoordinate(coordinate: Coordinate): [number, number] {
  return [coordinate[0], coordinate[1]];
}

function waypointFeatureCollection(
  waypoints: readonly PlanningOverlayWaypoint[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: waypoints.map((waypoint) => ({
      type: "Feature",
      properties: { id: waypoint.id },
      geometry: { type: "Point", coordinates: toGeoJsonCoordinate(waypoint.coordinate) },
    })),
  };
}

/**
 * Splits Planning's waypoints into two separate FeatureCollections (the
 * selected one, and everyone else) rather than one data-driven-styled
 * layer — mirrors the existing start/finish marker precedent in
 * routeLayer.ts exactly, so mapAdapter.ts's addCircleLayer paint stays
 * plain static values, never a MapLibre expression.
 */
export function buildWaypointFeatureCollections(
  waypoints: readonly PlanningOverlayWaypoint[],
  selectedIndex: number | null,
): {
  others: GeoJSON.FeatureCollection<GeoJSON.Point>;
  selected: GeoJSON.FeatureCollection<GeoJSON.Point>;
} {
  const selectedWaypoint =
    selectedIndex !== null ? (waypoints[selectedIndex] ?? null) : null;
  const otherWaypoints = selectedWaypoint
    ? waypoints.filter((waypoint) => waypoint.id !== selectedWaypoint.id)
    : waypoints;

  return {
    others: waypointFeatureCollection(otherWaypoints),
    selected: waypointFeatureCollection(selectedWaypoint ? [selectedWaypoint] : []),
  };
}

/**
 * A straight-line preview between waypoints, before (or while) a real
 * route is calculated. Deliberately takes raw Coordinates, never
 * RoutePoints — there is no distanceFromStartMetres here, and this must
 * never be mistaken for routed geometry (see PlanningRouteState in
 * src/ui/planning, which enforces this at the type level too).
 */
export function buildUnroutedPreviewFeatureCollection(
  coordinates: readonly Coordinate[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: coordinates.map(toGeoJsonCoordinate),
        },
      },
    ],
  };
}
