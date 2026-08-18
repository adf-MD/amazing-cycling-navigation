import { describe, expect, it } from "vitest";
import type { Screen } from "./MainNavigation.tsx";
import { isImmersiveRidingShell } from "./immersiveRidingShell.ts";

const NON_RIDING_SCREENS: readonly Screen[] = [
  "library",
  "planning",
  "diagnostics",
  "settings",
];

describe("isImmersiveRidingShell", () => {
  it.each(NON_RIDING_SCREENS)(
    "is never immersive on %s, regardless of ride-active state",
    (screen) => {
      expect(isImmersiveRidingShell(screen, false)).toBe(false);
      expect(isImmersiveRidingShell(screen, true)).toBe(false);
    },
  );

  it("is not immersive on Riding before Start riding / while awaiting Resume riding (isRidingActive false)", () => {
    expect(isImmersiveRidingShell("riding", false)).toBe(false);
  });

  it("is immersive on Riding only while a ride is genuinely being GPS-tracked (isRidingActive true)", () => {
    expect(isImmersiveRidingShell("riding", true)).toBe(true);
  });
});
