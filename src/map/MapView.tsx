import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";
import type { Coordinate, RoutePoint } from "../domain/types.ts";
import { logError } from "../platform/errorLog.ts";
import { createMapLibreMap, type MapFactory, type MapLibreLike } from "./mapAdapter.ts";
import {
  buildPositionFeatureCollection,
  computeBoundingBox,
  EMPTY_FEATURE_COLLECTION,
  isLoopRoute,
  splitRouteAtDistance,
} from "./routeLayer.ts";
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

/** How long to wait for the map's first `load` before falling back to the
 * local neutral background — the tile provider is external and unreliable
 * (see CLAUDE.md: the ride display must degrade usefully without it). */
const LOAD_TIMEOUT_MS = 10_000;

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
  coordinate: Coordinate;
  zoom: number;
  /** true: eases (live "following"). false: jumps instantly with no
   * offset (restoring a previously free-panned position). */
  animate: boolean;
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
  onCameraSettled?: (camera: { coordinate: Coordinate; zoom: number }) => void;
}

/**
 * Route and position are added as GeoJSON sources/layers independent of
 * the base style's own tile source, so a tile-loading failure never
 * removes them — only the base map imagery is affected, and an explicit
 * banner tells the rider that's happened. If the configured tile source
 * doesn't load at all within LOAD_TIMEOUT_MS (or errors immediately), the
 * map falls back to a fully local, network-free style so the route and
 * position always render regardless of tile-provider reachability.
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
  const lastAppliedCameraTargetRef = useRef<{
    lon: number;
    lat: number;
    zoom: number;
    animate: boolean;
  } | null>(null);
  const [loadState, setLoadState] = useState<MapLoadState>("loading");
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [tileErrorMessage, setTileErrorMessage] = useState<string | null>(null);
  const [usingFallbackStyle, setUsingFallbackStyle] = useState(false);
  const [routeSourceLoaded, setRouteSourceLoaded] = useState(false);
  const [cameraCenter, setCameraCenter] = useState<Coordinate | null>(null);
  const ready = loadState === "ready";

  useEffect(() => {
    const containerElement = containerRef.current;
    if (!containerElement) return;
    // Narrowed to a new binding: TS doesn't carry the null-check narrowing
    // of `containerRef.current` through into the nested closures below.
    const container: HTMLElement = containerElement;

    let hasLoaded = false;
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
    lastAppliedCameraTargetRef.current = null;

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
    }

    function attachMap(style: string | StyleSpecification): void {
      const map = mapFactory({ container, style });
      currentMap = map;
      mapRef.current = map;
      routeSourceLoaded = false;
      setRouteSourceLoaded(false);
      if (routeDataTimeoutId !== undefined) window.clearTimeout(routeDataTimeoutId);

      map.onLoad(() => {
        hasLoaded = true;
        addRouteAndPositionLayers(map);
        setLoadState("ready");
        // The map reaching "ready" only proves the style loaded — it says
        // nothing about whether the route's GeoJSON source ever actually
        // finishes processing (which needs a working worker). Surface a
        // stuck source as a diagnostic instead of silently doing nothing.
        routeDataTimeoutId = window.setTimeout(() => {
          if (!routeSourceLoaded) {
            logError("map", "Route data did not finish loading in time");
          }
        }, ROUTE_DATA_TIMEOUT_MS);
      });

      map.onSourceData((info) => {
        if (info.sourceId === REMAINING_SOURCE_ID && info.isSourceLoaded) {
          routeSourceLoaded = true;
          setRouteSourceLoaded(true);
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

      // A map error before the first `load` means this style never became
      // usable — fall back to the local neutral style rather than leaving
      // the rider with a permanently broken map. An error after `ready`
      // (the existing tiles-unavailable banner) keeps the already-loaded
      // route and position visible instead.
      map.onError((info) => {
        logError("map", info.message);
        if (hasLoaded) {
          setTileErrorMessage(info.message);
          return;
        }
        if (usedFallback) {
          setLoadState("load-error");
          setLoadErrorMessage(info.message);
          return;
        }
        switchToFallback();
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
      if (hasLoaded || usedFallback) return;
      usedFallback = true;
      setUsingFallbackStyle(true);
      currentMap?.remove();
      attachMap(FALLBACK_STYLE);
    }

    attachMap(tileSource.styleUrl);

    // hasLoaded/usedFallback guard the callback, so it's a harmless no-op
    // if the map already resolved by the time this fires — no need to
    // explicitly cancel it on success.
    const timeoutId = window.setTimeout(() => {
      if (!hasLoaded) {
        setLoadTimedOut(true);
        switchToFallback();
      }
    }, LOAD_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
      if (routeDataTimeoutId !== undefined) window.clearTimeout(routeDataTimeoutId);
      resizeObserver?.disconnect();
      currentMap?.remove();
      mapRef.current = null;
    };
  }, [mapFactory, tileSource.styleUrl]);

  useEffect(() => {
    if (!ready) return;
    const { completed, remaining } = splitRouteAtDistance(
      points,
      matchedDistanceFromStartMetres,
    );
    mapRef.current?.setGeoJsonSourceData(COMPLETED_SOURCE_ID, completed);
    mapRef.current?.setGeoJsonSourceData(REMAINING_SOURCE_ID, remaining);
  }, [points, matchedDistanceFromStartMetres, ready]);

  // Purely derived from already-available inputs (no external-system
  // round-trip needed, unlike routeSourceLoaded/cameraCenter above), so
  // it's computed directly during render rather than via an effect+state.
  // Independent of whether the source ever finishes rendering — this
  // proves real, non-empty geometry was actually submitted, catching a
  // regression in the data flow itself.
  const routeCoordinateCount = ready
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
    if (!ready) return;

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
  }, [points, ready, suppressInitialOverviewFit]);

  // Executes the camera controller's current command (live "following" or
  // a one-time restore) — deduped by value via a ref rather than object
  // identity, so a rerender that produces a new but logically-identical
  // cameraTarget object doesn't re-trigger setCamera.
  useEffect(() => {
    if (!ready || !cameraTarget) return;
    const [lon, lat] = cameraTarget.coordinate;
    const last = lastAppliedCameraTargetRef.current;
    if (
      last?.lon === lon &&
      last.lat === lat &&
      last.zoom === cameraTarget.zoom &&
      last.animate === cameraTarget.animate
    ) {
      return;
    }
    lastAppliedCameraTargetRef.current = {
      lon,
      lat,
      zoom: cameraTarget.zoom,
      animate: cameraTarget.animate,
    };
    mapRef.current?.setCamera(cameraTarget.coordinate, cameraTarget.zoom, {
      animate: cameraTarget.animate,
    });
  }, [cameraTarget, ready]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.setGeoJsonSourceData(
      POSITION_SOURCE_ID,
      currentPosition
        ? buildPositionFeatureCollection(currentPosition)
        : EMPTY_FEATURE_COLLECTION,
    );
  }, [currentPosition, ready]);

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
      {loadState === "loading" ? (
        <div role="status" data-testid="map-loading">
          {loadTimedOut ? "Map is taking longer than expected to load." : "Loading map…"}
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
        </div>
      ) : null}
      <div data-testid="map-attribution">
        ©{" "}
        <a href={tileSource.attribution.url} target="_blank" rel="noreferrer">
          {tileSource.attribution.text}
        </a>
      </div>
    </div>
  );
}
