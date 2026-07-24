import type { Coordinate } from "../domain/types.ts";
import type { GeolocationFix } from "../platform/geolocation.ts";
import type { ElevationWindowMetres, RideCameraMode } from "../navigation/types.ts";
import type { RideNavigationCoreState } from "../navigation/rideNavigationCore.ts";
import { type StoredRideState } from "./db.ts";

export interface StoredCameraState {
  mode: RideCameraMode;
  /** Only meaningful when mode is "free"; null otherwise. */
  coordinate: Coordinate | null;
  zoom: number | null;
}

export function toStoredRideState(
  routeId: string,
  startedAt: string,
  lastFix: GeolocationFix | null,
  core: RideNavigationCoreState,
  elevationWindowMetres: ElevationWindowMetres,
  cameraState: StoredCameraState,
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
    cameraMode: cameraState.mode,
    cameraCoordinate: cameraState.coordinate,
    cameraZoom: cameraState.zoom,
  };
}

export interface RestoredRideState {
  lastFix: GeolocationFix | null;
  core: RideNavigationCoreState;
  elevationWindowMetres: ElevationWindowMetres;
  cameraState: StoredCameraState;
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
    // Rows written before this field existed won't have it — default to
    // "overview" rather than silently assuming the rider was following.
    cameraState: {
      mode: stored.cameraMode ?? "overview",
      coordinate: stored.cameraCoordinate ?? null,
      zoom: stored.cameraZoom ?? null,
    },
  };
}
