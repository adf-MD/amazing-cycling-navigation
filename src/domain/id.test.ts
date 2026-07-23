import { describe, expect, it } from "vitest";
import { createRouteId } from "./id.ts";

describe("createRouteId", () => {
  it("returns a well-formed UUID", () => {
    const id = createRouteId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("returns a different id on each call", () => {
    const ids = new Set(Array.from({ length: 20 }, () => createRouteId()));
    expect(ids.size).toBe(20);
  });
});
