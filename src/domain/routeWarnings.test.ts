import { describe, expect, it } from "vitest";
import {
  isStructuralWarningKind,
  isSurfaceWarningKind,
  routeWarningIdentity,
} from "./routeWarnings.ts";
import type { RouteWarning, RouteWarningKind, SurfaceType } from "./types.ts";
import { decodeSurfaceCode, UNKNOWN_SURFACE } from "../routing/surfaceCodes.ts";

function warning(overrides: Partial<RouteWarning> = {}): RouteWarning {
  return {
    kind: "questionable-surface",
    startDistanceMetres: 0,
    endDistanceMetres: 100,
    message: "Questionable surface for a road bike: gravel / fine gravel.",
    surface: { type: "gravel", label: "Gravel / fine gravel" },
    ...overrides,
  };
}

describe("the surface table's type/label mapping", () => {
  // The identity below reduces a surface warning to its `kind` and
  // `surface.type`, which is only sound while type and label determine
  // each other. Both directions are enumerated rather than assumed: if
  // either ever breaks, this fails before anything starts merging
  // warnings that mean different things.
  // Enumerated through the module's own public decoder rather than by
  // reaching into its table: this proves the property callers actually
  // depend on, and needs no widening of that module's API for a test.
  // The range spans every code openrouteservice documents, plus the
  // removed and unrecognised ones, which all resolve to UNKNOWN_SURFACE.
  const entries = [
    ...new Map(
      Array.from({ length: 32 }, (_, code) => decodeSurfaceCode(code)).map((entry) => [
        entry.type,
        entry,
      ]),
    ).values(),
  ];

  it("gives every surface type exactly one label", () => {
    const labelsByType = new Map<SurfaceType, Set<string>>();
    for (const entry of entries) {
      const labels = labelsByType.get(entry.type) ?? new Set<string>();
      labels.add(entry.label);
      labelsByType.set(entry.type, labels);
    }
    for (const [type, labels] of labelsByType) {
      expect([...labels], `surface type ${type}`).toHaveLength(1);
    }
  });

  it("gives every label exactly one surface type", () => {
    const typesByLabel = new Map<string, Set<SurfaceType>>();
    for (const entry of entries) {
      const types = typesByLabel.get(entry.label) ?? new Set<SurfaceType>();
      types.add(entry.type);
      typesByLabel.set(entry.label, types);
    }
    for (const [label, types] of typesByLabel) {
      expect([...types], `surface label ${label}`).toHaveLength(1);
    }
  });

  it("covers the whole table, so neither direction passes vacuously", () => {
    // 15 classified surfaces plus the shared unknown result.
    expect(entries.length).toBe(16);
    expect(entries).toContainEqual(UNKNOWN_SURFACE);
    expect(new Set(entries.map((entry) => entry.type)).size).toBe(entries.length);
  });
});

describe("warning-kind classification", () => {
  it("treats the three surface kinds as surface kinds", () => {
    for (const kind of [
      "unknown-surface",
      "questionable-surface",
      "unsuitable-surface",
    ] as const) {
      expect(isSurfaceWarningKind(kind)).toBe(true);
      expect(isStructuralWarningKind(kind)).toBe(false);
    }
  });

  it("treats every other kind as structural", () => {
    for (const kind of ["access", "steps", "ford", "ferry", "other"] as const) {
      expect(isStructuralWarningKind(kind)).toBe(true);
      expect(isSurfaceWarningKind(kind)).toBe(false);
    }
  });
});

describe("routeWarningIdentity", () => {
  it("ignores the stored message when surface detail is present", () => {
    // The approved behaviour change: a route saved before the surface
    // table was corrected carries a stale label, and must still be
    // recognised as the same warning.
    const stale = warning({
      message: "Questionable surface for a road bike: fine gravel.",
      surface: { type: "gravel", label: "Fine gravel" },
    });
    expect(routeWarningIdentity(stale)).toBe(routeWarningIdentity(warning()));
  });

  it("ignores the distance range, which is what coalescing merges", () => {
    expect(
      routeWarningIdentity(warning({ startDistanceMetres: 900, endDistanceMetres: 950 })),
    ).toBe(routeWarningIdentity(warning()));
  });

  it("separates different surface types", () => {
    expect(
      routeWarningIdentity(warning({ surface: { type: "sand", label: "Sand" } })),
    ).not.toBe(routeWarningIdentity(warning()));
  });

  it("separates different kinds carrying the same surface type", () => {
    expect(routeWarningIdentity(warning({ kind: "unsuitable-surface" }))).not.toBe(
      routeWarningIdentity(warning()),
    );
  });

  it("uses the kind alone for a structural warning", () => {
    const steps = warning({
      kind: "steps",
      message: "Route includes steps.",
      surface: undefined,
    });
    const stepsElsewhere = warning({
      kind: "steps",
      message: "Route includes steps.",
      surface: undefined,
      startDistanceMetres: 500,
      endDistanceMetres: 540,
    });
    expect(routeWarningIdentity(steps)).toBe(routeWarningIdentity(stepsElsewhere));
    expect(routeWarningIdentity(steps)).not.toBe(
      routeWarningIdentity(warning({ kind: "ferry", surface: undefined })),
    );
  });

  it("keeps a legacy surface warning's message in its identity", () => {
    // No `surface` field at all — saved before it existed. The stored
    // message is the only remaining evidence of WHICH surface it was, so
    // dropping it would merge a legacy gravel stretch into a legacy sand
    // one. This is the honest fallback, not a translation gap.
    const legacyGravel = warning({
      message: "Questionable surface for a road bike: gravel.",
      surface: undefined,
    });
    const legacySand = warning({
      message: "Unsuitable surface for a road bike: sand.",
      kind: "questionable-surface",
      surface: undefined,
    });
    expect(routeWarningIdentity(legacyGravel)).not.toBe(routeWarningIdentity(legacySand));
    expect(routeWarningIdentity(legacyGravel)).toBe(
      routeWarningIdentity(warning({ ...legacyGravel, startDistanceMetres: 700 })),
    );
  });

  it("never confuses a legacy surface warning with a structured one", () => {
    const structured = warning();
    const legacy = warning({ surface: undefined });
    expect(routeWarningIdentity(structured)).not.toBe(routeWarningIdentity(legacy));
  });

  it("is not fooled by a message engineered to look like a serialised key", () => {
    // Identity is JSON-serialised rather than joined with a separator
    // character, so a message cannot impersonate another warning's key.
    const hostile = warning({
      kind: "questionable-surface",
      surface: undefined,
      message: '","gravel",null]',
    });
    expect(routeWarningIdentity(hostile)).not.toBe(routeWarningIdentity(warning()));
  });
});

describe("kind coverage", () => {
  it("classifies every RouteWarningKind exactly once", () => {
    const kinds: readonly RouteWarningKind[] = [
      "unknown-surface",
      "questionable-surface",
      "unsuitable-surface",
      "access",
      "steps",
      "ford",
      "ferry",
      "other",
    ];
    for (const kind of kinds) {
      expect(isSurfaceWarningKind(kind) !== isStructuralWarningKind(kind)).toBe(true);
    }
  });
});
