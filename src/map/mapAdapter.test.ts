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
) {
  const fake = {
    fitBounds: vi.fn(),
    easeTo: vi.fn(),
    jumpTo: vi.fn(),
    getCenter: vi.fn(() => center),
    getZoom: vi.fn(() => 12),
    getBearing: vi.fn(() => 45),
    getPitch: vi.fn(() => 20),
    on: vi.fn(),
  };
  return fake;
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
});
