import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideFollowAnchor,
  FOLLOW_FRAMING_CLEARANCE_PX,
  FOLLOW_FRAMING_DISC_RADIUS_PX,
  isDiscWholeAndClear,
  measureVisibleRegion,
  type HostRelativeRect,
  type VisibleRegion,
} from "./followFraming.ts";

const ORDINARY_OFFSET_PX = 60;
const R = FOLLOW_FRAMING_DISC_RADIUS_PX;
const CLEARANCE = FOLLOW_FRAMING_CLEARANCE_PX;

/** An unclipped host, `width` × `height`, at the origin. */
function region(
  width: number,
  height: number,
  visibleBottom = height,
  visibleTop = 0,
): VisibleRegion {
  return {
    left: 0,
    top: visibleTop,
    right: width,
    bottom: visibleBottom,
    hostWidth: width,
    hostHeight: height,
    clippedBottom: height - visibleBottom,
  };
}

/** A box spanning x from `left` to `right`, y from `top` to `bottom`. */
const box = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): HostRelativeRect => ({
  left,
  top,
  right,
  bottom,
});

/** The rider's y for a decision's offset, in the given host. */
const riderY = (host: VisibleRegion, offsetPx: number) => host.hostHeight / 2 + offsetPx;

describe("decideFollowAnchor", () => {
  it("an unclipped and unobstructed map should retain the ordinary anchor", () => {
    expect(decideFollowAnchor(region(288, 305), [], ORDINARY_OFFSET_PX)).toEqual({
      kind: "kept",
      offsetPx: ORDINARY_OFFSET_PX,
    });
  });

  it("keeps an ordinary anchor that is whole and clear with less than the corrective clearance", () => {
    // The tightest measured ordinary case: 0.94 px between the disc and the
    // attribution (320x693 English, a failed End). No clearance is added
    // to a position that needs no correction.
    const host = region(288, 201);
    const anchorY = 100.5 + ORDINARY_OFFSET_PX;
    const attribution = box(8, anchorY + R + 0.94, 170, anchorY + R + 0.94 + 18.56);
    expect(decideFollowAnchor(host, [attribution], ORDINARY_OFFSET_PX)).toEqual({
      kind: "kept",
      offsetPx: ORDINARY_OFFSET_PX,
    });
  });

  it("still corrects an unclipped map whose overlay covers the ordinary anchor, by exactly the clearance", () => {
    // 320x693 German, refused: 180 px of map, the attribution across the
    // rider's column.
    const host = region(288, 180);
    const attribution = box(8, 180 - 8 - 18.56, 170, 180 - 8);
    const decision = decideFollowAnchor(host, [attribution], ORDINARY_OFFSET_PX);
    expect(decision.kind).toBe("moved");
    if (decision.kind !== "moved") return;
    const y = riderY(host, decision.offsetPx);
    expect(attribution.top - (y + R)).toBeCloseTo(CLEARANCE, 9);
    expect(isDiscWholeAndClear(host, [attribution], { x: 144, y })).toBe(true);
  });

  it("tests an obstacle against the disc's full width, not only its centre line", () => {
    const host = region(288, 305);
    const anchorY = 152.5 + ORDINARY_OFFSET_PX;
    // Overlapping the disc's right edge by 5 px, beside the anchor (the
    // English climb cue at 320 px before its width was limited).
    const beside = box(144 + R - 5, anchorY - 40, 280, anchorY + 40);
    const moved = decideFollowAnchor(host, [beside], ORDINARY_OFFSET_PX);
    expect(moved.kind).toBe("moved");
    // Touching the disc's edge is clear.
    const touching = box(144 + R, anchorY - 40, 280, anchorY + 40);
    expect(decideFollowAnchor(host, [touching], ORDINARY_OFFSET_PX)).toEqual({
      kind: "kept",
      offsetPx: ORDINARY_OFFSET_PX,
    });
  });

  it("brings the anchor into the visible map when the canvas is clipped below, clear of the attribution at the visible bottom", () => {
    // 320x693 German, refused with a failed End: the canvas held at its
    // 160 px floor with 128 px visible.
    const host = region(288, 160, 128);
    const attribution = box(8, 128 - 8 - 18.56, 170, 128 - 8);
    const decision = decideFollowAnchor(host, [attribution], ORDINARY_OFFSET_PX);
    expect(decision.kind).toBe("moved");
    if (decision.kind !== "moved") return;
    const y = riderY(host, decision.offsetPx);
    expect(y).toBeCloseTo(attribution.top - R - CLEARANCE, 9);
    expect(y - R).toBeGreaterThanOrEqual(host.top + CLEARANCE);
  });

  it("respects the top edge and an overlay at the top, choosing the nearest clear position", () => {
    // A top-placed climb cue and the attribution, 160 px of map.
    const host = region(288, 160);
    const cue = box(64, 8, 192, 103);
    const attribution = box(8, 140, 170, 152);
    const decision = decideFollowAnchor(host, [cue, attribution], ORDINARY_OFFSET_PX);
    expect(decision.kind).toBe("moved");
    if (decision.kind !== "moved") return;
    const y = riderY(host, decision.offsetPx);
    expect(y - R - cue.bottom).toBeGreaterThanOrEqual(CLEARANCE - 1e-9);
    expect(attribution.top - (y + R)).toBeCloseTo(CLEARANCE, 9);
  });

  it("reports a conflict when no position leaves the disc and both clearances", () => {
    // The old tight climb case: a 33.44 px band where 2 × (13 + 4) = 34 px
    // are needed.
    const host = region(288, 163);
    const cue = box(64, 8, 175, 103);
    const attribution = box(8, 136.44, 175, 155);
    expect(decideFollowAnchor(host, [cue, attribution], ORDINARY_OFFSET_PX)).toEqual({
      kind: "conflict",
    });
  });

  it("reports a conflict for a visible map with no height (End's confirmation)", () => {
    expect(decideFollowAnchor(region(288, 160, 0), [], ORDINARY_OFFSET_PX)).toEqual({
      kind: "conflict",
    });
  });
});

describe("isDiscWholeAndClear", () => {
  const host = region(288, 201);

  it("is true for a disc inside the region clear of every obstacle", () => {
    expect(isDiscWholeAndClear(host, [box(8, 175, 170, 193)], { x: 144, y: 160.5 })).toBe(
      true,
    );
  });

  it("is false for a disc under an obstacle or past the visible edge", () => {
    // The measured no-fix drift: 540.49 against 537.5, 2.06 px under the
    // attribution.
    expect(
      isDiscWholeAndClear(host, [box(8, 174.44, 170, 193)], { x: 144, y: 163.49 }),
    ).toBe(false);
    expect(isDiscWholeAndClear(host, [], { x: 144, y: 201 - R + 0.5 })).toBe(false);
  });
});

describe("measureVisibleRegion", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function layout(ancestorOverflow: { x: string; y: string }) {
    const ancestor = document.createElement("div");
    ancestor.style.overflowX = ancestorOverflow.x;
    ancestor.style.overflowY = ancestorOverflow.y;
    const host = document.createElement("div");
    ancestor.append(host);
    document.body.append(ancestor);
    // A 288 × 160 canvas host at (16, 400), inside an ancestor whose
    // padding box is 280 × 128 at (20, 400).
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(
      new DOMRect(16, 400, 288, 160),
    );
    vi.spyOn(ancestor, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 400, 280, 128),
    );
    for (const [name, value] of [
      ["clientLeft", 0],
      ["clientTop", 0],
      ["clientWidth", 280],
      ["clientHeight", 128],
    ] as const) {
      Object.defineProperty(ancestor, name, { configurable: true, value });
    }
    return host;
  }

  it("counts an ancestor that hides or clips its overflow", () => {
    const hidden = measureVisibleRegion(layout({ x: "visible", y: "hidden" }));
    expect(hidden).toMatchObject({
      top: 0,
      bottom: 128,
      left: 0,
      right: 288,
      clippedBottom: 32,
    });
    document.body.replaceChildren();
    const clip = measureVisibleRegion(layout({ x: "clip", y: "clip" }));
    expect(clip).toMatchObject({ left: 4, right: 284, bottom: 128, clippedBottom: 32 });
  });

  it("does not count a scroll container or visible overflow, which can bring the rest back into view", () => {
    for (const overflow of ["auto", "scroll", "visible"]) {
      document.body.replaceChildren();
      expect(measureVisibleRegion(layout({ x: overflow, y: overflow }))).toMatchObject({
        top: 0,
        bottom: 160,
        clippedBottom: 0,
      });
    }
  });

  it("is null for a host with no size", () => {
    const host = document.createElement("div");
    document.body.append(host);
    expect(measureVisibleRegion(host)).toBeNull();
  });
});
