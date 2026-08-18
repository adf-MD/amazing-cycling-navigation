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
  type RideSessionKind,
  type StoredFreeRoamRideState,
  type StoredPlanningDraft,
  type StoredPlanningPreferences,
  type StoredRideState,
  type StoredRouteLibraryPreferences,
  type StoredRouteRideState,
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
function resolveElevationViewMode(stored: StoredRouteRideState): ElevationViewMode {
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

function isRideSessionKind(value: unknown): value is RideSessionKind {
  return value === "route" || value === "free-roam";
}

/** What `resolveStoredRideSessionKind` can determine about a stored row's
 * session kind: either a real, recognised `RideSessionKind`, or
 * `"unsupported"` — a present value this version of the app doesn't
 * recognise (a future kind, or a corrupted row). Callers (the Ride
 * launcher) must treat `"unsupported"` as non-resumable, offering only an
 * explicit discard, never a Resume action. */
export type ResolvedRideSessionKind = RideSessionKind | "unsupported";

/**
 * Resolves a stored row's session kind, defensively — Dexie never validates
 * stored data, so a `kind` string from an older or newer app version, or a
 * corrupted row, must never be trusted at face value.
 *
 * Absent (`undefined`) is the ordinary legacy case: every row this table
 * has ever held before this field existed was implicitly a route session,
 * so it resolves to `"route"` — the same legacy-absence handling this
 * table already uses for wakeLockDesired/dismissedClimbFeatureId/
 * completionArmed.
 *
 * A *present but unrecognised* value is deliberately NOT defaulted to
 * `"route"` the way `editCopyOperation`'s own `?? "forward"` cosmetic
 * fallback works elsewhere in this file. `editCopyOperation` is a closed,
 * two-value historical field whose absence has exactly one proven past
 * meaning and never gates a differently-shaped read. `kind` is different by
 * design: a discriminant that now genuinely has two route-incompatible
 * shapes (backlog item 42, free roam — see `StoredFreeRoamRideState`, which
 * has no meaningful `routeId`). Silently defaulting an unrecognised value
 * to `"route"` here could make the Ride launcher confidently resolve
 * `routeId` on a row whose actual shape it cannot correctly interpret —
 * wrong in a way that actively misleads the rider, not merely cosmetically
 * wrong. `"unsupported"` is the conservative, correct resolution: the
 * launcher can still offer a safe, no-interpretation-required discard
 * action for it, never a Resume one.
 *
 * Takes the raw `StoredRideState` union (rather than requiring the caller
 * to narrow first) since `kind` is readable on either member.
 */
export function resolveStoredRideSessionKind(
  stored: StoredRideState,
): ResolvedRideSessionKind {
  if (stored.kind === undefined) return "route";
  return isRideSessionKind(stored.kind) ? stored.kind : "unsupported";
}

/**
 * Narrows a `StoredRideState` to its route-session member. Every read of a
 * route-only field (`routeId`, match/off-route/elevation/climb/completion
 * state) must go through this first — the compiler, not just a runtime
 * convention, is what then stops a free-roam row from ever reaching
 * route-progress restoration.
 */
export function isStoredRouteRideState(
  stored: StoredRideState,
): stored is StoredRouteRideState {
  return resolveStoredRideSessionKind(stored) === "route";
}

/**
 * Narrows a `StoredRideState` to its free-roam-session member — see
 * `isStoredRouteRideState`'s own doc comment for the reciprocal rationale.
 */
export function isStoredFreeRoamRideState(
  stored: StoredRideState,
): stored is StoredFreeRoamRideState {
  return resolveStoredRideSessionKind(stored) === "free-roam";
}

export interface StoredCameraState {
  mode: RideCameraMode;
  /** Only meaningful when mode is "free"; null otherwise. */
  coordinate: Coordinate | null;
  /** Meaningful in two different modes, holding two different things
   * (backlog item 53): while "free", the rider's manually settled pan
   * zoom, exactly as before; while "following", the rider's selected
   * follow zoom (see src/ui/riding/rideCamera.ts's
   * RideCameraState.followZoomLevel) — broadening this same field's
   * contract rather than adding a second overlapping stored zoom value.
   * null while "overview", or for a row written before this field
   * existed. A missing/invalid value defaults to NAVIGATION_ZOOM at the
   * camera reducer, never here — this storage layer never depends on a
   * UI camera constant. */
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
  completionArmed: boolean,
): StoredRouteRideState {
  return {
    id: "active",
    routeId,
    startedAt,
    kind: "route",
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
    completionArmed,
  };
}

export interface RestoredRideState {
  lastFix: GeolocationFix | null;
  core: RideNavigationCoreState;
  elevationViewMode: ElevationViewMode;
  cameraState: StoredCameraState;
  wakeLockDesired: boolean;
  dismissedClimbFeatureId: string | null;
  completionArmed: boolean;
}

export function fromStoredRideState(stored: StoredRouteRideState): RestoredRideState {
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
    // Rows written before this field existed won't have it — unarmed is
    // the only safe default; never inferred true merely from a stored
    // near-total progress value.
    completionArmed: stored.completionArmed ?? false,
  };
}

export function toStoredFreeRoamState(
  startedAt: string,
  lastFix: GeolocationFix | null,
  cameraState: StoredCameraState,
  lastReliableBearingDegrees: number | null,
  wakeLockDesired: boolean,
): StoredFreeRoamRideState {
  return {
    id: "active",
    kind: "free-roam",
    startedAt,
    lastFix: lastFix
      ? {
          coordinate: lastFix.coordinate,
          accuracyMetres: lastFix.accuracyMetres,
          timestampMs: lastFix.timestampMs,
        }
      : null,
    cameraMode: cameraState.mode,
    cameraCoordinate: cameraState.coordinate,
    cameraZoom: cameraState.zoom,
    cameraBearingDegrees: cameraState.bearingDegrees,
    cameraPitchDegrees: cameraState.pitchDegrees,
    lastReliableBearingDegrees: lastReliableBearingDegrees ?? undefined,
    wakeLockDesired,
  };
}

export interface RestoredFreeRoamState {
  lastFix: GeolocationFix | null;
  cameraState: StoredCameraState;
  lastReliableBearingDegrees: number | null;
  wakeLockDesired: boolean;
}

export function fromStoredFreeRoamState(
  stored: StoredFreeRoamRideState,
): RestoredFreeRoamState {
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
    // Rows written before these fields existed won't have them — default
    // to "overview"/north-up/top-down, mirroring fromStoredRideState's
    // identical rationale for a route session.
    cameraState: {
      mode: stored.cameraMode ?? "overview",
      coordinate: stored.cameraCoordinate ?? null,
      zoom: stored.cameraZoom ?? null,
      bearingDegrees: stored.cameraBearingDegrees ?? 0,
      pitchDegrees: stored.cameraPitchDegrees ?? 0,
    },
    // Absent whenever a reliable bearing was never established (e.g. the
    // rider stayed stationary) — null (never a fabricated 0/north-up value
    // here; the camera hook itself decides the north-up fallback) is the
    // only honest default.
    lastReliableBearingDegrees: stored.lastReliableBearingDegrees ?? null,
    // Rows written before this field existed won't have it — off is the
    // only safe default, mirroring fromStoredRideState's identical
    // rationale.
    wakeLockDesired: stored.wakeLockDesired ?? false,
  };
}

/** The origin of the waypoints an "Edit copy" draft was seeded with — see
 * domain/editableWaypoints.ts's EditableWaypointsResult.origin, which this
 * mirrors exactly for storage. */
export type EditCopyWaypointsOrigin = "exact" | "derived";

function isEditCopyWaypointsOrigin(value: unknown): value is EditCopyWaypointsOrigin {
  return value === "exact" || value === "derived";
}

/** Which "editable copy" operation seeded a Planning draft — "forward"
 * (Edit copy) or "reverse" (legacy only: a pre-ride Reverse route action
 * that seeded a draft this way existed from v0.3.17 until backlog item 38
 * removed it — reversing a route is now an ordinary, repeatable Planning
 * edit that never touches this field at all, see
 * waypointHistoryReducer's "reverse" case). See
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
   * was created via "Edit copy" (see RidingScreen.tsx). Purely
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

/** Settings' persisted Route-planning defaults, resolved for use — both
 * fields resolve to a concrete value regardless of whether a row exists or
 * which fields it happens to carry (see fromStoredPlanningPreferences). */
export interface PlanningPreferences {
  avoidFerriesByDefault: boolean;
  profileByDefault: RoutingProfile;
}

export function toStoredPlanningPreferences(
  preferences: PlanningPreferences,
): Omit<StoredPlanningPreferences, "id"> {
  return {
    avoidFerriesByDefault: preferences.avoidFerriesByDefault,
    profileByDefault: preferences.profileByDefault,
  };
}

/**
 * Unlike fromStoredPlanningDraft (which never sees an absent row — its
 * caller, getDraft(), returns undefined itself), "no row present" is
 * itself the settled, meaningful default state for this preference (a new
 * installation, or an installation upgrading from a schema version before
 * this table existed) — so this accepts the possibly-absent row directly
 * and always resolves it to a concrete value. profileByDefault uses a real
 * validity check (isRoutingProfile), not a bare `??`, mirroring
 * fromStoredPlanningDraft's own profile handling — a corrupt or
 * future-unknown stored string, or a row written before this field
 * existed, must never flow through to the routing adapter.
 */
export function fromStoredPlanningPreferences(
  stored: StoredPlanningPreferences | undefined,
): PlanningPreferences {
  const profileByDefault = stored?.profileByDefault;
  return {
    avoidFerriesByDefault: stored?.avoidFerriesByDefault ?? true,
    profileByDefault: isRoutingProfile(profileByDefault)
      ? profileByDefault
      : DEFAULT_ROUTING_PROFILE,
  };
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
