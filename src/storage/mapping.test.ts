import { describe, expect, it } from "vitest";
import {
  fromStoredRideState,
  toStoredRideState,
  type StoredCameraState,
} from "./mapping.ts";
import type { RideNavigationCoreState } from "../navigation/rideNavigationCore.ts";
import type { GeolocationFix } from "../platform/geolocation.ts";
import type { StoredRideState } from "./db.ts";

const coreState: RideNavigationCoreState = {
  lastMatch: { pointIndex: 4, distanceFromStartMetres: 321.5 },
  offRouteMachineState: {
    level: "possibly-off-route",
    candidateLevel: "off-route",
    streak: 1,
  },
};

const fix: GeolocationFix = {
  coordinate: [-1.5, 53.8],
  accuracyMetres: 8,
  timestampMs: 1_700_000,
  speedMetresPerSecond: 4.2,
};

const overviewCamera: StoredCameraState = {
  mode: "overview",
  coordinate: null,
  zoom: null,
};

describe("toStoredRideState / fromStoredRideState", () => {
  it("round-trips matched distance, off-route state and elevation window", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      5000,
      overviewCamera,
    );
    const restored = fromStoredRideState(stored);

    expect(restored.core).toEqual(coreState);
    expect(restored.elevationWindowMetres).toBe(5000);
    expect(restored.lastFix?.coordinate).toEqual(fix.coordinate);
    expect(restored.lastFix?.accuracyMetres).toBe(fix.accuracyMetres);
    expect(restored.lastFix?.timestampMs).toBe(fix.timestampMs);
  });

  it("never persists speed, since it must not become ride history", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      5000,
      overviewCamera,
    );
    expect(stored.lastFix).not.toHaveProperty("speedMetresPerSecond");
  });

  it("restores a null speed for a fix read back from storage", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      5000,
      overviewCamera,
    );
    const restored = fromStoredRideState(stored);
    expect(restored.lastFix?.speedMetresPerSecond).toBeNull();
  });

  it("stores a null lastFix and null lastMatch when there is no fix yet", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      null,
      { lastMatch: null, offRouteMachineState: coreState.offRouteMachineState },
      2000,
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
      5000,
      {
        mode: "following",
        coordinate: null,
        zoom: null,
      },
    );
    const restored = fromStoredRideState(stored);

    expect(restored.cameraState).toEqual({
      mode: "following",
      coordinate: null,
      zoom: null,
    });
  });

  it("round-trips a free camera state's saved position and zoom", () => {
    const freeCamera: StoredCameraState = {
      mode: "free",
      coordinate: [-1.2, 53.4],
      zoom: 13.5,
    };
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      5000,
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
});
