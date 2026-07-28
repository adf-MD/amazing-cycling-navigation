import { describe, expect, it } from "vitest";
import {
  fromStoredPlanningDraft,
  fromStoredRideState,
  toStoredPlanningDraft,
  toStoredRideState,
  type StoredCameraState,
} from "./mapping.ts";
import type { RideNavigationCoreState } from "../navigation/rideNavigationCore.ts";
import type { GeolocationFix } from "../platform/geolocation.ts";
import type { ElevationViewMode } from "../navigation/types.ts";
import type { Waypoint } from "../domain/types.ts";
import type { StoredPlanningDraft, StoredRideState } from "./db.ts";

const coreState: RideNavigationCoreState = {
  lastMatch: { pointIndex: 4, distanceFromStartMetres: 321.5 },
  offRouteMachineState: {
    level: "possibly-off-route",
    candidateLevel: "off-route",
    streak: 1,
  },
  lastReliableMatch: { pointIndex: 4, distanceFromStartMetres: 321.5 },
};

const fix: GeolocationFix = {
  coordinate: [-1.5, 53.8],
  accuracyMetres: 8,
  timestampMs: 1_700_000,
  speedMetresPerSecond: 4.2,
  headingDegrees: 87,
};

const overviewCamera: StoredCameraState = {
  mode: "overview",
  coordinate: null,
  zoom: null,
  bearingDegrees: 0,
  pitchDegrees: 0,
};

const upcoming5km: ElevationViewMode = { kind: "upcoming", windowMetres: 5000 };

describe("toStoredRideState / fromStoredRideState", () => {
  it("round-trips matched distance, off-route state and elevation view mode", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      upcoming5km,
      overviewCamera,
    );
    const restored = fromStoredRideState(stored);

    expect(restored.core).toEqual(coreState);
    expect(restored.elevationViewMode).toEqual(upcoming5km);
    expect(restored.lastFix?.coordinate).toEqual(fix.coordinate);
    expect(restored.lastFix?.accuracyMetres).toBe(fix.accuracyMetres);
    expect(restored.lastFix?.timestampMs).toBe(fix.timestampMs);
  });

  it("never persists speed or heading, since neither must become ride history", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      upcoming5km,
      overviewCamera,
    );
    expect(stored.lastFix).not.toHaveProperty("speedMetresPerSecond");
    expect(stored.lastFix).not.toHaveProperty("headingDegrees");
  });

  it("restores a null speed and heading for a fix read back from storage", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      upcoming5km,
      overviewCamera,
    );
    const restored = fromStoredRideState(stored);
    expect(restored.lastFix?.speedMetresPerSecond).toBeNull();
    expect(restored.lastFix?.headingDegrees).toBeNull();
  });

  it("stores a null lastFix and null lastMatch when there is no fix yet", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      null,
      {
        lastMatch: null,
        offRouteMachineState: coreState.offRouteMachineState,
        lastReliableMatch: null,
      },
      { kind: "upcoming", windowMetres: 2000 },
      overviewCamera,
    );

    expect(stored.lastFix).toBeNull();
    expect(stored.lastMatchedPointIndex).toBe(0);
    expect(stored.matchedDistanceFromStartMetres).toBe(0);

    const restored = fromStoredRideState(stored);
    expect(restored.lastFix).toBeNull();
    expect(restored.core.lastMatch).toBeNull();
  });

  it("round-trips a following camera state (no position — that's fix-driven, not persisted)", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      upcoming5km,
      {
        mode: "following",
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
      },
    );
    const restored = fromStoredRideState(stored);

    expect(restored.cameraState).toEqual({
      mode: "following",
      coordinate: null,
      zoom: null,
      bearingDegrees: 0,
      pitchDegrees: 0,
    });
  });

  it("round-trips a free camera state's saved position, zoom, bearing and pitch", () => {
    const freeCamera: StoredCameraState = {
      mode: "free",
      coordinate: [-1.2, 53.4],
      zoom: 13.5,
      bearingDegrees: 128,
      pitchDegrees: 22,
    };
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      upcoming5km,
      freeCamera,
    );
    const restored = fromStoredRideState(stored);

    expect(restored.cameraState).toEqual(freeCamera);
  });

  it("defaults to overview for a row written before camera fields existed", () => {
    // Simulates a real pre-existing row from before this feature shipped —
    // built by hand, not via toStoredRideState, so it genuinely lacks the
    // camera fields (rather than having them set to undefined explicitly).
    const legacyRow: StoredRideState = {
      id: "active",
      routeId: "route-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastFix: null,
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: coreState.offRouteMachineState,
      elevationWindowMetres: 5000,
    };

    const restored = fromStoredRideState(legacyRow);

    expect(restored.cameraState).toEqual(overviewCamera);
  });

  it("defaults bearing and pitch to north-up/top-down for a free-camera row written before those fields existed", () => {
    // A row from between the free-camera-position feature and the
    // bearing/pitch feature: has a saved position but genuinely lacks
    // cameraBearingDegrees/cameraPitchDegrees.
    const legacyFreeRow: StoredRideState = {
      id: "active",
      routeId: "route-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastFix: null,
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: coreState.offRouteMachineState,
      elevationWindowMetres: 5000,
      cameraMode: "free",
      cameraCoordinate: [-1.2, 53.4],
      cameraZoom: 13.5,
    };

    const restored = fromStoredRideState(legacyFreeRow);

    expect(restored.cameraState).toEqual({
      mode: "free",
      coordinate: [-1.2, 53.4],
      zoom: 13.5,
      bearingDegrees: 0,
      pitchDegrees: 0,
    });
  });

  describe("elevation view mode", () => {
    it("round-trips Full mode", () => {
      const stored = toStoredRideState(
        "route-1",
        "2026-01-01T00:00:00.000Z",
        fix,
        coreState,
        { kind: "full" },
        overviewCamera,
      );
      expect(fromStoredRideState(stored).elevationViewMode).toEqual({ kind: "full" });
    });

    it.each([2000, 5000, 10000] as const)(
      "round-trips a %d m upcoming window",
      (windowMetres) => {
        const stored = toStoredRideState(
          "route-1",
          "2026-01-01T00:00:00.000Z",
          fix,
          coreState,
          { kind: "upcoming", windowMetres },
          overviewCamera,
        );
        expect(fromStoredRideState(stored).elevationViewMode).toEqual({
          kind: "upcoming",
          windowMetres,
        });
      },
    );

    it("restores a legacy row with only the old numeric elevationWindowMetres field to the matching upcoming mode", () => {
      const legacyRow: StoredRideState = {
        id: "active",
        routeId: "route-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFix: null,
        lastMatchedPointIndex: 0,
        matchedDistanceFromStartMetres: 0,
        offRouteMachineState: coreState.offRouteMachineState,
        elevationWindowMetres: 2000,
      };

      expect(fromStoredRideState(legacyRow).elevationViewMode).toEqual({
        kind: "upcoming",
        windowMetres: 2000,
      });
    });

    it("defaults to the 5 km upcoming view when neither elevation field is present", () => {
      const rowWithNeitherField: StoredRideState = {
        id: "active",
        routeId: "route-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFix: null,
        lastMatchedPointIndex: 0,
        matchedDistanceFromStartMetres: 0,
        offRouteMachineState: coreState.offRouteMachineState,
      };

      expect(fromStoredRideState(rowWithNeitherField).elevationViewMode).toEqual({
        kind: "upcoming",
        windowMetres: 5000,
      });
    });

    it("falls back to the 5 km upcoming view for a malformed windowMetres value", () => {
      const malformedRow: StoredRideState = {
        id: "active",
        routeId: "route-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFix: null,
        lastMatchedPointIndex: 0,
        matchedDistanceFromStartMetres: 0,
        offRouteMachineState: coreState.offRouteMachineState,
        // Cast bypasses the compile-time union to simulate a genuinely
        // malformed/stale on-disk value, e.g. from a since-removed option.
        elevationViewMode: { kind: "upcoming", windowMetres: 7500 as 5000 },
      };

      expect(fromStoredRideState(malformedRow).elevationViewMode).toEqual({
        kind: "upcoming",
        windowMetres: 5000,
      });
    });
  });

  describe("lastReliableMatch", () => {
    it("round-trips a lastReliableMatch distinct from lastMatch (frozen while off-route)", () => {
      const coreWithFrozenProgress: RideNavigationCoreState = {
        lastMatch: { pointIndex: 10, distanceFromStartMetres: 900 },
        offRouteMachineState: { level: "off-route", candidateLevel: null, streak: 0 },
        lastReliableMatch: { pointIndex: 5, distanceFromStartMetres: 400 },
      };

      const stored = toStoredRideState(
        "route-1",
        "2026-01-01T00:00:00.000Z",
        fix,
        coreWithFrozenProgress,
        upcoming5km,
        overviewCamera,
      );
      const restored = fromStoredRideState(stored);

      expect(restored.core.lastMatch).toEqual({
        pointIndex: 10,
        distanceFromStartMetres: 900,
      });
      expect(restored.core.lastReliableMatch).toEqual({
        pointIndex: 5,
        distanceFromStartMetres: 400,
      });
    });

    it("defaults lastReliableMatch to lastMatch for a legacy row with no freeze history", () => {
      const legacyRow: StoredRideState = {
        id: "active",
        routeId: "route-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFix: {
          coordinate: [-1.5, 53.8],
          accuracyMetres: 8,
          timestampMs: 1_700_000,
        },
        lastMatchedPointIndex: 7,
        matchedDistanceFromStartMetres: 650,
        offRouteMachineState: coreState.offRouteMachineState,
        elevationWindowMetres: 5000,
      };

      const restored = fromStoredRideState(legacyRow);

      expect(restored.core.lastReliableMatch).toEqual(restored.core.lastMatch);
      expect(restored.core.lastReliableMatch).toEqual({
        pointIndex: 7,
        distanceFromStartMetres: 650,
      });
    });
  });
});

describe("toStoredPlanningDraft / fromStoredPlanningDraft", () => {
  const waypoints: Waypoint[] = [
    { id: "a", coordinate: [-1.5, 53.8] },
    { id: "b", coordinate: [-1.4, 53.8] },
  ];

  it("round-trips waypoints, route name and avoid-ferries preference", () => {
    const stored = toStoredPlanningDraft({
      waypoints,
      routeName: "Coastal loop",
      avoidFerries: false,
    });
    const restored = fromStoredPlanningDraft({
      id: "draft",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...stored,
    });

    expect(restored).toEqual({
      waypoints,
      routeName: "Coastal loop",
      avoidFerries: false,
    });
  });

  it("defaults route name and avoid-ferries for a row written before those fields existed", () => {
    // Simulates a real pre-existing row from before this feature shipped —
    // built by hand, not via toStoredPlanningDraft, so it genuinely lacks
    // routeName/avoidFerries (rather than having them set to undefined
    // explicitly).
    const legacyRow: StoredPlanningDraft = {
      id: "draft",
      waypoints,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const restored = fromStoredPlanningDraft(legacyRow);

    expect(restored).toEqual({
      waypoints,
      routeName: "Planned route",
      avoidFerries: true,
    });
  });
});
