import { describe, expect, it } from "vitest";
import { classifySurfaceCode } from "./surfaceCodes.ts";

describe("classifySurfaceCode", () => {
  it("classifies known paved codes as paved", () => {
    expect(classifySurfaceCode(1)).toBe("paved");
    expect(classifySurfaceCode(3)).toBe("paved");
    expect(classifySurfaceCode(4)).toBe("paved");
  });

  it("classifies known rough/loose surfaces as questionable", () => {
    expect(classifySurfaceCode(9)).toBe("questionable-surface"); // fine gravel
    expect(classifySurfaceCode(14)).toBe("questionable-surface"); // paving stones
  });

  it("classifies known unsuitable surfaces as unsuitable", () => {
    expect(classifySurfaceCode(15)).toBe("unsuitable-surface"); // sand
    expect(classifySurfaceCode(17)).toBe("unsuitable-surface"); // grass
  });

  it("classifies an unmapped code as unknown, never unsuitable or paved", () => {
    expect(classifySurfaceCode(9999)).toBe("unknown");
  });

  it("classifies a negative/nonsensical code as unknown", () => {
    expect(classifySurfaceCode(-1)).toBe("unknown");
  });
});
