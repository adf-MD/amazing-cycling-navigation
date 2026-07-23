import type { GeolocationFix } from "../platform/geolocation.ts";
import type { ElevationWindowMetres } from "../navigation/types.ts";
import type { RideNavigationCoreState } from "../navigation/rideNavigationCore.ts";
import { type StoredRideState } from "./db.ts";

export function toStoredRideState(
  routeId: string,
  startedAt: string,
  lastFix: GeolocationFix | null,
  core: RideNavigationCoreState,
  elevationWindowMetres: ElevationWindowMetres,
): StoredRideState {
  return {
    id: "active",
    routeId,
    startedAt,
    lastFix: lastFix
      ? {
          coordinate: lastFix.coordinate,
          accuracyMetres: lastFix.accuracyMetres,
          timestampMs: lastFix.timestampMs,
        }
      : null,
    lastMatchedPointIndex: core.lastMatch?.pointIndex ?? 0,
    matchedDistanceFromStartMetres: core.lastMatch?.distanceFromStartMetres ?? 0,
    offRouteMachineState: core.offRouteMachineState,
    elevationWindowMetres,
  };
}

export interface RestoredRideState {
  lastFix: GeolocationFix | null;
  core: RideNavigationCoreState;
  elevationWindowMetres: ElevationWindowMetres;
}

export function fromStoredRideState(stored: StoredRideState): RestoredRideState {
  return {
    lastFix: stored.lastFix
      ? {
          coordinate: stored.lastFix.coordinate,
          accuracyMetres: stored.lastFix.accuracyMetres,
          timestampMs: stored.lastFix.timestampMs,
          speedMetresPerSecond: null,
        }
      : null,
    core: {
      lastMatch: stored.lastFix
        ? {
            pointIndex: stored.lastMatchedPointIndex,
            distanceFromStartMetres: stored.matchedDistanceFromStartMetres,
          }
        : null,
      offRouteMachineState: stored.offRouteMachineState,
    },
    elevationWindowMetres: stored.elevationWindowMetres,
  };
}
