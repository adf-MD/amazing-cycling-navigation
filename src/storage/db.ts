import Dexie, { type EntityTable } from "dexie";
import type { Coordinate, PlannedRoute, Waypoint } from "../domain/types.ts";
import type {
  ElevationWindowMetres,
  OffRouteLevel,
  RideCameraMode,
} from "../navigation/types.ts";

/** Mirrors `ElevationViewMode` (`src/navigation/types.ts`) for persistence.
 * Kept as a separate type (rather than reusing `ElevationViewMode`
 * directly) so a future change to the in-app type's shape doesn't silently
 * change what's already on disk. */
export type StoredElevationViewMode =
  { kind: "full" } | { kind: "upcoming"; windowMetres: ElevationWindowMetres };

/** Coarse, provider-independent outcome of the most recent attempt to use
 * the stored OpenRouteService key — never the raw HTTP status or provider
 * response, which could carry request/response detail we don't want to
 * retain (see CLAUDE.md: redact provider errors before diagnostics). */
export type ProviderKeyOutcome =
  "verified" | "rejected" | "quota-limited" | "unavailable";

/**
 * Singleton row (id is always "openrouteservice"): the user's own
 * OpenRouteService/HeiGIT API key, entered in Settings. Deliberately the
 * ONLY field on this row — verification status lives in the separate
 * StoredProviderKeyVerification row below, so code that records an
 * outcome after a routing attempt never has write access to the key
 * itself.
 */
export interface StoredProviderKey {
  id: "openrouteservice";
  apiKey: string;
  savedAt: string;
}

/**
 * Singleton row, same id convention as StoredProviderKey but a genuinely
 * separate table. Describes only the outcome of the most recent routing
 * attempt — never a currently-live assertion about the provider (a
 * reload doesn't re-check anything; see providerKeyStatus.ts for how this
 * is worded to readers as necessarily historical, e.g. "when last
 * checked").
 */
export interface StoredProviderKeyVerification {
  id: "openrouteservice";
  outcome: ProviderKeyOutcome;
  checkedAt: string;
  /** Only meaningful when outcome is "quota-limited" — a 429's
   * Retry-After or a provider quota-reset header, converted to an ISO
   * timestamp. Null when the provider didn't return one. */
  rateLimitResetAt: string | null;
}

/**
 * Singleton row (id is always "draft"): the rider's in-progress Planning
 * waypoints, so an unfinished plan survives a reload without needing a
 * calculated route or an API key. Cleared once the plan is saved as a
 * real PlannedRoute.
 */
export interface StoredPlanningDraft {
  id: "draft";
  waypoints: readonly Waypoint[];
  updatedAt: string;
  /** The rider's in-progress route name. Optional because rows written
   * before this field existed won't have it — src/storage/mapping.ts's
   * fromStoredPlanningDraft defaults a missing value to "Planned route",
   * the same default PlanningScreen already used before any draft
   * persisted a name at all. Not indexed, so adding it doesn't need a
   * schema version bump (see the version(1)/(2) comments below — same
   * convention as StoredRideState's camera fields). */
  routeName?: string;
  /** The rider's in-progress avoid-ferries preference. Optional/non-
   * indexed for the same reason as routeName — mapping.ts defaults a
   * missing value to true, the app's existing default. */
  avoidFerries?: boolean;
  /** The rider's in-progress cycling-profile choice. A plain string, not
   * RoutingProfile, at this storage boundary — Dexie never validates
   * stored data, so mapping.ts's fromStoredPlanningDraft is where an
   * unrecognised/corrupt value is actually rejected and defaulted, never
   * passed through to the routing adapter. Optional/non-indexed for the
   * same reason as routeName/avoidFerries — mapping.ts defaults a
   * missing value to DEFAULT_ROUTING_PROFILE ("cycling-road"), the app's
   * only profile before this field existed. */
  profile?: string;
}

/**
 * Singleton row (id is always "planning"): Settings-level Route planning
 * defaults, applied only when seeding a genuinely fresh Planning draft —
 * never a live, retroactively-applied switch (see
 * planningPreferencesRepository.ts and PlanningScreen.tsx's draft-
 * hydration effect). A new table, not a plain field on an existing row,
 * so it needs the version(3) bump below.
 */
export interface StoredPlanningPreferences {
  id: "planning";
  avoidFerriesByDefault: boolean;
}

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
  /** Legacy field: rows written before `elevationViewMode` existed store
   * only this. New rows write `elevationViewMode` instead and leave this
   * undefined; src/storage/mapping.ts's fromStoredRideState reads whichever
   * is present, preferring `elevationViewMode`. Optional/non-indexed, so
   * widening it from required to optional needs no schema version bump. */
  elevationWindowMetres?: ElevationWindowMetres;
  /** The rider's selected elevation-profile view (Full, or a rolling
   * window). Optional because rows written before this field existed only
   * have the legacy `elevationWindowMetres` above. Not indexed, so adding
   * it doesn't need a schema version bump — same convention as the camera
   * fields below. */
  elevationViewMode?: StoredElevationViewMode;
  /** The presentation-only "last reliable" route position (see
   * `RideNavigationCoreState.lastReliableMatch`), frozen while strongly
   * off-route so the elevation view doesn't jump to an unrelated nearby
   * route section. Optional/non-indexed for the same reason as
   * `elevationViewMode`; a legacy row without these simply has no freeze
   * history to restore, so mapping.ts falls back to the ordinary matched
   * position. */
  lastReliableMatchedPointIndex?: number;
  lastReliableMatchedDistanceFromStartMetres?: number;
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
  /** Only meaningful when cameraMode is "free" — the rider's manually
   * chosen bearing/pitch, restored on resume. Optional/non-indexed for
   * the same reason as cameraCoordinate/cameraZoom above (rows written
   * before this field existed won't have it; mapping.ts defaults a
   * missing value to 0, i.e. north-up/top-down). */
  cameraBearingDegrees?: number;
  cameraPitchDegrees?: number;
  /** The rider's desired wake-lock state for the current active ride only
   * — never a global setting, never the runtime sentinel itself (which is
   * never serialised). Optional/non-indexed for the same reason as the
   * camera fields above: rows written before this field existed simply
   * lack it, and src/storage/mapping.ts's fromStoredRideState defaults a
   * missing value to false — no Dexie version() bump required. */
  wakeLockDesired?: boolean;
  /** The stable RouteFeature.id of the recognised climb the rider has
   * manually left Climb elevation view for, so it doesn't automatically
   * reopen for the remainder of that same climb (see
   * src/navigation/climbElevationView.ts's selectEffectiveElevationView).
   * Never the literal displayed elevation view itself — "climb" is never
   * a stored elevationViewMode value, only this dismissal marker is
   * persisted. Optional/non-indexed for the same reason as the camera
   * fields above: rows written before this field existed simply lack it,
   * and src/storage/mapping.ts's fromStoredRideState defaults a missing
   * value to null (not dismissed) — no Dexie version() bump required. */
  dismissedClimbFeatureId?: string;
}

export class AcnDatabase extends Dexie {
  routes!: EntityTable<PlannedRoute, "id">;
  rideState!: EntityTable<StoredRideState, "id">;
  providerKeys!: EntityTable<StoredProviderKey, "id">;
  providerKeyVerifications!: EntityTable<StoredProviderKeyVerification, "id">;
  planningDrafts!: EntityTable<StoredPlanningDraft, "id">;
  planningPreferences!: EntityTable<StoredPlanningPreferences, "id">;

  constructor(name = "amazing-cycling-navigation") {
    super(name);
    // v1: routes indexed by id (primary), name and createdAt for the
    // library list/sort; rideState has no secondary indexes, it only ever
    // holds the single "active" row. The cameraMode/cameraCoordinate/
    // cameraZoom/cameraBearingDegrees/cameraPitchDegrees fields added
    // later are plain (non-indexed) data fields — Dexie's version/stores()
    // declaration only lists indexes, so adding them doesn't require a
    // version bump; old rows simply lack them, handled by explicit
    // defaulting in mapping.ts. elevationViewMode/lastReliableMatchedPointIndex/
    // lastReliableMatchedDistanceFromStartMetres (added after
    // elevationWindowMetres was widened to optional), wakeLockDesired
    // (Milestone 4's tenth slice) and dismissedClimbFeatureId (Milestone
    // 4's eleventh slice) are plain, non-indexed fields added the same
    // way.
    this.version(1).stores({
      routes: "id, name, createdAt",
      rideState: "id",
    });
    // v2: adds three brand-new, empty singleton-row tables for Milestone
    // 3A (the API key, its verification status, and an in-progress
    // Planning draft) — no .upgrade() callback is needed because this is
    // a purely additive structural change (new object stores only, no
    // transformation of existing routes/rideState data). Every prior
    // version's stores() must still be listed verbatim; Dexie compares
    // consecutive version schemas to work out what changed, not a diff
    // against only the latest one. See db.migration.test.ts.
    // planningDrafts' later routeName/avoidFerries fields (Milestone 3C)
    // are plain, non-indexed data fields added the same way as
    // rideState's camera fields above — no version(3) needed for them.
    this.version(2).stores({
      routes: "id, name, createdAt",
      rideState: "id",
      providerKeys: "id",
      providerKeyVerifications: "id",
      planningDrafts: "id",
    });
    // v3: adds one brand-new, empty singleton-row table
    // (planningPreferences) for the Settings-visual-migration/avoid-
    // ferries-default slice — no .upgrade() callback needed, same purely-
    // additive reasoning as v2 above (a new object store only, no
    // transformation of existing data). v1 and v2's stores() are repeated
    // verbatim; Dexie diffs consecutive version schemas, not just the
    // latest one.
    this.version(3).stores({
      routes: "id, name, createdAt",
      rideState: "id",
      providerKeys: "id",
      providerKeyVerifications: "id",
      planningDrafts: "id",
      planningPreferences: "id",
    });
  }
}

export const db = new AcnDatabase();
