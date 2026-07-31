import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTING_PROFILE,
  ROUTING_PROFILE_VALUES,
  isRoutingProfile,
} from "./routingProfile.ts";

describe("ROUTING_PROFILE_VALUES", () => {
  it("contains exactly cycling-road and cycling-regular", () => {
    expect(ROUTING_PROFILE_VALUES).toEqual(["cycling-road", "cycling-regular"]);
  });

  it("includes the default profile", () => {
    expect(ROUTING_PROFILE_VALUES).toContain(DEFAULT_ROUTING_PROFILE);
  });
});

describe("DEFAULT_ROUTING_PROFILE", () => {
  it("is cycling-road", () => {
    expect(DEFAULT_ROUTING_PROFILE).toBe("cycling-road");
  });
});

describe("isRoutingProfile", () => {
  it("accepts both known profile values", () => {
    expect(isRoutingProfile("cycling-road")).toBe(true);
    expect(isRoutingProfile("cycling-regular")).toBe(true);
  });

  it("rejects an unrecognised string", () => {
    expect(isRoutingProfile("cycling-mountain")).toBe(false);
    expect(isRoutingProfile("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isRoutingProfile(undefined)).toBe(false);
    expect(isRoutingProfile(null)).toBe(false);
    expect(isRoutingProfile(42)).toBe(false);
    expect(isRoutingProfile({ value: "cycling-road" })).toBe(false);
  });
});
