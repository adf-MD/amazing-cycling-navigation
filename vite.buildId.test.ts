import { describe, expect, it } from "vitest";
import { resolveBuildId } from "./vite.buildId.ts";

// Git's well-known empty-tree SHA-1 — a real, plausible 40-char lowercase
// hex SHA, used purely as a fixture.
const VALID_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SHORT_SHA = "4b825dc";

describe("resolveBuildId", () => {
  it("returns the first 7 characters of a valid full SHA", () => {
    expect(resolveBuildId(VALID_SHA)).toBe(SHORT_SHA);
  });

  it("falls back to dev for an uppercase SHA (rejected, not case-normalised)", () => {
    expect(resolveBuildId(VALID_SHA.toUpperCase())).toBe("dev");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(resolveBuildId(`  ${VALID_SHA}\n`)).toBe(SHORT_SHA);
  });

  it("falls back to dev for a value that is too short", () => {
    expect(resolveBuildId(VALID_SHA.slice(0, 39))).toBe("dev");
  });

  it("falls back to dev for a value that is too long", () => {
    expect(resolveBuildId(`${VALID_SHA}f`)).toBe("dev");
  });

  it("falls back to dev for non-hex characters", () => {
    expect(resolveBuildId(`${VALID_SHA.slice(0, 39)}g`)).toBe("dev");
  });

  it("falls back to dev when the value is missing", () => {
    expect(resolveBuildId(undefined)).toBe("dev");
  });

  it("falls back to dev for an empty string", () => {
    expect(resolveBuildId("")).toBe("dev");
  });
});
