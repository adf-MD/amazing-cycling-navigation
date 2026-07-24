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

/** Pixel offset applied when easing to a "following" position, so the
 * rider sits below the map's true vertical centre and more of the
 * surrounding route stays visible. A map-rendering concern, not a
 * navigation decision, so it lives here rather than in the camera
 * state machine (src/ui/riding/rideCamera.ts). */
const FOLLOW_VERTICAL_OFFSET_PX = 60;

/** Duration of a "following" camera ease — brief enough to feel
 * responsive to a fresh fix, long enough to avoid a visible jump. */
const FOLLOW_EASE_DURATION_MS = 600;

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
  /** The map's current zoom level. */
  getZoom(): number;
  /** Fires only for a genuine user gesture (drag/pinch/rotate/pitch) —
   * never for this adapter's own programmatic camera calls (fitBounds,
   * setCamera), which don't carry a DOM originalEvent. This is the sole
   * mechanism for detecting manual map interaction. */
  onUserCameraInteraction(listener: () => void): void;
  /** Fires whenever the camera finishes moving, for any reason (user
   * gesture or this adapter's own fitBounds/setCamera calls) — reports
   * where it settled. Callers that only care about the free-panned
   * position filter by their own current mode; this always fires. */
  onCameraSettled(
    listener: (camera: {
      coordinate: Coordinate;
      zoom: number;
      bearingDegrees: number;
      pitchDegrees: number;
    }) => void,
  ): void;
  /** Moves the camera to the given centre/zoom/bearing/pitch. `coordinate`/
   * `zoom` of `null` leave that value unchanged (used only by the
   * north-up/top-down reset, which reorients without recentring).
   * `animate: true` eases (live "following"); `animate: false` jumps
   * instantly (restoring a previously free-panned position, or the
   * north-up reset — see `followOffset`). `followOffset: true` biases the
   * rider below vertical centre so more of the map is visible ahead —
   * only appropriate for a live follow ease, never for a restore jump
   * (which may carry its own manually-set pitch) or the north-up reset. */
  setCamera(
    coordinate: Coordinate | null,
    zoom: number | null,
    bearingDegrees: number,
    pitchDegrees: number,
    options: { animate: boolean; followOffset: boolean },
  ): void;
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

/** Exported only so mapAdapter.test.ts can verify the handful of
 * behaviours (e.g. fitBounds resetting bearing/pitch, jumpTo never
 * receiving an offset) that aren't observable through MapView.test.tsx's
 * MapLibreLike-level mock — everything else about this class is exercised
 * indirectly via that mock and the e2e smoke test. */
export class MapLibreAdapter implements MapLibreLike {
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
      // bearing/pitch are explicitly reset here rather than left implicit:
      // MapLibre's CameraOptions treat an omitted bearing/pitch as "leave
      // the current value unchanged", so without this a genuinely new
      // route opened while a rotated/tilted following camera was active
      // would fit the new bounds but silently keep the old orientation.
      { padding: paddingPixels, animate: false, maxZoom: 16, bearing: 0, pitch: 0 },
    );
  }

  getCenter(): Coordinate {
    const center = this.map.getCenter();
    return [center.lng, center.lat];
  }

  getZoom(): number {
    return this.map.getZoom();
  }

  onUserCameraInteraction(listener: () => void): void {
    this.map.on("movestart", (event) => {
      if (event.originalEvent) {
        listener();
      }
    });
  }

  onCameraSettled(
    listener: (camera: {
      coordinate: Coordinate;
      zoom: number;
      bearingDegrees: number;
      pitchDegrees: number;
    }) => void,
  ): void {
    this.map.on("moveend", () => {
      listener({
        coordinate: this.getCenter(),
        zoom: this.getZoom(),
        bearingDegrees: this.map.getBearing(),
        pitchDegrees: this.map.getPitch(),
      });
    });
  }

  setCamera(
    coordinate: Coordinate | null,
    zoom: number | null,
    bearingDegrees: number,
    pitchDegrees: number,
    options: { animate: boolean; followOffset: boolean },
  ): void {
    const center: [number, number] | undefined = coordinate
      ? [coordinate[0], coordinate[1]]
      : undefined;
    if (options.animate) {
      this.map.easeTo({
        ...(center ? { center } : {}),
        ...(zoom !== null ? { zoom } : {}),
        bearing: bearingDegrees,
        pitch: pitchDegrees,
        offset: options.followOffset ? [0, FOLLOW_VERTICAL_OFFSET_PX] : [0, 0],
        duration: FOLLOW_EASE_DURATION_MS,
        essential: true,
      });
    } else {
      // jumpTo's JumpToOptions doesn't mix in AnimationOptions, so it has
      // no `offset` — must never be passed here.
      this.map.jumpTo({
        ...(center ? { center } : {}),
        ...(zoom !== null ? { zoom } : {}),
        bearing: bearingDegrees,
        pitch: pitchDegrees,
      });
    }
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
