import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Proves "Reverse route" (CLAUDE.md future-backlog item 27): a saved or
// imported route can be reversed into a new editable Planning draft,
// sourced from exact recovered provenance when available or a capped
// deterministic derivation otherwise, with the source route always left
// untouched and no routing request issued until Calculate is pressed
// explicitly. No test in this file contacts a live map or routing
// provider.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";
const SMOKE_ROUTE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

/** A minimal, valid ORS directions response, body-aware like
 * planning.spec.ts's own buildMockOrsResponseForCoordinates (duplicated
 * locally per this project's established no-shared-e2e-helpers-across-
 * specs convention). Densifies each requested leg so Save/Export's
 * "strictly more geometry points than waypoints" gate is satisfied. */
function buildMockOrsResponseForCoordinates(coordinates: readonly (readonly number[])[]) {
  const densified: number[][] = [];
  const stepsPerLeg = 5;
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const [startLon, startLat] = coordinates[i];
    const [endLon, endLat] = coordinates[i + 1];
    for (let step = 0; step < stepsPerLeg; step += 1) {
      const t = step / stepsPerLeg;
      densified.push([
        startLon + t * (endLon - startLon),
        startLat + t * (endLat - startLat),
        10,
      ]);
    }
  }
  const [lastLon, lastLat] = coordinates[coordinates.length - 1];
  densified.push([lastLon, lastLat, 10]);

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: 100, duration: 20 } },
        geometry: { type: "LineString", coordinates: densified },
      },
    ],
  };
}

/** See planning.spec.ts's identical workaround: without this, the POST to
 * the (page.route-mocked) ORS endpoint intermittently never reaches
 * Playwright's request interception in this test environment. */
async function fixWindowFetch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });
}

/** Common per-test setup — see editRouteAsPlanningCopy.spec.ts's identical
 * helper for the full rationale (mocked geolocation avoids an unframed,
 * very-low-zoom default camera producing an out-of-range longitude on a
 * map click). */
async function preparePage(
  page: Page,
  context: BrowserContext,
): Promise<{
  unexpectedOpenFreeMapRequests: readonly string[];
  consoleErrors: string[];
}> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  await fixWindowFetch(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  return { unexpectedOpenFreeMapRequests, consoleErrors };
}

async function configureProviderKey(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();
}

/** Registers a body-aware ORS mock (any leg count) and returns the list of
 * coordinate pairs each request actually carried, in request order. */
async function mockOrsRequests(
  page: Page,
): Promise<{ requestedCoordinatePairs: (readonly number[])[][] }> {
  const requestedCoordinatePairs: (readonly number[])[][] = [];
  await page.route(ORS_URL_GLOB, async (route) => {
    const request = route.request();
    let responseCoordinates: (readonly number[])[] = [];
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { coordinates: (readonly number[])[] };
      requestedCoordinatePairs.push(body.coordinates);
      responseCoordinates = body.coordinates;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(buildMockOrsResponseForCoordinates(responseCoordinates)),
    });
  });
  return { requestedCoordinatePairs };
}

/** Opens Planning and waits for the map and the genuinely-fresh-session
 * automatic regional framing to settle — see editRouteAsPlanningCopy.spec.ts's
 * identical helper for the full rationale. */
async function openPlanningAndAwaitFraming(page: Page): Promise<void> {
  // Non-exact: "Edit copy in Planning"/"Reverse route" (Riding's pre-ride
  // overview) also contain "Plan" as a substring, so an exact match is
  // required whenever those buttons might also be on screen.
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function planAndSaveTwoWaypointRoute(page: Page, routeName: string): Promise<void> {
  await openPlanningAndAwaitFraming(page);

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

  await page.getByLabel("Route name").fill(routeName);
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await assertPlanningDraftStaysCleared(page);
}

/** Builds a closed loop (3 waypoints, then "Return to start" appends a 4th
 * coincident with the first — mirrors planning.spec.ts's own closed-loop
 * construction), calculates and saves it. */
async function planAndSaveClosedLoopRoute(page: Page, routeName: string): Promise<void> {
  await openPlanningAndAwaitFraming(page);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 80, y: 80 } });
  await mapContainer.click({ position: { x: 180, y: 120 } });
  await mapContainer.click({ position: { x: 280, y: 160 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 3", exact: true }),
  ).toBeVisible();

  const returnToStartButton = page.getByRole("button", { name: "Return to start" });
  await expect(returnToStartButton).toBeEnabled();
  await returnToStartButton.click();
  await expect(
    page.getByRole("button", { name: "Waypoint 4", exact: true }),
  ).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Route name").fill(routeName);
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await assertPlanningDraftStaysCleared(page);
}

/** Exports a route directly from its own Route Library card — see
 * editRouteAsPlanningCopy.spec.ts's identical helper. */
async function exportRouteFromLibrary(page: Page, routeName: string) {
  const routeCard = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: routeName, exact: true }) });
  const downloadPromise = page.waitForEvent("download");
  await routeCard.getByRole("button", { name: "Export" }).click();
  return downloadPromise;
}

// Mirrors PlanningScreen.tsx's own DRAFT_DEBOUNCE_MS; not imported across
// the app/e2e boundary, sized only to bound this file's own regression
// window below.
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 900;

/**
 * Proves the singleton Planning draft row stays cleared for the whole
 * window in which a stale pre-Save autosave timer could fire, not merely
 * once immediately after Save's own clearDraft() resolves. CLAUDE.md
 * backlog item 30's fix (PlanningScreen.tsx's handleSave) cancels any
 * pending autosave timer synchronously, before any async work begins, so
 * by the time this is called the race is already closed — but a single
 * immediate expect.poll(...).toBeNull() would very likely still pass even
 * if that synchronous cancellation regressed, since the "route saved"
 * heading assertion each caller awaits first already proves clearDraft()
 * has resolved (handleSave's own promise chain calls clearDraft() before
 * the callback that makes that heading visible fires), well before a
 * stale timer scheduled ~900ms after the route name was last edited would
 * ever fire. This instead keeps sampling the real committed row across
 * that whole window, so a future regression that resurrects the draft
 * only later is still caught, mirroring editRouteAsPlanningCopy.spec.ts's
 * own readPlanningDraftRow-based proof but strengthened per this file's
 * own established no-shared-e2e-helpers-across-specs convention.
 */
async function assertPlanningDraftStaysCleared(page: Page): Promise<void> {
  await expect.poll(() => readPlanningDraftRow(page), { timeout: 5_000 }).toBeNull();
  const sampleIntervalMs = 150;
  const sampleCount = Math.ceil((DRAFT_AUTOSAVE_DEBOUNCE_MS + 300) / sampleIntervalMs);
  for (let i = 0; i < sampleCount; i += 1) {
    await page.waitForTimeout(sampleIntervalMs);
    expect(await readPlanningDraftRow(page)).toBeNull();
  }
}

const EXACT_REVERSE_NOTICE =
  "Reversed editable copy created. Recalculate before saving; one-way restrictions may make the new route differ from the original. The saved route remains unchanged.";
const DERIVED_REVERSE_NOTICE =
  "Reversed waypoints were estimated from this route. Recalculation may follow different roads, especially around one-way restrictions. The saved route remains unchanged.";

test("Reverse route issues zero requests until Calculate, seeds exact reversed waypoints with a suggested name and notice, sends reversed leg coordinates, and Save leaves the original route unchanged and reopenable", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  const { requestedCoordinatePairs } = await mockOrsRequests(page);

  const originalName = "ACN Original Route";
  await planAndSaveTwoWaypointRoute(page, originalName);
  expect(requestedCoordinatePairs).toHaveLength(1); // the original save's own single leg

  // Both actions are visible together, pre-ride, next to Start riding.
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit copy in Planning" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Reverse route" })).toBeEnabled();

  // Opening the reverse copy (no pre-existing draft) must navigate
  // directly, with no confirmation, and issue zero routing requests.
  await page.getByRole("button", { name: "Reverse route" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  expect(requestedCoordinatePairs).toHaveLength(1);

  await expect(page.getByText(EXACT_REVERSE_NOTICE)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue(`${originalName} (reversed)`);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  // Save/Export are unavailable before a fresh calculation.
  await expect(page.getByRole("button", { name: /save route/i })).toBeDisabled();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });

  // Exactly one new leg request, and its coordinates are the original
  // leg's own coordinates in reverse order.
  expect(requestedCoordinatePairs).toHaveLength(2);
  expect(requestedCoordinatePairs[1]).toEqual([...requestedCoordinatePairs[0]].reverse());

  await page.getByRole("button", { name: /save route/i }).click();
  await expect(
    page.getByRole("heading", { name: `${originalName} (reversed)` }),
  ).toBeVisible();
  await assertPlanningDraftStaysCleared(page);

  // The original route remains unchanged and independently reopenable —
  // two distinct routes now exist in the library, with different ids.
  await page.getByRole("button", { name: "Routes" }).click();
  await expect(
    page.getByRole("button", { name: originalName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${originalName} (reversed)`, exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: originalName, exact: true }).click();
  await expect(page.getByRole("heading", { name: originalName })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("exporting and offline re-importing the reversed route, then Edit copy in Planning, recovers the exact reversed waypoints", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  await mockOrsRequests(page);

  const originalName = "Round Trip Reversal Route";
  await planAndSaveTwoWaypointRoute(page, originalName);

  await page.getByRole("button", { name: "Reverse route" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(EXACT_REVERSE_NOTICE)).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });

  const reversedName = `${originalName} (reversed)`;
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("heading", { name: reversedName })).toBeVisible();
  await assertPlanningDraftStaysCleared(page);

  await page.getByRole("button", { name: "Routes" }).click();
  const download = await exportRouteFromLibrary(page, reversedName);
  expect(download.suggestedFilename()).toBe(`${reversedName}.gpx`);

  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("expected a downloaded file to have a local path");
  const gpxContents = await readFile(downloadPath, "utf-8");
  expect(gpxContents).toContain("acn:planning");

  // Re-import entirely offline — the copy below must stand on the file's
  // own ACN-encoded planning provenance alone.
  await page.unroute(ORS_URL_GLOB);
  let unexpectedOrsRequest = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    unexpectedOrsRequest = true;
    await route.abort("failed");
  });

  await page.getByLabel("Import GPX file").setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpxContents),
  });
  const routeCards = page.getByRole("button", { name: reversedName, exact: true });
  await expect(routeCards).toHaveCount(2);
  const reimportedButton = routeCards.first();
  await reimportedButton.click();
  await expect(page.getByRole("heading", { name: reversedName })).toBeVisible();

  // Edit copy in Planning (not Reverse route again) recovers the reversed
  // route's own waypoints exactly, forward, via its round-tripped
  // <acn:planning> provenance.
  await page.getByRole("button", { name: "Edit copy in Planning" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(
    page.getByText(
      "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("reversing a dense arbitrary GPX with no ACN extension stays within the 20-waypoint cap, derived, reversed", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  await page.getByRole("button", { name: "Routes" }).click();
  await mockOrsRequests(page);

  await page.getByLabel("Import GPX file").setInputFiles(SMOKE_ROUTE_GPX_PATH);
  const importedButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(importedButton).toBeVisible();
  await importedButton.click();
  await expect(page.getByRole("heading", { name: "smoke-route" })).toBeVisible();

  await page.getByRole("button", { name: "Reverse route" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(DERIVED_REVERSE_NOTICE)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue("smoke-route (reversed)");

  const waypointButtons = page.getByRole("button", { name: /^Waypoint \d+$/ });
  const derivedIntermediateCount = await waypointButtons.count();
  // +1 for the "Start" waypoint, which is labelled differently.
  expect(derivedIntermediateCount + 1).toBeLessThanOrEqual(20);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("reversing a closed loop retains the same start/finish coordinate with the interior traversal reversed", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  const { requestedCoordinatePairs } = await mockOrsRequests(page);

  const loopName = "Loop Reversal Route";
  await planAndSaveClosedLoopRoute(page, loopName);
  // Three legs for the original 4-waypoint closed loop (A-B, B-C, C-A).
  expect(requestedCoordinatePairs).toHaveLength(3);

  await page.getByRole("button", { name: "Reverse route" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(EXACT_REVERSE_NOTICE)).toBeVisible();
  expect(requestedCoordinatePairs).toHaveLength(3);

  // Still 4 waypoints, first and last still coincide — reversing
  // [A,B,C,A] yields [A,C,B,A], so the combined start/finish marker
  // persists at the same positions.
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 4", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Start and finish waypoints 1 and 4" }),
  ).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });

  // Three new legs, from a fresh per-mount leg cache.
  expect(requestedCoordinatePairs).toHaveLength(6);
  // Reversing waypoints [A,B,C,A] into [A,C,B,A] produces legs that are
  // exactly the original legs, in reverse order, with each leg's own two
  // endpoints reversed: legR1 = reverse(leg3), legR2 = reverse(leg2),
  // legR3 = reverse(leg1).
  expect(requestedCoordinatePairs[3]).toEqual([...requestedCoordinatePairs[2]].reverse());
  expect(requestedCoordinatePairs[4]).toEqual([...requestedCoordinatePairs[1]].reverse());
  expect(requestedCoordinatePairs[5]).toEqual([...requestedCoordinatePairs[0]].reverse());

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("shows a reverse-specific confirmation before replacing a meaningful existing Planning draft; Cancel preserves it and restores focus to Reverse route, Confirm replaces it", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  await mockOrsRequests(page);

  const routeName = "Confirm Reverse Test Route";
  await planAndSaveTwoWaypointRoute(page, routeName);

  // Start an unrelated, unsaved plan — a single waypoint is enough to
  // count as "meaningful" (non-empty).
  await openPlanningAndAwaitFraming(page);
  const freshMapContainer = page.locator('[data-testid="map-container"]');
  await freshMapContainer.click({ position: { x: 120, y: 130 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await page.waitForTimeout(1_200);

  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  const reverseButton = page.getByRole("button", { name: "Reverse route" });
  await reverseButton.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/reversing this route will replace your unsaved plan/i),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  // Cancel must not navigate — still on the pre-ride overview, focus
  // restored to Reverse route specifically.
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(reverseButton).toBeFocused();

  // The original unrelated draft (one waypoint, no second waypoint) must
  // be exactly as the rider left it.
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await page.getByRole("button", { name: "Reverse route" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Replace and reverse" })
    .click();

  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(EXACT_REVERSE_NOTICE)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue(`${routeName} (reversed)`);
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("reloading after creating the reverse draft recovers the draft and notice with no automatic routing request", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  const { requestedCoordinatePairs } = await mockOrsRequests(page);

  const originalName = "Reload Reversal Route";
  await planAndSaveTwoWaypointRoute(page, originalName);
  expect(requestedCoordinatePairs).toHaveLength(1);

  await page.getByRole("button", { name: "Reverse route" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(EXACT_REVERSE_NOTICE)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue(`${originalName} (reversed)`);
  // Confirms the seeded draft's own fields are genuinely persisted before
  // reloading, via a deterministic IndexedDB postcondition rather than a
  // fixed wait. The seeding write itself already happened synchronously in
  // RidingScreen (performCopyOperation) before navigation; this proves the
  // same row PlanningScreen is about to re-read after reload already
  // carries the reversed name. Distinct from the Save-versus-autosave race
  // (CLAUDE.md backlog item 30) this file's other waits used to guard
  // against — no Save button is pressed anywhere near this point.
  await expect
    .poll(() => readPlanningDraftRow(page), { timeout: 5_000 })
    .toMatchObject({ routeName: `${originalName} (reversed)` });
  expect(requestedCoordinatePairs).toHaveLength(1);

  await page.reload();
  await openPlanningAndAwaitFraming(page);

  await expect(page.getByText(EXACT_REVERSE_NOTICE)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue(`${originalName} (reversed)`);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();
  // The reload and re-hydration themselves must not issue any routing
  // request — the mocked count is unchanged from before the reload.
  expect(requestedCoordinatePairs).toHaveLength(1);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
