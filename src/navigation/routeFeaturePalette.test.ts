import { describe, expect, it } from "vitest";
import { ROUTE_FEATURE_COLOURS, ROUTE_FEATURE_ORDER } from "./routeFeaturePalette.ts";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

/** "Redmean" weighted Euclidean RGB distance — see gradientPalette.test.ts
 * for the same formula and rationale; copied verbatim here (not
 * imported) since it is not exported. */
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

/** The existing map colours a rider will see alongside macro route-feature
 * colouring — kept as a literal snapshot (not imported), mirroring
 * gradientPalette.test.ts's own documented rationale. Deliberately
 * excludes GRADIENT_CLASS_COLOURS: macro and micro colouring are never
 * shown at the same route point simultaneously (see routeFeaturePalette.ts's
 * own doc comment), so no cross-check against them is required. */
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
  "fallback map background": "#dcdad4",
};

const MINIMUM_DISTANCE = 50;

describe("route feature palette", () => {
  it("has an entry for every climb category and descent severity", () => {
    for (const visualKey of ROUTE_FEATURE_ORDER) {
      expect(ROUTE_FEATURE_COLOURS[visualKey]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps every route-feature colour distinguishable from every existing warning/route colour", () => {
    const tooClose: string[] = [];
    for (const visualKey of ROUTE_FEATURE_ORDER) {
      const featureHex = ROUTE_FEATURE_COLOURS[visualKey];
      for (const [name, existingHex] of Object.entries(EXISTING_MAP_COLOURS)) {
        const distance = colourDistance(featureHex, existingHex);
        if (distance < MINIMUM_DISTANCE) {
          tooClose.push(`${visualKey} vs ${name}: ${distance.toFixed(1)}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("keeps every pair of route-feature colours distinguishable from each other", () => {
    const tooClose: string[] = [];
    for (let i = 0; i < ROUTE_FEATURE_ORDER.length; i += 1) {
      for (let j = i + 1; j < ROUTE_FEATURE_ORDER.length; j += 1) {
        const keyA = ROUTE_FEATURE_ORDER[i];
        const keyB = ROUTE_FEATURE_ORDER[j];
        if (keyA === undefined || keyB === undefined) continue;
        const distance = colourDistance(
          ROUTE_FEATURE_COLOURS[keyA],
          ROUTE_FEATURE_COLOURS[keyB],
        );
        if (distance < MINIMUM_DISTANCE) {
          tooClose.push(`${keyA} vs ${keyB}: ${distance.toFixed(1)}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });
});
