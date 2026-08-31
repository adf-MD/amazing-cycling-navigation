import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { isMapRenderingSupported } from "./mapSupport.ts";

type GetContextStub = MockInstance<HTMLCanvasElement["getContext"]>;

// jsdom has no real WebGL implementation, so these stub
// HTMLCanvasElement.prototype.getContext directly to exercise
// isMapRenderingSupported's own webgl2/webgl/neither/throwing decision
// branches — this proves the fallback logic, not that jsdom (or a real
// browser) can actually render WebGL. The fake contexts below are never
// real RenderingContext values, only truthy/falsy stand-ins for "was a
// context returned", so the implementation is cast rather than typed
// against getContext's real overloaded return union.
function stubGetContext(implementation: (contextId: string) => unknown): GetContextStub {
  return vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(implementation as unknown as HTMLCanvasElement["getContext"]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isMapRenderingSupported", () => {
  it("returns true when webgl2 is available", () => {
    const getContext = stubGetContext((contextId) =>
      contextId === "webgl2" ? {} : null,
    );

    expect(isMapRenderingSupported()).toBe(true);
    expect(getContext).toHaveBeenCalledWith("webgl2");
  });

  it("falls back to webgl when webgl2 is unavailable", () => {
    stubGetContext((contextId) => (contextId === "webgl" ? {} : null));

    expect(isMapRenderingSupported()).toBe(true);
  });

  it("returns false when neither webgl2 nor webgl is available", () => {
    stubGetContext(() => null);

    expect(isMapRenderingSupported()).toBe(false);
  });

  it("returns false when getContext throws", () => {
    stubGetContext(() => {
      throw new Error("simulated capability check failure");
    });

    expect(isMapRenderingSupported()).toBe(false);
  });
});
