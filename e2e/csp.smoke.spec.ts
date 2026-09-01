import { expect, test } from "@playwright/test";
import {
  attemptInlineScriptProbe,
  installCspViolationListener,
  parseCspDirectives,
  readCspMetaTags,
  waitForServiceWorkerRegistration,
} from "./support/csp.ts";
import { forceMapStyleFailure, installLocalMapStyle } from "./support/localMapStyle.ts";

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

/** Minimal mocked ORS directions response — enough for the app to reach
 * its own "routed" state (RouteSummaryPanel renders), without the
 * surface-classification detail planning.spec.ts's own larger fixture
 * carries, since that is not what this smoke test proves. */
const MOCK_ORS_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        summary: { distance: 950, duration: 200, ascent: 10, descent: 10 },
        segments: [
          {
            distance: 950,
            duration: 200,
            steps: [
              {
                distance: 950,
                duration: 200,
                type: 0,
                instruction: "Head north",
                way_points: [0, 1],
              },
            ],
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.1, 51.5, 10],
          [-0.099, 51.5005, 12],
        ],
      },
    },
  ],
};

// Filename deliberately ends in the literal lowercase suffix
// "smoke.spec.ts": playwright.config.ts's webkit-smoke project matches
// only that suffix, and its chromium project excludes only
// android*.spec.ts — so this file runs under both chromium and
// webkit-smoke, and not under android-chrome, with no config change.
// This is the durable, committed evidence for backlog item 93 (item 90's
// own throwaway investigation, made permanent): it restores the full
// cross-engine compatibility boundary item 90 proved on both Chromium
// and WebKit, not a narrowed chromium-only subset.

// The exact approved recommended-compatibility policy from item 90,
// hand-typed here rather than imported from vite.csp.ts's own CSP_POLICY
// constant — so a typo in the production plugin's literal is never
// "confirmed" by a test that is really just comparing a string to itself.
const EXPECTED_DIRECTIVES = new Map<string, string[]>([
  ["default-src", ["'none'"]],
  ["script-src", ["'self'"]],
  ["style-src", ["'self'"]],
  ["img-src", ["'self'", "data:", "blob:"]],
  ["connect-src", ["'self'", "https://tiles.openfreemap.org", "https://api.heigit.org"]],
  ["worker-src", ["'self'"]],
  ["manifest-src", ["'self'"]],
  ["font-src", ["'self'"]],
  ["object-src", ["'none'"]],
  ["base-uri", ["'none'"]],
  ["form-action", ["'none'"]],
]);

function sortedEntries(directives: Map<string, string[]>): [string, string[]][] {
  return [...directives.entries()]
    .map(([name, sources]) => [name, [...sources].sort()] as [string, string[]])
    .sort(([a], [b]) => a.localeCompare(b));
}

test("the shipped Content-Security-Policy has exactly the approved directives and sources", async ({
  page,
}) => {
  await page.goto("/");

  const metaTags = await readCspMetaTags(page);
  expect(metaTags).toHaveLength(1);

  const actual = parseCspDirectives(metaTags[0]?.content ?? "");
  expect(actual.size).toBe(EXPECTED_DIRECTIVES.size);
  expect(sortedEntries(actual)).toEqual(sortedEntries(EXPECTED_DIRECTIVES));
});

test("blocks and reports a forbidden inline script", async ({ page }) => {
  const { violations } = await installCspViolationListener(page);

  await page.goto("/");

  const { executed } = await attemptInlineScriptProbe(page);
  expect(executed).toBe(false);

  // The exposeBinding round-trip is an async IPC hop, not guaranteed
  // complete the instant attemptInlineScriptProbe's own page.evaluate
  // resolves — poll until the violation actually arrives, per
  // support/csp.ts's documented contract.
  await expect.poll(() => violations.length, { timeout: 5_000 }).toBeGreaterThan(0);

  // Exactly one — proves no unexplained extra violation accompanied the
  // expected one.
  expect(violations).toHaveLength(1);
  const violation = violations[0];
  expect(violation).toBeDefined();
  // CSP3's script-src-elem falls back to script-src when not separately
  // specified; browsers differ on whether they report the fallback's own
  // name or the more specific sub-directive for an element-level
  // violation. The actual value observed on each engine is recorded in
  // the item-93 history entry rather than presumed to be a single fixed
  // string.
  expect(["script-src", "script-src-elem"]).toContain(violation.effectiveDirective);
  expect(violation.blockedURI).toBe("inline");
  expect(violation.disposition).toBe("enforce");
});

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation, see
// planning.spec.ts and mapStyleReadiness.spec.ts, which need the same
// workaround) — both tests below mock a network host directly. Scoped to
// this describe block only, since the bounded-service-worker-registration
// test further below needs a real, unblocked service worker.
test.describe("mocked network flows", () => {
  test.use({ serviceWorkers: "block" });

  test("Planning map startup, a waypoint marker, and a mocked OpenRouteService route are CSP-clean", async ({
    page,
  }) => {
    const { violations } = await installCspViolationListener(page);
    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    let capturedUrl: string | null = null;
    await page.route(ORS_URL_GLOB, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        capturedUrl = request.url();
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(MOCK_ORS_RESPONSE),
      });
    });

    await page.goto("/");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
    await page.getByRole("button", { name: "Save on this device" }).click();

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 100, y: 100 } });

    // Proves script-src/style-src need no relaxation for a real MapLibre
    // Marker DOM element to render.
    await expect(page.locator(".planning-waypoint-marker")).toHaveCount(1);

    await mapContainer.click({ position: { x: 200, y: 150 } });

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    // Waiting for the actual routed-state panel — not merely for the
    // captured request URL — proves the mocked response was genuinely
    // consumed under this policy, not just that a request was attempted.
    await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
      timeout: 15_000,
    });

    expect(capturedUrl).toContain("/directions/cycling-road/geojson");
    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(violations).toEqual([]);
  });

  test("a forced map-style failure activates the fallback banner with no CSP violations", async ({
    page,
  }) => {
    const { violations } = await installCspViolationListener(page);
    await forceMapStyleFailure(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Plan" }).click();

    // Proves the fallback was triggered by the deliberate abort, not a
    // CSP block — closing the loop on backlog item 90's own finding that
    // the app's fallback path can otherwise make a CSP-blocked style
    // masquerade as a successful one via data-map-ready alone.
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

    expect(violations).toEqual([]);
  });
});

// Proves CSP-clean *registration* only, on both chromium and
// webkit-smoke. Deliberately does not attempt genuine offline-reload or
// service-worker-caching behaviour here: no existing spec in this
// repository exercises real WebKit offline/SW-controller behaviour
// today (androidOfflineAppShell.spec.ts's own pattern is
// Chromium/Android-emulation-only) — manufacturing a first-of-its-kind
// WebKit offline test inside this slice would produce an unproven,
// not-truthfully-established result rather than a real regression
// guard. This is a stated, documented limitation (see the item-93
// history entry), not a silent omission.
test("service-worker registration completes within a bounded time with no CSP violations", async ({
  page,
}) => {
  const { violations } = await installCspViolationListener(page);

  await page.goto("/");

  const registration = await waitForServiceWorkerRegistration(page);
  expect(registration).not.toBeNull();

  expect(violations).toEqual([]);
});
