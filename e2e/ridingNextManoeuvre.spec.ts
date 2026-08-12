import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround for ORS mocking.
test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Metres per degree of longitude at latitude 51.5 — the same conversion
// factor distanceBadges.spec.ts's own fixture uses (also at 51.5), reused
// here rather than re-derived.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 1400;
const ROUTE_SEGMENTS = 10;
const LEFT_TURN_DISTANCE_METRES = 700;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

// Deterministic replacement for a fixed sleep before a reload: poll the
// real committed IndexedDB rideState row for the route's own persisted,
// presentation-driving progress — lastReliableMatchedDistanceFromStartMetres,
// the exact field nextManoeuvre.ts's selectNextManoeuvre reads, never the
// live/raw matchedDistanceFromStartMetres — reaching the last accepted
// fix's own along-route distance, rather than assume any fixed delay is
// long enough for the persistence effect's async, un-throttled Dexie write
// (useRideNavigation.ts) to land.
async function waitForCommittedRideProgress(
  page: Page,
  routeId: string,
  minimumMatchedDistanceMetres: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const row = await readActiveRideStateRow(page);
        const reliableMatchedDistance = row?.lastReliableMatchedDistanceFromStartMetres;
        return {
          routeId: typeof row?.routeId === "string" ? row.routeId : null,
          hasLastFix: row?.lastFix != null,
          reachedThreshold:
            typeof reliableMatchedDistance === "number" &&
            reliableMatchedDistance >= minimumMatchedDistanceMetres,
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({ routeId, hasLastFix: true, reachedThreshold: true });
}

/**
 * A fixed, realistic single-leg ORS response with two manoeuvre steps
 * (a left turn partway, then arrival at the finish) — deliberately
 * independent of where the test actually clicks on the map. A single-leg
 * response's geometry is never checked against the requested waypoints
 * (only a multi-leg stitch's own seam continuity is — see
 * stitchPlannedRouteLegs.test.ts for that coverage, and planning.spec.ts's
 * own first test, which relies on the same fact with a fixed mock
 * response). Known, fixed coordinates let this test drive geolocation to
 * precise distances along the route afterwards. The multi-leg
 * waypoint-seam-collapse behaviour is exercised directly and thoroughly in
 * stitchPlannedRouteLegs.test.ts; this spec deliberately keeps to a single
 * leg to stay focused on the Riding-side integration (provider mocking,
 * saved-route persistence, GPS-driven advancement, UI prominence).
 */
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
        properties: {
          summary: { distance: ROUTE_LENGTH_METRES, duration: 300 },
          segments: [
            {
              distance: ROUTE_LENGTH_METRES,
              duration: 300,
              steps: [
                {
                  distance: LEFT_TURN_DISTANCE_METRES,
                  duration: 150,
                  type: 0,
                  instruction: "Turn left onto Church Lane",
                  way_points: [5, 10],
                },
                {
                  distance: 0,
                  duration: 0,
                  type: 10,
                  instruction: "Arrive at your destination",
                  way_points: [10, 10],
                },
              ],
            },
          ],
        },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

test("shows the next trusted manoeuvre in Riding, advances with progress, becomes more prominent approaching a turn, and survives a reload without another routing request", async ({
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
  // See planning.spec.ts's identical workaround: without this, the POST to
  // the (page.route-mocked) ORS endpoint intermittently never reaches
  // Playwright's request interception at all in this test environment.
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

  let orsRequestCount = 0;
  await page.route(ORS_URL_GLOB, async (route) => {
    if (route.request().method() === "POST") orsRequestCount += 1;
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

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });
  expect(orsRequestCount).toBe(1);

  const routeName = "E2E Manoeuvre Route";
  await page.getByLabel("Route name").fill(routeName);
  await page.getByRole("button", { name: /save route/i }).click();

  // Saving switches straight to Riding mode with the new route.
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  // The rider starts well before the turn.
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(50) });
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(page.getByText("Turn left onto Church Lane")).toBeVisible();

  // Advance well past the turn's own reached tolerance — the panel must
  // move on to the finish manoeuvre, not linger on the passed turn.
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(LEFT_TURN_DISTANCE_METRES + 50),
  });
  await expect(page.getByText("Arrive at your destination")).toBeVisible();
  await expect(page.getByText("Turn left onto Church Lane")).toBeHidden();

  // Move to 400 m from the finish (the "near" prominence band).
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(ROUTE_LENGTH_METRES - 400),
  });
  await expect(page.getByText("400 m")).toBeVisible();
  const nearFontSizePx = await page
    .getByText("400 m")
    .evaluate((element) => window.getComputedStyle(element).fontSize);

  // Move to 50 m from the finish (the "imminent" prominence band) — the
  // same distance text element must render visually larger, not merely a
  // different value.
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(ROUTE_LENGTH_METRES - 50),
  });
  await expect(page.getByText("50 m")).toBeVisible();
  const imminentFontSizePx = await page
    .getByText("50 m")
    .evaluate((element) => window.getComputedStyle(element).fontSize);

  expect(Number.parseFloat(imminentFontSizePx)).toBeGreaterThan(
    Number.parseFloat(nearFontSizePx),
  );

  // Reload: the saved route's manoeuvres must remain available without any
  // further routing request. The "50 m" assertion above already proves
  // the last fix was UI-accepted; poll the real committed rideState row
  // for the same progress before reloading, rather than assume a fixed
  // delay is long enough for the persistence effect's async, un-throttled
  // Dexie write to land.
  const savedRouteId = await readSavedRouteId(page, routeName);
  if (!savedRouteId) throw new Error("expected the saved route to have a persisted id");
  await waitForCommittedRideProgress(page, savedRouteId, ROUTE_LENGTH_METRES - 100);
  await page.unroute(ORS_URL_GLOB);
  let unexpectedOrsRequest = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    unexpectedOrsRequest = true;
    await route.abort("failed");
  });

  // A reload always returns to the Route Library (App.tsx keeps no
  // persisted "last screen") — only the route's own progress/fix state
  // restores, once the route is reopened into Riding.
  await page.reload();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await page.getByRole("button", { name: "Resume riding" }).click();

  // The stale/"last known position" qualifier is already covered directly
  // by RidingNextManoeuvrePanel.test.tsx and RidingScreen.test.tsx's own
  // restoration tests (using a stub geolocation source with explicit fix
  // control); it isn't reliably observable here, since Playwright's
  // context.setGeolocation mock answers a fresh watchPosition call
  // immediately, clearing staleness before this assertion could run. The
  // integration proof that matters at this layer — that the manoeuvre
  // survives a reload and reopen without any further routing request — is
  // what the assertions below establish.
  await expect(page.getByText("Arrive at your destination")).toBeVisible();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("preserves trusted manoeuvres through export and re-import, entirely offline", async ({
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

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

  const routeName = "E2E Export Roundtrip Route";
  await page.getByLabel("Route name").fill(routeName);

  // Export without ever saving to the local library — the route opened at
  // the end of this test must stand entirely on the GPX file's own
  // ACN-encoded manoeuvres, never on a locally saved copy of the planner
  // route.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /export gpx/i }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("expected a downloaded file to have a local path");
  const gpxContents = await readFile(downloadPath, "utf-8");
  expect(gpxContents).toContain("acn:navigation");
  expect(gpxContents).toContain("Turn left onto Church Lane");

  // Block ORS entirely from this point on — importing, opening, and
  // riding the re-imported route below must work without any further
  // routing-provider request.
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

  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(50) });
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(page.getByText("Turn left onto Church Lane")).toBeVisible();

  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(LEFT_TURN_DISTANCE_METRES + 50),
  });
  await expect(page.getByText("Arrive at your destination")).toBeVisible();
  await expect(page.getByText("Turn left onto Church Lane")).toBeHidden();

  // Reload to prove the re-imported route's manoeuvres survive suspension/
  // reload, still without any routing request. The "Arrive at your
  // destination" assertion above already proves the last fix was
  // UI-accepted; poll the real committed rideState row for the same
  // progress before reloading — same rationale as the first test above.
  const savedRouteId = await readSavedRouteId(page, routeName);
  if (!savedRouteId)
    throw new Error("expected the imported route to have a persisted id");
  await waitForCommittedRideProgress(page, savedRouteId, LEFT_TURN_DISTANCE_METRES);
  await page.reload();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await page.getByRole("button", { name: "Resume riding" }).click();
  await expect(page.getByText("Arrive at your destination")).toBeVisible();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test.describe("ordinary imported GPX", () => {
  const FIXTURE_GPX_PATH = fileURLToPath(
    new URL("./fixtures/smoke-route.gpx", import.meta.url),
  );

  test("never shows an inferred turn, only the explicit no-trusted-data message", async ({
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

    const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    await expect(
      page.getByText(
        "No trusted turn information is available for this imported GPX. Follow the route line on the map.",
      ),
    ).toBeVisible();

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
