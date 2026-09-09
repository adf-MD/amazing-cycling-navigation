import { describe, expect, it } from "vitest";
import {
  findTagSpelling,
  resolveEffectiveSourceKey,
  resolveTagLifecycleTarget,
} from "./tagLifecycleTarget.ts";

describe("findTagSpelling", () => {
  it("returns the corpus's established spelling for an identity", () => {
    expect(findTagSpelling(["Gravel", "Road"], "gravel")).toBe("Gravel");
  });

  it("returns null when nothing carries the identity", () => {
    expect(findTagSpelling(["Road"], "gravel")).toBeNull();
  });
});

describe("resolveEffectiveSourceKey", () => {
  it("keeps a chosen tag that the corpus still carries", () => {
    expect(resolveEffectiveSourceKey(["Gravel", "Road"], "gravel")).toBe("gravel");
  });

  it("falls back to the neutral placeholder once the tag disappears", () => {
    expect(resolveEffectiveSourceKey(["Road"], "gravel")).toBe("");
  });

  it("passes the placeholder through unchanged", () => {
    expect(resolveEffectiveSourceKey(["Gravel"], "")).toBe("");
  });
});

describe("resolveTagLifecycleTarget", () => {
  it("keeps the typed spelling for a deliberate case-only respelling", () => {
    // The source must be excluded from the known corpus, or
    // resolveTagSpelling would resolve "gravel" straight back to the
    // established "Gravel" and the rename would silently do nothing.
    expect(resolveTagLifecycleTarget(["Gravel", "Road"], "gravel", "gravel")).toEqual({
      targetSpelling: "gravel",
      isMerge: false,
    });
  });

  it("keeps the typed spelling for a rename to a novel identity", () => {
    expect(resolveTagLifecycleTarget(["Gravel", "Road"], "gravel", "  Trail  ")).toEqual({
      targetSpelling: "Trail",
      isMerge: false,
    });
  });

  it("adopts another tag's established spelling and flags a merge", () => {
    expect(resolveTagLifecycleTarget(["Gravel", "road"], "gravel", "Road")).toEqual({
      targetSpelling: "road",
      isMerge: true,
    });
  });

  it("reports an empty or whitespace-only name as having no target", () => {
    expect(resolveTagLifecycleTarget(["Gravel"], "gravel", "   ")).toEqual({
      targetSpelling: null,
      isMerge: false,
    });
  });
});
