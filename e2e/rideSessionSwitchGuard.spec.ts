import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import {
  readActiveRideStateRow,
  readSavedRouteId,
  writeActiveRideStateRow,
} from "./support/rideStateDb.ts";

// Proves backlog item 73 (guard every unfinished-session switch against
// silent replacement): a genuinely different unfinished session — a
// different route, or the other session kind — must never be silently
// overwritten by opening/starting a new one. Same-route/same-free-roam
// recovery must stay dialog-free (items 42/72's own established one-tap
// contracts), and a confirmed switch must clear storage before the
// replacement opens/starts.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Matches ridingLauncher.spec.ts's own conversion factor, at the same
// latitude — duplicated locally per this repo's established no-shared-
// e2e-helpers-across-specs convention.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;
const FREE_ROAM_START = { latitude: 51.6, longitude: -0.2 };

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

async function waitForClearedRideState(page: Page): Promise<void> {
  await expect.poll(() => readActiveRideStateRow(page), { timeout: 10_000 }).toBeNull();
}

/** A simple, straight, densely-sampled GPX track — deliberately independent
 * of OpenRouteService, matching ridingLauncher.spec.ts's own fixture. */
function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Ride switch guard test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function importRoute(page: Page, routeName: string): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${routeName}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });
  await expect(page.getByRole("button", { name: routeName, exact: true })).toBeVisible();
}

/** Mirrors ridingLauncher.spec.ts's own identical helper — duplicated
 * locally per this repo's established convention. */
async function installGeolocationWatchCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const geolocation = navigator.geolocation;
    const original = geolocation.watchPosition.bind(geolocation);
    (
      window as unknown as { __e2eWatchPositionCallCount: number }
    ).__e2eWatchPositionCallCount = 0;
    geolocation.watchPosition = (
      ...args: Parameters<typeof geolocation.watchPosition>
    ) => {
      (
        window as unknown as { __e2eWatchPositionCallCount: number }
      ).__e2eWatchPositionCallCount += 1;
      return original(...args);
    };
  });
}

async function readWatchPositionCallCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eWatchPositionCallCount?: number })
        .__e2eWatchPositionCallCount ?? 0,
  );
}

/** Mirrors ridingLauncher.spec.ts's own identical helper (see its own doc
 * comment for why polling for the committed row, not merely the UI text,
 * matters) — duplicated locally per this repo's established convention. */
async function establishUnfinishedRide(
  page: Page,
  context: BrowserContext,
  routeName: string,
) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  await page.goto("/");
  await importRoute(page, routeName);
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();

  const routeId = await readSavedRouteId(page, routeName);
  expect(routeId).not.toBeNull();
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ routeId, lastFix: expect.anything() });
  return routeId;
}

/** Mirrors freeRoam.spec.ts's own identical helper — duplicated locally. */
async function startFreeRoam(page: Page, context: BrowserContext): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(FREE_ROAM_START);

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
}

test("route A unfinished + opening route B shows a confirmation before any replacement; Cancel preserves A's exact row, and confirming clears it before B opens idle with no watch", async ({
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

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeAName = "switch-guard-route-a";
  const routeBName = "switch-guard-route-b";

  await establishUnfinishedRide(page, context, routeAName);
  await installGeolocationWatchCounter(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await importRoute(page, routeBName);

  const routeARowBefore = await readActiveRideStateRow(page);
  const routeBButton = page.getByRole("button", { name: routeBName, exact: true });
  await routeBButton.click();

  // exact:true — the dialog's own title ("Switch to "routeBName"?") would
  // otherwise substring-match this same query while it's open.
  await expect(page.getByRole("heading", { name: routeBName, exact: true })).toBeHidden();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/unfinished ride on another route/i)).toBeVisible();
  expect(await readActiveRideStateRow(page)).toEqual(routeARowBefore);
  expect(await readWatchPositionCallCount(page)).toBe(0);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await readActiveRideStateRow(page)).toEqual(routeARowBefore);
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await expect(routeBButton).toBeFocused();

  await routeBButton.click();
  const confirmDialog = page.getByRole("alertdialog");
  await confirmDialog.getByRole("button", { name: "End and switch" }).click();

  await waitForClearedRideState(page);
  await expect(page.getByRole("heading", { name: routeBName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(0);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a stale launcher render exposing Start free roam is still guarded once a route session becomes active after hydration — clear happens before the fresh free-roam row is written, before the watch starts", async ({
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

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  await installGeolocationWatchCounter(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(FREE_ROAM_START);

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  const startFreeRoamButton = page.getByRole("button", { name: "Start free roam" });
  await expect(startFreeRoamButton).toBeVisible();

  // Storage changes after the launcher's own hydration already resolved to
  // "none" — there is no honest way to expose this through ordinary UI
  // interaction alone (the app never writes a conflicting row behind its
  // own back), so it's injected directly, mirroring this file's other
  // tests' reliance on direct IndexedDB fixtures for preconditions.
  const injectedRouteRow = {
    id: "active",
    routeId: "stale-hydration-route-id",
    startedAt: new Date().toISOString(),
    lastFix: null,
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
  };
  await writeActiveRideStateRow(page, injectedRouteRow);

  await startFreeRoamButton.click();

  // Guarded, not silently overwritten.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/unfinished ride on another route/i)).toBeVisible();
  expect(await readActiveRideStateRow(page)).toEqual(injectedRouteRow);
  expect(await readWatchPositionCallCount(page)).toBe(0);

  await dialog.getByRole("button", { name: "End and switch" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam" });
  await expect.poll(() => readWatchPositionCallCount(page)).toBe(1);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("free roam unfinished + opening a route shows the same confirmation lifecycle; Cancel preserves free roam, confirming clears it before the route opens", async ({
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

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeName = "switch-guard-route-after-free-roam";

  await startFreeRoam(page, context);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => page.getByText(/GPS ±/).isVisible()).toBe(true);
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam", lastFix: expect.anything() });

  await installGeolocationWatchCounter(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await importRoute(page, routeName);

  const freeRoamRowBefore = await readActiveRideStateRow(page);
  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await routeButton.click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/unfinished free roam session/i)).toBeVisible();
  expect(await readActiveRideStateRow(page)).toEqual(freeRoamRowBefore);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await readActiveRideStateRow(page)).toEqual(freeRoamRowBefore);

  await routeButton.click();
  const confirmDialog = page.getByRole("alertdialog");
  await confirmDialog.getByRole("button", { name: "End and switch" }).click();

  await waitForClearedRideState(page);
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(0);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("resuming the exact same unfinished route via the launcher starts exactly one watch with no destructive confirmation (item 72 unaffected)", async ({
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

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeName = "switch-guard-same-route-resume";

  await installGeolocationWatchCounter(page);
  await establishUnfinishedRide(page, context, routeName);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();

  const resumeButton = page.getByRole("button", { name: "Resume ride" });
  await expect(resumeButton).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(0);
  await expect(page.getByRole("alertdialog")).toBeHidden();

  await resumeButton.click();

  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect.poll(() => readWatchPositionCallCount(page)).toBe(1);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("resuming the exact same unfinished free-roam session starts exactly one watch with no destructive confirmation", async ({
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

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await startFreeRoam(page, context);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => page.getByText(/GPS ±/).isVisible()).toBe(true);
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam", lastFix: expect.anything() });

  await installGeolocationWatchCounter(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();

  const resumeFreeRoamButton = page.getByRole("button", { name: "Resume free roam" });
  await expect(resumeFreeRoamButton).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(0);
  await expect(page.getByRole("alertdialog")).toBeHidden();

  await resumeFreeRoamButton.click();

  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect.poll(() => readWatchPositionCallCount(page)).toBe(1);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a Planning save while a different route is unfinished shows the same confirmation; Cancel preserves both the old session and the newly saved route", async ({
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

  // Re-binds window.fetch through a trivial wrapper before the app's own
  // scripts run — mirrors planning.spec.ts's own identical, bisected fix
  // for an intermittent Chromium/CDP request-interception timing quirk.
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const existingRouteName = "switch-guard-planning-existing";
  const dummyKey = "dummy-e2e-key";

  await establishUnfinishedRide(page, context, existingRouteName);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  const existingRowBefore = await readActiveRideStateRow(page);

  // A saved key is required for "Calculate route" to be enabled — mirrors
  // planning.spec.ts's own identical Settings step.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("OpenRouteService API key").fill(dummyKey);
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
            properties: { summary: { distance: 950, duration: 200 } },
            geometry: {
              type: "LineString",
              coordinates: [
                [-0.1, 51.5, 10],
                [-0.099, 51.5005, 12],
                [-0.098, 51.501, 15],
              ],
            },
          },
        ],
      }),
    });
  });

  await page.getByRole("button", { name: "Plan", exact: true }).click();
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

  const savedRouteName = "Switch guard newly saved route";
  await page.getByLabel("Route name").fill(savedRouteName);
  const saveButton = page.getByRole("button", { name: /save route/i });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  // Save itself always succeeds — the guard only decides whether Riding
  // opens next. It must not redirect merely to show the confirmation; the
  // save flow lands with the confirmation shown in place.
  const savedRouteId = await readSavedRouteId(page, savedRouteName);
  expect(savedRouteId).not.toBeNull();
  // exact:true — the dialog's own title ("Switch to "savedRouteName"?")
  // would otherwise substring-match this same query while it's open.
  await expect(
    page.getByRole("heading", { name: savedRouteName, exact: true }),
  ).toBeHidden();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/unfinished ride on another route/i)).toBeVisible();
  expect(await readActiveRideStateRow(page)).toEqual(existingRowBefore);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await readActiveRideStateRow(page)).toEqual(existingRowBefore);
  expect(await readSavedRouteId(page, savedRouteName)).toBe(savedRouteId);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a genuine storage-clear failure during a confirmed switch preserves the original row, then a retry succeeds without a duplicate clear", async ({
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

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeAName = "switch-guard-clear-failure-a";
  const routeBName = "switch-guard-clear-failure-b";

  // Test-only seam (backlog item 73, src/storage/rideStateRepository.ts):
  // fails exactly the first clearActiveRideState() call after this
  // navigation, then succeeds — deterministic, no fixed sleeps, no faking
  // the whole IndexedDB layer.
  await page.addInitScript(() => {
    let callCount = 0;
    (
      window as unknown as {
        __acnE2eRideStateClearFailure?: () => Error | undefined;
      }
    ).__acnE2eRideStateClearFailure = () => {
      callCount += 1;
      return callCount === 1 ? new Error("e2e forced clear failure") : undefined;
    };
  });

  await establishUnfinishedRide(page, context, routeAName);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await importRoute(page, routeBName);
  const routeARowBefore = await readActiveRideStateRow(page);

  await page.getByRole("button", { name: routeBName, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "End and switch" }).click();

  await expect(dialog.getByText(/could not be ended on this device/i)).toBeVisible();
  expect(await readActiveRideStateRow(page)).toEqual(routeARowBefore);
  // exact:true — the dialog's own title ("Switch to "routeBName"?") would
  // otherwise substring-match this same query while still open.
  await expect(page.getByRole("heading", { name: routeBName, exact: true })).toBeHidden();

  await dialog.getByRole("button", { name: "End and switch" }).click();

  await waitForClearedRideState(page);
  await expect(
    page.getByRole("heading", { name: routeBName, exact: true }),
  ).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
