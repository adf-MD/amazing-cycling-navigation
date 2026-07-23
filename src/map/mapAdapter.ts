import { GeoJSONSource, Map as MapLibreGlMap } from "maplibre-gl";

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
  remove(): void;
}

export interface CreateMapOptions {
  container: HTMLElement;
  styleUrl: string;
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

  remove(): void {
    this.map.remove();
  }
}

export const createMapLibreMap: MapFactory = ({ container, styleUrl }) => {
  const map = new MapLibreGlMap({
    container,
    style: styleUrl,
    attributionControl: false,
  });
  return new MapLibreAdapter(map);
};
