import { describe, expect, it } from "vitest";
import {
  isSettingsSectionView,
  resolveSettingsTabTarget,
  type Screen,
} from "./screenTypes.ts";

const ALL_SCREENS: readonly Screen[] = [
  "library",
  "riding",
  "planning",
  "settings",
  "diagnostics",
];

describe("isSettingsSectionView", () => {
  it("holds for Settings and Status (the internal diagnostics key) only", () => {
    expect(ALL_SCREENS.filter(isSettingsSectionView)).toEqual([
      "settings",
      "diagnostics",
    ]);
  });
});

// Backlog item 121, as decided with the rider on 28 September 2026.
describe("resolveSettingsTabTarget", () => {
  it("reopens the last-viewed view when entered from another tab", () => {
    for (const screen of ["library", "riding", "planning"] as const) {
      expect(resolveSettingsTabTarget(screen, "diagnostics")).toBe("diagnostics");
      expect(resolveSettingsTabTarget(screen, "settings")).toBe("settings");
    }
  });

  it("opens Settings when tapped while Status is showing", () => {
    expect(resolveSettingsTabTarget("diagnostics", "diagnostics")).toBe("settings");
  });

  it("stays on Settings when tapped while Settings is showing", () => {
    expect(resolveSettingsTabTarget("settings", "diagnostics")).toBe("settings");
    expect(resolveSettingsTabTarget("settings", "settings")).toBe("settings");
  });
});
