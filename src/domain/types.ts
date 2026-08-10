/**
 * Provider-independent domain model for routes, elevation, manoeuvres and
 * warnings. UI, GPX and navigation code must depend on these types rather
 * than on any routing-provider response shape.
 */

export type Coordinate = readonly [longitude: number, latitude: number];

export interface RoutePoint {
  coordinate: Coordinate;
  elevationMetres: number | null;
  distanceFromStartMetres: number;
}

/** A single point placed during Planning, before any route has been
 * calculated. Distinct from RoutePoint: a waypoint has no distance/
 * elevation of its own, and must never be treated as routed geometry. */
export interface Waypoint {
  id: string;
  coordinate: Coordinate;
}

/** Canonical, provider-independent manoeuvre vocabulary. Raw provider codes
 * are decoded into this by routing/manoeuvreTypes.ts and never leave
 * routing/ in raw form; "waypoint" is synthesised only by
 * stitchPlannedRouteLegs.ts at an internal multi-leg seam (no decoder ever
 * produces it directly). "unknown" covers any unrecognised/malformed code.
 * A route saved before this vocabulary existed may still hold a legacy raw
 * numeric-code string (e.g. "10") in Manoeuvre.type at runtime forever —
 * Dexie never validates stored data against this type — so every consumer
 * must handle a non-member value defensively (a generic icon/label
 * fallback), never assume exhaustive coverage via a Record lookup. */
export type ManoeuvreType =
  | "start"
  | "continue"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "u-turn"
  | "roundabout"
  | "waypoint"
  | "finish"
  | "unknown";

export interface Manoeuvre {
  distanceFromStartMetres: number;
  type: ManoeuvreType;
  instruction?: string;
}

export type RouteWarningKind =
  | "unknown-surface"
  | "questionable-surface"
  | "unsuitable-surface"
  | "access"
  | "steps"
  | "ford"
  | "ferry"
  | "other";

/** One variant per surface *category* ORS currently documents — not one
 * per raw numeric code (several codes/OSM tags fold into one category,
 * e.g. "gravel" also covers "fine_gravel"). "unknown" covers a missing,
 * unrecognised or provider-removed code — never treated as paved or
 * unsuitable, per CLAUDE.md's planning-surface policy. */
export type SurfaceType =
  | "paved"
  | "asphalt"
  | "concrete"
  | "unpaved-unspecified"
  | "metal"
  | "wood"
  | "compacted-gravel"
  | "gravel"
  | "paving-stones"
  | "grass-paver"
  | "dirt"
  | "ground"
  | "ice"
  | "sand"
  | "grass"
  | "unknown";

/** The rider-facing detail behind a surface RouteWarning — semantic type
 * plus display label. The provider's raw numeric code never leaves
 * routing/surfaceCodes.ts. */
export interface RouteSurfaceDetail {
  type: SurfaceType;
  label: string;
}

export interface RouteWarning {
  kind: RouteWarningKind;
  startDistanceMetres: number;
  endDistanceMetres: number;
  message: string;
  /** Present only for warnings produced by surface classification
   * (never for structural steps/ford/ferry/other warnings); absent on a
   * surface-kind warning saved before this field existed. UI and
   * coalescing gate new behaviour on this field's *presence*, not on
   * `kind`, so an old persisted warning keeps rendering exactly as it
   * did before. */
  surface?: RouteSurfaceDetail;
}

export interface SurfaceSummary {
  pavedMetres: number;
  questionableMetres: number;
  unsuitableMetres: number;
  unknownMetres: number;
}

/** The app's canonical cycling routing-profile vocabulary — currently
 * identical to the two profile names openrouteservice's Directions API
 * itself uses, since ORS is currently the only provider. Kept here (not
 * in routing/) so PlannedRouteSource and gpx/ can reference it without
 * routing/ and gpx/ depending on each other circularly (routing/ already
 * imports from gpx/ for point normalisation) — mirrors ManoeuvreType's own
 * domain ownership even though only routing/ code currently produces
 * values of this type. A future second provider would translate between
 * this vocabulary and its own profile naming inside its own adapter,
 * exactly as routing/manoeuvreTypes.ts's decodeOrsManoeuvreType already
 * does for manoeuvres. */
export type RoutingProfile = "cycling-road" | "cycling-regular";

/** profile is present on both arms: for "planner" it is always the profile
 * that actually produced this session's route; for "gpx-import" it is
 * present only when a validated <acn:source> GPX extension recovered it on
 * reimport (see gpx/parseAcnExtension.ts's readAcnSourceProfile) and is
 * purely informational — it never gates behaviour, unlike
 * ManoeuvreProvenance below, since its only consumer is a display label. */
export type PlannedRouteSource =
  | { kind: "gpx-import"; profile?: RoutingProfile }
  | { kind: "planner"; provider?: string; profile?: RoutingProfile };

/** Whether route.manoeuvres is safe to use for trusted next-manoeuvre
 * navigation — a separate concept from PlannedRouteSource: an ACN-GPX
 * re-import deliberately keeps source.kind === "gpx-import" while still
 * being trusted for navigation. "routing-provider" covers a route fresh
 * from a RoutingProvider; "acn-gpx-extension" covers a GPX re-import whose
 * namespaced <acn:navigation> extension validated against its own
 * geometry (see gpx/parseAcnExtension.ts). Absent on a route saved before
 * this field existed — domain/manoeuvreTrust.ts's hasTrustedManoeuvres is
 * the single source of truth for interpreting that legacy case. */
export type ManoeuvreProvenance =
  | { kind: "routing-provider"; provider: string }
  | { kind: "acn-gpx-extension"; version: 1 };

/** The original Planning waypoints that produced this route, when known
 * exactly — either stamped at Planning save/export time ("planning-session")
 * or recovered from a validated, geometry-digest-bound <acn:planning> GPX
 * extension on reimport ("acn-gpx-extension"). Both kinds are equally
 * trustworthy as exact waypoint data; the kind only records provenance for
 * diagnostics. Absent on a route saved before this field existed, on a
 * route whose GPX had no (or an invalid) <acn:planning> extension, or on a
 * route not sourced from Planning at all — domain/editableWaypoints.ts's
 * resolveEditableWaypoints falls back to deriving a capped, approximate
 * waypoint set from `points` in every one of those cases. */
export type PlanningProvenance =
  | {
      kind: "planning-session";
      waypoints: readonly Coordinate[];
      profile: RoutingProfile;
      avoidFerries: boolean;
    }
  | {
      kind: "acn-gpx-extension";
      version: 1;
      waypoints: readonly Coordinate[];
      profile: RoutingProfile;
      avoidFerries: boolean;
    };

export interface PlannedRoute {
  id: string;
  name: string;
  createdAt: string;
  points: RoutePoint[];
  manoeuvres: Manoeuvre[];
  /** Present only when manoeuvres is non-empty. See ManoeuvreProvenance's
   * own doc comment and domain/manoeuvreTrust.ts. */
  manoeuvreProvenance?: ManoeuvreProvenance;
  /** See PlanningProvenance's own doc comment. */
  planningProvenance?: PlanningProvenance;
  distanceMetres: number;
  ascentMetres: number | null;
  descentMetres: number | null;
  surfaceSummary?: SurfaceSummary;
  warnings: RouteWarning[];
  source: PlannedRouteSource;
  /** Local Route Library metadata: an ISO timestamp when this route was
   * pinned, or null/absent when it is not. Not route geometry or
   * provenance — never read by gpx/, routing/ or navigation/. A timestamp
   * (not a boolean) so pin order is itself well-defined: pinned routes
   * sort by this value descending. */
  pinnedAt?: string | null;
}
