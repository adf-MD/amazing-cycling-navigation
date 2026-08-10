import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { forceMapStyleFailure, installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves persistence/reload/offline saved-route use (CLAUDE.md backlog
// item 25) under Android device emulation (this file's own
// "android-chrome" Playwright project, devices["Pixel 7"]).
//
// A genuine architectural nuance, confirmed by reading App.tsx directly:
// `screen`/`selectedRoute` are plain, unpersisted React state, with no
// mount-time read of the stored active-ride row. A real page.reload()
// during a ride therefore returns the rider to the Routes screen, not
// back into Riding automatically — recovery only happens once the rider
// reopens the *same* route (matched by routeId in useRideNavigation.ts),
// at which point the persisted fix/progress restore and the pre-ride
// panel offers "Resume riding" instead of "Start riding". The first test
// below asserts this real contract precisely, through an actual
// page.reload() — no test at any level (hook, component or e2e)
// previously did this.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";
const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Matches ridingNextManoeuvre.spec.ts's own conversion factor, at the
// same latitude — duplicated locally per this repo's established
// no-shared-e2e-helpers convention.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 900;
const ROUTE_SEGMENTS = 9;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildMockOrsResponse() {
  const coordinates = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return [lonAtMetres(distanceMetres), ROUTE_LAT, 10];
  });
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: ROUTE_LENGTH_METRES, duration: 200 } },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

test("a genuine reload lands back on Routes, not Riding; reopening the same route offers Resume riding with restored progress and makes no further OpenRouteService request", async ({
  page,
  context,
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

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

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
      body: JSON.stringify(buildMockOrsResponse()),
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

  const routeName = "Android Reload Recovery Route";
  await page.getByLabel("Route name").fill(routeName);
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  // Lets the last accepted fix's persistence effect (an async IndexedDB
  // write with no UI signal to poll on) actually complete before
  // navigating away — mirrors ridingNextManoeuvre.spec.ts's identical
  // reload precondition.
  await page.waitForTimeout(300);

  await page.unroute(ORS_URL_GLOB);
  let unexpectedOrsRequest = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    unexpectedOrsRequest = true;
    await route.abort("failed");
  });

  await page.reload();

  // The real, previously-undocumented contract: a reload does NOT return
  // to Riding by itself.
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  // The persisted fix from before the reload restores immediately, so the
  // pre-ride panel offers Resume riding, not Start riding.
  const resumeButton = page.getByRole("button", { name: "Resume riding" });
  await expect(resumeButton).toBeVisible();
  await resumeButton.click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("opening a saved route into Riding still renders it on the local fallback style when tile/style requests are blocked", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    // Deliberate, expected artefact of forceMapStyleFailure's aborted
    // requests — filtered out the same way directionArrows.spec.ts and
    // distanceBadges.spec.ts already do for this exact helper.
    if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  // Never combined with installLocalMapStyle in the same test — see
  // localMapStyle.ts's own documented mutual exclusivity.
  await forceMapStyleFailure(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();

  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId("map-fallback-banner")).toBeVisible();
  await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();
  await expect(page.locator('[data-testid="map-container"] canvas')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("a saved route stays usable — route, progress and elevation — with the network fully down", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();

  await context.setOffline(true);
  try {
    await expect(page.getByText(/^Offline/)).toBeVisible();
    await expect(page.locator('[data-testid="map-container"] canvas')).toBeVisible();
    await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Elevation profile view" }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
