import { describe, expect, it } from "vitest";
import { formatRouteCount } from "./routeCountCopy.ts";

describe("formatRouteCount", () => {
  it("uses the singular for exactly one route", () => {
    expect(formatRouteCount(1)).toBe("1 route");
  });

  it("uses the plural for none and for many", () => {
    expect(formatRouteCount(0)).toBe("0 routes");
    expect(formatRouteCount(4)).toBe("4 routes");
  });
});
