import { describe, expect, it } from "vitest";
import { CSP_POLICY, cspPlugin, injectCspMeta } from "./vite.csp.ts";

const FIXTURE_HEAD = `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <title>Fixture</title>
  </head>
  <body>
  </body>
</html>
`;

describe("injectCspMeta", () => {
  it("inserts the CSP meta tag immediately after the charset declaration", () => {
    const result = injectCspMeta(FIXTURE_HEAD);
    const charsetIndex = result.indexOf('<meta charset="UTF-8" />');
    const cspIndex = result.indexOf("Content-Security-Policy");
    const viewportIndex = result.indexOf('name="viewport"');

    expect(charsetIndex).toBeGreaterThan(-1);
    expect(cspIndex).toBeGreaterThan(charsetIndex);
    expect(viewportIndex).toBeGreaterThan(cspIndex);
  });

  it("carries the exact approved policy content, unmodified", () => {
    const result = injectCspMeta(FIXTURE_HEAD);
    expect(result).toContain(`content="${CSP_POLICY}"`);
  });

  it("throws when the charset anchor is not present", () => {
    expect(() => injectCspMeta("<html><head></head></html>")).toThrow(/charset anchor/);
  });
});

describe("cspPlugin", () => {
  it("only applies during build, never dev/serve", () => {
    expect(cspPlugin().apply).toBe("build");
  });
});
