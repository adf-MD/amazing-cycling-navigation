import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Proves "Reverse route" (CLAUDE.md backlog item 38, superseding item 27's
// original pre-ride implementation): a saved or imported route, opened via
// the sole remaining "Edit copy" pre-ride action, can be reversed as an
// ordinary, local, undoable Planning edit — waypoint order and the route
// name reversed together as one atomic history entry, no routing-provider
// request issued until Calculate is pressed explicitly, and the source
// route always left untouched. No test in this file contacts a live map or
// routing provider.

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

/** Opens Planning (via the nav "Plan" destination) and waits for the map
 * and the genuinely-fresh-session automatic regional framing to settle —
 * see editRouteAsPlanningCopy.spec.ts's identical helper. Exact match is
 * kept defensively even though the substring collision this once guarded
 * against ("Edit copy in Planning" containing "Plan") no longer exists —
 * backlog item 38 shortened that button's label to "Edit copy". */
async function openPlanningAndAwaitFraming(page: Page): Promise<void> {
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

/** Opens the just-saved route's Planning draft via the sole remaining
 * "Edit copy" action (item 38 removed the pre-ride "Reverse route" entry
 * point entirely), awaits the same one-time camera framing
 * openPlanningAndAwaitFraming proves elsewhere, then presses Planning's own
 * new in-Planning "Reverse route" button. The Edit-copy step's own camera
 * fit/marker-containment/manual-pan-survival contract is already proven by
 * editRouteAsPlanningCopy.spec.ts and is deliberately not re-proven here —
 * this file focuses on what backlog item 38 actually adds: the in-Planning
 * reversal itself. */
async function editCopyThenReverseInPlanning(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Edit copy" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(500);
  const reverseButton = page.getByRole("button", { name: "Reverse route" });
  await expect(reverseButton).toBeEnabled();
  await reverseButton.click();
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

// The "forward" Edit-copy notice text — reversing an already-open draft
// inside Planning never touches editCopyMeta (it describes seed
// provenance, not live edit history — see PlanningScreen.tsx's
// describeEditCopyNotice doc comment), so this exact text stays visible,
// unchanged, across a reversal. There is deliberately no reverse-specific
// notice any more.
const EXACT_EDIT_COPY_NOTICE =
  "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.";
const DERIVED_EDIT_COPY_NOTICE =
  "Editable waypoints were estimated from this route. Recalculation may follow different roads. The saved route will remain unchanged.";

test("Reverse route inside Planning issues zero requests until Calculate — even past the recalculation debounce and across Undo/Redo — and restores order and name atomically", async ({
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

  await expect(page.getByRole("button", { name: "Edit copy" })).toBeEnabled();
  await editCopyThenReverseInPlanning(page);

  // Zero new requests from Edit copy + Reverse together; the unchanged
  // forward notice (not a reverse-specific one); name and order both
  // reversed.
  expect(requestedCoordinatePairs).toHaveLength(1);
  await expect(page.getByText(EXACT_EDIT_COPY_NOTICE)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue(`${originalName} (reversed)`);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  // Save/Export are unavailable before an explicit Calculate.
  await expect(page.getByRole("button", { name: /save route/i })).toBeDisabled();

  // Still zero requests well past the normal ~900ms recalculation
  // debounce — reversal must invalidate the (already-absent, in this
  // freshly-seeded-draft case) prior result and suppress the debounce
  // that would otherwise auto-recalculate.
  await page.waitForTimeout(1_200);
  expect(requestedCoordinatePairs).toHaveLength(1);

  // Undo restores both waypoint order and route name together, atomically.
  const undoButton = page.getByRole("button", { name: "Undo" });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expect(page.getByLabel("Route name")).toHaveValue(originalName);
  await page.waitForTimeout(1_200);
  expect(requestedCoordinatePairs).toHaveLength(1);

  // Redo reapplies both together, also with no provider contact.
  const redoButton = page.getByRole("button", { name: "Redo" });
  await expect(redoButton).toBeEnabled();
  await redoButton.click();
  await expect(page.getByLabel("Route name")).toHaveValue(`${originalName} (reversed)`);
  await page.waitForTimeout(1_200);
  expect(requestedCoordinatePairs).toHaveLength(1);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Calculate after Reverse route sends the reversed leg coordinates, and Save creates an independent reversed route leaving the original unchanged and reopenable", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  const { requestedCoordinatePairs } = await mockOrsRequests(page);

  const originalName = "ACN Original Route For Calculate";
  await planAndSaveTwoWaypointRoute(page, originalName);
  expect(requestedCoordinatePairs).toHaveLength(1);

  await editCopyThenReverseInPlanning(page);
  expect(requestedCoordinatePairs).toHaveLength(1);

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
  // two distinct routes now exist in the library.
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

test("exporting and offline re-importing a reversed route, then Edit copy, recovers the exact reversed waypoints", async ({
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

  await editCopyThenReverseInPlanning(page);
  await expect(page.getByText(EXACT_EDIT_COPY_NOTICE)).toBeVisible();

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

  // Edit copy (the reimported route is already reversed, so no second
  // Reverse press is needed) recovers its own waypoints exactly, via its
  // round-tripped <acn:planning> provenance.
  await page.getByRole("button", { name: "Edit copy" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(EXACT_EDIT_COPY_NOTICE)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("reversing a dense arbitrary GPX with no ACN extension stays within the 20-waypoint cap, derived", async ({
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

  await editCopyThenReverseInPlanning(page);
  await expect(page.getByText(DERIVED_EDIT_COPY_NOTICE)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue("smoke-route (reversed)");

  const waypointButtons = page.getByRole("button", { name: /^Waypoint \d+$/ });
  const derivedIntermediateCount = await waypointButtons.count();
  // +1 for the "Start" waypoint, which is labelled differently. The
  // derivation happened once, at Edit-copy seed time; Reverse only
  // reorders whatever was already derived — it must never re-derive or
  // increase the count.
  expect(derivedIntermediateCount + 1).toBeLessThanOrEqual(20);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("reversing a closed-loop draft inside Planning retains the same start/finish coordinate with the interior traversal reversed", async ({
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

  await editCopyThenReverseInPlanning(page);
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

test("reloading after reversing a draft inside Planning restores it without an automatic routing request", async ({
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

  await editCopyThenReverseInPlanning(page);
  await expect(page.getByLabel("Route name")).toHaveValue(`${originalName} (reversed)`);
  // Confirms the reversed draft's own fields are genuinely persisted
  // before reloading, via a deterministic IndexedDB postcondition rather
  // than a fixed wait — distinct from the Save-versus-autosave race
  // (CLAUDE.md backlog item 30); no Save button is pressed anywhere near
  // this point.
  await expect
    .poll(() => readPlanningDraftRow(page), { timeout: 5_000 })
    .toMatchObject({ routeName: `${originalName} (reversed)` });
  expect(requestedCoordinatePairs).toHaveLength(1);

  await page.reload();
  await openPlanningAndAwaitFraming(page);

  await expect(page.getByText(EXACT_EDIT_COPY_NOTICE)).toBeVisible();
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

test.describe("phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Reverse route is a usable touch target and causes no horizontal overflow", async ({
    page,
    context,
  }) => {
    const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
      page,
      context,
    );
    await configureProviderKey(page);
    await mockOrsRequests(page);

    const originalName = "Phone Viewport Reverse Route";
    await planAndSaveTwoWaypointRoute(page, originalName);

    await page.getByRole("button", { name: "Edit copy" }).click();
    await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(500);

    const reverseButton = page.getByRole("button", { name: "Reverse route" });
    await reverseButton.scrollIntoViewIfNeeded();
    const box = await reverseButton.boundingBox();
    if (!box) throw new Error("expected the Reverse route button to lay out");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    let clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await reverseButton.click();
    await expect(page.getByLabel("Route name")).toHaveValue(`${originalName} (reversed)`);

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
