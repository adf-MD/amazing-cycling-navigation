import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTING_PROFILE,
  ROUTING_PROFILES,
  describeRoutingProfile,
  formatRoutingProfileLabel,
  isRoutingProfile,
} from "./routingProfiles.ts";

describe("ROUTING_PROFILES", () => {
  it("has exactly one entry per known profile value", () => {
    expect(ROUTING_PROFILES.map((metadata) => metadata.value)).toEqual([
      "cycling-road",
      "cycling-regular",
    ]);
  });

  it("has exactly one default entry, matching DEFAULT_ROUTING_PROFILE", () => {
    const defaults = ROUTING_PROFILES.filter((metadata) => metadata.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.value).toBe(DEFAULT_ROUTING_PROFILE);
  });

  it("gives every entry a non-empty label and description", () => {
    for (const metadata of ROUTING_PROFILES) {
      expect(metadata.label.length).toBeGreaterThan(0);
      expect(metadata.description.length).toBeGreaterThan(0);
    }
  });

  it("never claims General cycling guarantees cycle paths or paved surfaces", () => {
    const generalCycling = ROUTING_PROFILES.find(
      (metadata) => metadata.value === "cycling-regular",
    );
    expect(generalCycling?.description.toLowerCase()).not.toContain("guarantee");
    expect(generalCycling?.description.toLowerCase()).not.toContain("safer");
  });

  it("never claims Road bike is the default, since Settings can now configure a different default", () => {
    const roadBike = ROUTING_PROFILES.find(
      (metadata) => metadata.value === "cycling-road",
    );
    expect(roadBike?.description.toLowerCase()).not.toContain("default");
  });
});

describe("formatRoutingProfileLabel", () => {
  it("is exhaustive for both profiles", () => {
    expect(formatRoutingProfileLabel("cycling-road")).toBe("Road bike");
    expect(formatRoutingProfileLabel("cycling-regular")).toBe("General cycling");
  });
});

describe("describeRoutingProfile", () => {
  it("is exhaustive for both profiles", () => {
    expect(describeRoutingProfile("cycling-road").length).toBeGreaterThan(0);
    expect(describeRoutingProfile("cycling-regular").length).toBeGreaterThan(0);
  });
});

describe("re-exported guard", () => {
  it("isRoutingProfile still works via this module", () => {
    expect(isRoutingProfile("cycling-road")).toBe(true);
    expect(isRoutingProfile("nonsense")).toBe(false);
  });
});
