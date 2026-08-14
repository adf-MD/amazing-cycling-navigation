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
  await expect(page.getByRole("button", { name: "Resume route" })).toBeVisible();
  const endRideButton = page.getByRole("button", { name: "End ride" });
  await expect(endRideButton).toBeVisible();
  await endRideButton.click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("End this ride?")).toBeVisible();
  await dialog.getByRole("button", { name: "End ride" }).click();

  await waitForClearedRideState(page);
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume route" })).toBeHidden();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
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
  await cancelDialog.getByRole("button", { name: "Cancel" }).click();
  expect(await readActiveRideStateRow(page)).not.toBeNull();
  await expect(discardButton).toBeVisible();

  await discardButton.click();
  const confirmDialog = page.getByRole("alertdialog");
  await confirmDialog.getByRole("button", { name: "Discard unfinished ride" }).click();

  await waitForClearedRideState(page);
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(discardButton).toBeHidden();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
