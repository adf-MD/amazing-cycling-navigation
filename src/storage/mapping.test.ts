import { describe, expect, it } from "vitest";
import {
  fromStoredPlanningDraft,
  fromStoredPlanningPreferences,
  fromStoredRideState,
  fromStoredRouteLibraryPreferences,
  resolveStoredRideSessionKind,
  toStoredPlanningDraft,
  toStoredPlanningPreferences,
  toStoredRideState,
  toStoredRouteLibraryPreferences,
  type StoredCameraState,
} from "./mapping.ts";
import type { RideNavigationCoreState } from "../navigation/rideNavigationCore.ts";
import type { GeolocationFix } from "../platform/geolocation.ts";
import type { ElevationViewMode } from "../navigation/types.ts";
import type { Waypoint } from "../domain/types.ts";
import type {
  StoredPlanningDraft,
  StoredRideState,
  StoredRouteLibraryPreferences,
} from "./db.ts";

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
      false,
      null,
      false,
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
      false,
      null,
      false,
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
      false,
      null,
      false,
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
      false,
      null,
      false,
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
      false,
      null,
      false,
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
      false,
      null,
      false,
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
        false,
        null,
        false,
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
          false,
          null,
          false,
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
        false,
        null,
        false,
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

  describe("wakeLockDesired", () => {
    it("round-trips a true desired state", () => {
      const stored = toStoredRideState(
        "route-1",
        "2026-01-01T00:00:00.000Z",
        fix,
        coreState,
        upcoming5km,
        overviewCamera,
        true,
        null,
        false,
      );

      expect(stored.wakeLockDesired).toBe(true);
      expect(fromStoredRideState(stored).wakeLockDesired).toBe(true);
    });

    it("defaults to false for a row written before this field existed", () => {
      // Simulates a real pre-existing row from before this feature
      // shipped — built by hand, not via toStoredRideState, so it
      // genuinely lacks wakeLockDesired (rather than having it set to
      // undefined explicitly).
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

      expect(fromStoredRideState(legacyRow).wakeLockDesired).toBe(false);
    });
  });

  describe("dismissedClimbFeatureId", () => {
    it("round-trips a set climb id", () => {
      const stored = toStoredRideState(
        "route-1",
        "2026-01-01T00:00:00.000Z",
        fix,
        coreState,
        upcoming5km,
        overviewCamera,
        false,
        "climb-1200",
        false,
      );

      expect(stored.dismissedClimbFeatureId).toBe("climb-1200");
      expect(fromStoredRideState(stored).dismissedClimbFeatureId).toBe("climb-1200");
    });

    it("round-trips a null (not dismissed) state, never writing a literal null", () => {
      const stored = toStoredRideState(
        "route-1",
        "2026-01-01T00:00:00.000Z",
        fix,
        coreState,
        upcoming5km,
        overviewCamera,
        false,
        null,
        false,
      );

      expect(stored.dismissedClimbFeatureId).toBeUndefined();
      expect(fromStoredRideState(stored).dismissedClimbFeatureId).toBeNull();
    });

    it("defaults to null for a row written before this field existed", () => {
      // Simulates a real pre-existing row from before this feature
      // shipped — built by hand, not via toStoredRideState, so it
      // genuinely lacks dismissedClimbFeatureId (rather than having it
      // set to undefined explicitly).
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

      expect(fromStoredRideState(legacyRow).dismissedClimbFeatureId).toBeNull();
    });
  });

  describe("completionArmed", () => {
    it("round-trips a true armed state", () => {
      const stored = toStoredRideState(
        "route-1",
        "2026-01-01T00:00:00.000Z",
        fix,
        coreState,
        upcoming5km,
        overviewCamera,
        false,
        null,
        true,
      );

      expect(stored.completionArmed).toBe(true);
      expect(fromStoredRideState(stored).completionArmed).toBe(true);
    });

    it("defaults to false for a row written before this field existed", () => {
      // Simulates a real pre-existing row from before this feature
      // shipped — built by hand, not via toStoredRideState, so it
      // genuinely lacks completionArmed (rather than having it set to
      // undefined explicitly).
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

      expect(fromStoredRideState(legacyRow).completionArmed).toBe(false);
    });

    it("defaults to false even when the legacy row's own stored progress looks near-total", () => {
      // A legacy row must never be inferred as armed merely because it
      // happens to store near-total progress — completionArmed is only
      // ever set true by explicit evidence, never derived from other
      // fields on read.
      const legacyRowWithNearTotalProgress: StoredRideState = {
        id: "active",
        routeId: "route-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastFix: { coordinate: [-1.5, 53.8], accuracyMetres: 8, timestampMs: 1_700_000 },
        lastMatchedPointIndex: 20,
        matchedDistanceFromStartMetres: 995,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatchedPointIndex: 20,
        lastReliableMatchedDistanceFromStartMetres: 995,
      };

      expect(fromStoredRideState(legacyRowWithNearTotalProgress).completionArmed).toBe(
        false,
      );
    });
  });

  describe("session kind (kind)", () => {
    it("toStoredRideState always writes the route session kind", () => {
      const stored = toStoredRideState(
        "route-1",
        "2026-01-01T00:00:00.000Z",
        fix,
        coreState,
        upcoming5km,
        overviewCamera,
        false,
        null,
        false,
      );

      expect(stored.kind).toBe("route");
    });
  });
});

describe("resolveStoredRideSessionKind", () => {
  const baseRow: StoredRideState = {
    id: "active",
    routeId: "route-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastFix: null,
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: coreState.offRouteMachineState,
  };

  it('resolves an absent kind (a legacy row written before this field existed) to "route"', () => {
    expect(resolveStoredRideSessionKind(baseRow)).toBe("route");
  });

  it('resolves an explicit "route" kind to itself', () => {
    expect(resolveStoredRideSessionKind({ ...baseRow, kind: "route" })).toBe("route");
  });

  it('resolves an unrecognised, present kind value to "unsupported" — never silently to "route"', () => {
    expect(resolveStoredRideSessionKind({ ...baseRow, kind: "free-roam" })).toBe(
      "unsupported",
    );
  });
});

describe("toStoredPlanningDraft / fromStoredPlanningDraft", () => {
  const waypoints: Waypoint[] = [
    { id: "a", coordinate: [-1.5, 53.8] },
    { id: "b", coordinate: [-1.4, 53.8] },
  ];

  it("round-trips waypoints, route name, avoid-ferries preference and cycling profile", () => {
    const stored = toStoredPlanningDraft({
      waypoints,
      routeName: "Coastal loop",
      avoidFerries: false,
      profile: "cycling-regular",
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
      profile: "cycling-regular",
      editCopyOperation: "forward",
    });
  });

  it("defaults route name, avoid-ferries and profile for a row written before those fields existed", () => {
    // Simulates a real pre-existing row from before this feature shipped —
    // built by hand, not via toStoredPlanningDraft, so it genuinely lacks
    // routeName/avoidFerries/profile (rather than having them set to
    // undefined explicitly).
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
      profile: "cycling-road",
      editCopyOperation: "forward",
    });
  });

  it("recovers safely to cycling-road for a corrupt or unrecognised stored profile value", () => {
    const corruptRow: StoredPlanningDraft = {
      id: "draft",
      waypoints,
      updatedAt: "2026-01-01T00:00:00.000Z",
      profile: "cycling-mountain",
    };

    const restored = fromStoredPlanningDraft(corruptRow);

    expect(restored.profile).toBe("cycling-road");
  });

  it("round-trips edit-copy source route id and waypoints origin", () => {
    const stored = toStoredPlanningDraft({
      waypoints,
      routeName: "Coastal loop",
      avoidFerries: false,
      profile: "cycling-regular",
      editCopySourceRouteId: "route-1",
      editCopyWaypointsOrigin: "derived",
    });
    const restored = fromStoredPlanningDraft({
      id: "draft",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...stored,
    });

    expect(restored.editCopySourceRouteId).toBe("route-1");
    expect(restored.editCopyWaypointsOrigin).toBe("derived");
  });

  it("leaves edit-copy fields undefined for an ordinary draft never opened as an edit copy", () => {
    const stored = toStoredPlanningDraft({
      waypoints,
      routeName: "Coastal loop",
      avoidFerries: false,
      profile: "cycling-regular",
    });
    expect(stored).not.toHaveProperty("editCopySourceRouteId");
    expect(stored).not.toHaveProperty("editCopyWaypointsOrigin");

    const restored = fromStoredPlanningDraft({
      id: "draft",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...stored,
    });
    expect(restored.editCopySourceRouteId).toBeUndefined();
    expect(restored.editCopyWaypointsOrigin).toBeUndefined();
  });

  it("defaults edit-copy fields for a legacy row written before they existed", () => {
    const legacyRow: StoredPlanningDraft = {
      id: "draft",
      waypoints,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const restored = fromStoredPlanningDraft(legacyRow);
    expect(restored.editCopySourceRouteId).toBeUndefined();
    expect(restored.editCopyWaypointsOrigin).toBeUndefined();
  });

  it("recovers safely to undefined for a corrupt or unrecognised stored waypoints-origin value", () => {
    const corruptRow: StoredPlanningDraft = {
      id: "draft",
      waypoints,
      updatedAt: "2026-01-01T00:00:00.000Z",
      editCopySourceRouteId: "route-1",
      editCopyWaypointsOrigin: "approximate",
    };
    const restored = fromStoredPlanningDraft(corruptRow);
    expect(restored.editCopyWaypointsOrigin).toBeUndefined();
  });

  // "reverse" is now a legacy-only value (backlog item 38 removed its one
  // writer, RidingScreen.tsx's former pre-ride Reverse route action) — the
  // storage layer must still round-trip it correctly for a pre-existing
  // v0.3.17-v0.3.28 draft row, even though no current UI path writes it.
  it('round-trips editCopyOperation "reverse"', () => {
    const stored = toStoredPlanningDraft({
      waypoints,
      routeName: "Coastal loop (reversed)",
      avoidFerries: false,
      profile: "cycling-regular",
      editCopySourceRouteId: "route-1",
      editCopyWaypointsOrigin: "exact",
      editCopyOperation: "reverse",
    });
    const restored = fromStoredPlanningDraft({
      id: "draft",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...stored,
    });

    expect(restored.editCopyOperation).toBe("reverse");
  });

  it('defaults editCopyOperation to "forward" for a legacy row with editCopySourceRouteId/editCopyWaypointsOrigin but no editCopyOperation at all', () => {
    // Simulates a real draft written by the "Edit copy in Planning" slice
    // before Reverse route (and editCopyOperation) existed.
    const legacyEditCopyRow: StoredPlanningDraft = {
      id: "draft",
      waypoints,
      updatedAt: "2026-01-01T00:00:00.000Z",
      editCopySourceRouteId: "route-1",
      editCopyWaypointsOrigin: "derived",
    };
    const restored = fromStoredPlanningDraft(legacyEditCopyRow);
    expect(restored.editCopySourceRouteId).toBe("route-1");
    expect(restored.editCopyWaypointsOrigin).toBe("derived");
    expect(restored.editCopyOperation).toBe("forward");
  });

  it('recovers safely to "forward" for a corrupt or unrecognised editCopyOperation value', () => {
    const corruptRow: StoredPlanningDraft = {
      id: "draft",
      waypoints,
      updatedAt: "2026-01-01T00:00:00.000Z",
      editCopySourceRouteId: "route-1",
      editCopyWaypointsOrigin: "exact",
      editCopyOperation: "backwards",
    };
    const restored = fromStoredPlanningDraft(corruptRow);
    expect(restored.editCopyOperation).toBe("forward");
  });

  it('resolves editCopyOperation to "forward" even for an ordinary draft with no edit-copy fields at all, without that leaking a false notice', () => {
    const legacyRow: StoredPlanningDraft = {
      id: "draft",
      waypoints,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const restored = fromStoredPlanningDraft(legacyRow);
    // The two-field gate (editCopySourceRouteId + editCopyWaypointsOrigin),
    // not editCopyOperation, is what suppresses PlanningScreen's notice —
    // this field alone resolving to "forward" must never be read as "this
    // is an edit copy".
    expect(restored.editCopySourceRouteId).toBeUndefined();
    expect(restored.editCopyWaypointsOrigin).toBeUndefined();
    expect(restored.editCopyOperation).toBe("forward");
  });
});

describe("toStoredPlanningPreferences / fromStoredPlanningPreferences", () => {
  it("defaults avoidFerriesByDefault to true and profileByDefault to cycling-road when no row has ever been saved", () => {
    expect(fromStoredPlanningPreferences(undefined)).toEqual({
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-road",
    });
  });

  it("round-trips an explicitly saved false ferries value alongside cycling-regular", () => {
    const stored = toStoredPlanningPreferences({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-regular",
    });
    const restored = fromStoredPlanningPreferences({ id: "planning", ...stored });

    expect(restored).toEqual({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-regular",
    });
  });

  it("round-trips an explicitly saved true ferries value alongside cycling-road, distinct from the no-row default", () => {
    const stored = toStoredPlanningPreferences({
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-road",
    });
    const restored = fromStoredPlanningPreferences({ id: "planning", ...stored });

    expect(restored).toEqual({
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-road",
    });
  });

  it("round-trips every combination of profile and ferry value", () => {
    for (const profileByDefault of ["cycling-road", "cycling-regular"] as const) {
      for (const avoidFerriesByDefault of [true, false]) {
        const stored = toStoredPlanningPreferences({
          avoidFerriesByDefault,
          profileByDefault,
        });
        const restored = fromStoredPlanningPreferences({ id: "planning", ...stored });

        expect(restored).toEqual({ avoidFerriesByDefault, profileByDefault });
      }
    }
  });

  it("defaults profileByDefault to cycling-road for a legacy row written before that field existed", () => {
    const legacyRow = { id: "planning" as const, avoidFerriesByDefault: false };

    expect(fromStoredPlanningPreferences(legacyRow)).toEqual({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-road",
    });
  });

  it("recovers safely to cycling-road for a corrupt or unrecognised stored profileByDefault value", () => {
    const corruptRow = {
      id: "planning" as const,
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-mountain",
    };

    expect(fromStoredPlanningPreferences(corruptRow)).toEqual({
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-road",
    });
  });

  it("never includes the row id in the stored shape", () => {
    const stored = toStoredPlanningPreferences({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-road",
    });

    expect(stored).not.toHaveProperty("id");
  });
});

describe("toStoredRouteLibraryPreferences / fromStoredRouteLibraryPreferences", () => {
  it("defaults sortOrder to most-recent when no row has ever been saved", () => {
    expect(fromStoredRouteLibraryPreferences(undefined)).toEqual({
      sortOrder: "most-recent",
    });
  });

  it("round-trips an explicitly saved name-asc value", () => {
    const stored = toStoredRouteLibraryPreferences({ sortOrder: "name-asc" });
    const restored = fromStoredRouteLibraryPreferences({
      id: "route-library",
      ...stored,
    });

    expect(restored).toEqual({ sortOrder: "name-asc" });
  });

  it("round-trips an explicitly saved most-recent value, distinct from the no-row default", () => {
    const stored = toStoredRouteLibraryPreferences({ sortOrder: "most-recent" });
    const restored = fromStoredRouteLibraryPreferences({
      id: "route-library",
      ...stored,
    });

    expect(restored).toEqual({ sortOrder: "most-recent" });
  });

  it("recovers safely to most-recent for a corrupt or unrecognised stored sort order value", () => {
    const corruptRow: StoredRouteLibraryPreferences = {
      id: "route-library",
      sortOrder: "date-descending",
    };

    const restored = fromStoredRouteLibraryPreferences(corruptRow);

    expect(restored).toEqual({ sortOrder: "most-recent" });
  });

  it("never includes the row id in the stored shape", () => {
    const stored = toStoredRouteLibraryPreferences({ sortOrder: "name-asc" });

    expect(stored).not.toHaveProperty("id");
  });
});
