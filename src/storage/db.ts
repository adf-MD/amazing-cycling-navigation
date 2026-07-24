import Dexie, { type EntityTable } from "dexie";
import type { Coordinate, PlannedRoute } from "../domain/types.ts";
import type {
  ElevationWindowMetres,
  OffRouteLevel,
  RideCameraMode,
} from "../navigation/types.ts";

export interface StoredGpsFix {
  coordinate: Coordinate;
  accuracyMetres: number;
  timestampMs: number;
}

export interface StoredOffRouteMachineState {
  level: OffRouteLevel;
  candidateLevel: OffRouteLevel | null;
  streak: number;
}

/**
 * Singleton row (id is always "active"): the one currently-active ride, if
 * any. Enough to resume a ride immediately after reload/pageshow/hidden
 * without re-deriving progress from scratch.
 */
export interface StoredRideState {
  id: "active";
  routeId: string;
  startedAt: string;
  lastFix: StoredGpsFix | null;
  lastMatchedPointIndex: number;
  matchedDistanceFromStartMetres: number;
  offRouteMachineState: StoredOffRouteMachineState;
  elevationWindowMetres: ElevationWindowMetres;
  /** The riding camera mode at the time this was written. Optional
   * because rows written before this field existed won't have it —
   * src/storage/mapping.ts's fromStoredRideState defaults a missing
   * value to "overview" rather than rejecting the row. Not indexed, so
   * adding it doesn't need a schema version bump (see the version(1)
   * comment below). */
  cameraMode?: RideCameraMode;
  /** Only meaningful (non-null) when cameraMode is "free" — the rider's
   * manually chosen camera position/zoom, restored on resume so a
   * suspended ride doesn't silently snap back to "following". */
  cameraCoordinate?: Coordinate | null;
  cameraZoom?: number | null;
}

export class AcnDatabase extends Dexie {
  routes!: EntityTable<PlannedRoute, "id">;
  rideState!: EntityTable<StoredRideState, "id">;

  constructor(name = "amazing-cycling-navigation") {
    super(name);
    // v1: routes indexed by id (primary), name and createdAt for the
    // library list/sort; rideState has no secondary indexes, it only ever
    // holds the single "active" row. The cameraMode/cameraCoordinate/
    // cameraZoom fields added later are plain (non-indexed) data fields —
    // Dexie's version/stores() declaration only lists indexes, so adding
    // them doesn't require a version bump; old rows simply lack them,
    // handled by explicit defaulting in mapping.ts.
    this.version(1).stores({
      routes: "id, name, createdAt",
      rideState: "id",
    });
  }
}

export const db = new AcnDatabase();
