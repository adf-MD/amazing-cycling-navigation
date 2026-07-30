import { describe, expect, it } from "vitest";
import {
  MANOEUVRE_SEAM_DEDUP_TOLERANCE_METRES,
  SEAM_TOLERANCE_METRES,
  stitchPlannedRouteLegs,
  type StitchRouteMetadata,
} from "./stitchPlannedRouteLegs.ts";
import { RoutingError } from "./openRouteServiceErrors.ts";
import { cumulativeDistancesMetres } from "../navigation/distance.ts";
import { analyzeElevation } from "../navigation/elevation.ts";
import type {
  Coordinate,
  Manoeuvre,
  ManoeuvreProvenance,
  PlannedRoute,
  RoutePoint,
  RouteWarning,
  SurfaceSummary,
} from "../domain/types.ts";

const METADATA: StitchRouteMetadata = {
  id: "stitched-route-1",
  name: "Combined route",
  createdAt: "2026-02-01T00:00:00.000Z",
};

function coord(lon: number, lat = 51): Coordinate {
  return [lon, lat];
}

function buildPoints(
  coordinates: readonly Coordinate[],
  elevations: readonly (number | null)[] = [],
): RoutePoint[] {
  const distances = cumulativeDistancesMetres(coordinates);
  return coordinates.map((coordinate, i) => ({
    coordinate,
    elevationMetres: elevations[i] ?? null,
    distanceFromStartMetres: distances[i] ?? 0,
  }));
}

function buildLeg(overrides: {
  points: RoutePoint[];
  id?: string;
  name?: string;
  createdAt?: string;
  manoeuvres?: Manoeuvre[];
  manoeuvreProvenance?: ManoeuvreProvenance;
  ascentMetres?: number | null;
  descentMetres?: number | null;
  surfaceSummary?: SurfaceSummary;
  warnings?: RouteWarning[];
  source?: PlannedRoute["source"];
}): PlannedRoute {
  return {
    id: overrides.id ?? "leg",
    name: overrides.name ?? "Leg",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    points: overrides.points,
    manoeuvres: overrides.manoeuvres ?? [],
    ...(overrides.manoeuvreProvenance
      ? { manoeuvreProvenance: overrides.manoeuvreProvenance }
      : {}),
    distanceMetres: overrides.points.at(-1)?.distanceFromStartMetres ?? 0,
    ascentMetres: overrides.ascentMetres ?? null,
    descentMetres: overrides.descentMetres ?? null,
    ...(overrides.surfaceSummary ? { surfaceSummary: overrides.surfaceSummary } : {}),
    warnings: overrides.warnings ?? [],
    source: overrides.source ?? {
      kind: "planner",
      provider: "openrouteservice",
      profile: "cycling-road",
    },
  };
}

describe("stitchPlannedRouteLegs", () => {
  it("throws leg-stitching-failed for an empty leg list", () => {
    expect(() => stitchPlannedRouteLegs([], METADATA)).toThrow(RoutingError);
    try {
      stitchPlannedRouteLegs([], METADATA);
    } catch (error) {
      expect(error).toBeInstanceOf(RoutingError);
      expect((error as RoutingError).reason).toBe("leg-stitching-failed");
    }
  });

  it("removes an exact-duplicate seam point", () => {
    const legA = buildLeg({
      points: buildPoints([coord(0), coord(0.001), coord(0.002)]),
    });
    const legB = buildLeg({
      points: buildPoints([coord(0.002), coord(0.003), coord(0.004)]),
    });

    const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

    expect(stitched.points).toHaveLength(5);
    const expectedDistances = cumulativeDistancesMetres([
      coord(0),
      coord(0.001),
      coord(0.002),
      coord(0.003),
      coord(0.004),
    ]);
    stitched.points.forEach((point, i) => {
      expect(point.distanceFromStartMetres).toBeCloseTo(expectedDistances[i] ?? -1, 6);
    });
  });

  it("collapses a within-tolerance snapped seam onto the first leg's own retained point", () => {
    const seamOffsetDegrees = 0.00005; // ≈3.5 m at latitude 51 — comfortably under SEAM_TOLERANCE_METRES
    const legA = buildLeg({
      points: buildPoints([coord(0), coord(0.001), coord(0.002)]),
    });
    const legB = buildLeg({
      points: buildPoints([coord(0.002 + seamOffsetDegrees), coord(0.003), coord(0.004)]),
    });

    const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

    expect(stitched.points).toHaveLength(5);
    // The retained seam point is leg A's own coordinate, not leg B's.
    expect(stitched.points[2]?.coordinate).toEqual(coord(0.002));
  });

  it("rejects a seam gap larger than SEAM_TOLERANCE_METRES", () => {
    const legA = buildLeg({
      points: buildPoints([coord(0), coord(0.001), coord(0.002)]),
    });
    const legB = buildLeg({
      points: buildPoints([coord(1), coord(1.001), coord(1.002)]),
    });

    expect(() => stitchPlannedRouteLegs([legA, legB], METADATA)).toThrow(RoutingError);
    try {
      stitchPlannedRouteLegs([legA, legB], METADATA);
    } catch (error) {
      expect((error as RoutingError).reason).toBe("leg-stitching-failed");
    }
  });

  it("is a lossless passthrough for a single leg, except for fresh metadata", () => {
    const points = buildPoints(
      [coord(0), coord(0.001), coord(0.002), coord(0.003)],
      [10, 12, 11, 13],
    );
    const leg = buildLeg({
      points,
      id: "leg-own-id",
      name: "Leg's own name",
      createdAt: "2020-01-01T00:00:00.000Z",
      ascentMetres: 999, // deliberately implausible — see next test for why this must be ignored anyway
      descentMetres: 999,
      surfaceSummary: {
        pavedMetres: points.at(-1)?.distanceFromStartMetres ?? 0,
        questionableMetres: 0,
        unsuitableMetres: 0,
        unknownMetres: 0,
      },
    });

    const stitched = stitchPlannedRouteLegs([leg], METADATA);

    expect(stitched.id).toBe(METADATA.id);
    expect(stitched.name).toBe(METADATA.name);
    expect(stitched.createdAt).toBe(METADATA.createdAt);
    expect(stitched.points).toEqual(points);
    expect(stitched.distanceMetres).toBeCloseTo(leg.distanceMetres, 6);
    const expectedElevation = analyzeElevation(points);
    expect(stitched.ascentMetres).toBeCloseTo(expectedElevation.ascentMetres ?? -1, 6);
    expect(stitched.descentMetres).toBeCloseTo(expectedElevation.descentMetres ?? -1, 6);
    expect(stitched.source).toEqual(leg.source);
  });

  it("produces globally monotonic point distances from zero to the total", () => {
    const legA = buildLeg({
      points: buildPoints([coord(0), coord(0.001), coord(0.002)]),
    });
    const legB = buildLeg({
      points: buildPoints([coord(0.002), coord(0.003), coord(0.0035)]),
    });

    const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

    expect(stitched.points[0]?.distanceFromStartMetres).toBe(0);
    for (let i = 1; i < stitched.points.length; i += 1) {
      const previous = stitched.points[i - 1]?.distanceFromStartMetres ?? -1;
      const current = stitched.points[i]?.distanceFromStartMetres ?? -1;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
    expect(stitched.points.at(-1)?.distanceFromStartMetres).toBeCloseTo(
      stitched.distanceMetres,
      6,
    );
  });

  it("computes total distance from the recomputed stitched geometry, not by summing each leg's own reported distance", () => {
    const seamOffsetDegrees = 0.00005; // a real, non-zero snapping gap
    const legA = buildLeg({
      points: buildPoints([coord(0), coord(0.001), coord(0.002)]),
    });
    const legB = buildLeg({
      points: buildPoints([coord(0.002 + seamOffsetDegrees), coord(0.003), coord(0.004)]),
    });
    const naiveSummedDistance = legA.distanceMetres + legB.distanceMetres;

    const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

    const expectedTotal =
      cumulativeDistancesMetres([
        coord(0),
        coord(0.001),
        coord(0.002),
        coord(0.003),
        coord(0.004),
      ]).at(-1) ?? -1;
    expect(stitched.distanceMetres).toBeCloseTo(expectedTotal, 6);
    expect(stitched.distanceMetres).not.toBeCloseTo(naiveSummedDistance, 9);
  });

  it("recalculates ascent/descent once over the full stitched series, never by summing each leg's own reported values", () => {
    const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)], [10, 15, 20]);
    const pointsB = buildPoints([coord(0.002), coord(0.003), coord(0.004)], [20, 25, 30]);
    // Each leg's own ascentMetres is deliberately wrong/arbitrary — proving
    // the stitched result can only have come from a fresh recompute, not
    // from summing these.
    const legA = buildLeg({
      points: pointsA,
      ascentMetres: 12_345,
      descentMetres: 12_345,
    });
    const legB = buildLeg({
      points: pointsB,
      ascentMetres: 12_345,
      descentMetres: 12_345,
    });

    const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

    expect(stitched.ascentMetres).not.toBe(24_690);
    expect(stitched.descentMetres).not.toBe(24_690);
    const expected = analyzeElevation(stitched.points);
    expect(stitched.ascentMetres).toBeCloseTo(expected.ascentMetres ?? -1, 6);
    expect(stitched.descentMetres).toBeCloseTo(expected.descentMetres ?? -1, 6);
  });

  it("preserves an available elevation reading at a merged seam point rather than discarding it", () => {
    const legA = buildLeg({
      points: buildPoints([coord(0), coord(0.001), coord(0.002)], [10, 12, null]),
    });
    const legB = buildLeg({
      points: buildPoints([coord(0.002), coord(0.003)], [14, 16]),
    });

    const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

    expect(stitched.points).toHaveLength(4);
    // legA's own seam point had no elevation; legB's matching seam point
    // did — the merged point keeps the available reading.
    expect(stitched.points[2]?.elevationMetres).toBe(14);
  });

  describe("manoeuvres", () => {
    it("rebases manoeuvre distances into the stitched geometry", () => {
      const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const pointsB = buildPoints([coord(0.002), coord(0.003), coord(0.004)]);
      const legA = buildLeg({
        points: pointsA,
        manoeuvres: [
          {
            distanceFromStartMetres: pointsA[1]?.distanceFromStartMetres ?? 0,
            type: "left",
          },
        ],
      });
      const legB = buildLeg({
        points: pointsB,
        manoeuvres: [
          {
            distanceFromStartMetres: pointsB[2]?.distanceFromStartMetres ?? 0,
            type: "roundabout",
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.manoeuvres).toHaveLength(2);
      expect(stitched.manoeuvres[0]?.type).toBe("left");
      expect(stitched.manoeuvres[0]?.distanceFromStartMetres).toBeCloseTo(
        stitched.points[1]?.distanceFromStartMetres ?? -1,
        6,
      );
      expect(stitched.manoeuvres[1]?.type).toBe("roundabout");
      expect(stitched.manoeuvres[1]?.distanceFromStartMetres).toBeCloseTo(
        stitched.points[4]?.distanceFromStartMetres ?? -1,
        6,
      );
    });

    it("collapses a leg-boundary finish+start pair into a single waypoint manoeuvre", () => {
      const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const pointsB = buildPoints([coord(0.002), coord(0.003), coord(0.004)]);
      const legA = buildLeg({
        points: pointsA,
        manoeuvres: [
          {
            // legA's own arrival at its own local endpoint.
            distanceFromStartMetres: pointsA[2]?.distanceFromStartMetres ?? 0,
            type: "finish",
            instruction: "Arrive at your destination",
          },
        ],
      });
      const legB = buildLeg({
        points: pointsB,
        manoeuvres: [
          {
            // legB's own departure from its own local start (the same
            // point as legA's arrival, since they share a seam).
            distanceFromStartMetres: 0,
            type: "start",
            instruction: "Head north on Ridge Road",
          },
          {
            distanceFromStartMetres: pointsB[2]?.distanceFromStartMetres ?? 0,
            type: "finish",
            instruction: "Arrive at your destination",
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.manoeuvres).toHaveLength(2);
      expect(stitched.manoeuvres[0]?.type).toBe("waypoint");
      expect(stitched.manoeuvres[0]?.instruction).toBeUndefined();
      expect(stitched.manoeuvres[1]?.type).toBe("finish");
    });

    it("propagates the first leg's manoeuvreProvenance when the stitched route has manoeuvres", () => {
      const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const pointsB = buildPoints([coord(0.002), coord(0.003), coord(0.004)]);
      const legA = buildLeg({
        points: pointsA,
        manoeuvres: [
          {
            distanceFromStartMetres: pointsA[1]?.distanceFromStartMetres ?? 0,
            type: "left",
          },
        ],
        manoeuvreProvenance: { kind: "routing-provider", provider: "openrouteservice" },
      });
      const legB = buildLeg({ points: pointsB });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.manoeuvres.length).toBeGreaterThan(0);
      expect(stitched.manoeuvreProvenance).toEqual({
        kind: "routing-provider",
        provider: "openrouteservice",
      });
    });

    it("leaves manoeuvreProvenance unset when the stitched route has no manoeuvres", () => {
      const pointsA = buildPoints([coord(0), coord(0.001)]);
      const pointsB = buildPoints([coord(0.001), coord(0.002)]);
      const legA = buildLeg({ points: pointsA });
      const legB = buildLeg({ points: pointsB });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.manoeuvres).toEqual([]);
      expect(stitched.manoeuvreProvenance).toBeUndefined();
    });

    it("collapses both internal seams of a 3-leg route while the overall start/finish survive", () => {
      const pointsA = buildPoints([coord(0), coord(0.001)]);
      const pointsB = buildPoints([coord(0.001), coord(0.002)]);
      const pointsC = buildPoints([coord(0.002), coord(0.003)]);
      const legA = buildLeg({
        points: pointsA,
        manoeuvres: [
          { distanceFromStartMetres: 0, type: "start", instruction: "Depart" },
          {
            distanceFromStartMetres: pointsA[1]?.distanceFromStartMetres ?? 0,
            type: "finish",
            instruction: "Arrive",
          },
        ],
      });
      const legB = buildLeg({
        points: pointsB,
        manoeuvres: [
          { distanceFromStartMetres: 0, type: "start", instruction: "Depart" },
          {
            distanceFromStartMetres: pointsB[1]?.distanceFromStartMetres ?? 0,
            type: "finish",
            instruction: "Arrive",
          },
        ],
      });
      const legC = buildLeg({
        points: pointsC,
        manoeuvres: [
          { distanceFromStartMetres: 0, type: "start", instruction: "Depart" },
          {
            distanceFromStartMetres: pointsC[1]?.distanceFromStartMetres ?? 0,
            type: "finish",
            instruction: "Arrive",
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB, legC], METADATA);

      expect(stitched.manoeuvres.map((m) => m.type)).toEqual([
        "start",
        "waypoint",
        "waypoint",
        "finish",
      ]);
      expect(stitched.manoeuvres[0]?.instruction).toBe("Depart");
      expect(stitched.manoeuvres[3]?.instruction).toBe("Arrive");
    });

    it("keeps two seam-adjacent manoeuvres that are not a finish+start pair", () => {
      const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const pointsB = buildPoints([coord(0.002), coord(0.003)]);
      const legA = buildLeg({
        points: pointsA,
        manoeuvres: [
          {
            distanceFromStartMetres: pointsA[2]?.distanceFromStartMetres ?? 0,
            type: "left",
            instruction: "Turn left",
          },
        ],
      });
      const legB = buildLeg({
        points: pointsB,
        manoeuvres: [
          { distanceFromStartMetres: 0, type: "right", instruction: "Turn right" },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.manoeuvres).toHaveLength(2);
      expect(stitched.manoeuvres.map((m) => m.type)).toEqual(["left", "right"]);
    });

    it("only collapses at a leg boundary, never elsewhere in the same leg", () => {
      const points = buildPoints([coord(0), coord(0.001), coord(0.002), coord(0.003)]);
      const leg = buildLeg({
        points,
        manoeuvres: [
          {
            distanceFromStartMetres: points[1]?.distanceFromStartMetres ?? 0,
            type: "finish",
            instruction: "Arrive",
          },
          {
            distanceFromStartMetres: points[2]?.distanceFromStartMetres ?? 0,
            type: "start",
            instruction: "Depart",
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([leg], METADATA);

      // Both manoeuvres belong to the same (only) leg — manoeuvreIndex is 1
      // for the second, so the leg-boundary rule (manoeuvreIndex === 0)
      // never applies within a single leg, regardless of type.
      expect(stitched.manoeuvres).toHaveLength(2);
    });

    it("accepted limitation: a leg with no manoeuvres leaves the next leg's start uncollapsed", () => {
      const pointsA = buildPoints([coord(0), coord(0.001)]);
      const pointsB = buildPoints([coord(0.001), coord(0.002)]);
      const legA = buildLeg({ points: pointsA, manoeuvres: [] });
      const legB = buildLeg({
        points: pointsB,
        manoeuvres: [
          { distanceFromStartMetres: 0, type: "start", instruction: "Depart" },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      // legA contributed no "finish" to collapse against, so legB's own
      // "start" survives as-is — a known, accepted residual gap (ORS
      // always returns a genuine arrive/depart pair in practice; only a
      // malformed/empty leg response hits this).
      expect(stitched.manoeuvres).toHaveLength(1);
      expect(stitched.manoeuvres[0]?.type).toBe("start");
    });
  });

  describe("warnings", () => {
    it("rebases, clamps and orders warnings, merging a seam-adjacent duplicate hazard via the existing coalescing", () => {
      const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const pointsB = buildPoints([coord(0.002), coord(0.003), coord(0.004)]);
      const legA = buildLeg({
        points: pointsA,
        warnings: [
          {
            kind: "questionable-surface",
            startDistanceMetres: pointsA[1]?.distanceFromStartMetres ?? 0,
            endDistanceMetres: pointsA[2]?.distanceFromStartMetres ?? 0,
            message: "Questionable surface for a road bike.",
          },
        ],
      });
      const legB = buildLeg({
        points: pointsB,
        warnings: [
          {
            kind: "questionable-surface",
            startDistanceMetres: 0,
            endDistanceMetres: pointsB[1]?.distanceFromStartMetres ?? 0,
            message: "Questionable surface for a road bike.",
          },
          {
            kind: "ferry",
            startDistanceMetres: pointsB[1]?.distanceFromStartMetres ?? 0,
            endDistanceMetres: pointsB[2]?.distanceFromStartMetres ?? 0,
            message: "Route includes a ferry.",
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.warnings).toHaveLength(2);
      expect(stitched.warnings[0]?.kind).toBe("questionable-surface");
      expect(stitched.warnings[0]?.startDistanceMetres).toBeCloseTo(
        stitched.points[1]?.distanceFromStartMetres ?? -1,
        6,
      );
      // The merged range extends to legB's own warning end (its own point
      // 1, i.e. stitched.points[3] — legB's point 2 is stitched.points[4]).
      expect(stitched.warnings[0]?.endDistanceMetres).toBeCloseTo(
        stitched.points[3]?.distanceFromStartMetres ?? -1,
        6,
      );
      expect(stitched.warnings[1]?.kind).toBe("ferry");
    });

    it("keeps distances finite and clamped within [0, totalDistance] even for out-of-range warning inputs", () => {
      const points = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const leg = buildLeg({
        points,
        warnings: [
          {
            kind: "unknown-surface",
            startDistanceMetres: -500,
            endDistanceMetres: 999_999,
            message: "Surface data is unavailable for this segment.",
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([leg], METADATA);

      expect(stitched.warnings).toHaveLength(1);
      const warning = stitched.warnings[0];
      expect(warning).toBeDefined();
      expect(Number.isFinite(warning?.startDistanceMetres)).toBe(true);
      expect(Number.isFinite(warning?.endDistanceMetres)).toBe(true);
      expect(warning?.startDistanceMetres).toBeGreaterThanOrEqual(0);
      expect(warning?.endDistanceMetres).toBeLessThanOrEqual(stitched.distanceMetres);
    });

    it("keeps two different-surface-type warnings adjacent across a seam as two distinct warnings, each retaining its own surface detail", () => {
      const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const pointsB = buildPoints([coord(0.002), coord(0.003), coord(0.004)]);
      const legA = buildLeg({
        points: pointsA,
        warnings: [
          {
            kind: "questionable-surface",
            startDistanceMetres: pointsA[1]?.distanceFromStartMetres ?? 0,
            endDistanceMetres: pointsA[2]?.distanceFromStartMetres ?? 0,
            message: "Questionable surface for a road bike: compacted gravel.",
            surface: { type: "compacted-gravel", label: "Compacted gravel" },
          },
        ],
      });
      const legB = buildLeg({
        points: pointsB,
        warnings: [
          {
            kind: "questionable-surface",
            startDistanceMetres: 0,
            endDistanceMetres: pointsB[1]?.distanceFromStartMetres ?? 0,
            message: "Questionable surface for a road bike: gravel / fine gravel.",
            surface: { type: "gravel", label: "Gravel / fine gravel" },
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.warnings).toHaveLength(2);
      expect(stitched.warnings[0]?.surface).toEqual({
        type: "compacted-gravel",
        label: "Compacted gravel",
      });
      expect(stitched.warnings[1]?.surface).toEqual({
        type: "gravel",
        label: "Gravel / fine gravel",
      });
    });

    it("merges the same surface-type warning reported by both legs at a shared seam, preserving the surface detail", () => {
      const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const pointsB = buildPoints([coord(0.002), coord(0.003), coord(0.004)]);
      const surface = { type: "sand" as const, label: "Sand" };
      const legA = buildLeg({
        points: pointsA,
        warnings: [
          {
            kind: "unsuitable-surface",
            startDistanceMetres: pointsA[1]?.distanceFromStartMetres ?? 0,
            endDistanceMetres: pointsA[2]?.distanceFromStartMetres ?? 0,
            message: "Unsuitable surface for a road bike: sand.",
            surface,
          },
        ],
      });
      const legB = buildLeg({
        points: pointsB,
        warnings: [
          {
            kind: "unsuitable-surface",
            startDistanceMetres: 0,
            endDistanceMetres: pointsB[1]?.distanceFromStartMetres ?? 0,
            message: "Unsuitable surface for a road bike: sand.",
            surface,
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.warnings).toHaveLength(1);
      expect(stitched.warnings[0]?.surface).toEqual(surface);
      expect(stitched.warnings[0]?.startDistanceMetres).toBeCloseTo(
        stitched.points[1]?.distanceFromStartMetres ?? -1,
        6,
      );
      expect(stitched.warnings[0]?.endDistanceMetres).toBeCloseTo(
        stitched.points[3]?.distanceFromStartMetres ?? -1,
        6,
      );
    });
  });

  describe("degenerate inputs", () => {
    it("never produces NaN for a degenerate single-point trailing leg", () => {
      const legA = buildLeg({
        points: buildPoints([coord(0), coord(0.001), coord(0.002)]),
      });
      // A single-point leg whose only point coincides with legA's last point.
      const legB = buildLeg({
        points: buildPoints([coord(0.002)]),
        warnings: [
          {
            kind: "unknown-surface",
            startDistanceMetres: 0,
            endDistanceMetres: 0,
            message: "Surface data is unavailable for this segment.",
          },
        ],
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.points).toHaveLength(3);
      for (const point of stitched.points) {
        expect(Number.isFinite(point.distanceFromStartMetres)).toBe(true);
      }
      expect(Number.isFinite(stitched.distanceMetres)).toBe(true);
    });
  });

  describe("surface summary", () => {
    it("sums per-leg surface buckets and applies any residual to unknownMetres so the total matches the stitched distance", () => {
      const seamOffsetDegrees = 0.00005;
      const pointsA = buildPoints([coord(0), coord(0.001), coord(0.002)]);
      const pointsB = buildPoints([
        coord(0.002 + seamOffsetDegrees),
        coord(0.003),
        coord(0.004),
      ]);
      // Each leg's own pavedMetres matches its own real distance, so any
      // discrepancy against the stitched total is only the genuine,
      // tiny seam-snapping difference — not a large hand-typed mismatch.
      const legA = buildLeg({
        points: pointsA,
        surfaceSummary: {
          pavedMetres: pointsA.at(-1)?.distanceFromStartMetres ?? 0,
          questionableMetres: 0,
          unsuitableMetres: 0,
          unknownMetres: 0,
        },
      });
      const legB = buildLeg({
        points: pointsB,
        surfaceSummary: {
          pavedMetres: pointsB.at(-1)?.distanceFromStartMetres ?? 0,
          questionableMetres: 0,
          unsuitableMetres: 0,
          unknownMetres: 0,
        },
      });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.surfaceSummary).toBeDefined();
      const summary = stitched.surfaceSummary;
      if (!summary) return;
      const total =
        summary.pavedMetres +
        summary.questionableMetres +
        summary.unsuitableMetres +
        summary.unknownMetres;
      expect(total).toBeCloseTo(stitched.distanceMetres, 6);
    });

    it("clamps a large negative residual at zero rather than letting unknownMetres go negative", () => {
      // Bucket totals declared far larger than any plausible stitched
      // distance for this tiny fixture, forcing a large negative residual.
      const legA = buildLeg({
        points: buildPoints([coord(0), coord(0.001)]),
        surfaceSummary: {
          pavedMetres: 1_000_000,
          questionableMetres: 0,
          unsuitableMetres: 0,
          unknownMetres: 0,
        },
      });

      const stitched = stitchPlannedRouteLegs([legA], METADATA);

      expect(stitched.surfaceSummary?.unknownMetres).toBe(0);
    });

    it("omits surfaceSummary entirely when any leg lacks one", () => {
      const legA = buildLeg({
        points: buildPoints([coord(0), coord(0.001)]),
        surfaceSummary: {
          pavedMetres: 70,
          questionableMetres: 0,
          unsuitableMetres: 0,
          unknownMetres: 0,
        },
      });
      const legB = buildLeg({ points: buildPoints([coord(0.001), coord(0.002)]) });

      const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

      expect(stitched.surfaceSummary).toBeUndefined();
    });
  });

  it("uses one fresh, stable metadata set for the combined route rather than leaking a leg's own identity", () => {
    const legA = buildLeg({
      points: buildPoints([coord(0), coord(0.001)]),
      id: "leg-a-id",
      name: "Leg A's own name",
      createdAt: "2019-01-01T00:00:00.000Z",
      source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
    });
    const legB = buildLeg({
      points: buildPoints([coord(0.001), coord(0.002)]),
      id: "leg-b-id",
      name: "Leg B's own name",
      createdAt: "2021-01-01T00:00:00.000Z",
    });

    const stitched = stitchPlannedRouteLegs([legA, legB], METADATA);

    expect(stitched.id).toBe(METADATA.id);
    expect(stitched.name).toBe(METADATA.name);
    expect(stitched.createdAt).toBe(METADATA.createdAt);
    expect(stitched.id).not.toBe(legA.id);
    expect(stitched.id).not.toBe(legB.id);
    expect(stitched.source).toEqual(legA.source);
  });

  it("exposes documented, sensible tolerance constants", () => {
    expect(SEAM_TOLERANCE_METRES).toBeGreaterThan(0);
    expect(MANOEUVRE_SEAM_DEDUP_TOLERANCE_METRES).toBeGreaterThan(0);
  });
});
