import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { downloadTextFile } from "./downloadTextFile.ts";

describe("downloadTextFile", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: MockInstance<() => void>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clickSpy.mockRestore();
  });

  it("creates an object URL, triggers a download and revokes the URL", () => {
    downloadTextFile("route.gpx", "<gpx></gpx>", "application/gpx+xml");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("revokes the URL even if the click throws", () => {
    clickSpy.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => {
      downloadTextFile("route.gpx", "<gpx></gpx>", "application/gpx+xml");
    }).toThrow("boom");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
