import { describe, expect, it } from "vitest";
import {
  clearanceInsideDart,
  DART_PATH,
  DART_VERTICES,
  NORTH_LETTER_PATH,
  isInsideDart,
  letterClearanceAtBearing,
  NORTH_ARROW_SIZE_PX,
  NORTH_LETTER_BOUNDS,
  NORTH_LETTER_CORNERS,
  ROTATION_CENTRE,
  rotateAboutCentre,
  VIEWBOX_UNITS,
} from "./northArrowGeometry.ts";

/** User units to rendered pixels at the shipped icon size. */
const PX_PER_UNIT = NORTH_ARROW_SIZE_PX / VIEWBOX_UNITS;

describe("north arrow geometry", () => {
  describe("the dart itself", () => {
    // Written out in full, deliberately NOT compared against the exported
    // constant: a test that asserts a constant equals itself moves with
    // any edit to it and proves nothing. Item 110's follow-up is
    // expressly not permitted to reshape this silhouette, so the shape is
    // pinned here as a literal.
    it("is exactly the silhouette item 110 shipped", () => {
      expect(DART_PATH).toBe("M12 3 L19 20.5 L12 16 L5 20.5 Z");
    });

    it("keeps its vertex list in step with that path", () => {
      // The containment proof works off the vertices while the component
      // draws the path; if they ever disagree, the proof is measuring a
      // different shape from the one on screen.
      const numbers = (DART_PATH.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const fromPath: [number, number][] = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        fromPath.push([numbers[i] ?? 0, numbers[i + 1] ?? 0]);
      }
      expect(fromPath).toEqual(DART_VERTICES.map((vertex) => [vertex[0], vertex[1]]));
    });

    it("contains its own centre and excludes the notch below it", () => {
      expect(isInsideDart(ROTATION_CENTRE)).toBe(true);
      // The notch vertex is at (12,16); directly below it the shape has
      // split into two wings and the centre line is empty.
      expect(isInsideDart([12, 18])).toBe(false);
      expect(isInsideDart([12, 15.5])).toBe(true);
    });

    it("reports the inradius about the rotation centre that fixes the icon size", () => {
      // This is the number the whole follow-up turns on. It is set by the
      // two slanted edges, not by the notch.
      expect(clearanceInsideDart(ROTATION_CENTRE)).toBeCloseTo(3.3425, 3);
    });
  });

  describe("the upright letter", () => {
    // Pinned as a literal for the same reason the dart is: a constant
    // compared against itself moves with any edit to it. This caught a
    // real gap — a negative control that redrew the letter passed until
    // this and the bounds check below existed.
    it("is exactly the letter shipped in 0.4.28", () => {
      expect(NORTH_LETTER_PATH).toBe(
        "M10.11 14.15 V9.85 H11.06 L12.94 12.95 V9.85 H13.89 V14.15 H12.94 L11.06 11.05 V14.15 Z",
      );
    });

    // The load-bearing one. The containment sweep works off
    // NORTH_LETTER_BOUNDS while the component draws NORTH_LETTER_PATH; if
    // the two ever drift, the proof is measuring a box the letter does
    // not occupy and would keep passing while the letter clipped.
    it("keeps its bounds in step with the path actually drawn", () => {
      const numbers = (NORTH_LETTER_PATH.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      // The path alternates absolute H and V commands after its initial
      // move, so parse by command rather than by position.
      const commands = NORTH_LETTER_PATH.match(/[MHVL][^MHVLZ]*/g) ?? [];
      let x = 0;
      let y = 0;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const command of commands) {
        const parts = (command.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        if (command.startsWith("M") || command.startsWith("L")) {
          x = parts[0] ?? x;
          y = parts[1] ?? y;
        } else if (command.startsWith("H")) {
          x = parts[0] ?? x;
        } else {
          y = parts[0] ?? y;
        }
        xs.push(x);
        ys.push(y);
      }
      expect(numbers.length).toBeGreaterThan(0);
      expect(Math.min(...xs)).toBeCloseTo(NORTH_LETTER_BOUNDS.minX, 6);
      expect(Math.max(...xs)).toBeCloseTo(NORTH_LETTER_BOUNDS.maxX, 6);
      expect(Math.min(...ys)).toBeCloseTo(NORTH_LETTER_BOUNDS.minY, 6);
      expect(Math.max(...ys)).toBeCloseTo(NORTH_LETTER_BOUNDS.maxY, 6);
    });

    it("is centred on the rotation centre, so rotation cannot move it", () => {
      const [cx, cy] = ROTATION_CENTRE;
      expect((NORTH_LETTER_BOUNDS.minX + NORTH_LETTER_BOUNDS.maxX) / 2).toBeCloseTo(
        cx,
        6,
      );
      expect((NORTH_LETTER_BOUNDS.minY + NORTH_LETTER_BOUNDS.maxY) / 2).toBeCloseTo(
        cy,
        6,
      );
    });

    it("renders at the approved ink size", () => {
      const widthPx = (NORTH_LETTER_BOUNDS.maxX - NORTH_LETTER_BOUNDS.minX) * PX_PER_UNIT;
      const heightPx =
        (NORTH_LETTER_BOUNDS.maxY - NORTH_LETTER_BOUNDS.minY) * PX_PER_UNIT;
      expect(widthPx).toBeCloseTo(6.6, 1);
      expect(heightPx).toBeCloseTo(7.5, 1);
    });

    // The contract, swept continuously rather than sampled. A bearing can
    // be any real number, so checking only the cardinal angles would leave
    // the worst case — around the diagonals — completely untested.
    it("keeps positive clearance inside the dart at every whole-degree bearing", () => {
      for (let bearing = 0; bearing < 360; bearing++) {
        const clearanceUnits = letterClearanceAtBearing(bearing);
        expect(
          clearanceUnits,
          `letter clips the dart at bearing ${String(bearing)}deg`,
        ).toBeGreaterThan(0);
      }
    });

    it("keeps the approved +0.84px clearance at its worst bearing", () => {
      let worstUnits = Number.POSITIVE_INFINITY;
      let worstBearing = 0;
      for (let tenths = 0; tenths < 3600; tenths++) {
        const bearing = tenths / 10;
        const clearanceUnits = letterClearanceAtBearing(bearing);
        if (clearanceUnits < worstUnits) {
          worstUnits = clearanceUnits;
          worstBearing = bearing;
        }
      }
      const worstPx = worstUnits * PX_PER_UNIT;
      expect(
        worstPx,
        `worst clearance ${worstPx.toFixed(3)}px at ${worstBearing.toFixed(1)}deg`,
      ).toBeGreaterThan(0.8);
      expect(worstPx).toBeLessThan(0.9);
    });

    // The letter's ink is a fixed physical size, so shrinking the box
    // shrinks the disc it has to fit inside while the letter stays put.
    // These are the two box sizes that were measured and rejected during
    // planning, kept as executable evidence so neither is re-proposed
    // from the prose alone.
    it("would clip the dart at the previously proposed 26px and 32px boxes", () => {
      const inkWidthPx =
        (NORTH_LETTER_BOUNDS.maxX - NORTH_LETTER_BOUNDS.minX) * PX_PER_UNIT;
      const inkHeightPx =
        (NORTH_LETTER_BOUNDS.maxY - NORTH_LETTER_BOUNDS.minY) * PX_PER_UNIT;
      const letterHalfDiagonalPx = Math.hypot(inkWidthPx / 2, inkHeightPx / 2);
      const inradiusUnits = clearanceInsideDart(ROTATION_CENTRE);

      /** Clearance this same letter would have in a box of `boxPx`. */
      const clearancePxAt = (boxPx: number) =>
        inradiusUnits * (boxPx / VIEWBOX_UNITS) - letterHalfDiagonalPx;

      expect(clearancePxAt(26)).toBeLessThan(0);
      expect(clearancePxAt(32)).toBeLessThan(0);
      expect(clearancePxAt(NORTH_ARROW_SIZE_PX)).toBeGreaterThan(0.8);
      expect(NORTH_ARROW_SIZE_PX).toBe(42);
    });
  });

  // Item 110 second follow-up. Enlarging the artwork moves it towards the
  // button's border, so that clearance becomes the contract closest to
  // being breached and is swept here rather than sampled in a browser.
  //
  // The button's geometry is a CSS fact, so it is stated here rather than
  // in the geometry module: 48px across with `box-sizing: border-box`
  // globally, `border-radius: 50%` and a 2px border, so its inner border
  // edge is a circle of radius 22px. The pressed state drops the border
  // (`.is-pressed { border: none }`), giving 24px.
  describe("the dart inside its button", () => {
    const BUTTON_INNER_RADIUS_PX = 22;
    const BUTTON_PRESSED_INNER_RADIUS_PX = 24;

    /** The dart's own circumradius about the rotation centre. Because the
     * dart turns about that exact point, this distance — and therefore the
     * clearance below — is identical at every bearing. */
    function farthestVertexUnits(): number {
      const [cx, cy] = ROTATION_CENTRE;
      return Math.max(
        ...DART_VERTICES.map((vertex) => Math.hypot(vertex[0] - cx, vertex[1] - cy)),
      );
    }

    it("is the wings, not the apex, that come closest to the border", () => {
      const [cx, cy] = ROTATION_CENTRE;
      const distances = DART_VERTICES.map((vertex) =>
        Math.hypot(vertex[0] - cx, vertex[1] - cy),
      );
      // apex 9, wings 11.0114, notch 4 — so a wing governs.
      expect(Math.max(...distances)).toBeCloseTo(11.0114, 3);
      expect(distances.indexOf(Math.max(...distances))).not.toBe(0);
    });

    it("clears the button border at every whole-degree bearing", () => {
      const radiusPx = farthestVertexUnits() * PX_PER_UNIT;
      for (let bearing = 0; bearing < 360; bearing++) {
        // Rotating about the centre cannot change a radial distance, so
        // this asserts the invariance as much as the clearance.
        const rotated = DART_VERTICES.map((vertex) => rotateAboutCentre(vertex, bearing));
        const [cx, cy] = ROTATION_CENTRE;
        const worst = Math.max(
          ...rotated.map((vertex) => Math.hypot(vertex[0] - cx, vertex[1] - cy)),
        );
        expect(worst * PX_PER_UNIT).toBeCloseTo(radiusPx, 9);
        expect(
          BUTTON_INNER_RADIUS_PX - worst * PX_PER_UNIT,
          `dart reaches the border at ${String(bearing)}deg`,
        ).toBeGreaterThan(0);
      }
    });

    it("leaves the measured clearance in both colour states", () => {
      const radiusPx = farthestVertexUnits() * PX_PER_UNIT;
      const idle = BUTTON_INNER_RADIUS_PX - radiusPx;
      const pressed = BUTTON_PRESSED_INNER_RADIUS_PX - radiusPx;
      expect(idle).toBeGreaterThan(2.5);
      expect(pressed).toBeGreaterThan(idle);
      // The svg's own square box must also fit the button's content box,
      // which is 44px while the 2px border is present.
      expect(NORTH_ARROW_SIZE_PX).toBeLessThanOrEqual(44);
    });
  });

  describe("rotateAboutCentre", () => {
    it("leaves the centre fixed", () => {
      const [x, y] = rotateAboutCentre(ROTATION_CENTRE, 137);
      expect(x).toBeCloseTo(12, 9);
      expect(y).toBeCloseTo(12, 9);
    });

    it("turns clockwise, matching SVG's own rotate() convention", () => {
      // y points down in SVG, so a positive angle takes "up" to "right".
      const [x, y] = rotateAboutCentre([12, 2], 90);
      expect(x).toBeCloseTo(22, 6);
      expect(y).toBeCloseTo(12, 6);
    });

    it("returns every letter corner to itself after a full revolution", () => {
      for (const corner of NORTH_LETTER_CORNERS) {
        const [x, y] = rotateAboutCentre(corner, 360);
        expect(x).toBeCloseTo(corner[0], 9);
        expect(y).toBeCloseTo(corner[1], 9);
      }
    });
  });
});
