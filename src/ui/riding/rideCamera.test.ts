import { describe, expect, it } from "vitest";
import {
  FOLLOW_MIN_MOVEMENT_METRES,
  INITIAL_RIDE_CAMERA_STATE,
  NAVIGATION_ZOOM,
  rideCameraReducer,
  type RideCameraState,
} from "./rideCamera.ts";
import type { Coordinate } from "../../domain/types.ts";

const START: Coordinate = [0, 51];
// ~1.1m north of START — well under the 3m movement threshold.
const INSIGNIFICANT_MOVE: Coordinate = [0, 51.00001];
// ~5.6m north of START — well over the 3m movement threshold.
const SIGNIFICANT_MOVE: Coordinate = [0, 51.00005];

function followingState(overrides: Partial<RideCameraState> = {}): RideCameraState {
  return {
    mode: "following",
    awaitingFreshFix: false,
    lastFollowedCoordinate: START,
    ...overrides,
  };
}

describe("rideCameraReducer", () => {
  describe("route-opened", () => {
    it("resets to overview from any prior state, with no command", () => {
      const result = rideCameraReducer(followingState(), { type: "route-opened" });
      expect(result.state).toEqual(INITIAL_RIDE_CAMERA_STATE);
      expect(result.command).toBeNull();
      expect(result.pausedToast).toBe(false);
    });

    it("resets to overview from free too", () => {
      const result = rideCameraReducer(
        { mode: "free", awaitingFreshFix: false, lastFollowedCoordinate: null },
        { type: "route-opened" },
      );
      expect(result.state.mode).toBe("overview");
    });
  });

  describe("follow-requested", () => {
    it("with a fresh coordinate, enters following and issues an animated command immediately", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: START,
      });
      expect(result.state).toEqual({
        mode: "following",
        awaitingFreshFix: false,
        lastFollowedCoordinate: START,
      });
      expect(result.command).toEqual({
        coordinate: START,
        zoom: NAVIGATION_ZOOM,
        animate: true,
      });
    });

    it("without a fresh coordinate, enters a pending-following state with no command", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: null,
      });
      expect(result.state).toEqual({
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
      });
      expect(result.command).toBeNull();
    });
  });

  describe("fresh-fix", () => {
    it("recentres immediately when following was pending (awaitingFreshFix)", () => {
      const pending: RideCameraState = {
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
      };
      const result = rideCameraReducer(pending, { type: "fresh-fix", coordinate: START });
      expect(result.state.awaitingFreshFix).toBe(false);
      expect(result.state.lastFollowedCoordinate).toEqual(START);
      expect(result.command).toEqual({
        coordinate: START,
        zoom: NAVIGATION_ZOOM,
        animate: true,
      });
    });

    it("is a no-op while in overview", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "fresh-fix",
        coordinate: START,
      });
      expect(result.state).toEqual(INITIAL_RIDE_CAMERA_STATE);
      expect(result.command).toBeNull();
    });

    it("never moves the camera while free", () => {
      const free: RideCameraState = {
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
      };
      const result = rideCameraReducer(free, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
      });
      expect(result.state).toEqual(free);
      expect(result.command).toBeNull();
    });

    it("suppresses insignificant movement below the threshold (GPS jitter / stationary rider)", () => {
      const state = followingState({ lastFollowedCoordinate: START });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: INSIGNIFICANT_MOVE,
      });
      expect(result.command).toBeNull();
      expect(result.state).toEqual(state);
    });

    it("recentres for movement at or above the threshold", () => {
      const state = followingState({ lastFollowedCoordinate: START });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
      });
      expect(result.command).toEqual({
        coordinate: SIGNIFICANT_MOVE,
        zoom: NAVIGATION_ZOOM,
        animate: true,
      });
      expect(result.state.lastFollowedCoordinate).toEqual(SIGNIFICANT_MOVE);
    });

    it("repeated stationary fixes never jitter the camera", () => {
      let state = followingState({ lastFollowedCoordinate: START });
      for (let i = 0; i < 5; i += 1) {
        const result = rideCameraReducer(state, {
          type: "fresh-fix",
          coordinate: INSIGNIFICANT_MOVE,
        });
        expect(result.command).toBeNull();
        state = result.state;
      }
    });
  });

  describe("user-interaction", () => {
    it("moves to free from overview, with no paused toast (nothing was following)", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "user-interaction",
      });
      expect(result.state).toEqual({
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
      });
      expect(result.command).toBeNull();
      expect(result.pausedToast).toBe(false);
    });

    it("moves to free from following, with a paused toast", () => {
      const result = rideCameraReducer(followingState(), { type: "user-interaction" });
      expect(result.state.mode).toBe("free");
      expect(result.pausedToast).toBe(true);
    });

    it("moves to free from pending-following, with a paused toast", () => {
      const pending: RideCameraState = {
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
      };
      const result = rideCameraReducer(pending, { type: "user-interaction" });
      expect(result.state.mode).toBe("free");
      expect(result.pausedToast).toBe(true);
    });

    it("is a no-op when already free", () => {
      const free: RideCameraState = {
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
      };
      const result = rideCameraReducer(free, { type: "user-interaction" });
      expect(result.state).toEqual(free);
      expect(result.command).toBeNull();
      expect(result.pausedToast).toBe(false);
    });

    it("programmatic camera movement is never represented as this event — following stays following", () => {
      // There is no reducer input corresponding to a programmatic
      // fitBounds/easeTo/jumpTo call; only a real "user-interaction"
      // event (dispatched solely from MapLibre's originalEvent-carrying
      // gesture events — see mapAdapter.ts) can move the mode to "free".
      const state = followingState();
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
      });
      expect(result.state.mode).toBe("following");
    });
  });

  describe("restore", () => {
    it("restores into following as pending, awaiting the next fresh fix", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "following",
        coordinate: null,
        zoom: null,
      });
      expect(result.state).toEqual({
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
      });
      expect(result.command).toBeNull();
    });

    it("restores into free with a saved position, issuing one instant (non-animated) jump", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "free",
        coordinate: START,
        zoom: 14,
      });
      expect(result.state).toEqual({
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
      });
      expect(result.command).toEqual({ coordinate: START, zoom: 14, animate: false });
    });

    it("restores into free with no saved position and issues no command", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "free",
        coordinate: null,
        zoom: null,
      });
      expect(result.state.mode).toBe("free");
      expect(result.command).toBeNull();
    });

    it("restores into overview when the persisted mode is overview", () => {
      const result = rideCameraReducer(followingState(), {
        type: "restore",
        mode: "overview",
        coordinate: null,
        zoom: null,
      });
      expect(result.state).toEqual(INITIAL_RIDE_CAMERA_STATE);
      expect(result.command).toBeNull();
    });
  });

  it("FOLLOW_MIN_MOVEMENT_METRES is a small, sub-GPS-accuracy threshold", () => {
    expect(FOLLOW_MIN_MOVEMENT_METRES).toBeGreaterThan(0);
    expect(FOLLOW_MIN_MOVEMENT_METRES).toBeLessThan(10);
  });
});
