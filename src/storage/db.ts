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

/** Discriminates what kind of active ride session a `StoredRideState` row
 * represents — see `StoredRouteRideState.kind`'s own doc comment for the
 * full legacy-defaulting/forward-compatibility rationale, and
 * `src/storage/mapping.ts`'s `resolveStoredRideSessionKind` for how a
 * stored value is resolved defensively. A storage-only discriminant (like
 * `StoredElevationViewMode` above), not a domain-level type — it has no
 * meaning outside a stored row. Widened to `"free-roam"` (backlog item 42,
 * route-less free roam) alongside `StoredRideState` itself becoming a
 * union — see `StoredFreeRoamRideState` below. */
export type RideSessionKind = "route" | "free-roam";

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
  /** Marks this draft as an "Edit copy" seeded from an
   * existing saved route — that route's id, purely informational (drives
   * PlanningScreen's read-only "editable copy" notice; never gates Save/
   * Export, never implies updating that route in place). Optional/non-
   * indexed, so adding it needs no schema version bump, matching
   * routeName/avoidFerries/profile above. Absent for an ordinary
   * hand-built draft. */
  editCopySourceRouteId?: string;
  /** Whether the waypoints this draft was seeded with were the source
   * route's exact recovered planning waypoints, or a derived approximation
   * — see domain/editableWaypoints.ts's EditableWaypointsResult.origin.
   * Only meaningful alongside editCopySourceRouteId (both are set, or
   * neither is). A plain string, not the narrower union, at this storage
   * boundary — mapping.ts's fromStoredPlanningDraft guards it with a real
   * membership check before use. Optional/non-indexed for the same reason
   * as the field above. */
  editCopyWaypointsOrigin?: string;
  /** Which "editable copy" operation seeded this draft — "forward" (Edit
   * copy in Planning) or "reverse" (Reverse route). Optional/non-indexed,
   * added the same purely-additive way as the two fields above — no
   * schema version bump needed. Only meaningful alongside
   * editCopySourceRouteId/editCopyWaypointsOrigin (all three set, or
   * none). Absent on every draft written before the Reverse route
   * feature existed, which could only ever have meant "forward" —
   * mapping.ts's fromStoredPlanningDraft defaults an absent or corrupt
   * value to "forward", never rejecting the row or losing the existing
   * forward notice for a pre-existing draft. A plain string, not the
   * narrower union, at this storage boundary — same Dexie-never-
   * validates convention as editCopyWaypointsOrigin. */
  editCopyOperation?: string;
}

/**
 * Singleton row (id is always "planning"): Settings-level Route planning
 * defaults, applied only when seeding a genuinely fresh Planning draft —
 * never a live, retroactively-applied switch (see
 * planningPreferencesRepository.ts and PlanningScreen.tsx's draft-
 * hydration effect). A new table, not a plain field on an existing row,
 * so it needs the version(3) bump below. profileByDefault was added later
 * (backlog item 36) as a plain, non-indexed field — the same additive,
 * no-version-bump convention as planningDrafts' own routeName/avoidFerries/
 * profile fields.
 */
export interface StoredPlanningPreferences {
  id: "planning";
  avoidFerriesByDefault: boolean;
  /** The rider's default cycling profile for a genuinely fresh Planning
   * draft. Optional/non-indexed for the same reason as avoidFerriesByDefault
   * — a plain string, not RoutingProfile, at this storage boundary (Dexie
   * never validates stored data); mapping.ts's fromStoredPlanningPreferences
   * is where a corrupt/unrecognised value is rejected and defaulted to
   * DEFAULT_ROUTING_PROFILE. Absent on every row written before this field
   * existed. */
  profileByDefault?: string;
}

/**
 * Singleton row (id is always "route-library"): the Route Library screen's
 * persisted sort choice. A new table, not a plain field on an existing
 * row, so it needs the version(4) bump below. `sortOrder` is a plain
 * string at this storage boundary — Dexie never validates stored data, so
 * src/storage/mapping.ts's fromStoredRouteLibraryPreferences is where an
 * unrecognised/corrupt value is actually rejected and defaulted, never
 * passed through to the UI. The search query itself is deliberately never
 * persisted here — it's session-only view state, restored via an in-memory
 * ref in App.tsx instead (see RouteLibrary.tsx's restoreSearchQueryRef).
 */
export interface StoredRouteLibraryPreferences {
  id: "route-library";
  sortOrder: string;
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
 * Singleton row (id is always "active") for a route-based ride session —
 * one of the two members of the `StoredRideState` union below (the other,
 * `StoredFreeRoamRideState`, has no route to speak of). Enough to resume a
 * ride immediately after reload/pageshow/hidden without re-deriving
 * progress from scratch.
 */
export interface StoredRouteRideState {
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
  /** True once this active ride has demonstrated genuine departure from
   * the finish area and credible interior route progress — the
   * prerequisite for any fix to count towards route completion (see
   * src/navigation/rideCompletion.ts's isRouteArmingFixEligible and
   * RouteCompletionTrackerState.isArmed). Optional/non-indexed for the
   * same reason as the fields above: rows written before this field
   * existed simply lack it, and src/storage/mapping.ts's
   * fromStoredRideState defaults a missing value to false — a legacy row
   * is never inferred as armed merely because it happens to store
   * near-total progress. No Dexie version() bump required. */
  completionArmed?: boolean;
  /** Discriminates what kind of active ride session this row represents.
   * A plain string, not the narrower `RideSessionKind` union, at this
   * storage boundary — Dexie never validates stored data, so
   * src/storage/mapping.ts's `resolveStoredRideSessionKind` is where an
   * unrecognised/corrupt value is actually resolved, never passed through
   * as though it were trusted. Deliberately left as a plain string here
   * (not narrowed to the literal `"route"`) even now that `StoredRideState`
   * is a union: `resolveStoredRideSessionKind` must still be able to
   * resolve a corrupted or future-unknown value from a route-shaped row to
   * `"unsupported"`, which would be impossible to construct without an
   * unsafe cast if this were narrowed to `"route"` only. Optional/
   * non-indexed for the same reason as every field added since v1: a row
   * written before this field existed simply lacks it, and
   * `resolveStoredRideSessionKind` treats that absence as `"route"` — the
   * only kind this table held before backlog item 42 (route-less free
   * roam) added `StoredFreeRoamRideState` below, so this is the correct
   * legacy default. A *present but unrecognised* value deliberately
   * resolves to a distinct `"unsupported"` outcome instead of also
   * defaulting to `"route"` — see `resolveStoredRideSessionKind`'s own doc
   * comment for why this table's usual `?? default` convention doesn't
   * apply to this one field. No Dexie `version()` bump required. */
  kind?: string;
}

/**
 * Singleton row (id is always "active") for a route-less "free roam" ride
 * session (backlog item 42) — the other member of the `StoredRideState`
 * union, alongside `StoredRouteRideState` above. Deliberately has no
 * `routeId`/`lastMatchedPointIndex`/`matchedDistanceFromStartMetres`/
 * `offRouteMachineState`/elevation/climb/completion fields at all: none of
 * those concepts exist without a route, and the type system (not just a
 * runtime convention) is what stops free-roam code from ever touching them.
 * `kind` is a required literal here, unlike `StoredRouteRideState.kind`'s
 * plain-string-and-optional shape — there is no legacy free-roam row from
 * before this field existed (free roam didn't exist before this slice), so
 * every free-roam row that will ever exist is written by code that already
 * knows to set it explicitly.
 */
export interface StoredFreeRoamRideState {
  id: "active";
  kind: "free-roam";
  startedAt: string;
  lastFix: StoredGpsFix | null;
  cameraMode?: RideCameraMode;
  cameraCoordinate?: Coordinate | null;
  cameraZoom?: number | null;
  cameraBearingDegrees?: number;
  cameraPitchDegrees?: number;
  /** The last reliable direction-of-travel bearing (mirrors
   * src/ui/riding/rideCamera.ts's internal lastCommandedBearingDegrees) —
   * persisted separately from raw GPS heading/speed, which stay transient
   * and are never persisted, so a resumed session can be framed sensibly
   * (using this bearing, or north-up when absent) while awaiting the first
   * fresh fix, rather than flashing MapLibre's raw default view. */
  lastReliableBearingDegrees?: number;
  /** Same meaning and defaulting convention as
   * StoredRouteRideState.wakeLockDesired above. */
  wakeLockDesired?: boolean;
}

/**
 * The stored shape of the one currently-active ride session, if any —
 * either a route session or a route-less free-roam session (backlog item
 * 42). Every route-only field access on a value typed as this union
 * requires narrowing first (via src/storage/mapping.ts's
 * `isStoredRouteRideState`/`isStoredFreeRoamRideState`), which is what
 * makes "a free-roam row must never be passed through route-progress
 * restoration or sent to getRoute" a compile-time guarantee, not just a
 * convention. Dexie itself never validates stored data either way — the
 * union only helps once a row has been read back into application code.
 */
export type StoredRideState = StoredRouteRideState | StoredFreeRoamRideState;

export class AcnDatabase extends Dexie {
  routes!: EntityTable<PlannedRoute, "id">;
  rideState!: EntityTable<StoredRideState, "id">;
  providerKeys!: EntityTable<StoredProviderKey, "id">;
  providerKeyVerifications!: EntityTable<StoredProviderKeyVerification, "id">;
  planningDrafts!: EntityTable<StoredPlanningDraft, "id">;
  planningPreferences!: EntityTable<StoredPlanningPreferences, "id">;
  routeLibraryPreferences!: EntityTable<StoredRouteLibraryPreferences, "id">;

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
    // (Milestone 4's tenth slice), dismissedClimbFeatureId (Milestone
    // 4's eleventh slice) and completionArmed (the ride-completion-arming
    // follow-up to the Finish/End ride lifecycle) are plain, non-indexed
    // fields added the same way.
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
    // v4: adds one brand-new, empty singleton-row table
    // (routeLibraryPreferences) for the Route Library search/sort slice —
    // no .upgrade() callback needed, same purely-additive reasoning as v2
    // and v3 above (a new object store only, no transformation of
    // existing data). v1, v2 and v3's stores() are repeated verbatim;
    // Dexie diffs consecutive version schemas, not just the latest one.
    this.version(4).stores({
      routes: "id, name, createdAt",
      rideState: "id",
      providerKeys: "id",
      providerKeyVerifications: "id",
      planningDrafts: "id",
      planningPreferences: "id",
      routeLibraryPreferences: "id",
    });
    // planningDrafts' later editCopySourceRouteId/editCopyWaypointsOrigin
    // fields (the "Edit copy in Planning" slice), planningDrafts' later
    // editCopyOperation field (the "Reverse route" slice), routes' later
    // planningProvenance field, rideState's later `kind` field (the
    // Ride-launcher/explicit-session-recovery slice, item 41), and
    // StoredFreeRoamRideState's own fields (lastReliableBearingDegrees etc,
    // item 42, route-less free roam) are all plain, non-indexed data fields
    // stored in the same `rideState` object store as every route session —
    // added the same way as everything else documented above — no
    // version(5) needed for any of them. StoredRideState becoming a union
    // of StoredRouteRideState | StoredFreeRoamRideState (item 42) is a
    // TypeScript-only change; it doesn't affect what's actually indexed.
  }
}

export const db = new AcnDatabase();
