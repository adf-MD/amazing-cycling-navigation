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
