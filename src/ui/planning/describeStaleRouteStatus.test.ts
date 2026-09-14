import { describe, expect, it } from "vitest";
import { describeStaleRouteStatus } from "./describeStaleRouteStatus.ts";
import { englishTranslator } from "../../i18n/englishTranslator.ts";

describe("describeStaleRouteStatus", () => {
  it("names both profiles while calculating a genuine profile change", () => {
    expect(
      describeStaleRouteStatus(englishTranslator, {
        previousProfile: "cycling-road",
        currentProfile: "cycling-regular",
        isCalculating: true,
      }),
    ).toBe(
      "Recalculating for General cycling; showing the previous Road bike result below.",
    );
  });

  it("names both profiles while a genuine profile change is pending, not yet calculating", () => {
    expect(
      describeStaleRouteStatus(englishTranslator, {
        previousProfile: "cycling-road",
        currentProfile: "cycling-regular",
        isCalculating: false,
      }),
    ).toBe(
      "Waiting to recalculate for General cycling; showing the previous Road bike result below.",
    );
  });

  it("uses generic wording, naming no profile, when the profile did not change", () => {
    expect(
      describeStaleRouteStatus(englishTranslator, {
        previousProfile: "cycling-road",
        currentProfile: "cycling-road",
        isCalculating: true,
      }),
    ).toBe("Recalculating your latest changes; showing the previous result below.");
    expect(
      describeStaleRouteStatus(englishTranslator, {
        previousProfile: "cycling-road",
        currentProfile: "cycling-road",
        isCalculating: false,
      }),
    ).toBe(
      "Waiting to recalculate your latest changes; showing the previous result below.",
    );
  });

  it("uses generic wording when the previous profile is unknown (legacy/imported route)", () => {
    expect(
      describeStaleRouteStatus(englishTranslator, {
        previousProfile: undefined,
        currentProfile: "cycling-regular",
        isCalculating: true,
      }),
    ).toBe("Recalculating your latest changes; showing the previous result below.");
  });
});
