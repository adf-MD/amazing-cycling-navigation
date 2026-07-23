import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Coordinate, RoutePoint } from "../domain/types.ts";
import { createMapLibreMap, type MapFactory, type MapLibreLike } from "./mapAdapter.ts";
import {
  buildPositionFeatureCollection,
  computeBoundingBox,
  EMPTY_FEATURE_COLLECTION,
  splitRouteAtDistance,
} from "./routeLayer.ts";
import { DEFAULT_TILE_SOURCE, type TileSourceConfig } from "./tileSource.ts";

const COMPLETED_SOURCE_ID = "acn-route-completed";
const REMAINING_SOURCE_ID = "acn-route-remaining";
const POSITION_SOURCE_ID = "acn-position";
const COMPLETED_LAYER_ID = "acn-route-completed-line";
const REMAINING_LAYER_ID = "acn-route-remaining-line";
const POSITION_LAYER_ID = "acn-position-marker";

/** How long to wait for the map's first `load` before telling the rider it's
 * taking longer than expected, rather than leaving them looking at a default
 * view with no indication anything is happening. */
const LOAD_TIMEOUT_MS = 10_000;

type MapLoadState = "loading" | "ready" | "load-error";

export interface MapViewProps {
  points: readonly RoutePoint[];
  /** Distance already ridden; the route line before this point is shown
   * dimmed as "completed" and the rest highlighted as "remaining". Omit
   * (or 0) to show the whole route as upcoming, e.g. a library preview. */
  matchedDistanceFromStartMetres?: number;
  currentPosition?: Coordinate;
  tileSource?: TileSourceConfig;
  mapFactory?: MapFactory;
}

/**
 * Route and position are added as GeoJSON sources/layers independent of
 * the base style's own tile source, so a tile-loading failure never
 * removes them — only the base map imagery is affected, and an explicit
 * banner tells the rider that's happened.
 */
export function MapView({
  points,
  matchedDistanceFromStartMetres = 0,
  currentPosition,
  tileSource = DEFAULT_TILE_SOURCE,
  mapFactory = createMapLibreMap,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreLike | null>(null);
  const [loadState, setLoadState] = useState<MapLoadState>("loading");
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [tileErrorMessage, setTileErrorMessage] = useState<string | null>(null);
  const ready = loadState === "ready";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let hasLoaded = false;
    setLoadState("loading");
    setLoadTimedOut(false);
    setLoadErrorMessage(null);
    setTileErrorMessage(null);
    const map = mapFactory({ container, styleUrl: tileSource.styleUrl });
    mapRef.current = map;

    map.onLoad(() => {
      hasLoaded = true;
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
      setLoadState("ready");
    });

    // A map error before the first `load` means the map never became
    // usable at all — distinct from (and shown instead of) the post-ready
    // "tiles unavailable" banner, which keeps the already-loaded route and
    // position visible.
    map.onError((info) => {
      if (hasLoaded) {
        setTileErrorMessage(info.message);
      } else {
        setLoadState("load-error");
        setLoadErrorMessage(info.message);
      }
    });

    const timeoutId = window.setTimeout(() => {
      if (!hasLoaded) {
        setLoadTimedOut(true);
      }
    }, LOAD_TIMEOUT_MS);

    // The container's on-screen size can settle after first paint (iOS
    // Safari address bar / PWA standalone-mode chrome), which would
    // otherwise leave the map computing fitBounds/camera maths against
    // stale dimensions from creation time.
    const resizeObserver = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    resizeObserver.observe(container);

    return () => {
      window.clearTimeout(timeoutId);
      resizeObserver.disconnect();
      map.remove();
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

  // Frames the whole route once it's available. Keyed on `points`
  // (referentially stable for a given route — only a genuinely different
  // route or a map reload changes it), not on every position/progress
  // update, so the view doesn't jump around mid-ride.
  useEffect(() => {
    if (!ready) return;
    const bounds = computeBoundingBox(points.map((point) => point.coordinate));
    if (bounds) {
      mapRef.current?.resize();
      mapRef.current?.fitBounds(bounds);
    }
  }, [points, ready]);

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
      <div data-testid="map-attribution">
        ©{" "}
        <a href={tileSource.attribution.url} target="_blank" rel="noreferrer">
          {tileSource.attribution.text}
        </a>
      </div>
    </div>
  );
}
