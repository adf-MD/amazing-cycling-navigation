import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround.
test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
const ROUTE_START = { latitude: 51.5, longitude: -0.1 };

async function startRiding(page: Page) {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

// Two independent `easeTo` calls to the exact same nominal target don't
// read back bit-identical from MapLibre's own live transform afterwards —
// its internal Mercator projection/unprojection round-trip introduces
// noise on the order of 1e-13 degrees (confirmed by direct observation
// while writing this test), many orders of magnitude below any real GPS
// or rendering precision. A tolerance this loose still fails on any
// genuine functional discrepancy (e.g. a materially different bearing,
// pitch or zoom, or a centre off by metres) while absorbing that noise.
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

// A few pixels of tolerance absorbs MapLibre's own floating-point/
// Mercator-projection rounding at typical map zoom levels — genuinely
// loose enough to never mask a real drift (which, per the pre-fix
// backlog item 65 defect, was on the order of tens to hundreds of
// pixels), while still catching any material regression.
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

interface CameraAttributeSnapshot {
  centre: string | null;
  bearing: string | null;
  pitch: string | null;
  zoom: string | null;
  // Backlog item 65: the rider's own projected screen pixel position
  // (data-camera-follow-anchor-x/-y, MapView.tsx) — the actual invariant
  // a followed zoom press must preserve, distinct from `centre` above:
  // while following, `centre` (MapLibre's own reported true-centre
  // point) is a different, nearby geographic point from the rider's real
  // position, and genuinely shifts geographically on zoom even when the
  // rider's own screen pixel does not (a fixed pixel offset corresponds
  // to a different geographic distance at each zoom level).
  anchorX: string | null;
  anchorY: string | null;
}

/**
 * Reads all six data-camera-* attributes in a single Playwright
 * page.evaluate() round-trip rather than six separate sequential
 * getAttribute() calls, so a moveend that lands between what would
 * otherwise be six independent awaits (each its own async round-trip to
 * the browser) can never tear the snapshot across two different settle
 * events — the six values are always read from the exact same instant.
 */
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

/**
 * Deterministically establishes a genuine manual rotation and tilt via
 * MapLibre's own built-in KeyboardHandler rather than a synthetic
 * right-button pointer drag through DragRotateHandler — mirrors
 * planning.spec.ts's own establishManualRotationAndPitch helper
 * (duplicated here rather than imported, matching this project's
 * established no-shared-e2e-helpers-across-specs convention). See that
 * helper's own doc comment for the full KeyboardHandler mechanism and why
 * it cannot reproduce DragRotateHandler's CI-only stuck-gesture failure
 * mode (CLAUDE.md future-backlog item 21) — the exact failure that broke
 * this file's own former right-button-drag precondition in GitHub Actions
 * run 31691965402.
 *
 * Reads its own bearing/pitch baseline from the map's currently settled
 * state rather than assuming "0": the "pressing Northwards twice" test
 * below begins at bearing/pitch 0 (having just pressed North-up), but the
 * "re-pressing Follow location" test deliberately begins from its
 * travel-up followed camera, which is never at bearing 0 and always has a
 * non-zero pitch (35°, FOLLOW_PITCH_DEGREES).
 */
async function establishManualRotationAndPitch(
  page: Page,
  mapContainer: Locator,
): Promise<void> {
  const canvas = mapContainer.locator("canvas");
  await canvas.focus();
  const bearingBefore = await mapContainer.getAttribute("data-camera-bearing");
  const pitchBefore = await mapContainer.getAttribute("data-camera-pitch");
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-bearing"))
    .not.toBe(bearingBefore);
  await page.keyboard.press("Shift+ArrowUp");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-pitch"))
    .not.toBe(pitchBefore);
}

test("Riding: pressing Northwards twice, with a manual rotation in between, rotates back to north both times", async ({
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
  await context.setGeolocation(ROUTE_START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await startRiding(page);

  const mapContainer = page.locator('[data-testid="map-container"]');
  const northButton = page.getByRole("button", { name: "North-up, top-down view" });
  await expect(northButton).toBeVisible();

  await northButton.click();
  await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");
  await expect(mapContainer).toHaveAttribute("data-camera-pitch", "0");

  // Deterministically establishes a genuine intervening manual rotation
  // and tilt via MapLibre's own built-in KeyboardHandler — see
  // establishManualRotationAndPitch's own doc comment for the full
  // mechanism and why it cannot reproduce DragRotateHandler's CI-only
  // stuck-gesture failure mode (CLAUDE.md future-backlog item 21).
  await establishManualRotationAndPitch(page, mapContainer);

  // Real end-to-end proof of the same contract PlanningScreen.test.tsx
  // already covers at the mock level ("a manual rotation unpresses the
  // control") — through the real onCameraSettled production path, not a
  // mocked map.
  await expect(northButton).toHaveAttribute("aria-pressed", "false");

  await northButton.click();
  await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");
  await expect(mapContainer).toHaveAttribute("data-camera-pitch", "0");
  await expect(northButton).toHaveAttribute("aria-pressed", "true");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Riding: re-pressing Follow location with an unchanged GPS fix, after a manual gesture, resumes following", async ({
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
  await context.setGeolocation(ROUTE_START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await startRiding(page);

  const mapContainer = page.locator('[data-testid="map-container"]');
  const followButton = page.getByRole("button", { name: "Follow my location" });
  await expect(followButton).toHaveAttribute("aria-pressed", "true");

  // Wait for the follow camera itself to genuinely settle, then capture
  // it atomically (see readCameraAttributesAtomically) — this test never
  // emits a second, different GPS fix, so a correct re-press must
  // reproduce these exact values. Polling on pitch "35"
  // (FOLLOW_PITCH_DEGREES, distinct from the route's own initial overview
  // fit, which never tilts) is the reliable "follow has landed" signal —
  // polling on centre alone would be satisfied early by that unrelated
  // overview-fit transition, which also has a non-"0,0" centre.
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  const followed = await readCameraAttributesAtomically(mapContainer);

  // Deterministically establishes a genuine manual rotation and tilt via
  // MapLibre's own built-in KeyboardHandler, replacing a synthetic
  // right-button drag — see establishManualRotationAndPitch's own doc
  // comment. The helper reads its own bearing/pitch baseline from the
  // map's current state rather than assuming 0: this camera begins at the
  // followed bearing/pitch (35° pitch), never at north-up/level. A
  // genuine MapLibre user gesture (real drag or, as here, a real
  // keyboard-driven ease — both carry a DOM originalEvent, see
  // mapAdapter.ts's onUserCameraInteraction) also pauses follow mode.
  await establishManualRotationAndPitch(page, mapContainer);

  await expect(followButton).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-bearing"))
    .not.toBe(followed.bearing);

  // No new/different geolocation is set here — deliberately the same
  // stationary fix as before. This is the scenario this task's fix
  // targets: a rider re-pressing Follow without having moved.
  await followButton.click();

  await expect(followButton).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => {
      const current = await readCameraAttributesAtomically(mapContainer);
      return (
        centresClose(current.centre, followed.centre) &&
        numbersClose(current.bearing, followed.bearing) &&
        numbersClose(current.pitch, followed.pitch) &&
        numbersClose(current.zoom, followed.zoom)
      );
    })
    .toBe(true);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// ~67m north of ROUTE_START — a genuine movement well past
// FOLLOW_MIN_MOVEMENT_METRES (3m), matching freeRoam.spec.ts's own
// identically-purposed MOVED fixture.
const MOVED_ROUTE_START = { latitude: 51.5006, longitude: -0.1 };

test("Riding: zoom while followed persists across a later GPS fix, storage, reload and Resume riding", async ({
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
  await context.setGeolocation(ROUTE_START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await startRiding(page);

  const mapContainer = page.locator('[data-testid="map-container"]');
  const followButton = page.getByRole("button", { name: "Follow my location" });
  const zoomInButton = page.getByRole("button", { name: "Zoom in" });
  const zoomOutButton = page.getByRole("button", { name: "Zoom out" });

  // 1. Wait for the real followed camera to genuinely settle — the same
  // pitch "35" (FOLLOW_PITCH_DEGREES) signal the other test in this file
  // already establishes as reliable.
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");

  // 2. Capture the settled camera before zooming, including the rider's
  // own projected screen anchor (data-camera-follow-anchor-x/-y,
  // backlog item 65) — the actual invariant under test, captured
  // atomically so it can never be torn across two different settle
  // events (see readCameraAttributesAtomically's own doc comment).
  const baseline = await readCameraAttributesAtomically(mapContainer);
  expect(baseline.anchorX).not.toBeNull();
  expect(baseline.anchorY).not.toBeNull();

  // 3. Press Zoom in; wait for a genuine, numerically greater zoom, then
  // read the post-settle snapshot atomically — the anchor attributes
  // update on the same settle as data-camera-zoom, so waiting on zoom
  // already guarantees this atomic read reflects the post-zoom settle.
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
  // strict equality: a fresh easeTo re-specifying the same nominal
  // bearing/pitch can read back with the same sub-1e-6-degree
  // floating-point noise this file's own CAMERA_VALUE_TOLERANCE already
  // documents for repeated easeTo calls to the same nominal target. The
  // map's own reported geographic centre (data-camera-center) is
  // deliberately NOT compared here: while genuinely following,
  // MapLibre's offset keeps the RIDER's coordinate fixed at a
  // below-centre screen pixel, not the map's own true-centre point — a
  // fixed pixel offset corresponds to a different geographic distance
  // at each zoom level, so the true-centre point legitimately shifts
  // geographically even though the rider's own on-screen position does
  // not (backlog item 65). The invariant under test is the rider's own
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

  // 6. A later accepted GPS fix re-centres the followed camera to the new
  // position without resetting the selected zoom.
  await context.setGeolocation(MOVED_ROUTE_START);
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(finalSnapshot.centre);
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(zoomAfterZoom);

  // 7. The selected zoom is genuinely committed to IndexedDB — poll the
  // real row rather than assume any fixed delay is long enough for the
  // async, un-throttled Dexie write to land (this repo's established
  // accepted-fix-versus-Dexie-write race discipline).
  const savedRouteId = await readSavedRouteId(page, "smoke-route");
  expect(savedRouteId).not.toBeNull();
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({
      routeId: savedRouteId,
      cameraMode: "following",
      cameraZoom: Number(zoomAfterZoom),
    });

  // 8. Reload; the real, previously-undocumented contract: a reload does
  // NOT return to Riding by itself — the pre-ride panel offers Resume
  // riding, and GPS/camera do not restart until it's explicitly pressed
  // (the zoom controls, gated on genuinely-watching status, are absent
  // until then).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume riding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeHidden();
  await expect(zoomInButton).toBeHidden();

  // 9. Resuming restores the selected zoom, stable through the first
  // fresh fix — the context's geolocation is still set to
  // MOVED_ROUTE_START from step 6, so watchPosition's own immediate first
  // callback already delivers that as the resumed session's first fix.
  await page.getByRole("button", { name: "Resume riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const centreAfterResume = await mapContainer.getAttribute("data-camera-center");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .toBe(zoomAfterZoom);

  // A further, genuinely new fix confirms the restored zoom keeps holding
  // beyond just the first one.
  await context.setGeolocation(ROUTE_START);
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-center"))
    .not.toBe(centreAfterResume);
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(zoomAfterZoom);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
