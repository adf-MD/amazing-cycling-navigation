import { expect, test } from "@playwright/test";
import { parseCspDirectives } from "./csp.ts";

// Pure logic only — no `page` fixture requested by any test() below, so
// none of these launch a browser page; they run as plain function calls
// inside the Playwright test runner. Mirrors localMapStyle.spec.ts's own
// pure-logic-unit-test shape.
const APPROVED_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
  "connect-src 'self' https://tiles.openfreemap.org https://api.heigit.org; worker-src 'self'; " +
  "manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';";

test.describe("parseCspDirectives", () => {
  test("parses the real approved policy into 11 directives with the correct sources", () => {
    const directives = parseCspDirectives(APPROVED_POLICY);
    expect(directives.size).toBe(11);
    expect(directives.get("default-src")).toEqual(["'none'"]);
    expect(directives.get("script-src")).toEqual(["'self'"]);
    expect(directives.get("style-src")).toEqual(["'self'"]);
    expect(directives.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directives.get("connect-src")).toEqual([
      "'self'",
      "https://tiles.openfreemap.org",
      "https://api.heigit.org",
    ]);
    expect(directives.get("worker-src")).toEqual(["'self'"]);
    expect(directives.get("manifest-src")).toEqual(["'self'"]);
    expect(directives.get("font-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'none'"]);
  });

  test("tolerates a missing trailing semicolon", () => {
    const directives = parseCspDirectives("default-src 'none'; script-src 'self'");
    expect(directives.size).toBe(2);
  });

  test("tolerates extra whitespace and empty segments", () => {
    const directives = parseCspDirectives(
      "  default-src   'none' ;; script-src 'self' ;  ",
    );
    expect(directives.size).toBe(2);
    expect(directives.get("default-src")).toEqual(["'none'"]);
  });

  test("lower-cases directive names, since they are case-insensitive per CSP3", () => {
    const directives = parseCspDirectives("Default-Src 'none';");
    expect(directives.has("default-src")).toBe(true);
    expect(directives.has("Default-Src")).toBe(false);
  });

  test("preserves a duplicated source token within one directive, rather than deduping it", () => {
    const directives = parseCspDirectives("script-src 'self' 'self';");
    expect(directives.get("script-src")).toEqual(["'self'", "'self'"]);
  });

  test("throws when a directive name is repeated within one policy string", () => {
    expect(() => parseCspDirectives("script-src 'self'; script-src 'none';")).toThrow(
      /repeats/,
    );
  });
});
