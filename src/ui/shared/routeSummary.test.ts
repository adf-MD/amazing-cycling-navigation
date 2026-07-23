import { describe, expect, it } from "vitest";
import { formatAscent, formatDistanceKm } from "./routeSummary.ts";

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
