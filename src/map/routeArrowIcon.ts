import type { StyleImagePixelData } from "./mapAdapter.ts";

/** Registered once per map instance via MapLibreLike.addImage; MapView
 * guards registration with hasImage before calling addImage again. */
export const ROUTE_ARROW_ICON_ID = "acn-route-arrow";

/** Raw bitmap pixels (before pixelRatio scaling) — deliberately small,
 * a "restrained" decorative orientation aid rather than a prominent icon. */
export const ROUTE_ARROW_ICON_WIDTH = 20;
export const ROUTE_ARROW_ICON_HEIGHT = 14;

/** MapLibre's own addImage default pixelRatio is 1, which would render
 * this bitmap soft on a retina iPhone screen. Baking it at 2x and
 * passing this as the pixelRatio option (the same "@2x asset"
 * convention a sprite sheet uses) keeps the on-map icon small (~10x7
 * CSS px) while staying crisp. */
export const ROUTE_ARROW_ICON_PIXEL_RATIO = 2;

const FILL_RGBA = [255, 255, 255, 255] as const;
const HALO_RGBA = [26, 26, 26, 255] as const;

/**
 * Builds a small right-pointing triangular chevron as plain (non-SDF)
 * RGBA pixel data — a solid white fill with a 1px near-black halo for
 * contrast against both this app's own route-line colours and
 * arbitrary basemap imagery. Deterministic and DOM/canvas-free, so it
 * runs identically under Vitest and a real browser, and needs no
 * network request or bundled binary asset.
 *
 * Authored pointing along +x (rightward), not "up": MapLibre's
 * icon-rotation-alignment: "map" combined with symbol-placement: "line"
 * aligns the icon's x-axis, not its vertical axis, with the line
 * direction (confirmed against the installed style-spec reference).
 */
export function buildRouteArrowIconBitmap(): StyleImagePixelData {
  const width = ROUTE_ARROW_ICON_WIDTH;
  const height = ROUTE_ARROW_ICON_HEIGHT;
  const data = new Uint8ClampedArray(width * height * 4);

  const centreY = (height - 1) / 2;
  const maxHalfHeight = height / 2 - 1;

  for (let x = 0; x < width; x++) {
    const halfHeightAtX = maxHalfHeight * (1 - x / (width - 1));
    for (let y = 0; y < height; y++) {
      const distanceFromCentre = Math.abs(y - centreY);
      let rgba: readonly [number, number, number, number] | null = null;
      if (distanceFromCentre <= halfHeightAtX - 1) {
        rgba = FILL_RGBA;
      } else if (distanceFromCentre <= halfHeightAtX) {
        rgba = HALO_RGBA;
      }
      if (rgba) {
        const offset = (y * width + x) * 4;
        data[offset] = rgba[0];
        data[offset + 1] = rgba[1];
        data[offset + 2] = rgba[2];
        data[offset + 3] = rgba[3];
      }
    }
  }

  return { width, height, data };
}
