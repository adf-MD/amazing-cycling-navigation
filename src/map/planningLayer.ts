import type { Coordinate } from "../domain/types.ts";
import { haversineDistanceMetres } from "../navigation/distance.ts";
import type { MapMarkerSpec } from "./mapAdapter.ts";

export interface PlanningOverlayWaypoint {
  id: string;
  coordinate: Coordinate;
}

function toGeoJsonCoordinate(coordinate: Coordinate): [number, number] {
  return [coordinate[0], coordinate[1]];
}

/** How close a draft's first and final waypoint must be to render as one
 * combined "1/n" marker instead of two separate, likely visually
 * overlapping start/finish markers. Deliberately much smaller than, and
 * named separately from, routeLayer.ts's isLoopRoute threshold (50m,
 * calibrated for GPS-track drift on a routed result), and distinct from
 * waypointHistory.ts's exact-equality sameCoordinate (which only gates
 * the "Return to start" button's enabled state) — this is about whether
 * two deliberately-placed waypoint markers would be unreadable drawn
 * separately, which a manually-dragged near-but-not-exact coincidence
 * should still satisfy. */
const WAYPOINT_COINCIDENCE_THRESHOLD_METRES = 3;

function ordinaryMarker(
  waypoint: PlanningOverlayWaypoint,
  ordinal: number,
  selectedIndex: number | null,
  index: number,
): MapMarkerSpec {
  return {
    id: waypoint.id,
    coordinate: waypoint.coordinate,
    label: String(ordinal),
    role: "ordinary",
    selected: selectedIndex === index,
    ariaLabel: `Waypoint ${String(ordinal)}`,
  };
}

/**
 * Derives each Planning waypoint's on-map marker — ordinal, start/finish/
 * combined role, and selected state — purely from the current waypoint
 * list and selection. Never a persisted/mutable field: list order and
 * position are already authoritative (see WaypointList.tsx's identical
 * "index + 1" labelling), so undo/redo/reorder/insert/delete are reflected
 * correctly with no special-casing here. An out-of-range selectedIndex is
 * tolerated the same way it always has been (see the old
 * buildWaypointFeatureCollections): it simply never matches any waypoint,
 * so nothing is selected.
 */
export function buildWaypointMarkerSpecs(
  waypoints: readonly PlanningOverlayWaypoint[],
  selectedIndex: number | null,
): MapMarkerSpec[] {
  const first = waypoints[0];
  if (!first) return [];

  if (waypoints.length === 1) {
    return [
      {
        id: first.id,
        coordinate: first.coordinate,
        label: "1",
        role: "start",
        selected: selectedIndex === 0,
        ariaLabel: "Start waypoint 1",
      },
    ];
  }

  const lastIndex = waypoints.length - 1;
  const last = waypoints[lastIndex];
  if (!last) return [];

  const isClosedLoop =
    haversineDistanceMetres(first.coordinate, last.coordinate) <=
    WAYPOINT_COINCIDENCE_THRESHOLD_METRES;

  if (isClosedLoop) {
    const waypointCount = waypoints.length;
    const specs: MapMarkerSpec[] = [
      {
        id: first.id,
        coordinate: first.coordinate,
        label: `1/${String(waypointCount)}`,
        role: "start-finish",
        selected: selectedIndex === 0 || selectedIndex === lastIndex,
        ariaLabel: `Start and finish waypoints 1 and ${String(waypointCount)}`,
      },
    ];
    for (let index = 1; index < lastIndex; index += 1) {
      const waypoint = waypoints[index];
      if (!waypoint) continue;
      specs.push(ordinaryMarker(waypoint, index + 1, selectedIndex, index));
    }
    return specs;
  }

  return waypoints.map((waypoint, index) => {
    if (index === 0) {
      return {
        id: waypoint.id,
        coordinate: waypoint.coordinate,
        label: "1",
        role: "start",
        selected: selectedIndex === 0,
        ariaLabel: "Start waypoint 1",
      };
    }
    const ordinal = index + 1;
    if (index === lastIndex) {
      return {
        id: waypoint.id,
        coordinate: waypoint.coordinate,
        label: String(ordinal),
        role: "finish",
        selected: selectedIndex === lastIndex,
        ariaLabel: `Finish waypoint ${String(ordinal)}`,
      };
    }
    return ordinaryMarker(waypoint, ordinal, selectedIndex, index);
  });
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
