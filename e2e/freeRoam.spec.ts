import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { forceMapStyleFailure, installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Proves backlog item 42 (route-less free roam): a live GPS position on the
// ordinary map with camera follow, reachable and recoverable entirely
// through the Ride launcher, with no OpenRouteService dependency at any
// point and no silent conflict with a saved route.

const ORS_URL_GLOB = "https://api.heigit.org/**";
const START = { latitude: 51.5, longitude: -0.1 };
const MOVED = { latitude: 51.5006, longitude: -0.1 }; // ~67 m north

// Mirrors layout.spec.ts's own identical helpers — duplicated locally per
// this repo's established no-shared-e2e-helpers-across-specs convention.
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

// Mirrors ridingCamera.spec.ts's own identical numbersClose/centresClose
// pair and its doc comment — duplicated locally per this repo's
// established no-shared-e2e-helpers-across-specs convention.
const CAMERA_VALUE_TOLERANCE = 1e-6;

function numbersClose(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(Number.parseFloat(a) - Number.parseFloat(b)) < CAMERA_VALUE_TOLERANCE;
}

function centresClose(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const [aLon, aLat] = a.split(",");
  const [bLon, bLat] = b.split(",");
  return numbersClose(aLon, bLon) && numbersClose(aLat, bLat);
}

/** Deterministic replacement for a fixed sleep, mirroring
 * ridingLauncher.spec.ts's own identical helper — duplicated locally per
 * this repo's established no-shared-e2e-helpers-across-specs convention. */
async function waitForClearedRideState(page: Page): Promise<void> {
  await expect.poll(() => readActiveRideStateRow(page), { timeout: 10_000 }).toBeNull();
}

/** Mirrors ridingCamera.spec.ts's own establishManualRotationAndPitch —
 * duplicated locally per this repo's established no-shared-e2e-helpers
 * convention. Uses MapLibre's own built-in KeyboardHandler (a genuine,
 * trusted user gesture carrying a DOM originalEvent — see
 * mapAdapter.ts's onUserCameraInteraction) rather than a synthetic pointer
 * drag, avoiding CI's documented DragRotateHandler stuck-gesture failure
 * mode entirely (CLAUDE.md future-backlog item 21). */
async function establishManualRotation(page: Page, mapContainer: Locator): Promise<void> {
  const canvas = mapContainer.locator("canvas");
  await canvas.focus();
  const bearingBefore = await mapContainer.getAttribute("data-camera-bearing");
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-bearing"))
    .not.toBe(bearingBefore);
}

async function startFreeRoam(page: Page, context: BrowserContext) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(START);

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
}

test("Start free roam shows a live position on the map, with zero OpenRouteService requests", async ({
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

  let orsRequested = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    orsRequested = true;
    await route.abort("failed");
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start free roam" })).toBeVisible();

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(START);
  await page.getByRole("button", { name: "Start free roam" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "End ride" })).toBeVisible();
  await expect(page.getByText(/GPS accuracy:/)).toBeVisible();

  expect(orsRequested).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a position change moves the followed camera; a manual interaction pauses it, and Follow restores it", async ({
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

  const mapContainer = page.locator('[data-testid="map-container"]');
  // Waits for the real followed camera to genuinely land (mirrors
  // ridingCamera.spec.ts's own established pattern): MapLibre fires an
  // initial "settled" callback at style load with its own default centre
  // (0,0) before the follow command ever applies, so polling on centre
  // alone would be satisfied early by that unrelated transition. Pitch
  // "35" (FOLLOW_PITCH_DEGREES) only appears once a real GPS-driven follow
  // command has actually landed.
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  const initialCentre = await mapContainer.getAttribute("data-camera-center");

  await context.setGeolocation(MOVED);
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(initialCentre);

  const followButton = page.getByRole("button", { name: "Follow my location" });
  await expect(followButton).toHaveAttribute("aria-pressed", "true");

  await establishManualRotation(page, mapContainer);
  await expect(followButton).toHaveAttribute("aria-pressed", "false");

  await followButton.click();
  await expect(followButton).toHaveAttribute("aria-pressed", "true");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a committed free-roam row survives a real reload; the launcher offers Resume free roam, restoring stale-then-fresh state", async ({
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
  // A fix must actually have been accepted and persisted before reloading —
  // mirrors ridingLauncher.spec.ts's own established rationale (UI state
  // going green is not proof the async IndexedDB write has landed).
  await expect.poll(() => page.getByText(/GPS accuracy:/).isVisible()).toBe(true);
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam", lastFix: expect.anything() });

  let orsRequested = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    orsRequested = true;
    await route.abort("failed");
  });

  await page.reload();
  // The same established contract as route sessions: a reload alone never
  // restores in-memory ride content — navigating to "Ride" directly is
  // what proves the launcher discovers the session from persisted storage.
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();

  const resumeButton = page.getByRole("button", { name: "Resume free roam" });
  await expect(resumeButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Start free roam" })).toBeHidden();

  await resumeButton.click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  // The restored fix renders immediately (never a blank/waiting state) —
  // the exact "Stale" vs "Live" transition is not asserted here, since a
  // real device with geolocation already granted can deliver a fresh fix
  // fast enough that the transient stale window isn't reliably observable
  // under Playwright's polling; the component-level restore proof already
  // covers this precisely (useFreeRoamNavigation.test.ts's "restore"
  // suite). What matters end-to-end is that restoration definitely
  // happened and a subsequent position update definitely reaches "Live".
  await expect(page.getByText(/GPS accuracy:/)).toBeVisible();

  await context.setGeolocation(MOVED);
  await expect(page.getByText(/Live/)).toBeVisible();

  expect(orsRequested).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("End ride from the active screen clears the row and returns to the empty launcher", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  await startFreeRoam(page, context);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const endRideButton = page.getByRole("button", { name: "End ride" });
  await endRideButton.click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByText("Your free roam position and camera state will be cleared."),
  ).toBeVisible();

  // .ride-end-ride-row is a persistent action-slot container (backlog item
  // 50): it stays mounted and now contains the confirmation directly,
  // rather than the confirmation being appended elsewhere on the page. The
  // heading/status/map stay visible around it throughout.
  const dialogInsideEndRideRow = await page.evaluate(() => {
    const row = document.querySelector(".ride-end-ride-row");
    const alertDialog = document.querySelector('[role="alertdialog"]');
    return Boolean(row && alertDialog && row.contains(alertDialog));
  });
  expect(dialogInsideEndRideRow).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect(page.getByTestId("map-container")).toBeVisible();

  // Cancel restores the trigger in the same slot, focused.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(endRideButton).toBeFocused();

  await endRideButton.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "End ride" }).click();

  await waitForClearedRideState(page);
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start free roam" })).toBeVisible();
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});

test("End ride from the unresumed launcher works directly, without ever resuming GPS", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  await startFreeRoam(page, context);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam" });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();

  const resumeButton = page.getByRole("button", { name: "Resume free roam" });
  await expect(resumeButton).toBeVisible();
  const endRideButton = page.getByRole("button", { name: "End ride" });
  await endRideButton.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  // .ride-launcher-clear-row is a persistent action-slot container
  // (backlog item 50): it stays mounted and now contains the confirmation
  // directly. Resume free roam and its own panel context stay visible
  // around it, unaffected.
  const dialogInsideClearRow = await page.evaluate(() => {
    const row = document.querySelector(".ride-launcher-clear-row");
    const alertDialog = document.querySelector('[role="alertdialog"]');
    return Boolean(row && alertDialog && row.contains(alertDialog));
  });
  expect(dialogInsideClearRow).toBe(true);
  await expect(resumeButton).toBeVisible();

  await dialog.getByRole("button", { name: "End ride" }).click();

  await waitForClearedRideState(page);
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});

test("a saved route cannot silently replace an unfinished free-roam session, and opens normally once free roam is ended", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  await startFreeRoam(page, context);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam" });

  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "free-roam-conflict-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>free-roam-conflict-route</name>
    <trkseg>
      <trkpt lat="51.5" lon="-0.1"><ele>10</ele></trkpt>
      <trkpt lat="51.501" lon="-0.1"><ele>12</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`,
    ),
  });
  const routeButton = page.getByRole("button", {
    name: "free-roam-conflict-route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await expect(
    page.getByText(
      "You have an unfinished free roam session. End it before opening a saved route.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume free roam" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "free-roam-conflict-route" }),
  ).toBeHidden();

  await page.getByRole("button", { name: "End ride" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "End ride" }).click();
  await waitForClearedRideState(page);

  await page.getByRole("button", { name: "Routes" }).click();
  await routeButton.click();
  await expect(
    page.getByRole("heading", { name: "free-roam-conflict-route" }),
  ).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});

// Mirrors ridingCamera.spec.ts's own identically-purposed zoom-persistence
// test (backlog item 53), adapted to free roam's own reload/resume path
// ("Resume free roam" via the Ride launcher, not a named route).
test("zoom while followed persists across a later GPS fix, storage, reload and Resume free roam", async ({
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

  const mapContainer = page.locator('[data-testid="map-container"]');
  const followButton = page.getByRole("button", { name: "Follow my location" });
  const zoomInButton = page.getByRole("button", { name: "Zoom in" });

  // 1. Wait for the real followed camera to genuinely settle.
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");

  // 2. Capture the settled camera before zooming.
  const centreBeforeZoom = await mapContainer.getAttribute("data-camera-center");
  const bearingBeforeZoom = await mapContainer.getAttribute("data-camera-bearing");
  const pitchBeforeZoom = await mapContainer.getAttribute("data-camera-pitch");
  const zoomBeforeZoom = await mapContainer.getAttribute("data-camera-zoom");

  // 3. Press Zoom in; wait for a genuine, numerically greater zoom.
  await zoomInButton.click();
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(zoomBeforeZoom);
  const zoomAfterZoom = await mapContainer.getAttribute("data-camera-zoom");
  expect(Number(zoomAfterZoom)).toBeGreaterThan(Number(zoomBeforeZoom));

  // 4. Follow stays engaged; no paused toast.
  await expect(followButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Map follow paused.")).toHaveCount(0);

  // 5. Centre/bearing/pitch untouched by the zoom command itself.
  expect(
    centresClose(await mapContainer.getAttribute("data-camera-center"), centreBeforeZoom),
  ).toBe(true);
  expect(await mapContainer.getAttribute("data-camera-bearing")).toBe(bearingBeforeZoom);
  expect(await mapContainer.getAttribute("data-camera-pitch")).toBe(pitchBeforeZoom);

  // 6. A later accepted GPS fix re-centres the followed camera without
  // resetting the selected zoom.
  await context.setGeolocation(MOVED);
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(centreBeforeZoom);
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(zoomAfterZoom);

  // 7. The selected zoom is genuinely committed to IndexedDB.
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({
      kind: "free-roam",
      cameraMode: "following",
      cameraZoom: Number(zoomAfterZoom),
    });

  // 8. Reload; the same established contract as route sessions — GPS/camera
  // do not restart until Resume free roam is explicitly pressed (the zoom
  // controls, gated on genuinely-watching status, are absent until then).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  const resumeButton = page.getByRole("button", { name: "Resume free roam" });
  await expect(resumeButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Start free roam" })).toBeHidden();
  await expect(zoomInButton).toBeHidden();

  // 9. Resuming restores the selected zoom, stable through the first
  // fresh fix and a further one beyond it.
  await resumeButton.click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  const centreAfterResume = await mapContainer.getAttribute("data-camera-center");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .toBe(zoomAfterZoom);

  await context.setGeolocation(START);
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(centreAfterResume);
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(zoomAfterZoom);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the local fallback map style still shows the position marker and camera controls", async ({
  page,
  context,
}) => {
  await forceMapStyleFailure(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(START);

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();

  await expect(page.getByText("Retry map imagery")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="map-container"] canvas')).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow my location" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "North-up, top-down view" }),
  ).toBeVisible();
  await expect(page.getByText(/GPS accuracy:/)).toBeVisible();
});

test.describe("390px phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no horizontal overflow, and End-ride/map controls stay usable", async ({
    page,
    context,
  }) => {
    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
    await startFreeRoam(page, context);
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    const endRideButton = page.getByRole("button", { name: "End ride" });
    await expect(endRideButton).toBeVisible();
    const endRideBox = await endRideButton.boundingBox();
    expect(endRideBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(endRideBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const followButton = page.getByRole("button", { name: "Follow my location" });
    const followBox = await followButton.boundingBox();
    expect(followBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(followBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Backlog item 53: the top-left Zoom in/out cluster and the top-right
    // North-up/Follow cluster, mirroring layout.spec.ts's own equivalent
    // Riding proof for the same two clusters.
    const mapContainer = page.locator('[data-testid="map-container"]');
    const zoomInButton = page.getByRole("button", { name: "Zoom in" });
    const zoomOutButton = page.getByRole("button", { name: "Zoom out" });
    const northUpButton = page.getByRole("button", {
      name: "North-up, top-down view",
    });
    const [mapBox, zoomInBox, zoomOutBox, northUpBox] = await Promise.all([
      mapContainer.boundingBox(),
      zoomInButton.boundingBox(),
      zoomOutButton.boundingBox(),
      northUpButton.boundingBox(),
    ]);
    if (!mapBox || !zoomInBox || !zoomOutBox || !northUpBox || !followBox) {
      throw new Error("expected all located map-chrome elements to have a bounding box");
    }
    expect(isFullyWithin(zoomInBox, mapBox)).toBe(true);
    expect(isFullyWithin(zoomOutBox, mapBox)).toBe(true);
    expect(isFullyWithin(northUpBox, mapBox)).toBe(true);
    expect(isFullyWithin(followBox, mapBox)).toBe(true);
    for (const box of [zoomInBox, zoomOutBox, northUpBox, followBox]) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(intersects(zoomInBox, zoomOutBox)).toBe(false);
    expect(intersects(northUpBox, followBox)).toBe(false);
    expect(intersects(zoomInBox, northUpBox)).toBe(false);
    expect(intersects(zoomInBox, followBox)).toBe(false);
    expect(intersects(zoomOutBox, northUpBox)).toBe(false);
    expect(intersects(zoomOutBox, followBox)).toBe(false);

    await endRideButton.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const scrollWidthWithDialog = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidthWithDialog).toBeLessThanOrEqual(390);

    // Cancel restores the trigger in the same slot, still a real ≥44×44px
    // touch target, focused.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(endRideButton).toBeFocused();
    const restoredBox = await endRideButton.boundingBox();
    expect(restoredBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(restoredBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });
});
