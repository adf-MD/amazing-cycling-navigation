import { describe, expect, it } from "vitest";
import {
  legibleWidthStops,
  recedingWidthStops,
  ROUTE_WIDTH_CLOSE_ZOOM,
  ROUTE_WIDTH_OVERVIEW_ZOOM,
  ROUTE_WIDTH_REGIONAL_ZOOM,
  warningWidthStops,
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

// Backlog item 39: surface/access/ferry warning casings and the
// selected-warning halo previously shared legibleWidthStops with the
// neutral base/selection halos, which meant an ordinary warning barely
// receded at low zoom and visually dominated a full-route overview.
// warningWidthStops fixes that while preserving the existing nested-ring
// priority (selected warning > selected route-feature halo > category
// casings > climb/descent colour > neutral base) at every zoom.
describe("warningWidthStops", () => {
  // Category casings (8/9/10) and the selected-warning halo (13) — every
  // close-width warningWidthStops is actually called with in MapView.tsx.
  const WARNING_REFERENCE_WIDTHS = [8, 9, 10, 13];

  it("resolves to the unchanged existing width at close zoom, for every reference warning width", () => {
    for (const closeWidthPx of WARNING_REFERENCE_WIDTHS) {
      expect(warningWidthStops(closeWidthPx).stops.at(-1)).toEqual({
        zoom: ROUTE_WIDTH_CLOSE_ZOOM,
        width: closeWidthPx,
      });
    }
  });

  it("stamps the shared overview/regional/close zoom stops in ascending order", () => {
    for (const closeWidthPx of WARNING_REFERENCE_WIDTHS) {
      expect(warningWidthStops(closeWidthPx).stops.map((stop) => stop.zoom)).toEqual([
        ROUTE_WIDTH_OVERVIEW_ZOOM,
        ROUTE_WIDTH_REGIONAL_ZOOM,
        ROUTE_WIDTH_CLOSE_ZOOM,
      ]);
    }
  });

  it("is monotonically non-decreasing: overview <= regional <= close", () => {
    for (const closeWidthPx of WARNING_REFERENCE_WIDTHS) {
      const widths = warningWidthStops(closeWidthPx).stops.map((stop) => stop.width);
      expect(widths[0]).toBeLessThanOrEqual(widths[1] ?? Number.POSITIVE_INFINITY);
      expect(widths[1]).toBeLessThanOrEqual(widths[2] ?? Number.POSITIVE_INFINITY);
    }
  });

  it("stays strictly narrower than legibleWidthStops at overview and regional, and matches exactly at close, for every reference width", () => {
    for (const closeWidthPx of WARNING_REFERENCE_WIDTHS) {
      const warning = warningWidthStops(closeWidthPx);
      const legible = legibleWidthStops(closeWidthPx);
      expect(warning.stops[0]?.width).toBeLessThan(legible.stops[0]?.width ?? 0);
      expect(warning.stops[1]?.width).toBeLessThan(legible.stops[1]?.width ?? 0);
      expect(warning.stops.at(-1)?.width).toBe(legible.stops.at(-1)?.width);
    }
  });

  it("every warning category width stays wider than recedingWidthStops(5) (the climb/descent overlay centre), at overview and regional", () => {
    const gradientCentre = recedingWidthStops(5);
    for (const closeWidthPx of [8, 9, 10]) {
      const warning = warningWidthStops(closeWidthPx);
      expect(warning.stops[0]?.width).toBeGreaterThan(
        gradientCentre.stops[0]?.width ?? 0,
      );
      expect(warning.stops[1]?.width).toBeGreaterThan(
        gradientCentre.stops[1]?.width ?? 0,
      );
    }
  });

  it("the narrowest warning category (8) stays wider than legibleWidthStops(5) (the neutral route base), at every stop", () => {
    const narrowestWarning = warningWidthStops(8);
    const neutralBase = legibleWidthStops(5);
    for (let index = 0; index < 3; index += 1) {
      expect(narrowestWarning.stops[index]?.width).toBeGreaterThan(
        neutralBase.stops[index]?.width ?? 0,
      );
    }
  });

  it("the selected-warning halo (13) stays wider than the selected route-feature halo (legibleWidthStops(9)), at every stop", () => {
    const selectedWarning = warningWidthStops(13);
    const selectedFeature = legibleWidthStops(9);
    for (let index = 0; index < 3; index += 1) {
      expect(selectedWarning.stops[index]?.width).toBeGreaterThan(
        selectedFeature.stops[index]?.width ?? 0,
      );
    }
  });

  it("the selected-warning halo (13) stays wider than every warning category width, at every stop", () => {
    const selectedWarning = warningWidthStops(13);
    for (const categoryWidth of [8, 9, 10]) {
      const category = warningWidthStops(categoryWidth);
      for (let index = 0; index < 3; index += 1) {
        expect(selectedWarning.stops[index]?.width).toBeGreaterThan(
          category.stops[index]?.width ?? 0,
        );
      }
    }
  });

  it("scales proportionally, preserving relative width ordering between two warning-family widths at every zoom", () => {
    const wider = warningWidthStops(10);
    const narrower = warningWidthStops(8);
    for (let index = 0; index < 3; index += 1) {
      expect(wider.stops[index]?.width).toBeGreaterThan(
        narrower.stops[index]?.width ?? 0,
      );
    }
  });
});
