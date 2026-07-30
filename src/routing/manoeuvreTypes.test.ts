import { describe, expect, it } from "vitest";
import { decodeOrsManoeuvreType } from "./manoeuvreTypes.ts";
import type { ManoeuvreType } from "../domain/types.ts";

const EXPECTED: Record<number, ManoeuvreType> = {
  0: "left",
  1: "right",
  2: "sharp-left",
  3: "sharp-right",
  4: "slight-left",
  5: "slight-right",
  6: "continue",
  7: "roundabout",
  8: "roundabout",
  9: "u-turn",
  10: "finish",
  11: "start",
  12: "slight-left",
  13: "slight-right",
};

describe("decodeOrsManoeuvreType", () => {
  it.each(Object.entries(EXPECTED))(
    "decodes documented code %s to %s",
    (code, expected) => {
      expect(decodeOrsManoeuvreType(Number(code))).toBe(expected);
    },
  );

  it("decodes a stringified numeric code identically to its numeric form", () => {
    expect(decodeOrsManoeuvreType("11")).toBe("start");
    expect(decodeOrsManoeuvreType("10")).toBe("finish");
  });

  it("never returns 'waypoint' for any raw code", () => {
    for (const code of Object.keys(EXPECTED)) {
      expect(decodeOrsManoeuvreType(Number(code))).not.toBe("waypoint");
    }
  });

  it("resolves a genuinely unrecognised code to 'unknown'", () => {
    expect(decodeOrsManoeuvreType(9999)).toBe("unknown");
    expect(decodeOrsManoeuvreType(14)).toBe("unknown");
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.5])(
    "resolves a malformed numeric value (%s) to 'unknown'",
    (value) => {
      expect(decodeOrsManoeuvreType(value)).toBe("unknown");
    },
  );

  it.each(["not-a-number", "", "8.5"])(
    "resolves a malformed string value (%s) to 'unknown'",
    (value) => {
      expect(decodeOrsManoeuvreType(value)).toBe("unknown");
    },
  );
});
