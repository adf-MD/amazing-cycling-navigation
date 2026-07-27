import { describe, expect, it } from "vitest";
import { generateId } from "./idGenerator.ts";

describe("generateId", () => {
  it("returns a non-empty string", () => {
    expect(generateId().length).toBeGreaterThan(0);
  });

  it("returns a different value on each call", () => {
    expect(generateId()).not.toBe(generateId());
  });
});
