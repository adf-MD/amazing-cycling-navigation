import type { Coordinate } from "../domain/types.ts";

export type OffRouteLevel = "on-route" | "possibly-off-route" | "off-route";

/** Shared with src/storage (persistence) and src/ui/riding/rideCamera.ts
 * (the state machine) — kept here, alongside OffRouteLevel, so storage
 * never has to depend on UI-layer modules for its own type vocabulary. */
export type RideCameraMode = "overview" | "following" | "free";

export type ElevationWindowMetres = 2000 | 10000;

/** The rider's selected elevation-profile view: the whole route with a
 * progress marker, or a rolling forward-looking window of a fixed size. */
export type ElevationViewMode =
  { kind: "full" } | { kind: "upcoming"; windowMetres: ElevationWindowMetres };

export interface ProjectionMatch {
  pointIndex: number;
  distanceFromStartMetres: number;
}

/**
 * Whether a projection may be adopted as the ride's route progress, or is
 * the one narrow case where it must not be (backlog item 104 follow-up).
 *
 * `tied-sub-epsilon-regression` means: this fix had more than one
 * geometrically tied occurrence (exactly overlapping route geometry, such
 * as an out-and-back turnaround's outbound and return legs), and the
 * occurrence selected by the unchanged selector sits *behind* the previous
 * match by no more than PROGRESS_EPSILON_METRES — too little for the
 * selector's own forward override to engage, and therefore not yet
 * evidence of anything. The projection itself is still completely honest:
 * its matchedCoordinate, lateralDistanceMetres and distanceFromStartMetres
 * all describe the candidate genuinely chosen for this fix, and nothing is
 * recombined from an earlier one. The label only tells the navigation core
 * to keep measuring against its existing stable anchor rather than adopt
 * this reading, so a slow rider's repeated sub-epsilon steps accumulate
 * into one comparison instead of eroding the anchor a few metres at a
 * time. See rideNavigationCore.ts's processFix, which is where the hold
 * actually happens.
 */
export type ProjectionDisposition = "resolved" | "tied-sub-epsilon-regression";

export interface ProjectionResult extends ProjectionMatch {
  matchedCoordinate: Coordinate;
  lateralDistanceMetres: number;
  /** True if the windowed search around the last match was untrustworthy and a whole-route search was used instead. */
  reacquired: boolean;
  disposition: ProjectionDisposition;
}
