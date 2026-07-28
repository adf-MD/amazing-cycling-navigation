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

export interface Manoeuvre {
  distanceFromStartMetres: number;
  type: string;
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

export interface PlannedRoute {
  id: string;
  name: string;
  createdAt: string;
  points: RoutePoint[];
  manoeuvres: Manoeuvre[];
  distanceMetres: number;
  ascentMetres: number | null;
  descentMetres: number | null;
  surfaceSummary?: SurfaceSummary;
  warnings: RouteWarning[];
  source: PlannedRouteSource;
}
