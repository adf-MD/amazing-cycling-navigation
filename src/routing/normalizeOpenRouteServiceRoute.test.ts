import { describe, expect, it } from "vitest";
import { normalizeOpenRouteServiceRoute } from "./normalizeOpenRouteServiceRoute.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
import type { OrsFeatureCollectionResponse } from "./openRouteServiceTypes.ts";

const OPTIONS = {
  name: "Test route",
  createdAt: "2026-01-01T00:00:00.000Z",
  profile: "cycling-road" as const,
  providerId: "openrouteservice",
};

function buildResponse(
  overrides: Partial<OrsFeatureCollectionResponse["features"][0]["properties"]> = {},
): OrsFeatureCollectionResponse {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          // Deliberately implausible vs. the geometry's own elevation
          // profile, to prove this value is never used.
          summary: { distance: 999_999, duration: 100, ascent: 12_345, descent: 12_345 },
          segments: [
            {
              distance: 200,
              duration: 20,
              steps: [
                {
                  distance: 100,
                  duration: 10,
                  type: 0,
                  instruction: "Head east",
                  way_points: [0, 2],
                },
                {
                  distance: 100,
                  duration: 10,
                  type: 1,
                  instruction: "Continue",
                  way_points: [2, 5],
                },
              ],
            },
          ],
          extras: {
            surface: {
              // Covers points 0-2 (paved, code 1). Points 2-3 are
              // deliberately left uncovered (a gap -> unknown). Points
              // 3-5 are unsuitable (sand, code 15).
              values: [
                [0, 2, 1],
                [3, 5, 15],
              ],
            },
          },
          ...overrides,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 51, 10],
            [0.001, 51, 15],
            [0.002, 51, 20],
            [0.003, 51, 15],
            [0.004, 51], // no elevation for this point
            [0.005, 51, 10],
          ],
        },
      },
    ],
  };
}

describe("normalizeOpenRouteServiceRoute", () => {
  it("builds dense geometry with per-point elevation, including a missing point", () => {
    const route = normalizeOpenRouteServiceRoute(buildResponse(), OPTIONS);

    expect(route.points).toHaveLength(6);
    expect(route.points[0]?.elevationMetres).toBe(10);
    expect(route.points[4]?.elevationMetres).toBeNull();
    expect(route.points.map((p) => p.coordinate[0])).toEqual([
      0, 0.001, 0.002, 0.003, 0.004, 0.005,
    ]);
  });

  it("computes distance from its own cumulative-distance sum, not summary.distance", () => {
    const route = normalizeOpenRouteServiceRoute(buildResponse(), OPTIONS);

    expect(route.distanceMetres).toBeGreaterThan(0);
    expect(route.distanceMetres).not.toBe(999_999);
  });

  it("computes ascent/descent using the project's own smoothing policy, not the provider's summary", () => {
    const route = normalizeOpenRouteServiceRoute(buildResponse(), OPTIONS);

    expect(route.ascentMetres).not.toBeNull();
    expect(route.ascentMetres).not.toBe(12_345);
    expect(route.descentMetres).not.toBe(12_345);
  });

  it("builds manoeuvres from segments/steps, indexed against the geometry's own distances", () => {
    const route = normalizeOpenRouteServiceRoute(buildResponse(), OPTIONS);

    expect(route.manoeuvres).toHaveLength(2);
    expect(route.manoeuvres[0]).toMatchObject({
      distanceFromStartMetres: route.points[0]?.distanceFromStartMetres,
      type: "0",
      instruction: "Head east",
    });
    expect(route.manoeuvres[1]).toMatchObject({
      distanceFromStartMetres: route.points[2]?.distanceFromStartMetres,
      type: "1",
    });
  });

  it("classifies surface into paved/unsuitable/unknown buckets that sum to the total distance", () => {
    const route = normalizeOpenRouteServiceRoute(buildResponse(), OPTIONS);
    const summary = route.surfaceSummary;
    expect(summary).toBeDefined();
    if (!summary) return;

    expect(summary.pavedMetres).toBeGreaterThan(0);
    expect(summary.unsuitableMetres).toBeGreaterThan(0);
    expect(summary.unknownMetres).toBeGreaterThan(0); // the gap between the two triples
    expect(summary.questionableMetres).toBe(0);

    const sum =
      summary.pavedMetres +
      summary.questionableMetres +
      summary.unsuitableMetres +
      summary.unknownMetres;
    expect(sum).toBeCloseTo(route.distanceMetres, 6);
  });

  it("emits inspectable warnings for both the gap (unknown-surface) and the unsuitable-surface range", () => {
    const route = normalizeOpenRouteServiceRoute(buildResponse(), OPTIONS);

    expect(route.warnings).toHaveLength(2);
    expect(route.warnings[0]?.kind).toBe("unknown-surface");
    expect(route.warnings[0]?.message).toBe(
      "Surface data is unavailable for this segment.",
    );
    expect(route.warnings[0]?.startDistanceMetres).toBeCloseTo(
      route.points[2]?.distanceFromStartMetres ?? -1,
      6,
    );
    expect(route.warnings[0]?.endDistanceMetres).toBeCloseTo(
      route.points[3]?.distanceFromStartMetres ?? -1,
      6,
    );
    expect(route.warnings[1]?.kind).toBe("unsuitable-surface");
    expect(route.warnings[1]?.startDistanceMetres).toBeCloseTo(
      route.points[3]?.distanceFromStartMetres ?? -1,
      6,
    );
  });

  it("emits a questionable-surface warning with the existing message for a recognised questionable code", () => {
    const response: OrsFeatureCollectionResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            summary: { distance: 0, duration: 0 },
            extras: { surface: { values: [[0, 4, 8]] } }, // compacted gravel
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 51],
              [0.001, 51],
              [0.002, 51],
              [0.003, 51],
              [0.004, 51],
            ],
          },
        },
      ],
    };
    const route = normalizeOpenRouteServiceRoute(response, OPTIONS);

    expect(route.warnings).toEqual([
      {
        kind: "questionable-surface",
        startDistanceMetres: 0,
        endDistanceMetres: route.distanceMetres,
        message: "Questionable surface for a road bike.",
      },
    ]);
  });

  it("emits an unsuitable-surface warning with the existing message for a recognised unsuitable code", () => {
    const response: OrsFeatureCollectionResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            summary: { distance: 0, duration: 0 },
            extras: { surface: { values: [[0, 4, 15]] } }, // sand
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 51],
              [0.001, 51],
              [0.002, 51],
              [0.003, 51],
              [0.004, 51],
            ],
          },
        },
      ],
    };
    const route = normalizeOpenRouteServiceRoute(response, OPTIONS);

    expect(route.warnings).toEqual([
      {
        kind: "unsuitable-surface",
        startDistanceMetres: 0,
        endDistanceMetres: route.distanceMetres,
        message: "Unsuitable surface for a road bike.",
      },
    ]);
  });

  it("treats a fully absent surface extra as entirely unknown, with one whole-route warning", () => {
    const response = buildResponse({ extras: undefined });
    const route = normalizeOpenRouteServiceRoute(response, OPTIONS);

    expect(route.surfaceSummary).toEqual({
      pavedMetres: 0,
      questionableMetres: 0,
      unsuitableMetres: 0,
      unknownMetres: route.distanceMetres,
    });
    expect(route.warnings).toEqual([
      {
        kind: "unknown-surface",
        startDistanceMetres: 0,
        endDistanceMetres: route.distanceMetres,
        message: "Surface data is unavailable for this segment.",
      },
    ]);
  });

  it("produces no warning for a zero-length route (single-coordinate geometry)", () => {
    const response: OrsFeatureCollectionResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { summary: { distance: 0, duration: 0 } },
          geometry: { type: "LineString", coordinates: [[0, 51]] },
        },
      ],
    };
    const route = normalizeOpenRouteServiceRoute(response, OPTIONS);

    expect(route.distanceMetres).toBe(0);
    expect(route.surfaceSummary).toEqual({
      pavedMetres: 0,
      questionableMetres: 0,
      unsuitableMetres: 0,
      unknownMetres: 0,
    });
    expect(route.warnings).toEqual([]);
  });

  it("sets planner provenance with the given provider and profile", () => {
    const route = normalizeOpenRouteServiceRoute(buildResponse(), OPTIONS);

    expect(route.source).toEqual({
      kind: "planner",
      provider: "openrouteservice",
      profile: "cycling-road",
    });
  });

  it("throws a RoutingError for a response with no features", () => {
    const response: OrsFeatureCollectionResponse = {
      type: "FeatureCollection",
      features: [],
    };

    expect(() => normalizeOpenRouteServiceRoute(response, OPTIONS)).toThrow(RoutingError);
  });

  it("throws a RoutingError for a feature with empty geometry", () => {
    const response: OrsFeatureCollectionResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { summary: { distance: 0, duration: 0 } },
          geometry: { type: "LineString", coordinates: [] },
        },
      ],
    };

    expect(() => normalizeOpenRouteServiceRoute(response, OPTIONS)).toThrow(RoutingError);
  });

  describe("overlapping and noisy surface ranges", () => {
    it("does not double-count an overlap between differently-classified ranges (earlier-sorted range wins)", () => {
      // Points 0-3 (paved) and 2-5 (unsuitable) genuinely overlap at
      // points 2-3. The earlier-sorted (paved) range keeps that distance;
      // the unsuitable range only counts from where the paved range left
      // off, so the two buckets never sum to more than the route total.
      const response = buildResponse({
        extras: {
          surface: {
            values: [
              [0, 3, 1],
              [2, 5, 15],
            ],
          },
        },
      });
      const route = normalizeOpenRouteServiceRoute(response, OPTIONS);
      const summary = route.surfaceSummary;
      expect(summary).toBeDefined();
      if (!summary) return;

      const sum =
        summary.pavedMetres +
        summary.questionableMetres +
        summary.unsuitableMetres +
        summary.unknownMetres;
      expect(sum).toBeCloseTo(route.distanceMetres, 6);

      expect(route.warnings).toHaveLength(1);
      expect(route.warnings[0]?.kind).toBe("unsuitable-surface");
      // The unsuitable warning starts where the paved range's own end
      // is, not at its own raw (overlapping) start.
      expect(route.warnings[0]?.startDistanceMetres).toBeCloseTo(
        route.points[3]?.distanceFromStartMetres ?? -1,
        6,
      );
    });

    it("coalesces two same-classification ranges separated only by a sub-metre gap", () => {
      // p2 sits a fraction of a metre past p1 — the two "gravel"
      // (questionable) triples are logically continuous, and the gap
      // between them is floating-point/GPS noise, not a real unknown
      // stretch.
      const response: OrsFeatureCollectionResponse = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              summary: { distance: 0, duration: 0 },
              extras: {
                surface: {
                  values: [
                    [0, 1, 10],
                    [2, 4, 10],
                  ],
                },
              },
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 51],
                [0.001, 51],
                [0.0010001, 51],
                [0.002, 51],
                [0.003, 51],
              ],
            },
          },
        ],
      };
      const route = normalizeOpenRouteServiceRoute(response, OPTIONS);

      expect(route.warnings).toHaveLength(1);
      expect(route.warnings[0]?.kind).toBe("questionable-surface");
      expect(route.warnings[0]?.startDistanceMetres).toBeCloseTo(0, 6);
      expect(route.warnings[0]?.endDistanceMetres).toBeCloseTo(route.distanceMetres, 6);
      expect(route.surfaceSummary?.unknownMetres ?? -1).toBeCloseTo(0, 6);
    });

    it("safely ignores a surface triple whose point indices are entirely out of range", () => {
      const response = buildResponse({
        extras: {
          surface: {
            values: [
              [0, 2, 1],
              [3, 5, 15],
              [10, 12, 1], // out of range for a 6-point route
            ],
          },
        },
      });

      const route = normalizeOpenRouteServiceRoute(response, OPTIONS);
      const summary = route.surfaceSummary;
      expect(summary).toBeDefined();
      if (!summary) return;
      const sum =
        summary.pavedMetres +
        summary.questionableMetres +
        summary.unsuitableMetres +
        summary.unknownMetres;
      expect(sum).toBeCloseTo(route.distanceMetres, 6);
      expect(route.warnings).toHaveLength(2);
      expect(route.warnings.map((w) => w.kind)).toEqual([
        "unknown-surface",
        "unsuitable-surface",
      ]);
    });

    it("keeps buckets summing to the total distance for out-of-order triples", () => {
      const response = buildResponse({
        extras: {
          surface: {
            values: [
              [3, 5, 15],
              [0, 2, 1],
            ],
          },
        },
      });

      const route = normalizeOpenRouteServiceRoute(response, OPTIONS);
      const summary = route.surfaceSummary;
      expect(summary).toBeDefined();
      if (!summary) return;
      const sum =
        summary.pavedMetres +
        summary.questionableMetres +
        summary.unsuitableMetres +
        summary.unknownMetres;
      expect(sum).toBeCloseTo(route.distanceMetres, 6);
      expect(summary.pavedMetres).toBeGreaterThan(0);
      expect(summary.unsuitableMetres).toBeGreaterThan(0);
    });

    it("treats an unrecognised surface code as unknown, with an inspectable warning", () => {
      const response = buildResponse({
        extras: {
          surface: {
            values: [[0, 5, 9999]], // unrecognised ORS surface code
          },
        },
      });

      const route = normalizeOpenRouteServiceRoute(response, OPTIONS);

      expect(route.surfaceSummary).toEqual({
        pavedMetres: 0,
        questionableMetres: 0,
        unsuitableMetres: 0,
        unknownMetres: route.distanceMetres,
      });
      expect(route.warnings).toEqual([
        {
          kind: "unknown-surface",
          startDistanceMetres: 0,
          endDistanceMetres: route.distanceMetres,
          message: "Surface data is unavailable for this segment.",
        },
      ]);
    });

    it("produces two distinct, correctly ordered unknown-surface warnings for two separate gaps", () => {
      const response: OrsFeatureCollectionResponse = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              summary: { distance: 0, duration: 0 },
              // Only points 2-4 are classified (paved); points 0-2 and
              // 4-6 are each a separate, non-adjacent unknown gap either
              // side of it.
              extras: { surface: { values: [[2, 4, 1]] } },
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 51],
                [0.001, 51],
                [0.002, 51],
                [0.003, 51],
                [0.004, 51],
                [0.005, 51],
                [0.006, 51],
              ],
            },
          },
        ],
      };
      const route = normalizeOpenRouteServiceRoute(response, OPTIONS);

      expect(route.warnings).toHaveLength(2);
      expect(route.warnings[0]?.kind).toBe("unknown-surface");
      expect(route.warnings[0]?.startDistanceMetres).toBeCloseTo(0, 6);
      expect(route.warnings[0]?.endDistanceMetres).toBeCloseTo(
        route.points[2]?.distanceFromStartMetres ?? -1,
        6,
      );
      expect(route.warnings[1]?.kind).toBe("unknown-surface");
      expect(route.warnings[1]?.startDistanceMetres).toBeCloseTo(
        route.points[4]?.distanceFromStartMetres ?? -1,
        6,
      );
      expect(route.warnings[1]?.endDistanceMetres).toBeCloseTo(route.distanceMetres, 6);
      expect(route.warnings[0]?.endDistanceMetres).toBeLessThanOrEqual(
        route.warnings[1]?.startDistanceMetres ?? -1,
      );
    });
  });
});
