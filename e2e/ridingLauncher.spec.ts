import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Proves backlog item 41 (Ride launcher, explicit session recovery and
// post-finalisation route clearing): the launcher discovers a persisted
// active-ride session itself, independent of App.tsx's own transient
// selectedRoute (always null immediately after a reload), and offers
// Resume route/End ride/Discard unfinished ride entirely from local
// storage — never contacting OpenRouteService merely to populate itself.

const ORS_URL_GLOB = "https://api.heigit.org/**";

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Matches ridingFinishAndEnd.spec.ts's own conversion factor, at the same
// latitude — duplicated locally per this repo's established no-shared-
// e2e-helpers-across-specs convention.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

// Deterministic replacement for a fixed sleep, duplicated from
// ridingFinishAndEnd.spec.ts (its own doc comment explains why polling for
// the row's absence is race-free) — not yet extracted into the shared
// support module, matching this repo's established "extract once a third
// consumer needs it" convention (see CLAUDE.md item 25).
async function waitForClearedRideState(page: Page): Promise<void> {
  await expect.poll(() => readActiveRideStateRow(page), { timeout: 10_000 }).toBeNull();
}

/** A simple, straight, densely-sampled GPX track — deliberately independent
 * of OpenRouteService, matching ridingFinishAndEnd.spec.ts's own fixture. */
function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Ride launcher test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

/** Transparently wraps navigator.geolocation.watchPosition with a call
 * counter exposed on window, before any app script runs — must be
 * registered before the navigation whose behaviour is under test (a
 * page.goto or page.reload), since addInitScript only applies to
 * navigations that occur after registration. Delegates to the real
 * implementation unchanged, so context.setGeolocation-driven fixes still
 * work elsewhere in a test; only counts invocations. Kept file-local per
 * this repo's established no-shared-e2e-helpers convention (see this
 * file's own other local helpers) — the first consumer of this need. */
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

/** Imports the fixture route, opens it, starts riding and advances the fix
 * partway along the route so a real, persisted rideState row exists —
 * shared setup for all three tests below. Leaves the rider on the active
 * Riding screen; callers reload from there.
 *
 * "On route" becoming visible only proves a fix was accepted and
 * off-route-classified in React state (useRideNavigation.ts's handleFix,
 * synchronous) — it is not proof the corresponding rideState row has
 * actually committed to IndexedDB, which happens in a separate effect via
 * the async, un-throttled setActiveRideState(...) write. A reload
 * immediately after only the UI assertion can race that write under CI
 * load, leaving the Ride launcher with no persisted session to recover and
 * so no Resume route/End ride/Discard button — exactly the failure mode
 * that motivated the identical readSavedRouteId/readActiveRideStateRow
 * polling idiom already established in androidPersistenceAndOffline.spec.ts.
 * Reused here, not reinvented. */
async function establishUnfinishedRide(
  page: Page,
  context: BrowserContext,
  routeName: string,
) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${routeName}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });

  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();

  const routeId = await readSavedRouteId(page, routeName);
  expect(routeId).not.toBeNull();

  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({
      kind: "route",
      routeId,
      lastFix: expect.anything(),
      lastMatchedPointIndex: expect.any(Number),
      matchedDistanceFromStartMetres: expect.any(Number),
    });
}

test("the launcher resumes a route session after a real reload, with zero OpenRouteService requests", async ({
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

  const routeName = "ride-launcher-resume-route";
  await establishUnfinishedRide(page, context, routeName);

  let unexpectedOrsRequest = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    unexpectedOrsRequest = true;
    await route.abort("failed");
  });

  await page.reload();
  // The real, established contract (see androidPersistenceAndOffline.spec.ts):
  // a reload alone never restores selectedRoute — the default screen is
  // Routes. Navigating to "Ride" directly, never through Routes, is what
  // proves the launcher discovers the session from persisted storage
  // itself, not from any in-memory App state.
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();

  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  const resumeButton = page.getByRole("button", { name: "Resume route" });
  await expect(resumeButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeHidden();

  await resumeButton.click();

  // The persisted fix from before the reload restores immediately, so the
  // pre-ride panel offers Resume riding, not Start riding.
  await expect(page.getByRole("button", { name: "Resume riding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeHidden();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the launcher can end an unfinished ride directly, without ever resuming GPS", async ({
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

  const routeName = "ride-launcher-end-without-resume";
  await establishUnfinishedRide(page, context, routeName);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();

  // Never clicking "Resume route" — the launcher's own End ride must work
  // directly on the unresumed session.
  const resumeButton = page.getByRole("button", { name: "Resume route" });
  await expect(resumeButton).toBeVisible();
  const endRideButton = page.getByRole("button", { name: "End ride" });
  await expect(endRideButton).toBeVisible();
  await endRideButton.click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("End this ride?")).toBeVisible();

  // .ride-launcher-clear-row is a persistent action-slot container
  // (backlog item 50): it stays mounted and now contains the confirmation
  // directly, rather than the confirmation being appended elsewhere on the
  // page. Resume route and the route's own info stay visible around it.
  const dialogInsideClearRow = await page.evaluate(() => {
    const row = document.querySelector(".ride-launcher-clear-row");
    const alertDialog = document.querySelector('[role="alertdialog"]');
    return Boolean(row && alertDialog && row.contains(alertDialog));
  });
  expect(dialogInsideClearRow).toBe(true);
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(resumeButton).toBeVisible();

  // Cancel restores the trigger in the same slot, focused, with the row
  // untouched.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(endRideButton).toBeFocused();
  expect(await readActiveRideStateRow(page)).not.toBeNull();

  await endRideButton.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "End ride" }).click();

  await waitForClearedRideState(page);
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume route" })).toBeHidden();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// Proves backlog item 51 (pre-ride return to the Ride launcher): a new
// "Back to Ride options" action on RidingScreen's own idle/pre-ride panel
// returns to the launcher without ending/finishing the ride, without ever
// starting a geolocation watch, and without touching persisted storage.

test("Back to Ride options returns a clean pre-ride route screen to the empty launcher, without ever starting a geolocation watch", async ({
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
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installGeolocationWatchCounter(page);

  const routeName = "ride-launcher-back-to-options-clean";
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${routeName}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();

  await page.getByRole("button", { name: "Back to Ride options" }).click();

  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("heading", { name: routeName })).toBeHidden();
  expect(await readActiveRideStateRow(page)).toBeNull();
  expect(await readSavedRouteId(page, routeName)).not.toBeNull();
  expect(await readWatchPositionCallCount(page)).toBe(0);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Back to Ride options returns a resumed (still-idle) route screen to the launcher, leaving the persisted session exactly intact", async ({
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

  const routeName = "ride-launcher-back-to-options-resumed";
  await establishUnfinishedRide(page, context, routeName);

  await installGeolocationWatchCounter(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: "Resume route" }).click();
  await expect(page.getByRole("button", { name: "Resume riding" })).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(0);

  // Mounting the resumed pre-ride screen already normalises/expands the
  // stored row's fields (e.g. cameraMode reverts from establishUnfinishedRide's
  // own "following", left over from actively riding, to "overview") via
  // useRideNavigation's own mount-time hydration — unrelated to this
  // action. Snapshot once that's settled, so this test proves only that
  // returning to the launcher itself causes no further write.
  const settledRow = await readActiveRideStateRow(page);

  await page.getByRole("button", { name: "Back to Ride options" }).click();

  await expect(page.getByRole("button", { name: "Resume route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume riding" })).toBeHidden();
  expect(await readWatchPositionCallCount(page)).toBe(0);
  expect(await readActiveRideStateRow(page)).toEqual(settledRow);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test.describe("390px phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Back to Ride options has no horizontal overflow and a real >=44x44px touch target, in a clean and a resumable pre-ride state", async ({
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
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

    const routeName = "ride-launcher-back-to-options-viewport";
    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${routeName}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildStraightRouteGpx()),
    });
    await page.getByRole("button", { name: routeName, exact: true }).click();
    await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    const cleanBox = await page
      .getByRole("button", { name: "Back to Ride options" })
      .boundingBox();
    expect(cleanBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(cleanBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
    await expect(page.getByText("On route")).toBeVisible();
    const routeId = await readSavedRouteId(page, routeName);
    await expect
      .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
      .toMatchObject({ kind: "route", routeId });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
    await page.getByRole("button", { name: "Ride", exact: true }).click();
    await page.getByRole("button", { name: "Resume route" }).click();
    await expect(page.getByRole("button", { name: "Resume riding" })).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    const resumableBox = await page
      .getByRole("button", { name: "Back to Ride options" })
      .boundingBox();
    expect(resumableBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(resumableBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test("a session whose route has been deleted offers only a confirmed Discard, driven entirely through real UI", async ({
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

  const routeName = "ride-launcher-missing-route";
  await establishUnfinishedRide(page, context, routeName);

  // Reload first — deleting the route while App.tsx still holds the stale
  // in-memory selectedRoute would never reach the launcher's own
  // route-missing path at all (returning to "Ride" would just re-render
  // RidingScreen with the same, now-dangling route object).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  const deleteDialog = page.getByRole("alertdialog");
  await expect(deleteDialog.getByText(`Delete “${routeName}”?`)).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete route" }).click();
  await expect(page.getByRole("button", { name: routeName, exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Ride", exact: true }).click();

  await expect(
    page.getByText(
      "This unfinished ride refers to a route that's no longer in your library, so it can't be resumed.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume route" })).toBeHidden();
  const discardButton = page.getByRole("button", { name: "Discard unfinished ride" });
  await expect(discardButton).toBeVisible();

  await discardButton.click();
  const cancelDialog = page.getByRole("alertdialog");
  await expect(cancelDialog.getByText("Discard unfinished ride?")).toBeVisible();

  // .ride-launcher-clear-row is a persistent action-slot container
  // (backlog item 50): it stays mounted and now contains the confirmation
  // directly, rather than the confirmation being appended elsewhere on the
  // page. The explanation for why this session can't be resumed stays
  // visible around it.
  const dialogInsideClearRow = await page.evaluate(() => {
    const row = document.querySelector(".ride-launcher-clear-row");
    const alertDialog = document.querySelector('[role="alertdialog"]');
    return Boolean(row && alertDialog && row.contains(alertDialog));
  });
  expect(dialogInsideClearRow).toBe(true);
  await expect(
    page.getByText(
      "This unfinished ride refers to a route that's no longer in your library, so it can't be resumed.",
    ),
  ).toBeVisible();

  await cancelDialog.getByRole("button", { name: "Cancel" }).click();
  expect(await readActiveRideStateRow(page)).not.toBeNull();
  await expect(discardButton).toBeVisible();
  await expect(discardButton).toBeFocused();

  await discardButton.click();
  const confirmDialog = page.getByRole("alertdialog");
  await confirmDialog.getByRole("button", { name: "Discard unfinished ride" }).click();

  await waitForClearedRideState(page);
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(discardButton).toBeHidden();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
