import { describe, expect, it } from "vitest";
import {
  decodeSurfaceCode,
  UNKNOWN_SURFACE,
  type DecodedSurface,
} from "./surfaceCodes.ts";

// Verified byte-for-byte against ORS's live documentation (see
// surfaceCodes.ts's own doc comment for the source URL and date) — every
// documented code except 0 ("Unknown") and the three removed codes,
// which are covered by dedicated tests below instead.
const EXPECTED: Record<number, DecodedSurface> = {
  1: { type: "paved", label: "Paved", classification: "paved" },
  3: { type: "asphalt", label: "Asphalt", classification: "paved" },
  4: { type: "concrete", label: "Concrete", classification: "paved" },
  2: {
    type: "unpaved-unspecified",
    label: "Unpaved (unspecified)",
    classification: "questionable-surface",
  },
  6: { type: "metal", label: "Metal", classification: "questionable-surface" },
  7: { type: "wood", label: "Wood", classification: "questionable-surface" },
  8: {
    type: "compacted-gravel",
    label: "Compacted gravel",
    classification: "questionable-surface",
  },
  10: {
    type: "gravel",
    label: "Gravel / fine gravel",
    classification: "questionable-surface",
  },
  14: {
    type: "paving-stones",
    label: "Paving stones / cobblestone",
    classification: "questionable-surface",
  },
  18: {
    type: "grass-paver",
    label: "Grass paver",
    classification: "questionable-surface",
  },
  11: { type: "dirt", label: "Dirt", classification: "unsuitable-surface" },
  12: { type: "ground", label: "Ground or mud", classification: "unsuitable-surface" },
  13: { type: "ice", label: "Ice or snow", classification: "unsuitable-surface" },
  15: { type: "sand", label: "Sand", classification: "unsuitable-surface" },
  17: { type: "grass", label: "Grass", classification: "unsuitable-surface" },
};

describe("decodeSurfaceCode", () => {
  it.each(Object.entries(EXPECTED))(
    "decodes documented code %s exactly",
    (code, expected) => {
      expect(decodeSurfaceCode(Number(code))).toEqual(expected);
    },
  );

  it('resolves ORS\'s own documented code 0 ("Unknown") to UNKNOWN_SURFACE', () => {
    expect(decodeSurfaceCode(0)).toBe(UNKNOWN_SURFACE);
  });

  // Regression guard: codes 5 (Cobblestone), 9 (Fine Gravel) and 16
  // (Woodchips) were removed by ORS. This must never silently revert to
  // their old stale mappings (previously: 5/9 -> questionable-surface,
  // 16 -> unsuitable-surface).
  it.each([5, 9, 16])(
    "resolves a documented-removed code (%s) to UNKNOWN_SURFACE rather than a stale legacy meaning",
    (code) => {
      expect(decodeSurfaceCode(code)).toBe(UNKNOWN_SURFACE);
    },
  );

  it("resolves a genuinely unrecognised code to UNKNOWN_SURFACE, never paved or unsuitable", () => {
    expect(decodeSurfaceCode(9999)).toBe(UNKNOWN_SURFACE);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.5])(
    "resolves a malformed value (%s) to UNKNOWN_SURFACE",
    (value) => {
      expect(decodeSurfaceCode(value)).toBe(UNKNOWN_SURFACE);
    },
  );

  it("always returns the same shared UNKNOWN_SURFACE object, never a structural copy", () => {
    expect(decodeSurfaceCode(0)).toBe(decodeSurfaceCode(9999));
  });
});
