import type { Coordinate } from "../domain/types.ts";

export type OffRouteLevel = "on-route" | "possibly-off-route" | "off-route";

export type ElevationWindowMetres = 2000 | 5000 | 10000;

export interface ProjectionMatch {
  pointIndex: number;
  distanceFromStartMetres: number;
}

export interface ProjectionResult extends ProjectionMatch {
  matchedCoordinate: Coordinate;
  lateralDistanceMetres: number;
  /** True if the windowed search around the last match was untrustworthy and a whole-route search was used instead. */
  reacquired: boolean;
}
