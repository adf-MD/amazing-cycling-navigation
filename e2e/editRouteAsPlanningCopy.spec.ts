import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Proves "Edit copy in Planning" (CLAUDE.md future-backlog item 26): a
// saved or imported route can be reopened as an editable Planning copy,
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
 * specs convention) — but unlike that helper, this one densifies each
 * requested leg with interpolated intermediate points rather than
 * returning the raw two endpoints unchanged. canSaveOrExportPlan.ts gates
 * Save/Export on the calculated route having strictly more geometry
 * points than waypoints (a proxy for "actually routed, not degenerate"),
 * which a bare two-point echo would never satisfy — this file's tests
 * click Save, unlike that one's. */
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

/**
 * Common per-test setup: console/pageerror capture, the local map style
 * (never a live OpenFreeMap request), a mocked geolocation fix, and
 * navigation to "/". Geolocation is mocked — mirroring planning.spec.ts's
 * own "Locate me"/current-location tests — so PlanningScreen's existing
 * "genuinely fresh session frames an approximately 50x50km box around the
 * rider's approximate location" behaviour resolves deterministically
 * before any waypoint is placed. Without it, the map can still be at an
 * unframed, very-low-zoom default when a test clicks it, and MapLibre's
 * own screen-to-lnglat conversion at that zoom can legitimately return a
 * world-wrapped longitude outside the canonical +/-180 degree range (a
 * real point, just not normalised) — harmless for display, but rejected
 * by GPX re-import's own coordinate-range validation, which several tests
 * below genuinely exercise.
 */
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

/** Opens Planning and waits both for the map to finish loading and for the
 * genuinely-fresh-session automatic regional framing (driven by the
 * mocked geolocation fix set up in preparePage) to settle, so a
 * subsequent map click lands at a real, in-range coordinate rather than
 * whatever indeterminate default camera preceded it. */
async function openPlanningAndAwaitFraming(page: Page): Promise<void> {
  // Non-exact: "Edit copy in Planning" (Riding's pre-ride overview) also
  // contains "Plan" as a substring, so an exact match is required whenever
  // that button might also be on screen.
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
  // Proves the Save-versus-autosave draft race (CLAUDE.md backlog item 30)
  // stays closed: the name fill above re-arms the 900ms draft-autosave
  // debounce, and PlanningScreen now synchronously cancels it at Save, so
  // the singleton draft row must stay cleared rather than being
  // resurrected once that timer would otherwise have fired.
  await expect.poll(() => readPlanningDraftRow(page), { timeout: 5_000 }).toBeNull();
}

/** Exports a route directly from its own Route Library card's "Export"
 * button (scoped by the card containing that route's own name-opening
 * button, since every card has an identically-labelled "Export" button) —
 * distinct from Planning's own "Export GPX" button, which only exists
 * mid-Planning-session and is not what this file's saved-route round-trip
 * tests need. Must be called while already on the Routes screen. */
async function exportRouteFromLibrary(page: Page, routeName: string) {
  const routeCard = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: routeName, exact: true }) });
  const downloadPromise = page.waitForEvent("download");
  await routeCard.getByRole("button", { name: "Export" }).click();
  return downloadPromise;
}

const EXACT_NOTICE =
  "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.";
const DERIVED_NOTICE =
  "Editable waypoints were estimated from this route. Recalculation may follow different roads. The saved route will remain unchanged.";

test("recovers exact planning waypoints with zero routing requests until Calculate, edits and saves as a new route, leaving the original unchanged and reopenable", async ({
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

  // Opening the copy (no pre-existing draft) must navigate directly, with
  // no confirmation, and issue zero routing requests.
  await page.getByRole("button", { name: "Edit copy in Planning" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  expect(requestedCoordinatePairs).toHaveLength(1);

  await expect(page.getByText(EXACT_NOTICE)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue(originalName);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  // Edit: append a third waypoint via a direct map tap, then recalculate —
  // proves per-section requests are issued for the edited copy.
  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 260, y: 190 } });
  await expect(
    page.getByRole("button", { name: "Waypoint 3", exact: true }),
  ).toBeVisible();

  const recalculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(recalculateButton).toBeEnabled();
  await recalculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });

  // Two new section requests (A->B, B->C) for the edited three-waypoint
  // copy, from a genuinely empty per-leg cache (a fresh PlanningScreen
  // mount) — total requests: 1 (original) + 2 (edited).
  expect(requestedCoordinatePairs).toHaveLength(3);
  expect(requestedCoordinatePairs[1]).toHaveLength(2);
  expect(requestedCoordinatePairs[2]).toHaveLength(2);

  const editedName = "ACN Edited Copy";
  await page.getByLabel("Route name").fill(editedName);
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("heading", { name: editedName })).toBeVisible();

  // The original route remains unchanged and independently reopenable —
  // two distinct routes now exist in the library.
  await page.getByRole("button", { name: "Routes" }).click();
  await expect(
    page.getByRole("button", { name: originalName, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: editedName, exact: true })).toBeVisible();

  await page.getByRole("button", { name: originalName, exact: true }).click();
  await expect(page.getByRole("heading", { name: originalName })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("derives at most 20 waypoints from an arbitrary GPX with no ACN extension, and the copy can be recalculated and saved separately", async ({
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

  await page.getByRole("button", { name: "Edit copy in Planning" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(DERIVED_NOTICE)).toBeVisible();

  const waypointButtons = page.getByRole("button", { name: /^Waypoint \d+$/ });
  const derivedIntermediateCount = await waypointButtons.count();
  // +1 for the "Start" waypoint, which is labelled differently.
  expect(derivedIntermediateCount + 1).toBeLessThanOrEqual(20);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });

  const savedName = "Derived Copy Route";
  await page.getByLabel("Route name").fill(savedName);
  await page.getByRole("button", { name: /save route/i }).click();
  await expect(page.getByRole("heading", { name: savedName })).toBeVisible();

  await page.getByRole("button", { name: "Routes" }).click();
  await expect(
    page.getByRole("button", { name: "smoke-route", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: savedName, exact: true })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("shows a confirmation before replacing a meaningful existing Planning draft; Cancel preserves it, Confirm replaces it", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  await mockOrsRequests(page);

  const routeName = "Confirm Test Route";
  await planAndSaveTwoWaypointRoute(page, routeName);

  // Start an unrelated, unsaved plan — a single waypoint is enough to
  // count as "meaningful" (non-empty). Wait past the 900ms draft-autosave
  // debounce before navigating away, so it genuinely persists.
  await openPlanningAndAwaitFraming(page);
  const freshMapContainer = page.locator('[data-testid="map-container"]');
  await freshMapContainer.click({ position: { x: 120, y: 130 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await page.waitForTimeout(1_200);

  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Edit copy in Planning" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  // Cancel must not navigate — still on the pre-ride overview.
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  // The original unrelated draft (one waypoint, no second waypoint) must
  // be exactly as the rider left it.
  // Non-exact: "Edit copy in Planning" (Riding's pre-ride overview) also
  // contains "Plan" as a substring, so an exact match is required whenever
  // that button might also be on screen.
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await page.getByRole("button", { name: "Edit copy in Planning" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Replace and edit" })
    .click();

  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(EXACT_NOTICE)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("exporting and offline re-importing the edited route preserves its new planning provenance exactly", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  await mockOrsRequests(page);

  const routeName = "Round Trip Route";
  await planAndSaveTwoWaypointRoute(page, routeName);

  await page.getByRole("button", { name: "Routes" }).click();
  const download = await exportRouteFromLibrary(page, routeName);
  expect(download.suggestedFilename()).toBe(`${routeName}.gpx`);

  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("expected a downloaded file to have a local path");
  const gpxContents = await readFile(downloadPath, "utf-8");
  expect(gpxContents).toContain("acn:planning");
  expect(gpxContents).toContain('profile="cycling-road"');

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
  // Duplicate route names are permitted (CLAUDE.md's own Planning-saving
  // contract), and the re-imported file derives the exact same name as
  // the still-present original — two cards now share it. The library's
  // default "Most recent" sort puts the just-imported one first.
  const routeCards = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeCards).toHaveCount(2);
  const reimportedButton = routeCards.first();
  await reimportedButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Edit copy in Planning" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  // "exact", not "derived" — the reimported file's own <acn:planning>
  // extension round-tripped the authored waypoints, not the geometry.
  await expect(page.getByText(EXACT_NOTICE)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a tampered acn:planning geometry digest falls back to derivation without failing the import", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  await mockOrsRequests(page);

  const routeName = "Tampered Provenance Route";
  await planAndSaveTwoWaypointRoute(page, routeName);

  await page.getByRole("button", { name: "Routes" }).click();
  const download = await exportRouteFromLibrary(page, routeName);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("expected a downloaded file to have a local path");
  const gpxContents = await readFile(downloadPath, "utf-8");
  expect(gpxContents).toContain("acn:planning");

  const tamperedContents = gpxContents.replace(
    /(<acn:planning[^>]*geometrySha256=")[0-9a-f]{64}(")/,
    `$1${"a".repeat(64)}$2`,
  );
  expect(tamperedContents).not.toBe(gpxContents);

  // Already on Routes after exporting — import the tampered file directly.
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${routeName} (tampered).gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(tamperedContents),
  });

  // Import still succeeds, with a non-blocking notice about the rejected
  // planning extension — never a hard failure.
  const importedName = `${routeName} (tampered)`;
  const importedButton = page.getByRole("button", { name: importedName, exact: true });
  await expect(importedButton).toBeVisible();
  await expect(page.getByText(/did not match the route geometry/i)).toBeVisible();

  await importedButton.click();
  await expect(page.getByRole("heading", { name: importedName })).toBeVisible();

  await page.getByRole("button", { name: "Edit copy in Planning" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(DERIVED_NOTICE)).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
