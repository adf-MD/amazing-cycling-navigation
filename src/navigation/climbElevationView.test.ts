import { describe, expect, it } from "vitest";
import {
  buildClimbChartViewModel,
  computeClimbProgressMetrics,
  selectClimbElevationWindow,
  selectEffectiveElevationView,
} from "./climbElevationView.ts";
import type { ClassifiedSegment } from "./gradient.ts";
import type { ClimbFeature } from "./routeFeatures.ts";
import type { MicroDetailVisualKey } from "./routeFeaturePalette.ts";
import type { RoutePoint } from "../domain/types.ts";

const FULL_MODE = { kind: "full" } as const;
const UPCOMING_5KM = { kind: "upcoming", windowMetres: 5000 } as const;

function buildClimb(overrides: Partial<ClimbFeature> = {}): ClimbFeature {
  return {
    id: "climb-1000",
    kind: "climb",
    startDistanceMetres: 1000,
    endDistanceMetres: 2000,
    lengthMetres: 1000,
    averageGradientPercent: 6,
    elevationGainMetres: 60,
    maxGradientPercent: 8,
    climbScore: 6000,
    category: "uncategorised",
    ...overrides,
  };
}

describe("selectEffectiveElevationView", () => {
  it("returns the standard mode when no climb is active", () => {
    expect(selectEffectiveElevationView(FULL_MODE, null, null)).toEqual(FULL_MODE);
    expect(selectEffectiveElevationView(UPCOMING_5KM, null, "climb-1000")).toEqual(
      UPCOMING_5KM,
    );
  });

  it("auto-selects Climb view on first entry to a recognised climb", () => {
    const climb = buildClimb();
    expect(selectEffectiveElevationView(UPCOMING_5KM, climb, null)).toEqual({
      kind: "climb",
      featureId: "climb-1000",
    });
  });

  it("keeps showing Climb view across repeated calls for the same active climb (no reset)", () => {
    const climb = buildClimb();
    const first = selectEffectiveElevationView(UPCOMING_5KM, climb, null);
    const second = selectEffectiveElevationView(UPCOMING_5KM, climb, null);
    expect(first).toEqual(second);
    expect(second).toEqual({ kind: "climb", featureId: "climb-1000" });
  });

  it("returns the standard mode once the active climb has been dismissed", () => {
    const climb = buildClimb();
    expect(selectEffectiveElevationView(UPCOMING_5KM, climb, "climb-1000")).toEqual(
      UPCOMING_5KM,
    );
  });

  it("stays on the standard mode for further calls while the same climb remains dismissed", () => {
    const climb = buildClimb();
    expect(selectEffectiveElevationView(UPCOMING_5KM, climb, "climb-1000")).toEqual(
      UPCOMING_5KM,
    );
    expect(selectEffectiveElevationView(UPCOMING_5KM, climb, "climb-1000")).toEqual(
      UPCOMING_5KM,
    );
  });

  it("returns Climb view again once the dismissal is cleared (manual reselection)", () => {
    const climb = buildClimb();
    expect(selectEffectiveElevationView(UPCOMING_5KM, climb, null)).toEqual({
      kind: "climb",
      featureId: "climb-1000",
    });
  });

  it("auto-selects Climb view for a different climb even though the previous one is still recorded as dismissed", () => {
    const secondClimb = buildClimb({ id: "climb-3000", startDistanceMetres: 3000 });
    expect(selectEffectiveElevationView(UPCOMING_5KM, secondClimb, "climb-1000")).toEqual(
      {
        kind: "climb",
        featureId: "climb-3000",
      },
    );
  });

  it("returns the standard mode once the rider leaves the climb, regardless of dismissal state", () => {
    expect(selectEffectiveElevationView(UPCOMING_5KM, null, null)).toEqual(UPCOMING_5KM);
    expect(selectEffectiveElevationView(UPCOMING_5KM, null, "climb-1000")).toEqual(
      UPCOMING_5KM,
    );
  });

  it("auto-reopens on re-entering the same climb after leaving it, when nothing dismissed it in between", () => {
    const climb = buildClimb();
    // Simulates leave (null) then re-entry with the dismissal state
    // untouched by the caller in between — a genuine "entry" event each
    // time, not a permanent per-id ban.
    expect(selectEffectiveElevationView(UPCOMING_5KM, null, null)).toEqual(UPCOMING_5KM);
    expect(selectEffectiveElevationView(UPCOMING_5KM, climb, null)).toEqual({
      kind: "climb",
      featureId: "climb-1000",
    });
  });
});

describe("selectClimbElevationWindow", () => {
  const points: RoutePoint[] = [
    { coordinate: [0, 51], elevationMetres: 0, distanceFromStartMetres: 0 },
    { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 1000 },
    { coordinate: [0.02, 51], elevationMetres: 60, distanceFromStartMetres: 2000 },
    { coordinate: [0.03, 51], elevationMetres: 80, distanceFromStartMetres: 3000 },
  ];

  it("returns an empty window for an empty route", () => {
    const result = selectClimbElevationWindow([], 500, 1500);
    expect(result.points).toEqual([]);
  });

  it("selects exactly the interior points plus interpolated boundary seams", () => {
    const result = selectClimbElevationWindow(points, 500, 2500);
    expect(result.startDistanceMetres).toBe(500);
    expect(result.endDistanceMetres).toBe(2500);
    expect(result.points.map((p) => p.distanceFromStartMetres)).toEqual([
      500, 1000, 2000, 2500,
    ]);
    expect(result.points[0]?.elevationMetres).toBeCloseTo(10, 5);
    expect(result.points.at(-1)?.elevationMetres).toBeCloseTo(70, 5);
  });

  it("does not duplicate a point when a boundary lands exactly on an existing point", () => {
    const result = selectClimbElevationWindow(points, 1000, 2000);
    expect(result.points.map((p) => p.distanceFromStartMetres)).toEqual([1000, 2000]);
  });

  it("returns a single point for a zero-length window", () => {
    const result = selectClimbElevationWindow(points, 1500, 1500);
    expect(result.points).toHaveLength(1);
    expect(result.startDistanceMetres).toBe(1500);
    expect(result.endDistanceMetres).toBe(1500);
  });

  it("keeps elevation null when a boundary interpolates across a point with unknown elevation", () => {
    const pointsWithGap: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.01, 51], elevationMetres: null, distanceFromStartMetres: 1000 },
      { coordinate: [0.02, 51], elevationMetres: 30, distanceFromStartMetres: 2000 },
    ];
    const result = selectClimbElevationWindow(pointsWithGap, 500, 1500);
    expect(result.points[0]?.elevationMetres).toBeNull();
    expect(result.points.at(-1)?.elevationMetres).toBeNull();
  });
});

describe("computeClimbProgressMetrics", () => {
  const displayPoints: RoutePoint[] = [
    { coordinate: [0, 51], elevationMetres: 100, distanceFromStartMetres: 1000 },
    { coordinate: [0.01, 51], elevationMetres: 130, distanceFromStartMetres: 1500 },
    { coordinate: [0.02, 51], elevationMetres: 160, distanceFromStartMetres: 2000 },
  ];
  const segments: ClassifiedSegment<MicroDetailVisualKey>[] = [
    {
      startDistanceMetres: 1000,
      endDistanceMetres: 1500,
      averageGradientPercent: 6,
      visualKey: "moderate-climb",
    },
    {
      startDistanceMetres: 1500,
      endDistanceMetres: 2000,
      averageGradientPercent: 6,
      visualKey: "moderate-climb",
    },
  ];
  const climb = buildClimb({ startDistanceMetres: 1000, endDistanceMetres: 2000 });

  it("returns null when there is no presentation distance yet", () => {
    expect(computeClimbProgressMetrics(climb, displayPoints, segments, null)).toBeNull();
  });

  it("computes distance completed/remaining and elevation at the start of the climb", () => {
    const metrics = computeClimbProgressMetrics(climb, displayPoints, segments, 1000);
    expect(metrics?.clampedPresentationDistanceMetres).toBe(1000);
    expect(metrics?.distanceCompletedMetres).toBe(0);
    expect(metrics?.distanceRemainingMetres).toBe(1000);
    expect(metrics?.currentElevationMetres).toBeCloseTo(100, 5);
    expect(metrics?.finishElevationMetres).toBeCloseTo(160, 5);
    expect(metrics?.elevationRemainingMetres).toBeCloseTo(60, 5);
  });

  it("computes mid-climb distance and elevation values", () => {
    const metrics = computeClimbProgressMetrics(climb, displayPoints, segments, 1500);
    expect(metrics?.distanceCompletedMetres).toBe(500);
    expect(metrics?.distanceRemainingMetres).toBe(500);
    expect(metrics?.currentElevationMetres).toBeCloseTo(130, 5);
    expect(metrics?.elevationRemainingMetres).toBeCloseTo(30, 5);
  });

  it("floors distance remaining and elevation remaining at 0 at the climb finish", () => {
    const metrics = computeClimbProgressMetrics(climb, displayPoints, segments, 2000);
    expect(metrics?.distanceCompletedMetres).toBe(1000);
    expect(metrics?.distanceRemainingMetres).toBe(0);
    expect(metrics?.elevationRemainingMetres).toBe(0);
  });

  it("clamps a presentation distance before the climb start to the climb's own start", () => {
    const metrics = computeClimbProgressMetrics(climb, displayPoints, segments, 400);
    expect(metrics?.clampedPresentationDistanceMetres).toBe(1000);
    expect(metrics?.distanceCompletedMetres).toBe(0);
  });

  it("clamps a presentation distance past the climb finish to the climb's own finish", () => {
    const metrics = computeClimbProgressMetrics(climb, displayPoints, segments, 5000);
    expect(metrics?.clampedPresentationDistanceMetres).toBe(2000);
    expect(metrics?.distanceRemainingMetres).toBe(0);
  });

  it("resolves current gradient from the already-classified segment, not a new two-point calculation", () => {
    const steepSegments: ClassifiedSegment<MicroDetailVisualKey>[] = [
      {
        startDistanceMetres: 1000,
        endDistanceMetres: 1500,
        averageGradientPercent: 4,
        visualKey: "moderate-climb",
      },
      {
        startDistanceMetres: 1500,
        endDistanceMetres: 2000,
        averageGradientPercent: 11,
        visualKey: "very-hard-climb",
      },
    ];
    const metrics = computeClimbProgressMetrics(
      climb,
      displayPoints,
      steepSegments,
      1600,
    );
    expect(metrics?.currentGradientPercent).toBe(11);
  });

  it("propagates a null current gradient when no classified segment covers the distance", () => {
    const metrics = computeClimbProgressMetrics(climb, displayPoints, [], 1500);
    expect(metrics?.currentGradientPercent).toBeNull();
  });

  it("propagates a null elevation-remaining when the current elevation is unavailable, without affecting other metrics", () => {
    const pointsWithGap: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 1000 },
      { coordinate: [0.01, 51], elevationMetres: null, distanceFromStartMetres: 1500 },
      { coordinate: [0.02, 51], elevationMetres: 160, distanceFromStartMetres: 2000 },
    ];
    const metrics = computeClimbProgressMetrics(climb, pointsWithGap, segments, 1000);
    expect(metrics?.currentElevationMetres).toBeNull();
    expect(metrics?.finishElevationMetres).toBeCloseTo(160, 5);
    expect(metrics?.elevationRemainingMetres).toBeNull();
    expect(metrics?.distanceCompletedMetres).toBe(0);
    expect(metrics?.distanceRemainingMetres).toBe(1000);
  });

  it("propagates a null elevation-remaining when the finish elevation is unavailable", () => {
    const pointsWithGap: RoutePoint[] = [
      { coordinate: [0, 51], elevationMetres: 100, distanceFromStartMetres: 1000 },
      { coordinate: [0.01, 51], elevationMetres: null, distanceFromStartMetres: 1500 },
      { coordinate: [0.02, 51], elevationMetres: null, distanceFromStartMetres: 2000 },
    ];
    const metrics = computeClimbProgressMetrics(climb, pointsWithGap, segments, 1000);
    expect(metrics?.currentElevationMetres).toBeCloseTo(100, 5);
    expect(metrics?.finishElevationMetres).toBeNull();
    expect(metrics?.elevationRemainingMetres).toBeNull();
  });
});

describe("buildClimbChartViewModel", () => {
  const points: RoutePoint[] = [
    { coordinate: [0, 51], elevationMetres: 0, distanceFromStartMetres: 0 },
    { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 1000 },
    { coordinate: [0.02, 51], elevationMetres: 60, distanceFromStartMetres: 2000 },
    { coordinate: [0.03, 51], elevationMetres: 80, distanceFromStartMetres: 3000 },
  ];
  const climb = buildClimb({ startDistanceMetres: 1000, endDistanceMetres: 2000 });
  const segments: ClassifiedSegment<MicroDetailVisualKey>[] = [
    {
      startDistanceMetres: 1000,
      endDistanceMetres: 1500,
      averageGradientPercent: 4,
      visualKey: "moderate-climb",
    },
    {
      startDistanceMetres: 1500,
      endDistanceMetres: 2000,
      averageGradientPercent: 8,
      visualKey: "hard-climb",
    },
  ];

  describe("pre-ride-selected-climb", () => {
    it("rebases points so the climb's own start is distance 0", () => {
      const model = buildClimbChartViewModel(
        { kind: "pre-ride-selected-climb" },
        climb,
        points,
        segments,
      );
      expect(model.points.map((p) => p.distanceFromStartMetres)).toEqual([0, 1000]);
      expect(model.domain).toEqual({ startDistanceMetres: 0, endDistanceMetres: 1000 });
    });

    it("rebases gradient segment boundaries by the same offset", () => {
      const model = buildClimbChartViewModel(
        { kind: "pre-ride-selected-climb" },
        climb,
        points,
        segments,
      );
      expect(model.gradientSegments).toEqual([
        {
          startDistanceMetres: 0,
          endDistanceMetres: 500,
          averageGradientPercent: 4,
          visualKey: "moderate-climb",
        },
        {
          startDistanceMetres: 500,
          endDistanceMetres: 1000,
          averageGradientPercent: 8,
          visualKey: "hard-climb",
        },
      ]);
    });

    it("has no marker and enables area fill", () => {
      const model = buildClimbChartViewModel(
        { kind: "pre-ride-selected-climb" },
        climb,
        points,
        segments,
      );
      expect(model.marker).toBeNull();
      expect(model.areaFill).toBe(true);
    });

    it("does not throw for a climb whose bounds fall outside the given points, returning empty output", () => {
      const model = buildClimbChartViewModel(
        { kind: "pre-ride-selected-climb" },
        climb,
        [],
        [],
      );
      expect(model.points).toEqual([]);
      expect(model.gradientSegments).toEqual([]);
    });
  });

  describe("active-current-climb", () => {
    const marker = { distanceFromStartMetres: 1500, elevationMetres: 40, stale: false };

    it("keeps points and domain in route-global metres, unchanged from the climb window", () => {
      const model = buildClimbChartViewModel(
        { kind: "active-current-climb", marker },
        climb,
        points,
        segments,
      );
      expect(model.points.map((p) => p.distanceFromStartMetres)).toEqual([1000, 2000]);
      expect(model.domain).toEqual({
        startDistanceMetres: 1000,
        endDistanceMetres: 2000,
      });
      expect(model.gradientSegments).toEqual(segments);
    });

    it("passes the mode's own marker through unchanged and enables area fill", () => {
      const model = buildClimbChartViewModel(
        { kind: "active-current-climb", marker },
        climb,
        points,
        segments,
      );
      expect(model.marker).toEqual(marker);
      expect(model.areaFill).toBe(true);
    });
  });
});
