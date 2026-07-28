import { describe, expect, it } from "vitest";
import {
  buildRouteArrowIconBitmap,
  ROUTE_ARROW_ICON_HEIGHT,
  ROUTE_ARROW_ICON_WIDTH,
} from "./routeArrowIcon.ts";

function pixelAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [
    data[offset] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0,
  ];
}

function opaquePixelCountInColumn(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
): number {
  let count = 0;
  for (let y = 0; y < height; y++) {
    if (pixelAt(data, width, x, y)[3] > 0) count++;
  }
  return count;
}

describe("buildRouteArrowIconBitmap", () => {
  it("has the documented fixed dimensions", () => {
    const { width, height, data } = buildRouteArrowIconBitmap();

    expect(width).toBe(ROUTE_ARROW_ICON_WIDTH);
    expect(height).toBe(ROUTE_ARROW_ICON_HEIGHT);
    expect(data.length).toBe(width * height * 4);
  });

  it("leaves every corner fully transparent", () => {
    const { width, height, data } = buildRouteArrowIconBitmap();

    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ] as const) {
      expect(pixelAt(data, width, x, y)[3]).toBe(0);
    }
  });

  it("fills the vertical centre of the base column with solid white", () => {
    const { width, data } = buildRouteArrowIconBitmap();

    expect(pixelAt(data, width, 0, 6)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(data, width, 0, 7)).toEqual([255, 255, 255, 255]);
  });

  it("outlines the base column's edge rows with the dark halo", () => {
    const { width, data } = buildRouteArrowIconBitmap();

    expect(pixelAt(data, width, 0, 1)).toEqual([26, 26, 26, 255]);
    expect(pixelAt(data, width, 0, 12)).toEqual([26, 26, 26, 255]);
  });

  it("never produces a partially transparent pixel", () => {
    const { data } = buildRouteArrowIconBitmap();

    for (let i = 3; i < data.length; i += 4) {
      expect(data[i] === 0 || data[i] === 255).toBe(true);
    }
  });

  it("never produces a colour other than the fill or halo colour", () => {
    const { data } = buildRouteArrowIconBitmap();

    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a === 0) continue;
      const isFill = r === 255 && g === 255 && b === 255;
      const isHalo = r === 26 && g === 26 && b === 26;
      expect(isFill || isHalo).toBe(true);
    }
  });

  it("tapers from a wide base to a bare tip, proving genuine left-to-right directionality", () => {
    const { width, height, data } = buildRouteArrowIconBitmap();

    const baseCount = opaquePixelCountInColumn(data, width, height, 0);
    const midCount = opaquePixelCountInColumn(data, width, height, 9);
    const nearTipCount = opaquePixelCountInColumn(data, width, height, 17);
    const tipCount = opaquePixelCountInColumn(data, width, height, width - 1);

    expect(baseCount).toBe(12);
    expect(midCount).toBe(6);
    expect(nearTipCount).toBe(2);
    expect(tipCount).toBe(0);
    expect(baseCount).toBeGreaterThan(midCount);
    expect(midCount).toBeGreaterThan(nearTipCount);
    expect(nearTipCount).toBeGreaterThan(tipCount);
  });

  it("is deterministic across calls", () => {
    const first = buildRouteArrowIconBitmap();
    const second = buildRouteArrowIconBitmap();

    expect(second.data).toEqual(first.data);
  });
});
