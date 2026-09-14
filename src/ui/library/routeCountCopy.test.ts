import { describe, expect, it } from "vitest";
import { formatRouteCount } from "./routeCountCopy.ts";
import { englishTranslator } from "../../i18n/englishTranslator.ts";

describe("formatRouteCount", () => {
  it("uses the singular for exactly one route", () => {
    expect(formatRouteCount(englishTranslator, 1)).toBe("1 route");
  });

  it("uses the plural for none and for many", () => {
    expect(formatRouteCount(englishTranslator, 0)).toBe("0 routes");
    expect(formatRouteCount(englishTranslator, 4)).toBe("4 routes");
  });

  it("selects the category through Intl rather than an equality test", () => {
    // Backlog item 113 stage 2. English reports `one` only for 1, so the
    // visible output is unchanged — but the choice is now made by the
    // locale's own plural rules, which is what a language with more
    // categories will need.
    expect(new Intl.PluralRules(englishTranslator.locale).select(1)).toBe("one");
    expect(new Intl.PluralRules(englishTranslator.locale).select(0)).toBe("other");
    expect(new Intl.PluralRules(englishTranslator.locale).select(21)).toBe("other");
    expect(formatRouteCount(englishTranslator, 21)).toBe("21 routes");
  });
});
