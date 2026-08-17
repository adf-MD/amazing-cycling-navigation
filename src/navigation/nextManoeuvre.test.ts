import { describe, expect, it } from "vitest";
import {
  classifyManoeuvreUrgency,
  MANOEUVRE_REACHED_TOLERANCE_METRES,
  selectNextManoeuvre,
} from "./nextManoeuvre.ts";
import type { Manoeuvre } from "../domain/types.ts";

function manoeuvre(
  distanceFromStartMetres: number,
  type: Manoeuvre["type"] = "left",
): Manoeuvre {
  return { distanceFromStartMetres, type };
}

describe("selectNextManoeuvre", () => {
  it("returns no selection for an empty manoeuvre list", () => {
    const result = selectNextManoeuvre([], 100, 0);
    expect(result.selection).toBeNull();
    expect(result.reachedIndex).toBe(0);
  });

  it("returns no selection when there is no reliable presentation distance yet", () => {
    const result = selectNextManoeuvre([manoeuvre(100)], null, 0);
    expect(result.selection).toBeNull();
    expect(result.reachedIndex).toBe(0);
  });

  it("selects the first manoeuvre when progress is before the route start", () => {
    const manoeuvres = [manoeuvre(0), manoeuvre(500)];
    const result = selectNextManoeuvre(manoeuvres, -50, 0);
    expect(result.selection?.index).toBe(0);
    expect(result.selection?.remainingDistanceMetres).toBe(50);
  });

  it("selects the first upcoming manoeuvre", () => {
    const manoeuvres = [manoeuvre(500), manoeuvre(1000)];
    const result = selectNextManoeuvre(manoeuvres, 100, 0);
    expect(result.selection?.index).toBe(0);
    expect(result.selection?.remainingDistanceMetres).toBe(400);
  });

  it("advances to the next manoeuvre once the current one is reliably passed", () => {
    const manoeuvres = [manoeuvre(100), manoeuvre(300)];
    const distancePastFirst = 100 + MANOEUVRE_REACHED_TOLERANCE_METRES;
    const result = selectNextManoeuvre(manoeuvres, distancePastFirst, 0);
    expect(result.reachedIndex).toBe(1);
    expect(result.selection?.index).toBe(1);
  });

  it("does not advance until genuinely past the tolerance, not merely within it", () => {
    const manoeuvres = [manoeuvre(100), manoeuvre(300)];
    const justUnder = 100 + MANOEUVRE_REACHED_TOLERANCE_METRES - 1;
    const result = selectNextManoeuvre(manoeuvres, justUnder, 0);
    expect(result.reachedIndex).toBe(0);
    expect(result.selection?.index).toBe(0);
  });

  it("handles two manoeuvres closer together than the tolerance without skipping the second", () => {
    // 10 m apart, less than MANOEUVRE_REACHED_TOLERANCE_METRES (15 m).
    const manoeuvres = [manoeuvre(100), manoeuvre(110)];
    const distancePastFirstOnly = 100 + MANOEUVRE_REACHED_TOLERANCE_METRES;
    const result = selectNextManoeuvre(manoeuvres, distancePastFirstOnly, 0);
    // The first is reliably passed, but the second must still be shown as
    // "next" rather than being skipped over too just because it's within
    // the same tolerance distance of the first.
    expect(result.reachedIndex).toBe(1);
    expect(result.selection?.manoeuvre.distanceFromStartMetres).toBe(110);
  });

  it("never regresses to an earlier manoeuvre on a backward jitter in presentation distance", () => {
    const manoeuvres = [manoeuvre(100), manoeuvre(300)];
    const first = selectNextManoeuvre(manoeuvres, 150, 0);
    expect(first.reachedIndex).toBe(1);

    // A stray fix nudges presentation distance backward, below manoeuvre 0's
    // own distance — must not un-pass manoeuvre 0.
    const second = selectNextManoeuvre(manoeuvres, 90, first.reachedIndex);
    expect(second.reachedIndex).toBe(1);
    expect(second.selection?.index).toBe(1);
  });

  it("returns no selection once every manoeuvre has been reliably passed (end of route)", () => {
    const manoeuvres = [manoeuvre(100)];
    const result = selectNextManoeuvre(
      manoeuvres,
      100 + MANOEUVRE_REACHED_TOLERANCE_METRES,
      0,
    );
    expect(result.reachedIndex).toBe(1);
    expect(result.selection).toBeNull();
  });

  it("fast-forwards through several already-passed manoeuvres in one call (restore/resume)", () => {
    const manoeuvres = [manoeuvre(100), manoeuvre(300), manoeuvre(600), manoeuvre(900)];
    const result = selectNextManoeuvre(manoeuvres, 650, 0);
    expect(result.reachedIndex).toBe(3);
    expect(result.selection?.manoeuvre.distanceFromStartMetres).toBe(900);
    expect(result.selection?.remainingDistanceMetres).toBe(250);
  });

  it("never returns a negative remaining distance", () => {
    const manoeuvres = [manoeuvre(100)];
    const result = selectNextManoeuvre(manoeuvres, 99, 0);
    expect(result.selection?.remainingDistanceMetres).toBeGreaterThanOrEqual(0);
  });
});

describe("selectNextManoeuvre — synthetic waypoint-seam manoeuvres", () => {
  // A "waypoint"-typed entry (stitchPlannedRouteLegs.ts, collapsing an
  // internal multi-leg seam) carries no instruction and must never be
  // presented — see CLAUDE.md backlog item 47.

  it("pre-emptively skips a seam and selects the following real manoeuvre, well before the seam is physically reached", () => {
    const manoeuvres = [
      manoeuvre(500, "left"),
      manoeuvre(1000, "waypoint"),
      manoeuvre(1500, "right"),
    ];
    // Past the left turn's own tolerance, but nowhere near the seam yet.
    const result = selectNextManoeuvre(manoeuvres, 600, 0);

    // reachedIndex still tracks physical progress — the seam has not been
    // physically reached, so it stays at the seam's own (unreached) index.
    expect(result.reachedIndex).toBe(1);
    // The presented selection looks straight through the seam to the real
    // manoeuvre after it.
    expect(result.selection?.index).toBe(2);
    expect(result.selection?.manoeuvre.type).toBe("right");
    expect(result.selection?.remainingDistanceMetres).toBe(900);
  });

  it("skips the seam even when a real manoeuvre shares its exact route distance", () => {
    const manoeuvres = [
      manoeuvre(500, "left"),
      manoeuvre(1000, "waypoint"),
      manoeuvre(1000, "right"),
    ];
    const distancePastLeftOnly = 600;
    const result = selectNextManoeuvre(manoeuvres, distancePastLeftOnly, 0);

    expect(result.selection?.index).toBe(2);
    expect(result.selection?.manoeuvre.type).toBe("right");
    expect(result.selection?.manoeuvre.distanceFromStartMetres).toBe(1000);
  });

  it("does not skip a real manoeuvre that follows closely behind a reached seam", () => {
    // Mirrors the existing "two manoeuvres closer together than the
    // tolerance" test above, but the first entry is now a seam — proves the
    // type-based scan never interacts with the distance/tolerance logic.
    const manoeuvres = [
      manoeuvre(100, "waypoint"),
      manoeuvre(105, "left"),
      manoeuvre(2000, "finish"),
    ];
    const distancePastSeamOnly = 100 + MANOEUVRE_REACHED_TOLERANCE_METRES;
    const result = selectNextManoeuvre(manoeuvres, distancePastSeamOnly, 0);

    expect(result.reachedIndex).toBe(1);
    expect(result.selection?.index).toBe(1);
    expect(result.selection?.manoeuvre.type).toBe("left");
    expect(result.selection?.manoeuvre.distanceFromStartMetres).toBe(105);
    expect(result.selection?.remainingDistanceMetres).toBe(0);
  });

  it("never regresses to a skipped seam after a backward jitter in presentation distance", () => {
    const manoeuvres = [
      manoeuvre(500, "left"),
      manoeuvre(1000, "waypoint"),
      manoeuvre(1500, "right"),
    ];
    const first = selectNextManoeuvre(manoeuvres, 1020, 0);
    expect(first.reachedIndex).toBe(2);
    expect(first.selection?.manoeuvre.type).toBe("right");

    // A stray fix nudges presentation distance backward, well below the
    // seam's own distance — the seam must not reappear.
    const second = selectNextManoeuvre(manoeuvres, 900, first.reachedIndex);
    expect(second.reachedIndex).toBe(2);
    expect(second.selection?.index).toBe(2);
    expect(second.selection?.manoeuvre.type).toBe("right");
  });

  it("skips multiple adjacent synthetic waypoint seams with no real manoeuvre between them", () => {
    // A realistic production shape: a middle leg with no turns of its own
    // produces two adjacent collapsed seams, not one.
    const manoeuvres = [
      manoeuvre(500, "left"),
      manoeuvre(1000, "waypoint"),
      manoeuvre(1050, "waypoint"),
      manoeuvre(1500, "right"),
    ];
    const result = selectNextManoeuvre(manoeuvres, 600, 0);

    expect(result.reachedIndex).toBe(1);
    expect(result.selection?.index).toBe(3);
    expect(result.selection?.manoeuvre.type).toBe("right");
    expect(result.selection?.manoeuvre.distanceFromStartMetres).toBe(1500);
  });

  it("returns no selection, with reachedIndex still consistent, when only synthetic waypoint seams remain ahead", () => {
    const manoeuvres = [
      manoeuvre(500, "left"),
      manoeuvre(1000, "waypoint"),
      manoeuvre(1600, "waypoint"),
    ];
    const result = selectNextManoeuvre(manoeuvres, 600, 0);

    expect(result.selection).toBeNull();
    expect(result.reachedIndex).toBe(1);
  });
});

describe("classifyManoeuvreUrgency", () => {
  it("classifies 500 m and above as normal", () => {
    expect(classifyManoeuvreUrgency(500)).toBe("normal");
    expect(classifyManoeuvreUrgency(10_000)).toBe("normal");
  });

  it("classifies just under 500 m as near", () => {
    expect(classifyManoeuvreUrgency(499.9)).toBe("near");
  });

  it("classifies 100 m as near (not yet imminent)", () => {
    expect(classifyManoeuvreUrgency(100)).toBe("near");
  });

  it("classifies just under 100 m as imminent", () => {
    expect(classifyManoeuvreUrgency(99.9)).toBe("imminent");
  });

  it("classifies 0 m as imminent", () => {
    expect(classifyManoeuvreUrgency(0)).toBe("imminent");
  });
});
