import { describe, expect, it } from "vitest";
import type { ClimbCategory, DescentBand } from "./routeFeatures.ts";
import {
  CLIMB_CATEGORY_NAMES,
  CLIMB_GRADIENT_BAND_COLOUR_NAMES,
  MICRO_DETAIL_COLOURS,
  ORDINARY_ROUTE_COLOUR,
  ROUTE_FEATURE_COLOUR_NAMES,
  ROUTE_FEATURE_COLOURS,
  ROUTE_FEATURE_LABELS,
  ROUTE_FEATURE_LEGEND_ENTRIES,
  type MicroDetailVisualKey,
  type RouteFeatureVisualKey,
} from "./routeFeaturePalette.ts";

const CLIMB_CATEGORIES: readonly ClimbCategory[] = [
  "uncategorised",
  "category-4",
  "category-3",
  "category-2",
  "category-1",
  "hc",
];

const DESCENT_BANDS: readonly DescentBand[] = ["moderate", "steep", "very-steep"];

const ALL_ROUTE_FEATURE_VISUAL_KEYS: readonly RouteFeatureVisualKey[] = [
  ...CLIMB_CATEGORIES,
  ...DESCENT_BANDS,
];

const ALL_MICRO_DETAIL_VISUAL_KEYS: readonly MicroDetailVisualKey[] = [
  "gentle-or-descending",
  "moderate-climb",
  "hard-climb",
  "very-hard-climb",
  "extremely-steep-climb",
  "moderate",
  "steep",
  "very-steep",
  "neutral",
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

/** "Redmean" weighted Euclidean RGB distance — copied verbatim from
 * gradient.ts's own test suite convention (not imported, since it is not
 * exported anywhere). */
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

/** The existing map colours a rider will see alongside route-feature
 * colouring — kept as a literal snapshot (not imported), matching this
 * module's own precedent elsewhere in the codebase. Includes the route's
 * own remaining/start colour, which ORDINARY_ROUTE_COLOUR (and therefore
 * MICRO_DETAIL_COLOURS.neutral) is deliberately IDENTICAL to — see the
 * dedicated equality test below, not the general distinctness check. */
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

describe("route feature palette: macro colours", () => {
  it("has an entry for every climb category and descent band", () => {
    for (const visualKey of ALL_ROUTE_FEATURE_VISUAL_KEYS) {
      expect(ROUTE_FEATURE_COLOURS[visualKey]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps every route-feature colour distinguishable from every existing warning/route colour", () => {
    const tooClose: string[] = [];
    for (const visualKey of ALL_ROUTE_FEATURE_VISUAL_KEYS) {
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

  it("keeps every pair of route-feature colours distinguishable from each other, except the intentional Uncategorised/Category 4 tie", () => {
    const tooClose: string[] = [];
    for (let i = 0; i < ALL_ROUTE_FEATURE_VISUAL_KEYS.length; i += 1) {
      for (let j = i + 1; j < ALL_ROUTE_FEATURE_VISUAL_KEYS.length; j += 1) {
        const keyA = ALL_ROUTE_FEATURE_VISUAL_KEYS[i];
        const keyB = ALL_ROUTE_FEATURE_VISUAL_KEYS[j];
        if (keyA === undefined || keyB === undefined) continue;
        const isIntentionalTie =
          (keyA === "uncategorised" && keyB === "category-4") ||
          (keyA === "category-4" && keyB === "uncategorised");
        if (isIntentionalTie) continue;
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

  it("gives Uncategorised and Category 4 climbs the exact same macro colour", () => {
    expect(ROUTE_FEATURE_COLOURS.uncategorised).toBe(ROUTE_FEATURE_COLOURS["category-4"]);
    expect(ROUTE_FEATURE_COLOUR_NAMES.uncategorised).toBe(
      ROUTE_FEATURE_COLOUR_NAMES["category-4"],
    );
  });

  it("has a colour name for every climb category and descent band", () => {
    for (const visualKey of ALL_ROUTE_FEATURE_VISUAL_KEYS) {
      expect(ROUTE_FEATURE_COLOUR_NAMES[visualKey]).toBeTruthy();
    }
  });

  it("never lets CLIMB_CATEGORY_NAMES and ROUTE_FEATURE_LABELS drift apart", () => {
    for (const category of CLIMB_CATEGORIES) {
      expect(ROUTE_FEATURE_LABELS[category]).toBe(
        `${CLIMB_CATEGORY_NAMES[category]} climb`,
      );
    }
  });

  // A literal snapshot so any accidental reintroduction of ambiguous
  // adjacent-band wording (both "moderate" and "steep" claiming −6%, both
  // "steep" and "very-steep" claiming −9%) shows up as a failing diff.
  it("states every descent-band boundary unambiguously", () => {
    expect(ROUTE_FEATURE_LABELS.moderate).toBe(
      "Recognised descent (moderate, 3% to just below 6%)",
    );
    expect(ROUTE_FEATURE_LABELS.steep).toBe(
      "Recognised descent (steep, 6% to just below 9%)",
    );
    expect(ROUTE_FEATURE_LABELS["very-steep"]).toBe(
      "Recognised descent (very steep, 9% or more)",
    );
  });
});

describe("route feature legend entries", () => {
  it("combines Uncategorised and Category 4 into a single legend row", () => {
    const combined = ROUTE_FEATURE_LEGEND_ENTRIES.find((entry) =>
      entry.visualKeys.includes("uncategorised"),
    );
    expect(combined?.visualKeys).toContain("category-4");
    expect(combined?.visualKeys).toHaveLength(2);
  });

  it("covers every route-feature visual key exactly once", () => {
    const covered = ROUTE_FEATURE_LEGEND_ENTRIES.flatMap((entry) => entry.visualKeys);
    expect([...covered].sort()).toEqual([...ALL_ROUTE_FEATURE_VISUAL_KEYS].sort());
  });

  it("has three distinct descent rows, not one merged blue", () => {
    const descentEntries = ROUTE_FEATURE_LEGEND_ENTRIES.filter((entry) =>
      entry.visualKeys.some((key) => DESCENT_BANDS.includes(key as DescentBand)),
    );
    expect(descentEntries).toHaveLength(3);
    const colours = new Set(descentEntries.map((entry) => entry.colour));
    expect(colours.size).toBe(3);
  });
});

describe("micro detail (local gradient band) colours", () => {
  it("has a valid colour for every climb/descent local band", () => {
    for (const visualKey of ALL_MICRO_DETAIL_VISUAL_KEYS) {
      expect(MICRO_DETAIL_COLOURS[visualKey]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps every climb local band colour distinguishable from every existing warning/route colour", () => {
    const climbBands: readonly MicroDetailVisualKey[] = [
      "gentle-or-descending",
      "moderate-climb",
      "hard-climb",
      "very-hard-climb",
      "extremely-steep-climb",
    ];
    const tooClose: string[] = [];
    for (const visualKey of climbBands) {
      const hex = MICRO_DETAIL_COLOURS[visualKey];
      for (const [name, existingHex] of Object.entries(EXISTING_MAP_COLOURS)) {
        const distance = colourDistance(hex, existingHex);
        if (distance < MINIMUM_DISTANCE) {
          tooClose.push(`${visualKey} vs ${name}: ${distance.toFixed(1)}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("keeps the 5 climb bands and the neutral colour pairwise distinguishable from each other", () => {
    const keys: readonly MicroDetailVisualKey[] = [
      "gentle-or-descending",
      "moderate-climb",
      "hard-climb",
      "very-hard-climb",
      "extremely-steep-climb",
      "neutral",
    ];
    const tooClose: string[] = [];
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const keyA = keys[i];
        const keyB = keys[j];
        if (keyA === undefined || keyB === undefined) continue;
        const distance = colourDistance(
          MICRO_DETAIL_COLOURS[keyA],
          MICRO_DETAIL_COLOURS[keyB],
        );
        if (distance < MINIMUM_DISTANCE) {
          tooClose.push(`${keyA} vs ${keyB}: ${distance.toFixed(1)}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("reuses the exact same colour token for corresponding macro climb category and local band", () => {
    expect(MICRO_DETAIL_COLOURS["gentle-or-descending"]).toBe(
      ROUTE_FEATURE_COLOURS.uncategorised,
    );
    expect(MICRO_DETAIL_COLOURS["gentle-or-descending"]).toBe(
      ROUTE_FEATURE_COLOURS["category-4"],
    );
    expect(MICRO_DETAIL_COLOURS["moderate-climb"]).toBe(
      ROUTE_FEATURE_COLOURS["category-3"],
    );
    expect(MICRO_DETAIL_COLOURS["hard-climb"]).toBe(ROUTE_FEATURE_COLOURS["category-2"]);
    expect(MICRO_DETAIL_COLOURS["very-hard-climb"]).toBe(
      ROUTE_FEATURE_COLOURS["category-1"],
    );
    expect(MICRO_DETAIL_COLOURS["extremely-steep-climb"]).toBe(ROUTE_FEATURE_COLOURS.hc);
  });

  it("reuses the exact same colour for a descent band at both macro and local level", () => {
    for (const band of DESCENT_BANDS) {
      expect(MICRO_DETAIL_COLOURS[band]).toBe(ROUTE_FEATURE_COLOURS[band]);
    }
  });

  it("renders a descent's neutral local stretch as the plain ordinary-route colour", () => {
    expect(MICRO_DETAIL_COLOURS.neutral).toBe(ORDINARY_ROUTE_COLOUR);
    expect(ORDINARY_ROUTE_COLOUR).toBe(EXISTING_MAP_COLOURS["route: remaining/start"]);
  });

  it("has a colour name for every climb local band, distinct from its neighbours", () => {
    const names = new Set(Object.values(CLIMB_GRADIENT_BAND_COLOUR_NAMES));
    expect(names.size).toBe(5);
  });

  it("never labels a local climb band with overall-category wording", () => {
    for (const label of Object.values(CLIMB_GRADIENT_BAND_COLOUR_NAMES)) {
      expect(label).not.toMatch(/category/i);
    }
  });
});
