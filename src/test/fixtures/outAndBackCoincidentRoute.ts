import type { Coordinate } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "./routeGeometry.ts";

/**
 * An out-and-back route whose return leg is an EXACT geometric retrace of
 * the outbound leg (identical coordinates, reversed order) — unlike
 * outAndBackRoute.ts's return leg, which is deliberately offset ~11 m in
 * latitude so the two legs are never tied. Regression fixture for backlog
 * item 104: a real iPhone field defect where, near the interior
 * turnaround, an exactly-tied lateral distance between the outbound and
 * return occurrences of the same physical point was resolved solely by
 * @turf/nearest-point-on-line's own internal, undocumented first-wins
 * tie-break, so canonical route-distance progress never reliably advanced
 * onto the return leg as the rider rode home.
 *
 * Moderately densely sampled (~14 m point spacing) and long enough
 * (~2099 m per leg, ~4199 m total) that a WINDOW_RADIUS_METRES (400 m)
 * window centred anywhere within ~400 m of the turnaround is populated
 * with real points on both legs without ever reaching this fixture's own
 * start/finish array edges.
 */
const OUT_AND_BACK_COINCIDENT_WAYPOINTS: readonly Coordinate[] = [
  [0.0, 51.0],
  [0.03, 51.0],
  [0.0, 51.0],
];

export const OUT_AND_BACK_COINCIDENT_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  OUT_AND_BACK_COINCIDENT_WAYPOINTS,
  150,
);

/** The turnaround is the shared middle waypoint — array index 150 into the
 * 301-point route (indices 0..300). */
export const OUT_AND_BACK_COINCIDENT_TURNAROUND_INDEX = 150;

/**
 * Longitude offset (degrees, relative to the fixture's own start) for a
 * given along-line distance (metres) at latitude 51 — the inverse of the
 * equirectangular approximation cumulativeDistancesMetres effectively
 * reduces to on a constant-latitude line. Used only to place this
 * fixture's own hand-picked, irregularly-spaced waypoints at approximate
 * target distances; tests must read the fixture's own computed
 * `distanceFromStartMetres` values rather than assuming these targets are
 * hit exactly, since the real haversine formula (not this approximation)
 * is what actually produces them.
 */
const METRES_PER_DEGREE_LONGITUDE_AT_51 = 111_320 * Math.cos((51 * Math.PI) / 180);

function lonOffsetForMetres(distanceMetres: number): number {
  return distanceMetres / METRES_PER_DEGREE_LONGITUDE_AT_51;
}

/**
 * A second, deliberately SPARSE and IRREGULARLY spaced coincident
 * out-and-back, built with stepsPerSegment = 1 (so every waypoint is a
 * route point with no interpolation in between, giving exact control over
 * vertex placement) — unlike the moderately-dense fixture above, this one
 * is what backlog item 104's vertex-quantisation and split-point
 * counter-examples were worked out against: irregular outbound segment
 * lengths of roughly 320/440/670/350/270/50 m, ending in a short ~50 m
 * final segment leading into the turnaround (deliberately short, so a
 * lastMatch positioned anywhere within it sits close to the crossover),
 * mirrored exactly (reversed) on the return leg. Approximate target
 * cumulative distances: 0, 320, 760, 1430, 1780, 2050, 2100 (turnaround),
 * 2150, 2420, 2770, 3440, 3880, 4200 — read the fixture's own
 * `distanceFromStartMetres` values rather than assuming these exact
 * numbers.
 */
const SPARSE_OUTBOUND_TARGET_DISTANCES_METRES = [0, 320, 760, 1430, 1780, 2050, 2100];

const SPARSE_OUTBOUND_WAYPOINTS: readonly Coordinate[] =
  SPARSE_OUTBOUND_TARGET_DISTANCES_METRES.map((distanceMetres): Coordinate => [
    lonOffsetForMetres(distanceMetres),
    51.0,
  ]);

const SPARSE_RETURN_WAYPOINTS: readonly Coordinate[] = [
  ...SPARSE_OUTBOUND_WAYPOINTS.slice(0, -1),
]
  .reverse()
  .map((coordinate) => coordinate);

const OUT_AND_BACK_COINCIDENT_SPARSE_WAYPOINTS: readonly Coordinate[] = [
  ...SPARSE_OUTBOUND_WAYPOINTS,
  ...SPARSE_RETURN_WAYPOINTS,
];

export const OUT_AND_BACK_COINCIDENT_SPARSE_ROUTE_POINTS = buildRoutePointsFromWaypoints(
  OUT_AND_BACK_COINCIDENT_SPARSE_WAYPOINTS,
  1,
);

/** The turnaround is waypoint index 6 (the 7th entry, target ~2100 m) —
 * array index 6 into the 13-point sparse route (indices 0..12), since
 * stepsPerSegment = 1 means one route point per waypoint. */
export const OUT_AND_BACK_COINCIDENT_SPARSE_TURNAROUND_INDEX = 6;
