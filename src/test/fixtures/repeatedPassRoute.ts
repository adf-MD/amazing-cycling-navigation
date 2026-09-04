import type { Coordinate } from "../../domain/types.ts";
import {
  buildRoutePointsFromCoordinates,
  buildRoutePointsFromWaypoints,
} from "./routeGeometry.ts";

/**
 * A route that traverses one stretch of road TWICE IN THE SAME DIRECTION —
 * out along a stem, around a small loop back to the stem's start, then out
 * along the identical stem again. Unlike outAndBackCoincidentRoute.ts's
 * fixtures, the two coincident occurrences here are parallel, not
 * antiparallel: there is no turnaround and no mirror.
 *
 * This exists because the item-104 follow-up's hold is gated purely on two
 * geometrically tied occurrences, with no antiparallel/turnaround proof of
 * any kind (measurement showed such a proof buys nothing — see that item's
 * history entry). This fixture is the case that keeps that decision
 * honest: a same-direction repeat also ties, so it must be shown that
 * ordinary forward progress across both passes is completely unaffected,
 * and that a jitter-sized regression on the shared stem resolves forward
 * within the existing epsilon rather than latching onto the wrong pass.
 *
 * The loop is deliberately SHORT relative to WINDOW_RADIUS_METRES: the two
 * occurrences of a stem point sit ~350 m apart in route distance, inside
 * the ±400 m search window, so the tie is genuinely reachable from an
 * ordinary lastMatch. A larger loop would put the second occurrence
 * outside the window and silently stop exercising anything.
 *
 * Approximate cumulative distances: stem 0–150 m, loop 150–350 m, repeated
 * stem 350–500 m. Read the fixture's own `distanceFromStartMetres` values
 * rather than assuming these.
 */
const STEM_START: Coordinate = [0, 50];
const STEM_END: Coordinate = [0.0020963, 50];
/** Off to one side of the stem, so the loop's own geometry never ties with it. */
const LOOP_APEX: Coordinate = [0.0010481, 50.000594];

/** Interpolated once and reused verbatim for both passes, so the repeated
 * stretch is byte-identical rather than merely near-identical. */
const STEM_COORDINATES: readonly Coordinate[] = buildRoutePointsFromWaypoints(
  [STEM_START, STEM_END],
  15,
).map((routePoint) => routePoint.coordinate);

const LOOP_COORDINATES: readonly Coordinate[] = buildRoutePointsFromWaypoints(
  [STEM_END, LOOP_APEX, STEM_START],
  10,
)
  .map((routePoint) => routePoint.coordinate)
  .slice(1);

export const REPEATED_PASS_ROUTE_POINTS = buildRoutePointsFromCoordinates([
  ...STEM_COORDINATES,
  ...LOOP_COORDINATES,
  ...STEM_COORDINATES.slice(1),
]);

/** Array index of the last point of the first stem pass. */
export const REPEATED_PASS_FIRST_STEM_END_INDEX = STEM_COORDINATES.length - 1;

/** Array index of the first point of the repeated (second) stem pass. */
export const REPEATED_PASS_SECOND_STEM_START_INDEX =
  STEM_COORDINATES.length + LOOP_COORDINATES.length;
