import { describe, expect, it } from "vitest";
import {
  legibleWidthStops,
  recedingWidthStops,
  ROUTE_WIDTH_CLOSE_ZOOM,
  ROUTE_WIDTH_OVERVIEW_ZOOM,
  ROUTE_WIDTH_REGIONAL_ZOOM,
} from "./routeWidthPolicy.ts";

const CLOSE_ZOOM_WIDTHS = [4, 5, 8, 9, 10, 13];

describe("recedingWidthStops / legibleWidthStops", () => {
  it("resolve to the unchanged existing width at close zoom, for every representative width", () => {
    for (const closeWidthPx of CLOSE_ZOOM_WIDTHS) {
      const receding = recedingWidthStops(closeWidthPx);
      const legible = legibleWidthStops(closeWidthPx);
      expect(receding.stops.at(-1)).toEqual({
        zoom: ROUTE_WIDTH_CLOSE_ZOOM,
        width: closeWidthPx,
      });
      expect(legible.stops.at(-1)).toEqual({
        zoom: ROUTE_WIDTH_CLOSE_ZOOM,
        width: closeWidthPx,
      });
    }
  });

  it("stamp the shared overview/regional/close zoom stops in ascending order", () => {
    for (const closeWidthPx of CLOSE_ZOOM_WIDTHS) {
      for (const stops of [
        recedingWidthStops(closeWidthPx),
        legibleWidthStops(closeWidthPx),
      ]) {
        expect(stops.stops.map((stop) => stop.zoom)).toEqual([
          ROUTE_WIDTH_OVERVIEW_ZOOM,
          ROUTE_WIDTH_REGIONAL_ZOOM,
          ROUTE_WIDTH_CLOSE_ZOOM,
        ]);
      }
    }
  });

  it("are monotonically non-decreasing: overview <= regional <= close", () => {
    for (const closeWidthPx of CLOSE_ZOOM_WIDTHS) {
      for (const stops of [
        recedingWidthStops(closeWidthPx),
        legibleWidthStops(closeWidthPx),
      ]) {
        const widths = stops.stops.map((stop) => stop.width);
        expect(widths[0]).toBeLessThanOrEqual(widths[1] ?? Number.POSITIVE_INFINITY);
        expect(widths[1]).toBeLessThanOrEqual(widths[2] ?? Number.POSITIVE_INFINITY);
      }
    }
  });

  it("never recede below a legible ~3px floor at overview for a typical 5px casing width", () => {
    expect(legibleWidthStops(5).stops[0]?.width).toBeGreaterThanOrEqual(3);
  });

  it("legibleWidthStops (casing) stays wider than or equal to recedingWidthStops (overlay) at every stop, for the same input width", () => {
    for (const closeWidthPx of CLOSE_ZOOM_WIDTHS) {
      const receding = recedingWidthStops(closeWidthPx);
      const legible = legibleWidthStops(closeWidthPx);
      for (let index = 0; index < 3; index += 1) {
        expect(legible.stops[index]?.width).toBeGreaterThanOrEqual(
          receding.stops[index]?.width ?? 0,
        );
      }
      // At close zoom the two families are required to coincide exactly —
      // preserving today's exact appearance (no visible casing ring).
      expect(legible.stops.at(-1)?.width).toBe(receding.stops.at(-1)?.width);
      // At overview/regional the casing is strictly wider, so a ring of
      // neutral casing colour becomes visible around the narrower overlay.
      expect(legible.stops[0]?.width).toBeGreaterThan(receding.stops[0]?.width ?? 0);
      expect(legible.stops[1]?.width).toBeGreaterThan(receding.stops[1]?.width ?? 0);
    }
  });

  it("scales proportionally, preserving relative width ordering between two same-family layers at every zoom", () => {
    // e.g. a selection halo (9) must stay wider than the macro overlay it
    // rings (5) at every zoom when both use the same family.
    const wider = recedingWidthStops(9);
    const narrower = recedingWidthStops(5);
    for (let index = 0; index < 3; index += 1) {
      expect(wider.stops[index]?.width).toBeGreaterThan(
        narrower.stops[index]?.width ?? 0,
      );
    }
  });
});
