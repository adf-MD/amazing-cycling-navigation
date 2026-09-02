import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyleWithFailureControl } from "./support/localMapStyle.ts";
import type { StyleFailureController } from "./support/localMapStyle.ts";

// Proves backlog item 94 (preserve useful camera framing through offline
// map-imagery recovery): a genuine style-document-level failure (offline
// from the start) followed by a later recovery — via explicit "Retry map
// imagery" or automatic online recovery — must leave the camera framing
// something useful (the current waypoints or the saved route), never
// MapLibre's raw world-view default, while a genuinely manually-adjusted
// camera survives the same recovery unchanged. A wholly independent spec
// file per this repo's own established no-shared-e2e-helpers-across-specs
// convention — see mapImageryRecovery.spec.ts, whose own coverage is all
// post-load TILE-level failure/recovery already in Follow mode, a
// different scenario class from this file's pre-Follow/pre-gesture
// style-document-level cases.

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts/mapImageryRecovery.spec.ts, which need the same
// workaround.
test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

// Mirrors mapImageryRecovery.spec.ts's own identical helpers — duplicated
// locally per this repo's established no-shared-e2e-helpers-across-specs
// convention.
const CAMERA_VALUE_TOLERANCE = 1e-6;

function numbersClose(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(Number.parseFloat(a) - Number.parseFloat(b)) < CAMERA_VALUE_TOLERANCE;
}

interface CameraAttributeSnapshot {
  centre: string | null;
  bearing: string | null;
  pitch: string | null;
  zoom: string | null;
}

async function readCameraAttributesAtomically(
  mapContainer: Locator,
): Promise<CameraAttributeSnapshot> {
  return mapContainer.evaluate((element) => ({
    centre: element.getAttribute("data-camera-center"),
    bearing: element.getAttribute("data-camera-bearing"),
    pitch: element.getAttribute("data-camera-pitch"),
    zoom: element.getAttribute("data-camera-zoom"),
  }));
}

/** Comfortably above MapLibre's own raw default zoom (0) and comfortably
 * below what a real local-area (~50 km) or small-waypoint-cluster/route
 * fitBounds produces in this suite's viewport — used to prove a recovered
 * camera is materially framed, not left at the raw world-view default,
 * without needing to predict the exact resulting zoom (which varies with
 * viewport size and fitBounds padding). Deliberately a coarse threshold,
 * not an exact-value comparison — see this file's own tolerance-discipline
 * note below. */
const RAW_WORLD_ZOOM_CEILING = 2;

async function readZoom(mapContainer: Locator): Promise<number> {
  const zoom = await mapContainer.getAttribute("data-camera-zoom");
  return zoom ? Number.parseFloat(zoom) : 0;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Mirrors planning.spec.ts's own identical helper, duplicated locally per
// this repo's established e2e-spec precedent.
function isFullyWithin(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Deterministically establishes a genuine manual pan via MapLibre's own
 * built-in KeyboardHandler — a real, trusted gesture carrying a DOM
 * originalEvent (see mapAdapter.ts's onUserCameraInteraction) — rather than
 * a synthetic pointer drag, avoiding CI's documented DragRotateHandler
 * stuck-gesture failure mode (CLAUDE.md future-backlog item 21). Mirrors
 * mapImageryRecovery.spec.ts's own identical helper — duplicated locally
 * per this repo's no-shared-e2e-helpers convention. */
async function establishManualPan(page: Page, mapContainer: Locator): Promise<void> {
  const canvas = mapContainer.locator("canvas");
  await canvas.focus();
  const centreBefore = await mapContainer.getAttribute("data-camera-center");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(centreBefore);
}

async function openPlanningWithFallbackActive(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-fallback-banner")).toBeVisible({ timeout: 15_000 });
}

async function placeWaypointAndConfirm(mapContainer: Locator, page: Page): Promise<void> {
  await mapContainer.click({ position: { x: 150, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
}

/** Imports the fixture GPX and opens the resulting route's pre-ride
 * screen, deliberately never pressing "Start riding" — a genuinely clean
 * pre-ride session with no restored/suspended ride. */
async function importGpxAndOpenPreRide(page: Page): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
}

async function recoverViaRetryButton(
  page: Page,
  styleController: StyleFailureController,
): Promise<void> {
  const requestCountBeforeRetry = styleController.styleRequestCount();
  styleController.succeedStyle();
  await page.getByTestId("retry-map-imagery-button").click();
  await expect
    .poll(() => styleController.styleRequestCount())
    .toBeGreaterThan(requestCountBeforeRetry);
}

async function recoverViaOnlineEvent(
  page: Page,
  styleController: StyleFailureController,
): Promise<void> {
  const requestCountBeforeRecovery = styleController.styleRequestCount();
  styleController.succeedStyle();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() => styleController.styleRequestCount())
    .toBeGreaterThan(requestCountBeforeRecovery);
}

test("Planning: frames a waypoint placed while offline once imagery is retried explicitly", async ({
  page,
}) => {
  const styleController = await installLocalMapStyleWithFailureControl(page);
  styleController.failStyle();

  await openPlanningWithFallbackActive(page);
  const mapContainer = page.locator('[data-testid="map-container"]');
  await placeWaypointAndConfirm(mapContainer, page);
  expect(await readZoom(mapContainer)).toBeLessThanOrEqual(RAW_WORLD_ZOOM_CEILING);

  await recoverViaRetryButton(page, styleController);
  await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached({
    timeout: 15_000,
  });

  await expect
    .poll(() => readZoom(mapContainer), { timeout: 15_000 })
    .toBeGreaterThan(RAW_WORLD_ZOOM_CEILING);
  const marker = page.locator(".planning-waypoint-marker");
  await expect(marker).toHaveCount(1);
  const markerBox = await marker.boundingBox();
  const mapBox = await mapContainer.boundingBox();
  if (!markerBox || !mapBox) {
    throw new Error("expected the marker and map container to lay out");
  }
  expect(isFullyWithin(markerBox, mapBox)).toBe(true);
});

test("Planning: frames a waypoint placed while offline once connectivity returns automatically, without pressing Retry", async ({
  page,
}) => {
  const styleController = await installLocalMapStyleWithFailureControl(page);
  styleController.failStyle();

  await openPlanningWithFallbackActive(page);
  const mapContainer = page.locator('[data-testid="map-container"]');
  await placeWaypointAndConfirm(mapContainer, page);

  await recoverViaOnlineEvent(page, styleController);
  await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached({
    timeout: 15_000,
  });

  await expect
    .poll(() => readZoom(mapContainer), { timeout: 15_000 })
    .toBeGreaterThan(RAW_WORLD_ZOOM_CEILING);
  const marker = page.locator(".planning-waypoint-marker");
  await expect(marker).toHaveCount(1);
  const markerBox = await marker.boundingBox();
  const mapBox = await mapContainer.boundingBox();
  if (!markerBox || !mapBox) {
    throw new Error("expected the marker and map container to lay out");
  }
  expect(isFullyWithin(markerBox, mapBox)).toBe(true);
});

test("pre-ride: frames the complete saved route once imagery is retried explicitly, with no restored session", async ({
  page,
}) => {
  const styleController = await installLocalMapStyleWithFailureControl(page);
  styleController.failStyle();

  await page.goto("/");
  await importGpxAndOpenPreRide(page);
  await expect(page.getByTestId("map-fallback-banner")).toBeVisible({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');

  await recoverViaRetryButton(page, styleController);
  await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached({
    timeout: 15_000,
  });

  await expect
    .poll(() => readZoom(mapContainer), { timeout: 15_000 })
    .toBeGreaterThan(RAW_WORLD_ZOOM_CEILING);
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
});

test("pre-ride: frames the complete saved route once connectivity returns automatically, without pressing Retry", async ({
  page,
}) => {
  const styleController = await installLocalMapStyleWithFailureControl(page);
  styleController.failStyle();

  await page.goto("/");
  await importGpxAndOpenPreRide(page);
  await expect(page.getByTestId("map-fallback-banner")).toBeVisible({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');

  await recoverViaOnlineEvent(page, styleController);
  await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached({
    timeout: 15_000,
  });

  await expect
    .poll(() => readZoom(mapContainer), { timeout: 15_000 })
    .toBeGreaterThan(RAW_WORLD_ZOOM_CEILING);
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
});

test("Planning: preserves an exact manually-adjusted camera across a style-document failure/recovery instead of framing an available waypoint", async ({
  page,
}) => {
  const styleController = await installLocalMapStyleWithFailureControl(page);
  styleController.failStyle();

  await openPlanningWithFallbackActive(page);
  const mapContainer = page.locator('[data-testid="map-container"]');
  await placeWaypointAndConfirm(mapContainer, page);

  // A genuine manual pan while still on the fallback map establishes an
  // exact, non-default camera — the recovery below must preserve it
  // exactly, in preference to framing the waypoint placed above (backlog
  // item 94's manual-camera race).
  await establishManualPan(page, mapContainer);
  const pannedCamera = await readCameraAttributesAtomically(mapContainer);

  await recoverViaRetryButton(page, styleController);
  await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached({
    timeout: 15_000,
  });

  const restoredCamera = await readCameraAttributesAtomically(mapContainer);
  // Exact-value tolerance is correct here (unlike the fitBounds-based
  // framing assertions above): this is a restored setCamera snapshot, not
  // a padded fitBounds result, so it should reproduce the panned values
  // almost exactly, modulo negligible floating-point read-back noise.
  expect(
    numbersClose(
      restoredCamera.centre?.split(",")[0] ?? null,
      pannedCamera.centre?.split(",")[0] ?? null,
    ),
  ).toBe(true);
  expect(
    numbersClose(
      restoredCamera.centre?.split(",")[1] ?? null,
      pannedCamera.centre?.split(",")[1] ?? null,
    ),
  ).toBe(true);
  expect(numbersClose(restoredCamera.zoom, pannedCamera.zoom)).toBe(true);
  expect(numbersClose(restoredCamera.bearing, pannedCamera.bearing)).toBe(true);
  expect(numbersClose(restoredCamera.pitch, pannedCamera.pitch)).toBe(true);
});
