import { createRouteId } from "../domain/id.ts";
import type {
  Manoeuvre,
  ManoeuvreProvenance,
  PlannedRoute,
  RoutePoint,
} from "../domain/types.ts";
import { cumulativeDistancesMetres } from "../navigation/distance.ts";
import { analyzeElevation } from "../navigation/elevation.ts";
import type { RawGpxPoint } from "./parseGpx.ts";

export interface NormalizeGpxOptions {
  name: string;
  createdAt: string;
}

/** A validated ACN GPX navigation extension's manoeuvres, with the
 * provenance to stamp on the resulting route. Passed only when
 * readAcnNavigationExtension accepted the file's extension. */
export interface TrustedGpxManoeuvres {
  manoeuvres: Manoeuvre[];
  provenance: ManoeuvreProvenance;
}

export interface NormalizedGpxPoints {
  points: RoutePoint[];
  distanceMetres: number;
}

export function normalizeGpxPoints(
  rawPoints: readonly RawGpxPoint[],
): NormalizedGpxPoints {
  const coordinates = rawPoints.map((point) => point.coordinate);
  const cumulative = cumulativeDistancesMetres(coordinates);

  const points: RoutePoint[] = rawPoints.map((point, index) => ({
    coordinate: point.coordinate,
    elevationMetres: point.elevationMetres,
    distanceFromStartMetres: cumulative[index] ?? 0,
  }));

  return { points, distanceMetres: cumulative.at(-1) ?? 0 };
}

export function buildPlannedRouteFromGpx(
  rawPoints: readonly RawGpxPoint[],
  options: NormalizeGpxOptions,
  trustedManoeuvres?: TrustedGpxManoeuvres,
): PlannedRoute {
  const { points, distanceMetres } = normalizeGpxPoints(rawPoints);
  const { ascentMetres, descentMetres } = analyzeElevation(points);

  return {
    id: createRouteId(),
    name: options.name,
    createdAt: options.createdAt,
    points,
    manoeuvres: trustedManoeuvres?.manoeuvres ?? [],
    ...(trustedManoeuvres ? { manoeuvreProvenance: trustedManoeuvres.provenance } : {}),
    distanceMetres,
    ascentMetres,
    descentMetres,
    warnings: [],
    source: { kind: "gpx-import" },
  };
}
