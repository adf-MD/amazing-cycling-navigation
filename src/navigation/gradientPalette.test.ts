import { describe, expect, it } from "vitest";
import {
  GRADIENT_CLASS_COLOUR_NAMES,
  GRADIENT_CLASS_COLOURS,
  GRADIENT_CLASS_NAMES,
  GRADIENT_CLASS_ORDER,
  GRADIENT_CLASS_RANGE_LABELS,
} from "./gradientPalette.ts";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

/** "Redmean" weighted Euclidean RGB distance — a simple, deterministic,
 * widely-used low-vision-friendlier approximation of perceptual colour
 * difference (see https://www.compuphase.com/cmetric.htm). Used here only
 * as a documented, automatable minimum-separation check, not a claim of
 * exact perceptual uniformity. */
function colourDistance(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const rMean = (a.r + b.r) / 2;
  const deltaR = a.r - b.r;
  const deltaG = a.g - b.g;
  const deltaB = a.b - b.b;
  return Math.sqrt(
    (2 + rMean / 256) * deltaR ** 2 +
      4 * deltaG ** 2 +
      (2 + (255 - rMean) / 256) * deltaB ** 2,
  );
}

/** The existing map colours a rider will see alongside gradient colouring,
 * read directly from src/map/MapView.tsx's WARNING_CATEGORY_PAINT,
 * WARNING_SELECTED_PAINT and route/marker paint constants — kept as a
 * literal snapshot here (rather than imported) so this test independently
 * documents what it's checking against, and so a future colour change in
 * MapView.tsx doesn't silently disable this check. */
const EXISTING_MAP_COLOURS: Readonly<Record<string, string>> = {
  "warning: unknown-surface": "#5f6368",
  "warning: other": "#455a64",
  "warning: ferry": "#0d47a1",
  "warning: questionable-surface": "#f2a900",
  "warning: unsuitable-surface": "#d32f2f",
  "warning: obstacle": "#7b1fa2",
  "warning: selected halo": "#000000",
  "route: remaining/start": "#0a5f38",
  "route: completed": "#8a8f8c",
  "position marker": "#1a73e8",
  "finish marker": "#101010",
  // The local fallback map style's own background (MapView.tsx's
  // FALLBACK_STYLE) — every gradient colour must also stay readable
  // against this, not just against other route/warning colours. Found
  // missing during e2e verification: the "unknown" grey sits much closer
  // to this light background than to any other existing colour, which no
  // check here would otherwise have caught.
  "fallback map background": "#dcdad4",
};

const MINIMUM_DISTANCE = 50;

describe("gradient palette", () => {
  it("has an entry for every gradient class", () => {
    for (const gradientClass of GRADIENT_CLASS_ORDER) {
      expect(GRADIENT_CLASS_COLOURS[gradientClass]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps every gradient colour distinguishable from every existing warning/route colour", () => {
    const tooClose: string[] = [];
    for (const gradientClass of GRADIENT_CLASS_ORDER) {
      const gradientHex = GRADIENT_CLASS_COLOURS[gradientClass];
      for (const [name, existingHex] of Object.entries(EXISTING_MAP_COLOURS)) {
        const distance = colourDistance(gradientHex, existingHex);
        if (distance < MINIMUM_DISTANCE) {
          tooClose.push(`${gradientClass} vs ${name}: ${distance.toFixed(1)}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("keeps every pair of gradient colours distinguishable from each other", () => {
    const tooClose: string[] = [];
    for (let i = 0; i < GRADIENT_CLASS_ORDER.length; i += 1) {
      for (let j = i + 1; j < GRADIENT_CLASS_ORDER.length; j += 1) {
        const classA = GRADIENT_CLASS_ORDER[i];
        const classB = GRADIENT_CLASS_ORDER[j];
        if (classA === undefined || classB === undefined) continue;
        const distance = colourDistance(
          GRADIENT_CLASS_COLOURS[classA],
          GRADIENT_CLASS_COLOURS[classB],
        );
        if (distance < MINIMUM_DISTANCE) {
          tooClose.push(`${classA} vs ${classB}: ${distance.toFixed(1)}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("has a name, range and colour name for every gradient class", () => {
    for (const gradientClass of GRADIENT_CLASS_ORDER) {
      expect(GRADIENT_CLASS_NAMES[gradientClass]).toBeTruthy();
      expect(GRADIENT_CLASS_RANGE_LABELS[gradientClass]).toBeTruthy();
      expect(GRADIENT_CLASS_COLOUR_NAMES[gradientClass]).toBeTruthy();
    }
  });

  // A literal snapshot (not derived) so any accidental reintroduction of
  // ambiguous adjacent boundary text — e.g. two adjacent bands both
  // stating "−6%" with no inequality cue — shows up immediately as a
  // failing diff, per this slice's own precise-range-description
  // requirement.
  it("states every range boundary unambiguously, with no two adjacent bands claiming the same boundary value", () => {
    expect(GRADIENT_CLASS_RANGE_LABELS).toEqual({
      "steep-descent": "Below −6%",
      descent: "−6% to just below −2%",
      flat: "−2% to just below 2%",
      "gentle-climb": "2% to just below 4%",
      "moderate-climb": "4% to just below 7%",
      "hard-climb": "7% to just below 10%",
      "very-steep-climb": "10% or more",
      unknown: "No elevation data",
    });
  });

  it("keeps every gradient colour name distinct within the class list", () => {
    const names = GRADIENT_CLASS_ORDER.map((cls) => GRADIENT_CLASS_COLOUR_NAMES[cls]);
    expect(new Set(names).size).toBe(names.length);
  });
});
