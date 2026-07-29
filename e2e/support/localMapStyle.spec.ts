import { expect, test } from "@playwright/test";
import { isRecognisedLibertyStyleRequest } from "./localMapStyle.ts";

// Pure logic only — no `page` fixture requested by any test() below, so
// none of these launch a browser page; they run as plain function calls
// inside the Playwright test runner.
test.describe("isRecognisedLibertyStyleRequest", () => {
  test("recognises the exact style URL", () => {
    expect(
      isRecognisedLibertyStyleRequest("https://tiles.openfreemap.org/styles/liberty"),
    ).toBe(true);
  });

  test("recognises the style URL with a trailing slash", () => {
    expect(
      isRecognisedLibertyStyleRequest("https://tiles.openfreemap.org/styles/liberty/"),
    ).toBe(true);
  });

  test("recognises the style URL with a query string", () => {
    expect(
      isRecognisedLibertyStyleRequest("https://tiles.openfreemap.org/styles/liberty?v=3"),
    ).toBe(true);
  });

  test("rejects a tile sub-path on the same host", () => {
    expect(
      isRecognisedLibertyStyleRequest(
        "https://tiles.openfreemap.org/planet/20/1/2/3.pbf",
      ),
    ).toBe(false);
  });

  test("rejects a sprite sub-path on the same host", () => {
    expect(
      isRecognisedLibertyStyleRequest(
        "https://tiles.openfreemap.org/sprites/liberty.json",
      ),
    ).toBe(false);
  });

  test("rejects a glyph sub-path on the same host", () => {
    expect(
      isRecognisedLibertyStyleRequest(
        "https://tiles.openfreemap.org/fonts/Noto Sans Regular/0-255.pbf",
      ),
    ).toBe(false);
  });

  test("rejects a completely different host", () => {
    expect(isRecognisedLibertyStyleRequest("https://api.heigit.org/styles/liberty")).toBe(
      false,
    );
  });

  test("rejects an unparseable URL rather than throwing", () => {
    expect(() => isRecognisedLibertyStyleRequest("not a url")).not.toThrow();
    expect(isRecognisedLibertyStyleRequest("not a url")).toBe(false);
  });
});
