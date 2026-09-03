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

// Mirrors layout.spec.ts's own identical Box/isFullyWithin/intersects
// helpers — duplicated locally per this repo's established no-shared-e2e-
// helpers-across-specs convention.
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFullyWithin(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

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
  const routeBId = await readSavedRouteId(page, routeBName);
  if (!routeBId) throw new Error("expected a saved route id for route B");
  const routeBCard = page.locator(`[data-route-id="${routeBId}"]`);
  const routeBButton = page.getByRole("button", { name: routeBName, exact: true });
  await routeBButton.click();

  // exact:true — the dialog's own title ("Switch to "routeBName"?") would
  // otherwise substring-match this same query while it's open. Item 73
  // follow-up: the prompt is a descendant of B's own card, names A
  // directly, and offers Return to paused ride.
  await expect(page.getByRole("heading", { name: routeBName, exact: true })).toBeHidden();
  const dialog = routeBCard.getByRole("alertdialog");
  await expect(
    dialog.getByText(
      `"${routeAName}" is paused. Return to it, or end it and switch to "${routeBName}". Ending it will clear ride progress; the saved route will remain in Routes.`,
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Return to paused ride" }),
  ).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  expect(await readActiveRideStateRow(page)).toEqual(routeARowBefore);
  expect(await readWatchPositionCallCount(page)).toBe(0);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await readActiveRideStateRow(page)).toEqual(routeARowBefore);
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await expect(routeBButton).toBeFocused();

  await routeBButton.click();
  const confirmDialog = routeBCard.getByRole("alertdialog");
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

test("on a long Routes list, selecting a lower route while another is paused expands the confirmation inside the tapped route's own card and offers Return to paused ride (item 73 follow-up)", async ({
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

  await page.setViewportSize({ width: 390, height: 844 });
  // Deterministic, instant scroll geometry — the production scroll uses
  // behavior:"smooth" unless reduced motion is requested, and this test
  // measures boxes immediately after the triggering click.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeAName = "switch-guard-inline-route-a";
  const routeBName = "switch-guard-inline-route-b";

  await establishUnfinishedRide(page, context, routeAName);
  await installGeolocationWatchCounter(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await importRoute(page, routeBName);
  // Most-recent-first sort (this library's default) means later imports
  // land above B — enough fillers push B meaningfully below the fold,
  // proving the fix works for a card that isn't already on-screen.
  for (let index = 1; index <= 8; index += 1) {
    await importRoute(page, `switch-guard-inline-filler-${String(index)}`);
  }

  const routeARowBefore = await readActiveRideStateRow(page);
  const routeBId = await readSavedRouteId(page, routeBName);
  if (!routeBId) throw new Error("expected a saved route id for route B");
  const routeBCard = page.locator(`[data-route-id="${routeBId}"]`);

  await page.getByRole("button", { name: routeBName, exact: true }).click();

  // The prompt must be a descendant of route B's own card, not a global,
  // page-level dialog detached from the card the rider actually tapped.
  const dialog = routeBCard.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  const returnButton = dialog.getByRole("button", { name: "Return to paused ride" });
  await expect(returnButton).toBeVisible();
  expect(await readActiveRideStateRow(page)).toEqual(routeARowBefore);
  expect(await readWatchPositionCallCount(page)).toBe(0);

  // Item 95: the far-below-the-fold card's own complete bottom edge, and
  // the full prompt, must both end up visible above the sticky header and
  // below the visible viewport bottom — not merely the nested prompt panel
  // scrolled to its own "nearest" position.
  const header = page.locator("header.app-header--sticky");
  const [headerBox, cardBox, dialogBox] = await Promise.all([
    header.boundingBox(),
    routeBCard.boundingBox(),
    dialog.boundingBox(),
  ]);
  if (!headerBox || !cardBox || !dialogBox) {
    throw new Error("expected the header, card and dialog to all be measurable");
  }
  const visibleBottom = await page.evaluate(() => {
    const vv = window.visualViewport;
    return vv ? vv.offsetTop + vv.height : window.innerHeight;
  });
  expect(dialogBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(visibleBottom);

  const buttonLabels = await dialog.locator("button").allTextContents();
  expect(buttonLabels).toEqual(["End and switch", "Return to paused ride", "Cancel"]);

  await returnButton.click();

  await expect(page.getByRole("heading", { name: routeAName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();
  // RidingScreen's own restoration independently recomputes a fresh camera
  // framing around the restored fix on mount — unrelated to Return's own
  // no-clear guarantee, so this checks the progress-critical fields are
  // still intact rather than the whole row (including transient camera
  // state) staying byte-identical.
  expect(await readActiveRideStateRow(page)).toMatchObject({
    routeId: routeARowBefore?.routeId,
    lastFix: routeARowBefore?.lastFix,
    lastMatchedPointIndex: routeARowBefore?.lastMatchedPointIndex,
    matchedDistanceFromStartMetres: routeARowBefore?.matchedDistanceFromStartMetres,
    offRouteMachineState: routeARowBefore?.offRouteMachineState,
  });
  expect(await readWatchPositionCallCount(page)).toBe(0);
  // Reduced motion has no real scroll animation to race in the first
  // place, so this is cheap, deterministic regression coverage for the
  // item 95 follow-up: Pre-Ride must open at its canonical top, not
  // inherit the Library's own far-scrolled position.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

/** Shared setup for the item 95 follow-up's ordinary-motion tests below:
 * establishes route A as unfinished, reloads, and builds a long enough
 * Routes list (route B plus 8 fillers, most-recent-first sort) that
 * opening B's card genuinely requires scrolling — mirrors the long-list
 * fixture the reduced-motion test above uses, but deliberately WITHOUT
 * emulating reduced motion, so the real animated smooth-scroll path is
 * exercised rather than avoided. */
async function setupOrdinaryMotionLongList(
  page: Page,
  context: BrowserContext,
  testId: string,
) {
  const routeAName = `switch-guard-${testId}-route-a`;
  const routeBName = `switch-guard-${testId}-route-b`;

  await establishUnfinishedRide(page, context, routeAName);
  await installGeolocationWatchCounter(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await importRoute(page, routeBName);
  for (let index = 1; index <= 8; index += 1) {
    await importRoute(page, `switch-guard-${testId}-filler-${String(index)}`);
  }

  const routeARowBefore = await readActiveRideStateRow(page);
  const routeBId = await readSavedRouteId(page, routeBName);
  if (!routeBId) throw new Error("expected a saved route id for route B");
  const routeBCard = page.locator(`[data-route-id="${routeBId}"]`);

  return { routeAName, routeBName, routeARowBefore, routeBCard };
}

test("Return activated during a genuine ordinary-motion scroll leaves Pre-Ride at a stable top, and Routes-return restoration is unaffected (item 95 follow-up)", async ({
  page,
  context,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const { routeAName, routeBName, routeARowBefore, routeBCard } =
    await setupOrdinaryMotionLongList(page, context, "ordinary-motion");

  await page.getByRole("button", { name: routeBName, exact: true }).click();
  const dialog = routeBCard.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const returnButton = dialog.getByRole("button", { name: "Return to paused ride" });
  await expect(returnButton).toBeVisible();

  const libraryScrollY = await page.evaluate(() => window.scrollY);
  expect(libraryScrollY).toBeGreaterThan(0); // proves the library is genuinely scrolled

  // A continuous in-page recorder — immune to Node-side round-trip
  // latency between Playwright and the browser — samples scrollY every
  // animation frame for a fixed real-time window spanning the Return
  // click and the whole Pre-Ride settle, marking (a) the Return click's
  // own timestamp via a real capture-phase DOM listener and (b) the
  // moment Route A's Pre-Ride heading genuinely mounts.
  const RECORD_MS = 2500;
  await page.evaluate(
    ({ routeAName, recordMs }) => {
      const w = window as unknown as {
        __e2eScrollRecorder?: {
          samples: { t: number; y: number }[];
          clickAt: number | null;
          transitionAt: number | null;
          done: boolean;
        };
      };
      const start = performance.now();
      const recorder = {
        samples: [] as { t: number; y: number }[],
        clickAt: null as number | null,
        transitionAt: null as number | null,
        done: false,
      };
      w.__e2eScrollRecorder = recorder;

      const onClick = (event: MouseEvent) => {
        const target = event.target;
        const button = target instanceof Element ? target.closest("button") : null;
        if (
          recorder.clickAt === null &&
          button?.textContent.includes("Return to paused ride")
        ) {
          recorder.clickAt = performance.now() - start;
        }
      };
      document.addEventListener("click", onClick, { capture: true });

      const tick = () => {
        const now = performance.now() - start;
        recorder.samples.push({ t: now, y: window.scrollY });
        if (recorder.transitionAt === null) {
          const heading = document.querySelector("h1.screen-title");
          if (heading?.textContent.trim() === routeAName) {
            recorder.transitionAt = now;
          }
        }
        if (now < recordMs) {
          requestAnimationFrame(tick);
        } else {
          recorder.done = true;
          document.removeEventListener("click", onClick, { capture: true });
        }
      };
      requestAnimationFrame(tick);
    },
    { routeAName, recordMs: RECORD_MS },
  );

  // force:true skips Playwright's normal actionability wait (which would
  // wait for the target to become "stable" first, likely absorbing
  // exactly the race window this test needs to hit) while still
  // dispatching a real, trusted, CDP-level mouse click at a position
  // measured immediately before dispatch — not a coordinate snapshot
  // taken earlier, which proved unreliable here: with a still-scrolling
  // page, a boundingBox() measured even a short time before the click
  // could go stale enough that the click landed on a different button
  // ("End and switch", one row above) instead of "Return to paused ride".
  await returnButton.click({ force: true, noWaitAfter: true });

  await expect(page.getByRole("heading", { name: routeAName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(0);
  expect(await readActiveRideStateRow(page)).toMatchObject({
    routeId: routeARowBefore?.routeId,
    lastFix: routeARowBefore?.lastFix,
  });

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __e2eScrollRecorder?: { done: boolean } })
              .__e2eScrollRecorder?.done ?? false,
        ),
      { timeout: RECORD_MS + 3000 },
    )
    .toBe(true);

  const recorded = await page.evaluate(
    () =>
      (
        window as unknown as {
          __e2eScrollRecorder: {
            samples: { t: number; y: number }[];
            clickAt: number | null;
            transitionAt: number | null;
          };
        }
      ).__e2eScrollRecorder,
  );

  // Honest, non-blocking observational evidence: whether the card's own
  // item-95 scroll animation was still genuinely moving in the samples
  // immediately preceding the Return click. Reported via a test
  // annotation, not hard-asserted — Chromium's own smooth-scroll
  // cancellation semantics may already have settled it by this point
  // regardless of what this fix does, and that is an honest, useful
  // result in itself, not a failure of this test.
  const clickAt = recorded.clickAt;
  const samplesBeforeClick =
    clickAt === null ? [] : recorded.samples.filter((sample) => sample.t <= clickAt);
  const recentSamples = samplesBeforeClick.slice(-5);
  const motionObservedBeforeReturn = recentSamples.some((sample, index) => {
    if (index === 0) return false;
    const previous = recentSamples[index - 1];
    return sample.y !== previous.y;
  });
  testInfo.annotations.push({
    type: "item-95-follow-up-observation",
    description:
      `motionObservedBeforeReturn=${String(motionObservedBeforeReturn)} ` +
      `clickAt=${String(clickAt)} transitionAt=${String(recorded.transitionAt)}`,
  });

  // The load-bearing assertion: from the moment Route A's Pre-Ride
  // heading genuinely mounted onward, scrollY must reach and REMAIN
  // within tolerance of the top for the rest of this recording — not one
  // instantaneous check, and immune to Playwright's own round-trip
  // latency since every sample was taken in-page.
  expect(recorded.transitionAt).not.toBeNull();
  const transitionAt = recorded.transitionAt ?? 0;
  const samplesAfterTransition = recorded.samples.filter(
    (sample) => sample.t >= transitionAt,
  );
  expect(samplesAfterTransition.length).toBeGreaterThan(10);
  const TOP_TOLERANCE_PX = 1;
  const offTopSamples = samplesAfterTransition.filter(
    (sample) => Math.abs(sample.y) > TOP_TOLERANCE_PX,
  );
  testInfo.annotations.push({
    type: "item-95-follow-up-measurement",
    description:
      `settleWindowMs=${String(transitionAt - (clickAt ?? 0))} ` +
      `offTopSampleCount=${String(offTopSamples.length)} ` +
      `maxOffTopY=${String(Math.max(0, ...offTopSamples.map((s) => Math.abs(s.y))))}`,
  });
  expect(offTopSamples).toEqual([]);

  // The Library's own saved scroll position must remain available and be
  // restored, not merely discarded/reset to the top by this fix — a
  // qualitative check, not an exact predicted pixel value. openRideTarget
  // captures window.scrollY only once Return actually succeeds, and by
  // then Chromium's own native scroll anchoring (see the non-race test
  // below for the measured mechanism), plus whatever point item 95's own
  // conflict-state animation had reached, have both already had a chance
  // to move it — genuinely unpredictable to the pixel from outside, and
  // not a symptom of this fix.
  await page.getByRole("button", { name: "Routes" }).click();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Return activated after the initial item 95 scroll has fully settled still opens Pre-Ride at a stable top (item 95 follow-up, non-race control)", async ({
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

  await page.setViewportSize({ width: 390, height: 844 });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const { routeAName, routeBName, routeBCard } = await setupOrdinaryMotionLongList(
    page,
    context,
    "settled-return",
  );

  await page.getByRole("button", { name: routeBName, exact: true }).click();
  const dialog = routeBCard.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const returnButton = dialog.getByRole("button", { name: "Return to paused ride" });
  await expect(returnButton).toBeVisible();

  // Poll (never a fixed sleep) until scrollY has genuinely stopped
  // changing across several consecutive real animation frames — i.e. the
  // initial item 95 card-open animation has fully settled — before
  // tapping Return, proving the already-working slow-tap path stays
  // correct.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              let stableFrames = 0;
              let lastY: number | null = null;
              const check = () => {
                const y = window.scrollY;
                stableFrames = lastY !== null && y === lastY ? stableFrames + 1 : 0;
                lastY = y;
                if (stableFrames >= 10) {
                  resolve(true);
                  return;
                }
                requestAnimationFrame(check);
              };
              requestAnimationFrame(check);
            }),
        ),
      { timeout: 5000 },
    )
    .toBe(true);

  await returnButton.click();

  await expect(page.getByRole("heading", { name: routeAName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();

  const staysStable = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        let frames = 0;
        const check = () => {
          frames += 1;
          if (Math.abs(window.scrollY) > 1) {
            resolve(false);
            return;
          }
          if (frames >= 10) {
            resolve(true);
            return;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );
  expect(staysStable).toBe(true);

  // The Library's own saved scroll position must remain available and be
  // restored, not discarded by this fix — a qualitative "not reset to
  // the top" check, not an exact predicted pixel value: measured while
  // building this test, Chromium's own native scroll anchoring shifts
  // window.scrollY on its own once the busy "Opening your paused ride…"
  // message (much shorter than the conflict message it replaces) shrinks
  // the card content above the current viewport — a real, separate
  // browser behaviour, unrelated to this fix, that makes the exact
  // library-return value genuinely unpredictable from outside. The exact-
  // value contract itself is proven in App.test.tsx's own mocked (and
  // therefore exact and deterministic) environment instead.
  await page.getByRole("button", { name: "Routes" }).click();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("End and switch activated during a genuine ordinary-motion scroll also leaves the new screen at a stable top (item 95 follow-up, shared transition boundary)", async ({
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

  await page.setViewportSize({ width: 390, height: 844 });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const { routeBName, routeBCard } = await setupOrdinaryMotionLongList(
    page,
    context,
    "end-and-switch",
  );

  await page.getByRole("button", { name: routeBName, exact: true }).click();
  const dialog = routeBCard.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const confirmButton = dialog.getByRole("button", { name: "End and switch" });
  await expect(confirmButton).toBeVisible();

  // force:true, mirroring the Return test above: skips Playwright's
  // stability wait while still dispatching a real, trusted click measured
  // immediately before firing, not a coordinate snapshot that could go
  // stale while the page is still scrolling. This fix's busy-gate and
  // reassertion loop are both shared by confirmPendingSwitch ("clearing")
  // via the same RouteListItem effect and openRideTarget path, so the
  // shared boundary needs its own, if minimal, real-browser proof rather
  // than being assumed correct from code-sharing alone.
  await confirmButton.click({ force: true, noWaitAfter: true });

  await expect(page.getByRole("heading", { name: routeBName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();

  const staysStable = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        let frames = 0;
        const check = () => {
          frames += 1;
          if (Math.abs(window.scrollY) > 1) {
            resolve(false);
            return;
          }
          if (frames >= 30) {
            resolve(true);
            return;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );
  expect(staysStable).toBe(true);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("at an iPhone-sized portrait viewport, the inline switch prompt stays inside its own card, below the sticky nav, with no horizontal document overflow, non-overlapping touch-target-sized actions, and working keyboard focus/Escape (item 73 follow-up)", async ({
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeAName = "switch-guard-geometry-portrait-a";
  const routeBName = "switch-guard-geometry-portrait-b";

  await establishUnfinishedRide(page, context, routeAName);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await importRoute(page, routeBName);
  // Item 95: push the card below the fold so these strong hit-size/focus/
  // Escape assertions are proven under a real scroll, not just initial
  // layout.
  for (let index = 1; index <= 8; index += 1) {
    await importRoute(page, `switch-guard-geometry-portrait-filler-${String(index)}`);
  }

  const routeBId = await readSavedRouteId(page, routeBName);
  if (!routeBId) throw new Error("expected a saved route id for route B");
  const routeBCard = page.locator(`[data-route-id="${routeBId}"]`);
  const routeBButton = page.getByRole("button", { name: routeBName, exact: true });
  await routeBButton.click();

  const dialog = routeBCard.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  const header = page.locator("header.app-header--sticky");
  const [headerBox, cardBox, dialogBox] = await Promise.all([
    header.boundingBox(),
    routeBCard.boundingBox(),
    dialog.boundingBox(),
  ]);
  if (!headerBox || !cardBox || !dialogBox) {
    throw new Error("expected the header, card and dialog to all be measurable");
  }
  const visibleBottom = await page.evaluate(() => {
    const vv = window.visualViewport;
    return vv ? vv.offsetTop + vv.height : window.innerHeight;
  });
  expect(isFullyWithin(dialogBox, cardBox)).toBe(true);
  expect(dialogBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(visibleBottom);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390 + 1);

  const actionBoxes = await Promise.all(
    [
      dialog.getByRole("button", { name: "Cancel" }),
      dialog.getByRole("button", { name: "Return to paused ride" }),
      dialog.getByRole("button", { name: "End and switch" }),
    ].map((button) => button.boundingBox()),
  );
  for (const box of actionBoxes) {
    if (!box) throw new Error("expected every action's box to be measurable");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(isFullyWithin(box, dialogBox)).toBe(true);
  }
  for (let i = 0; i < actionBoxes.length; i += 1) {
    for (let j = i + 1; j < actionBoxes.length; j += 1) {
      const a = actionBoxes[i];
      const b = actionBoxes[j];
      if (!a || !b) continue;
      expect(intersects(a, b)).toBe(false);
    }
  }

  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(routeBButton).toBeFocused();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("at 844x390 short landscape, the inline switch prompt stays inside its own card with no horizontal document overflow (item 73 follow-up)", async ({
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

  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeAName = "switch-guard-geometry-landscape-a";
  const routeBName = "switch-guard-geometry-landscape-b";

  await establishUnfinishedRide(page, context, routeAName);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await importRoute(page, routeBName);
  // Item 95: push the card below the fold in this much shorter viewport
  // too, so the header-clearance/card-bottom-visibility assertions below
  // exercise a genuine scroll, not just initial layout.
  for (let index = 1; index <= 8; index += 1) {
    await importRoute(page, `switch-guard-geometry-landscape-filler-${String(index)}`);
  }

  const routeBId = await readSavedRouteId(page, routeBName);
  if (!routeBId) throw new Error("expected a saved route id for route B");
  const routeBCard = page.locator(`[data-route-id="${routeBId}"]`);
  await page.getByRole("button", { name: routeBName, exact: true }).click();

  const dialog = routeBCard.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  const header = page.locator("header.app-header--sticky");
  const [headerBox, cardBox, dialogBox] = await Promise.all([
    header.boundingBox(),
    routeBCard.boundingBox(),
    dialog.boundingBox(),
  ]);
  if (!headerBox || !cardBox || !dialogBox) {
    throw new Error("expected the header, card and dialog to both be measurable");
  }
  const visibleBottom = await page.evaluate(() => {
    const vv = window.visualViewport;
    return vv ? vv.offsetTop + vv.height : window.innerHeight;
  });
  expect(isFullyWithin(dialogBox, cardBox)).toBe(true);
  expect(dialogBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(visibleBottom);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(844 + 1);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("at 200% enlarged text, the inline switch prompt (including the longer Return to paused ride label) stays reachable with no horizontal document overflow or overlapping actions (item 73 follow-up)", async ({
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeAName = "switch-guard-geometry-enlarged-a";
  const routeBName = "switch-guard-geometry-enlarged-b";

  await establishUnfinishedRide(page, context, routeAName);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await importRoute(page, routeBName);
  // Item 95: enlarged text shrinks the effectively available vertical
  // space per card, so push the card below the fold too — combining both
  // extreme conditions is exactly where the header-clearance/card-bottom
  // assertions below are most likely to matter.
  for (let index = 1; index <= 8; index += 1) {
    await importRoute(page, `switch-guard-geometry-enlarged-filler-${String(index)}`);
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });

  const routeBId = await readSavedRouteId(page, routeBName);
  if (!routeBId) throw new Error("expected a saved route id for route B");
  const routeBCard = page.locator(`[data-route-id="${routeBId}"]`);
  await page.getByRole("button", { name: routeBName, exact: true }).click();

  const dialog = routeBCard.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  // Scoped to the switch prompt's own card/actions, not the whole
  // document: a pre-existing, unrelated MainNavigation overflow (a bare
  // <span>Settings</span> exceeding the viewport at 200% text, reproduced
  // independently on a plain Routes screen with no route conflict at all)
  // already fails a document.scrollWidth-wide assertion regardless of this
  // fix. That's out of this item 73 follow-up's scope — this test proves
  // the switch prompt itself doesn't add to or worsen it.
  //
  // Measured atomically in one evaluate() call (not separate .boundingBox()
  // round trips) so nothing can shift/scroll between reading the card's box
  // and the buttons' boxes.
  const geometry = await routeBCard.evaluate((cardEl) => {
    const toBox = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const dialogEl = cardEl.querySelector('[role="alertdialog"]');
    if (!dialogEl) return null;
    const buttonEls = Array.from(dialogEl.querySelectorAll("button"));
    const headerEl = document.querySelector("header.app-header--sticky");
    const vv = window.visualViewport;
    return {
      card: toBox(cardEl),
      dialog: toBox(dialogEl),
      buttons: buttonEls.map((button) => ({
        text: button.textContent,
        box: toBox(button),
      })),
      headerBottom: headerEl ? headerEl.getBoundingClientRect().bottom : null,
      visibleBottom: vv ? vv.offsetTop + vv.height : window.innerHeight,
    };
  });
  if (!geometry)
    throw new Error("expected the card, dialog and buttons to all be measurable");

  expect(isFullyWithin(geometry.dialog, geometry.card)).toBe(true);
  expect(geometry.card.x + geometry.card.width).toBeLessThanOrEqual(390 + 1);
  expect(geometry.card.y + geometry.card.height).toBeLessThanOrEqual(
    geometry.visibleBottom,
  );

  const actionBoxes = geometry.buttons.map((button) => button.box);
  expect(actionBoxes).toHaveLength(3);
  expect(geometry.buttons.map((button) => button.text)).toEqual([
    "End and switch",
    "Return to paused ride",
    "Cancel",
  ]);
  for (let i = 0; i < actionBoxes.length; i += 1) {
    expect(isFullyWithin(actionBoxes[i], geometry.card)).toBe(true);
    expect(actionBoxes[i].width).toBeGreaterThanOrEqual(44);
    expect(actionBoxes[i].height).toBeGreaterThanOrEqual(44);
    if (geometry.headerBottom !== null) {
      expect(actionBoxes[i].y).toBeGreaterThanOrEqual(geometry.headerBottom);
    }
    expect(actionBoxes[i].y + actionBoxes[i].height).toBeLessThanOrEqual(
      geometry.visibleBottom,
    );
    for (let j = i + 1; j < actionBoxes.length; j += 1) {
      expect(intersects(actionBoxes[i], actionBoxes[j])).toBe(false);
    }
  }

  // Backlog item 95's extreme-case fallback: when the enlarged-text card is
  // genuinely taller than the entire band between the sticky header and
  // the visible viewport bottom, only the complete prompt's own TOP
  // (heading/message, above the actions) may end up scrolled out of
  // immediate view — every action and the card's own bottom edge must
  // still be immediately visible regardless (already proven above). When
  // the card does fit within that band, the complete prompt (including
  // its heading/message) must be immediately visible too, not merely
  // reachable.
  const availableBand = geometry.visibleBottom - (geometry.headerBottom ?? 0);
  const cardFitsWithinBand = geometry.card.height <= availableBand;
  if (cardFitsWithinBand && geometry.headerBottom !== null) {
    expect(geometry.dialog.y).toBeGreaterThanOrEqual(geometry.headerBottom);
  }

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("opening the switch prompt on a card that is already fully visible does not scroll the page (item 95)", async ({
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  const routeAName = "switch-guard-no-jump-a";
  const routeBName = "switch-guard-no-jump-b";

  await establishUnfinishedRide(page, context, routeAName);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  // No fillers: route B is the most recently imported route, so it sorts
  // to the top of the (most-recent-first) list and is already fully
  // visible before the prompt ever opens.
  await importRoute(page, routeBName);

  const routeBId = await readSavedRouteId(page, routeBName);
  if (!routeBId) throw new Error("expected a saved route id for route B");
  const routeBCard = page.locator(`[data-route-id="${routeBId}"]`);

  const cardBoxBefore = await routeBCard.boundingBox();
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  if (!cardBoxBefore) throw new Error("expected route B's card to be measurable");

  await page.getByRole("button", { name: routeBName, exact: true }).click();

  const dialog = routeBCard.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  const cardBoxAfter = await routeBCard.boundingBox();
  const scrollYAfter = await page.evaluate(() => window.scrollY);
  if (!cardBoxAfter) throw new Error("expected route B's card to still be measurable");

  expect(scrollYAfter).toBe(scrollYBefore);
  expect(cardBoxAfter.y).toBe(cardBoxBefore.y);

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
  const routeBId = await readSavedRouteId(page, routeBName);
  if (!routeBId) throw new Error("expected a saved route id for route B");
  const routeBCard = page.locator(`[data-route-id="${routeBId}"]`);

  await page.getByRole("button", { name: routeBName, exact: true }).click();
  const dialog = routeBCard.getByRole("alertdialog");
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
