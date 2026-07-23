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

export interface RouteWarning {
  kind: RouteWarningKind;
  startDistanceMetres: number;
  endDistanceMetres: number;
  message: string;
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
