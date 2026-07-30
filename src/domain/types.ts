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

export type PlannedRouteSource =
  { kind: "gpx-import" } | { kind: "planner"; provider?: string; profile?: string };

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

export interface PlannedRoute {
  id: string;
  name: string;
  createdAt: string;
  points: RoutePoint[];
  manoeuvres: Manoeuvre[];
  /** Present only when manoeuvres is non-empty. See ManoeuvreProvenance's
   * own doc comment and domain/manoeuvreTrust.ts. */
  manoeuvreProvenance?: ManoeuvreProvenance;
  distanceMetres: number;
  ascentMetres: number | null;
  descentMetres: number | null;
  surfaceSummary?: SurfaceSummary;
  warnings: RouteWarning[];
  source: PlannedRouteSource;
}
