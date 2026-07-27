import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";
import type { Coordinate, RoutePoint, RouteWarning } from "../domain/types.ts";
import { logError } from "../platform/errorLog.ts";
import {
  createMapLibreMap,
  type LineLayerPaint,
  type MapErrorCategory,
  type MapFactory,
  type MapLibreLike,
} from "./mapAdapter.ts";
import { recordMapAttempt, type MapDiagnosticCategory } from "./mapDiagnostics.ts";
import {
  buildPositionFeatureCollection,
  computeBoundingBox,
  EMPTY_FEATURE_COLLECTION,
  isLoopRoute,
  splitRouteAtDistance,
} from "./routeLayer.ts";
import {
  buildUnroutedPreviewFeatureCollection,
  buildWaypointFeatureCollections,
  type PlanningOverlayWaypoint,
} from "./planningLayer.ts";
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
const PLANNING_WAYPOINTS_SOURCE_ID = "acn-planning-waypoints";
const PLANNING_WAYPOINTS_LAYER_ID = "acn-planning-waypoints-marker";
const PLANNING_SELECTED_WAYPOINT_SOURCE_ID = "acn-planning-waypoint-selected";
const PLANNING_SELECTED_WAYPOINT_LAYER_ID = "acn-planning-waypoint-selected-marker";

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
 * not the app's own light/dark-scheme background. */
const WARNING_CATEGORY_PAINT: Readonly<Record<WarningCategory, LineLayerPaint>> = {
  "unknown-surface": { lineColor: "#5f6368", lineWidth: 4, lineDasharray: [1, 3] },
  other: { lineColor: "#455a64", lineWidth: 5, lineDasharray: [2, 2, 6, 2] },
  ferry: { lineColor: "#0d47a1", lineWidth: 5, lineDasharray: [8, 4] },
  "questionable-surface": { lineColor: "#f2a900", lineWidth: 5, lineDasharray: [4, 2] },
  "unsuitable-surface": { lineColor: "#d32f2f", lineWidth: 6, lineDasharray: [6, 2] },
  obstacle: { lineColor: "#7b1fa2", lineWidth: 6, lineDasharray: [1, 1, 5, 1] },
};
/** Solid (no dash) and wider than any category above — contrasts with
 * every dashed category rather than just repeating one of their colours. */
const WARNING_SELECTED_PAINT: LineLayerPaint = { lineColor: "#000000", lineWidth: 8 };

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
  PLANNING_WAYPOINTS_SOURCE_ID,
  PLANNING_SELECTED_WAYPOINT_SOURCE_ID,
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

export interface MapViewProps {
  points: readonly RoutePoint[];
  /** Distance already ridden; the route line before this point is shown
   * dimmed as "completed" and the rest highlighted as "remaining". Omit
   * (or 0) to show the whole route as upcoming, e.g. a library preview. */
  matchedDistanceFromStartMetres?: number;
  currentPosition?: Coordinate;
  tileSource?: TileSourceConfig;
  mapFactory?: MapFactory;
  /** The camera MapView should be showing right now, or null/undefined to
   * leave the camera under the default overview fit / user control. Set
   * by the riding camera controller (useRideCamera) to drive "following"
   * or a one-time restore of a previously free-panned position. */
  cameraTarget?: CameraTarget | null;
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
  currentPosition,
  tileSource = DEFAULT_TILE_SOURCE,
  mapFactory = createMapLibreMap,
  cameraTarget = null,
  suppressInitialOverviewFit = false,
  onUserCameraInteraction,
  onCameraSettled,
  planningOverlay,
  warningOverlay,
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
  const lastAppliedCameraTargetRef = useRef<{
    lon: number | null;
    lat: number | null;
    zoom: number | null;
    bearingDegrees: number;
    pitchDegrees: number;
    animate: boolean;
    followOffset: boolean;
  } | null>(null);
  const [loadState, setLoadState] = useState<MapLoadState>("loading");
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [tileErrorMessage, setTileErrorMessage] = useState<string | null>(null);
  const [usingFallbackStyle, setUsingFallbackStyle] = useState(false);
  const [routeSourceLoaded, setRouteSourceLoaded] = useState(false);
  const [cameraCenter, setCameraCenter] = useState<Coordinate | null>(null);
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

    setLoadState("loading");
    setLoadTimedOut(false);
    setLoadErrorMessage(null);
    setTileErrorMessage(null);
    setUsingFallbackStyle(false);
    setRouteSourceLoaded(false);
    setCameraCenter(null);
    setStyleStructurallyReady(false);
    lastAppliedCameraTargetRef.current = null;

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
        lineWidth: 5,
      });
      map.addGeoJsonSource(COMPLETED_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addLineLayer(COMPLETED_LAYER_ID, COMPLETED_SOURCE_ID, {
        lineColor: "#8a8f8c",
        lineWidth: 5,
        lineOpacity: 0.7,
      });
      // Warning overlay: always created (fed empty collections when
      // warningOverlay is absent), matching the planning-layer precedent
      // below. Added right above the base route lines but before every
      // marker layer, so warnings never obscure the current-position,
      // start/finish or planning-waypoint markers. Added in
      // WARNING_CATEGORIES_IN_PAINT_ORDER so a more severe category (e.g.
      // obstacle) paints on top of a less severe one (e.g. unknown-surface)
      // wherever their segments visually overlap. Distinct dash patterns,
      // not colour alone, are what tells the categories apart. The
      // selected-warning layer is added last of all six so it's never
      // obscured by any category.
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
      map.addGeoJsonSource(WARNING_SELECTED_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addLineLayer(
        WARNING_SELECTED_LAYER_ID,
        WARNING_SELECTED_SOURCE_ID,
        WARNING_SELECTED_PAINT,
      );
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
        lineWidth: 4,
        lineOpacity: 0.85,
        lineDasharray: [2, 2],
      });
      map.addGeoJsonSource(PLANNING_WAYPOINTS_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
      map.addCircleLayer(PLANNING_WAYPOINTS_LAYER_ID, PLANNING_WAYPOINTS_SOURCE_ID, {
        circleRadius: 7,
        circleColor: "#f2a900",
        circleStrokeColor: "#ffffff",
        circleStrokeWidth: 2,
      });
      // Selected waypoint: larger radius, not just a different colour, so
      // it stays distinguishable without relying on hue alone.
      map.addGeoJsonSource(
        PLANNING_SELECTED_WAYPOINT_SOURCE_ID,
        EMPTY_FEATURE_COLLECTION,
      );
      map.addCircleLayer(
        PLANNING_SELECTED_WAYPOINT_LAYER_ID,
        PLANNING_SELECTED_WAYPOINT_SOURCE_ID,
        {
          circleRadius: 11,
          circleColor: "#d32f2f",
          circleStrokeColor: "#ffffff",
          circleStrokeWidth: 3,
        },
      );
    }

    function attachMap(style: string | StyleSpecification): void {
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
          setTileErrorMessage(null);
        }
      });

      map.onUserCameraInteraction(() => {
        onUserCameraInteractionRef.current?.();
      });

      map.onCameraSettled((camera) => {
        // Keeps the data-camera-center diagnostic attribute correct for
        // every way the camera can now move (following ease, restore
        // jump, free-mode panning), not just the initial overview fit,
        // which is the only thing that used to update it.
        setCameraCenter(camera.coordinate);
        onCameraSettledRef.current?.(camera);
      });

      map.onMapTap((coordinate) => {
        // A genuine tap resolves to exactly one action: if it hits a
        // selectable warning feature, select that warning and stop —
        // never also forward to Planning's placement callback. Gated on
        // `layersAdded` (the warning category layers, added alongside
        // everything else in addRouteAndPositionLayers, only exist once
        // that's true) so a tap before the style is ready, or before the
        // fallback style's own layers are up, safely degrades to "no
        // hit" rather than querying a not-yet-existent layer id.
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
            setLoadErrorMessage(info.message);
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
  // are simply re-applied once the retried style becomes ready again.
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

  // At most one automatic retry per fallback episode: guarded by
  // hasAutoRetriedRef (reset only when fallback is freshly (re-)entered),
  // regardless of how many of these events fire or in what combination —
  // never a polling loop.
  useEffect(() => {
    function handleResume(): void {
      if (!usingFallbackStyle || hasAutoRetriedRef.current) return;
      hasAutoRetriedRef.current = true;
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
  }, [usingFallbackStyle, tileSource.id]);

  useEffect(() => {
    if (!styleStructurallyReady) return;
    const { completed, remaining } = splitRouteAtDistance(
      points,
      matchedDistanceFromStartMetres,
    );
    mapRef.current?.setGeoJsonSourceData(COMPLETED_SOURCE_ID, completed);
    mapRef.current?.setGeoJsonSourceData(REMAINING_SOURCE_ID, remaining);
  }, [points, matchedDistanceFromStartMetres, styleStructurallyReady]);

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
  useEffect(() => {
    if (!styleStructurallyReady) return;

    if (!suppressInitialOverviewFit) {
      const bounds = computeBoundingBox(points.map((point) => point.coordinate));
      if (bounds) {
        mapRef.current?.resize();
        mapRef.current?.fitBounds(bounds);
        const center = mapRef.current?.getCenter();
        if (center) setCameraCenter(center);
      }
    }

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
  }, [points, styleStructurallyReady, suppressInitialOverviewFit]);

  // Executes the camera controller's current command (live "following" or
  // a one-time restore) — deduped by value via a ref rather than object
  // identity, so a rerender that produces a new but logically-identical
  // cameraTarget object doesn't re-trigger setCamera.
  useEffect(() => {
    if (!styleStructurallyReady || !cameraTarget) return;
    const lon = cameraTarget.coordinate ? cameraTarget.coordinate[0] : null;
    const lat = cameraTarget.coordinate ? cameraTarget.coordinate[1] : null;
    const last = lastAppliedCameraTargetRef.current;
    if (
      last?.lon === lon &&
      last.lat === lat &&
      last.zoom === cameraTarget.zoom &&
      last.bearingDegrees === cameraTarget.bearingDegrees &&
      last.pitchDegrees === cameraTarget.pitchDegrees &&
      last.animate === cameraTarget.animate &&
      last.followOffset === cameraTarget.followOffset
    ) {
      return;
    }
    lastAppliedCameraTargetRef.current = {
      lon,
      lat,
      zoom: cameraTarget.zoom,
      bearingDegrees: cameraTarget.bearingDegrees,
      pitchDegrees: cameraTarget.pitchDegrees,
      animate: cameraTarget.animate,
      followOffset: cameraTarget.followOffset,
    };
    mapRef.current?.setCamera(
      cameraTarget.coordinate,
      cameraTarget.zoom,
      cameraTarget.bearingDegrees,
      cameraTarget.pitchDegrees,
      { animate: cameraTarget.animate, followOffset: cameraTarget.followOffset },
    );
  }, [cameraTarget, styleStructurallyReady]);

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
    const { others, selected } = buildWaypointFeatureCollections(
      planningWaypoints ?? [],
      planningSelectedIndex,
    );
    mapRef.current?.setGeoJsonSourceData(PLANNING_WAYPOINTS_SOURCE_ID, others);
    mapRef.current?.setGeoJsonSourceData(PLANNING_SELECTED_WAYPOINT_SOURCE_ID, selected);
  }, [planningWaypoints, planningSelectedIndex, styleStructurallyReady]);

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
        data-testid="map-container"
        data-route-coordinate-count={routeCoordinateCount}
        data-route-loaded={routeSourceLoaded ? "true" : "false"}
        data-camera-center={
          cameraCenter ? `${String(cameraCenter[0])},${String(cameraCenter[1])}` : ""
        }
        style={{ width: "100%", height: "100%" }}
      />
      {loadState === "loading" && !styleStructurallyReady ? (
        <div role="status" data-testid="map-loading">
          {loadTimedOut ? "Map is taking longer than expected to load." : "Loading map…"}
        </div>
      ) : null}
      {styleStructurallyReady && !ready && !usingFallbackStyle ? (
        <div role="status" data-testid="map-imagery-delayed-banner">
          Map imagery is taking longer than usual to load. Your route and position are
          still shown.
        </div>
      ) : null}
      {loadState === "load-error" ? (
        <div role="alert" data-testid="map-load-error">
          Map failed to load.{loadErrorMessage ? ` (${loadErrorMessage})` : ""}
        </div>
      ) : null}
      {tileErrorMessage !== null ? (
        <div role="status" data-testid="tiles-unavailable-banner">
          Map tiles unavailable. The route and your position are still shown.
          {` (${tileErrorMessage})`}
        </div>
      ) : null}
      {usingFallbackStyle && ready ? (
        <div role="status" data-testid="map-fallback-banner">
          Map imagery unavailable — showing your route on a plain background.
          <button
            type="button"
            onClick={handleRetryImagery}
            data-testid="retry-map-imagery-button"
            style={{ display: "block", minHeight: 56, minWidth: 200, marginTop: 8 }}
          >
            Retry map imagery
          </button>
        </div>
      ) : null}
      <div className="map-attribution" data-testid="map-attribution">
        ©{" "}
        <a href={tileSource.attribution.url} target="_blank" rel="noreferrer">
          {tileSource.attribution.text}
        </a>
      </div>
    </div>
  );
}
