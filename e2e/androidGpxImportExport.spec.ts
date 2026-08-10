import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves GPX import/export (CLAUDE.md backlog item 25) under Android
// device emulation (this file's own "android-chrome" Playwright project,
// devices["Pixel 7"] — Chromium-emulated, not real Android Chrome; see
// docs/android-chrome-acceptance.md). setInputFiles/page.waitForEvent
// ("download") are CDP-driven and behave identically regardless of
// device emulation, so this file's genuine new value is proving the
// existing import/export flow still works with a mobile viewport/touch/
// UA context active — not a claim about Android's real file-picker,
// notification, or Files-app/share-sheet behaviour, which stays
// real-device-only.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";
const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

test("imports a GPX file via the real file input and opens it", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);

  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: "smoke-route" })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("exports a planned route to GPX with the expected filename and ACN manoeuvre content, then re-imports it entirely offline", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  // See planning.spec.ts's identical workaround: without this, the POST
  // to the (page.route-mocked) ORS endpoint intermittently never reaches
  // Playwright's request interception in this test environment.
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

  await page.route(ORS_URL_GLOB, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              summary: { distance: 950, duration: 200 },
              segments: [
                {
                  distance: 950,
                  duration: 200,
                  steps: [
                    {
                      distance: 950,
                      duration: 200,
                      type: 0,
                      instruction: "Turn left onto Church Lane",
                      way_points: [0, 9],
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
                [-0.098, 51.501, 15],
                [-0.097, 51.5015, 20],
                [-0.096, 51.502, 25],
                [-0.095, 51.5025, 22],
                [-0.094, 51.503, 18],
                [-0.093, 51.5035, 14],
                [-0.092, 51.504, 11],
                [-0.091, 51.5045, 9],
              ],
            },
          },
        ],
      }),
    });
  });

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 100, y: 100 } });
  await mapContainer.click({ position: { x: 200, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });

  const routeName = "Android Export Roundtrip Route";
  await page.getByLabel("Route name").fill(routeName);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /export gpx/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${routeName}.gpx`);

  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("expected a downloaded file to have a local path");
  const gpxContents = await readFile(downloadPath, "utf-8");
  expect(gpxContents).toContain("acn:navigation");
  expect(gpxContents).toContain("Turn left onto Church Lane");

  // Block ORS entirely — the re-import below must stand entirely on the
  // GPX file's own ACN-encoded manoeuvres.
  await page.unroute(ORS_URL_GLOB);
  let unexpectedOrsRequest = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    unexpectedOrsRequest = true;
    await route.abort("failed");
  });

  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByLabel("Import GPX file").setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpxContents),
  });

  const importedRouteButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(importedRouteButton).toBeVisible();
  await importedRouteButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
