import { GeoJSONSource, Map as MapLibreGlMap, Marker, setWorkerUrl } from "maplibre-gl";
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
import {
  createWaypointMarkerElement,
  renderWaypointMarkerElement,
} from "./waypointMarkerElement.ts";
import {
  createDistanceBadgeElement,
  renderDistanceBadgeElement,
} from "./distanceBadgeMarkerElement.ts";

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

/** Duration of Planning's GPS-centre ease — a distinct constant from
 * FOLLOW_EASE_DURATION_MS even though the value matches, since that one is
 * documented as specifically about Riding's continuous GPS-follow ease,
 * an unrelated camera-motion concern from this single one-shot recentre. */
const CENTRE_EASE_DURATION_MS = 600;

/** Duration of a Zoom in/out button's ease (see changeZoomBy) — a quick,
 * deliberate step matching one discrete button press, distinct from
 * FOLLOW_EASE_DURATION_MS/CENTRE_EASE_DURATION_MS even though shorter:
 * those describe a continuous follow and a one-shot recentre, this is a
 * fixed single zoom-level step with nothing else to travel. */
const ZOOM_EASE_DURATION_MS = 300;

/** Half-width/height, in CSS pixels, of the small screen-space box used
 * to hit-test a tapped warning segment or route feature — independent of
 * geographic zoom, so a thin line stays comfortably tappable on a phone
 * without needing the visible line itself to be drawn wider. 12-16px is
 * the generally accepted minimum touch-slop radius; 14 sits in the
 * middle of that. Shared by queryTopWarningFeatureAt and
 * queryTopRouteFeatureAt — the same tap-tolerance problem either way. */
const MAP_FEATURE_TAP_HIT_TOLERANCE_PX = 14;

/**
 * Distinguishes a fatal style-document failure from a recoverable
 * resource failure, verified directly against the installed maplibre-gl
 * source (see MapView.tsx's fallback logic, which depends on this):
 * - "style-request-or-parse": the style JSON itself failed to fetch,
 *   parse, or validate — MapLibre's own `load` event will never fire
 *   after this (Style._load never reaches `this._loaded = true`).
 * - "source-or-tile": a specific source/tile failed — MapLibre bubbles
 *   this with a `sourceId`, and a single tile error does not itself
 *   block `Map.loaded()`/`load` from eventually firing.
 * - "sprite": the style's sprite sheet failed — fired only after the
 *   style itself already loaded successfully.
 * - "webgl-init": synthesised proactively (see MapLibreAdapter's
 *   constructor) — the real WebGL-context-creation failure event fires
 *   synchronously inside the Map constructor, before any listener can
 *   possibly be attached, and is otherwise silently dropped.
 */
export type MapErrorCategory =
  "style-request-or-parse" | "source-or-tile" | "sprite" | "webgl-init";

export interface MapErrorInfo {
  message: string;
  category: MapErrorCategory;
}

export interface MapSourceDataInfo {
  sourceId: string;
  isSourceLoaded: boolean;
}

/** The one safe, project-owned piece of identity a warning hit-test can
 * report — never a full MapLibre feature (no geometry, no raw
 * style/provider properties leak out of this adapter). `warningIndex` is
 * the raw value read off the topmost matching feature's own
 * `warningIndex` property (see warningLayer.ts's WarningFeatureProperties)
 * — untyped and NOT yet validated as genuinely in range; the caller must
 * run it through warningLayer.ts's resolveWarningIndexHit before use. */
export interface WarningFeatureHit {
  warningIndex: unknown;
}

/** The one safe, project-owned piece of identity a route-feature
 * (climb/descent) hit-test can report — mirrors WarningFeatureHit
 * exactly. `routeFeatureId` is the raw value read off the topmost
 * matching feature's own `routeFeatureId` property (see
 * routeFeatureLayer.ts's RouteFeatureProperties) — untyped and NOT yet
 * validated as genuinely current; the caller must run it through
 * routeFeatureLayer.ts's resolveRouteFeatureIdHit before use. */
export interface RouteFeatureHit {
  routeFeatureId: unknown;
}

/** A categorical (exact-match) line-colour expression, keyed by a
 * project-owned feature property — e.g. gradientRouteLayer.ts's
 * `gradientClass`. Deliberately only supports `match`-style exact-value
 * lookup, not MapLibre's full expression language: this is the one shape
 * the gradient route line needs, and a narrow, purpose-built type keeps
 * addLineLayer's tests exhaustive rather than open-ended. */
export interface DataDrivenLineColor {
  /** The GeoJSON feature property to switch on. */
  property: string;
  /** Exact property value → colour. */
  cases: Readonly<Record<string, string>>;
  /** Colour for any value not present in `cases` (including a missing
   * property) — MapLibre's `match` expression requires a fallback, and
   * this is also this project's safety net against an unrecognised class
   * ever rendering as fully transparent or erroring. */
  fallback: string;
}

/** One (zoom, width) stop of a zoom-`interpolate` line-width expression.
 * Zoom values must be strictly ascending across a given
 * ZoomInterpolatedLineWidth's stops. */
export interface ZoomWidthStop {
  zoom: number;
  width: number;
}

/** A MapLibre zoom-`interpolate` line-width expression: linear
 * interpolation over an ordered list of ≥2 (zoom, width) stops.
 * Deliberately only linear interpolation over explicit stops, not
 * MapLibre's full expression language — mirrors DataDrivenLineColor's own
 * narrow, purpose-built convention above. See src/map/routeWidthPolicy.ts
 * for the actual stop values used by every route/warning layer; this type
 * is policy-free. */
export interface ZoomInterpolatedLineWidth {
  stops: readonly ZoomWidthStop[];
}

export interface LineLayerPaint {
  lineColor: string | DataDrivenLineColor;
  lineWidth: number | ZoomInterpolatedLineWidth;
  lineOpacity?: number;
  /** Omit for a solid line (the existing route layers never pass this —
   * their rendering is unaffected). Used for Planning's unrouted-preview
   * line, which must always read as visually distinct from a real routed
   * line, never just a colour difference. */
  lineDasharray?: number[];
}

export interface CircleLayerPaint {
  circleRadius: number;
  circleColor: string;
  circleStrokeColor?: string;
  circleStrokeWidth?: number;
  circleOpacity?: number;
}

/** Plain (non-SDF) RGBA pixel data for a project-owned map icon — the
 * shape addImage accepts with zero DOM/canvas dependency, so an icon
 * generator can be a pure, Vitest-testable function (see
 * routeArrowIcon.ts). */
export interface StyleImagePixelData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface AddImageOptions {
  /** MapLibre's own addImage default is 1, which renders a small icon
   * soft on a retina screen. Omit only for an icon genuinely authored
   * at 1x. */
  pixelRatio?: number;
}

export interface SymbolLayerOptions {
  /** symbol-spacing, in screen pixels — the only property this method
   * exposes; placement/rotation-alignment/pitch-alignment/keep-upright
   * are hardcoded inside addSymbolLayer (see MapLibreAdapter), the same
   * "only expose what genuinely varies" convention addLineLayer already
   * follows for line-join/line-cap. icon-allow-overlap is deliberately
   * left at MapLibre's own default (false) and never exposed here, so
   * MapLibre's built-in collision engine thins symbols in dense or
   * overlapping situations rather than forcing every spacing interval
   * to render regardless of collision. */
  spacingPixels: number;
}

/** A waypoint's role in its route — distinguishes visual treatment
 * (shape/border, never colour alone) and drives the map marker's
 * accessible label. Shared by the map marker (see MapMarkerSpec below)
 * and the Planning list's ordinal badge (WaypointList.tsx, via
 * planningLayer.ts's deriveWaypointRoles) — one vocabulary, not two
 * independently-guessed role concepts. "start-finish" is the map's
 * single combined marker for a closed loop where the first and final
 * waypoint coincide (see planningLayer.ts's buildWaypointMarkerSpecs) —
 * the final waypoint gets no marker of its own in that case, though the
 * list still shows both endpoints with this same role. */
export type WaypointRole = "ordinary" | "start" | "finish" | "start-finish";

/** A Planning waypoint marker to render — plain structured data, never
 * raw HTML, so the adapter builds the DOM node itself (see
 * waypointMarkerElement.ts) rather than trusting a caller-supplied
 * string. `label` is the ordinal text ("3", or "1/6" for a combined
 * start-finish marker); `ariaLabel` is the fuller accessible description
 * ("Waypoint 3", "Start and finish waypoints 1 and 6"). */
export interface MapMarkerSpec {
  id: string;
  coordinate: Coordinate;
  label: string;
  role: WaypointRole;
  selected: boolean;
  ariaLabel: string;
}

/** A route-distance kilometre badge to render — plain structured data,
 * like MapMarkerSpec, but for an entirely independent DOM marker
 * collection (see setDistanceBadges) so the two groups can never delete
 * each other. `label` is the abbreviated numeric text the caller has
 * already formatted ("5", or "10 / 30" for a merged loop/out-and-back
 * coincidence — see distanceBadgeLayer.ts); `ariaLabel` is the fuller
 * accessible description ("5 kilometres from route start"). `id` is
 * derived from the badge's absolute distance(s), never array index, so
 * it stays stable across a route recalculation that doesn't move this
 * particular badge. */
export interface DistanceBadgeMarkerSpec {
  id: string;
  coordinate: Coordinate;
  label: string;
  ariaLabel: string;
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
  /** Fires once the style document itself is parsed/validated and its
   * sources/layers are registered — independent of whether any tile,
   * sprite or glyph has loaded (MapLibre's own "style.load" event,
   * fired well before the public "load" event, which additionally waits
   * for every source's initial tiles). The signal MapView uses to add
   * the route/position overlays without waiting for external tiles. */
  onStyleLoaded(listener: () => void): void;
  onError(listener: (info: MapErrorInfo) => void): void;
  onSourceData(listener: (info: MapSourceDataInfo) => void): void;
  addGeoJsonSource(id: string, data: GeoJSON.FeatureCollection): void;
  setGeoJsonSourceData(id: string, data: GeoJSON.FeatureCollection): void;
  hasSource(id: string): boolean;
  addLineLayer(id: string, sourceId: string, paint: LineLayerPaint): void;
  addCircleLayer(id: string, sourceId: string, paint: CircleLayerPaint): void;
  hasLayer(id: string): boolean;
  /** Whether a project-owned image is already registered under `id` —
   * used to register an icon at most once per map instance (a fresh
   * instance is created on every style load/fallback/retry, so this is
   * an explicit "register if absent" guard rather than load-bearing
   * cross-instance idempotency). */
  hasImage(id: string): boolean;
  /** Registers a project-owned, locally-generated RGBA icon for use by
   * addSymbolLayer's icon-image. Never fetches from a URL or a style's
   * own sprite sheet. */
  addImage(id: string, image: StyleImagePixelData, options?: AddImageOptions): void;
  /** Adds a symbol layer that repeats `iconId` along `sourceId`'s line
   * geometry (symbol-placement: "line"), rotated to track the line's
   * own direction (icon-rotation-alignment/icon-pitch-alignment: "map")
   * with icon-keep-upright explicitly disabled so a directional icon is
   * never flipped 180° to stay "upright" — see routeArrowIcon.ts for
   * why the icon must be authored pointing along its x-axis rather than
   * "up" for this to render correctly. */
  addSymbolLayer(
    id: string,
    sourceId: string,
    iconId: string,
    options: SymbolLayerOptions,
  ): void;
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
  /** Moves only the camera's centre, leaving zoom, bearing and pitch
   * genuinely untouched by never including them in the underlying
   * easeTo/jumpTo call — MapLibre's own "omitted field = unchanged"
   * semantics do the preserving, so this never reads-then-rewrites a
   * possibly-stale value. Used by Planning's GPS-centre control, which
   * must never disturb whatever zoom/bearing/pitch the rider already has
   * (see setCamera, which always writes bearing/pitch explicitly and so
   * cannot express "leave orientation alone"). */
  centreOn(coordinate: Coordinate, options: { animate: boolean }): void;
  /** Changes only the camera's zoom, by the given signed delta relative to
   * its current level, leaving centre, bearing and pitch genuinely
   * untouched by never including them in the underlying easeTo call —
   * mirrors centreOn's own "omitted field = unchanged" MapLibre semantics
   * for the complementary field. Always eases; there is no jump/instant
   * variant, since every caller is a discrete Zoom in/out button press with
   * no restore/resume use case needing an instant jump. MapLibre's own zoom
   * setter clamps the resulting value to the style's min/max zoom
   * internally, so this needs no clamping logic of its own. Used by
   * Planning's zoom in/out controls (backlog item 52), which must never
   * disturb whatever centre/bearing/pitch the rider already has. */
  changeZoomBy(delta: number): void;
  /** Recomputes the map's size from its container. Needed after the container's
   * on-screen size changes post-creation (e.g. iOS Safari/PWA chrome settling
   * after first paint) — otherwise fitBounds/camera maths use stale dimensions. */
  resize(): void;
  /** Fires with the tapped/clicked coordinate for a genuine tap or click —
   * never for a drag-then-release (MapLibre's own click-tolerance already
   * suppresses `click` after real pointer movement, verified against the
   * installed package's source), so Planning can use this directly for
   * "tap to place a waypoint" without extra drag-distance tracking here.
   * Single map-wide listener — deliberately not layer-scoped, and this
   * method itself never calls queryRenderedFeatures. Warning-feature hit
   * testing (map-to-list warning tapping) is a separate, additional
   * method — see queryTopWarningFeatureAt below — which MapView.tsx calls
   * with the same Coordinate this listener reports, before ever
   * forwarding to a planningOverlay's own onMapTap; see the event-priority
   * policy documented in PlanningScreen.tsx next to handlePlacementAt. */
  onMapTap(listener: (coordinate: Coordinate) => void): void;
  /** Hit-tests only the given layer ids (never a layer the caller omits —
   * e.g. MapView must omit the selected-warning highlight layer) in a
   * small screen-space box of MAP_FEATURE_TAP_HIT_TOLERANCE_PX around
   * `coordinate`'s on-screen position, re-derived internally via the real
   * Map's own `.project()` — deliberately takes the same `Coordinate`
   * onMapTap's own listener already receives, so MapView can call this
   * straight from that callback with zero changes to onMapTap's own
   * contract or test call sites. When multiple queried layers' features
   * overlap, MapLibre returns the topmost-rendered feature first — this
   * method returns exactly that first result (verified against the
   * installed package's own documented queryRenderedFeatures ordering
   * guarantee). Returns null when nothing was hit, `layerIds` is empty, or
   * the query itself is not currently possible (style/layers not
   * structurally ready) — never throws, so a hit-test failure always
   * safely degrades to "no hit" rather than surfacing an error. */
  queryTopWarningFeatureAt(
    coordinate: Coordinate,
    layerIds: readonly string[],
  ): WarningFeatureHit | null;
  /** Identical hit-testing technique to queryTopWarningFeatureAt (same
   * tolerance box, same topmost-feature-wins semantics, same never-throws
   * guarantee), reading a route-feature (climb/descent) layer's own
   * `routeFeatureId` property instead of `warningIndex`. A separate
   * method rather than a generalised one: keeping the two independently
   * typed and named mirrors WarningFeatureHit/RouteFeatureHit's own
   * separation and keeps each call site's intent explicit at the caller
   * (MapView.tsx queries warnings first, then route features, in that
   * priority order — see its onMapTap wiring). */
  queryTopRouteFeatureAt(
    coordinate: Coordinate,
    layerIds: readonly string[],
  ): RouteFeatureHit | null;
  /** Declares the complete set of Planning waypoint markers that should
   * exist right now — the same "supply the full desired state, the
   * adapter diffs it" convention setGeoJsonSourceData already follows,
   * rather than exposing separate add/update/remove primitives. Markers
   * are plain DOM elements (see waypointMarkerElement.ts), never a
   * MapLibre symbol/text layer, so they have no glyph/sprite dependency
   * and render under the local fallback style too. */
  setMarkers(markers: readonly MapMarkerSpec[]): void;
  /** Declares the complete set of route-distance badges that should
   * exist right now — same "supply the full desired state, the adapter
   * diffs it" convention as setMarkers, but backed by an entirely
   * separate keyed collection (MapLibreAdapter's badgeMarkersById) so
   * this call can never delete/recreate Planning's waypoint markers, or
   * vice versa. Plain DOM elements (distanceBadgeMarkerElement.ts) — no
   * glyph/sprite dependency, so badges render under the local fallback
   * style too — and MapLibre's own default Marker rotation/pitch
   * alignment keeps them upright when the map rotates or tilts with no
   * extra code, unlike the route-arrow icon layer. */
  setDistanceBadges(badges: readonly DistanceBadgeMarkerSpec[]): void;
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
  /** Set once MapLibre's own "style.load" fires — used to tell a
   * post-style-load sprite failure apart from a pre-load style-document
   * failure, both of which arrive with no `sourceId`. */
  private styleReady = false;
  /** Best-effort, proactive detection of a WebGL-context-creation
   * failure. MapLibre fires this as a real error event (wrapping
   * GPUInitializationError), but synchronously inside the Map
   * constructor — before this adapter (or any listener) exists — so the
   * real event is always silently dropped. Checking the internal
   * `painter` field immediately after construction is the only way to
   * observe this at all; verified against the installed maplibre-gl
   * version. If a future version renames this field, the check simply
   * stops detecting this one category — it never throws. */
  private readonly webglInitFailed: boolean;
  /** Planning waypoint markers currently on the map, keyed by
   * MapMarkerSpec.id — diffed against on every setMarkers call. */
  private readonly markersById = new Map<string, Marker>();
  /** Route-distance badge markers currently on the map, keyed by
   * DistanceBadgeMarkerSpec.id — diffed against on every
   * setDistanceBadges call. A structurally separate Map from
   * markersById, by construction, so the two marker groups can never
   * delete or recreate each other's entries. */
  private readonly badgeMarkersById = new Map<string, Marker>();

  constructor(map: MapLibreGlMap) {
    this.map = map;
    this.map.on("style.load", () => {
      this.styleReady = true;
    });
    this.webglInitFailed = !(map as unknown as { painter?: unknown }).painter;
  }

  onLoad(listener: () => void): void {
    this.map.on("load", () => {
      listener();
    });
  }

  onStyleLoaded(listener: () => void): void {
    this.map.on("style.load", listener);
  }

  onError(listener: (info: MapErrorInfo) => void): void {
    if (this.webglInitFailed) {
      // Deferred to a microtask so it fires after the caller's own
      // synchronous listener-registration sequence finishes, avoiding
      // reentrancy if the listener itself tears down/recreates the map.
      queueMicrotask(() => {
        listener({
          message: "WebGL context could not be created.",
          category: "webgl-init",
        });
      });
    }
    this.map.on("error", (event) => {
      const message =
        event.error instanceof Error ? event.error.message : String(event.error);
      const sourceId = (event as { sourceId?: unknown }).sourceId;
      const category: MapErrorCategory =
        typeof sourceId === "string"
          ? "source-or-tile"
          : this.styleReady
            ? "sprite"
            : "style-request-or-parse";
      listener({ message, category });
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
    // Built and typed loosely (never a bare `any`): MapLibre's own
    // ExpressionSpecification union is a deep, purpose-built recursive
    // type that isn't practical to satisfy for a programmatically-built
    // categorical `match` array — the runtime shape is exactly what
    // MapLibre itself accepts and validates, matching addLineLayer.test.ts's
    // own exact-shape assertions. Cast only at the single paint-field
    // assignment below, not the whole `paint` object.
    const lineColor: string | unknown[] =
      typeof paint.lineColor === "string"
        ? paint.lineColor
        : [
            "match",
            ["get", paint.lineColor.property],
            ...Object.entries(paint.lineColor.cases).flat(),
            paint.lineColor.fallback,
          ];
    // Same loosely-typed-cast convention as lineColor above: a
    // ZoomInterpolatedLineWidth becomes a native MapLibre `interpolate`
    // expression, evaluated by MapLibre itself on every render frame — no
    // React state or effect is involved in route width at all (see
    // routeWidthPolicy.ts).
    const lineWidth: number | unknown[] =
      typeof paint.lineWidth === "number"
        ? paint.lineWidth
        : [
            "interpolate",
            ["linear"],
            ["zoom"],
            ...paint.lineWidth.stops.flatMap((stop) => [stop.zoom, stop.width]),
          ];
    this.map.addLayer({
      id,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": lineColor as string,
        "line-width": lineWidth as number,
        "line-opacity": paint.lineOpacity ?? 1,
        ...(paint.lineDasharray ? { "line-dasharray": paint.lineDasharray } : {}),
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

  hasImage(id: string): boolean {
    return this.map.hasImage(id);
  }

  addImage(id: string, image: StyleImagePixelData, options?: AddImageOptions): void {
    this.map.addImage(
      id,
      { width: image.width, height: image.height, data: image.data },
      { pixelRatio: options?.pixelRatio ?? 1, sdf: false },
    );
  }

  addSymbolLayer(
    id: string,
    sourceId: string,
    iconId: string,
    options: SymbolLayerOptions,
  ): void {
    this.map.addLayer({
      id,
      type: "symbol",
      source: sourceId,
      layout: {
        "icon-image": iconId,
        "symbol-placement": "line",
        "symbol-spacing": options.spacingPixels,
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-keep-upright": false,
      },
    });
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

  centreOn(coordinate: Coordinate, options: { animate: boolean }): void {
    const center: [number, number] = [coordinate[0], coordinate[1]];
    if (options.animate) {
      this.map.easeTo({ center, duration: CENTRE_EASE_DURATION_MS, essential: true });
    } else {
      this.map.jumpTo({ center });
    }
  }

  changeZoomBy(delta: number): void {
    this.map.easeTo({
      zoom: this.map.getZoom() + delta,
      duration: ZOOM_EASE_DURATION_MS,
      essential: true,
    });
  }

  resize(): void {
    this.map.resize();
  }

  onMapTap(listener: (coordinate: Coordinate) => void): void {
    this.map.on("click", (event) => {
      listener([event.lngLat.lng, event.lngLat.lat]);
    });
  }

  queryTopWarningFeatureAt(
    coordinate: Coordinate,
    layerIds: readonly string[],
  ): WarningFeatureHit | null {
    if (layerIds.length === 0) return null;
    try {
      const point = this.map.project([coordinate[0], coordinate[1]]);
      const features = this.map.queryRenderedFeatures(
        [
          [
            point.x - MAP_FEATURE_TAP_HIT_TOLERANCE_PX,
            point.y - MAP_FEATURE_TAP_HIT_TOLERANCE_PX,
          ],
          [
            point.x + MAP_FEATURE_TAP_HIT_TOLERANCE_PX,
            point.y + MAP_FEATURE_TAP_HIT_TOLERANCE_PX,
          ],
        ],
        { layers: [...layerIds] },
      );
      const top = features[0];
      if (!top) return null;
      return {
        warningIndex: (top.properties as { warningIndex?: unknown } | null)?.warningIndex,
      };
    } catch {
      return null;
    }
  }

  queryTopRouteFeatureAt(
    coordinate: Coordinate,
    layerIds: readonly string[],
  ): RouteFeatureHit | null {
    if (layerIds.length === 0) return null;
    try {
      const point = this.map.project([coordinate[0], coordinate[1]]);
      const features = this.map.queryRenderedFeatures(
        [
          [
            point.x - MAP_FEATURE_TAP_HIT_TOLERANCE_PX,
            point.y - MAP_FEATURE_TAP_HIT_TOLERANCE_PX,
          ],
          [
            point.x + MAP_FEATURE_TAP_HIT_TOLERANCE_PX,
            point.y + MAP_FEATURE_TAP_HIT_TOLERANCE_PX,
          ],
        ],
        { layers: [...layerIds] },
      );
      const top = features[0];
      if (!top) return null;
      return {
        routeFeatureId: (top.properties as { routeFeatureId?: unknown } | null)
          ?.routeFeatureId,
      };
    } catch {
      return null;
    }
  }

  setMarkers(markers: readonly MapMarkerSpec[]): void {
    const seenIds = new Set<string>();
    for (const spec of markers) {
      seenIds.add(spec.id);
      const existing = this.markersById.get(spec.id);
      const lngLat: [number, number] = [spec.coordinate[0], spec.coordinate[1]];
      if (existing) {
        existing.setLngLat(lngLat);
        renderWaypointMarkerElement(existing.getElement(), spec);
      } else {
        const element = createWaypointMarkerElement();
        renderWaypointMarkerElement(element, spec);
        const marker = new Marker({ element, anchor: "center" })
          .setLngLat(lngLat)
          .addTo(this.map);
        this.markersById.set(spec.id, marker);
      }
    }
    for (const [id, marker] of this.markersById) {
      if (!seenIds.has(id)) {
        marker.remove();
        this.markersById.delete(id);
      }
    }
  }

  setDistanceBadges(badges: readonly DistanceBadgeMarkerSpec[]): void {
    const seenIds = new Set<string>();
    for (const spec of badges) {
      seenIds.add(spec.id);
      const existing = this.badgeMarkersById.get(spec.id);
      const lngLat: [number, number] = [spec.coordinate[0], spec.coordinate[1]];
      if (existing) {
        existing.setLngLat(lngLat);
        renderDistanceBadgeElement(existing.getElement(), spec);
      } else {
        const element = createDistanceBadgeElement();
        renderDistanceBadgeElement(element, spec);
        const marker = new Marker({ element, anchor: "center" })
          .setLngLat(lngLat)
          .addTo(this.map);
        this.badgeMarkersById.set(spec.id, marker);
      }
    }
    for (const [id, marker] of this.badgeMarkersById) {
      if (!seenIds.has(id)) {
        marker.remove();
        this.badgeMarkersById.delete(id);
      }
    }
  }

  remove(): void {
    for (const marker of this.markersById.values()) {
      marker.remove();
    }
    this.markersById.clear();
    for (const marker of this.badgeMarkersById.values()) {
      marker.remove();
    }
    this.badgeMarkersById.clear();
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
