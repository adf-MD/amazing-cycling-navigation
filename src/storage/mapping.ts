import type { Coordinate, RoutingProfile, Waypoint } from "../domain/types.ts";
import { DEFAULT_ROUTING_PROFILE, isRoutingProfile } from "../domain/routingProfile.ts";
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
import {
  type StoredPlanningDraft,
  type StoredPlanningPreferences,
  type StoredRideState,
  type StoredRouteLibraryPreferences,
} from "./db.ts";

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

/** The origin of the waypoints an "Edit copy in Planning" draft was seeded
 * with — see domain/editableWaypoints.ts's EditableWaypointsResult.origin,
 * which this mirrors exactly for storage. */
export type EditCopyWaypointsOrigin = "exact" | "derived";

function isEditCopyWaypointsOrigin(value: unknown): value is EditCopyWaypointsOrigin {
  return value === "exact" || value === "derived";
}

/** Which "editable copy" operation seeded a Planning draft — "forward"
 * (Edit copy in Planning) or "reverse" (Reverse route). See
 * StoredPlanningDraft.editCopyOperation's own doc comment for the
 * compatibility rationale. */
export type EditCopyOperation = "forward" | "reverse";

function isEditCopyOperation(value: unknown): value is EditCopyOperation {
  return value === "forward" || value === "reverse";
}

/** A Planning draft's provider-independent content — deliberately one
 * shared shape for both directions (unlike ride state's asymmetric
 * to/Restored pair), since a draft's shape is identical whether it's
 * about to be stored or was just read back. */
export interface PlanningDraftContent {
  waypoints: readonly Waypoint[];
  routeName: string;
  avoidFerries: boolean;
  profile: RoutingProfile;
  /** Set together, or neither set at all — present only when this draft
   * was created via "Edit copy in Planning" (see RidingScreen.tsx). Purely
   * informational: drives PlanningScreen's read-only notice, never gates
   * Save/Export or routing behaviour. */
  editCopySourceRouteId?: string;
  editCopyWaypointsOrigin?: EditCopyWaypointsOrigin;
  editCopyOperation?: EditCopyOperation;
}

export function toStoredPlanningDraft(
  content: PlanningDraftContent,
): Omit<StoredPlanningDraft, "id" | "updatedAt"> {
  return {
    waypoints: content.waypoints,
    routeName: content.routeName,
    avoidFerries: content.avoidFerries,
    profile: content.profile,
    // Spread conditionally, never writing a literal `undefined` — mirrors
    // exportGpx.ts's own convention for optional attributes/fields.
    ...(content.editCopySourceRouteId !== undefined
      ? { editCopySourceRouteId: content.editCopySourceRouteId }
      : {}),
    ...(content.editCopyWaypointsOrigin !== undefined
      ? { editCopyWaypointsOrigin: content.editCopyWaypointsOrigin }
      : {}),
    ...(content.editCopyOperation !== undefined
      ? { editCopyOperation: content.editCopyOperation }
      : {}),
  };
}

export function fromStoredPlanningDraft(
  stored: StoredPlanningDraft,
): PlanningDraftContent {
  return {
    waypoints: stored.waypoints,
    // Rows written before these fields existed won't have them — default
    // to the app's own existing defaults (PlanningScreen's initial
    // routeName/avoidFerries/profile state), never an arbitrary blank/
    // false/unvalidated value.
    routeName: stored.routeName ?? "Planned route",
    avoidFerries: stored.avoidFerries ?? true,
    // A real validity check, not a bare `??` — a corrupt or future-
    // unknown stored string must never flow through to the routing
    // adapter, so it recovers to the app's original single profile.
    profile: isRoutingProfile(stored.profile) ? stored.profile : DEFAULT_ROUTING_PROFILE,
    editCopySourceRouteId: stored.editCopySourceRouteId,
    // A real membership check, not a bare `??` — an unrecognised/corrupt
    // stored value simply means "no known origin", which suppresses the
    // notice rather than showing a wrong one.
    editCopyWaypointsOrigin: isEditCopyWaypointsOrigin(stored.editCopyWaypointsOrigin)
      ? stored.editCopyWaypointsOrigin
      : undefined,
    // Unlike editCopyWaypointsOrigin above, this always resolves to a
    // concrete value: "forward" is the objectively correct reading of "no
    // operation marker recorded" for every draft written before Reverse
    // route existed, and this field is only ever consulted once the two
    // fields above have already gated a genuine edit-copy draft — so
    // there is no separate "absent" state worth preserving here the way
    // there is for origin. A real membership check, not a bare `??`,
    // still guards against a corrupt stored value.
    editCopyOperation: isEditCopyOperation(stored.editCopyOperation)
      ? stored.editCopyOperation
      : "forward",
  };
}

/** Settings' persisted Route-planning defaults, resolved for use — unlike
 * PlanningDraftContent's asymmetric fields, this has exactly one field
 * today, so one shared shape is enough for both directions. */
export interface PlanningPreferences {
  avoidFerriesByDefault: boolean;
}

export function toStoredPlanningPreferences(
  preferences: PlanningPreferences,
): Omit<StoredPlanningPreferences, "id"> {
  return { avoidFerriesByDefault: preferences.avoidFerriesByDefault };
}

/**
 * Unlike fromStoredPlanningDraft (which never sees an absent row — its
 * caller, getDraft(), returns undefined itself), "no row present" is
 * itself the settled, meaningful default state for this preference (a new
 * installation, or an installation upgrading from a schema version before
 * this table existed) — so this accepts the possibly-absent row directly
 * and always resolves it to a concrete value.
 */
export function fromStoredPlanningPreferences(
  stored: StoredPlanningPreferences | undefined,
): PlanningPreferences {
  return { avoidFerriesByDefault: stored?.avoidFerriesByDefault ?? true };
}

/** The Route Library screen's persisted sort choice. "Most recent" keeps
 * today's exact PlannedRoute.createdAt-descending meaning; "Name A-Z" is
 * locale-aware, case-insensitive and numeric (see routeLibraryView.ts). */
export type RouteLibrarySortOrder = "most-recent" | "name-asc";

export const DEFAULT_ROUTE_LIBRARY_SORT_ORDER: RouteLibrarySortOrder = "most-recent";

export function isRouteLibrarySortOrder(value: unknown): value is RouteLibrarySortOrder {
  return value === "most-recent" || value === "name-asc";
}

/** Route Library's persisted sort preference, resolved for use. The
 * search query is deliberately not part of this shape — it's transient
 * view state, never written to IndexedDB (see RouteLibrary.tsx). */
export interface RouteLibraryPreferences {
  sortOrder: RouteLibrarySortOrder;
}

export function toStoredRouteLibraryPreferences(
  preferences: RouteLibraryPreferences,
): Omit<StoredRouteLibraryPreferences, "id"> {
  return { sortOrder: preferences.sortOrder };
}

/**
 * Unlike fromStoredPlanningDraft (which never sees an absent row), "no row
 * present" is itself the settled, meaningful default state for this
 * preference — so this accepts the possibly-absent row directly and
 * always resolves it to a concrete value. A real validity check, not a
 * bare `??` — a corrupt or future-unknown stored string must never flow
 * through to the sort logic, so it recovers to the app's default order.
 */
export function fromStoredRouteLibraryPreferences(
  stored: StoredRouteLibraryPreferences | undefined,
): RouteLibraryPreferences {
  return {
    sortOrder: isRouteLibrarySortOrder(stored?.sortOrder)
      ? stored.sortOrder
      : DEFAULT_ROUTE_LIBRARY_SORT_ORDER,
  };
}
