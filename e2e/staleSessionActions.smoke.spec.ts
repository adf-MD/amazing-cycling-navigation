import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Backlog item 140's second slice, in both engines (this file runs under
// the "chromium" and "webkit-smoke" projects): End and switch, a route
// ride's End ride and free roam's End ride act only on the stored session
// they represent. Two pages in one browser context share IndexedDB, as two
// windows of the site would; the installed iPhone PWA has a single window,
// so these paths cannot be reached there.
//
// In each test page B ends the session page A is showing and starts a
// newer one, then page A acts on its stale view. The newer stored row is
// read before page A acts and checked first afterwards — before any
// presentation — so an unguarded action fails on the stored row itself.
// Page A never receives a location fix after the newer session exists, so
// nothing here depends on its own persistence (stale-window writes are
// item 143's separate hazard). Every step is an ordinary interface action;
// nothing contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const ROUTE_A = "stale-actions-route-a";
const ROUTE_B = "stale-actions-route-b";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 50;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

const STALE_NOTICE =
  "The previously shown ride had already ended or been replaced. Nothing was deleted.";
const UNFINISHED_ROUTE_RIDE = "You have an unfinished ride on this route.";
const UNFINISHED_FREE_ROAM = "You have an unfinished free roam session.";

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildStraightRouteGpx(name: string): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  return consoleErrors;
}

/** Counts watchPosition and clearWatch calls in a page. */
async function installGeolocationCounters(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const holder = window as unknown as { __acnWatches: number; __acnClears: number };
    holder.__acnWatches = 0;
    holder.__acnClears = 0;
    const geolocation = navigator.geolocation;
    const watch = geolocation.watchPosition.bind(geolocation);
    const clear = geolocation.clearWatch.bind(geolocation);
    geolocation.watchPosition = (
      ...args: Parameters<typeof geolocation.watchPosition>
    ) => {
      holder.__acnWatches += 1;
      return watch(...args);
    };
    geolocation.clearWatch = (watchId: number) => {
      holder.__acnClears += 1;
      clear(watchId);
    };
  });
}

function watchCounts(page: Page): Promise<{ watches: number; clears: number }> {
  return page.evaluate(() => {
    const holder = window as unknown as { __acnWatches: number; __acnClears: number };
    return { watches: holder.__acnWatches, clears: holder.__acnClears };
  });
}

async function openApp(page: Page): Promise<void> {
  await installLocalMapStyle(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Routes" })).toBeVisible();
}

async function importRoute(page: Page, name: string): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx(name)),
  });
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

function rideTab(page: Page) {
  return page.getByRole("button", { name: "Ride", exact: true });
}

/** From the Routes screen: open a route, Start riding and take a fix 400 m
 * along. Resolves once the stored row is that route's, with its fix. */
async function startRouteRide(
  page: Page,
  context: BrowserContext,
  routeName: string,
): Promise<Record<string, unknown>> {
  const before = await readActiveRideStateRow(page);
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();
  const routeId = await readSavedRouteId(page, routeName);
  if (!routeId) throw new Error(`expected the id of ${routeName}`);
  await expect
    .poll(
      async () => {
        const row = await readActiveRideStateRow(page);
        return (
          row !== null && row.routeId === routeId && row.sessionId !== before?.sessionId
        );
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const row = await readActiveRideStateRow(page);
  if (!row) throw new Error("expected a stored route ride");
  return row;
}

/** The ride screen's End ride, confirmed in its confirmation. */
async function confirmEndRide(page: Page): Promise<void> {
  await page.getByRole("button", { name: "End ride", exact: true }).click();
  await page
    .getByRole("dialog", { name: "End this ride?" })
    .getByRole("button", { name: "End ride", exact: true })
    .click();
}

/** Page B: from Routes, the first Ride entry shows the stored route ride's
 * paused screen; it ends that ride there, leaving the empty Ride screen. */
async function endPausedRouteRideInOtherPage(page: Page): Promise<void> {
  await rideTab(page).click();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();
  await confirmEndRide(page);
  await expect(page.getByRole("button", { name: "Start free roam" })).toBeVisible();
}

async function startFreeRoamFromEmptyRide(page: Page): Promise<Record<string, unknown>> {
  const before = await readActiveRideStateRow(page);
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect
    .poll(async () => {
      const row = await readActiveRideStateRow(page);
      return (
        row !== null && row.kind === "free-roam" && row.sessionId !== before?.sessionId
      );
    })
    .toBe(true);
  const row = await readActiveRideStateRow(page);
  if (!row) throw new Error("expected a stored free-roam session");
  return row;
}

/** Checked first after the stale action: the newer session is still the
 * stored one, by kind, start time and identity. */
async function expectNewerSessionStored(
  page: Page,
  newer: Record<string, unknown>,
  label: string,
): Promise<void> {
  expect(typeof newer.sessionId, "the newer session's identity").toBe("string");
  const stored = await readActiveRideStateRow(page);
  expect(stored, label).toMatchObject({
    kind: newer.kind,
    startedAt: newer.startedAt,
  });
  expect(stored?.sessionId, label).toBe(newer.sessionId);
}

/** The approved notice: visible in a non-live element, announced once by a
 * polite region. */
async function expectStaleNotice(page: Page, visibleWithin = page.locator("body")) {
  await expect(visibleWithin.getByText(STALE_NOTICE).first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: STALE_NOTICE })).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("End and switch from a route card, after another window replaced the paused ride, deletes nothing and opens nothing (item 140)", async ({
  page: pageA,
  context,
}) => {
  test.setTimeout(120_000);
  const consoleErrorsA = collectConsoleErrors(pageA);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  // Page A: a paused ride on route A, then route B's card asks to switch.
  await openApp(pageA);
  await importRoute(pageA, ROUTE_A);
  await importRoute(pageA, ROUTE_B);
  await startRouteRide(pageA, context, ROUTE_A);
  await pageA.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(pageA.getByRole("button", { name: "Resume ride" })).toBeVisible();
  await pageA.getByRole("button", { name: "Routes", exact: true }).click();
  const routeBId = await readSavedRouteId(pageA, ROUTE_B);
  if (!routeBId) throw new Error("expected route B's id");
  const routeBCard = pageA.locator(`[data-route-id="${routeBId}"]`);
  await pageA.getByRole("button", { name: ROUTE_B, exact: true }).click();
  const prompt = routeBCard.getByRole("dialog");
  await expect(prompt.getByRole("button", { name: "End and switch" })).toBeVisible();

  // Page B ends that ride and starts free roam.
  const pageB = await context.newPage();
  const consoleErrorsB = collectConsoleErrors(pageB);
  await openApp(pageB);
  await endPausedRouteRideInOtherPage(pageB);
  const newer = await startFreeRoamFromEmptyRide(pageB);

  await prompt.getByRole("button", { name: "End and switch" }).click();
  // Settled either way: refused (Check again) or, unguarded, route B opened.
  await expect(
    prompt
      .getByRole("button", { name: "Check again" })
      .or(pageA.getByRole("button", { name: "Start riding" })),
  ).toBeVisible();

  await expectNewerSessionStored(
    pageA,
    newer,
    "page B's free roam after page A's End and switch",
  );
  await expectStaleNotice(pageA, prompt);
  await expect(prompt.getByRole("button", { name: "End and switch" })).toHaveCount(0);
  await expect(prompt.getByRole("button", { name: "Return to paused ride" })).toHaveCount(
    0,
  );
  await expect(pageA.getByRole("heading", { level: 1, name: "Routes" })).toBeVisible();
  await expect(pageA.getByRole("button", { name: "Start riding" })).toHaveCount(0);

  await pageA.reload();
  await rideTab(pageA).click();
  await expect(pageA.getByRole("button", { name: "Resume free roam" })).toBeVisible();
  await expect(pageA.getByText(UNFINISHED_FREE_ROAM)).toBeVisible();
  await expectNewerSessionStored(pageA, newer, "after reloading page A");

  expect(consoleErrorsA).toEqual([]);
  expect(consoleErrorsB).toEqual([]);
});

test("End and switch to free roam, after another window replaced the ride, writes no free-roam session and starts no tracking (item 140)", async ({
  page: pageA,
  context,
}) => {
  test.setTimeout(120_000);
  const consoleErrorsA = collectConsoleErrors(pageA);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installGeolocationCounters(pageA);

  // Page A: the empty Ride screen, read before anything was stored.
  await openApp(pageA);
  await importRoute(pageA, ROUTE_A);
  await rideTab(pageA).click();
  await expect(pageA.getByRole("button", { name: "Start free roam" })).toBeVisible();

  // Page B starts a route ride; page A's Start free roam then asks to switch.
  const pageB = await context.newPage();
  const consoleErrorsB = collectConsoleErrors(pageB);
  await openApp(pageB);
  await startRouteRide(pageB, context, ROUTE_A);
  await pageA.getByRole("button", { name: "Start free roam" }).click();
  const prompt = pageA.getByRole("dialog", { name: "Switch to free roam?" });
  await expect(prompt.getByRole("button", { name: "End and switch" })).toBeVisible();

  // Page B ends its ride and starts its own free roam.
  await confirmEndRide(pageB);
  await expect(pageB.getByRole("button", { name: "Start free roam" })).toBeVisible();
  const newer = await startFreeRoamFromEmptyRide(pageB);

  await prompt.getByRole("button", { name: "End and switch" }).click();
  // Settled either way: refused (Check again) or, unguarded, free roam opened.
  await expect(
    prompt
      .getByRole("button", { name: "Check again" })
      .or(pageA.getByRole("heading", { level: 1, name: "Free roam" })),
  ).toBeVisible();

  await expectNewerSessionStored(
    pageA,
    newer,
    "page B's free roam after page A's End and switch",
  );
  await expectStaleNotice(pageA, prompt);
  await expect(pageA.getByRole("heading", { level: 1, name: "Free roam" })).toHaveCount(
    0,
  );
  expect((await watchCounts(pageA)).watches).toBe(0);

  await pageA.reload();
  await rideTab(pageA).click();
  await expect(pageA.getByRole("button", { name: "Resume free roam" })).toBeVisible();
  await expectNewerSessionStored(pageA, newer, "after reloading page A");

  expect(consoleErrorsA).toEqual([]);
  expect(consoleErrorsB).toEqual([]);
});

test("a paused route ride's End ride, after another window started a newer ride on the same route, deletes nothing and hands back to the Ride screen (item 140)", async ({
  page: pageA,
  context,
}) => {
  test.setTimeout(120_000);
  const consoleErrorsA = collectConsoleErrors(pageA);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  // Page A: route A's ride, paused, on its own paused screen.
  await openApp(pageA);
  await importRoute(pageA, ROUTE_A);
  const older = await startRouteRide(pageA, context, ROUTE_A);
  await pageA.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(pageA.getByRole("button", { name: "Resume ride" })).toBeVisible();

  // Page B ends it and starts a newer ride on the same route.
  const pageB = await context.newPage();
  const consoleErrorsB = collectConsoleErrors(pageB);
  await openApp(pageB);
  await endPausedRouteRideInOtherPage(pageB);
  await pageB.getByRole("button", { name: "Choose a route" }).click();
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  const newer = await startRouteRide(pageB, context, ROUTE_A);
  expect(newer.routeId).toBe(older.routeId);
  expect(newer.sessionId).not.toBe(older.sessionId);

  await confirmEndRide(pageA);
  // Settled either way: page A is back on the Ride screen.
  await expect(pageA.getByRole("heading", { level: 1, name: "Ride" })).toBeVisible();

  await expectNewerSessionStored(
    pageA,
    newer,
    "page B's newer ride after page A's End ride",
  );
  await expect(pageA.getByText(UNFINISHED_ROUTE_RIDE)).toBeVisible();
  await expectStaleNotice(pageA);
  await expect(pageA.getByRole("button", { name: "Resume ride" })).toBeVisible();

  await pageA.reload();
  await rideTab(pageA).click();
  await expect(pageA.getByRole("button", { name: "Resume ride" })).toBeVisible();
  await expect(pageA.getByText(STALE_NOTICE)).toHaveCount(0);
  const afterReload = await readActiveRideStateRow(pageA);
  expect(afterReload?.sessionId).toBe(newer.sessionId);
  expect(afterReload?.routeId).toBe(newer.routeId);

  expect(consoleErrorsA).toEqual([]);
  expect(consoleErrorsB).toEqual([]);
});

test("free roam's End ride, after another window replaced the session, deletes nothing, stops its own tracking and hands back to the Ride screen (item 140)", async ({
  page: pageA,
  context,
}) => {
  test.setTimeout(120_000);
  const consoleErrorsA = collectConsoleErrors(pageA);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installGeolocationCounters(pageA);

  // Page A: free roam, tracking.
  await openApp(pageA);
  await rideTab(pageA).click();
  await startFreeRoamFromEmptyRide(pageA);
  await expect.poll(async () => (await watchCounts(pageA)).watches).toBe(1);

  // Page B ends that free roam from its Ride screen and starts its own.
  const pageB = await context.newPage();
  const consoleErrorsB = collectConsoleErrors(pageB);
  await openApp(pageB);
  await rideTab(pageB).click();
  await expect(pageB.getByRole("button", { name: "Resume free roam" })).toBeVisible();
  await confirmEndRide(pageB);
  await expect(pageB.getByRole("button", { name: "Start free roam" })).toBeVisible();
  const newer = await startFreeRoamFromEmptyRide(pageB);

  await confirmEndRide(pageA);
  // Settled either way: page A is back on the Ride screen.
  await expect(pageA.getByRole("heading", { level: 1, name: "Ride" })).toBeVisible();

  await expectNewerSessionStored(
    pageA,
    newer,
    "page B's free roam after page A's End ride",
  );
  await expect(pageA.getByText(UNFINISHED_FREE_ROAM)).toBeVisible();
  await expectStaleNotice(pageA);
  await expect.poll(async () => (await watchCounts(pageA)).clears).toBe(1);

  // Page A no longer tracks or writes: a new position reaches only page B,
  // whose own session stays the stored one.
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(200) });
  await expect
    .poll(async () => {
      const row = await readActiveRideStateRow(pageB);
      const fix = row?.lastFix as { coordinate?: number[] } | null | undefined;
      return fix?.coordinate?.[0];
    })
    .toBeCloseTo(lonAtMetres(200), 6);
  await expectNewerSessionStored(pageA, newer, "after a later position change");
  expect((await watchCounts(pageA)).watches).toBe(1);

  await pageA.reload();
  await rideTab(pageA).click();
  await expect(pageA.getByRole("button", { name: "Resume free roam" })).toBeVisible();
  await expectNewerSessionStored(pageA, newer, "after reloading page A");

  expect(consoleErrorsA).toEqual([]);
  expect(consoleErrorsB).toEqual([]);
});
