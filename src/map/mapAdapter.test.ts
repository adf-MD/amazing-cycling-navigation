import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreGlMap } from "maplibre-gl";
import { MapLibreAdapter } from "./mapAdapter.ts";

/**
 * A minimal fake of maplibre-gl's real Map, covering only the methods
 * MapLibreAdapter actually calls. Real maplibre-gl needs WebGL, which
 * jsdom doesn't provide, so this is the only way to unit-test what the
 * adapter actually passes downstream (as opposed to MapView.test.tsx's
 * MapLibreLike-level mock, which can't see past the adapter boundary).
 */
function buildFakeMapLibreMap(
  center: { lng: number; lat: number } = { lng: 0, lat: 51 },
  // A truthy `painter` by default simulates a successful WebGL context
  // creation (see MapLibreAdapter's constructor) — only the dedicated
  // webgl-init test below passes `painter: undefined`.
  options: { painter?: unknown } = {},
) {
  const fake = {
    fitBounds: vi.fn(),
    easeTo: vi.fn(),
    jumpTo: vi.fn(),
    getCenter: vi.fn(() => center),
    getZoom: vi.fn(() => 12),
    getBearing: vi.fn(() => 45),
    getPitch: vi.fn(() => 20),
    addLayer: vi.fn(),
    addImage: vi.fn(),
    hasImage: vi.fn(() => false),
    on: vi.fn(),
    project: vi.fn(() => ({ x: 100, y: 200 })),
    queryRenderedFeatures: vi.fn(() => [] as { properties: Record<string, unknown> }[]),
    painter: "painter" in options ? options.painter : {},
  };
  return fake;
}

function findHandler(
  fake: ReturnType<typeof buildFakeMapLibreMap>,
  type: string,
): (event: unknown) => void {
  const call = fake.on.mock.calls.find(([eventType]) => eventType === type) as
    [string, (event: unknown) => void] | undefined;
  if (!call) throw new Error(`no handler registered for "${type}"`);
  return call[1];
}

function buildAdapter(fake: ReturnType<typeof buildFakeMapLibreMap>): MapLibreAdapter {
  return new MapLibreAdapter(fake as unknown as MapLibreGlMap);
}

describe("MapLibreAdapter", () => {
  it("fitBounds resets bearing and pitch to north-up/top-down, not just the fit itself", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.fitBounds({ southWest: [0, 51], northEast: [0.01, 51.01] });

    expect(fake.fitBounds).toHaveBeenCalledWith(
      [
        [0, 51],
        [0.01, 51.01],
      ],
      expect.objectContaining({ bearing: 0, pitch: 0 }),
    );
  });

  it("setCamera (animate) issues one easeTo carrying centre, zoom, bearing, pitch and the follow offset together", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.setCamera([1, 2], 16, 90, 35, { animate: true, followOffset: true });

    expect(fake.easeTo).toHaveBeenCalledOnce();
    expect(fake.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [1, 2],
        zoom: 16,
        bearing: 90,
        pitch: 35,
        offset: [0, 60],
      }),
    );
    expect(fake.jumpTo).not.toHaveBeenCalled();
  });

  it("setCamera (animate, no follow offset) eases with a zero offset — e.g. the north-up/top-down reset", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.setCamera(null, null, 0, 0, { animate: true, followOffset: false });

    const [options] = fake.easeTo.mock.calls[0] as [Record<string, unknown>];
    expect(options.offset).toEqual([0, 0]);
    // null coordinate/zoom must be omitted entirely, not passed as null —
    // maplibre-gl treats an omitted key as "leave unchanged".
    expect(options).not.toHaveProperty("center");
    expect(options).not.toHaveProperty("zoom");
    expect(options.bearing).toBe(0);
    expect(options.pitch).toBe(0);
  });

  it("setCamera (not animate) jumps instantly and never passes an offset — jumpTo has no such option", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.setCamera([1, 2], 14, 123, 20, { animate: false, followOffset: false });

    expect(fake.jumpTo).toHaveBeenCalledOnce();
    const [options] = fake.jumpTo.mock.calls[0] as [Record<string, unknown>];
    expect(options).toEqual({ center: [1, 2], zoom: 14, bearing: 123, pitch: 20 });
    expect(options).not.toHaveProperty("offset");
    expect(fake.easeTo).not.toHaveBeenCalled();
  });

  it("centreOn (animate) eases to the given centre only, never specifying zoom, bearing, pitch or offset", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.centreOn([1, 2], { animate: true });

    expect(fake.easeTo).toHaveBeenCalledOnce();
    const [options] = fake.easeTo.mock.calls[0] as [Record<string, unknown>];
    expect(options.center).toEqual([1, 2]);
    expect(options).not.toHaveProperty("zoom");
    expect(options).not.toHaveProperty("bearing");
    expect(options).not.toHaveProperty("pitch");
    expect(options).not.toHaveProperty("offset");
    expect(fake.jumpTo).not.toHaveBeenCalled();
  });

  it("centreOn (not animate) jumps to the given centre only, also never touching zoom, bearing or pitch", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.centreOn([1, 2], { animate: false });

    expect(fake.jumpTo).toHaveBeenCalledOnce();
    expect(fake.jumpTo).toHaveBeenCalledWith({ center: [1, 2] });
    expect(fake.easeTo).not.toHaveBeenCalled();
  });

  it("changeZoomBy (positive delta) eases the zoom only, relative to the current zoom, never specifying centre, bearing, pitch or offset", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.changeZoomBy(1);

    expect(fake.easeTo).toHaveBeenCalledOnce();
    const [options] = fake.easeTo.mock.calls[0] as [Record<string, unknown>];
    expect(options.zoom).toBe(13); // fake getZoom() returns 12
    expect(options.essential).toBe(true);
    expect(options).not.toHaveProperty("center");
    expect(options).not.toHaveProperty("bearing");
    expect(options).not.toHaveProperty("pitch");
    expect(options).not.toHaveProperty("offset");
    expect(fake.jumpTo).not.toHaveBeenCalled();
  });

  it("changeZoomBy (negative delta) eases to a lower zoom, relative to the current zoom", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.changeZoomBy(-1);

    const [options] = fake.easeTo.mock.calls[0] as [Record<string, unknown>];
    expect(options.zoom).toBe(11);
  });

  // Backlog item 65's diagnostic-only readback (see MapLibreLike's own
  // doc comment) — a thin, direct wrapper around the underlying MapLibre
  // map's own project(), never used by any production decision logic.
  it("project delegates to the underlying map's own project() and returns its x/y", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    const result = adapter.project([1.5, 51.5]);

    expect(fake.project).toHaveBeenCalledWith([1.5, 51.5]);
    expect(result).toEqual({ x: 100, y: 200 }); // fake project() always returns this
  });

  it("onCameraSettled reports centre, zoom, bearing and pitch together on moveend", () => {
    const fake = buildFakeMapLibreMap({ lng: 3, lat: 4 });
    const adapter = buildAdapter(fake);
    const listener = vi.fn();

    adapter.onCameraSettled(listener);
    const [, moveEndHandler] = fake.on.mock.calls.find(
      ([type]) => type === "moveend",
    ) as [string, () => void];
    moveEndHandler();

    expect(listener).toHaveBeenCalledWith({
      coordinate: [3, 4],
      zoom: 12,
      bearingDegrees: 45,
      pitchDegrees: 20,
    });
  });

  it("onMapTap reports the tapped coordinate from a real click event", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);
    const listener = vi.fn();

    adapter.onMapTap(listener);
    const clickHandler = findHandler(fake, "click");
    clickHandler({ lngLat: { lng: 7, lat: 8 } });

    expect(listener).toHaveBeenCalledWith([7, 8]);
  });

  describe("queryTopWarningFeatureAt", () => {
    it("re-derives the screen point via project() and queries only the given layer ids in the tolerance box", () => {
      const fake = buildFakeMapLibreMap();
      fake.project.mockReturnValue({ x: 100, y: 200 });
      const adapter = buildAdapter(fake);

      adapter.queryTopWarningFeatureAt([1, 2], ["acn-warning-obstacle-line"]);

      expect(fake.project).toHaveBeenCalledWith([1, 2]);
      expect(fake.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [86, 186],
          [114, 214],
        ],
        { layers: ["acn-warning-obstacle-line"] },
      );
    });

    it("returns the topmost feature's raw warningIndex, unvalidated", () => {
      const fake = buildFakeMapLibreMap();
      fake.queryRenderedFeatures.mockReturnValue([
        { properties: { warningIndex: 2 } },
        { properties: { warningIndex: 0 } },
      ]);
      const adapter = buildAdapter(fake);

      expect(adapter.queryTopWarningFeatureAt([1, 2], ["a"])).toEqual({
        warningIndex: 2,
      });
    });

    it("returns the raw (possibly malformed) warningIndex value as-is — validation is the caller's job", () => {
      const fake = buildFakeMapLibreMap();
      fake.queryRenderedFeatures.mockReturnValue([
        { properties: { warningIndex: "oops" } },
      ]);
      const adapter = buildAdapter(fake);

      expect(adapter.queryTopWarningFeatureAt([1, 2], ["a"])).toEqual({
        warningIndex: "oops",
      });
    });

    it("returns null when queryRenderedFeatures returns no features", () => {
      const fake = buildFakeMapLibreMap();
      fake.queryRenderedFeatures.mockReturnValue([]);
      const adapter = buildAdapter(fake);

      expect(adapter.queryTopWarningFeatureAt([1, 2], ["a"])).toBeNull();
    });

    it("returns null, never throws, when project() throws", () => {
      const fake = buildFakeMapLibreMap();
      fake.project.mockImplementation(() => {
        throw new Error("style not ready");
      });
      const adapter = buildAdapter(fake);

      expect(() => adapter.queryTopWarningFeatureAt([1, 2], ["a"])).not.toThrow();
      expect(adapter.queryTopWarningFeatureAt([1, 2], ["a"])).toBeNull();
    });

    it("returns null, never throws, when queryRenderedFeatures() throws (e.g. an unready layer id)", () => {
      const fake = buildFakeMapLibreMap();
      fake.queryRenderedFeatures.mockImplementation(() => {
        throw new Error("layer not found");
      });
      const adapter = buildAdapter(fake);

      expect(() => adapter.queryTopWarningFeatureAt([1, 2], ["a"])).not.toThrow();
      expect(adapter.queryTopWarningFeatureAt([1, 2], ["a"])).toBeNull();
    });

    it("returns null without calling project or queryRenderedFeatures when layerIds is empty", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);

      expect(adapter.queryTopWarningFeatureAt([1, 2], [])).toBeNull();
      expect(fake.project).not.toHaveBeenCalled();
      expect(fake.queryRenderedFeatures).not.toHaveBeenCalled();
    });
  });

  describe("queryTopRouteFeatureAt", () => {
    it("re-derives the screen point via project() and queries only the given layer ids in the tolerance box", () => {
      const fake = buildFakeMapLibreMap();
      fake.project.mockReturnValue({ x: 100, y: 200 });
      const adapter = buildAdapter(fake);

      adapter.queryTopRouteFeatureAt([1, 2], ["acn-route-feature-line"]);

      expect(fake.project).toHaveBeenCalledWith([1, 2]);
      expect(fake.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [86, 186],
          [114, 214],
        ],
        { layers: ["acn-route-feature-line"] },
      );
    });

    it("returns the topmost feature's raw routeFeatureId, unvalidated", () => {
      const fake = buildFakeMapLibreMap();
      fake.queryRenderedFeatures.mockReturnValue([
        { properties: { routeFeatureId: "climb-2000" } },
        { properties: { routeFeatureId: "climb-0" } },
      ]);
      const adapter = buildAdapter(fake);

      expect(adapter.queryTopRouteFeatureAt([1, 2], ["a"])).toEqual({
        routeFeatureId: "climb-2000",
      });
    });

    it("returns the raw (possibly malformed) routeFeatureId value as-is — validation is the caller's job", () => {
      const fake = buildFakeMapLibreMap();
      fake.queryRenderedFeatures.mockReturnValue([
        { properties: { routeFeatureId: 42 } },
      ]);
      const adapter = buildAdapter(fake);

      expect(adapter.queryTopRouteFeatureAt([1, 2], ["a"])).toEqual({
        routeFeatureId: 42,
      });
    });

    it("returns null when queryRenderedFeatures returns no features", () => {
      const fake = buildFakeMapLibreMap();
      fake.queryRenderedFeatures.mockReturnValue([]);
      const adapter = buildAdapter(fake);

      expect(adapter.queryTopRouteFeatureAt([1, 2], ["a"])).toBeNull();
    });

    it("returns null, never throws, when project() throws", () => {
      const fake = buildFakeMapLibreMap();
      fake.project.mockImplementation(() => {
        throw new Error("style not ready");
      });
      const adapter = buildAdapter(fake);

      expect(() => adapter.queryTopRouteFeatureAt([1, 2], ["a"])).not.toThrow();
      expect(adapter.queryTopRouteFeatureAt([1, 2], ["a"])).toBeNull();
    });

    it("returns null, never throws, when queryRenderedFeatures() throws (e.g. an unready layer id)", () => {
      const fake = buildFakeMapLibreMap();
      fake.queryRenderedFeatures.mockImplementation(() => {
        throw new Error("layer not found");
      });
      const adapter = buildAdapter(fake);

      expect(() => adapter.queryTopRouteFeatureAt([1, 2], ["a"])).not.toThrow();
      expect(adapter.queryTopRouteFeatureAt([1, 2], ["a"])).toBeNull();
    });

    it("returns null without calling project or queryRenderedFeatures when layerIds is empty", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);

      expect(adapter.queryTopRouteFeatureAt([1, 2], [])).toBeNull();
      expect(fake.project).not.toHaveBeenCalled();
      expect(fake.queryRenderedFeatures).not.toHaveBeenCalled();
    });
  });

  it("addLineLayer passes line-dasharray through only when provided", () => {
    const fake = buildFakeMapLibreMap();
    const adapter = buildAdapter(fake);

    adapter.addLineLayer("solid", "source-a", { lineColor: "#000", lineWidth: 2 });
    adapter.addLineLayer("dashed", "source-b", {
      lineColor: "#000",
      lineWidth: 2,
      lineDasharray: [2, 2],
    });

    const [solidCall, dashedCall] = fake.addLayer.mock.calls as [
      [{ paint: Record<string, unknown> }],
      [{ paint: Record<string, unknown> }],
    ];
    expect(solidCall[0].paint).not.toHaveProperty("line-dasharray");
    expect(dashedCall[0].paint["line-dasharray"]).toEqual([2, 2]);
  });

  describe("addLineLayer with a data-driven line colour", () => {
    it("builds a match expression keyed on the given property with an explicit fallback", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);

      adapter.addLineLayer("gradient", "gradient-source", {
        lineColor: {
          property: "gradientClass",
          cases: { flat: "#2e7d63", "hard-climb": "#d55e00" },
          fallback: "#b3aa9c",
        },
        lineWidth: 5,
      });

      const [call] = fake.addLayer.mock.calls as [[{ paint: Record<string, unknown> }]];
      expect(call[0].paint["line-color"]).toEqual([
        "match",
        ["get", "gradientClass"],
        "flat",
        "#2e7d63",
        "hard-climb",
        "#d55e00",
        "#b3aa9c",
      ]);
    });

    it("leaves every existing plain-string lineColor call site unaffected", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);

      adapter.addLineLayer("solid", "source-a", { lineColor: "#0a5f38", lineWidth: 5 });

      const [call] = fake.addLayer.mock.calls as [[{ paint: Record<string, unknown> }]];
      expect(call[0].paint["line-color"]).toBe("#0a5f38");
    });
  });

  describe("addLineLayer with a zoom-interpolated line width", () => {
    it("builds a linear zoom-interpolate expression from the given stops", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);

      adapter.addLineLayer("route", "route-source", {
        lineColor: "#0a5f38",
        lineWidth: {
          stops: [
            { zoom: 6, width: 2 },
            { zoom: 11, width: 3.25 },
            { zoom: 15, width: 5 },
          ],
        },
      });

      const [call] = fake.addLayer.mock.calls as [[{ paint: Record<string, unknown> }]];
      expect(call[0].paint["line-width"]).toEqual([
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        2,
        11,
        3.25,
        15,
        5,
      ]);
    });

    it("leaves every existing plain-number lineWidth call site unaffected", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);

      adapter.addLineLayer("solid", "source-a", { lineColor: "#0a5f38", lineWidth: 5 });

      const [call] = fake.addLayer.mock.calls as [[{ paint: Record<string, unknown> }]];
      expect(call[0].paint["line-width"]).toBe(5);
    });
  });

  describe("addImage", () => {
    it("passes the image through unchanged with a default pixelRatio of 1 and sdf false", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);
      const data = new Uint8ClampedArray(4);

      adapter.addImage("icon-a", { width: 1, height: 1, data });

      expect(fake.addImage).toHaveBeenCalledWith(
        "icon-a",
        { width: 1, height: 1, data },
        { pixelRatio: 1, sdf: false },
      );
    });

    it("passes a supplied pixelRatio through, still with sdf false", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);
      const data = new Uint8ClampedArray(4);

      adapter.addImage("icon-a", { width: 1, height: 1, data }, { pixelRatio: 2 });

      expect(fake.addImage).toHaveBeenCalledWith(
        "icon-a",
        { width: 1, height: 1, data },
        { pixelRatio: 2, sdf: false },
      );
    });
  });

  it("hasImage delegates to the underlying map", () => {
    const fake = buildFakeMapLibreMap();
    fake.hasImage.mockReturnValue(true);
    const adapter = buildAdapter(fake);

    expect(adapter.hasImage("icon-a")).toBe(true);
    expect(fake.hasImage).toHaveBeenCalledWith("icon-a");
  });

  describe("addSymbolLayer", () => {
    it("adds a line-placed symbol layer with rotation/pitch tracking the line and keep-upright disabled", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);

      adapter.addSymbolLayer("arrows", "route-source", "arrow-icon", {
        spacingPixels: 140,
      });

      expect(fake.addLayer).toHaveBeenCalledWith({
        id: "arrows",
        type: "symbol",
        source: "route-source",
        layout: {
          "icon-image": "arrow-icon",
          "symbol-placement": "line",
          "symbol-spacing": 140,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-keep-upright": false,
        },
      });
    });

    it("never sets icon-allow-overlap, leaving MapLibre's own collision behaviour at its default", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);

      adapter.addSymbolLayer("arrows", "route-source", "arrow-icon", {
        spacingPixels: 140,
      });

      const [[call]] = fake.addLayer.mock.calls as [
        [{ layout: Record<string, unknown> }],
      ];
      expect(call.layout).not.toHaveProperty("icon-allow-overlap");
    });
  });

  describe("onError classification", () => {
    it("classifies an error carrying a sourceId as source-or-tile", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);
      const listener = vi.fn();

      adapter.onError(listener);
      const errorHandler = findHandler(fake, "error");
      errorHandler({ error: new Error("tile failed"), sourceId: "openmaptiles" });

      expect(listener).toHaveBeenCalledWith({
        message: "tile failed",
        category: "source-or-tile",
      });
    });

    // Characterises MapLibre's declared ErrorLike contract ({ message: string }),
    // not a reproduction of any observed CI/E2E failure: the maplibre-gl 6.6.0
    // bump's real regression was lint-only (@typescript-eslint/no-base-to-string
    // on the old `event.error instanceof Error ? ... : String(event.error)`
    // fallback), never an E2E or runtime failure.
    it("reads .message directly from a structural, non-Error ErrorLike payload", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);
      const listener = vi.fn();

      adapter.onError(listener);
      const errorHandler = findHandler(fake, "error");
      errorHandler({ error: { message: "tile failed" }, sourceId: "openmaptiles" });

      expect(listener).toHaveBeenCalledWith({
        message: "tile failed",
        category: "source-or-tile",
      });
    });

    it("classifies a no-sourceId error before style.load as style-request-or-parse", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);
      const listener = vi.fn();

      adapter.onError(listener);
      const errorHandler = findHandler(fake, "error");
      errorHandler({ error: new Error("style fetch failed") });

      expect(listener).toHaveBeenCalledWith({
        message: "style fetch failed",
        category: "style-request-or-parse",
      });
    });

    it("classifies a no-sourceId error after style.load as sprite", () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);
      const listener = vi.fn();

      const styleLoadHandler = findHandler(fake, "style.load");
      styleLoadHandler(undefined);

      adapter.onError(listener);
      const errorHandler = findHandler(fake, "error");
      errorHandler({ error: new Error("sprite fetch failed") });

      expect(listener).toHaveBeenCalledWith({
        message: "sprite fetch failed",
        category: "sprite",
      });
    });

    it("synthesises a webgl-init error once, asynchronously, when the map never created a painter", async () => {
      const fake = buildFakeMapLibreMap(undefined, { painter: undefined });
      const adapter = buildAdapter(fake);
      const listener = vi.fn();

      adapter.onError(listener);
      expect(listener).not.toHaveBeenCalled();

      await Promise.resolve();
      await Promise.resolve();

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ category: "webgl-init" }),
      );
    });

    it("never synthesises a webgl-init error when the map did create a painter", async () => {
      const fake = buildFakeMapLibreMap();
      const adapter = buildAdapter(fake);
      const listener = vi.fn();

      adapter.onError(listener);
      await Promise.resolve();
      await Promise.resolve();

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
