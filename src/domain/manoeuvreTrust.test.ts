import { describe, expect, it } from "vitest";
import { hasTrustedManoeuvres } from "./manoeuvreTrust.ts";
import type { Manoeuvre, PlannedRoute } from "./types.ts";

const MANOEUVRE: Manoeuvre = { distanceFromStartMetres: 50, type: "left" };

function buildRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id: "test-route",
    name: "Test route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [],
    manoeuvres: [],
    distanceMetres: 0,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "gpx-import" },
    ...overrides,
  };
}

describe("hasTrustedManoeuvres", () => {
  it("is false when manoeuvres is empty, regardless of provenance or source", () => {
    expect(hasTrustedManoeuvres(buildRoute())).toBe(false);
    expect(
      hasTrustedManoeuvres(
        buildRoute({
          source: { kind: "planner" },
          manoeuvreProvenance: { kind: "routing-provider", provider: "openrouteservice" },
        }),
      ),
    ).toBe(false);
  });

  it("is true for non-empty manoeuvres with routing-provider provenance", () => {
    expect(
      hasTrustedManoeuvres(
        buildRoute({
          manoeuvres: [MANOEUVRE],
          manoeuvreProvenance: { kind: "routing-provider", provider: "openrouteservice" },
        }),
      ),
    ).toBe(true);
  });

  it("is true for non-empty manoeuvres with acn-gpx-extension provenance", () => {
    expect(
      hasTrustedManoeuvres(
        buildRoute({
          manoeuvres: [MANOEUVRE],
          manoeuvreProvenance: { kind: "acn-gpx-extension", version: 1 },
          source: { kind: "gpx-import" },
        }),
      ),
    ).toBe(true);
  });

  it("falls back to the legacy planner rule when provenance is absent", () => {
    expect(
      hasTrustedManoeuvres(
        buildRoute({ manoeuvres: [MANOEUVRE], source: { kind: "planner" } }),
      ),
    ).toBe(true);
  });

  it("is false for a legacy gpx-import route with no provenance, even with manoeuvres", () => {
    expect(
      hasTrustedManoeuvres(
        buildRoute({ manoeuvres: [MANOEUVRE], source: { kind: "gpx-import" } }),
      ),
    ).toBe(false);
  });
});
