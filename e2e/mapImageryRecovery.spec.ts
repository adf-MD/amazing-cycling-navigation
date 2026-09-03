import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyleWithTileSource } from "./support/localMapStyle.ts";
import type { TileFailureController } from "./support/localMapStyle.ts";

// Proves backlog item 67 (non-blocking map-imagery failure and genuine
// reconnection recovery): a post-load tile failure shows a compact,
// non-technical, map-contained overlay with a working Retry, recovers
// genuinely (a real new imagery request, not merely a camera gesture or the
// passage of time), retries at most once automatically per failure episode,
// and never loses the rider's exact live camera state across the resulting
// map recreation — across Planning, active route Riding and free roam. A
// wholly independent spec file per this repo's own established
// no-shared-e2e-helpers-across-specs convention.

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround.
test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
const ROUTE_START = { latitude: 51.5, longitude: -0.1 };

const TWO_CLIMBS_FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/two-climbs-route.gpx", import.meta.url),
);
// Matches two-climbs-route.gpx — see ridingClimbView.spec.ts's own
// identical comment for the exact route shape this was measured against.
const CLIMBS_METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const CLIMBS_FIXTURE_LAT = 51.5;
const CLIMBS_FIXTURE_START_LON = -0.08;
const CLIMB_1_MID_METRES = 800;

function lonAtMetresAlongClimbsFixture(distanceMetres: number): number {
  return CLIMBS_FIXTURE_START_LON + distanceMetres / CLIMBS_METRES_PER_DEGREE_LON;
}

async function importAndStartRiding(page: Page): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

// Mirrors ridingCamera.spec.ts's own identical helpers — duplicated locally
// per this repo's established no-shared-e2e-helpers-across-specs convention.
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
  anchorX: string | null;
  anchorY: string | null;
}

async function readCameraAttributesAtomically(
  mapContainer: Locator,
): Promise<CameraAttributeSnapshot> {
  return mapContainer.evaluate((element) => ({
    centre: element.getAttribute("data-camera-center"),
    bearing: element.getAttribute("data-camera-bearing"),
    pitch: element.getAttribute("data-camera-pitch"),
    zoom: element.getAttribute("data-camera-zoom"),
    anchorX: element.getAttribute("data-camera-follow-anchor-x"),
    anchorY: element.getAttribute("data-camera-follow-anchor-y"),
  }));
}

/** Comfortably above MapLibre's own raw default zoom (0), comfortably
 * below what a real regional fitBounds produces in this suite's viewport.
 * Mirrors mapImageryCameraFraming.spec.ts's own identical constant. */
const RAW_WORLD_ZOOM_CEILING = 2;

async function readZoom(mapContainer: Locator): Promise<number> {
  const zoom = await mapContainer.getAttribute("data-camera-zoom");
  return zoom ? Number.parseFloat(zoom) : 0;
}

const ANCHOR_PIXEL_TOLERANCE = 2;

function anchorWithinTolerance(
  after: CameraAttributeSnapshot,
  baseline: CameraAttributeSnapshot,
): boolean {
  if (
    after.anchorX === null ||
    after.anchorY === null ||
    baseline.anchorX === null ||
    baseline.anchorY === null
  ) {
    return false;
  }
  return (
    Math.abs(Number(after.anchorX) - Number(baseline.anchorX)) < ANCHOR_PIXEL_TOLERANCE &&
    Math.abs(Number(after.anchorY) - Number(baseline.anchorY)) < ANCHOR_PIXEL_TOLERANCE
  );
}

/** Deterministically establishes a genuine manual pan via MapLibre's own
 * built-in KeyboardHandler — a real, trusted gesture carrying a DOM
 * originalEvent (see mapAdapter.ts's onUserCameraInteraction) — rather than
 * a synthetic pointer drag, avoiding CI's documented DragRotateHandler
 * stuck-gesture failure mode entirely (CLAUDE.md future-backlog item 21).
 * Mirrors ridingCamera.spec.ts's/freeRoam.spec.ts's own equivalent helpers
 * — duplicated locally per this repo's no-shared-e2e-helpers convention. */
async function establishManualPan(page: Page, mapContainer: Locator): Promise<void> {
  const canvas = mapContainer.locator("canvas");
  await canvas.focus();
  const centreBefore = await mapContainer.getAttribute("data-camera-center");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(centreBefore);
}

/**
 * Waits for the map's OWN full initial load to genuinely settle — every
 * initially in-view tile loaded or errored, MapLibre's own "load" event,
 * exposed via data-map-ready (see MapView.tsx's diagnostic-only attribute)
 * — before a test may safely fail a tile and expect the resulting error to
 * be classified specifically as a POST-load tile-error episode, distinct
 * from a pre-load one.
 *
 * The weaker preconditions this file previously relied on alone — the
 * "map-loading" testid hidden (only the STYLE DOCUMENT has loaded) and
 * tiles.requestCount() > 0 (only that SOME tile request has happened) —
 * do not guarantee this. Confirmed directly, via isolated single-worker
 * instrumented runs against this exact file, as the actual cause of two
 * real CI failures here (Deploy to GitHub Pages run 32401012094) — every
 * onError event throughout both failures showed hasLoaded=false, never
 * once true, from the very first tile request through the last. See
 * docs/project/history/items-56-68.md's item-67 entry for the full
 * diagnosis and its own follow-up entries for what changed since.
 *
 * A tile error before this settles is no longer silently dropped in
 * production (MapView.tsx's onError now recognises a source-or-tile error
 * regardless of hasLoaded) — this wait remains necessary anyway, purely as
 * a harness precondition, so a test deliberately exercising the post-load
 * path measures exactly that and not an incidental pre-load error.
 */
async function waitForMapFullyLoaded(mapContainer: Locator): Promise<void> {
  await expect(mapContainer).toHaveAttribute("data-map-ready", "true", {
    timeout: 15_000,
  });
}

/**
 * Enables tile failure, then proves — via failedTileRequestCount(), never
 * merely assumed from a single action's own side effect — that a genuinely
 * NEW tile request failed as a direct result, before returning. `action`
 * is a plausible, in-scope rider interaction the caller supplies (a Zoom-in
 * press for most call sites here; a further manual pan for the one test
 * whose own camera-history assertions specifically require a pan, never a
 * zoom, as the trigger); it may be invoked more than once — bounded — since
 * MapLibre may already hold the first attempt's own tiles cached, and only
 * the OBSERVED outcome, not the action itself, is trusted. Throws a
 * diagnosing error distinguishing "no new request was ever made" from "a
 * new request was made but did not fail" rather than only ever timing out
 * on the banner assertion downstream with no causal evidence either way.
 */
async function triggerFreshTileFailure(
  tiles: TileFailureController,
  action: () => Promise<void>,
): Promise<void> {
  const failedBefore = tiles.failedTileRequestCount();
  tiles.failTiles();

  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await action();
    try {
      await expect
        .poll(() => tiles.failedTileRequestCount(), { timeout: 3_000 })
        .toBeGreaterThan(failedBefore);
      return;
    } catch {
      // Try again — see the doc comment above.
    }
  }

  throw new Error(
    `No tile request failed after failTiles() and ${String(MAX_ATTEMPTS)} ` +
      `trigger attempts (failedTileRequestCount=` +
      `${String(tiles.failedTileRequestCount())}, succeededTileRequestCount=` +
      `${String(tiles.succeededTileRequestCount())}, baseline failed=` +
      `${String(failedBefore)}). Either no new tile request was made, or ` +
      `every request made since still succeeded.`,
  );
}

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

test("route Riding: a compact, non-technical tiles-unavailable banner never blocks the Map/Profile switcher or Profile's elevation controls", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });

  const tiles = await installLocalMapStyleWithTileSource(page);

  await page.goto("/");
  await importAndStartRiding(page);
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await waitForMapFullyLoaded(mapContainer);

  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await triggerFreshTileFailure(tiles, () => zoomIn.click());

  const banner = page.getByTestId("tiles-unavailable-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toHaveText(
    "Map imagery unavailable. The route and your position are still shown.Retry map imagery",
  );
  const bannerText = await banner.innerText();
  expect(bannerText).not.toMatch(/AJAXError|net::|http|https:\/\//i);

  // Backlog item 83: relocated into the active status card, not left
  // covering the map's own route-viewing area.
  expect(await banner.evaluate((el) => el.closest(".ride-status-card") !== null)).toBe(
    true,
  );
  expect(await banner.evaluate((el) => el.closest(".map-status-overlay") !== null)).toBe(
    false,
  );

  // The switcher and Profile's own elevation controls stay fully usable
  // while the banner is visible — a real click-through proof, not just a
  // bounding-box check.
  const switcher = page.getByRole("group", { name: "Riding view" });
  await expect(switcher).toBeVisible();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Profile", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Elevation profile view" })).toBeVisible();
  await page.getByRole("button", { name: "2 km" }).click();
  await expect(page.getByRole("button", { name: "2 km" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("route Riding: genuine reconnection recovery — an online event with no camera gesture triggers a real new imagery request and clears the banner only once it succeeds, preserving the followed camera", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });

  const tiles = await installLocalMapStyleWithTileSource(page);

  await page.goto("/");
  await importAndStartRiding(page);
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const mapContainer = page.locator('[data-testid="map-container"]');
  // Waits for a genuinely followed camera (pitch 35°, FOLLOW_PITCH_DEGREES)
  // — mirrors ridingCamera.spec.ts's own established "follow has landed"
  // signal, since MapLibre fires an initial settled callback at its own
  // default (0,0) centre before any follow command lands.
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  await waitForMapFullyLoaded(mapContainer);
  const baseline = await readCameraAttributesAtomically(mapContainer);

  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await triggerFreshTileFailure(tiles, () => zoomIn.click());
  const banner = page.getByTestId("tiles-unavailable-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const requestCountAtFailure = tiles.requestCount();

  tiles.succeedTiles();
  const requestCountBeforeResume = tiles.requestCount();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(requestCountBeforeResume);
  await expect(banner).not.toBeAttached({ timeout: 15_000 });
  expect(tiles.requestCount()).toBeGreaterThan(requestCountAtFailure);

  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  const after = await readCameraAttributesAtomically(mapContainer);
  expect(anchorWithinTolerance(after, baseline)).toBe(true);
  expect(numbersClose(after.bearing, baseline.bearing)).toBe(true);
  expect(numbersClose(after.pitch, baseline.pitch)).toBe(true);
});

// Backlog item 81: field evidence showed the camera intermittently ending
// at approximately whole-world zoom after a stale-GPS-plus-imagery-retry
// combination mid-ride. Combines this file's own manual-retry mechanism
// with ridingCamera.spec.ts's Zoom-in-to-a-non-default-zoom technique and
// ridingStatusCardRecovery.spec.ts's genuine context.clearPermissions()
// stale-fix mechanism (see that file's own header comment for why this
// reliably fires a real PERMISSION_DENIED on an already-active watch in
// current Chromium). This is real-MapLibre regression/non-regression
// coverage for the fix, not the prove-first evidence — the exact
// out-of-order-settle race the fix closes is proven deterministically at
// the component/integration level (MapView.test.tsx, RidingScreen.test.tsx),
// where the settle ordering is under full test control; a real browser
// gives no reliable way to force that same internal ordering without
// manufacturing an artificial, unrepresentative race.
test("route Riding: Follow's selected zoom survives a genuine stale-GPS-plus-imagery-retry recovery, for both a stationary and a moved fresh fix", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });

  const tiles = await installLocalMapStyleWithTileSource(page);

  await page.goto("/");
  await importAndStartRiding(page);
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  await waitForMapFullyLoaded(mapContainer);

  // Establish a genuinely non-default selected zoom.
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomBeforeAnyPress = await mapContainer.getAttribute("data-camera-zoom");
  await zoomIn.click();
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(zoomBeforeAnyPress);

  // A genuine mid-ride tile failure, triggered by a further Zoom-in press
  // (this file's own established technique). triggerFreshTileFailure only
  // proves a new tile request failed — an independent async signal from
  // the camera's own ease — so the zoom captured immediately afterwards
  // is not reliably the FINAL settled value; explicitly poll for a
  // genuine change from the first press's own zoom before capturing the
  // rider's real final selected zoom, the exact value the recovery below
  // must preserve.
  const zoomAfterFirstPress = await mapContainer.getAttribute("data-camera-zoom");
  await triggerFreshTileFailure(tiles, () => zoomIn.click());
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(zoomAfterFirstPress);
  const selectedZoom = await mapContainer.getAttribute("data-camera-zoom");
  const banner = page.getByTestId("tiles-unavailable-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });

  // GPS becomes genuinely stale — a real PERMISSION_DENIED on the
  // already-active watch, the retained fix stays visible.
  await context.clearPermissions();
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 10_000 });

  // Manual "Retry map imagery" while still genuinely failing — never
  // flips succeedTiles first, for the same still-in-flight-recovery race
  // reason as this file's own free-panned-camera test above.
  await banner.getByTestId("retry-map-imagery-button").click();
  tiles.succeedTiles();
  await expect(banner).not.toBeAttached({ timeout: 15_000 });

  // Connectivity and a fresh GPS fix return: re-grant permission at the
  // SAME coordinate (a genuinely stationary fix) and press "Try again" —
  // this file's own established real-permission-recovery mechanism.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toHaveCount(0, { timeout: 10_000 });

  // The rider's real selected zoom, never a raw/default world zoom.
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"), { timeout: 10_000 })
    .toBe(selectedZoom);
  await expect(page.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // A subsequently moved fresh fix must also use the preserved zoom.
  const centreBeforeMove = await mapContainer.getAttribute("data-camera-center");
  await context.setGeolocation({
    latitude: ROUTE_START.latitude,
    longitude: ROUTE_START.longitude + 0.001,
    accuracy: 5,
  });
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(centreBeforeMove);
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(selectedZoom);
});

test("route Riding: a manually free-panned camera survives a tile-error retry unchanged, rather than snapping back to Follow or a whole-route overview", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });

  const tiles = await installLocalMapStyleWithTileSource(page);

  await page.goto("/");
  await importAndStartRiding(page);
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  await waitForMapFullyLoaded(mapContainer);

  // A manual gesture pauses Follow (existing, unrelated behaviour) —
  // afterwards the camera is genuinely free-panned, not Follow-driven.
  await establishManualPan(page, mapContainer);
  await expect(page.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Fails tiles, then pans again — the pan itself is what requests
  // genuinely new (now-failing) tiles for the newly-visible area, so the
  // camera is never disturbed by an unrelated action (e.g. a zoom) taken
  // merely to trigger the failure, and triggerFreshTileFailure proves via
  // failedTileRequestCount() that the pan genuinely produced one, rather
  // than assuming it. pannedCamera is captured only once this second,
  // now-failing pan has itself fully settled, so it reflects the true
  // final position the retry below must restore.
  await triggerFreshTileFailure(tiles, () => establishManualPan(page, mapContainer));
  const pannedCamera = await readCameraAttributesAtomically(mapContainer);
  const banner = page.getByTestId("tiles-unavailable-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });

  // Clicks Retry while genuinely still failing — never flips succeedTiles
  // first: a still-in-flight tile burst succeeding on its own (ordinary,
  // non-retry recovery) could otherwise clear the banner before this
  // click lands, leaving it targeting an already-detached element and,
  // worse, never actually exercising the retry-triggered recreation this
  // test means to prove.
  await banner.getByTestId("retry-map-imagery-button").click();
  tiles.succeedTiles();
  await expect(banner).not.toBeAttached({ timeout: 15_000 });

  // Genuinely re-requests imagery for the still-panned viewport — proving
  // this is a real map recreation, not merely a UI state change.
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const restoredCamera = await readCameraAttributesAtomically(mapContainer);
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
  // Never silently resumed Follow — the pane stays in free/manual mode.
  await expect(page.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

async function startFreeRoam(page: Page, context: BrowserContext): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(ROUTE_START);
  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
}

test("free roam: tile-error retry preserves the camera and issues no additional geolocation watch", async ({
  page,
  context,
}) => {
  await installGeolocationWatchCounter(page);
  const tiles = await installLocalMapStyleWithTileSource(page);

  await startFreeRoam(page, context);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect.poll(() => mapContainer.getAttribute("data-camera-center")).not.toBe("");
  await waitForMapFullyLoaded(mapContainer);
  const watchCountBefore = await readWatchPositionCallCount(page);

  // Establishes a manually panned position, then uses Zoom in — which
  // requests different z/x/y tiles regardless of pan distance, unlike a
  // second pan (which may not reliably cross into a genuinely uncached
  // tile at this camera's zoom level and was observed to flake for
  // exactly that reason) — as the failure trigger, mirroring the Planning
  // test above. Requesting a different tile is NOT by itself a guarantee
  // that the resulting failure is ever correctly surfaced as this app's
  // own tiles-unavailable banner — see waitForMapFullyLoaded's own doc
  // comment for the real CI failure that disproved exactly that earlier
  // assumption. triggerFreshTileFailure proves, via
  // failedTileRequestCount(), that a request genuinely failed before
  // returning, rather than assuming the click's own side effect. pannedCamera
  // is captured last, immediately before the retry, so it reflects the
  // exact live camera (including the zoom-in itself) the retry below
  // must restore.
  await establishManualPan(page, mapContainer);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await triggerFreshTileFailure(tiles, () => zoomIn.click());
  const banner = page.getByTestId("tiles-unavailable-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  // Backlog item 83: relocated into the active status card, not left
  // covering the map's own route-viewing area.
  expect(await banner.evaluate((el) => el.closest(".ride-status-card") !== null)).toBe(
    true,
  );
  expect(await banner.evaluate((el) => el.closest(".map-status-overlay") !== null)).toBe(
    false,
  );
  const pannedCamera = await readCameraAttributesAtomically(mapContainer);

  // Clicks Retry while genuinely still failing — see the Riding
  // free-panned test's own identical comment for why succeedTiles must
  // never flip first.
  await banner.getByTestId("retry-map-imagery-button").click();
  tiles.succeedTiles();
  await expect(banner).not.toBeAttached({ timeout: 15_000 });

  const restoredCamera = await readCameraAttributesAtomically(mapContainer);
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

  expect(await readWatchPositionCallCount(page)).toBe(watchCountBefore);
});

test("Planning: a manually panned camera survives a tile-error retry, and the status overlay never blocks the zoom, Locate-me, North-up or crosshair controls", async ({
  page,
  context,
}) => {
  // Item 94 follow-up: a gesture only durably diverges the camera once
  // this generation already has a real, established view (see
  // MapView.tsx's own cameraEstablishedGenerationRef) — grant geolocation
  // so Planning's own automatic fresh-session regional fit establishes
  // one first, before the pan below, so this test continues to exercise
  // "a manual pan on an ALREADY-framed camera", its own actual intent.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  const tiles = await installLocalMapStyleWithTileSource(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await waitForMapFullyLoaded(mapContainer);
  await expect
    .poll(() => readZoom(mapContainer), { timeout: 15_000 })
    .toBeGreaterThan(RAW_WORLD_ZOOM_CEILING);
  // Establishes a manually panned position first. Planning's own initial
  // camera sits at a much lower (wider-area) zoom than Riding's followed
  // camera, where a single keyboard pan may not reliably cross into a
  // genuinely uncached tile — so, unlike the Riding/free-roam tests above,
  // a Zoom in press (requests different z/x/y tiles at any pan position,
  // never already cached) is used as the failure trigger here instead of
  // a second pan. Requesting a different tile is not by itself a
  // guarantee the resulting failure ever surfaces correctly as this app's
  // own banner — see waitForMapFullyLoaded's own doc comment — so
  // triggerFreshTileFailure proves via failedTileRequestCount() that a
  // request genuinely failed, rather than assuming the click's own side
  // effect is sufficient on its own.
  await establishManualPan(page, mapContainer);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await triggerFreshTileFailure(tiles, () => zoomIn.click());
  const banner = page.getByTestId("tiles-unavailable-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  // Backlog item 83: Planning has no active status card and never passes
  // onImageryStatusChange, so it must keep the default map-contained
  // presentation — the item 83 relocation must not remove or duplicate it.
  expect(await banner.evaluate((el) => el.closest(".map-status-overlay") !== null)).toBe(
    true,
  );

  // The overlay never intercepts clicks on any of Planning's own map
  // controls while it's visible. Zoom out is only checked for enabled
  // (not clicked, unlike the Zoom-in trigger above) so it can't disturb
  // the camera snapshot captured below immediately before the retry;
  // North-up genuinely gets clicked as the real click-through proof.
  const addWaypointButton = page.getByRole("button", { name: "Add waypoint here" });
  await expect(addWaypointButton).toBeEnabled();
  const zoomOutButton = page.getByRole("button", { name: "Zoom out" });
  await expect(zoomOutButton).toBeEnabled();
  const northUpButton = page.getByRole("button", { name: "North-up, top-down view" });
  await expect(northUpButton).toBeEnabled();
  await northUpButton.click();

  // Captured last, immediately before the retry, so it reflects the exact
  // live camera the retry below must restore — including the effect of
  // the real North-up click just proven above (coordinate/zoom are left
  // untouched by North-up, per mapAdapter.ts's setCamera(null, null, 0, 0, ...)).
  const pannedCamera = await readCameraAttributesAtomically(mapContainer);

  // Clicks Retry while genuinely still failing — see the Riding
  // free-panned test's own identical comment for why succeedTiles must
  // never flip first.
  await banner.getByTestId("retry-map-imagery-button").click();
  tiles.succeedTiles();
  await expect(banner).not.toBeAttached({ timeout: 15_000 });
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const restoredCamera = await readCameraAttributesAtomically(mapContainer);
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
});

test("does not create a retry loop: repeated failures and repeated online events cause at most one automatic retry, while manual Retry stays available throughout", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });

  const tiles = await installLocalMapStyleWithTileSource(page);

  await page.goto("/");
  await importAndStartRiding(page);
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);
  // One style-document fetch for the initial mount — the load-bearing
  // signal this test tracks throughout: exactly one per genuine map
  // (re)creation, confirmed by direct real-browser instrumentation to be
  // far more reliable than raw tile-request counts, which keep growing
  // for a single recreation for reasons entirely outside the app's own
  // control (MapLibre/the browser's own internal retry of an individual
  // failed tile fetch, observed directly and independently of this app's
  // own once-per-episode auto-retry guard, which a dedicated instrumented
  // run confirmed fires exactly once here regardless).
  expect(tiles.styleRequestCount()).toBe(1);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await waitForMapFullyLoaded(mapContainer);

  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await triggerFreshTileFailure(tiles, () => zoomIn.click());
  const banner = page.getByTestId("tiles-unavailable-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });

  // Still failing — dispatching online repeatedly must trigger at most
  // one automatic retry (one further map recreation, one further style
  // fetch), never an unbounded loop.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => tiles.styleRequestCount()).toBe(2);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // Give any (incorrect) further retry a moment to happen, then confirm
  // it didn't — a bounded wait on a genuinely negative assertion, not a
  // sleep substituting for a positive one (the preceding poll already
  // established a synchronised baseline, and a style-document fetch,
  // unlike a batch of tile requests, settles near-instantly with no
  // browser-concurrency-limited waves to wait out).
  await page.waitForTimeout(1_000);
  expect(tiles.styleRequestCount()).toBe(2);

  // The automatic retry above recreated the map from scratch against the
  // still-failing tile source, so this is a genuinely fresh instance
  // working through its own load/tile-request/failure sequence again —
  // comparable in duration to the first failure above, hence the same
  // explicit timeout rather than the 5000ms default.
  //
  // Deliberately NOT gated on waitForMapFullyLoaded here (unlike every
  // other call site in this file): a dedicated stress investigation of
  // this exact checkpoint found that when a map is recreated while its
  // tiles are STILL failing, MapLibre's own "load" event (this app's
  // `hasLoaded`, and therefore data-map-ready) can fail to fire at all —
  // confirmed directly against the unmodified baseline. Adding a wait
  // here would trade an intermittent flake for this checkpoint's own
  // outright, deterministic failure whenever that condition is hit.
  //
  // This checkpoint DID fail in a real CI run (a GitHub Pages deploy),
  // the first time the pre-existing flake this file's own history
  // documents was ever seen outside artificial stress testing — the
  // banner never reappeared, because MapView.tsx's onError handler used
  // to only recognise a tile error once its internal hasLoaded was
  // already true, silently dropping any error that arrived before that
  // (which, on a recreated instance whose own "load" never settles, is
  // every error). That production gap is now fixed: a source-or-tile
  // error is recognised regardless of hasLoaded, so this assertion no
  // longer depends on the recreated instance's own "load" ever firing —
  // see docs/project/history/items-56-68.md's item-67 entry for the full
  // diagnosis and fix.
  await expect(banner).toBeVisible({ timeout: 15_000 });
  // Manual Retry still works after the automatic allowance is exhausted —
  // clicked while genuinely still failing, matching every other manual-
  // retry test's own established ordering (see the Riding free-panned
  // test's comment for why succeedTiles must never flip first).
  await banner.getByTestId("retry-map-imagery-button").click();
  tiles.succeedTiles();
  await expect(banner).not.toBeAttached({ timeout: 15_000 });
  expect(tiles.styleRequestCount()).toBe(3);
});

// Backlog item 83's own direct regression test: field evidence showed the
// map-owned overlay and Retry button could still cover the upcoming route,
// including while an active-climb cue was present. Now that the terminal,
// retryable banner is relocated into the active status card, this proves
// the stronger claim that it never overlaps the map container at all — not
// merely that it avoids the climb cue's own box, which the relocation
// makes true by construction but is still worth asserting explicitly.
test("the relocated map-imagery recovery row never overlaps the map container or the active-climb cue", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: CLIMBS_FIXTURE_LAT,
    longitude: lonAtMetresAlongClimbsFixture(CLIMB_1_MID_METRES),
    accuracy: 5,
  });

  const tiles = await installLocalMapStyleWithTileSource(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(TWO_CLIMBS_FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", {
    name: "two-climbs-route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

  const climbCue = page.getByText("Climb active");
  await expect(climbCue).toBeVisible({ timeout: 15_000 });

  const mapContainer = page.locator('[data-testid="map-container"]');
  await waitForMapFullyLoaded(mapContainer);

  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await triggerFreshTileFailure(tiles, () => zoomIn.click());
  const banner = page.getByTestId("tiles-unavailable-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  expect(await banner.evaluate((el) => el.closest(".ride-status-card") !== null)).toBe(
    true,
  );
  expect(await banner.evaluate((el) => el.closest(".map-status-overlay") !== null)).toBe(
    false,
  );

  const bannerBox = await banner.boundingBox();
  const mapBox = await mapContainer.boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  if (bannerBox && mapBox) {
    expect(intersects(mapBox, bannerBox)).toBe(false);
  }

  const climbCueBox = await climbCue.locator("..").boundingBox();
  expect(climbCueBox).not.toBeNull();
  if (climbCueBox && bannerBox) {
    expect(intersects(climbCueBox, bannerBox)).toBe(false);
  }
});

test.describe("390px phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no horizontal overflow with the tiles-unavailable banner visible, and Retry is a real touch target", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });

    const tiles = await installLocalMapStyleWithTileSource(page);

    await page.goto("/");
    await importAndStartRiding(page);
    await expect.poll(() => tiles.requestCount()).toBeGreaterThan(0);

    const mapContainer = page.locator('[data-testid="map-container"]');
    await waitForMapFullyLoaded(mapContainer);

    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    await triggerFreshTileFailure(tiles, () => zoomIn.click());
    const banner = page.getByTestId("tiles-unavailable-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390 + 1);

    // Backlog item 83: the terminal, retryable banner now lives inside the
    // status card, not the map's own overlay — it must never overlap the
    // map container, and must instead be contained within the card.
    const mapBox = await mapContainer.boundingBox();
    const bannerBox = await banner.boundingBox();
    const cardBox = await page.locator(".ride-status-card").boundingBox();
    expect(mapBox).not.toBeNull();
    expect(bannerBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    if (mapBox && bannerBox) {
      expect(intersects(mapBox, bannerBox)).toBe(false);
    }
    if (cardBox && bannerBox) {
      expect(isFullyWithin(bannerBox, cardBox)).toBe(true);
    }

    const retryButton = banner.getByTestId("retry-map-imagery-button");
    const retryBox = await retryButton.boundingBox();
    expect(retryBox).not.toBeNull();
    if (retryBox) {
      // Backlog item 75 shrank the retry button (min-width 160px -> 112px)
      // so the overlay reads as a compact notice rather than a dominant
      // panel — still comfortably above the 44px touch-target floor.
      expect(retryBox.width).toBeGreaterThanOrEqual(44);
      expect(retryBox.width).toBeLessThan(155);
      expect(retryBox.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test("being offline alone, with no genuine tile/style failure, never shows a map-failure overlay", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });

  await installLocalMapStyleWithTileSource(page);

  await page.goto("/");
  await importAndStartRiding(page);

  const mapContainer = page.locator('[data-testid="map-container"]');
  await waitForMapFullyLoaded(mapContainer);

  await context.setOffline(true);
  try {
    // Backlog item 83: the compact connectivity indicator states the
    // browser-level fact plainly — never an imagery-failure claim, since
    // no genuine tile/style failure has occurred.
    const connectivityIndicator = page.locator(".ride-status-card-connectivity");
    await expect(connectivityIndicator).toBeVisible();
    await expect(connectivityIndicator).toHaveText("Offline");
    await expect(page.getByTestId("tiles-unavailable-banner")).not.toBeAttached();
    await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached();
    await expect(page.getByTestId("map-load-error")).not.toBeAttached();
    // Already-rendered imagery stays usable while merely offline.
    await expect(mapContainer.locator("canvas")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
