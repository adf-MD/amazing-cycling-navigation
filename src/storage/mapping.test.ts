import { describe, expect, it } from "vitest";
import { fromStoredRideState, toStoredRideState } from "./mapping.ts";
import type { RideNavigationCoreState } from "../navigation/rideNavigationCore.ts";
import type { GeolocationFix } from "../platform/geolocation.ts";

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

describe("toStoredRideState / fromStoredRideState", () => {
  it("round-trips matched distance, off-route state and elevation window", () => {
    const stored = toStoredRideState(
      "route-1",
      "2026-01-01T00:00:00.000Z",
      fix,
      coreState,
      5000,
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
    );

    expect(stored.lastFix).toBeNull();
    expect(stored.lastMatchedPointIndex).toBe(0);
    expect(stored.matchedDistanceFromStartMetres).toBe(0);

    const restored = fromStoredRideState(stored);
    expect(restored.lastFix).toBeNull();
    expect(restored.core.lastMatch).toBeNull();
  });
});
