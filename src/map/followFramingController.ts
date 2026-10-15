import type { Coordinate } from "../domain/types.ts";
import {
  decideFollowAnchor,
  isDiscWholeAndClear,
  type FollowAnchorDecision,
  type HostRelativeRect,
  type VisibleRegion,
} from "./followFraming.ts";

/* Item 145: keeps the follow camera's rider inside the visible map while the
 * layout around the map changes, for the follow command currently in force
 * only. Framework-free so its timing contract is unit-testable; MapView
 * supplies the measurements, the map and the scheduler.
 *
 * The contract:
 * - Only the current follow intent is ever renewed: the latest follow
 *   command's coordinate, zoom, bearing and pitch. An anchored zoom press
 *   is itself a follow command, so the intent's zoom is always the current
 *   one. Any other camera command or a genuine gesture ends the intent
 *   (endFollow), and nothing is renewed unless the caller reports that it
 *   is following.
 * - A layout change starts a settle: the region is measured every frame,
 *   the clipped height is published at once, and a renewal is considered
 *   only after the measurement has stayed the same for SETTLE_MS. Transient
 *   layouts therefore never move the camera. The settle gives up after
 *   MAX_SETTLE_MS without easing; the next layout change starts a new one.
 * - A renewal never moves the rider into an obstruction (a conflict keeps
 *   the current framing), never restarts an ease in progress (it waits for
 *   the camera to settle), and eases again at an unchanged offset only
 *   when the rider is actually clipped or obstructed there — at most once
 *   per settled layout, so an ease can never feed back into another. */

/** The follow command a renewal re-applies. */
export interface FollowIntent {
  coordinate: Coordinate;
  zoom: number | null;
  bearingDegrees: number;
  pitchDegrees: number;
}

export interface FramingMeasurement {
  region: VisibleRegion;
  obstacles: HostRelativeRect[];
}

export interface FollowFramingDependencies {
  /** Null when the map has no measurable size. */
  measure(): FramingMeasurement | null;
  /** The rider's current host-relative screen position, or null. */
  project(coordinate: Coordinate): { x: number; y: number } | null;
  /** Whether the camera is moving, or may be about to: MapView also counts
   * a pointer held on the map, since an ease would cancel a drag MapLibre
   * has not yet recognised. */
  isMoving(): boolean;
  /** Re-applies the intent with the given follow offset. */
  ease(intent: FollowIntent, offsetPx: number): void;
  /** The canvas height hidden below by clipping ancestors, in CSS px. */
  publishClippedBottom(px: number): void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  now(): number;
}

export const FOLLOW_FRAMING_SETTLE_MS = 120;
export const FOLLOW_FRAMING_MAX_SETTLE_MS = 2000;

export interface FollowFramingController {
  /** Records a new follow command as the current intent and returns the
   * follow offset to apply, or undefined for the ordinary offset. */
  followCommand(intent: FollowIntent): number | undefined;
  /** Ends the current intent: a non-follow command or a genuine gesture. */
  endFollow(): void;
  setActive(active: boolean): void;
  layoutChanged(): void;
  /** The camera finished moving, for any reason. */
  cameraSettled(): void;
  /** Cancels scheduled work. The intent survives, so a remount in
   * development (React's double effect) loses nothing. */
  stop(): void;
}

const round = (value: number) => Math.round(value * 100) / 100;

function signatureOf(
  measurement: FramingMeasurement | null,
  decision: FollowAnchorDecision | null,
): string {
  if (!measurement || !decision) return "none";
  const { region, obstacles } = measurement;
  return JSON.stringify([
    [
      region.top,
      region.bottom,
      region.left,
      region.right,
      region.hostWidth,
      region.hostHeight,
    ].map(round),
    obstacles.map((o) => [o.left, o.top, o.right, o.bottom].map(round)),
    decision.kind,
    decision.kind === "conflict" ? null : round(decision.offsetPx),
  ]);
}

export function createFollowFramingController(
  dependencies: FollowFramingDependencies,
  ordinaryOffsetPx: number,
): FollowFramingController {
  let intent: FollowIntent | null = null;
  let appliedOffsetPx = ordinaryOffsetPx;
  let active = false;
  // The settle in progress, if any.
  let frame = 0;
  let settleStartedAt = 0;
  let stableSince = 0;
  let signature = "";
  // The decision of the last completed settle, used for a follow command
  // that arrives while the layout is still changing.
  let settledDecision: FollowAnchorDecision | null = null;
  // Each completed settle is one layout episode; a correction at an
  // unchanged offset is allowed once per episode.
  let episode = 0;
  let correctedEpisode = -1;
  // A renewal that found the camera moving waits for it to settle.
  let deferred = false;

  const decide = (measurement: FramingMeasurement | null): FollowAnchorDecision | null =>
    measurement
      ? decideFollowAnchor(measurement.region, measurement.obstacles, ordinaryOffsetPx)
      : null;

  const measureAndPublish = () => {
    const measurement = dependencies.measure();
    if (measurement) {
      dependencies.publishClippedBottom(
        Math.max(0, round(measurement.region.clippedBottom)),
      );
    }
    return measurement;
  };

  const renew = (
    measurement: FramingMeasurement | null,
    decision: FollowAnchorDecision | null,
  ) => {
    deferred = false;
    if (!intent || !active || !measurement || !decision || decision.kind === "conflict")
      return;
    if (dependencies.isMoving()) {
      deferred = true;
      return;
    }
    if (Math.abs(decision.offsetPx - appliedOffsetPx) >= 0.5) {
      appliedOffsetPx = decision.offsetPx;
      dependencies.ease(intent, decision.offsetPx);
      return;
    }
    if (correctedEpisode === episode) return;
    const rider = dependencies.project(intent.coordinate);
    if (!rider || isDiscWholeAndClear(measurement.region, measurement.obstacles, rider))
      return;
    correctedEpisode = episode;
    dependencies.ease(intent, decision.offsetPx);
  };

  const tick = () => {
    frame = 0;
    const measurement = measureAndPublish();
    const decision = decide(measurement);
    const next = signatureOf(measurement, decision);
    const now = dependencies.now();
    if (next !== signature) {
      signature = next;
      stableSince = now;
    }
    if (now - stableSince >= FOLLOW_FRAMING_SETTLE_MS) {
      episode += 1;
      settledDecision = decision;
      renew(measurement, decision);
      return;
    }
    if (now - settleStartedAt >= FOLLOW_FRAMING_MAX_SETTLE_MS) return;
    frame = dependencies.requestFrame(tick);
  };

  const cancelSettle = () => {
    if (frame) dependencies.cancelFrame(frame);
    frame = 0;
  };

  return {
    followCommand(next) {
      intent = next;
      deferred = false;
      let decision: FollowAnchorDecision | null;
      if (frame) {
        // The layout is still changing: keep to the last settled decision
        // and let the settle renew once it is stable.
        decision = settledDecision;
      } else {
        decision = decide(measureAndPublish());
        settledDecision = decision;
      }
      if (decision && decision.kind !== "conflict") appliedOffsetPx = decision.offsetPx;
      else if (!decision) appliedOffsetPx = ordinaryOffsetPx;
      return Math.abs(appliedOffsetPx - ordinaryOffsetPx) < 0.005
        ? undefined
        : appliedOffsetPx;
    },
    endFollow() {
      intent = null;
      deferred = false;
      appliedOffsetPx = ordinaryOffsetPx;
    },
    setActive(next) {
      active = next;
      if (!active) deferred = false;
    },
    layoutChanged() {
      if (frame) return;
      settleStartedAt = dependencies.now();
      stableSince = settleStartedAt;
      signature = "";
      frame = dependencies.requestFrame(tick);
    },
    cameraSettled() {
      if (!deferred || frame) return;
      const measurement = measureAndPublish();
      renew(measurement, decide(measurement));
    },
    stop() {
      cancelSettle();
      deferred = false;
    },
  };
}
