import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Proves "Clear draft" (CLAUDE.md future-backlog item 37): a destructive,
// confirmed action that wipes the entire mutable Planning draft — waypoints,
// history, the calculated/stale route, name, edit-copy provenance, and
// per-draft routing choices — back to a genuinely fresh session using the
// current Settings defaults, with the persisted draft row cleared from
// storage, never touching any saved route. No test in this file contacts a
// live map or routing provider.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Mirrors planning.spec.ts's own identical helper, duplicated locally per
// this project's established no-shared-e2e-helpers-across-specs convention.
function isFullyWithin(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** A minimal, valid ORS directions response, body-aware like the other
 * Planning specs' own identical helper (duplicated locally per this
 * project's convention). Densifies each requested leg so Save/Export's
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

async function preparePage(
  page: Page,
  context: BrowserContext,
  geolocation: { latitude: number; longitude: number } = {
    latitude: 51.5,
    longitude: -0.1,
  },
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
  await context.setGeolocation(geolocation);
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
  await page.getByRole("button", { name: "Plan", exact: true }).click();
}

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
 * automatic regional framing to settle — mirrors editRouteAsPlanningCopy.spec.ts's
 * and reverseRoute.spec.ts's identical helper. */
async function openPlanningAndAwaitFraming(page: Page): Promise<void> {
  // Exact match kept defensively even though the substring collision this
  // once guarded against ("Edit copy in Planning" containing "Plan") no
  // longer exists — backlog item 38 shortened that button's label to
  // "Edit copy".
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

// Mirrors PlanningScreen.tsx's own DRAFT_DEBOUNCE_MS; not imported across
// the app/e2e boundary, sized only to bound this file's own regression
// window below.
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 900;

/**
 * Proves the singleton Planning draft row stays cleared for the whole
 * window in which a stale pre-clear autosave timer could fire, not merely
 * once immediately after Clear draft's own clearDraft() resolves — mirrors
 * editRouteAsPlanningCopy.spec.ts's and reverseRoute.spec.ts's identical
 * helper (duplicated locally per this project's established
 * no-shared-e2e-helpers-across-specs convention).
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

const EXACT_EDIT_COPY_NOTICE =
  "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.";

test("Clear draft wipes a populated, calculated, custom-routed, edit-copy-provenanced draft to a genuinely fresh session using the real current Settings defaults, and the row stays cleared", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests, consoleErrors } = await preparePage(
    page,
    context,
  );
  await configureProviderKey(page);
  const { requestedCoordinatePairs } = await mockOrsRequests(page);

  // Seed a saved route with the untouched, real Settings defaults (Road
  // bike, ferries avoided) so that a later, deliberately different
  // per-draft choice is unambiguous.
  const sourceName = "Source Route For Clear Draft";
  await planAndSaveTwoWaypointRoute(page, sourceName);

  // planAndSaveTwoWaypointRoute's own Save already lands on this route's
  // Riding pre-ride panel — arrive at a meaningful draft via "Edit copy"
  // from here, populating editCopySourceRouteId/editCopyWaypointsOrigin/
  // editCopyOperation.
  await expect(page.getByRole("heading", { name: sourceName })).toBeVisible();
  await page.getByRole("button", { name: "Edit copy" }).click();
  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  await expect(page.getByText(EXACT_EDIT_COPY_NOTICE)).toBeVisible();

  // Custom name.
  const customName = "Custom Draft Before Clear";
  await page.getByLabel("Route name").fill(customName);

  // Custom per-draft routing settings, deliberately different from the
  // real (untouched) Settings default in both dimensions.
  await page.getByText("Change", { exact: true }).click();
  await page.getByRole("button", { name: "General cycling" }).click();
  const ferriesCheckbox = page.getByRole("checkbox", {
    name: "Avoid ferries for this draft",
  });
  await expect(ferriesCheckbox).toBeChecked();
  await ferriesCheckbox.uncheck();

  // Calculate, so a routed result also exists to be cleared.
  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });
  const requestCountBeforeClear = requestedCoordinatePairs.length;

  // Confirm the meaningful draft genuinely persisted before clearing it.
  await expect
    .poll(async () => {
      const draft = await readPlanningDraftRow(page);
      return draft?.routeName;
    })
    .toBe(customName);
  const persistedDraft = await readPlanningDraftRow(page);
  expect(persistedDraft?.profile).toBe("cycling-regular");
  expect(persistedDraft?.avoidFerries).toBe(false);
  expect(persistedDraft?.editCopySourceRouteId).toBeTruthy();
  expect(persistedDraft?.editCopyWaypointsOrigin).toBe("exact");

  // Open the confirmation and check its exact required copy.
  await page.getByRole("button", { name: "Clear draft" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Clear this draft?");
  await expect(dialog).toContainText(
    "This removes all waypoints, the calculated route and other unsaved draft details. Saved routes are not affected.",
  );
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await dialog.getByRole("button", { name: "Clear draft" }).click();
  await expect(dialog).not.toBeVisible();

  // Genuinely fresh Planning session: empty waypoints, reset name, no
  // routed result, no edit-copy notice, and no new routing request was
  // issued by the clear itself.
  await expect(page.getByText(/no waypoints yet/i)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue("Planned route");
  await expect(page.getByText(EXACT_EDIT_COPY_NOTICE)).not.toBeVisible();
  await expect(page.getByRole("region", { name: "Route summary" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /save route/i })).toBeDisabled();
  expect(requestedCoordinatePairs.length).toBe(requestCountBeforeClear);

  // The current draft's routing choices reflect the real Settings default
  // (Road bike, ferries avoided) — not the customised values that were
  // just cleared. The "Change" <details> disclosure is a plain,
  // uncontrolled native element that was already opened above (to select
  // General cycling/uncheck ferries) and stays open across Clear draft's
  // own state reset, since it is never unmounted — so it must not be
  // clicked again here, or it would toggle closed instead.
  await expect(page.getByRole("button", { name: "Road bike" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("checkbox", { name: "Avoid ferries for this draft" }),
  ).toBeChecked();

  await assertPlanningDraftStaysCleared(page);

  // The source route itself is never touched.
  await page.getByRole("button", { name: "Routes" }).click();
  await expect(page.getByRole("button", { name: sourceName, exact: true })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Cancel preserves a meaningful draft exactly, on screen and in storage, and restores focus to the trigger", async ({
  page,
  context,
}) => {
  await preparePage(page, context);
  await configureProviderKey(page);
  await mockOrsRequests(page);

  await openPlanningAndAwaitFraming(page);
  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 110, y: 110 } });
  await mapContainer.click({ position: { x: 210, y: 160 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await page.getByLabel("Route name").fill("Draft To Preserve");

  await expect
    .poll(async () => {
      const draft = await readPlanningDraftRow(page);
      return draft?.routeName;
    })
    .toBe("Draft To Preserve");

  const trigger = page.getByRole("button", { name: "Clear draft" });
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel("Route name")).toHaveValue("Draft To Preserve");
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  const draftAfterCancel = await readPlanningDraftRow(page);
  expect(draftAfterCancel?.routeName).toBe("Draft To Preserve");
  expect((draftAfterCancel?.waypoints as unknown[] | undefined)?.length).toBe(2);
});

test("reloading after Clear draft does not resurrect the old draft or its calculated result", async ({
  page,
  context,
}) => {
  await preparePage(page, context);
  await configureProviderKey(page);
  await mockOrsRequests(page);

  await openPlanningAndAwaitFraming(page);
  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 100, y: 100 } });
  await mapContainer.click({ position: { x: 200, y: 150 } });
  await page.getByLabel("Route name").fill("Draft Cleared Before Reload");
  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Clear draft" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Clear draft" }).click();
  await expect(dialog).not.toBeVisible();
  await assertPlanningDraftStaysCleared(page);

  await page.reload();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(page.getByText(/no waypoints yet/i)).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveValue("Planned route");
  await expect(page.getByRole("region", { name: "Route summary" })).not.toBeVisible();
});

test("Clear draft makes the fresh-session regional camera framing available again exactly once", async ({
  page,
  context,
}) => {
  await preparePage(page, context);
  await configureProviderKey(page);
  await mockOrsRequests(page);
  await openPlanningAndAwaitFraming(page);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 100, y: 100 } });
  await mapContainer.click({ position: { x: 200, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  // A genuine manual pan (mirrors planning.spec.ts's/reverseRoute.spec.ts's
  // own deterministic technique — an unmodified ArrowRight via MapLibre's
  // KeyboardHandler) so the camera is no longer at its automatic framing.
  await mapContainer.locator("canvas").focus();
  const centreBeforePan = await mapContainer.getAttribute("data-camera-center");
  await page.keyboard.press("ArrowRight");
  const CENTRE_CHANGE_TOLERANCE_DEGREES = 1e-4; // ~11 m, mirrors reverseRoute.spec.ts's own tolerance
  await expect
    .poll(async () => {
      const centre = await mapContainer.getAttribute("data-camera-center");
      if (!centre || !centreBeforePan) return false;
      const [lon, lat] = centre.split(",").map(Number);
      const [prevLon, prevLat] = centreBeforePan.split(",").map(Number);
      return (
        Math.abs(lon - prevLon) > CENTRE_CHANGE_TOLERANCE_DEGREES ||
        Math.abs(lat - prevLat) > CENTRE_CHANGE_TOLERANCE_DEGREES
      );
    })
    .toBe(true);
  const centreAfterPan = await mapContainer.getAttribute("data-camera-center");

  await page.getByRole("button", { name: "Clear draft" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Clear draft" }).click();
  await expect(dialog).not.toBeVisible();

  // The camera re-fits, no longer at the panned position — proving the
  // fresh-session regional fit is genuinely eligible again. (The real
  // Geolocation API's own maximumAge caching, deliberately used by
  // getApproximateLocationOnce for this one-shot, low-cost framing call,
  // means this fresh request may legitimately reuse the same recent fix
  // rather than issuing a brand-new physical reading — proving it uses
  // whatever a *fresh call's own result* resolves to, distinct from the
  // panned position, is what's being asserted here; a distinctly different
  // requestApproximateLocation result is separately, deterministically
  // proved at the component level in PlanningScreen.clearDraft.test.tsx.)
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(centreAfterPan);
  const centreAfterClear = await mapContainer.getAttribute("data-camera-center");

  // An ordinary later edit must not trigger a further re-fit.
  await mapContainer.click({ position: { x: 150, y: 150 } });
  await page.waitForTimeout(300);
  expect(await mapContainer.getAttribute("data-camera-center")).toBe(centreAfterClear);
});

test.describe("phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("phone layout: Clear draft and its open confirmation introduce no horizontal overflow, and the button keeps a real 44x44 touch target", async ({
    page,
    context,
  }) => {
    await preparePage(page, context);
    await configureProviderKey(page);
    await mockOrsRequests(page);

    await openPlanningAndAwaitFraming(page);
    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 100, y: 150 } });
    await mapContainer.click({ position: { x: 180, y: 220 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    const trigger = page.getByRole("button", { name: "Clear draft" });
    await trigger.scrollIntoViewIfNeeded();
    const triggerBox = await trigger.boundingBox();
    if (!triggerBox) {
      throw new Error("expected the Clear draft trigger to lay out");
    }
    expect(triggerBox.width).toBeGreaterThanOrEqual(44);
    expect(triggerBox.height).toBeGreaterThanOrEqual(44);

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    let clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await trigger.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    const confirmButton = dialog.getByRole("button", { name: "Clear draft" });
    const confirmBox = await confirmButton.boundingBox();
    if (!confirmBox) {
      throw new Error("expected the dialog's Clear draft confirm button to lay out");
    }
    expect(confirmBox.width).toBeGreaterThanOrEqual(44);
    expect(confirmBox.height).toBeGreaterThanOrEqual(44);
    const viewportSize = page.viewportSize();
    if (viewportSize) {
      expect(isFullyWithin(confirmBox, { x: 0, y: 0, ...viewportSize })).toBe(true);
    }
  });
});
