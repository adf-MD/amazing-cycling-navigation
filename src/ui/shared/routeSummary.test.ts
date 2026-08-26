import { describe, expect, it } from "vitest";
import {
  formatAscent,
  formatDescentLoss,
  formatDistanceKm,
  formatManoeuvreDistance,
} from "./routeSummary.ts";

describe("formatDistanceKm", () => {
  it("formats metres as kilometres to one decimal place", () => {
    expect(formatDistanceKm(12345)).toBe("12.3 km");
  });

  it("formats zero distance", () => {
    expect(formatDistanceKm(0)).toBe("0.0 km");
  });
});

describe("formatAscent", () => {
  it("rounds ascent to the nearest metre", () => {
    expect(formatAscent(144.6)).toBe("145 m ascent");
  });

  it("says ascent is not available when null", () => {
    expect(formatAscent(null)).toBe("ascent not available");
  });
});

describe("formatDescentLoss", () => {
  it("rounds loss to the nearest metre", () => {
    expect(formatDescentLoss(223.6)).toBe("224 m loss");
  });

  it("formats zero loss", () => {
    expect(formatDescentLoss(0)).toBe("0 m loss");
  });
});

describe("formatManoeuvreDistance", () => {
  it("formats 1 km and above as kilometres, reusing formatDistanceKm", () => {
    expect(formatManoeuvreDistance(1000)).toBe("1.0 km");
    expect(formatManoeuvreDistance(12_345)).toBe("12.3 km");
  });

  it("rounds 200-999 m to the nearest 50 m", () => {
    expect(formatManoeuvreDistance(420)).toBe("400 m");
    expect(formatManoeuvreDistance(430)).toBe("450 m");
    expect(formatManoeuvreDistance(999)).toBe("1000 m");
  });

  it("rounds 50-199 m to the nearest 10 m", () => {
    expect(formatManoeuvreDistance(84)).toBe("80 m");
    expect(formatManoeuvreDistance(86)).toBe("90 m");
  });

  it("rounds below 50 m to the nearest 5 m", () => {
    expect(formatManoeuvreDistance(22)).toBe("20 m");
    expect(formatManoeuvreDistance(23)).toBe("25 m");
    expect(formatManoeuvreDistance(0)).toBe("0 m");
  });

  it("clamps a negative distance to 0 rather than showing a negative value", () => {
    expect(formatManoeuvreDistance(-10)).toBe("0 m");
  });
});
