import { describe, expect, it } from "vitest";
import {
  FOLLOW_MIN_MOVEMENT_METRES,
  FOLLOW_PITCH_DEGREES,
  GPS_COURSE_MIN_SPEED_METRES_PER_SECOND,
  hasActionableFollowAnchor,
  INITIAL_RIDE_CAMERA_STATE,
  NAVIGATION_ZOOM,
  ROTATION_DEAD_BAND_DEGREES,
  ROUTE_GPS_MAX_DISAGREEMENT_DEGREES,
  rideCameraReducer,
  selectTravelBearingDegrees,
  type BearingContext,
  type RideCameraState,
} from "./rideCamera.ts";
import type { Coordinate } from "../../domain/types.ts";

const START: Coordinate = [0, 51];
// ~1.1m north of START — well under the 3m movement threshold.
const INSIGNIFICANT_MOVE: Coordinate = [0, 51.00001];
// ~5.6m north of START — well over the 3m movement threshold.
const SIGNIFICANT_MOVE: Coordinate = [0, 51.00005];

const NEUTRAL_BEARING_CONTEXT: BearingContext = {
  headingDegrees: null,
  speedMetresPerSecond: null,
  routeTangentBearingDegrees: null,
  offRouteLevel: "on-route",
};

function followingState(overrides: Partial<RideCameraState> = {}): RideCameraState {
  return {
    mode: "following",
    awaitingFreshFix: false,
    lastFollowedCoordinate: START,
    lastCommandedBearingDegrees: 0,
    followZoomLevel: NAVIGATION_ZOOM,
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
        {
          mode: "free",
          awaitingFreshFix: false,
          lastFollowedCoordinate: null,
          lastCommandedBearingDegrees: null,
          followZoomLevel: NAVIGATION_ZOOM,
        },
        { type: "route-opened" },
      );
      expect(result.state.mode).toBe("overview");
    });

    it("resets followZoomLevel to NAVIGATION_ZOOM from a non-default value", () => {
      const result = rideCameraReducer(followingState({ followZoomLevel: 18.5 }), {
        type: "route-opened",
      });
      expect(result.state.followZoomLevel).toBe(NAVIGATION_ZOOM);
    });
  });

  describe("follow-requested", () => {
    it("with a fresh coordinate, enters following and issues an animated command immediately", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: START,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.state).toEqual({
        mode: "following",
        awaitingFreshFix: false,
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 0,
        followZoomLevel: NAVIGATION_ZOOM,
      });
      expect(result.command).toEqual({
        coordinate: START,
        zoom: NAVIGATION_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: FOLLOW_PITCH_DEGREES,
        animate: true,
        followOffset: true,
      });
    });

    it("without a fresh coordinate, enters a pending-following state with no command", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: null,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.state).toEqual({
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      });
      expect(result.command).toBeNull();
    });

    it("resolves a route-tangent bearing immediately, resuming travel-up in one tap", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: START,
        bearingContext: { ...NEUTRAL_BEARING_CONTEXT, routeTangentBearingDegrees: 200 },
      });
      expect(result.command?.bearingDegrees).toBe(200);
      expect(result.command?.pitchDegrees).toBe(FOLLOW_PITCH_DEGREES);
    });

    it("copies a supplied requestId verbatim into the produced command, so an explicit re-press can be told apart from an automatic update", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: START,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
        requestId: "follow-request-1",
      });
      expect(result.command?.requestId).toBe("follow-request-1");
    });

    it("leaves the command's requestId undefined when none is supplied", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: START,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.command?.requestId).toBeUndefined();
    });

    it("without a fresh coordinate, produces no command regardless of requestId", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: null,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
        requestId: "follow-request-2",
      });
      expect(result.command).toBeNull();
    });

    it("uses the current followZoomLevel, not the raw NAVIGATION_ZOOM constant, when they differ", () => {
      const state: RideCameraState = {
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: 18.5,
      };
      const result = rideCameraReducer(state, {
        type: "follow-requested",
        freshCoordinate: START,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.command?.zoom).toBe(18.5);
      expect(result.state.followZoomLevel).toBe(18.5);
    });

    it("without a fresh coordinate, preserves the existing followZoomLevel rather than resetting it", () => {
      const state: RideCameraState = {
        mode: "overview",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: 18.5,
      };
      const result = rideCameraReducer(state, {
        type: "follow-requested",
        freshCoordinate: null,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.state.followZoomLevel).toBe(18.5);
    });

    it("leaving Follow (user-interaction) then re-engaging reuses the preserved followZoomLevel, not NAVIGATION_ZOOM", () => {
      const following = followingState({ followZoomLevel: 18.5 });
      const paused = rideCameraReducer(following, { type: "user-interaction" });
      expect(paused.state.mode).toBe("free");
      expect(paused.state.followZoomLevel).toBe(18.5);

      const resumed = rideCameraReducer(paused.state, {
        type: "follow-requested",
        freshCoordinate: SIGNIFICANT_MOVE,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(resumed.command?.zoom).toBe(18.5);
      expect(resumed.state.followZoomLevel).toBe(18.5);
    });
  });

  describe("fresh-fix", () => {
    it("recentres immediately when following was pending (awaitingFreshFix)", () => {
      const pending: RideCameraState = {
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      };
      const result = rideCameraReducer(pending, {
        type: "fresh-fix",
        coordinate: START,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.state.awaitingFreshFix).toBe(false);
      expect(result.state.lastFollowedCoordinate).toEqual(START);
      expect(result.command).toEqual({
        coordinate: START,
        zoom: NAVIGATION_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: FOLLOW_PITCH_DEGREES,
        animate: true,
        followOffset: true,
      });
    });

    it("is a no-op while in overview", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "fresh-fix",
        coordinate: START,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.state).toEqual(INITIAL_RIDE_CAMERA_STATE);
      expect(result.command).toBeNull();
    });

    it("never moves the camera while free", () => {
      const free: RideCameraState = {
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      };
      const result = rideCameraReducer(free, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.state).toEqual(free);
      expect(result.command).toBeNull();
    });

    it("suppresses insignificant movement below the threshold (GPS jitter / stationary rider)", () => {
      const state = followingState({ lastFollowedCoordinate: START });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: INSIGNIFICANT_MOVE,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.command).toBeNull();
      expect(result.state).toEqual(state);
    });

    it("recentres for movement at or above the threshold, retaining the stable bearing", () => {
      const state = followingState({
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 0,
      });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.command).toEqual({
        coordinate: SIGNIFICANT_MOVE,
        zoom: NAVIGATION_ZOOM,
        bearingDegrees: 0,
        pitchDegrees: FOLLOW_PITCH_DEGREES,
        animate: true,
        followOffset: true,
      });
      expect(result.state.lastFollowedCoordinate).toEqual(SIGNIFICANT_MOVE);
      expect(result.state.lastCommandedBearingDegrees).toBe(0);
    });

    it("never carries a requestId — automatic GPS-driven commands stay value-deduped, never identity-deduped", () => {
      const state = followingState({
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 0,
      });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.command?.requestId).toBeUndefined();
    });

    it("repeated stationary fixes never jitter the camera", () => {
      let state = followingState({ lastFollowedCoordinate: START });
      for (let i = 0; i < 5; i += 1) {
        const result = rideCameraReducer(state, {
          type: "fresh-fix",
          coordinate: INSIGNIFICANT_MOVE,
          bearingContext: NEUTRAL_BEARING_CONTEXT,
        });
        expect(result.command).toBeNull();
        state = result.state;
      }
    });

    it("a meaningful bearing change updates bearing even when position movement is below the recentre threshold", () => {
      const state = followingState({
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 0,
      });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: INSIGNIFICANT_MOVE,
        bearingContext: { ...NEUTRAL_BEARING_CONTEXT, routeTangentBearingDegrees: 170 },
      });
      expect(result.command).toEqual({
        coordinate: START, // unchanged: position movement was insignificant
        zoom: NAVIGATION_ZOOM,
        bearingDegrees: 170,
        pitchDegrees: FOLLOW_PITCH_DEGREES,
        animate: true,
        followOffset: true,
      });
    });

    it("a fresh fix can update centre without changing an established stable bearing", () => {
      const state = followingState({
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 90,
      });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
        // Route tangent close enough to 90 to fall within the dead band.
        bearingContext: { ...NEUTRAL_BEARING_CONTEXT, routeTangentBearingDegrees: 93 },
      });
      expect(result.command?.coordinate).toEqual(SIGNIFICANT_MOVE);
      expect(result.command?.bearingDegrees).toBe(90);
      expect(result.state.lastCommandedBearingDegrees).toBe(90);
    });

    it("a meaningful turn produces exactly one updated bearing target, not a drift of small steps", () => {
      const state = followingState({
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 10,
      });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
        bearingContext: { ...NEUTRAL_BEARING_CONTEXT, routeTangentBearingDegrees: 100 },
      });
      expect(result.command?.bearingDegrees).toBe(100);
      expect(result.state.lastCommandedBearingDegrees).toBe(100);
    });

    it("uses the current followZoomLevel for the produced command's zoom", () => {
      const state = followingState({
        lastFollowedCoordinate: START,
        followZoomLevel: 18.5,
      });
      const result = rideCameraReducer(state, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.command?.zoom).toBe(18.5);
      expect(result.state.followZoomLevel).toBe(18.5);
    });

    it("several consecutive fixes with genuine movement never reset a previously-set followZoomLevel", () => {
      let state = followingState({ lastFollowedCoordinate: START, followZoomLevel: 19 });
      const coordinates: Coordinate[] = [
        [0, 51.0001],
        [0, 51.0002],
        [0, 51.0003],
      ];
      for (const coordinate of coordinates) {
        const result = rideCameraReducer(state, {
          type: "fresh-fix",
          coordinate,
          bearingContext: NEUTRAL_BEARING_CONTEXT,
        });
        expect(result.command?.zoom).toBe(19);
        expect(result.state.followZoomLevel).toBe(19);
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
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      });
      expect(result.command).toBeNull();
      expect(result.pausedToast).toBe(false);
    });

    it("moves to free from following, with a paused toast", () => {
      const result = rideCameraReducer(followingState(), { type: "user-interaction" });
      expect(result.state.mode).toBe("free");
      expect(result.state.lastCommandedBearingDegrees).toBeNull();
      expect(result.pausedToast).toBe(true);
    });

    it("moves to free from pending-following, with a paused toast", () => {
      const pending: RideCameraState = {
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
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
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
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
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(result.state.mode).toBe("following");
    });

    it("preserves followZoomLevel across a departure from following (retains, never resets)", () => {
      const result = rideCameraReducer(followingState({ followZoomLevel: 18.5 }), {
        type: "user-interaction",
      });
      expect(result.state.followZoomLevel).toBe(18.5);
    });
  });

  describe("north-up-requested", () => {
    it("from following: exits to free, resets orientation, preserves centre/zoom, shows the paused toast", () => {
      const result = rideCameraReducer(followingState(), { type: "north-up-requested" });
      expect(result.state).toEqual({
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      });
      expect(result.command).toEqual({
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
        animate: true,
        followOffset: false,
      });
      expect(result.pausedToast).toBe(true);
    });

    it("from pending-following: also exits to free with a paused toast", () => {
      const pending: RideCameraState = {
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      };
      const result = rideCameraReducer(pending, { type: "north-up-requested" });
      expect(result.state.mode).toBe("free");
      expect(result.pausedToast).toBe(true);
    });

    it("from free: stays free, resets orientation, no toast (nothing was following)", () => {
      const free: RideCameraState = {
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      };
      const result = rideCameraReducer(free, { type: "north-up-requested" });
      expect(result.state.mode).toBe("free");
      expect(result.command).toEqual({
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
        animate: true,
        followOffset: false,
      });
      expect(result.pausedToast).toBe(false);
    });

    it("copies a supplied requestId verbatim into the produced command, so a repeated press after an intervening manual rotation can still be told apart from the first", () => {
      const result = rideCameraReducer(followingState(), {
        type: "north-up-requested",
        requestId: "north-up-request-1",
      });
      expect(result.command?.requestId).toBe("north-up-request-1");
    });

    it("leaves the command's requestId undefined when none is supplied", () => {
      const result = rideCameraReducer(followingState(), { type: "north-up-requested" });
      expect(result.command?.requestId).toBeUndefined();
    });

    it("preserves followZoomLevel across a departure from following (retains, never resets)", () => {
      const result = rideCameraReducer(followingState({ followZoomLevel: 18.5 }), {
        type: "north-up-requested",
      });
      expect(result.state.followZoomLevel).toBe(18.5);
    });
  });

  describe("restore", () => {
    it("restores into following as pending, awaiting the next fresh fix", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "following",
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(result.state).toEqual({
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      });
      expect(result.command).toBeNull();
    });

    it("restores into following with a valid persisted zoom, using it instead of NAVIGATION_ZOOM", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "following",
        coordinate: null,
        zoom: 18.5,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(result.state.followZoomLevel).toBe(18.5);
    });

    it("restores into following with a null persisted zoom, falling back to NAVIGATION_ZOOM", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "following",
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(result.state.followZoomLevel).toBe(NAVIGATION_ZOOM);
    });

    it("restores into following with a non-finite persisted zoom, falling back to NAVIGATION_ZOOM", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "following",
        coordinate: null,
        zoom: Number.NaN,
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(result.state.followZoomLevel).toBe(NAVIGATION_ZOOM);
    });

    it("restores into free with a saved position, bearing and pitch, issuing one instant (non-animated) jump", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "free",
        coordinate: START,
        zoom: 14,
        bearingDegrees: 123,
        pitchDegrees: 20,
      });
      expect(result.state).toEqual({
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      });
      expect(result.command).toEqual({
        coordinate: START,
        zoom: 14,
        bearingDegrees: 123,
        pitchDegrees: 20,
        animate: false,
        followOffset: false,
      });
      expect(result.command?.requestId).toBeUndefined();
    });

    it("restores into free with no saved position and issues no command", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "restore",
        mode: "free",
        coordinate: null,
        zoom: null,
        bearingDegrees: 0,
        pitchDegrees: 0,
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
        bearingDegrees: 0,
        pitchDegrees: 0,
      });
      expect(result.state).toEqual(INITIAL_RIDE_CAMERA_STATE);
      expect(result.command).toBeNull();
    });
  });

  describe("follow-zoom-changed", () => {
    // Backlog item 65: followingState()'s own defaults are an actionable
    // anchor (lastFollowedCoordinate: START, lastCommandedBearingDegrees:
    // 0), so this now also produces a real, anchored command — reissuing
    // the already-committed coordinate/bearing/pitch at the new zoom,
    // preserving the rider's below-centre screen anchor through the zoom
    // (see followCommand and hasActionableFollowAnchor).
    it("while genuinely following with an actionable anchor, changes followZoomLevel by delta AND produces an anchored command reusing the existing coordinate/bearing, carrying the given requestId", () => {
      const state = followingState({
        followZoomLevel: 16,
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 42,
      });
      const result = rideCameraReducer(state, {
        type: "follow-zoom-changed",
        delta: 1,
        requestId: "5",
      });
      expect(result.state).toEqual({ ...state, followZoomLevel: 17 });
      expect(result.command).toEqual({
        coordinate: START,
        zoom: 17,
        bearingDegrees: 42,
        pitchDegrees: FOLLOW_PITCH_DEGREES,
        animate: true,
        followOffset: true,
        requestId: "5",
      });
      expect(result.pausedToast).toBe(false);
    });

    it("a negative delta decreases both followZoomLevel and the produced command's zoom together", () => {
      const state = followingState({ followZoomLevel: 16 });
      const result = rideCameraReducer(state, {
        type: "follow-zoom-changed",
        delta: -1,
        requestId: "1",
      });
      expect(result.state.followZoomLevel).toBe(15);
      expect(result.command?.zoom).toBe(15);
    });

    it("without a requestId, still produces a command (requestId is simply undefined) when actionable", () => {
      const state = followingState({ followZoomLevel: 16 });
      const result = rideCameraReducer(state, { type: "follow-zoom-changed", delta: 1 });
      expect(result.command).not.toBeNull();
      expect(result.command?.requestId).toBeUndefined();
    });

    it("while following but still awaiting the first fresh fix, followZoomLevel updates but no command is produced (never fabricates a coordinate)", () => {
      const state: RideCameraState = {
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: 16,
      };
      const result = rideCameraReducer(state, {
        type: "follow-zoom-changed",
        delta: 1,
        requestId: "1",
      });
      expect(result.state.followZoomLevel).toBe(17);
      expect(result.command).toBeNull();
    });

    // Deliberate design decision, not left implicit: followZoomLevel is
    // updated unconditionally regardless of mode, for the simplest, most
    // predictable behaviour and the best continuity if the rider zooms
    // while free-panning then re-engages Follow (see the
    // "follow-requested" describe block above for that continuity
    // proof) — but only a genuinely followed, actionable press ever
    // produces a command (backlog item 65); free/overview zoom always
    // routes through the ordinary unanchored zoomTarget/changeZoomBy
    // path instead (useRideCamera.ts's requestZoom).
    it("while free, followZoomLevel still updates (applied unconditionally, not gated on following), no command", () => {
      const free: RideCameraState = {
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      };
      const result = rideCameraReducer(free, {
        type: "follow-zoom-changed",
        delta: 2,
        requestId: "1",
      });
      expect(result.state.followZoomLevel).toBe(NAVIGATION_ZOOM + 2);
      expect(result.state.mode).toBe("free");
      expect(result.command).toBeNull();
    });

    it("while overview, followZoomLevel still updates, no command", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-zoom-changed",
        delta: 1,
        requestId: "1",
      });
      expect(result.state.followZoomLevel).toBe(NAVIGATION_ZOOM + 1);
      expect(result.command).toBeNull();
    });

    it("never changes mode, awaitingFreshFix, lastFollowedCoordinate or lastCommandedBearingDegrees", () => {
      const state = followingState({
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 42,
      });
      const result = rideCameraReducer(state, {
        type: "follow-zoom-changed",
        delta: 1,
        requestId: "1",
      });
      expect(result.state.mode).toBe(state.mode);
      expect(result.state.awaitingFreshFix).toBe(state.awaitingFreshFix);
      expect(result.state.lastFollowedCoordinate).toEqual(state.lastFollowedCoordinate);
      expect(result.state.lastCommandedBearingDegrees).toBe(
        state.lastCommandedBearingDegrees,
      );
    });
  });

  describe("hasActionableFollowAnchor", () => {
    it("true only while following, not awaiting the first fix, with both a coordinate and a bearing already committed", () => {
      expect(
        hasActionableFollowAnchor(
          followingState({
            lastFollowedCoordinate: START,
            lastCommandedBearingDegrees: 0,
          }),
        ),
      ).toBe(true);
    });

    it("false while awaiting the first fresh fix", () => {
      expect(
        hasActionableFollowAnchor(
          followingState({ awaitingFreshFix: true, lastFollowedCoordinate: null }),
        ),
      ).toBe(false);
    });

    it("false while free", () => {
      const free: RideCameraState = {
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: START,
        lastCommandedBearingDegrees: 0,
        followZoomLevel: NAVIGATION_ZOOM,
      };
      expect(hasActionableFollowAnchor(free)).toBe(false);
    });

    it("false while overview", () => {
      expect(hasActionableFollowAnchor(INITIAL_RIDE_CAMERA_STATE)).toBe(false);
    });

    it("false when lastFollowedCoordinate is null even though mode is following and not awaiting a fix", () => {
      expect(
        hasActionableFollowAnchor(
          followingState({
            lastFollowedCoordinate: null,
            lastCommandedBearingDegrees: 0,
          }),
        ),
      ).toBe(false);
    });

    it("false when lastCommandedBearingDegrees is null even though mode is following and not awaiting a fix", () => {
      expect(
        hasActionableFollowAnchor(
          followingState({
            lastFollowedCoordinate: START,
            lastCommandedBearingDegrees: null,
          }),
        ),
      ).toBe(false);
    });
  });

  describe("follow-zoom-settled", () => {
    it("while following with an already-issued command (awaitingFreshFix false), reconciles followZoomLevel to the settled zoom", () => {
      const state = followingState({ followZoomLevel: 17 });
      const result = rideCameraReducer(state, {
        type: "follow-zoom-settled",
        zoom: 16.847,
        hasAppliedCameraCommand: true,
      });
      expect(result.state.followZoomLevel).toBe(16.847);
      expect(result.command).toBeNull();
      expect(result.pausedToast).toBe(false);
    });

    it("while following but still awaitingFreshFix (e.g. just restored), is a reference-stable no-op", () => {
      const state: RideCameraState = {
        mode: "following",
        awaitingFreshFix: true,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: 18.5,
      };
      const result = rideCameraReducer(state, {
        type: "follow-zoom-settled",
        zoom: 6, // e.g. an unrelated overview-fit settle
        hasAppliedCameraCommand: true,
      });
      expect(result.state).toBe(state);
      expect(result.state.followZoomLevel).toBe(18.5);
    });

    it("while following with an already-issued command, but hasAppliedCameraCommand is false, is a reference-stable no-op", () => {
      // Backlog item 74: awaitingFreshFix alone cannot detect this window —
      // it is already false (a real command was issued) — only
      // hasAppliedCameraCommand can tell that MapView has not actually
      // applied that command to the map yet.
      const state = followingState({ followZoomLevel: 17 });
      const result = rideCameraReducer(state, {
        type: "follow-zoom-settled",
        zoom: 0, // e.g. MapLibre's own raw pre-style-ready default settle
        hasAppliedCameraCommand: false,
      });
      expect(result.state).toBe(state);
      expect(result.state.followZoomLevel).toBe(17);
    });

    it("while free, is a no-op", () => {
      const free: RideCameraState = {
        mode: "free",
        awaitingFreshFix: false,
        lastFollowedCoordinate: null,
        lastCommandedBearingDegrees: null,
        followZoomLevel: NAVIGATION_ZOOM,
      };
      const result = rideCameraReducer(free, {
        type: "follow-zoom-settled",
        zoom: 12,
        hasAppliedCameraCommand: true,
      });
      expect(result.state).toBe(free);
    });

    it("while overview, is a no-op", () => {
      const result = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-zoom-settled",
        zoom: 8,
        hasAppliedCameraCommand: true,
      });
      expect(result.state).toBe(INITIAL_RIDE_CAMERA_STATE);
    });

    it("returns the exact same state reference when the settled zoom already matches", () => {
      const state = followingState({ followZoomLevel: 17 });
      const result = rideCameraReducer(state, {
        type: "follow-zoom-settled",
        zoom: 17,
        hasAppliedCameraCommand: true,
      });
      expect(result.state).toBe(state);
    });
  });

  describe("backlog item 74: a settle that lands before the issued command has actually applied", () => {
    // Reproduces the exact field-evidence-matching sequence for a fresh
    // free-roam/Riding Start: FreeRoamScreen's synchronous mount-time
    // requestFollow() fires with no fix yet, the first GPS fix then issues
    // a real follow command that the reducer considers "issued"
    // (awaitingFreshFix flips false) even though MapView cannot actually
    // call setCamera for it until the map style is ready. If MapLibre's own
    // confirmed pre-style-ready moveend (see MapView.tsx's onCameraSettled
    // doc comment, backlog item 67) settles at its raw [0,0]/zoom-0 default
    // in that window, MapView now honestly reports hasAppliedCameraCommand:
    // false for that settle (backlog item 74), which this guard must use to
    // reject it — without this guard (proven by temporarily hard-coding
    // hasAppliedCameraCommand: true below, matching this suite's pre-fix
    // behaviour) the settle would silently corrupt followZoomLevel, and the
    // very next fresh fix would reuse the corrupted value for a real, live
    // command.
    it("does not corrupt followZoomLevel from a settle MapView reports as not yet applied, and the next command keeps the original zoom", () => {
      const requested = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: null,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(requested.state.awaitingFreshFix).toBe(true);
      expect(requested.state.followZoomLevel).toBe(NAVIGATION_ZOOM);
      expect(requested.command).toBeNull();

      const firstFix = rideCameraReducer(requested.state, {
        type: "fresh-fix",
        coordinate: START,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(firstFix.state.awaitingFreshFix).toBe(false);
      expect(firstFix.command?.zoom).toBe(NAVIGATION_ZOOM);

      // MapLibre's own raw pre-style-ready default settle, forwarded
      // unconditionally, arriving before the command above has actually
      // reached the map (style not yet ready) — MapView honestly reports
      // hasAppliedCameraCommand: false for it.
      const spuriousSettle = rideCameraReducer(firstFix.state, {
        type: "follow-zoom-settled",
        zoom: 0,
        hasAppliedCameraCommand: false,
      });
      expect(spuriousSettle.state.followZoomLevel).toBe(NAVIGATION_ZOOM);
      expect(spuriousSettle.state).toBe(firstFix.state);

      const secondFix = rideCameraReducer(spuriousSettle.state, {
        type: "fresh-fix",
        coordinate: SIGNIFICANT_MOVE,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      expect(secondFix.command?.zoom).toBe(NAVIGATION_ZOOM);
    });

    it("still reconciles followZoomLevel once MapView reports the command as genuinely applied", () => {
      const requested = rideCameraReducer(INITIAL_RIDE_CAMERA_STATE, {
        type: "follow-requested",
        freshCoordinate: null,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });
      const firstFix = rideCameraReducer(requested.state, {
        type: "fresh-fix",
        coordinate: START,
        bearingContext: NEUTRAL_BEARING_CONTEXT,
      });

      // The real settle of the command actually applied, once style became
      // ready — MapLibre's own min/max clamping can shift the settled zoom
      // slightly from the commanded 16.
      const genuineSettle = rideCameraReducer(firstFix.state, {
        type: "follow-zoom-settled",
        zoom: 15.8,
        hasAppliedCameraCommand: true,
      });
      expect(genuineSettle.state.followZoomLevel).toBe(15.8);
    });
  });

  it("FOLLOW_MIN_MOVEMENT_METRES is a small, sub-GPS-accuracy threshold", () => {
    expect(FOLLOW_MIN_MOVEMENT_METRES).toBeGreaterThan(0);
    expect(FOLLOW_MIN_MOVEMENT_METRES).toBeLessThan(10);
  });

  it("INITIAL_RIDE_CAMERA_STATE.followZoomLevel defaults to NAVIGATION_ZOOM", () => {
    expect(INITIAL_RIDE_CAMERA_STATE.followZoomLevel).toBe(NAVIGATION_ZOOM);
  });
});

describe("selectTravelBearingDegrees", () => {
  const base = {
    routeTangentBearingDegrees: null as number | null,
    gpsHeadingDegrees: null as number | null,
    gpsSpeedMetresPerSecond: null as number | null,
    offRouteLevel: "on-route" as const,
    lastStableBearingDegrees: null as number | null,
  };

  it("chooses the forward route tangent for normal planned-direction travel", () => {
    expect(selectTravelBearingDegrees({ ...base, routeTangentBearingDegrees: 45 })).toBe(
      45,
    );
  });

  it("chooses the forward tangent when a usable GPS course agrees with it", () => {
    expect(
      selectTravelBearingDegrees({
        ...base,
        routeTangentBearingDegrees: 45,
        gpsHeadingDegrees: 50,
        gpsSpeedMetresPerSecond: 5,
      }),
    ).toBe(45);
  });

  it("chooses the reverse tangent when the GPS course shows reverse travel", () => {
    expect(
      selectTravelBearingDegrees({
        ...base,
        routeTangentBearingDegrees: 45,
        gpsHeadingDegrees: 228, // close to 225 = 45 + 180
        gpsSpeedMetresPerSecond: 5,
      }),
    ).toBe(225);
  });

  it("rejects a null GPS heading and uses the route tangent", () => {
    expect(
      selectTravelBearingDegrees({
        ...base,
        routeTangentBearingDegrees: 45,
        gpsHeadingDegrees: null,
        gpsSpeedMetresPerSecond: 10,
      }),
    ).toBe(45);
  });

  it("rejects a non-finite GPS heading and uses the route tangent", () => {
    expect(
      selectTravelBearingDegrees({
        ...base,
        routeTangentBearingDegrees: 45,
        gpsHeadingDegrees: Number.NaN,
        gpsSpeedMetresPerSecond: 10,
      }),
    ).toBe(45);
  });

  it("rejects a GPS heading below the minimum speed threshold and uses the route tangent", () => {
    expect(
      selectTravelBearingDegrees({
        ...base,
        routeTangentBearingDegrees: 45,
        gpsHeadingDegrees: 200,
        gpsSpeedMetresPerSecond: GPS_COURSE_MIN_SPEED_METRES_PER_SECOND - 0.1,
      }),
    ).toBe(45);
  });

  it("falls back to the GPS course when it's incompatible with both route-tangent directions", () => {
    // forward=0, reverse=180; a perpendicular GPS course (90) is equally
    // (and too far, 90 > 45) from both.
    expect(
      selectTravelBearingDegrees({
        ...base,
        routeTangentBearingDegrees: 0,
        gpsHeadingDegrees: 90,
        gpsSpeedMetresPerSecond: 5,
      }),
    ).toBe(90);
  });

  it("accepts a route tangent right at the disagreement threshold", () => {
    const gps = ROUTE_GPS_MAX_DISAGREEMENT_DEGREES;
    expect(
      selectTravelBearingDegrees({
        ...base,
        routeTangentBearingDegrees: 0,
        gpsHeadingDegrees: gps,
        gpsSpeedMetresPerSecond: 5,
      }),
    ).toBe(0);
  });

  it("strongly off-route: uses a usable GPS course, ignoring the route tangent entirely", () => {
    expect(
      selectTravelBearingDegrees({
        ...base,
        offRouteLevel: "off-route",
        routeTangentBearingDegrees: 45,
        gpsHeadingDegrees: 90,
        gpsSpeedMetresPerSecond: 5,
      }),
    ).toBe(90);
  });

  it("strongly off-route: retains the last stable bearing when GPS course isn't usable", () => {
    expect(
      selectTravelBearingDegrees({
        ...base,
        offRouteLevel: "off-route",
        routeTangentBearingDegrees: 45,
        lastStableBearingDegrees: 200,
      }),
    ).toBe(200);
  });

  it("retains the last stable bearing when stationary (no route tangent, no usable GPS course)", () => {
    expect(selectTravelBearingDegrees({ ...base, lastStableBearingDegrees: 77 })).toBe(
      77,
    );
  });

  it("returns null when there is truly no signal and no prior stable bearing", () => {
    expect(selectTravelBearingDegrees({ ...base })).toBeNull();
  });
});

describe("rotation dead band", () => {
  it("suppresses a candidate bearing change smaller than the dead band", () => {
    const state = followingState({
      lastFollowedCoordinate: START,
      lastCommandedBearingDegrees: 10,
    });
    const result = rideCameraReducer(state, {
      type: "fresh-fix",
      coordinate: SIGNIFICANT_MOVE,
      bearingContext: {
        ...NEUTRAL_BEARING_CONTEXT,
        routeTangentBearingDegrees: 10 + ROTATION_DEAD_BAND_DEGREES - 1,
      },
    });
    expect(result.command?.bearingDegrees).toBe(10);
  });

  it("accepts a candidate bearing change at or above the dead band", () => {
    const state = followingState({
      lastFollowedCoordinate: START,
      lastCommandedBearingDegrees: 10,
    });
    const result = rideCameraReducer(state, {
      type: "fresh-fix",
      coordinate: SIGNIFICANT_MOVE,
      bearingContext: {
        ...NEUTRAL_BEARING_CONTEXT,
        routeTangentBearingDegrees: 10 + ROTATION_DEAD_BAND_DEGREES,
      },
    });
    expect(result.command?.bearingDegrees).toBe(10 + ROTATION_DEAD_BAND_DEGREES);
  });

  it("handles the dead band correctly across the 0/360 boundary (359 -> 1 is a 2 degree change)", () => {
    const state = followingState({
      lastFollowedCoordinate: START,
      lastCommandedBearingDegrees: 359,
    });
    const result = rideCameraReducer(state, {
      type: "fresh-fix",
      coordinate: SIGNIFICANT_MOVE,
      bearingContext: { ...NEUTRAL_BEARING_CONTEXT, routeTangentBearingDegrees: 1 },
    });
    // 2 degrees is below the dead band, so 359 is retained, not replaced.
    expect(result.command?.bearingDegrees).toBe(359);
  });
});
