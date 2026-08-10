import { describe, expect, it } from "vitest";
import { suggestReversedRouteName } from "./routeNaming.ts";

describe("suggestReversedRouteName", () => {
  it('appends " (reversed)" to an ordinary name', () => {
    expect(suggestReversedRouteName("Evening loop")).toBe("Evening loop (reversed)");
  });

  it("preserves the complete source name, including punctuation and unicode", () => {
    expect(suggestReversedRouteName("Café ride – hills!")).toBe(
      "Café ride – hills! (reversed)",
    );
  });

  it("does not mutate or trim the input string", () => {
    const sourceName = "  Evening loop  ";
    const result = suggestReversedRouteName(sourceName);
    expect(sourceName).toBe("  Evening loop  ");
    expect(result).toBe("  Evening loop   (reversed)");
  });

  it("is deterministic", () => {
    expect(suggestReversedRouteName("Evening loop")).toBe(
      suggestReversedRouteName("Evening loop"),
    );
  });

  it("appends a second suffix when the source name is already reversed", () => {
    expect(suggestReversedRouteName("Evening loop (reversed)")).toBe(
      "Evening loop (reversed) (reversed)",
    );
  });
});
