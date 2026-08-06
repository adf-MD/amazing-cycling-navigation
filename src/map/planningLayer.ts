import type { Coordinate } from "../domain/types.ts";
import { haversineDistanceMetres } from "../navigation/distance.ts";
import type { MapMarkerSpec, WaypointRole } from "./mapAdapter.ts";

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
 * should still satisfy. Sole usage site is deriveWaypointRoles below. */
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
 * Derives each waypoint's role — ordinary/start/finish/combined
 * start-finish for a closed loop — purely from position, index-aligned
 * with the input coordinates. Shared by buildWaypointMarkerSpecs (the
 * map marker, below) and WaypointList (the Planning list's ordinal
 * badge, via PlanningScreen.tsx) so both surfaces are provably driven by
 * one derivation, never two hand-synced guesses from index === 0 /
 * index === last. Unlike buildWaypointMarkerSpecs's own marker output, a
 * closed loop's first AND last coordinate both get their own
 * "start-finish" entry here — never collapsed into one — because the
 * list keeps two separate rows with their own individual ordinal
 * numbers, sharing only the visual role. A lone waypoint is "start",
 * never "start-finish": there is no second endpoint to combine with,
 * matching buildWaypointMarkerSpecs's own existing single-waypoint
 * special case.
 */
export function deriveWaypointRoles(coordinates: readonly Coordinate[]): WaypointRole[] {
  const count = coordinates.length;
  if (count === 0) return [];
  if (count === 1) return ["start"];

  const lastIndex = count - 1;
  const first = coordinates[0];
  const last = coordinates[lastIndex];
  // Both indices are always in range once count >= 2 — this guard exists
  // only to satisfy noUncheckedIndexedAccess.
  const isClosedLoop =
    !!first &&
    !!last &&
    haversineDistanceMetres(first, last) <= WAYPOINT_COINCIDENCE_THRESHOLD_METRES;

  return coordinates.map((_coordinate, index) => {
    if (isClosedLoop && (index === 0 || index === lastIndex)) return "start-finish";
    if (index === 0) return "start";
    if (index === lastIndex) return "finish";
    return "ordinary";
  });
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

  // Shared derivation with WaypointList's own role badges — see
  // deriveWaypointRoles's own doc comment.
  const roles = deriveWaypointRoles(waypoints.map((waypoint) => waypoint.coordinate));
  const isClosedLoop = roles[0] === "start-finish";

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
    const role = roles[index];
    if (role === "start") {
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
    if (role === "finish") {
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
