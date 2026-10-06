import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Backlog item 140's launcher slice, in both engines (this file runs under
// the "chromium" and "webkit-smoke" projects): a Ride-launcher confirmation
// clears only the stored session it presented. Two pages in one browser
// context share IndexedDB, as two windows of the site would; the installed
// iPhone PWA has a single window, so this path cannot be reached there.
//
// Page A leaves the launcher's End ride confirmation open for its paused
// route ride. Page B ends that ride and starts free roam. Confirming page
// A's stale confirmation must leave page B's newer session stored, also
// after a reload, and tell the rider nothing was deleted.
//
// The stored row is checked first, before any presentation, so an
// unguarded clear fails on the deletion itself. Every step is an ordinary
// interface action; nothing contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const ROUTE_NAME = "stale-confirmation-route";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 50;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

const STALE_NOTICE =
  "The previously shown ride had already ended or been replaced. Nothing was deleted.";
const UNFINISHED_FREE_ROAM = "You have an unfinished free roam session.";

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Stale launcher confirmation test route</name>
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

/** A real route ride with a fix 400 m along, created through the UI and
 * still tracking. Returns the stored row. */
async function establishRouteRide(
  page: Page,
  context: BrowserContext,
): Promise<Record<string, unknown>> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${ROUTE_NAME}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });
  await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();
  const routeId = await readSavedRouteId(page, ROUTE_NAME);
  if (!routeId) throw new Error("expected the imported route's id");
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "route", routeId, lastFix: expect.anything() });
  const row = await readActiveRideStateRow(page);
  if (!row) throw new Error("expected a stored route ride");
  return row;
}

test("a stale launcher End ride confirmation leaves another page's newer session stored, also after a reload, and says nothing was deleted (item 140)", async ({
  page: pageA,
  context,
}) => {
  test.setTimeout(120_000);
  const consoleErrorsA = collectConsoleErrors(pageA);
  await installLocalMapStyle(pageA);

  // Page A: a paused route ride, its launcher summary, End ride opened and
  // left unconfirmed.
  const routeRow = await establishRouteRide(pageA, context);
  await pageA.getByRole("button", { name: "Pause", exact: true }).click();
  await pageA.getByRole("button", { name: "Back to Ride options" }).click();
  await expect(
    pageA.getByText("You have an unfinished ride on this route."),
  ).toBeVisible();
  await pageA.getByRole("button", { name: "End ride", exact: true }).click();
  const staleDialog = pageA.getByRole("dialog", { name: "End this ride?" });
  await expect(staleDialog).toBeVisible();
  expect(await readActiveRideStateRow(pageA)).toMatchObject({
    kind: "route",
    startedAt: routeRow.startedAt,
  });

  // Page B, sharing the same storage: the paused screen's End ride, then a
  // new free-roam session.
  const pageB = await context.newPage();
  const consoleErrorsB = collectConsoleErrors(pageB);
  await installLocalMapStyle(pageB);
  await pageB.goto("/");
  await pageB.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(pageB.getByRole("button", { name: "Resume ride" })).toBeVisible();
  await pageB.getByRole("button", { name: "End ride", exact: true }).click();
  await pageB
    .getByRole("dialog", { name: "End this ride?" })
    .getByRole("button", { name: "End ride", exact: true })
    .click();
  await pageB.getByRole("button", { name: "Start free roam" }).click();
  await expect
    .poll(() => readActiveRideStateRow(pageB), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam" });
  const newerRow = await readActiveRideStateRow(pageB);
  if (!newerRow) throw new Error("expected page B's free-roam session");
  expect(newerRow.startedAt).not.toBe(routeRow.startedAt);

  // Page A has not re-read: its confirmation still offers to end the ride
  // it showed.
  await expect(staleDialog).toBeVisible();
  await expect(
    pageA.getByText("You have an unfinished ride on this route."),
  ).toBeVisible();

  await staleDialog.getByRole("button", { name: "End ride", exact: true }).click();
  await expect(staleDialog).toHaveCount(0);

  // The newer session survives the stale confirmation — checked first.
  const afterConfirm = await readActiveRideStateRow(pageA);
  expect(afterConfirm, "page B's newer session after page A's confirm").toMatchObject({
    kind: "free-roam",
    startedAt: newerRow.startedAt,
  });
  expect(typeof newerRow.sessionId).toBe("string");
  expect(afterConfirm?.sessionId).toBe(newerRow.sessionId);
  expect(afterConfirm?.sessionId).not.toBe(routeRow.sessionId);

  // Page A then shows what is stored, with the notice, and no error.
  await expect(pageA.locator("p.status-row", { hasText: STALE_NOTICE })).toBeVisible();
  await expect(pageA.getByRole("status").filter({ hasText: STALE_NOTICE })).toHaveCount(
    1,
  );
  await expect(pageA.getByText(UNFINISHED_FREE_ROAM)).toBeVisible();
  await expect(pageA.getByRole("button", { name: "Resume free roam" })).toBeVisible();
  await expect(pageA.getByRole("alert")).toHaveCount(0);

  // After a reload the newer session is still stored and still offered.
  await pageA.reload();
  await pageA.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(pageA.getByRole("button", { name: "Resume free roam" })).toBeVisible();
  await expect(pageA.getByText(UNFINISHED_FREE_ROAM)).toBeVisible();
  await expect(pageA.getByText(STALE_NOTICE)).toHaveCount(0);
  const afterReload = await readActiveRideStateRow(pageA);
  expect(afterReload).toMatchObject({
    kind: "free-roam",
    startedAt: newerRow.startedAt,
    sessionId: newerRow.sessionId,
  });

  expect(consoleErrorsA).toEqual([]);
  expect(consoleErrorsB).toEqual([]);
});
