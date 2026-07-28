import type { Coordinate } from "../domain/types.ts";

export type OffRouteLevel = "on-route" | "possibly-off-route" | "off-route";

/** Shared with src/storage (persistence) and src/ui/riding/rideCamera.ts
 * (the state machine) — kept here, alongside OffRouteLevel, so storage
 * never has to depend on UI-layer modules for its own type vocabulary. */
export type RideCameraMode = "overview" | "following" | "free";

export type ElevationWindowMetres = 2000 | 5000 | 10000;

/** The rider's selected elevation-profile view: the whole route with a
 * progress marker, or a rolling forward-looking window of a fixed size. */
export type ElevationViewMode =
  { kind: "full" } | { kind: "upcoming"; windowMetres: ElevationWindowMetres };

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
