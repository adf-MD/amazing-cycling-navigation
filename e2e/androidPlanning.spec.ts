import { expect, test } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves Planning (CLAUDE.md backlog item 25) under Android device
// emulation (this file's own "android-chrome" Playwright project,
// devices["Pixel 7"] — Chromium-emulated, not real Android Chrome; see
// docs/android-chrome-acceptance.md). Mirrors planning.spec.ts's own
// first test closely, including its documented addInitScript
// fetch-rebind workaround, but stays deliberately narrower: only the
// default Road bike (cycling-road) profile is exercised here —
// planning.spec.ts's own "selecting General cycling..." test, plus
// PlanningScreen's own unit/component coverage, already prove profile
// selection; this file's purpose is proving the flow still works under
// mobile viewport/touch/UA emulation, not re-proving profile selection a
// second time.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

const MOCK_ORS_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { summary: { distance: 950, duration: 200 } },
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.1, 51.5, 10],
          [-0.099, 51.5005, 12],
          [-0.098, 51.501, 15],
          [-0.097, 51.5015, 20],
          [-0.096, 51.502, 25],
        ],
      },
    },
  ],
};

test("configures a key, plans a route via a mocked ORS response, saves it, and reopens it without the provider", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();

  let capturedUrl: string | null = null;
  await page.route(ORS_URL_GLOB, async (route) => {
    const request = route.request();
    if (request.method() === "POST") capturedUrl = request.url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(MOCK_ORS_RESPONSE),
    });
  });

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 100, y: 100 } });
  await mapContainer.click({ position: { x: 200, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });
  expect(capturedUrl).toContain("/directions/cycling-road/geojson");

  const routeName = "Android Planned Loop";
  await page.getByLabel("Route name").fill(routeName);
  await page.getByRole("button", { name: /save route/i }).click();

  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  // Reopening a saved route must never need the provider — unroute the
  // mock and fail loudly if anything still tries to reach it.
  await page.unroute(ORS_URL_GLOB);
  let unexpectedOrsRequest = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    unexpectedOrsRequest = true;
    await route.abort("failed");
  });

  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
