import { GeoJSONSource, Map as MapLibreGlMap, setWorkerUrl } from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
// maplibre-gl computes its worker script's URL relative to its own
// import.meta.url at runtime, expecting a sibling file — a pattern that
// doesn't survive bundling (Vite inlines the library into one chunk, so
// that computed URL 404s). `?worker&url` makes Vite bundle the worker's
// own module graph into a real, standalone chunk and gives back its
// correct built URL, which we then tell maplibre-gl to use instead.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Coordinate } from "../domain/types.ts";
import type { BoundingBox } from "./routeLayer.ts";

setWorkerUrl(maplibreWorkerUrl);

export interface MapErrorInfo {
  message: string;
}

export interface MapSourceDataInfo {
  sourceId: string;
  isSourceLoaded: boolean;
}

export interface LineLayerPaint {
  lineColor: string;
  lineWidth: number;
  lineOpacity?: number;
}

export interface CircleLayerPaint {
  circleRadius: number;
  circleColor: string;
  circleStrokeColor?: string;
  circleStrokeWidth?: number;
  circleOpacity?: number;
}

/**
 * Narrow, purpose-built wrapper around the handful of maplibre-gl Map
 * operations MapView needs. Keeping the interface semantic (addLineLayer,
 * onError, ...) rather than a thin passthrough means tests can supply a
 * trivial mock without needing to fake maplibre-gl's real, heavily
 * overloaded API — maplibre-gl needs real WebGL, which jsdom doesn't
 * provide.
 */
export interface MapLibreLike {
  onLoad(listener: () => void): void;
  onError(listener: (info: MapErrorInfo) => void): void;
  onSourceData(listener: (info: MapSourceDataInfo) => void): void;
  addGeoJsonSource(id: string, data: GeoJSON.FeatureCollection): void;
  setGeoJsonSourceData(id: string, data: GeoJSON.FeatureCollection): void;
  hasSource(id: string): boolean;
  addLineLayer(id: string, sourceId: string, paint: LineLayerPaint): void;
  addCircleLayer(id: string, sourceId: string, paint: CircleLayerPaint): void;
  hasLayer(id: string): boolean;
  /** Instantly frames the given bounds (no animation), padded so route edges aren't flush against the viewport. */
  fitBounds(bounds: BoundingBox, paddingPixels?: number): void;
  /** The map's current centre. Used to verify the camera actually moved
   * (e.g. after fitBounds), not just that a fit was requested. */
  getCenter(): Coordinate;
  /** Recomputes the map's size from its container. Needed after the container's
   * on-screen size changes post-creation (e.g. iOS Safari/PWA chrome settling
   * after first paint) — otherwise fitBounds/camera maths use stale dimensions. */
  resize(): void;
  remove(): void;
}

export interface CreateMapOptions {
  container: HTMLElement;
  style: string | StyleSpecification;
}

export type MapFactory = (options: CreateMapOptions) => MapLibreLike;

class MapLibreAdapter implements MapLibreLike {
  private readonly map: MapLibreGlMap;

  constructor(map: MapLibreGlMap) {
    this.map = map;
  }

  onLoad(listener: () => void): void {
    this.map.on("load", () => {
      listener();
    });
  }

  onError(listener: (info: MapErrorInfo) => void): void {
    this.map.on("error", (event) => {
      const message =
        event.error instanceof Error ? event.error.message : String(event.error);
      listener({ message });
    });
  }

  onSourceData(listener: (info: MapSourceDataInfo) => void): void {
    this.map.on("sourcedata", (event) => {
      listener({ sourceId: event.sourceId, isSourceLoaded: event.isSourceLoaded });
    });
  }

  addGeoJsonSource(id: string, data: GeoJSON.FeatureCollection): void {
    this.map.addSource(id, { type: "geojson", data });
  }

  setGeoJsonSourceData(id: string, data: GeoJSON.FeatureCollection): void {
    const source = this.map.getSource(id);
    if (source instanceof GeoJSONSource) {
      void source.setData(data);
    }
  }

  hasSource(id: string): boolean {
    return this.map.getSource(id) !== undefined;
  }

  addLineLayer(id: string, sourceId: string, paint: LineLayerPaint): void {
    this.map.addLayer({
      id,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": paint.lineColor,
        "line-width": paint.lineWidth,
        "line-opacity": paint.lineOpacity ?? 1,
      },
    });
  }

  addCircleLayer(id: string, sourceId: string, paint: CircleLayerPaint): void {
    this.map.addLayer({
      id,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": paint.circleRadius,
        "circle-color": paint.circleColor,
        "circle-stroke-color": paint.circleStrokeColor ?? "#ffffff",
        "circle-stroke-width": paint.circleStrokeWidth ?? 0,
        "circle-opacity": paint.circleOpacity ?? 1,
      },
    });
  }

  hasLayer(id: string): boolean {
    return this.map.getLayer(id) !== undefined;
  }

  fitBounds(bounds: BoundingBox, paddingPixels = 48): void {
    this.map.fitBounds(
      [
        [bounds.southWest[0], bounds.southWest[1]],
        [bounds.northEast[0], bounds.northEast[1]],
      ],
      { padding: paddingPixels, animate: false, maxZoom: 16 },
    );
  }

  getCenter(): Coordinate {
    const center = this.map.getCenter();
    return [center.lng, center.lat];
  }

  resize(): void {
    this.map.resize();
  }

  remove(): void {
    this.map.remove();
  }
}

export const createMapLibreMap: MapFactory = ({ container, style }) => {
  const map = new MapLibreGlMap({
    container,
    style,
    attributionControl: false,
  });
  return new MapLibreAdapter(map);
};
