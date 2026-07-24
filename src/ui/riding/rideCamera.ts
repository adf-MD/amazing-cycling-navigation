import type { Coordinate } from "../../domain/types.ts";
import { haversineDistanceMetres } from "../../navigation/distance.ts";
import type { RideCameraMode } from "../../navigation/types.ts";

export type { RideCameraMode };

export interface RideCameraState {
  mode: RideCameraMode;
  /** True only while mode is "following" but no fresh fix has been eased
   * to yet — e.g. following was just requested, or resumed after
   * suspension with only a stale fix available. */
  awaitingFreshFix: boolean;
  /** The last coordinate actually eased to, used for the movement
   * threshold so GPS noise and repeated stationary fixes don't retrigger
   * the camera. Cleared whenever mode leaves "following". */
  lastFollowedCoordinate: Coordinate | null;
}

export const INITIAL_RIDE_CAMERA_STATE: RideCameraState = {
  mode: "overview",
  awaitingFreshFix: false,
  lastFollowedCoordinate: null,
};

/** A camera move for MapView to actually execute. `animate: true` is a
 * live "following" ease (with the rider kept below vertical centre);
 * `animate: false` is an instant restore jump to a previously free-panned
 * position, with no following bias. */
export interface RideCameraCommand {
  coordinate: Coordinate;
  zoom: number;
  animate: boolean;
}

export type RideCameraEvent =
  | { type: "route-opened" }
  | { type: "follow-requested"; freshCoordinate: Coordinate | null }
  | { type: "fresh-fix"; coordinate: Coordinate }
  | { type: "user-interaction" }
  | {
      type: "restore";
      mode: RideCameraMode;
      coordinate: Coordinate | null;
      zoom: number | null;
    };

export interface RideCameraTransition {
  state: RideCameraState;
  /** Non-null only when the camera should actually move this tick. */
  command: RideCameraCommand | null;
  /** True only for a "user-interaction" transition away from an active
   * or pending following state — nothing to "pause" leaving overview. */
  pausedToast: boolean;
}

/** Stable navigation zoom while following, chosen to match the existing
 * fitBounds `maxZoom` cap already used for the route-overview framing
 * (src/map/mapAdapter.ts), so following doesn't zoom further than the
 * overview ever would. */
export const NAVIGATION_ZOOM = 16;

/** Fixes within this distance of the last-followed coordinate are treated
 * as GPS noise or a stationary rider, not real movement — below typical
 * phone GPS accuracy (commonly 3-10m), so smaller deltas are unlikely to
 * be genuine motion. This is the sole jitter-suppression mechanism: a
 * single deterministic movement threshold, not a second time-based
 * throttle. */
export const FOLLOW_MIN_MOVEMENT_METRES = 3;

const NO_COMMAND: RideCameraTransition["command"] = null;

function followCommand(coordinate: Coordinate): RideCameraCommand {
  return { coordinate, zoom: NAVIGATION_ZOOM, animate: true };
}

/**
 * Pure decision core for the riding camera. No I/O, no timers, no
 * MapLibre — see useRideCamera.ts for the React/adapter wiring. Every
 * transition is exercised directly in rideCamera.test.ts.
 */
export function rideCameraReducer(
  state: RideCameraState,
  event: RideCameraEvent,
): RideCameraTransition {
  switch (event.type) {
    case "route-opened":
      return {
        state: INITIAL_RIDE_CAMERA_STATE,
        command: NO_COMMAND,
        pausedToast: false,
      };

    case "user-interaction": {
      if (state.mode === "free") {
        return { state, command: NO_COMMAND, pausedToast: false };
      }
      const wasFollowing = state.mode === "following";
      return {
        state: { mode: "free", awaitingFreshFix: false, lastFollowedCoordinate: null },
        command: NO_COMMAND,
        pausedToast: wasFollowing,
      };
    }

    case "follow-requested": {
      if (event.freshCoordinate) {
        return {
          state: {
            mode: "following",
            awaitingFreshFix: false,
            lastFollowedCoordinate: event.freshCoordinate,
          },
          command: followCommand(event.freshCoordinate),
          pausedToast: false,
        };
      }
      return {
        state: {
          mode: "following",
          awaitingFreshFix: true,
          lastFollowedCoordinate: null,
        },
        command: NO_COMMAND,
        pausedToast: false,
      };
    }

    case "fresh-fix": {
      if (state.mode !== "following") {
        return { state, command: NO_COMMAND, pausedToast: false };
      }
      if (
        !state.awaitingFreshFix &&
        state.lastFollowedCoordinate &&
        haversineDistanceMetres(state.lastFollowedCoordinate, event.coordinate) <
          FOLLOW_MIN_MOVEMENT_METRES
      ) {
        // Insignificant movement (GPS noise or a stationary rider) — no
        // command, so the camera doesn't jitter.
        return { state, command: NO_COMMAND, pausedToast: false };
      }
      return {
        state: {
          mode: "following",
          awaitingFreshFix: false,
          lastFollowedCoordinate: event.coordinate,
        },
        command: followCommand(event.coordinate),
        pausedToast: false,
      };
    }

    case "restore": {
      if (event.mode === "free") {
        return {
          state: { mode: "free", awaitingFreshFix: false, lastFollowedCoordinate: null },
          command:
            event.coordinate && event.zoom !== null
              ? { coordinate: event.coordinate, zoom: event.zoom, animate: false }
              : NO_COMMAND,
          pausedToast: false,
        };
      }
      if (event.mode === "following") {
        return {
          state: {
            mode: "following",
            awaitingFreshFix: true,
            lastFollowedCoordinate: null,
          },
          command: NO_COMMAND,
          pausedToast: false,
        };
      }
      return {
        state: INITIAL_RIDE_CAMERA_STATE,
        command: NO_COMMAND,
        pausedToast: false,
      };
    }
  }
}
