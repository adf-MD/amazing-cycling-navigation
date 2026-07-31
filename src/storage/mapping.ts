import type { Coordinate, Waypoint } from "../domain/types.ts";
import type { GeolocationFix } from "../platform/geolocation.ts";
import type {
  ElevationViewMode,
  ElevationWindowMetres,
  RideCameraMode,
} from "../navigation/types.ts";
import type { RideNavigationCoreState } from "../navigation/rideNavigationCore.ts";
import {
  DEFAULT_ELEVATION_VIEW_MODE,
  ELEVATION_WINDOW_OPTIONS_METRES,
} from "../navigation/upcomingElevation.ts";
import { type StoredPlanningDraft, type StoredRideState } from "./db.ts";

function isElevationWindowMetres(value: number): value is ElevationWindowMetres {
  return (ELEVATION_WINDOW_OPTIONS_METRES as readonly number[]).includes(value);
}

/**
 * Resolves the stored elevation view, preferring the new tagged
 * `elevationViewMode` field. Falls back to the legacy numeric
 * `elevationWindowMetres` for rows written before `elevationViewMode`
 * existed, and to the 5 km default for anything malformed or absent —
 * never rejects a row outright.
 */
function resolveElevationViewMode(stored: StoredRideState): ElevationViewMode {
  const mode = stored.elevationViewMode;
  if (mode?.kind === "full") {
    return mode;
  }
  if (mode?.kind === "upcoming" && isElevationWindowMetres(mode.windowMetres)) {
    return mode;
  }
  if (
    stored.elevationWindowMetres !== undefined &&
    isElevationWindowMetres(stored.elevationWindowMetres)
  ) {
    return { kind: "upcoming", windowMetres: stored.elevationWindowMetres };
  }
  return DEFAULT_ELEVATION_VIEW_MODE;
}

export interface StoredCameraState {
  mode: RideCameraMode;
  /** Only meaningful when mode is "free"; null otherwise. */
  coordinate: Coordinate | null;
  zoom: number | null;
  /** Always concrete (unlike coordinate/zoom) — bearing/pitch have a
   * sensible default (0/0, north-up/top-down) even when not "free", so
   * there's no meaningful "absent" state worth representing with null. */
  bearingDegrees: number;
  pitchDegrees: number;
}

export function toStoredRideState(
  routeId: string,
  startedAt: string,
  lastFix: GeolocationFix | null,
  core: RideNavigationCoreState,
  elevationViewMode: ElevationViewMode,
  cameraState: StoredCameraState,
  wakeLockDesired: boolean,
  dismissedClimbFeatureId: string | null,
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
    elevationViewMode,
    lastReliableMatchedPointIndex: core.lastReliableMatch?.pointIndex ?? 0,
    lastReliableMatchedDistanceFromStartMetres:
      core.lastReliableMatch?.distanceFromStartMetres ?? 0,
    cameraMode: cameraState.mode,
    cameraCoordinate: cameraState.coordinate,
    cameraZoom: cameraState.zoom,
    cameraBearingDegrees: cameraState.bearingDegrees,
    cameraPitchDegrees: cameraState.pitchDegrees,
    wakeLockDesired,
    dismissedClimbFeatureId: dismissedClimbFeatureId ?? undefined,
  };
}

export interface RestoredRideState {
  lastFix: GeolocationFix | null;
  core: RideNavigationCoreState;
  elevationViewMode: ElevationViewMode;
  cameraState: StoredCameraState;
  wakeLockDesired: boolean;
  dismissedClimbFeatureId: string | null;
}

export function fromStoredRideState(stored: StoredRideState): RestoredRideState {
  const lastMatch = stored.lastFix
    ? {
        pointIndex: stored.lastMatchedPointIndex,
        distanceFromStartMetres: stored.matchedDistanceFromStartMetres,
      }
    : null;

  return {
    lastFix: stored.lastFix
      ? {
          coordinate: stored.lastFix.coordinate,
          accuracyMetres: stored.lastFix.accuracyMetres,
          timestampMs: stored.lastFix.timestampMs,
          speedMetresPerSecond: null,
          headingDegrees: null,
        }
      : null,
    core: {
      lastMatch,
      offRouteMachineState: stored.offRouteMachineState,
      // A row written before lastReliableMatched* existed has no freeze
      // history to recover — the closest honest substitute is wherever the
      // ride's ordinary matched position already restores to.
      lastReliableMatch:
        stored.lastReliableMatchedDistanceFromStartMetres !== undefined
          ? {
              pointIndex: stored.lastReliableMatchedPointIndex ?? 0,
              distanceFromStartMetres: stored.lastReliableMatchedDistanceFromStartMetres,
            }
          : lastMatch,
    },
    elevationViewMode: resolveElevationViewMode(stored),
    // Rows written before these fields existed won't have them — default
    // to "overview"/north-up/top-down rather than silently assuming the
    // rider was following or restoring an arbitrary orientation.
    cameraState: {
      mode: stored.cameraMode ?? "overview",
      coordinate: stored.cameraCoordinate ?? null,
      zoom: stored.cameraZoom ?? null,
      bearingDegrees: stored.cameraBearingDegrees ?? 0,
      pitchDegrees: stored.cameraPitchDegrees ?? 0,
    },
    // Rows written before this field existed won't have it — off is the
    // only safe default (this preference must never carry over silently).
    wakeLockDesired: stored.wakeLockDesired ?? false,
    // Rows written before this field existed won't have it — not-dismissed
    // is the only safe default, matching selectEffectiveElevationView's own
    // "no dismissal recorded" behaviour (auto-open if currently in a
    // recognised climb).
    dismissedClimbFeatureId: stored.dismissedClimbFeatureId ?? null,
  };
}

/** A Planning draft's provider-independent content — deliberately one
 * shared shape for both directions (unlike ride state's asymmetric
 * to/Restored pair), since a draft's shape is identical whether it's
 * about to be stored or was just read back. */
export interface PlanningDraftContent {
  waypoints: readonly Waypoint[];
  routeName: string;
  avoidFerries: boolean;
}

export function toStoredPlanningDraft(
  content: PlanningDraftContent,
): Omit<StoredPlanningDraft, "id" | "updatedAt"> {
  return {
    waypoints: content.waypoints,
    routeName: content.routeName,
    avoidFerries: content.avoidFerries,
  };
}

export function fromStoredPlanningDraft(
  stored: StoredPlanningDraft,
): PlanningDraftContent {
  return {
    waypoints: stored.waypoints,
    // Rows written before these fields existed won't have them — default
    // to the app's own existing defaults (PlanningScreen's initial
    // routeName/avoidFerries state), never an arbitrary blank/false.
    routeName: stored.routeName ?? "Planned route",
    avoidFerries: stored.avoidFerries ?? true,
  };
}
