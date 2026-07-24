import type { Coordinate, RoutePoint } from "../domain/types.ts";

/** Half-width window (behind + ahead) used to sample the route's tangent
 * direction around the rider's matched distance, rather than trusting the
 * direction of one potentially noisy GPX segment. */
export const ROUTE_TANGENT_WINDOW_METRES = 30;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Wraps any finite bearing into the canonical [0, 360) range. */
export function normaliseBearingDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Initial (forward) geographic bearing from `from` to `to`, in degrees,
 * normalised into [0, 360). Standard atan2-based forward-azimuth formula.
 */
export function geographicBearingDegrees(from: Coordinate, to: Coordinate): number {
  const [lon1, lat1] = from;
  const [lon2, lat2] = to;
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);
  const deltaLonRad = toRadians(lon2 - lon1);

  const y = Math.sin(deltaLonRad) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLonRad);

  return normaliseBearingDegrees(toDegrees(Math.atan2(y, x)));
}

/**
 * Signed shortest rotation from `fromDegrees` to `toDegrees`, in the range
 * [-180, 180). E.g. shortestAngularDifferenceDegrees(359, 1) === 2, not
 * -358 — this is what makes the 0°/360° boundary harmless everywhere it's
 * used (dead-band comparisons, route-tangent forward/reverse selection).
 */
export function shortestAngularDifferenceDegrees(
  fromDegrees: number,
  toDegrees: number,
): number {
  const raw = normaliseBearingDegrees(toDegrees) - normaliseBearingDegrees(fromDegrees);
  return ((((raw + 180) % 360) + 360) % 360) - 180;
}

/**
 * The coordinate at `distanceMetres` along the route, linearly interpolated
 * between the bracketing points and clamped to the route's start/end.
 * Returns null only when there's no geometry at all.
 */
function coordinateAtDistanceMetres(
  points: readonly RoutePoint[],
  distanceMetres: number,
): Coordinate | null {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;

  const clamped = Math.min(
    Math.max(distanceMetres, first.distanceFromStartMetres),
    last.distanceFromStartMetres,
  );

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    if (clamped >= a.distanceFromStartMetres && clamped <= b.distanceFromStartMetres) {
      const span = b.distanceFromStartMetres - a.distanceFromStartMetres;
      const t = span === 0 ? 0 : (clamped - a.distanceFromStartMetres) / span;
      return [
        a.coordinate[0] + t * (b.coordinate[0] - a.coordinate[0]),
        a.coordinate[1] + t * (b.coordinate[1] - a.coordinate[1]),
      ];
    }
  }

  return last.coordinate;
}

/**
 * A stable direction-of-travel bearing derived from the route's own
 * geometry around the rider's matched distance — a short window rather
 * than one GPX segment, so a single noisy/short segment can't swing the
 * camera. Returns null when there's insufficient geometry (fewer than 2
 * points) or the sampled window is degenerate (e.g. an extremely short
 * route where both ends of the window clamp to the same point).
 */
export function routeTangentBearingDegrees(
  points: readonly RoutePoint[],
  matchedDistanceFromStartMetres: number,
  windowMetres: number = ROUTE_TANGENT_WINDOW_METRES,
): number | null {
  if (points.length < 2) return null;

  const half = windowMetres / 2;
  const behind = coordinateAtDistanceMetres(
    points,
    matchedDistanceFromStartMetres - half,
  );
  const ahead = coordinateAtDistanceMetres(points, matchedDistanceFromStartMetres + half);
  if (!behind || !ahead) return null;
  if (behind[0] === ahead[0] && behind[1] === ahead[1]) return null;

  return geographicBearingDegrees(behind, ahead);
}
