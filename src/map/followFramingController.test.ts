import { describe, expect, it } from "vitest";
import type { HostRelativeRect, VisibleRegion } from "./followFraming.ts";
import {
  createFollowFramingController,
  FOLLOW_FRAMING_MAX_SETTLE_MS,
  FOLLOW_FRAMING_SETTLE_MS,
  type FollowIntent,
  type FramingMeasurement,
} from "./followFramingController.ts";

const ORDINARY_OFFSET_PX = 60;
const FRAME_MS = 16;

const INTENT: FollowIntent = {
  coordinate: [-0.08, 51.5],
  zoom: 16.5,
  bearingDegrees: 90,
  pitchDegrees: 35,
};

/** A 288 px wide canvas host `height` tall, `visible` of it visible, with the
 * attribution 8 px above the visible bottom across the rider's column. */
function measurement(height: number, visible = height): FramingMeasurement {
  const region: VisibleRegion = {
    left: 0,
    top: 0,
    right: 288,
    bottom: visible,
    hostWidth: 288,
    hostHeight: height,
    clippedBottom: height - visible,
  };
  const attribution: HostRelativeRect = {
    left: 8,
    top: visible - 8 - 18.56,
    right: 170,
    bottom: visible - 8,
  };
  return { region, obstacles: [attribution] };
}

/** The controller with fake frames, clock, map and layout. `ease` records
 * only application-triggered framing: the map's own resize or move events
 * never reach it. */
function harness() {
  let time = 0;
  let nextFrame = 1;
  const frames = new Map<number, () => void>();
  const eases: { intent: FollowIntent; offsetPx: number }[] = [];
  const published: number[] = [];
  const state = {
    measurement: measurement(305) as FramingMeasurement | null,
    rider: null as { x: number; y: number } | null,
    moving: false,
  };
  const controller = createFollowFramingController(
    {
      measure: () => state.measurement,
      project: () => state.rider,
      isMoving: () => state.moving,
      ease: (intent, offsetPx) => eases.push({ intent, offsetPx }),
      publishClippedBottom: (px) => published.push(px),
      requestFrame: (callback) => {
        const handle = nextFrame;
        nextFrame += 1;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => {
        frames.delete(handle);
      },
      now: () => time,
    },
    ORDINARY_OFFSET_PX,
  );
  /** Advances the clock frame by frame for `ms`, running pending frames. */
  const run = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
      time += FRAME_MS;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    }
  };
  /** A layout change that the observers report, then settles. */
  const change = (next: FramingMeasurement) => {
    state.measurement = next;
    controller.layoutChanged();
    run(FOLLOW_FRAMING_SETTLE_MS + 4 * FRAME_MS);
  };
  return { controller, state, eases, published, frames, run, change };
}

/** Following on an ordinary 305 px map, with the rider at its anchor. */
function following() {
  const h = harness();
  h.controller.setActive(true);
  expect(h.controller.followCommand(INTENT)).toBeUndefined();
  h.state.rider = { x: 144, y: 152.5 + ORDINARY_OFFSET_PX };
  return h;
}

describe("createFollowFramingController", () => {
  it("returns no explicit offset for an unclipped, unobstructed map, so the ordinary ease is unchanged", () => {
    const h = harness();
    h.controller.setActive(true);
    expect(h.controller.followCommand(INTENT)).toBeUndefined();
  });

  it("returns the corrected offset for a follow command when the attribution covers the ordinary anchor", () => {
    const h = harness();
    h.state.measurement = measurement(180);
    h.controller.setActive(true);
    const offset = h.controller.followCommand(INTENT);
    expect(offset).toBeDefined();
    expect(offset).toBeLessThan(ORDINARY_OFFSET_PX);
  });

  it("renews the current intent once, after the layout has been stable for the settle time", () => {
    const h = following();
    h.state.measurement = measurement(180);
    h.controller.layoutChanged();
    h.run(FOLLOW_FRAMING_SETTLE_MS - 2 * FRAME_MS);
    expect(h.eases).toEqual([]);
    h.run(4 * FRAME_MS);
    expect(h.eases).toHaveLength(1);
    expect(h.eases[0]?.intent).toEqual(INTENT);
    expect(h.eases[0]?.offsetPx).toBeLessThan(ORDINARY_OFFSET_PX);
    // Nothing further while the layout stays the same.
    h.run(1000);
    expect(h.eases).toHaveLength(1);
  });

  it("publishes the clipped height on every frame of a settle, before any renewal", () => {
    const h = following();
    h.state.measurement = measurement(160, 128);
    h.controller.layoutChanged();
    h.run(FRAME_MS);
    expect(h.published.at(-1)).toBe(32);
    expect(h.eases).toEqual([]);
  });

  it("never eases into a layout that keeps changing, stops after the cap, and settles a later change normally", () => {
    const h = following();
    h.controller.layoutChanged();
    for (
      let elapsed = 0;
      elapsed < FOLLOW_FRAMING_MAX_SETTLE_MS + 200;
      elapsed += FRAME_MS
    ) {
      // A different height every frame: never stable.
      h.state.measurement = measurement(180 + ((elapsed / FRAME_MS) % 2));
      h.run(FRAME_MS);
    }
    expect(h.eases).toEqual([]);
    expect(h.frames.size).toBe(0);
    h.change(measurement(180));
    expect(h.eases).toHaveLength(1);
  });

  it("renews nothing for an ended intent, and a gesture during a settle cancels the pending renewal", () => {
    const h = following();
    h.state.measurement = measurement(180);
    h.controller.layoutChanged();
    h.run(2 * FRAME_MS);
    h.controller.endFollow();
    h.run(FOLLOW_FRAMING_SETTLE_MS * 3);
    expect(h.eases).toEqual([]);
    h.change(measurement(160, 128));
    expect(h.eases).toEqual([]);
  });

  it("renews nothing while the caller is not following", () => {
    const h = following();
    h.controller.setActive(false);
    h.change(measurement(180));
    expect(h.eases).toEqual([]);
  });

  it("keeps the current framing in a conflict, such as End's confirmation leaving no visible map", () => {
    const h = following();
    h.change(measurement(160, 0));
    expect(h.eases).toEqual([]);
    // Cancelled: the decision equals the framing already applied.
    h.change(measurement(305));
    expect(h.eases).toEqual([]);
  });

  it("never restarts an ease in progress: a renewal waits for the camera to settle", () => {
    const h = following();
    h.state.moving = true;
    h.change(measurement(180));
    expect(h.eases).toEqual([]);
    h.controller.cameraSettled();
    expect(h.eases).toEqual([]);
    h.state.moving = false;
    h.controller.cameraSettled();
    expect(h.eases).toHaveLength(1);
    h.controller.cameraSettled();
    expect(h.eases).toHaveLength(1);
  });

  it("leaves a whole and clear rider alone at an unchanged offset, even slightly off its preferred point", () => {
    const h = following();
    h.state.measurement = measurement(201);
    h.state.rider = { x: 144, y: 100.5 + ORDINARY_OFFSET_PX - 1.67 };
    h.change(measurement(201));
    expect(h.eases).toEqual([]);
  });

  it("corrects a rider that drifted under an overlay at an unchanged offset, once per settled layout", () => {
    const h = following();
    // 201 px: the ordinary anchor is still decided, but the tilted camera
    // left the rider 2.99 px low, 2.06 px under the attribution.
    h.state.rider = { x: 144, y: 100.5 + ORDINARY_OFFSET_PX + 2.99 };
    h.change(measurement(201));
    expect(h.eases).toHaveLength(1);
    expect(h.eases[0]?.offsetPx).toBeCloseTo(ORDINARY_OFFSET_PX, 9);
    // The same layout never corrects again, whatever the projection says.
    h.controller.cameraSettled();
    h.run(1000);
    expect(h.eases).toHaveLength(1);
  });

  it("corrects again after a later shrink, recovery and shrink with no new fix", () => {
    const h = following();
    h.state.rider = { x: 144, y: 100.5 + ORDINARY_OFFSET_PX + 2.99 };
    h.change(measurement(201));
    expect(h.eases).toHaveLength(1);
    h.state.rider = { x: 144, y: 126.5 + ORDINARY_OFFSET_PX + 1.15 };
    h.change(measurement(253));
    expect(h.eases).toHaveLength(1);
    h.state.rider = { x: 144, y: 100.5 + ORDINARY_OFFSET_PX + 2.99 };
    h.change(measurement(201));
    expect(h.eases).toHaveLength(2);
  });

  it("gives a follow command during a settle the last settled decision, and renews once the layout is stable", () => {
    const h = following();
    h.state.measurement = measurement(70);
    h.controller.layoutChanged();
    h.run(2 * FRAME_MS);
    // A transient 70 px layout (ride start in Chromium) does not decide the
    // command's offset.
    expect(h.controller.followCommand(INTENT)).toBeUndefined();
    h.state.measurement = measurement(305);
    h.run(FOLLOW_FRAMING_SETTLE_MS + 4 * FRAME_MS);
    expect(h.eases).toEqual([]);
  });

  it("stop cancels scheduled work and keeps the intent for a later layout change", () => {
    const h = following();
    h.state.measurement = measurement(180);
    h.controller.layoutChanged();
    h.controller.stop();
    expect(h.frames.size).toBe(0);
    h.run(500);
    expect(h.eases).toEqual([]);
    h.change(measurement(180));
    expect(h.eases).toHaveLength(1);
  });
});
