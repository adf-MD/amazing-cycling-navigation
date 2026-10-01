import { describe, expect, it } from "vitest";
import {
  REVEAL_GAP_PX,
  REVEAL_TOLERANCE_PX,
  computeConfirmationRevealDelta,
} from "./confirmationRevealScroll.ts";

// A fixed, readable band for every case below: a 67px sticky header, no
// visual-viewport offset, an 844px visible bottom and a 12px cushion
// (a 4px synthetic safe-area inset plus the 8px framing gap). The usable
// band is therefore 75..832 — 757px tall.
const HEADER_BOTTOM = 67;
const CUSHION = 4 + REVEAL_GAP_PX;
const VISIBLE_TOP = 0;
const VISIBLE_BOTTOM = 844;
const BAND_TOP = HEADER_BOTTOM + REVEAL_GAP_PX;
const BAND_BOTTOM = VISIBLE_BOTTOM - CUSHION;

function delta(
  inset: { top: number; bottom: number },
  overrides: {
    headerBottom?: number;
    cushion?: number;
    visibleTop?: number;
    visibleBottom?: number;
  } = {},
) {
  return computeConfirmationRevealDelta(
    inset,
    overrides.headerBottom ?? HEADER_BOTTOM,
    overrides.cushion ?? CUSHION,
    overrides.visibleTop ?? VISIBLE_TOP,
    overrides.visibleBottom ?? VISIBLE_BOTTOM,
  );
}

describe("computeConfirmationRevealDelta", () => {
  it("does not move an inset that already fits inside the usable band", () => {
    expect(delta({ top: 300, bottom: 500 })).toBe(0);
  });

  it("treats the band edges themselves as already in place", () => {
    expect(delta({ top: BAND_TOP, bottom: BAND_BOTTOM })).toBe(0);
  });

  it("scrolls down by exactly the amount that brings a clipped bottom to the band", () => {
    // 120px of the inset lies below the usable bottom.
    expect(delta({ top: 400, bottom: BAND_BOTTOM + 120 })).toBe(120);
  });

  it("scrolls up by exactly the amount that clears the sticky header", () => {
    // 40px of the inset lies above the usable top: a negative delta.
    expect(delta({ top: BAND_TOP - 40, bottom: 500 })).toBe(-40);
  });

  it("honours the bottom cushion, not merely the raw viewport edge", () => {
    // Inside the viewport but inside the cushion too — still needs moving.
    expect(delta({ top: 400, bottom: VISIBLE_BOTTOM - 2 })).toBe(CUSHION - 2);
    // Clear of the cushion — nothing to do.
    expect(delta({ top: 400, bottom: BAND_BOTTOM })).toBe(0);
  });

  it("uses the visual viewport's own top when it is lower than the header", () => {
    // A panned visual viewport (offsetTop 200) outranks the 67px header, so
    // an inset at 190 is now above the band even though it clears the header.
    expect(
      delta({ top: 190, bottom: 400 }, { visibleTop: 200, visibleBottom: 700 }),
    ).toBe(190 - (200 + REVEAL_GAP_PX));
    // Under the header alone it would have been comfortably inside.
    expect(delta({ top: 190, bottom: 400 })).toBe(0);
  });

  it("uses the visual viewport's own bottom, so a shrunken band still scrolls", () => {
    // The layout viewport would call this already visible; a 400px visual
    // viewport does not.
    expect(delta({ top: 150, bottom: 400 }, { visibleBottom: 400 })).toBe(
      400 - (400 - CUSHION),
    );
    expect(delta({ top: 150, bottom: 400 })).toBe(0);
  });

  it("anchors the inset's bottom when it is taller than the band, keeping the actions complete", () => {
    // 900px inset against a 757px band: it cannot fit, so the bottom goes
    // to the band's bottom and the overflow is taken off the top.
    const result = delta({ top: 100, bottom: 1000 });
    expect(result).toBe(1000 - BAND_BOTTOM);
    // ...and the resulting position puts the bottom exactly on the band.
    expect(1000 - result).toBe(BAND_BOTTOM);
  });

  it("scrolls an oversized inset back up when the rider has already passed its actions", () => {
    // The inset's bottom sits above the band's bottom: a negative delta
    // brings the action row back into view.
    const result = delta({ top: -600, bottom: 300 });
    expect(result).toBe(300 - BAND_BOTTOM);
    expect(result).toBeLessThan(0);
  });

  it("treats an element with no laid-out box as nothing to reveal", () => {
    // Every rect reports this in jsdom. Without the guard the "top is above
    // the band" branch would return a spurious -gap.
    expect(delta({ top: 0, bottom: 0 })).toBe(0);
    expect(delta({ top: 500, bottom: 500 })).toBe(0);
  });

  it("ignores sub-pixel movement below the tolerance", () => {
    expect(delta({ top: 400, bottom: BAND_BOTTOM + 0.4 })).toBe(0);
    expect(delta({ top: BAND_TOP - 0.9, bottom: 500 })).toBe(0);
    // ...but not movement at or above it.
    expect(delta({ top: 400, bottom: BAND_BOTTOM + REVEAL_TOLERANCE_PX })).toBe(
      REVEAL_TOLERANCE_PX,
    );
  });
});

// Backlog item 124's opt-in refinement of the overflow branch. Only a
// caller that names its action row reaches it; every case above, which is
// item 118's Settings contract, passes none and is unchanged.
describe("computeConfirmationRevealDelta with an action row (item 124)", () => {
  function deltaWithRow(
    inset: { top: number; bottom: number },
    row: { top: number; bottom: number },
  ) {
    return computeConfirmationRevealDelta(
      inset,
      HEADER_BOTTOM,
      CUSHION,
      VISIBLE_TOP,
      VISIBLE_BOTTOM,
      REVEAL_GAP_PX,
      row,
    );
  }

  it("does not move an oversized inset whose complete action row is already inside the band", () => {
    // 900px inset, top above the band, actions comfortably inside it: the
    // state a keyboard user reaches by activating a header-covered trigger.
    const inset = { top: -100, bottom: 800 };
    const row = { top: 720, bottom: 776 };
    expect(deltaWithRow(inset, row)).toBe(0);
    // Discriminating: item 118's bottom-anchoring would have moved it.
    expect(delta(inset)).toBe(800 - BAND_BOTTOM);
    expect(delta(inset)).not.toBe(0);
  });

  it("moves an oversized inset only as far as brings a clipped action row to the band's bottom", () => {
    const inset = { top: 100, bottom: 1000 };
    const row = { top: 930, bottom: 986 };
    expect(deltaWithRow(inset, row)).toBe(986 - BAND_BOTTOM);
    // Less than bottom-anchoring the inset, by exactly the inset's own
    // padding below the row.
    expect(deltaWithRow(inset, row)).toBeLessThan(delta(inset));
  });

  it("moves an oversized inset only as far back up as brings a passed action row to the band's top", () => {
    const inset = { top: -900, bottom: 60 };
    const row = { top: -10, bottom: 46 };
    expect(deltaWithRow(inset, row)).toBe(-10 - BAND_TOP);
  });

  it("leaves the fit branch exactly as it was", () => {
    // An inset that fits is revealed whole; the row plays no part.
    expect(
      deltaWithRow({ top: 400, bottom: BAND_BOTTOM + 120 }, { top: 0, bottom: 0 }),
    ).toBe(120);
    expect(deltaWithRow({ top: 300, bottom: 500 }, { top: 440, bottom: 496 })).toBe(0);
  });

  it("is a minimal-movement band fit for a small element such as the opening button", () => {
    // Visible: no movement.
    expect(delta({ top: 400, bottom: 444 })).toBe(0);
    // Under the sticky header: up by exactly the shortfall.
    expect(delta({ top: HEADER_BOTTOM - 20, bottom: HEADER_BOTTOM + 24 })).toBe(
      HEADER_BOTTOM - 20 - BAND_TOP,
    );
    // Inside the bottom cushion: down by exactly the shortfall.
    expect(delta({ top: VISIBLE_BOTTOM - 44, bottom: VISIBLE_BOTTOM })).toBe(CUSHION);
  });
});
