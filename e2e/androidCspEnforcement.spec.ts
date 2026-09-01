import { expect, test } from "@playwright/test";
import { attemptInlineScriptProbe, installCspViolationListener } from "./support/csp.ts";

// Isolated deliberately: merely finding the CSP meta element and
// observing zero violations elsewhere (androidOfflineAppShell.spec.ts's
// own whole-lifetime collector) could pass even if enforcement were
// silently ineffective under Chromium-Android emulation specifically.
// This proves the policy actually blocks something under that exact
// emulated environment, in its own file/page so this test's one
// deliberately-triggered violation can never be read as "unexpected" by
// a different test's separate zero-violations collector.

test("blocks and reports a forbidden inline script under Android-Chromium emulation", async ({
  page,
}) => {
  const { violations } = await installCspViolationListener(page);

  await page.goto("/");

  const { executed } = await attemptInlineScriptProbe(page);
  expect(executed).toBe(false);

  await expect.poll(() => violations.length, { timeout: 5_000 }).toBeGreaterThan(0);

  expect(violations).toHaveLength(1);
  const violation = violations[0];
  expect(violation).toBeDefined();
  expect(["script-src", "script-src-elem"]).toContain(violation.effectiveDirective);
  expect(violation.blockedURI).toBe("inline");
  expect(violation.disposition).toBe("enforce");
});
