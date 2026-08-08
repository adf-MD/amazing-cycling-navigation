import { describe, expect, it } from "vitest";
import type { Screen } from "./MainNavigation.tsx";
import { deriveNavPositionMode } from "./navPositionMode.ts";

const NON_RIDING_SCREENS: readonly Screen[] = [
  "library",
  "planning",
  "diagnostics",
  "settings",
];

describe("deriveNavPositionMode", () => {
  it.each(NON_RIDING_SCREENS)(
    "is always sticky on %s, regardless of ride-active state",
    (screen) => {
      expect(deriveNavPositionMode(screen, false)).toBe("sticky");
      expect(deriveNavPositionMode(screen, true)).toBe("sticky");
    },
  );

  it("is sticky on Riding before Start riding / while awaiting Resume riding (isRidingActive false)", () => {
    expect(deriveNavPositionMode("riding", false)).toBe("sticky");
  });

  it("is static on Riding only while a ride is genuinely being GPS-tracked (isRidingActive true)", () => {
    expect(deriveNavPositionMode("riding", true)).toBe("static");
  });
});
