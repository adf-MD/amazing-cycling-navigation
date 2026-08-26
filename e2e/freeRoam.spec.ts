import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { forceMapStyleFailure, installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Proves backlog item 42 (route-less free roam): a live GPS position on the
// ordinary map with camera follow, reachable and recoverable entirely
// through the Ride launcher, with no OpenRouteService dependency at any
// point and no silent conflict with a saved route. Backlog item 58 added
// this screen's own fixed, non-scrolling immersive shell (mirroring
// backlog item 56's identical layout for route Riding).

// A real service worker registering mid-test can render an unrelated
// "Ready to work offline" banner outside .screen, adding height this
// file's own no-scroll/dominant-map assertions (backlog item 58) would
// otherwise (correctly) flag — mirrors ridingMapProfileViews.spec.ts's own
// identical, file-wide precedent and rationale.
test.use({ serviceWorkers: "block" });

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

// Mirrors stickyNavigation.spec.ts's own identical pair — duplicated
// locally per this repo's established no-shared-e2e-helpers convention.
function globalNavHeaderLocator(page: Page) {
  return page.locator("header.app-header--sticky");
}

function immersiveHeaderLocator(page: Page) {
  return page.locator("header.riding-immersive-header");
}

// Mirrors ridingCamera.spec.ts's own identical numbersClose helper and
// its doc comment — duplicated locally per this repo's established
// no-shared-e2e-helpers-across-specs convention. Unlike ridingCamera.spec.ts,
// this file has no remaining use for a centresClose sibling once backlog
// item 65's own rewrite replaced its one call site with the projected
// screen-anchor proof below (data-camera-center is not the rider's
// screen position while following — see that proof's own comment).
const CAMERA_VALUE_TOLERANCE = 1e-6;

function numbersClose(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(Number.parseFloat(a) - Number.parseFloat(b)) < CAMERA_VALUE_TOLERANCE;
}

// Mirrors ridingCamera.spec.ts's own identical CameraAttributeSnapshot/
// readCameraAttributesAtomically/ANCHOR_PIXEL_TOLERANCE/
// anchorWithinTolerance quartet and its doc comments (backlog item 65) —
// duplicated locally per this repo's established no-shared-e2e-helpers-
// across-specs convention.
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

// Mirrors ridingImmersiveShell.spec.ts's own identical helper — duplicated
// locally per this repo's established no-shared-e2e-helpers convention.
async function useSyntheticSafeAreaInsets(
  page: Page,
  insetsPx: { top: number; right: number; bottom: number; left: number },
): Promise<void> {
  await page.addInitScript((insets) => {
    const applyTo = (html: Element) => {
      const style = (html as HTMLElement).style;
      style.setProperty("--safe-area-inset-top", `${String(insets.top)}px`);
      style.setProperty("--safe-area-inset-right", `${String(insets.right)}px`);
      style.setProperty("--safe-area-inset-bottom", `${String(insets.bottom)}px`);
      style.setProperty("--safe-area-inset-left", `${String(insets.left)}px`);
    };
    const existingHtml = document.querySelector("html");
    if (existingHtml) {
      applyTo(existingHtml);
    } else {
      new MutationObserver((_mutations, observer) => {
        const html = document.querySelector("html");
        if (html) {
          applyTo(html);
          observer.disconnect();
        }
      }).observe(document, { childList: true });
    }
  }, insetsPx);
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
  await expect(page.getByText(/GPS ±/)).toBeVisible();

  expect(orsRequested).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// Backlog item 74: free roam's own version of ridingCamera.spec.ts's "a
// fresh Start whose first fix arrives well before the map style becomes
// ready still converges to the followed zoom" — free roam had no such test
// at all before this item, despite being the screen the field symptom was
// actually observed on (a live GPS fix and Follow selected while the map
// sat at an approximately whole-world zoom). Deliberately delays style
// fulfilment well past the point the mocked geolocation fix has almost
// certainly already been delivered, so the map style becomes ready only
// after useFreeRoamCamera's own follow command has already been issued —
// exactly the ordering the fix (MapView's hasAppliedCameraCommand,
// rideCamera.ts's follow-zoom-settled guard) targets. This cannot force
// MapLibre's own internal pre-style-ready settle to land in that exact
// window deterministically in a real browser — its value is proving the
// fix does not regress ordinary convergence for free roam specifically.
test("Start free roam whose first fix arrives well before the map style becomes ready still converges to the followed zoom", async ({
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

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(START);

  // Mirrors ridingCamera.spec.ts's own identical 2s delay and rationale.
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page, {
    styleDelayMs: 2_000,
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();

  // Deliberately does not wait for map-loading to hide first — that wait
  // itself depends on style readiness, which this test is deliberately
  // delaying. "Start free roam" itself has no such gating.
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();

  const followButton = page.getByRole("button", { name: "Follow my location" });
  await expect(followButton).toHaveAttribute("aria-pressed", "true");

  const mapContainer = page.locator('[data-testid="map-container"]');

  // Once the deliberately delayed style eventually loads, the camera must
  // reach the followed zoom (NAVIGATION_ZOOM, rideCamera.ts) — never remain
  // stuck at, or visibly settle at, an approximately whole-world scale.
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"), { timeout: 15_000 })
    .toBe("16");
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  await expect(followButton).toHaveAttribute("aria-pressed", "true");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// Backlog item 58: free roam adopts the same fixed, non-scrolling,
// flex-filling immersive shell RidingScreen's own Map view has (backlog
// item 56) — mirrors ridingMapProfileViews.spec.ts's "defaults to Map,
// with a substantially larger map..." test and
// stickyNavigation.spec.ts's item-56 "no page scroll" rewrite, scoped down
// to what free roam actually has: no Map/Profile switcher (there is no
// Profile view to switch to) and no route-only actions (Finish ride/Route
// complete — free roam has no destination).
test("enters the fixed immersive shell with a dominant, flex-filling map, no Map/Profile switcher and no route-only actions", async ({
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

  // The global nav is genuinely absent — not merely repositioned — and the
  // compact immersive header shows in its place, exactly as it already
  // does for active route Riding (backlog item 55).
  await expect(globalNavHeaderLocator(page)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(immersiveHeaderLocator(page)).toBeVisible();

  // The map is substantially larger than the old fixed pre-item-58 320px
  // preview height, and dominates the viewport — free roam has no
  // pre-transition state of its own to compare against directly (unlike
  // route Riding's idle-then-active pair), so this compares against the
  // old fixed height and the viewport's own size instead.
  const mapContainer = page.locator('[data-testid="map-container"]');
  const mapBox = await mapContainer.boundingBox();
  const viewportHeight = page.viewportSize()?.height;
  if (!mapBox) throw new Error("expected the map to have a bounding box");
  if (viewportHeight === undefined) throw new Error("expected a viewport height");
  expect(mapBox.height).toBeGreaterThan(320);
  expect(mapBox.height).toBeGreaterThan(viewportHeight * 0.5);

  // No Map/Profile switcher — free roam has no route profile to switch to.
  await expect(page.getByRole("group", { name: "Riding view" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Profile", exact: true })).toHaveCount(0);

  // No route-only actions — free roam has no destination.
  await expect(page.getByRole("button", { name: "Finish ride" })).toHaveCount(0);
  await expect(page.getByText("Route complete")).toHaveCount(0);

  // Zoom (top-left) and camera (top-right) clusters both stay fully within
  // the now-dominant map, and don't overlap each other.
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const northUp = page.getByRole("button", { name: "North-up, top-down view" });
  const follow = page.getByRole("button", { name: "Follow my location" });
  const [zoomInBox, zoomOutBox, northUpBox, followBox] = await Promise.all([
    zoomIn.boundingBox(),
    zoomOut.boundingBox(),
    northUp.boundingBox(),
    follow.boundingBox(),
  ]);
  if (!zoomInBox || !zoomOutBox || !northUpBox || !followBox) {
    throw new Error("expected every map control to have a bounding box");
  }
  expect(isFullyWithin(zoomInBox, mapBox)).toBe(true);
  expect(isFullyWithin(zoomOutBox, mapBox)).toBe(true);
  expect(isFullyWithin(northUpBox, mapBox)).toBe(true);
  expect(isFullyWithin(followBox, mapBox)).toBe(true);
  expect(intersects(zoomInBox, northUpBox)).toBe(false);
  expect(intersects(zoomOutBox, followBox)).toBe(false);
  expect(zoomInBox.x).toBeLessThan(northUpBox.x);

  // The whole active free-roam screen fits within one viewport — no
  // page-level scroll is needed to reach the header, status stack or map.
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(scrollHeight).toBeLessThanOrEqual(viewportHeight);

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
  await expect.poll(() => page.getByText(/GPS ±/).isVisible()).toBe(true);
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
  await expect(page.getByText(/GPS ±/)).toBeVisible();

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

  // The immersive header's own End slot (backlog item 55, superseding
  // item 50's original .ride-end-ride-row single-container structure)
  // goes empty once the confirmation opens, and the confirmation renders
  // as its own full-width row immediately after the header. The
  // heading/status/map stay visible around it throughout.
  const dialogFollowsHeaderDirectly = await page.evaluate(() => {
    const header = document.querySelector(".riding-immersive-header");
    const endSlot = document.querySelector(".riding-immersive-header-end");
    const confirmRow = document.querySelector(".ride-end-ride-confirm-row");
    const alertDialog = document.querySelector('[role="alertdialog"]');
    if (!header || !endSlot || !confirmRow || !alertDialog) return false;
    return (
      !endSlot.contains(alertDialog) &&
      header.nextElementSibling === confirmRow &&
      confirmRow.contains(alertDialog)
    );
  });
  expect(dialogFollowsHeaderDirectly).toBe(true);
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

test("a saved route cannot silently replace an unfinished free-roam session — Routes shows a confirmation in place, and confirming clears it before the route opens (backlog item 73)", async ({
  page,
  context,
}) => {
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  await startFreeRoam(page, context);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam" });

  // The global nav is genuinely absent while free roam is actively
  // tracking (backlog item 55) — Pause first to reach Routes, exactly as
  // a rider genuinely would, rather than the pre-item-55 direct nav click.
  // The row stays present/resumable across Pause, so the conflict guard
  // below is exercised identically either way.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume free roam" })).toBeVisible();

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

  // Backlog item 73: stays on Routes with an inline confirmation, rather
  // than redirecting to Ride to show a blocked-open explanation. The
  // original free-roam row stays exactly intact until confirmed.
  const freeRoamRowBefore = await readActiveRideStateRow(page);
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/unfinished free roam session/i)).toBeVisible();
  expect(await readActiveRideStateRow(page)).toEqual(freeRoamRowBefore);
  // exact:true — the dialog's own title ("Switch to
  // "free-roam-conflict-route"?") would otherwise substring-match this
  // same query while it's open.
  await expect(
    page.getByRole("heading", { name: "free-roam-conflict-route", exact: true }),
  ).toBeHidden();

  await dialog.getByRole("button", { name: "End and switch" }).click();
  await waitForClearedRideState(page);
  await expect(
    page.getByRole("heading", { name: "free-roam-conflict-route", exact: true }),
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
  const zoomOutButton = page.getByRole("button", { name: "Zoom out" });

  // 1. Wait for the real followed camera to genuinely settle.
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");

  // 2. Capture the settled camera before zooming, including the rider's
  // own projected screen anchor (backlog item 65) — the actual invariant
  // under test, captured atomically so it can never be torn across two
  // different settle events.
  const baseline = await readCameraAttributesAtomically(mapContainer);
  expect(baseline.anchorX).not.toBeNull();
  expect(baseline.anchorY).not.toBeNull();

  // 3. Press Zoom in; wait for a genuine, numerically greater zoom, then
  // read the post-settle snapshot atomically.
  await zoomInButton.click();
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(baseline.zoom);
  const afterZoomIn = await readCameraAttributesAtomically(mapContainer);
  expect(Number(afterZoomIn.zoom)).toBeGreaterThan(Number(baseline.zoom));

  // 4. Follow stays engaged; no paused toast.
  await expect(followButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Map follow paused.")).toHaveCount(0);

  // 5. Bearing/pitch compared via numbersClose's own tolerance, not
  // strict equality (see ridingCamera.spec.ts's own identical comment
  // for the full rationale). The map's own reported geographic centre
  // (data-camera-center) is deliberately NOT compared: while genuinely
  // following, it is a different, nearby geographic point from the
  // rider's real position, which legitimately shifts geographically on
  // zoom even though the rider's own on-screen position does not
  // (backlog item 65). The invariant under test is the rider's own
  // projected screen anchor, asserted next.
  expect(numbersClose(afterZoomIn.bearing, baseline.bearing)).toBe(true);
  expect(numbersClose(afterZoomIn.pitch, baseline.pitch)).toBe(true);
  expect(anchorWithinTolerance(afterZoomIn, baseline)).toBe(true);

  // 5b. Sequential zoom-out then zoom-in again, proving the anchor holds
  // across repeated presses in both directions, not just a single
  // zoom-in press.
  await zoomOutButton.click();
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(afterZoomIn.zoom);
  const afterZoomOut = await readCameraAttributesAtomically(mapContainer);
  expect(Number(afterZoomOut.zoom)).toBeLessThan(Number(afterZoomIn.zoom));
  await expect(followButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Map follow paused.")).toHaveCount(0);
  expect(numbersClose(afterZoomOut.bearing, baseline.bearing)).toBe(true);
  expect(numbersClose(afterZoomOut.pitch, baseline.pitch)).toBe(true);
  expect(anchorWithinTolerance(afterZoomOut, baseline)).toBe(true);

  await zoomInButton.click();
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(afterZoomOut.zoom);
  const finalSnapshot = await readCameraAttributesAtomically(mapContainer);
  const zoomAfterZoom = finalSnapshot.zoom;
  expect(Number(finalSnapshot.zoom)).toBeGreaterThan(Number(afterZoomOut.zoom));
  await expect(followButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Map follow paused.")).toHaveCount(0);
  expect(numbersClose(finalSnapshot.bearing, baseline.bearing)).toBe(true);
  expect(numbersClose(finalSnapshot.pitch, baseline.pitch)).toBe(true);
  expect(anchorWithinTolerance(finalSnapshot, baseline)).toBe(true);

  // 6. A later accepted GPS fix re-centres the followed camera without
  // resetting the selected zoom.
  await context.setGeolocation(MOVED);
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(finalSnapshot.centre);
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
  await expect(page.getByText(/GPS ±/)).toBeVisible();
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

  // Backlog item 58's own genuinely new CSS mechanism: unlike route
  // Riding's active branch, free roam's fixed shell has no Map/Profile
  // switcher below .ride-content-area--immersive to fold the bottom
  // safe-area inset into (see .ride-immersive-switcher), so a dedicated
  // :last-child rule folds it into the content area itself instead —
  // mirrors ridingImmersiveShell.spec.ts's own synthetic-safe-area-inset
  // technique, scoped to prove specifically that new rule.
  test("respects a synthetic four-sided safe-area inset — the header sits at the true top, and the map leaves clearance above the bottom inset with no switcher to fold it into", async ({
    page,
    context,
  }) => {
    await useSyntheticSafeAreaInsets(page, { top: 59, right: 20, bottom: 34, left: 20 });
    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
    await startFreeRoam(page, context);
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    // FreeRoamScreen's own header renders unconditionally as the fixed
    // shell's own first child (item 55), so it already sits at the true
    // viewport top at rest — no scroll needed, unlike route Riding's own
    // equivalent phone-viewport safe-area test. The wake-lock control now
    // lives further down, in the shared compact active-status area
    // (backlog item 68), not directly after the header as item 56 first
    // placed it.
    const header = immersiveHeaderLocator(page);
    const headerBox = await header.boundingBox();
    if (!headerBox)
      throw new Error("expected the immersive header to have a bounding box");
    expect(headerBox.y).toBeGreaterThanOrEqual(0);
    expect(headerBox.y).toBeLessThan(2);

    const pauseButton = page.getByRole("button", { name: "Pause" });
    const endButton = page.getByRole("button", { name: "End ride" });
    for (const control of [pauseButton, endButton]) {
      const box = await control.boundingBox();
      if (!box) throw new Error("expected a header control to have a bounding box");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(headerBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
    }

    const mapContainer = page.locator('[data-testid="map-container"]');
    const mapBox = await mapContainer.boundingBox();
    const viewportHeight = page.viewportSize()?.height;
    if (!mapBox) throw new Error("expected the map to have a bounding box");
    if (viewportHeight === undefined) throw new Error("expected a viewport height");
    // The gap between the map's own bottom edge and the true viewport
    // bottom should genuinely match the synthetic bottom inset (within a
    // couple of pixels of rounding tolerance) — proving
    // .ride-content-area--immersive:last-child's own padding-bottom is
    // what's creating this clearance, not left to a coincidence of the
    // fixed shell's own height.
    const gapBelowMap = viewportHeight - (mapBox.y + mapBox.height);
    expect(gapBelowMap).toBeGreaterThanOrEqual(34 - 2);
    expect(gapBelowMap).toBeLessThanOrEqual(34 + 2);

    const widths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(widths.documentWidth).toBeLessThanOrEqual(390);
    expect(widths.bodyWidth).toBeLessThanOrEqual(390);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });

  test("Pause protects the wider pending 'Pausing…' label exactly as it protects the ordinary label", async ({
    page,
    context,
  }) => {
    // Deterministic seam (backlog item 68, src/storage/rideStateRepository.ts):
    // holds Pause's own persistence write open so the wider "Pausing…"
    // label can be asserted against reliably, instead of racing a
    // naturally fast transient state or adding a fixed sleep. Starts
    // disarmed so it never delays free roam's own initial persistence
    // write on start — only the test's explicit Pause write, once armed.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __acnE2eArmRideStateWriteDelay?: () => void;
        __acnE2eRideStateWriteDelay?: () => Promise<void>;
        __resolveRideStateWriteDelay?: () => void;
      };
      let armed = false;
      w.__acnE2eArmRideStateWriteDelay = () => {
        armed = true;
      };
      w.__acnE2eRideStateWriteDelay = () => {
        if (!armed) return Promise.resolve();
        return new Promise((resolve) => {
          w.__resolveRideStateWriteDelay = resolve;
        });
      };
    });
    await installLocalMapStyle(page);
    await startFreeRoam(page, context);
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    await page.evaluate(() => {
      (
        window as unknown as { __acnE2eArmRideStateWriteDelay?: () => void }
      ).__acnE2eArmRideStateWriteDelay?.();
    });
    await page.getByRole("button", { name: "Pause" }).click();
    const pausingButton = page.getByRole("button", { name: "Pausing…" });
    await expect(pausingButton).toBeVisible();
    await expect(pausingButton).toBeDisabled();

    const pausingBox = await pausingButton.boundingBox();
    if (!pausingBox) {
      throw new Error("expected the pending Pause button to have a bounding box");
    }
    expect(pausingBox.width).toBeGreaterThanOrEqual(44);
    expect(pausingBox.height).toBeGreaterThanOrEqual(44);

    const heading = page.getByRole("heading", { level: 1, name: "Free roam" });
    const headingBox = await heading.boundingBox();
    if (!headingBox) throw new Error("expected the title to have a bounding box");
    expect(intersects(pausingBox, headingBox)).toBe(false);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    // Release the held-open write so the test can clean up normally.
    await page.evaluate(() => {
      (
        window as unknown as { __resolveRideStateWriteDelay?: () => void }
      ).__resolveRideStateWriteDelay?.();
    });
    await expect(page.getByRole("button", { name: "Resume free roam" })).toBeVisible();
  });
});
