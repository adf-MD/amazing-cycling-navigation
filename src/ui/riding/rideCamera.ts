import type { Coordinate } from "../../domain/types.ts";
import { haversineDistanceMetres } from "../../navigation/distance.ts";
import {
  normaliseBearingDegrees,
  shortestAngularDifferenceDegrees,
} from "../../navigation/bearing.ts";
import type { OffRouteLevel, RideCameraMode } from "../../navigation/types.ts";

export type { RideCameraMode };

/** Stable navigation zoom while following, chosen to match the existing
 * fitBounds `maxZoom` cap already used for the route-overview framing
 * (src/map/mapAdapter.ts), so following doesn't zoom further than the
 * overview ever would. Declared before RideCameraState/
 * INITIAL_RIDE_CAMERA_STATE below, which now depend on it directly for
 * followZoomLevel's default. */
export const NAVIGATION_ZOOM = 16;

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
  /** The last bearing actually committed to a following command. Doubles
   * as both the rotation dead-band comparison baseline and the "retain
   * last stable bearing" fallback fed into bearing selection. Cleared at
   * every point lastFollowedCoordinate is also cleared, so a brand-new
   * following session never anchors its first command's dead-band check
   * to a stale bearing left over from an earlier session. */
  lastCommandedBearingDegrees: number | null;
  /** The zoom level to use for the next following camera command — the
   * default NAVIGATION_ZOOM, a value chosen via the zoom controls, or
   * (once reconciled) the real settled zoom after MapLibre's own min/max
   * clamping (see the "follow-zoom-settled" event below). Persists across
   * a temporary departure from "following" (a manual gesture or
   * north-up) within the same mounted session — only route-opened or a
   * full session reset return it to NAVIGATION_ZOOM. */
  followZoomLevel: number;
}

export const INITIAL_RIDE_CAMERA_STATE: RideCameraState = {
  mode: "overview",
  awaitingFreshFix: false,
  lastFollowedCoordinate: null,
  lastCommandedBearingDegrees: null,
  followZoomLevel: NAVIGATION_ZOOM,
};

/** A camera move for MapView to actually execute. `animate: true` is a
 * live "following" ease (with the rider kept below vertical centre);
 * `animate: false` is an instant restore jump to a previously free-panned
 * position, with no following bias. */
export interface RideCameraCommand {
  /** null leaves the map's current centre unchanged — used only by the
   * north-up/top-down reset, which reorients without recentring. */
  coordinate: Coordinate | null;
  /** null leaves the map's current zoom unchanged — see coordinate. */
  zoom: number | null;
  /** Always concrete and normalised into [0, 360). */
  bearingDegrees: number;
  /** Always concrete: 0 (overview/restore-default/north-up) or
   * FOLLOW_PITCH_DEGREES (actively following). */
  pitchDegrees: number;
  animate: boolean;
  /** True only for a live GPS-follow ease — biases the rider below
   * vertical centre so more of the road ahead stays visible under the
   * follow pitch. False for a restore jump and the north-up/top-down
   * reset: a restored free camera can carry its own manually-set nonzero
   * pitch, which must never get a following-style offset bias. */
  followOffset: boolean;
  /** Present only for an explicit Northwards or Follow-location press, or
   * an explicit anchored zoom press while genuinely following (backlog
   * item 65 — see hasActionableFollowAnchor and the "follow-zoom-changed"
   * event below) — copied verbatim from the triggering event so MapView
   * can dedupe this command by identity instead of value (see
   * MapView.tsx's CameraTarget: without this, a repeated press producing
   * byte-identical values after an intervening manual gesture is
   * silently swallowed). Always undefined for an automatic fresh-fix
   * update, a one-time restore jump, or an unanchored zoom press (not
   * genuinely following, or awaiting the first fix), all of which stay
   * purely value-deduped. Transient UI identity — never persisted (see
   * StoredCameraState). */
  requestId?: string;
}

/** Everything the bearing-selection policy needs, pre-derived by
 * useRideCamera.ts from the current fix and route-matching state — the
 * pure reducer never touches raw route geometry or GeolocationFix. */
export interface BearingContext {
  headingDegrees: number | null;
  speedMetresPerSecond: number | null;
  routeTangentBearingDegrees: number | null;
  offRouteLevel: OffRouteLevel;
}

export type RideCameraEvent =
  | { type: "route-opened" }
  | {
      type: "follow-requested";
      freshCoordinate: Coordinate | null;
      bearingContext: BearingContext;
      /** See RideCameraCommand's own requestId doc comment — copied
       * verbatim into the produced command, if any. */
      requestId?: string;
    }
  | { type: "fresh-fix"; coordinate: Coordinate; bearingContext: BearingContext }
  | { type: "user-interaction" }
  | { type: "north-up-requested"; requestId?: string }
  | {
      type: "restore";
      mode: RideCameraMode;
      coordinate: Coordinate | null;
      zoom: number | null;
      bearingDegrees: number;
      pitchDegrees: number;
    }
  /** Dispatched by the zoom controls (backlog item 53) — always updates
   * followZoomLevel unconditionally regardless of current mode (not
   * gated on "following"), the simplest, most predictable behaviour, and
   * the best continuity if the rider zooms while free-panning then
   * re-engages Follow. Never changes mode/awaitingFreshFix/
   * lastFollowedCoordinate/lastCommandedBearingDegrees.
   *
   * Backlog item 65: while genuinely following with an actionable anchor
   * (hasActionableFollowAnchor below — a real, already-committed
   * coordinate/bearing pair, never merely "mode is following", which
   * also covers the pending state while awaiting the very first fresh
   * fix) this ALSO produces a real command: the same coordinate/bearing/
   * pitch already committed to the last following command, reissued at
   * the new zoom via followCommand — reusing MapLibre's own offset-aware
   * setCamera ease so the rider's screen anchor (below vertical centre)
   * is preserved through the zoom, rather than the ordinary
   * zoomTarget/changeZoomBy path's true-centre-relative zoom (a fixed
   * pixel offset corresponds to a different geographic distance at each
   * zoom level, so holding the map's own true-centre point fixed instead
   * visibly drifts the rider's real position on screen). When NOT
   * actionable (free/overview mode, or following but still awaiting the
   * first fix — there is nothing yet to honestly anchor to), this
   * produces no command, exactly as before item 65:
   * useRideCamera.ts's/useFreeRoamCamera.ts's requestZoom instead falls
   * back to the ordinary, unanchored zoomTarget/changeZoomBy path for
   * that press. The two paths are mutually exclusive per press —
   * requestZoom decides which one to use BEFORE dispatching (dispatch
   * has no synchronous return value to branch on afterwards), via this
   * exact same hasActionableFollowAnchor check against its own
   * latest-camera-state ref, so a genuinely followed zoom is never both
   * anchored (setCamera) AND unanchored (changeZoomBy) for the same
   * button press. */
  | { type: "follow-zoom-changed"; delta: number; requestId?: string }
  /** Dispatched only from the hook's camera-settled handling (never from
   * a button) to reconcile followZoomLevel with MapLibre's real settled
   * zoom, including its own min/max clamping. Deliberately a no-op unless
   * genuinely following with an already-issued command (mode ===
   * "following" && !awaitingFreshFix) — see the reducer's own case for
   * why the awaitingFreshFix guard is essential, not optional.
   *
   * Backlog item 74: hasAppliedCameraCommand (from MapView's own
   * onCameraSettled payload) is a second, independent guard alongside
   * awaitingFreshFix, not a replacement for it. awaitingFreshFix answers
   * "have we dispatched a fresh-fix event yet" (reducer-internal);
   * hasAppliedCameraCommand answers "has MapView's own cameraTarget effect
   * actually called setCamera yet" (MapView-internal, gated on style
   * readiness the reducer has no visibility into). A settle can arrive
   * with awaitingFreshFix already false (the fresh-fix event has been
   * dispatched and produced a real command) while the command has not yet
   * reached the map at all — confirmed reproducible: MapLibre fires its
   * own internal pre-style-ready moveend at its raw default transform
   * (see MapView.tsx's onCameraSettled registration), and without this
   * guard that unrelated settle is indistinguishable from a genuine
   * settle of the command just issued. */
  | { type: "follow-zoom-settled"; zoom: number; hasAppliedCameraCommand: boolean };

export interface RideCameraTransition {
  state: RideCameraState;
  /** Non-null only when the camera should actually move this tick. */
  command: RideCameraCommand | null;
  /** True only for a transition away from an active or pending following
   * state — nothing to "pause" leaving overview, and pressing north-up
   * while already free doesn't pause anything either. */
  pausedToast: boolean;
}

/** Fixes within this distance of the last-followed coordinate are treated
 * as GPS noise or a stationary rider, not real movement — below typical
 * phone GPS accuracy (commonly 3-10m), so smaller deltas are unlikely to
 * be genuine motion. This is the sole jitter-suppression mechanism: a
 * single deterministic movement threshold, not a second time-based
 * throttle. */
export const FOLLOW_MIN_MOVEMENT_METRES = 3;

/** Modest third-person navigation tilt applied while actively following —
 * a starting value to verify visually on a 320px-high iPhone map, per the
 * implementation brief, not a value derived from anything else. */
export const FOLLOW_PITCH_DEGREES = 35;

/** A GPS course-over-ground reading is only trusted at or above this
 * speed — below it, phone GPS heading is typically noisy or stale (many
 * devices don't update heading meaningfully while slow/stationary). */
export const GPS_COURSE_MIN_SPEED_METRES_PER_SECOND = 2.5; // ~9 km/h

/** Beyond this disagreement between the route's own tangent direction and
 * a usable GPS course, the route tangent is treated as implausible (e.g. a
 * wide junction, or the rider cutting a corner) and the GPS course is used
 * instead. Forward and reverse route tangent are always exactly 180° apart,
 * so the closer of the two to any GPS course is, by construction, always
 * within 90° of it — a threshold at or above 90° would therefore never
 * reject anything, so this must be meaningfully tighter than 90° to act as
 * a real filter. 45° is a generous but genuine one. */
export const ROUTE_GPS_MAX_DISAGREEMENT_DEGREES = 45;

/** Candidate bearing changes smaller than this are treated as noise and
 * suppressed, so the camera doesn't visibly jitter for insignificant
 * heading fluctuations. */
export const ROTATION_DEAD_BAND_DEGREES = 8;

const NO_COMMAND: RideCameraTransition["command"] = null;

function followCommand(
  coordinate: Coordinate,
  bearingDegrees: number,
  zoomLevel: number,
): RideCameraCommand {
  return {
    coordinate,
    zoom: zoomLevel,
    bearingDegrees,
    pitchDegrees: FOLLOW_PITCH_DEGREES,
    animate: true,
    followOffset: true,
  };
}

/** True only once a live following session has a real, already-committed
 * coordinate/bearing pair to reissue an unrelated camera parameter
 * (e.g. a zoom-only change, backlog item 65) against — never merely
 * "mode is following", which also covers the pending state while
 * awaiting the very first fresh fix, where there is nothing yet to
 * honestly anchor to. A type predicate so a caller narrows
 * lastFollowedCoordinate/lastCommandedBearingDegrees to non-null for
 * free, without a non-null assertion. Exported and shared by exactly two
 * call sites that must never drift apart: the reducer's own
 * "follow-zoom-changed" case below, and useRideCamera.ts's/
 * useFreeRoamCamera.ts's requestZoom, which must decide — before
 * dispatching, since dispatch has no synchronous return value — whether
 * a zoom press will produce a real anchored command or fall back to the
 * ordinary unanchored zoom path, so the two can never both fire for the
 * same press. */
export function hasActionableFollowAnchor(
  state: RideCameraState,
): state is RideCameraState & {
  lastFollowedCoordinate: Coordinate;
  lastCommandedBearingDegrees: number;
} {
  return (
    state.mode === "following" &&
    !state.awaitingFreshFix &&
    state.lastFollowedCoordinate !== null &&
    state.lastCommandedBearingDegrees !== null
  );
}

/**
 * Decides which bearing the riding camera should point towards, given a
 * route tangent, a possibly-usable GPS course, the rider's current
 * off-route level, and the last stable bearing to fall back on. Pure and
 * independently testable — see rideCamera.test.ts's dedicated
 * `describe("selectTravelBearingDegrees", ...)` block. Returns null only
 * when there is no signal to derive a bearing from AND no prior stable
 * bearing to retain — callers apply a north/0 default in exactly that
 * case ("use north-up only if no stable direction can be derived").
 */
export function selectTravelBearingDegrees(input: {
  routeTangentBearingDegrees: number | null;
  gpsHeadingDegrees: number | null;
  gpsSpeedMetresPerSecond: number | null;
  offRouteLevel: OffRouteLevel;
  lastStableBearingDegrees: number | null;
}): number | null {
  const gpsCourse =
    input.gpsHeadingDegrees !== null &&
    Number.isFinite(input.gpsHeadingDegrees) &&
    input.gpsSpeedMetresPerSecond !== null &&
    input.gpsSpeedMetresPerSecond >= GPS_COURSE_MIN_SPEED_METRES_PER_SECOND
      ? normaliseBearingDegrees(input.gpsHeadingDegrees)
      : null;

  if (input.offRouteLevel === "off-route") {
    // Strongly off-route: never rotate towards the planned route's own
    // direction, only ever a genuinely usable GPS course, or retain.
    return gpsCourse ?? input.lastStableBearingDegrees;
  }

  if (input.routeTangentBearingDegrees !== null) {
    const forward = input.routeTangentBearingDegrees;
    const reverse = normaliseBearingDegrees(forward + 180);
    if (gpsCourse !== null) {
      const forwardDiff = Math.abs(shortestAngularDifferenceDegrees(forward, gpsCourse));
      const reverseDiff = Math.abs(shortestAngularDifferenceDegrees(reverse, gpsCourse));
      const [closest, closestDiff] =
        forwardDiff <= reverseDiff ? [forward, forwardDiff] : [reverse, reverseDiff];
      return closestDiff <= ROUTE_GPS_MAX_DISAGREEMENT_DEGREES ? closest : gpsCourse;
    }
    // No usable GPS course to confirm direction — default to the planned
    // forward direction rather than guessing.
    return forward;
  }

  return gpsCourse ?? input.lastStableBearingDegrees;
}

/** Resolves the bearing a following command should carry, applying the
 * rotation dead band on top of selectTravelBearingDegrees so insignificant
 * candidate changes don't retrigger a rotation. */
function resolveCommandedBearingDegrees(
  state: RideCameraState,
  bearingContext: BearingContext,
): number {
  const candidate =
    selectTravelBearingDegrees({
      routeTangentBearingDegrees: bearingContext.routeTangentBearingDegrees,
      gpsHeadingDegrees: bearingContext.headingDegrees,
      gpsSpeedMetresPerSecond: bearingContext.speedMetresPerSecond,
      offRouteLevel: bearingContext.offRouteLevel,
      lastStableBearingDegrees: state.lastCommandedBearingDegrees,
    }) ?? 0;

  if (state.lastCommandedBearingDegrees === null) {
    // First command of a fresh following session: always accept whatever
    // was resolved, never dead-banded against a nonexistent baseline.
    return candidate;
  }

  const change = Math.abs(
    shortestAngularDifferenceDegrees(state.lastCommandedBearingDegrees, candidate),
  );
  return change < ROTATION_DEAD_BAND_DEGREES
    ? state.lastCommandedBearingDegrees
    : candidate;
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
        state: {
          mode: "free",
          awaitingFreshFix: false,
          lastFollowedCoordinate: null,
          lastCommandedBearingDegrees: null,
          followZoomLevel: state.followZoomLevel,
        },
        command: NO_COMMAND,
        pausedToast: wasFollowing,
      };
    }

    case "north-up-requested": {
      const wasFollowing = state.mode === "following";
      return {
        state: {
          mode: "free",
          awaitingFreshFix: false,
          lastFollowedCoordinate: null,
          lastCommandedBearingDegrees: null,
          followZoomLevel: state.followZoomLevel,
        },
        command: {
          coordinate: null,
          zoom: null,
          bearingDegrees: 0,
          pitchDegrees: 0,
          animate: true,
          followOffset: false,
          requestId: event.requestId,
        },
        pausedToast: wasFollowing,
      };
    }

    case "follow-requested": {
      if (event.freshCoordinate) {
        const bearingDegrees = resolveCommandedBearingDegrees(
          state,
          event.bearingContext,
        );
        return {
          state: {
            mode: "following",
            awaitingFreshFix: false,
            lastFollowedCoordinate: event.freshCoordinate,
            lastCommandedBearingDegrees: bearingDegrees,
            followZoomLevel: state.followZoomLevel,
          },
          command: {
            ...followCommand(
              event.freshCoordinate,
              bearingDegrees,
              state.followZoomLevel,
            ),
            requestId: event.requestId,
          },
          pausedToast: false,
        };
      }
      return {
        state: {
          mode: "following",
          awaitingFreshFix: true,
          lastFollowedCoordinate: null,
          lastCommandedBearingDegrees: null,
          followZoomLevel: state.followZoomLevel,
        },
        command: NO_COMMAND,
        pausedToast: false,
      };
    }

    case "fresh-fix": {
      if (state.mode !== "following") {
        return { state, command: NO_COMMAND, pausedToast: false };
      }

      const positionChanged =
        state.awaitingFreshFix ||
        !state.lastFollowedCoordinate ||
        haversineDistanceMetres(state.lastFollowedCoordinate, event.coordinate) >=
          FOLLOW_MIN_MOVEMENT_METRES;

      const bearingDegrees = resolveCommandedBearingDegrees(state, event.bearingContext);
      const bearingChanged =
        state.lastCommandedBearingDegrees === null ||
        bearingDegrees !== state.lastCommandedBearingDegrees;

      if (!positionChanged && !bearingChanged) {
        // Insignificant movement and insignificant bearing change (GPS
        // noise or a stationary rider) — no command, so the camera
        // doesn't jitter.
        return { state, command: NO_COMMAND, pausedToast: false };
      }

      const coordinate = positionChanged
        ? event.coordinate
        : (state.lastFollowedCoordinate ?? event.coordinate);

      return {
        state: {
          mode: "following",
          awaitingFreshFix: false,
          lastFollowedCoordinate: coordinate,
          lastCommandedBearingDegrees: bearingDegrees,
          followZoomLevel: state.followZoomLevel,
        },
        command: followCommand(coordinate, bearingDegrees, state.followZoomLevel),
        pausedToast: false,
      };
    }

    case "restore": {
      if (event.mode === "free") {
        return {
          state: {
            mode: "free",
            awaitingFreshFix: false,
            lastFollowedCoordinate: null,
            lastCommandedBearingDegrees: null,
            // No meaningful prior follow zoom to restore into free mode —
            // only a "following" restore below carries a real one.
            followZoomLevel: NAVIGATION_ZOOM,
          },
          command:
            event.coordinate && event.zoom !== null
              ? {
                  coordinate: event.coordinate,
                  zoom: event.zoom,
                  bearingDegrees: event.bearingDegrees,
                  pitchDegrees: event.pitchDegrees,
                  animate: false,
                  followOffset: false,
                }
              : NO_COMMAND,
          pausedToast: false,
        };
      }
      if (event.mode === "following") {
        const restoredFollowZoom =
          event.zoom !== null && Number.isFinite(event.zoom)
            ? event.zoom
            : NAVIGATION_ZOOM;
        return {
          state: {
            mode: "following",
            awaitingFreshFix: true,
            lastFollowedCoordinate: null,
            lastCommandedBearingDegrees: null,
            followZoomLevel: restoredFollowZoom,
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

    case "follow-zoom-changed": {
      const followZoomLevel = state.followZoomLevel + event.delta;
      if (!hasActionableFollowAnchor(state)) {
        return {
          state: { ...state, followZoomLevel },
          command: NO_COMMAND,
          pausedToast: false,
        };
      }
      return {
        state: { ...state, followZoomLevel },
        command: {
          ...followCommand(
            state.lastFollowedCoordinate,
            state.lastCommandedBearingDegrees,
            followZoomLevel,
          ),
          requestId: event.requestId,
        },
        pausedToast: false,
      };
    }

    case "follow-zoom-settled": {
      if (
        state.mode !== "following" ||
        state.awaitingFreshFix ||
        !event.hasAppliedCameraCommand ||
        state.followZoomLevel === event.zoom
      ) {
        // Reference-stable no-op: either there's no genuinely active
        // following command yet to reconcile against (a stray settle from
        // MapView's own unrelated overview-fit, or a restore still
        // awaiting its first fresh fix, must never overwrite a just-
        // restored/chosen zoom — see this event's own doc comment), or
        // MapView has not actually applied any command yet (backlog item
        // 74 — awaitingFreshFix alone cannot detect this: it can already
        // be false, with a real command issued, while that command has
        // not yet reached the map), or the settled zoom already matches,
        // so nothing has changed.
        return { state, command: NO_COMMAND, pausedToast: false };
      }
      return {
        state: { ...state, followZoomLevel: event.zoom },
        command: NO_COMMAND,
        pausedToast: false,
      };
    }
  }
}
