import Dexie, { type EntityTable } from "dexie";
import type { Coordinate, PlannedRoute } from "../domain/types.ts";
import type { ElevationWindowMetres, OffRouteLevel } from "../navigation/types.ts";

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
}

export class AcnDatabase extends Dexie {
  routes!: EntityTable<PlannedRoute, "id">;
  rideState!: EntityTable<StoredRideState, "id">;

  constructor(name = "amazing-cycling-navigation") {
    super(name);
    // v1: routes indexed by id (primary), name and createdAt for the
    // library list/sort; rideState has no secondary indexes, it only ever
    // holds the single "active" row.
    this.version(1).stores({
      routes: "id, name, createdAt",
      rideState: "id",
    });
  }
}

export const db = new AcnDatabase();
