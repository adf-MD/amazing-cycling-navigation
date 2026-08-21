import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";
import type { Coordinate, RoutePoint, RouteWarning } from "../domain/types.ts";
import { logError } from "../platform/errorLog.ts";
import type { ClassifiedSegment } from "../navigation/gradient.ts";
import type { RouteFeature } from "../navigation/routeFeatures.ts";
import {
  MICRO_DETAIL_COLOURS,
  ROUTE_FEATURE_COLOURS,
  UNREACHABLE_FALLBACK_COLOUR,
  type MicroDetailVisualKey,
} from "../navigation/routeFeaturePalette.ts";
import {
  createMapLibreMap,
  type LineLayerPaint,
  type MapErrorCategory,
  type MapFactory,
  type MapLibreLike,
} from "./mapAdapter.ts";
import { recordMapAttempt, type MapDiagnosticCategory } from "./mapDiagnostics.ts";
import {
  buildRouteArrowIconBitmap,
  ROUTE_ARROW_ICON_ID,
  ROUTE_ARROW_ICON_PIXEL_RATIO,
} from "./routeArrowIcon.ts";
import {
  buildPositionFeatureCollection,
  computeBoundingBox,
  EMPTY_FEATURE_COLLECTION,
  isLoopRoute,
  splitRouteAtDistance,
  type BoundingBox,
} from "./routeLayer.ts";
import { buildGradientFeatureCollection } from "./gradientRouteLayer.ts";
import {
  buildRouteFeatureFeatureCollection,
  buildSelectedRouteFeatureFeatureCollection,
  resolveRouteFeatureIdHit,
} from "./routeFeatureLayer.ts";
import {
  buildUnroutedPreviewFeatureCollection,
  buildWaypointMarkerSpecs,
  deriveMarkerZoomBand,
  type PlanningOverlayWaypoint,
} from "./planningLayer.ts";
import {
  buildDistanceBadgeMarkerSpecs,
  selectDistanceBadgeIntervalMetres,
} from "./distanceBadgeLayer.ts";
import {
  legibleWidthStops,
  recedingWidthStops,
  warningWidthStops,
} from "./routeWidthPolicy.ts";
import {
  buildSelectedWarningFeatureCollection,
  buildWarningFeatureCollectionsByCategory,
  computeSelectedWarningBounds,
  resolveWarningIndexHit,
  WARNING_CATEGORIES_IN_PAINT_ORDER,
  type WarningCategory,
} from "./warningLayer.ts";
import { DEFAULT_TILE_SOURCE, type TileSourceConfig } from "./tileSource.ts";

const COMPLETED_SOURCE_ID = "acn-route-completed";
const REMAINING_SOURCE_ID = "acn-route-remaining";
const POSITION_SOURCE_ID = "acn-position";
const START_SOURCE_ID = "acn-route-start";
const FINISH_SOURCE_ID = "acn-route-finish";
const COMPLETED_LAYER_ID = "acn-route-completed-line";
const REMAINING_LAYER_ID = "acn-route-remaining-line";
const POSITION_LAYER_ID = "acn-position-marker";
const START_LAYER_ID = "acn-start-marker";
const FINISH_LAYER_ID = "acn-finish-marker";
const PLANNING_PREVIEW_SOURCE_ID = "acn-planning-preview";
const PLANNING_PREVIEW_LAYER_ID = "acn-planning-preview-line";
const GRADIENT_SOURCE_ID = "acn-route-gradient";
const GRADIENT_LAYER_ID = "acn-route-gradient-line";
const ROUTE_FEATURE_SOURCE_ID = "acn-route-feature";
const ROUTE_FEATURE_LAYER_ID = "acn-route-feature-line";
const ROUTE_FEATURE_SELECTED_SOURCE_ID = "acn-route-feature-selected";
const ROUTE_FEATURE_SELECTED_LAYER_ID = "acn-route-feature-selected-line";
/** Matches the base route-line width, same footprint principle as
 * GRADIENT_LINE_WIDTH — see the layer-order comment in
 * addRouteAndPositionLayers for why this is added before (and is
 * overridden within its own range by) the micro gradient layer, and
 * before the whole warning group. Kept as a plain close-zoom reference
 * value; recedingWidthStops (routeWidthPolicy.ts) is applied at the
 * addLineLayer call site below. */
const ROUTE_FEATURE_LAYER_WIDTH = 5;
/** Reuses the same "black = selected" visual language as
 * WARNING_SELECTED_PAINT, at a width between the climb/descent layers'
 * own 5px and the warning halo's 13px — wide enough to read as a ring
 * around a selected feature's macro/micro colouring, narrow enough to
 * stay visually secondary to an actual selected warning. */
const ROUTE_FEATURE_SELECTED_PAINT: LineLayerPaint = {
  lineColor: "#000000",
  lineWidth: legibleWidthStops(9),
};
/** The only layer id ever passed to queryTopRouteFeatureAt — mirrors
 * WARNING_CATEGORY_LAYER_IDS's own array-of-queryable-ids convention,
 * even though there is only one macro route-feature layer (never the
 * selected-halo or micro-detail layers, neither of which carries a
 * routeFeatureId property). */
const ROUTE_FEATURE_TAP_LAYER_IDS: readonly string[] = [ROUTE_FEATURE_LAYER_ID];
const ROUTE_ARROW_LAYER_ID = "acn-route-arrows";
/** symbol-spacing, in screen pixels (already zoom-adaptive — a fixed
 * on-screen spacing yields more arrows per geographic distance as the
 * map zooms in, needing no zoom expression). Picked from the 100-180px
 * "restrained but legible" range as a starting point for manual
 * iPhone-viewport verification, not a value to treat as final. */
const ROUTE_ARROW_SPACING_PX = 140;

const WARNING_SOURCE_ID_BY_CATEGORY: Readonly<Record<WarningCategory, string>> = {
  "unknown-surface": "acn-warning-unknown-surface",
  "questionable-surface": "acn-warning-questionable-surface",
  "unsuitable-surface": "acn-warning-unsuitable-surface",
  obstacle: "acn-warning-obstacle",
  ferry: "acn-warning-ferry",
  other: "acn-warning-other",
};
const WARNING_LAYER_ID_BY_CATEGORY: Readonly<Record<WarningCategory, string>> = {
  "unknown-surface": "acn-warning-unknown-surface-line",
  "questionable-surface": "acn-warning-questionable-surface-line",
  "unsuitable-surface": "acn-warning-unsuitable-surface-line",
  obstacle: "acn-warning-obstacle-line",
  ferry: "acn-warning-ferry-line",
  other: "acn-warning-other-line",
};
const WARNING_SELECTED_SOURCE_ID = "acn-warning-selected";
const WARNING_SELECTED_LAYER_ID = "acn-warning-selected-line";

/** Every warning-category layer id, in paint order — deliberately
 * excludes WARNING_SELECTED_LAYER_ID. This list is the entire mechanism
 * by which a map-tap hit-test never selects the highlight layer itself:
 * it is the only set of layer ids ever passed to
 * queryTopWarningFeatureAt. */
const WARNING_CATEGORY_LAYER_IDS: readonly string[] =
  WARNING_CATEGORIES_IN_PAINT_ORDER.map(
    (category) => WARNING_LAYER_ID_BY_CATEGORY[category],
  );

/** Distinctness is carried primarily by dash-pattern shape, not colour
 * alone. Obstacle (access/steps/ford) is the most saturated/thickest of
 * the non-selected categories, matching its topmost paint order — see
 * WARNING_CATEGORIES_IN_PAINT_ORDER. Colours are fixed (not
 * --colour-bg/--colour-text) since these sit over variable map imagery,
 * not the app's own light/dark-scheme background. Widths act as a
 * "casing" wider than the gradient-coloured route centre painted on top
 * of them (see addRouteAndPositionLayers), so a warned section's dashed
 * edges stay visible on both sides of the centre. Widths use
 * warningWidthStops (backlog item 39), not legibleWidthStops — a warning
 * previously receded no faster than the neutral base/selection halos it
 * shared that family with, so it visually dominated a full-route
 * overview; warningWidthStops recedes faster while staying wider than
 * the climb/descent overlay and neutral base at every zoom (see
 * routeWidthPolicy.ts). */
const WARNING_CATEGORY_PAINT: Readonly<Record<WarningCategory, LineLayerPaint>> = {
  "unknown-surface": {
    lineColor: "#5f6368",
    lineWidth: warningWidthStops(8),
    lineDasharray: [1, 3],
  },
  other: {
    lineColor: "#455a64",
    lineWidth: warningWidthStops(9),
    lineDasharray: [2, 2, 6, 2],
  },
  ferry: { lineColor: "#0d47a1", lineWidth: warningWidthStops(9), lineDasharray: [8, 4] },
  "questionable-surface": {
    lineColor: "#f2a900",
    lineWidth: warningWidthStops(9),
    lineDasharray: [4, 2],
  },
  "unsuitable-surface": {
    lineColor: "#d32f2f",
    lineWidth: warningWidthStops(10),
    lineDasharray: [6, 2],
  },
  obstacle: {
    lineColor: "#7b1fa2",
    lineWidth: warningWidthStops(10),
    lineDasharray: [1, 1, 5, 1],
  },
};
/** Solid (no dash) and wider than any category above — an outer focus
 * halo around the casing, contrasting with every dashed category rather
 * than just repeating one of their colours. Uses warningWidthStops, same
 * rationale as WARNING_CATEGORY_PAINT above — stays wider than the
 * selected route-feature halo (legibleWidthStops(9)) at every zoom, so a
 * selected warning still visually outranks a selected climb/descent. */
const WARNING_SELECTED_PAINT: LineLayerPaint = {
  lineColor: "#000000",
  lineWidth: warningWidthStops(13),
};
/** Matches the existing route-line width — the gradient layer recolours
 * the same visual footprint the route already had, rather than adding a
 * new one. Kept as a plain close-zoom reference value; recedingWidthStops
 * is applied at the addLineLayer call site below. */
const GRADIENT_LINE_WIDTH = 5;

/** Every GeoJSON source this app itself creates — used to tell a genuine
 * external-basemap tile event apart from our own local data sources, which
 * report loaded almost immediately regardless of tile delivery (see the
 * onSourceData handler in attachMap below). */
const APP_OWNED_SOURCE_IDS: ReadonlySet<string> = new Set([
  COMPLETED_SOURCE_ID,
  REMAINING_SOURCE_ID,
  POSITION_SOURCE_ID,
  START_SOURCE_ID,
  FINISH_SOURCE_ID,
  PLANNING_PREVIEW_SOURCE_ID,
  GRADIENT_SOURCE_ID,
  ROUTE_FEATURE_SOURCE_ID,
  ROUTE_FEATURE_SELECTED_SOURCE_ID,
  ...Object.values(WARNING_SOURCE_ID_BY_CATEGORY),
  WARNING_SELECTED_SOURCE_ID,
]);

/** How long to wait for the style document itself to become structurally
 * ready (MapLibre's own "style.load", independent of tile loading) before
 * falling back to the local neutral background — the tile provider is
 * external and unreliable (see CLAUDE.md: the ride display must degrade
 * usefully without it). Deliberately gates only the style document now,
 * not full tile loading (see the route/position layers, which are added
 * on style-ready rather than the slower "load" event) — decoupling this
 * from tile speed means a single slow/errored tile can never trigger
 * this fallback. Bumped from an earlier 10s to give more headroom for a
 * cellular/Wi-Fi handoff completing a cold TLS handshake on an iPhone. */
const STYLE_READY_TIMEOUT_MS = 15_000;

/** How long to wait, after the map is ready, for the route's GeoJSON
 * source to finish processing before logging it as a diagnostic — this is
 * the signal that was missing every time the route silently failed to
 * render despite the map itself reaching "ready". */
const ROUTE_DATA_TIMEOUT_MS = 5_000;

/** Fully local style with no external references (no sprite, glyphs, or
 * tile sources), so it's guaranteed to load even with no network access at
 * all. Used when the configured tile source doesn't load in time. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "acn-fallback-background",
      type: "background",
      paint: { "background-color": "#dcdad4" },
    },
  ],
};

type MapLoadState = "loading" | "ready" | "load-error";

export interface CameraTarget {
  /** null leaves the map's current centre unchanged — used only by the
   * north-up/top-down reset, which reorients without recentring. */
  coordinate: Coordinate | null;
  /** null leaves the map's current zoom unchanged — see coordinate. */
  zoom: number | null;
  bearingDegrees: number;
  pitchDegrees: number;
  /** true: eases (live "following", or an orientation-only reset).
   * false: jumps instantly (restoring a previously free-panned
   * position). */
  animate: boolean;
  /** true only for a live GPS-follow ease — see mapAdapter.ts's setCamera. */
  followOffset: boolean;
  /** Present only for an explicit Riding Northwards or Follow-location
   * press (see rideCamera.ts's RideCameraCommand, which this field
   * mirrors). When present, this cameraTarget application is deduped by
   * requestId alone — a new id re-applies even with byte-identical
   * values, fixing a repeated press being silently swallowed after an
   * intervening manual gesture (the same class of bug OrientNorthCameraTarget
   * exists to fix for Planning). When absent (every automatic fresh-fix/
   * restore command, and every other existing caller), deduped by value
   * exactly as before. Riding-only — Planning no longer supplies
   * cameraTarget at all. Never persisted. */
  requestId?: string;
}

/** An explicit "frame this area" camera command — Planning's fresh-session
 * auto-framing, Locate-me, and the one-time fit applied to a restored or
 * externally seeded (edit-copy/reverse-copy) waypoint set at draft-
 * hydration time. Distinct from CameraTarget: deduped by `requestId`, not
 * by value (see the effect below), so an identical repeated request (e.g.
 * Locate me tapped twice at an unchanged coordinate) still re-executes —
 * each tap is an explicit user command to re-apply, not a value to
 * reconcile against the last-applied one. */
export interface BoundsCameraTarget {
  bounds: BoundingBox;
  /** Distinct per issuance — generate via src/platform/idGenerator.ts's
   * generateId(). */
  requestId: string;
}

/** An explicit "recentre only" camera command — Planning's GPS-centre
 * (Locate me) control, once the session's initial regional framing has
 * already happened once (see BoundsCameraTarget). Deduped by `requestId`,
 * not by value, exactly like BoundsCameraTarget — a repeated tap at an
 * unchanged coordinate still re-applies. Distinct from CameraTarget: this
 * never carries zoom/bearing/pitch at all, so mapAdapter.ts's centreOn
 * leaves them genuinely untouched rather than needing an explicit "leave
 * unchanged" null. Planning-only; Riding never supplies this. */
export interface CentreCameraTarget {
  coordinate: Coordinate;
  requestId: string;
}

/** An explicit "reorient to north-up/top-down" camera command —
 * Planning's Northwards control. Deduped by `requestId`, not by value,
 * unlike the shared CameraTarget pipeline (see the fix this type exists
 * for: CameraTarget's value-based dedup silently swallows a second
 * identical request after an intervening manual rotation). Carries no
 * fields beyond the request identity because the command itself is always
 * the same fixed reset — see the orientNorthTarget effect below, which
 * reuses setCamera's existing (null, null, 0, 0, ...) call. Planning-only;
 * Riding keeps using CameraTarget for its own north-up control. */
export interface OrientNorthCameraTarget {
  requestId: string;
}

/** An explicit "change zoom by a fixed step" camera command — Planning's
 * Zoom in/out controls (backlog item 52), and Riding's/free roam's own
 * equivalent controls whenever NOT genuinely following with an
 * actionable anchor (backlog item 53; the anchored case is superseded by
 * backlog item 65 — see rideCamera.ts's hasActionableFollowAnchor and
 * useRideCamera.ts's requestZoom, which instead route through
 * CameraTarget/setCamera so the rider's below-centre screen position
 * survives the zoom). Deduped by `requestId`, not by value, exactly like
 * CentreCameraTarget/OrientNorthCameraTarget — two consecutive Zoom-in
 * presses carry an identical `delta` but must both apply. `delta` is
 * always relative to the map's current zoom at the moment it's applied
 * (see mapAdapter.ts's changeZoomBy), never an absolute target. Fully
 * generic — every caller shares this one command shape and the one
 * `zoomTarget` effect below. */
export interface ZoomCameraTarget {
  delta: number;
  /** Distinct per issuance — generate via src/platform/idGenerator.ts's
   * generateId(). */
  requestId: string;
}

/** Planning's map chrome (waypoint markers, dashed unrouted-preview line,
 * tap-to-place), grouped into one prop rather than several unrelated
 * ones. Never used by Riding mode — when absent, the underlying sources
 * this drives stay empty and Riding's rendered output is unchanged. Kept
 * entirely about presentation/data: Planning's own workflow state
 * (waypoint history, selection, debounced recalculation) lives in
 * src/ui/planning, never here. */
export interface PlanningOverlay {
  waypoints: readonly PlanningOverlayWaypoint[];
  /** Raw coordinates for the dashed preview line — never RoutePoints, so
   * this can never be mistaken for (or accidentally treated as) routed
   * geometry. */
  previewCoordinates: readonly Coordinate[];
  /** Index into `waypoints`, or null if none is selected. Out-of-range
   * values are treated the same as null. */
  selectedWaypointIndex: number | null;
  /** Fired for a genuine tap/click on the map (never a drag) — see
   * mapAdapter.ts's onMapTap. */
  onMapTap: (coordinate: Coordinate) => void;
}

/** Grouped, optional warning highlighting for Planning's route summary.
 * Never used by Riding mode — when absent, the underlying warning sources
 * stay empty and Riding's rendered output is unchanged. Sliced against
 * MapView's own `points` prop, never a separately-supplied geometry, so
 * the overlay can never disagree with the route line itself. */
export interface WarningOverlay {
  /** Already coalesced by the caller (see PlanningScreen) — MapView never
   * re-coalesces, so list index and map-overlay index always agree. */
  warnings: readonly RouteWarning[];
  /** Index into `warnings` currently selected for highlighting/framing,
   * or null for none. Out-of-range values are treated the same as null. */
  selectedWarningIndex: number | null;
  /** Fired when a genuine map tap resolves, via hit-testing, to a
   * selectable warning feature — reports only the winning index into
   * `warnings`. MapView performs no Planning-workflow logic itself (no
   * mode-clearing, no waypoint-selection changes); the caller applies its
   * own selection policy, exactly as it already does for list-originated
   * selection. Never fired for a tap that misses every warning feature —
   * that falls through to planningOverlay.onMapTap unchanged. */
  onSelectWarning: (index: number) => void;
}

/** Grouped, optional macro climb/descent feature highlighting — unlike
 * WarningOverlay, available to BOTH Planning and Riding (a rider may tap
 * a recognised climb/descent mid-ride, not only while planning). When
 * absent, the underlying route-feature sources stay empty and rendering
 * is unchanged. Sliced against MapView's own `points` prop, same as
 * WarningOverlay. */
export interface RouteFeatureOverlay {
  /** The full-route feature list — never a windowed/clipped subset (see
   * routeFeatures.ts's own doc comment on why). */
  features: readonly RouteFeature[];
  /** Id into `features` currently selected for highlighting, or null for
   * none. An id that no longer matches any current feature (e.g. after a
   * route recalculation) is treated the same as null. */
  selectedFeatureId: string | null;
  /** Fired when a genuine map tap resolves, via hit-testing, to a
   * selectable route-feature — reports only the winning feature's id.
   * MapView performs no selection-policy logic itself; the caller applies
   * its own (e.g. mutual exclusivity with warning selection). Never fired
   * for a tap that misses every route feature, or when a warning was hit
   * first — see the onMapTap wiring below for the exact priority. */
  onSelectRouteFeature: (id: string) => void;
}

export interface MapViewProps {
  points: readonly RoutePoint[];
  /** Distance already ridden; the route line before this point is shown
   * dimmed as "completed" and the rest highlighted as "remaining". Omit
   * (or 0) to show the whole route as upcoming, e.g. a library preview. */
  matchedDistanceFromStartMetres?: number;
  /** The rider's frozen/reliable progress for filtering which route-
   * distance badges are shown ahead vs. omitted as completed — see
   * useRideNavigation's presentationDistanceFromStartMetres. null
   * (the default — every caller except active Riding; Planning never
   * passes this, and Riding passes null before Start riding / before any
   * reliable matched progress) shows every badge on the whole route,
   * unfiltered. Deliberately NOT matchedDistanceFromStartMetres above,
   * which drives the route line/arrows and updates live even while
   * off-route — this is an intentional divergence, not an oversight; see
   * distanceBadgeLayer.ts's own module doc comment. */
  distanceBadgeProgressMetres?: number | null;
  currentPosition?: Coordinate;
  tileSource?: TileSourceConfig;
  mapFactory?: MapFactory;
  /** The camera MapView should be showing right now, or null/undefined to
   * leave the camera under the default overview fit / user control. Set
   * by the riding camera controller (useRideCamera) to drive "following"
   * or a one-time restore of a previously free-panned position. */
  cameraTarget?: CameraTarget | null;
  /** An explicit "frame this area" request — see BoundsCameraTarget.
   * Unlike cameraTarget, a repeated request with the same bounds still
   * re-applies (deduped by requestId, not value). Planning-only; Riding
   * never supplies this. */
  boundsTarget?: BoundsCameraTarget | null;
  /** An explicit "recentre only" request — see CentreCameraTarget.
   * Planning-only; Riding never supplies this. */
  centreTarget?: CentreCameraTarget | null;
  /** An explicit "reorient to north-up/top-down" request — see
   * OrientNorthCameraTarget. Planning-only; Riding never supplies this. */
  orientNorthTarget?: OrientNorthCameraTarget | null;
  /** An explicit "change zoom by a fixed step" request — see
   * ZoomCameraTarget. Shared by Planning (item 52) and Riding/free roam
   * (item 53) alike; every caller reuses this same generic command. */
  zoomTarget?: ZoomCameraTarget | null;
  /** Skips the automatic "fit to route" once the map is ready — used when
   * resuming a ride that wasn't in overview mode before suspension, so
   * the restored following/free camera isn't briefly overridden by a
   * flash of the full route. Defaults to fitting, matching every other
   * MapView usage (previews, a fresh ride). */
  suppressInitialOverviewFit?: boolean;
  /** Fired the instant the rider manually drags/pinches/rotates/pitches
   * the map — never fired for MapView's own programmatic camera moves
   * (fitBounds, cameraTarget-driven setCamera). */
  onUserCameraInteraction?: () => void;
  /** Fired whenever the camera finishes moving, for any reason — the
   * caller filters by its own current mode (only "free" cares, to persist
   * a manually-panned position); this fires for programmatic moves too. */
  onCameraSettled?: (camera: {
    coordinate: Coordinate;
    zoom: number;
    bearingDegrees: number;
    pitchDegrees: number;
  }) => void;
  /** Planning's waypoint markers, unrouted-preview line, and tap-to-place
   * — omitted (the default) for every existing caller, leaving the
   * underlying sources empty and Riding mode's rendering unaffected. */
  planningOverlay?: PlanningOverlay;
  /** Planning's inspectable route-warning highlighting — omitted (the
   * default) for every existing caller, leaving the underlying warning
   * sources empty and Riding mode's rendering unaffected. */
  warningOverlay?: WarningOverlay;
  /** The shared gradient analysis for `points`, already narrowed by the
   * caller to whichever feature is currently shown in micro detail
   * (selected or, during active Riding, currently occupied) — omitted or
   * empty (the default) leaves the micro-detail source empty, so only the
   * macro route-feature colouring (see routeFeatureOverlay) and the plain
   * remaining/completed colours show. This is a behavioural change from
   * this prop's earlier meaning (the whole route's local-gradient
   * colouring) — MapView's own rendering of it is unchanged; only what
   * callers now choose to pass has narrowed. Sliced against MapView's own
   * `matchedDistanceFromStartMetres` (never a separately-supplied
   * distance), the same value that already drives the completed/remaining
   * route-line split and the direction arrows, so the micro-coloured
   * centre always agrees with the line it recolours during active Riding. */
  gradientOverlay?: { segments: readonly ClassifiedSegment<MicroDetailVisualKey>[] };
  /** The shared macro climb/descent feature list and selection — omitted
   * (the default) leaves both the macro and selected-feature sources
   * empty. See RouteFeatureOverlay's own doc comment. */
  routeFeatureOverlay?: RouteFeatureOverlay;
}

/**
 * Route and position are added as GeoJSON sources/layers independent of
 * the base style's own tile source, so a tile-loading failure never
 * removes them — only the base map imagery is affected, and an explicit
 * banner tells the rider that's happened. The route/position overlays are
 * added as soon as the style is structurally ready (MapLibre's own
 * "style.load"), not once every tile has loaded, so they render even
 * while imagery is still arriving. The map only falls back to a fully
 * local, network-free style if the style itself never becomes ready
 * within STYLE_READY_TIMEOUT_MS or suffers a fatal style/WebGL failure —
 * a single recoverable tile/sprite error never destroys a working style.
 */
export function MapView({
  points,
  matchedDistanceFromStartMetres = 0,
  distanceBadgeProgressMetres = null,
  currentPosition,
  tileSource = DEFAULT_TILE_SOURCE,
  mapFactory = createMapLibreMap,
  cameraTarget = null,
  boundsTarget = null,
  centreTarget = null,
  orientNorthTarget = null,
  zoomTarget = null,
  suppressInitialOverviewFit = false,
  onUserCameraInteraction,
  onCameraSettled,
  planningOverlay,
  warningOverlay,
  gradientOverlay,
  routeFeatureOverlay,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreLike | null>(null);
  // Always call the latest callback without needing it in the map-creation
  // effect's dependency array (which would tear down and recreate the map
  // whenever the parent passes a new function identity).
  const onUserCameraInteractionRef = useRef(onUserCameraInteraction);
  useEffect(() => {
    onUserCameraInteractionRef.current = onUserCameraInteraction;
  }, [onUserCameraInteraction]);
  const onCameraSettledRef = useRef(onCameraSettled);
  useEffect(() => {
    onCameraSettledRef.current = onCameraSettled;
  }, [onCameraSettled]);
  // Diagnostic-only (see followAnchorPixel below, backlog item 65) — the
  // onCameraSettled handler reads this rather than closing over
  // currentPosition directly, since it's registered once inside the
  // map-creation effect and must always see the latest prop.
  const currentPositionRef = useRef(currentPosition);
  useEffect(() => {
    currentPositionRef.current = currentPosition;
  }, [currentPosition]);
  const onMapTapRef = useRef(planningOverlay?.onMapTap);
  useEffect(() => {
    onMapTapRef.current = planningOverlay?.onMapTap;
  }, [planningOverlay?.onMapTap]);
  const warningsRef = useRef(warningOverlay?.warnings);
  useEffect(() => {
    warningsRef.current = warningOverlay?.warnings;
  }, [warningOverlay?.warnings]);
  const onSelectWarningRef = useRef(warningOverlay?.onSelectWarning);
  useEffect(() => {
    onSelectWarningRef.current = warningOverlay?.onSelectWarning;
  }, [warningOverlay?.onSelectWarning]);
  const routeFeaturesRef = useRef(routeFeatureOverlay?.features);
  useEffect(() => {
    routeFeaturesRef.current = routeFeatureOverlay?.features;
  }, [routeFeatureOverlay?.features]);
  const onSelectRouteFeatureRef = useRef(routeFeatureOverlay?.onSelectRouteFeature);
  useEffect(() => {
    onSelectRouteFeatureRef.current = routeFeatureOverlay?.onSelectRouteFeature;
  }, [routeFeatureOverlay?.onSelectRouteFeature]);
  const lastAppliedCameraTargetRef = useRef<{
    lon: number | null;
    lat: number | null;
    zoom: number | null;
    bearingDegrees: number;
    pitchDegrees: number;
    animate: boolean;
    followOffset: boolean;
    requestId?: string;
  } | null>(null);
  // Deduped by requestId, not by value — see the BoundsCameraTarget
  // effect below and its own doc comment.
  const lastAppliedBoundsRequestIdRef = useRef<string | null>(null);
  // Deduped by requestId, not by value — see CentreCameraTarget/
  // OrientNorthCameraTarget's own doc comments for why these two mirror
  // lastAppliedBoundsRequestIdRef rather than lastAppliedCameraTargetRef.
  const lastAppliedCentreRequestIdRef = useRef<string | null>(null);
  const lastAppliedOrientNorthRequestIdRef = useRef<string | null>(null);
  // Deduped by requestId, not by value — mirrors lastAppliedCentreRequestIdRef/
  // lastAppliedOrientNorthRequestIdRef, since two consecutive Zoom-in
  // presses (identical delta) must both apply. See ZoomCameraTarget.
  const lastAppliedZoomRequestIdRef = useRef<string | null>(null);
  // --- Camera preservation across a retry-triggered map recreation
  // (backlog item 67) ---
  // Continuously mirrors every genuine camera settle (gesture or
  // programmatic), never reset across a retry — the map-creation effect's
  // own reset block deliberately leaves this alone. Reuses the adapter's
  // already-atomic onCameraSettled payload (mapAdapter.ts) rather than
  // adding new getBearing()/getPitch() adapter methods, which would force
  // updating every existing MapLibreLike test double across the codebase
  // (the exact burden project?'s own doc comment already avoids by being
  // optional).
  const liveCameraSnapshotRef = useRef<{
    coordinate: Coordinate;
    zoom: number;
    bearingDegrees: number;
    pitchDegrees: number;
  } | null>(null);
  // True once a genuine user gesture (a real pan/pinch/rotate/pitch) has
  // moved the camera since the last time any of cameraTarget/boundsTarget/
  // centreTarget/orientNorthTarget actually applied a command — i.e. "the
  // live camera is no longer represented by any of the caller's own
  // one-shot/live target props". Deliberately never cleared by zoomTarget's
  // own apply (see the zoomTarget effect below): changeZoomBy is relative,
  // not pose-establishing, so an ordinary gesture-then-zoom sequence must
  // not silently re-arm reapplication of an unrelated stale target. Never
  // reset by the map-creation effect's reset block — must survive a retry
  // so the reset block itself can consult it.
  const hasCameraDivergedFromTargetsRef = useRef(false);
  // Bumped once per attachMap() call (not once per outer-effect run —
  // switchToFallback() calls attachMap() a second time within the same
  // outer effect, with no retryToken bump, and that second call must count
  // as its own generation too). Lets the two undeduplicated fit effects
  // below (overview-fit, warning-selection-fit) each recognise "this is my
  // first run against a freshly (re)created map instance" without needing
  // their own retryToken-shaped dependency.
  const attachGenerationRef = useRef(0);
  // Set to the generation number that needs its camera restored from
  // liveCameraSnapshotRef (see attachMap's own needsCameraSnapshotRestore
  // local) — left untouched otherwise, since a stale lower generation
  // number self-invalidates against the strictly-increasing counter above,
  // needing no explicit "clear" step.
  const cameraRestorePendingGenerationRef = useRef<number | null>(null);
  // Each lets its own effect skip its own fit exactly once per flagged
  // generation (respecting a just-applied camera restore), then resume
  // completely normal behaviour for any later, unrelated dependency change
  // within that same generation (e.g. a genuinely new warning selected).
  const overviewFitSkippedForGenerationRef = useRef<number | null>(null);
  const warningFitSkippedForGenerationRef = useRef<number | null>(null);
  // At most one automatic retry per tile-error episode (mirrors
  // hasAutoRetriedRef's identical role for the fallback episode) —
  // independent of it, since the two episode kinds are structurally
  // mutually exclusive (see onError below) and each deserves its own
  // allowance.
  const hasAutoRetriedTileErrorRef = useRef(false);
  const [loadState, setLoadState] = useState<MapLoadState>("loading");
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [tileErrorMessage, setTileErrorMessage] = useState<string | null>(null);
  const [usingFallbackStyle, setUsingFallbackStyle] = useState(false);
  const [routeSourceLoaded, setRouteSourceLoaded] = useState(false);
  const [cameraCenter, setCameraCenter] = useState<Coordinate | null>(null);
  // The map's own zoom/bearing/pitch as of the last settle — diagnostic
  // only (data-camera-zoom/-bearing/-pitch below), mirroring cameraCenter/
  // data-camera-center's existing purpose: lets a test (or a human) read
  // the map's actual live orientation rather than trusting React state
  // that may have been set from a stale pre-gesture value.
  const [cameraOrientation, setCameraOrientation] = useState<{
    zoom: number;
    bearingDegrees: number;
    pitchDegrees: number;
  } | null>(null);
  // The current-position marker's own on-screen pixel position as of the
  // last settle — diagnostic only (data-camera-follow-anchor-x/-y below,
  // backlog item 65), mirroring cameraOrientation's identical purpose:
  // lets a real-browser test prove that a genuinely followed zoom press
  // keeps the rider's coordinate at the same screen pixel (the below-
  // centre follow anchor), which the map's own reported centre
  // (cameraCenter above) cannot show while following — see
  // mapAdapter.ts's FOLLOW_VERTICAL_OFFSET_PX. Never read by any
  // production decision logic. null whenever currentPosition is absent,
  // or the map adapter doesn't implement the optional project() method
  // (every test double that doesn't exercise this diagnostic).
  const [followAnchorPixel, setFollowAnchorPixel] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // The map's own zoom, rounded to the nearest whole level and updated
  // only when the camera settles (never per animation frame) — the sole
  // input, together with route length, to the adaptive distance-badge
  // interval. null until the first camera settle on this instance;
  // selectDistanceBadgeIntervalMetres treats a non-finite zoom as needing
  // the safest, coarsest interval. Also feeds deriveMarkerZoomBand
  // (planningLayer.ts) for Planning's waypoint-marker CSS size band (see
  // the map-canvas-host data-marker-zoom-band attribute below) — reused
  // as-is rather than duplicated into a second settle-quantised state,
  // since both consumers want the same "how zoomed out am I" signal.
  const [distanceBadgeZoom, setDistanceBadgeZoom] = useState<number | null>(null);
  // True once the style document itself is structurally ready (MapLibre's
  // "style.load"), independent of whether any tile has finished loading —
  // this is what lets the route/position render before/without full
  // imagery ("imagery delayed" stage), rather than waiting for `ready`.
  const [styleStructurallyReady, setStyleStructurallyReady] = useState(false);
  // Bumped to force the map-creation effect below to tear down and
  // recreate the map against the *original* configured style — used by
  // both the manual "Retry map imagery" button and the one-shot
  // auto-retry-on-resume effect further down.
  const [retryToken, setRetryToken] = useState(0);
  // Guards the auto-retry-on-resume effect so at most one automatic retry
  // happens per fallback episode, regardless of how many visibility/online
  // events fire — reset whenever fallback is freshly (re-)activated.
  const hasAutoRetriedRef = useRef(false);
  // Set whenever this attach hits any trouble (a recoverable error, the
  // style-ready timeout, or entering fallback) and cleared once `load`
  // fires for a genuinely non-fallback style — the signal for recording
  // "imagery-recovered" (a slow-but-successful load, or a successful
  // retry), never fired for an ordinary trouble-free load.
  const hadTroubleRef = useRef(false);
  const ready = loadState === "ready";

  useEffect(() => {
    const containerElement = containerRef.current;
    if (!containerElement) return;
    // Narrowed to a new binding: TS doesn't carry the null-check narrowing
    // of `containerRef.current` through into the nested closures below.
    const container: HTMLElement = containerElement;

    let hasLoaded = false;
    let styleReady = false;
    let layersAdded = false;
    let usedFallback = false;
    let currentMap: MapLibreLike | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let routeSourceLoaded = false;
    let routeDataTimeoutId: number | undefined;
    // Tracks a currently-active *tile-error* episode (backlog item 67) —
    // distinct from usedFallback/hasLoaded, since a tile error can only
    // ever occur once hasLoaded is already true. Mirrors the existing
    // hasLoaded/styleReady/usedFallback/layersAdded convention: a fresh
    // per-attach-cycle closure local, so it naturally resets on every new
    // attach without needing its own explicit reset-block line.
    let hasActiveTileError = false;

    setLoadState("loading");
    setLoadTimedOut(false);
    setTileErrorMessage(null);
    setUsingFallbackStyle(false);
    setRouteSourceLoaded(false);
    setCameraCenter(null);
    setCameraOrientation(null);
    setFollowAnchorPixel(null);
    setDistanceBadgeZoom(null);
    setStyleStructurallyReady(false);
    lastAppliedCameraTargetRef.current = null;
    // The four one-shot dedup refs below are only reset when the live
    // camera hasn't diverged from the caller's own target props since they
    // were last applied — see hasCameraDivergedFromTargetsRef's own doc
    // comment. Left alone (matching their current prop's requestId) when
    // it has, so their effects correctly skip reapplying a now-stale
    // target once styleStructurallyReady flips true again on the freshly
    // (re)created instance, rather than silently overriding a rider's
    // manual pan/rotate/pitch gesture with a stale bounds/centre/
    // orientation/zoom request (backlog item 67). Every existing "retry
    // preserves a still-current boundsTarget/centreTarget/
    // orientNorthTarget/zoomTarget" test never places a gesture in
    // between, so hasCameraDivergedFromTargetsRef stays false throughout
    // them and this behaves exactly as before for those cases.
    if (!hasCameraDivergedFromTargetsRef.current) {
      lastAppliedBoundsRequestIdRef.current = null;
      lastAppliedCentreRequestIdRef.current = null;
      lastAppliedOrientNorthRequestIdRef.current = null;
      lastAppliedZoomRequestIdRef.current = null;
    }

    function recordAttempt(category: MapDiagnosticCategory, justResumed = false): void {
      recordMapAttempt({
        timestampIso: new Date().toISOString(),
        tileProviderId: tileSource.id,
        category,
        wasOnline: typeof navigator === "undefined" ? true : navigator.onLine,
        justResumed,
      });
    }

    function mapErrorCategoryToDiagnostic(
      category: MapErrorCategory,
    ): MapDiagnosticCategory {
      switch (category) {
        case "style-request-or-parse":
          return "style-request-or-parse-failure";
        case "source-or-tile":
          return "tile-request-failure";
        case "sprite":
          return "sprite-failure";
        case "webgl-init":
          return "webgl-init-failure";
      }
    }

    function addRouteAndPositionLayers(map: MapLibreLike): void {
      map.addGeoJsonSource(REMAINING_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addLineLayer(REMAINING_LAYER_ID, REMAINING_SOURCE_ID, {
        lineColor: "#0a5f38",
        lineWidth: legibleWidthStops(5),
      });
      map.addGeoJsonSource(COMPLETED_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addLineLayer(COMPLETED_LAYER_ID, COMPLETED_SOURCE_ID, {
        lineColor: "#8a8f8c",
        lineWidth: legibleWidthStops(5),
        lineOpacity: 0.7,
      });
      // Recognised climbs/descents (macro), the selected/active feature's
      // detailed local-gradient colouring (micro), and surface/access/
      // ferry warnings are three independent visual dimensions, layered
      // as nested "target" rings so all stay simultaneously visible
      // wherever they overlap — each subsequently-added layer here is
      // added FIRST (bottom), then progressively covered by a
      // strictly-narrower layer added after (top), which paints over only
      // the centre and leaves the wider layer's own outer margin visible
      // as a ring. That ring technique governs a whole GROUP's internal
      // order (selected-feature halo, widest of this group, first; the
      // macro layer next; the micro layer last/narrowest-equal-width, so
      // it simply wins by add-order wherever it has data) — but the
      // ENTIRE climb/descent group (widths 5-9) is added, as a whole,
      // BEFORE the entire warning group (widths 8-13) below, so a warning
      // — wider and added later — always visually wins wherever it
      // overlaps a climb/descent, per CLAUDE.md's surface-data priority.
      // Tap-hit-testing is unaffected by any of this add-order (see
      // queryTopWarningFeatureAt/queryTopRouteFeatureAt — both match by
      // explicit layer-id list, never by z-order), so warning-tap
      // priority is enforced purely by which layer is *queried first* in
      // the onMapTap handler below, not by this paint order. A setup
      // failure here must never break the rest of this function — an
      // uncoloured route is always safe to fall back to.
      //
      // Zoom-responsive width (routeWidthPolicy.ts): every width above is
      // its own unchanged close-zoom (zoom >= 15) value, so this add-order/
      // ring relationship still governs presentation exactly as before at
      // close zoom — no visible ring, since the base casing and the
      // always-on macro overlay share the same width there, matching
      // today's appearance exactly. Below that, the macro/micro colour
      // overlays (recedingWidthStops) recede faster than the neutral
      // casing and selection halos (legibleWidthStops), so at regional and
      // overview zoom the wider neutral casing begins to peek out as a
      // visible ring around the narrower coloured overlay — this is what
      // stops a route with a long recognised descent from reading as a
      // solid, geometry-obscuring block of colour once zoomed out. Warning
      // casings and the selected-warning halo (backlog item 39) use a
      // third, warningWidthStops family: it also recedes faster than
      // legibleWidthStops — an ordinary warning previously shared the
      // neutral casing's gentle curve and so visually dominated a
      // full-route overview — while staying strictly wider than
      // recedingWidthStops's own climb/descent overlay centre and
      // legibleWidthStops's own neutral route base at every zoom, and
      // wider than the selected route-feature halo (legibleWidthStops(9))
      // so a selected warning still visually outranks a selected
      // climb/descent wherever they overlap. All three families resolve
      // identically for Planning and Riding, since this function has no
      // mode branch and none was added — MapLibre itself evaluates the
      // `interpolate` expression per render frame, so none of this
      // triggers a React state update or effect on zoom.
      try {
        map.addGeoJsonSource(ROUTE_FEATURE_SELECTED_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
        map.addLineLayer(
          ROUTE_FEATURE_SELECTED_LAYER_ID,
          ROUTE_FEATURE_SELECTED_SOURCE_ID,
          ROUTE_FEATURE_SELECTED_PAINT,
        );
        map.addGeoJsonSource(ROUTE_FEATURE_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
        map.addLineLayer(ROUTE_FEATURE_LAYER_ID, ROUTE_FEATURE_SOURCE_ID, {
          lineColor: {
            property: "visualKey",
            cases: ROUTE_FEATURE_COLOURS,
            fallback: UNREACHABLE_FALLBACK_COLOUR,
          },
          lineWidth: recedingWidthStops(ROUTE_FEATURE_LAYER_WIDTH),
        });
        map.addGeoJsonSource(GRADIENT_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
        map.addLineLayer(GRADIENT_LAYER_ID, GRADIENT_SOURCE_ID, {
          lineColor: {
            property: "visualKey",
            cases: MICRO_DETAIL_COLOURS,
            fallback: UNREACHABLE_FALLBACK_COLOUR,
          },
          lineWidth: recedingWidthStops(GRADIENT_LINE_WIDTH),
        });
      } catch (error) {
        logError("map", error);
      }
      // The selected-warning layer is added first of this group (still
      // before every category) so it is never covered by a category's
      // own casing — see the nested-ring explanation above.
      map.addGeoJsonSource(WARNING_SELECTED_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addLineLayer(
        WARNING_SELECTED_LAYER_ID,
        WARNING_SELECTED_SOURCE_ID,
        WARNING_SELECTED_PAINT,
      );
      // Warning overlay: always created (fed empty collections when
      // warningOverlay is absent), matching the planning-layer precedent
      // below. Added in WARNING_CATEGORIES_IN_PAINT_ORDER so a more severe
      // category (e.g. obstacle) paints on top of a less severe one (e.g.
      // unknown-surface) wherever their segments visually overlap.
      // Distinct dash patterns, not colour alone, are what tells the
      // categories apart.
      for (const category of WARNING_CATEGORIES_IN_PAINT_ORDER) {
        map.addGeoJsonSource(
          WARNING_SOURCE_ID_BY_CATEGORY[category],
          EMPTY_FEATURE_COLLECTION,
        );
        map.addLineLayer(
          WARNING_LAYER_ID_BY_CATEGORY[category],
          WARNING_SOURCE_ID_BY_CATEGORY[category],
          WARNING_CATEGORY_PAINT[category],
        );
      }
      // Direction-arrow overlay: a single symbol layer reusing the
      // REMAINING_SOURCE_ID GeoJSON source, not a dedicated source of its
      // own. Planning never sets matchedDistanceFromStartMetres, so its
      // whole routed line already lives in "remaining"; Riding's own
      // remaining/completed split (see the points/matchedDistanceFromStartMetres
      // effect below) already excludes the completed portion and updates
      // this same source on every progress tick — so arrow coverage
      // follows both screens' existing policies for free, with no new
      // effect, and never touches the Planning dashed-preview source.
      // Placed above the warning/gradient stack but below every
      // marker/position layer that follows, so arrows stay visible over
      // whatever colours/patterns the route currently carries. A setup
      // failure here must never break the rest of this function (marker
      // layers) or force fallback — a missing decorative arrow is never
      // worth that.
      try {
        if (!map.hasImage(ROUTE_ARROW_ICON_ID)) {
          map.addImage(ROUTE_ARROW_ICON_ID, buildRouteArrowIconBitmap(), {
            pixelRatio: ROUTE_ARROW_ICON_PIXEL_RATIO,
          });
        }
        map.addSymbolLayer(
          ROUTE_ARROW_LAYER_ID,
          REMAINING_SOURCE_ID,
          ROUTE_ARROW_ICON_ID,
          {
            spacingPixels: ROUTE_ARROW_SPACING_PX,
          },
        );
      } catch (error) {
        logError("map", error);
      }
      map.addGeoJsonSource(POSITION_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addCircleLayer(POSITION_LAYER_ID, POSITION_SOURCE_ID, {
        circleRadius: 8,
        circleColor: "#1a73e8",
        circleStrokeColor: "#ffffff",
        circleStrokeWidth: 2,
      });
      // Start: filled disc. Finish: hollow ring (circle-opacity 0 plus a
      // stroke) — a different shape, not just a different colour, so the
      // two remain distinguishable without relying on hue alone.
      map.addGeoJsonSource(START_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addCircleLayer(START_LAYER_ID, START_SOURCE_ID, {
        circleRadius: 8,
        circleColor: "#0a5f38",
        circleStrokeColor: "#ffffff",
        circleStrokeWidth: 2,
      });
      map.addGeoJsonSource(FINISH_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addCircleLayer(FINISH_LAYER_ID, FINISH_SOURCE_ID, {
        circleRadius: 9,
        circleColor: "#101010",
        circleOpacity: 0,
        circleStrokeColor: "#101010",
        circleStrokeWidth: 3,
      });
      // Planning-only layers: always created (fed empty collections when
      // planningOverlay is absent), matching the start/finish precedent
      // above, so Riding mode's rendering/tests never need to know these
      // exist. Dashed line (never a solid colour alone) so it can't be
      // mistaken for a real calculated route.
      map.addGeoJsonSource(PLANNING_PREVIEW_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addLineLayer(PLANNING_PREVIEW_LAYER_ID, PLANNING_PREVIEW_SOURCE_ID, {
        lineColor: "#1a73e8",
        lineWidth: legibleWidthStops(4),
        lineOpacity: 0.85,
        lineDasharray: [2, 2],
      });
      // Planning's numbered waypoint markers are plain DOM markers (see
      // mapAdapter.ts's setMarkers/waypointMarkerElement.ts), not a
      // GeoJSON source/layer — no glyph-independent way to render ordinal
      // text through a MapLibre layer, and DOM markers already have zero
      // sprite/glyph dependency for free.
    }

    function attachMap(style: string | StyleSpecification): void {
      // Backlog item 67: each attachMap() call is its own "generation" —
      // including switchToFallback()'s second call within the SAME outer
      // effect run (no retryToken bump involved). Captured once here,
      // synchronously, so a gesture that lands after this point belongs
      // to the NEXT generation, never retroactively to this one.
      attachGenerationRef.current += 1;
      const generation = attachGenerationRef.current;
      // Captured as a VALUE here, synchronously, rather than merely
      // noting "a restore is needed" and re-reading
      // liveCameraSnapshotRef.current later inside onStyleLoaded: a
      // spurious moveend can genuinely fire on the fresh instance before
      // style.load (MapLibre settling at its own initial/default
      // transform) and would otherwise clobber the ref in between these
      // two points, restoring a bogus (0,0)/zero-zoom camera instead of
      // the rider's actual last-known one. Freezing the value now closes
      // that window without needing to gate onCameraSettled itself — see
      // its own comment for why a broad gate there is wrong.
      const cameraSnapshotToRestore = hasCameraDivergedFromTargetsRef.current
        ? liveCameraSnapshotRef.current
        : null;
      if (cameraSnapshotToRestore !== null) {
        cameraRestorePendingGenerationRef.current = generation;
      }

      const map = mapFactory({ container, style });
      currentMap = map;
      mapRef.current = map;
      routeSourceLoaded = false;
      setRouteSourceLoaded(false);
      if (routeDataTimeoutId !== undefined) window.clearTimeout(routeDataTimeoutId);

      map.onStyleLoaded(() => {
        if (layersAdded) return;
        layersAdded = true;
        styleReady = true;
        addRouteAndPositionLayers(map);
        setStyleStructurallyReady(true);
        // Restore the rider's own last-known-live camera onto this freshly
        // (re)created instance before any React effect gets a chance to
        // run — React's batching model guarantees this imperative call,
        // inside a synchronous callback, precedes every
        // styleStructurallyReady-gated effect's next commit. A plain
        // instant jump, mirroring rideCamera.ts's own existing free-mode
        // "restore" jump semantics (backlog item 67).
        if (cameraSnapshotToRestore) {
          const snapshot = cameraSnapshotToRestore;
          map.setCamera(
            snapshot.coordinate,
            snapshot.zoom,
            snapshot.bearingDegrees,
            snapshot.pitchDegrees,
            {
              animate: false,
              followOffset: false,
            },
          );
        }
        // The style becoming structurally ready only proves the style
        // document itself loaded — it says nothing about whether the
        // route's GeoJSON source ever actually finishes processing (which
        // needs a working worker). Surface a stuck source as a diagnostic
        // instead of silently doing nothing.
        routeDataTimeoutId = window.setTimeout(() => {
          if (!routeSourceLoaded) {
            logError("map", "Route data did not finish loading in time");
            recordAttempt("worker-failure");
          }
        }, ROUTE_DATA_TIMEOUT_MS);
      });

      map.onLoad(() => {
        hasLoaded = true;
        setLoadState("ready");
        if (hadTroubleRef.current && !usedFallback) {
          recordAttempt("imagery-recovered");
          hadTroubleRef.current = false;
        }
      });

      map.onSourceData((info) => {
        if (info.sourceId === REMAINING_SOURCE_ID && info.isSourceLoaded) {
          routeSourceLoaded = true;
          setRouteSourceLoaded(true);
        }
        // Only a source we didn't create ourselves can be evidence the
        // external basemap's own tiles are flowing again — our own GeoJSON
        // sources report loaded almost immediately regardless of tile
        // delivery, so treating those as recovery would clear the banner
        // on every route/position update instead of on genuine recovery.
        if (info.isSourceLoaded && !APP_OWNED_SOURCE_IDS.has(info.sourceId)) {
          hasActiveTileError = false;
          setTileErrorMessage(null);
        }
      });

      map.onUserCameraInteraction(() => {
        // Backlog item 67: a genuine gesture means the live camera is no
        // longer represented by any of the caller's own target props —
        // see hasCameraDivergedFromTargetsRef's own doc comment.
        hasCameraDivergedFromTargetsRef.current = true;
        onUserCameraInteractionRef.current?.();
      });

      map.onCameraSettled((camera) => {
        // Backlog item 67: deliberately NOT gated on styleReady. A
        // brand-new MapLibre instance can fire its own internal
        // pre-style-ready moveend settling at its initial/default
        // transform — confirmed by direct real-browser instrumentation —
        // and for an ordinary first attach with no app-issued camera
        // command at all (e.g. Planning before geolocation resolves),
        // THIS is the only settle that will ever fire, and is exactly
        // what the rest of the app already relies on to flip
        // isCameraSettled true. Gating this callback on styleReady was
        // tried and reverted: it silently broke that ordinary case
        // (confirmed via a real e2e regression, not merely reasoned
        // about). The narrower, actually-needed protection against a
        // spurious pre-load settle corrupting a pending camera restore
        // lives in attachMap's own cameraSnapshotToRestore — captured as
        // a value once, synchronously, rather than by re-reading
        // liveCameraSnapshotRef.current later.
        // Keeps the data-camera-center diagnostic attribute correct for
        // every way the camera can now move (following ease, restore
        // jump, free-mode panning), not just the initial overview fit,
        // which is the only thing that used to update it.
        setCameraCenter(camera.coordinate);
        setCameraOrientation({
          zoom: camera.zoom,
          bearingDegrees: camera.bearingDegrees,
          pitchDegrees: camera.pitchDegrees,
        });
        // Backlog item 67: continuously mirrors the live, atomic settle
        // payload so it survives a later retry's own reset — see
        // liveCameraSnapshotRef's own doc comment.
        liveCameraSnapshotRef.current = camera;
        // Quantised to the nearest whole zoom level, with a no-op guard
        // (skip the state update entirely when unchanged) — this, plus
        // only ever reading zoom here rather than per animation frame,
        // is the distance-badge interval's whole stabilisation mechanism
        // (see distanceBadgeLayer.ts's own doc comment).
        setDistanceBadgeZoom((previous) => {
          const rounded = Math.round(camera.zoom);
          return previous === rounded ? previous : rounded;
        });
        // Diagnostic-only follow-anchor readback (backlog item 65) — see
        // followAnchorPixel's own doc comment above. Computed on the same
        // settle cadence as every other data-camera-* attribute, so it is
        // always internally consistent with them (one React batch).
        const position = currentPositionRef.current;
        setFollowAnchorPixel(position ? (map.project?.(position) ?? null) : null);
        onCameraSettledRef.current?.(camera);
      });

      map.onMapTap((coordinate) => {
        // A genuine tap resolves to exactly one action, tried in strict
        // priority order: (1) a selectable warning feature — surface
        // warnings always take priority over a climb/descent, per
        // CLAUDE.md; (2) a selectable macro route feature; (3) otherwise
        // fall through to Planning's placement callback. The first match
        // stops here — never also forwards on to a later tier. Gated on
        // `layersAdded` (these layers, added alongside everything else in
        // addRouteAndPositionLayers, only exist once that's true) so a
        // tap before the style is ready, or before the fallback style's
        // own layers are up, safely degrades to "no hit" rather than
        // querying a not-yet-existent layer id.
        if (layersAdded) {
          const warnings = warningsRef.current;
          if (warnings && warnings.length > 0) {
            const hit = map.queryTopWarningFeatureAt(
              coordinate,
              WARNING_CATEGORY_LAYER_IDS,
            );
            const index = hit
              ? resolveWarningIndexHit(hit.warningIndex, warnings.length)
              : null;
            if (index !== null) {
              onSelectWarningRef.current?.(index);
              return;
            }
          }
          const features = routeFeaturesRef.current;
          if (features && features.length > 0) {
            const hit = map.queryTopRouteFeatureAt(
              coordinate,
              ROUTE_FEATURE_TAP_LAYER_IDS,
            );
            const featureId = hit
              ? resolveRouteFeatureIdHit(hit.routeFeatureId, features)
              : null;
            if (featureId !== null) {
              onSelectRouteFeatureRef.current?.(featureId);
              return;
            }
          }
        }
        onMapTapRef.current?.(coordinate);
      });

      // Only a fatal style/WebGL failure destroys the style — a
      // recoverable source/tile/sprite error (only ever reachable once
      // the style is already structurally ready, verified against
      // MapLibre's own source) leaves it alone; the "imagery delayed"
      // banner (driven by styleStructurallyReady) already reflects this.
      // An error after `ready` (the tiles-unavailable banner) keeps the
      // already-loaded route and position visible instead.
      map.onError((info) => {
        logError("map", info.message);
        recordAttempt(mapErrorCategoryToDiagnostic(info.category));

        if (hasLoaded) {
          // Backlog item 67: only a genuinely NEW tile-error episode
          // re-arms hasAutoRetriedTileErrorRef — a repeated error while
          // one is already active must not, mirroring
          // switchToFallback()'s identical "does not create a retry loop
          // from repeated errors" guarantee for the fallback episode.
          if (!hasActiveTileError) {
            hasActiveTileError = true;
            hasAutoRetriedTileErrorRef.current = false;
          }
          // A tile error is "trouble" too, so a successful recovery (via
          // a manual or automatic retry) correctly records
          // imagery-recovered through the existing onLoad check below,
          // exactly like the fallback-episode case already does.
          hadTroubleRef.current = true;
          setTileErrorMessage(info.message);
          return;
        }

        hadTroubleRef.current = true;

        if (
          info.category === "style-request-or-parse" ||
          info.category === "webgl-init"
        ) {
          if (usedFallback) {
            setLoadState("load-error");
            return;
          }
          switchToFallback();
        }
      });

      resizeObserver?.disconnect();
      // The container's on-screen size can settle after first paint (iOS
      // Safari address bar / PWA standalone-mode chrome), which would
      // otherwise leave the map computing fitBounds/camera maths against
      // stale dimensions from creation time.
      resizeObserver = new ResizeObserver(() => {
        mapRef.current?.resize();
      });
      resizeObserver.observe(container);
    }

    function switchToFallback(): void {
      if (styleReady || usedFallback) return;
      usedFallback = true;
      hasAutoRetriedRef.current = false;
      recordAttempt("fallback-activated");
      setUsingFallbackStyle(true);
      currentMap?.remove();
      attachMap(FALLBACK_STYLE);
    }

    attachMap(tileSource.styleUrl);

    // styleReady/usedFallback guard the callback, so it's a harmless
    // no-op if the style already resolved by the time this fires — no
    // need to explicitly cancel it on success. Gates on style-readiness,
    // not full imagery — see STYLE_READY_TIMEOUT_MS's own doc comment.
    const timeoutId = window.setTimeout(() => {
      if (!styleReady) {
        setLoadTimedOut(true);
        hadTroubleRef.current = true;
        recordAttempt("initial-load-timeout");
        switchToFallback();
      }
    }, STYLE_READY_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
      if (routeDataTimeoutId !== undefined) window.clearTimeout(routeDataTimeoutId);
      resizeObserver?.disconnect();
      currentMap?.remove();
      mapRef.current = null;
    };
  }, [mapFactory, tileSource.styleUrl, tileSource.id, retryToken]);

  // Tears down whatever map currently exists and re-runs the whole attach
  // effect above against the *original* configured style (never the
  // fallback) — the same "recreate against tileSource.styleUrl" path a
  // fresh mount takes. Route/position/camera are untouched by this: they
  // live in the caller's own state (see RidingScreen's useRideCamera) and
  // are simply re-applied once the retried style becomes ready again — or,
  // absent a live target prop, restored from liveCameraSnapshotRef (see
  // attachMap's own needsCameraSnapshotRestore, backlog item 67).
  //
  // Backlog item 67 also reuses this exact mechanism for the lighter
  // post-load tile-error episode (tileErrorMessage !== null), rather than
  // a second, source-scoped reload (MapLibre 6's RasterTileSource/
  // VectorTileSource setTiles() would reload one source with no map
  // teardown at all) — rejected because mapAdapter.ts's onError never
  // forwards the failing sourceId through MapErrorInfo, MapView has no
  // static handle on "the" basemap source id (only discovered reactively
  // via onSourceData), a style can in principle carry more than one
  // non-app-owned source, and the fallback-episode teardown machinery
  // must exist regardless — a second mechanism would be strictly more
  // total complexity for a narrow responsiveness win.
  function handleRetryImagery(): void {
    recordMapAttempt({
      timestampIso: new Date().toISOString(),
      tileProviderId: tileSource.id,
      category: "manual-retry",
      wasOnline: typeof navigator === "undefined" ? true : navigator.onLine,
      justResumed: false,
    });
    setRetryToken((token) => token + 1);
  }

  // At most one automatic retry per episode — independently for the
  // fallback episode (hasAutoRetriedRef) and the lighter tile-error
  // episode (hasAutoRetriedTileErrorRef, backlog item 67), each reset
  // only when its own kind of trouble is freshly (re-)entered. The two
  // episode kinds are structurally mutually exclusive (a tile error can
  // only occur once hasLoaded is true; a fallback-triggering error only
  // occurs before hasLoaded; FALLBACK_STYLE has no sources at all, so it
  // can never itself produce a source-or-tile error) — never a polling
  // loop, regardless of how many of these events fire or in what
  // combination, since handleResume only ever runs in response to an
  // actual browser-dispatched event, never self-triggered.
  useEffect(() => {
    function handleResume(): void {
      if (usingFallbackStyle && !hasAutoRetriedRef.current) {
        hasAutoRetriedRef.current = true;
      } else if (tileErrorMessage !== null && !hasAutoRetriedTileErrorRef.current) {
        hasAutoRetriedTileErrorRef.current = true;
      } else {
        return;
      }
      recordMapAttempt({
        timestampIso: new Date().toISOString(),
        tileProviderId: tileSource.id,
        category: "auto-retry",
        wasOnline: typeof navigator === "undefined" ? true : navigator.onLine,
        justResumed: true,
      });
      setRetryToken((token) => token + 1);
    }
    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") handleResume();
    }
    function handlePageShow(event: PageTransitionEvent): void {
      if (event.persisted) handleResume();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleResume);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleResume);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [usingFallbackStyle, tileErrorMessage, tileSource.id]);

  useEffect(() => {
    if (!styleStructurallyReady) return;
    const { completed, remaining } = splitRouteAtDistance(
      points,
      matchedDistanceFromStartMetres,
    );
    mapRef.current?.setGeoJsonSourceData(COMPLETED_SOURCE_ID, completed);
    mapRef.current?.setGeoJsonSourceData(REMAINING_SOURCE_ID, remaining);
  }, [points, matchedDistanceFromStartMetres, styleStructurallyReady]);

  const gradientSegments = gradientOverlay?.segments;

  // Reuses the same matchedDistanceFromStartMetres the completed/remaining
  // split and direction arrows already key off (never
  // distanceBadgeProgressMetres's frozen value — see that prop's own doc
  // comment), so during active Riding the gradient-coloured centre always
  // clips to exactly the same remaining portion as the line it recolours.
  // Recomputes only on a genuine route/progress/analysis change, never per
  // camera frame.
  useEffect(() => {
    if (!styleStructurallyReady) return;
    mapRef.current?.setGeoJsonSourceData(
      GRADIENT_SOURCE_ID,
      buildGradientFeatureCollection(
        points,
        gradientSegments ?? [],
        matchedDistanceFromStartMetres,
        points.at(-1)?.distanceFromStartMetres ?? 0,
      ),
    );
  }, [points, matchedDistanceFromStartMetres, gradientSegments, styleStructurallyReady]);

  const routeFeatures = routeFeatureOverlay?.features;
  const routeFeatureSelectedId = routeFeatureOverlay?.selectedFeatureId ?? null;

  // Macro layer: sparse, one feature per recognised climb/descent,
  // clipped to the same remaining-portion policy as the micro gradient
  // layer above (never distanceBadgeProgressMetres's frozen value — see
  // that prop's own doc comment for why matchedDistanceFromStartMetres is
  // the one shared "what's left to ride" distance every overlay clips to).
  useEffect(() => {
    if (!styleStructurallyReady) return;
    mapRef.current?.setGeoJsonSourceData(
      ROUTE_FEATURE_SOURCE_ID,
      buildRouteFeatureFeatureCollection(
        points,
        routeFeatures ?? [],
        matchedDistanceFromStartMetres,
        points.at(-1)?.distanceFromStartMetres ?? 0,
      ),
    );
  }, [points, matchedDistanceFromStartMetres, routeFeatures, styleStructurallyReady]);

  // Selected-feature halo: the feature's own complete range, never
  // clipped to the remaining portion — a selection halo should frame the
  // whole climb/descent even if part of it has already been ridden,
  // mirroring the selected-warning halo's own unclipped behaviour.
  useEffect(() => {
    if (!styleStructurallyReady) return;
    mapRef.current?.setGeoJsonSourceData(
      ROUTE_FEATURE_SELECTED_SOURCE_ID,
      buildSelectedRouteFeatureFeatureCollection(
        points,
        routeFeatures ?? [],
        routeFeatureSelectedId,
      ),
    );
  }, [points, routeFeatures, routeFeatureSelectedId, styleStructurallyReady]);

  // No camera auto-fit on route-feature selection, unlike the selected-
  // warning bounds effect below: a route feature is selectable during
  // active Riding (routeFeatureOverlay, unlike warningOverlay, is not
  // Planning-only), and yanking the camera out of "following" the instant
  // a feature is selected — or worse, merely entered — would be a real
  // safety/UX problem on a bike-mounted phone. The spec asks only for a
  // map highlight, not a camera move; omitting auto-fit here is the
  // deliberately safer choice, not an oversight.

  // Purely derived from already-available inputs (no external-system
  // round-trip needed, unlike routeSourceLoaded/cameraCenter above), so
  // it's computed directly during render rather than via an effect+state.
  // Independent of whether the source ever finishes rendering — this
  // proves real, non-empty geometry was actually submitted, catching a
  // regression in the data flow itself.
  const routeCoordinateCount = styleStructurallyReady
    ? (splitRouteAtDistance(points, matchedDistanceFromStartMetres).remaining.features[0]
        ?.geometry.coordinates.length ?? 0)
    : 0;

  // Frames the whole route once it's available, and marks the start
  // (always) and finish (only if it's not effectively the same point as
  // the start — see isLoopRoute). Keyed on `points` (referentially stable
  // for a given route — only a genuinely different route or a map reload
  // changes it), not on every position/progress update, so the view
  // doesn't jump around mid-ride. The fit itself (not the start/finish
  // markers) is skippable via suppressInitialOverviewFit, so resuming
  // into a restored following/free camera doesn't flash the full route
  // first.
  // Planning supplies its own identified start/finish/loop waypoint
  // markers (see the setMarkers effect below) — the generic route
  // start/finish circles below would otherwise draw a second,
  // indistinguishable marker at the same coordinates. A derived primitive,
  // not the planningOverlay object itself (PlanningScreen reconstructs
  // that object every render), so this doesn't spuriously re-run the
  // whole effect below on an unrelated rerender.
  const hasPlanningOverlay = planningOverlay != null;

  useEffect(() => {
    if (!styleStructurallyReady) return;

    // Backlog item 67: this effect has no dedup mechanism of its own (it
    // deliberately re-fits whenever styleStructurallyReady cycles and
    // suppressInitialOverviewFit allows it), so on a fresh generation it
    // must defer, once, to a just-applied camera restore rather than
    // silently overriding a rider's gesture-preserved camera — see
    // cameraRestorePendingGenerationRef's own doc comment. A later,
    // unrelated dependency change within the SAME generation (e.g. a new
    // calculated route) still fits normally.
    const generation = attachGenerationRef.current;
    const shouldSkipForRestore =
      cameraRestorePendingGenerationRef.current === generation &&
      overviewFitSkippedForGenerationRef.current !== generation;
    overviewFitSkippedForGenerationRef.current = generation;

    if (!suppressInitialOverviewFit && !shouldSkipForRestore) {
      const bounds = computeBoundingBox(points.map((point) => point.coordinate));
      if (bounds) {
        mapRef.current?.resize();
        mapRef.current?.fitBounds(bounds);
        const center = mapRef.current?.getCenter();
        if (center) setCameraCenter(center);
      }
    }

    if (!hasPlanningOverlay) {
      const first = points[0];
      const last = points.at(-1);
      if (first) {
        mapRef.current?.setGeoJsonSourceData(
          START_SOURCE_ID,
          buildPositionFeatureCollection(first.coordinate),
        );
      }
      mapRef.current?.setGeoJsonSourceData(
        FINISH_SOURCE_ID,
        last && !isLoopRoute(points)
          ? buildPositionFeatureCollection(last.coordinate)
          : EMPTY_FEATURE_COLLECTION,
      );
    }
  }, [points, styleStructurallyReady, suppressInitialOverviewFit, hasPlanningOverlay]);

  // Executes the camera controller's current command (live "following", a
  // one-time restore, or an explicit Riding Northwards/Follow-location
  // press) — deduped by value via a ref rather than object identity, so a
  // rerender that produces a new but logically-identical cameraTarget
  // object doesn't re-trigger setCamera. An explicit command additionally
  // carries a requestId (see CameraTarget's own doc comment): when
  // present and different from the last-applied one, it forces
  // reapplication even though the resulting values are byte-identical —
  // otherwise a repeated press after an intervening manual gesture would
  // be silently swallowed by the value check alone.
  //
  // Resizes first, mirroring the boundsTarget effect's own established
  // resize()-then-camera-op ordering below (added for the same reason: the
  // container's on-screen size can settle late, otherwise camera maths use
  // stale dimensions) — closes a confirmed, evidence-backed race in a live
  // "following" command specifically. A followOffset:true command's
  // easeTo (mapAdapter.ts's setCamera) converts its pixel offset into a
  // geographic delta using MapLibre's cached transform width/height,
  // computed once, synchronously, at the exact moment setCamera() is
  // called. Direct instrumentation of this effect (temporarily logging
  // each setCamera call's actual container rect alongside every moveend)
  // confirmed .ride-map-container--immersive's flex-fill box genuinely
  // resizes during the first second or two of an active ride, before
  // settling — ResizeObserver's own callback is asynchronous, so without
  // this resize() call, two setCamera invocations landing on either side
  // of that settle can each compute a geographically different
  // offset-adjusted centre from an otherwise identical command (the exact
  // failure this closes: CLAUDE.md item 63, "re-pressing Follow location
  // with an unchanged GPS fix, after a manual gesture, resumes
  // following"). MapLibre's own resize() (see mapAdapter.ts) is cheap and
  // idempotent, and this call is unconditional — not gated on
  // followOffset — for consistency with boundsTarget's own unconditional
  // call and to cover any future offset-sensitive command sharing this
  // effect; it has no observable effect on a north-up (offset-free)
  // command beyond an extra, harmless resync.
  useEffect(() => {
    if (!styleStructurallyReady || !cameraTarget) return;
    const lon = cameraTarget.coordinate ? cameraTarget.coordinate[0] : null;
    const lat = cameraTarget.coordinate ? cameraTarget.coordinate[1] : null;
    const last = lastAppliedCameraTargetRef.current;
    const sameValues =
      last?.lon === lon &&
      last.lat === lat &&
      last.zoom === cameraTarget.zoom &&
      last.bearingDegrees === cameraTarget.bearingDegrees &&
      last.pitchDegrees === cameraTarget.pitchDegrees &&
      last.animate === cameraTarget.animate &&
      last.followOffset === cameraTarget.followOffset;
    const isNewExplicitRequest =
      cameraTarget.requestId !== undefined && cameraTarget.requestId !== last?.requestId;
    if (sameValues && !isNewExplicitRequest) {
      return;
    }
    // Backlog item 67: only a command that fully specifies coordinate AND
    // zoom (the live "following" ease, or a free-mode restore jump) truly
    // re-establishes the ENTIRE camera pose, making the live camera once
    // again fully represented by this prop — see
    // hasCameraDivergedFromTargetsRef's own doc comment. A null
    // coordinate/zoom (Riding's own north-up-via-this-shared-pipeline,
    // rideCamera.ts's "north-up-requested") deliberately leaves centre/
    // zoom "unchanged" relative to whatever the map's CURRENT transform
    // already is — a meaningless instruction on a freshly (re)created
    // instance with no prior state, so it must NOT be treated as
    // self-contained: doing so would incorrectly suppress the snapshot
    // restore below, this exact site's own real-browser-confirmed
    // regression during implementation (a north-up press right before a
    // retry silently discarded the rider's panned position).
    if (cameraTarget.coordinate !== null && cameraTarget.zoom !== null) {
      hasCameraDivergedFromTargetsRef.current = false;
    }
    lastAppliedCameraTargetRef.current = {
      lon,
      lat,
      zoom: cameraTarget.zoom,
      bearingDegrees: cameraTarget.bearingDegrees,
      pitchDegrees: cameraTarget.pitchDegrees,
      animate: cameraTarget.animate,
      followOffset: cameraTarget.followOffset,
      requestId: cameraTarget.requestId,
    };
    mapRef.current?.resize();
    mapRef.current?.setCamera(
      cameraTarget.coordinate,
      cameraTarget.zoom,
      cameraTarget.bearingDegrees,
      cameraTarget.pitchDegrees,
      { animate: cameraTarget.animate, followOffset: cameraTarget.followOffset },
    );
  }, [cameraTarget, styleStructurallyReady]);

  // Executes an explicit "frame this area" request (Planning's
  // fresh-session auto-framing, Locate-me, and its one-time restored/
  // seeded-waypoint hydration fit) — deduped by requestId, not by value,
  // unlike cameraTarget above, so a repeated identical request still
  // re-executes. Resizes first, matching the route-overview fit above,
  // since the container's on-screen size can settle late (iOS Safari/PWA
  // chrome). fitBounds always resets bearing/pitch to 0 (see
  // mapAdapter.ts), so this satisfies north-up/top-down for free.
  useEffect(() => {
    if (!styleStructurallyReady || !boundsTarget) return;
    if (lastAppliedBoundsRequestIdRef.current === boundsTarget.requestId) return;
    lastAppliedBoundsRequestIdRef.current = boundsTarget.requestId;
    // Backlog item 67: unconditionally clears divergence (unlike
    // centreTarget/orientNorthTarget below) — fitBounds is always fully
    // self-contained, genuinely establishing coordinate, zoom AND
    // bearing/pitch (hardcoded to 0/0 in mapAdapter.ts) together, so it
    // remains correct and meaningful even on a freshly (re)created
    // instance with no prior state — see the cameraTarget effect's own
    // fuller note on why this distinction matters.
    hasCameraDivergedFromTargetsRef.current = false;
    mapRef.current?.resize();
    mapRef.current?.fitBounds(boundsTarget.bounds);
    const center = mapRef.current?.getCenter();
    if (center) setCameraCenter(center);
  }, [boundsTarget, styleStructurallyReady]);

  // Executes an explicit "recentre only" request (Planning's GPS-centre
  // control, once the session's initial regional framing has already
  // happened once) — deduped by requestId, like boundsTarget above, not by
  // value like cameraTarget. Deliberately does NOT eagerly read back
  // getCenter() the way the boundsTarget effect above does: that fit is
  // always animate:false, so an immediate read is already correct, but
  // centreOn eases, so an immediate read would capture the pre-transition
  // centre — the existing onCameraSettled handler above catches up once
  // the ease genuinely finishes, exactly like the animate:true cameraTarget
  // effect above already relies on.
  useEffect(() => {
    if (!styleStructurallyReady || !centreTarget) return;
    if (lastAppliedCentreRequestIdRef.current === centreTarget.requestId) return;
    lastAppliedCentreRequestIdRef.current = centreTarget.requestId;
    // Backlog item 67: deliberately never clears divergence here —
    // centreOn only ever specifies coordinate, always leaving zoom/
    // bearing/pitch "unchanged" relative to the map's current transform,
    // which is meaningless on a freshly (re)created instance — see the
    // cameraTarget effect's own identical, real-browser-confirmed note.
    mapRef.current?.centreOn(centreTarget.coordinate, { animate: true });
  }, [centreTarget, styleStructurallyReady]);

  // Executes an explicit "reorient to north-up/top-down" request
  // (Planning's Northwards control) — deduped by requestId, not by value,
  // via a dedicated ref rather than the shared cameraTarget pipeline's
  // lastAppliedCameraTargetRef. Reuses setCamera exactly as the shared
  // cameraTarget pipeline would (same fixed (null, null, 0, 0, ...) call);
  // only the dedup/delivery mechanism is different, so a second press after
  // an intervening manual rotation still re-applies instead of being
  // silently swallowed as a value-identical repeat.
  useEffect(() => {
    if (!styleStructurallyReady || !orientNorthTarget) return;
    if (lastAppliedOrientNorthRequestIdRef.current === orientNorthTarget.requestId)
      return;
    lastAppliedOrientNorthRequestIdRef.current = orientNorthTarget.requestId;
    // Backlog item 67: deliberately never clears divergence here — this
    // command always passes a null coordinate/zoom (leaving them
    // "unchanged"), which is meaningless on a freshly (re)created
    // instance — see the cameraTarget effect's own identical,
    // real-browser-confirmed note.
    mapRef.current?.setCamera(null, null, 0, 0, { animate: true, followOffset: false });
  }, [orientNorthTarget, styleStructurallyReady]);

  // Executes an explicit "change zoom by a fixed step" request (Planning's
  // Zoom in/out controls, backlog item 52, and Riding's/free roam's own
  // controls whenever NOT genuinely following with an actionable anchor —
  // see ZoomCameraTarget's own doc comment for the anchored case, which
  // this effect never sees at all) — deduped by requestId, like
  // centreTarget/orientNorthTarget above, not by value: a repeated
  // identical delta (two consecutive Zoom-in presses) must still re-apply
  // each time. Deliberately does NOT eagerly read back getZoom() the way
  // the boundsTarget effect does: changeZoomBy always eases (see
  // mapAdapter.ts), so an immediate read would capture the pre-transition
  // zoom — the existing onCameraSettled handler above already catches up
  // once the ease genuinely finishes, exactly like the animate:true
  // cameraTarget/centreTarget effects above already rely on.
  useEffect(() => {
    if (!styleStructurallyReady || !zoomTarget) return;
    if (lastAppliedZoomRequestIdRef.current === zoomTarget.requestId) return;
    lastAppliedZoomRequestIdRef.current = zoomTarget.requestId;
    mapRef.current?.changeZoomBy(zoomTarget.delta);
  }, [zoomTarget, styleStructurallyReady]);

  useEffect(() => {
    if (!styleStructurallyReady) return;
    mapRef.current?.setGeoJsonSourceData(
      POSITION_SOURCE_ID,
      currentPosition
        ? buildPositionFeatureCollection(currentPosition)
        : EMPTY_FEATURE_COLLECTION,
    );
  }, [currentPosition, styleStructurallyReady]);

  const planningWaypoints = planningOverlay?.waypoints;
  const planningSelectedIndex = planningOverlay?.selectedWaypointIndex ?? null;
  const planningPreviewCoordinates = planningOverlay?.previewCoordinates;

  useEffect(() => {
    if (!styleStructurallyReady) return;
    mapRef.current?.setMarkers(
      buildWaypointMarkerSpecs(planningWaypoints ?? [], planningSelectedIndex),
    );
  }, [planningWaypoints, planningSelectedIndex, styleStructurallyReady]);

  // Distance-from-start badges: an entirely independent marker
  // collection from the waypoint markers above (see setDistanceBadges),
  // recomputed only when the route, the settled zoom band, or the
  // rider's frozen ahead/completed progress actually changes — never on
  // every animation frame. `points` already carries whatever Planning/
  // Riding currently consider "the route" (empty until routed for
  // Planning, the full canonical route for Riding), so this needs no
  // camera-mode awareness of its own: "unfiltered" already falls out of
  // distanceBadgeProgressMetres being null.
  useEffect(() => {
    if (!styleStructurallyReady) return;
    const routeLengthMetres = points.at(-1)?.distanceFromStartMetres ?? 0;
    const intervalMetres = selectDistanceBadgeIntervalMetres(
      distanceBadgeZoom ?? Number.NaN,
      routeLengthMetres,
    );
    mapRef.current?.setDistanceBadges(
      buildDistanceBadgeMarkerSpecs(
        points,
        intervalMetres,
        distanceBadgeProgressMetres ?? null,
      ),
    );
  }, [points, distanceBadgeZoom, distanceBadgeProgressMetres, styleStructurallyReady]);

  useEffect(() => {
    if (!styleStructurallyReady) return;
    mapRef.current?.setGeoJsonSourceData(
      PLANNING_PREVIEW_SOURCE_ID,
      buildUnroutedPreviewFeatureCollection(planningPreviewCoordinates ?? []),
    );
  }, [planningPreviewCoordinates, styleStructurallyReady]);

  const warningOverlayWarnings = warningOverlay?.warnings;
  const warningOverlaySelectedIndex = warningOverlay?.selectedWarningIndex ?? null;

  // Populates all 6 category sources. Deliberately depends on `points`
  // too (unlike the planning-waypoint effect above) — warning geometry is
  // sliced from the route's own points, so a route recalculation must
  // re-slice it, not just re-run when the warnings list identity changes.
  useEffect(() => {
    if (!styleStructurallyReady) return;
    const collectionsByCategory = buildWarningFeatureCollectionsByCategory(
      points,
      warningOverlayWarnings ?? [],
    );
    for (const category of WARNING_CATEGORIES_IN_PAINT_ORDER) {
      mapRef.current?.setGeoJsonSourceData(
        WARNING_SOURCE_ID_BY_CATEGORY[category],
        collectionsByCategory[category],
      );
    }
  }, [points, warningOverlayWarnings, styleStructurallyReady]);

  // Populates the selected-warning source separately from the category
  // sources above, so selecting/clearing a warning (a frequent action)
  // never has to rebuild all 6 category collections.
  useEffect(() => {
    if (!styleStructurallyReady) return;
    mapRef.current?.setGeoJsonSourceData(
      WARNING_SELECTED_SOURCE_ID,
      buildSelectedWarningFeatureCollection(
        points,
        warningOverlayWarnings ?? [],
        warningOverlaySelectedIndex,
      ),
    );
  }, [
    points,
    warningOverlayWarnings,
    warningOverlaySelectedIndex,
    styleStructurallyReady,
  ]);

  // Frames the selected warning's own segment — a Planning-only camera
  // action, reusing the same fitBounds adapter method as the initial
  // overview fit. Only fires on *selecting* (computeSelectedWarningBounds
  // returns a bounds only for a valid selection); clearing a selection
  // never moves the camera. This effect is unreachable unless a caller
  // supplies warningOverlay — Riding never does — so it cannot leak into
  // Riding's camera state.
  useEffect(() => {
    if (!styleStructurallyReady) return;
    // Backlog item 67: mirrors the overview-fit effect's own generation-
    // scoped "skip once, then resume normal behaviour" treatment — this
    // effect also has no dedup mechanism of its own, so on a fresh
    // generation it must defer, once, to a just-applied camera restore
    // rather than silently overriding it. A later, genuinely new warning
    // selected within the SAME generation still fits normally.
    const generation = attachGenerationRef.current;
    const shouldSkipForRestore =
      cameraRestorePendingGenerationRef.current === generation &&
      warningFitSkippedForGenerationRef.current !== generation;
    warningFitSkippedForGenerationRef.current = generation;
    if (shouldSkipForRestore) return;
    const bounds = computeSelectedWarningBounds(
      points,
      warningOverlayWarnings ?? [],
      warningOverlaySelectedIndex,
    );
    if (!bounds) return;
    mapRef.current?.fitBounds(bounds);
  }, [
    warningOverlaySelectedIndex,
    warningOverlayWarnings,
    points,
    styleStructurallyReady,
  ]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        // map-canvas-host: distinct from the unrelated screen-level
        // .ride-map-container/.planning-map-container wrapper classes in
        // RidingScreen.tsx/PlanningScreen.tsx. MapLibre appends every
        // marker (including Planning's waypoint markers) as a descendant
        // of this element, so data-marker-zoom-band cascades a CSS-only
        // size band to every marker with no per-marker JS work and no
        // marker rebuild on zoom — see index.css's descendant rules and
        // planningLayer.ts's deriveMarkerZoomBand.
        className="map-canvas-host"
        data-testid="map-container"
        data-route-coordinate-count={routeCoordinateCount}
        data-route-loaded={routeSourceLoaded ? "true" : "false"}
        // Diagnostic-only (map-imagery-recovery E2E hardening, see
        // CLAUDE.md's own item-67 follow-up): mirrors the existing `ready`
        // variable (loadState === "ready", MapLibre's own "load" event —
        // every initially in-view tile settled) so a real-browser test can
        // wait for the map's OWN full initial load to genuinely finish
        // before deliberately failing a later tile, rather than the much
        // weaker "at least one tile request happened" proxy. Never read by
        // any production decision logic, mirroring data-route-loaded/
        // data-camera-* above.
        data-map-ready={ready ? "true" : "false"}
        data-camera-center={
          cameraCenter ? `${String(cameraCenter[0])},${String(cameraCenter[1])}` : ""
        }
        data-camera-zoom={cameraOrientation ? String(cameraOrientation.zoom) : ""}
        data-camera-bearing={
          cameraOrientation ? String(cameraOrientation.bearingDegrees) : ""
        }
        data-camera-pitch={
          cameraOrientation ? String(cameraOrientation.pitchDegrees) : ""
        }
        data-camera-follow-anchor-x={followAnchorPixel ? String(followAnchorPixel.x) : ""}
        data-camera-follow-anchor-y={followAnchorPixel ? String(followAnchorPixel.y) : ""}
        data-marker-zoom-band={deriveMarkerZoomBand(distanceBadgeZoom ?? Number.NaN)}
        style={{ width: "100%", height: "100%" }}
      />
      {/* Backlog item 67: a single, always-rendered, map-owned overlay
          slot for every status/error banner below — confirmed
          structurally mutually exclusive with each other (traced every
          combination of loadState/styleStructurallyReady/ready/
          usingFallbackStyle/tileErrorMessage), so at most one ever
          renders here at once. Contained within the map (never resizes
          the fixed Riding shell), positioned to clear every known
          sibling control cluster and .ride-climb-cue — see
          .map-status-overlay's own CSS comment for the exact offset
          rationale. Rider-facing text is always concise and
          non-technical; the raw MapLibre error message is still passed
          to logError/recordMapAttempt above, so full detail remains in
          local Diagnostics. */}
      <div className="map-status-overlay">
        {loadState === "loading" && !styleStructurallyReady ? (
          <div role="status" data-testid="map-loading" className="map-status-message">
            {loadTimedOut
              ? "Map is taking longer than expected to load."
              : "Loading map…"}
          </div>
        ) : null}
        {styleStructurallyReady && !ready && !usingFallbackStyle ? (
          <div
            role="status"
            data-testid="map-imagery-delayed-banner"
            className="map-status-message"
          >
            Map imagery is taking longer than usual to load. Your route and position are
            still shown.
          </div>
        ) : null}
        {loadState === "load-error" ? (
          <div
            role="alert"
            data-testid="map-load-error"
            className="map-status-message map-status-message--alert"
          >
            Map failed to load. Check your connection and try again.
            <button
              type="button"
              onClick={handleRetryImagery}
              data-testid="retry-map-imagery-button"
              className="map-status-retry-button"
            >
              Retry map imagery
            </button>
          </div>
        ) : null}
        {tileErrorMessage !== null ? (
          <div
            role="status"
            data-testid="tiles-unavailable-banner"
            className="map-status-message"
          >
            Map imagery unavailable. The route and your position are still shown.
            <button
              type="button"
              onClick={handleRetryImagery}
              data-testid="retry-map-imagery-button"
              className="map-status-retry-button"
            >
              Retry map imagery
            </button>
          </div>
        ) : null}
        {usingFallbackStyle && ready ? (
          <div
            role="status"
            data-testid="map-fallback-banner"
            className="map-status-message"
          >
            Map imagery unavailable — showing your route on a plain background.
            <button
              type="button"
              onClick={handleRetryImagery}
              data-testid="retry-map-imagery-button"
              className="map-status-retry-button"
            >
              Retry map imagery
            </button>
          </div>
        ) : null}
      </div>
      <div className="map-attribution" data-testid="map-attribution">
        ©{" "}
        <a href={tileSource.attribution.url} target="_blank" rel="noreferrer">
          {tileSource.attribution.text}
        </a>
      </div>
    </div>
  );
}
