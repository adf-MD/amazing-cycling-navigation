import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyleWithFailureControl } from "./support/localMapStyle.ts";
import type { StyleFailureController } from "./support/localMapStyle.ts";

// Diagnostic fail-first reproduction for a post-item-94 physical-iPhone
// field report: while offline (fallback map style active), a SMALL
// two-finger pinch makes the camera appear to collapse to MapLibre's raw
// world-view default, and this persists after connectivity returns. This
// file exists to gather real A/B/C camera evidence under a GENUINE
// two-finger touch gesture (CDP Input.dispatchTouchEvent — Playwright's
// own page.touchscreen only supports single-point tap()), not to assert a
// predetermined mechanism. It deliberately runs under the "android-chrome"
// project (the only touch-enabled Playwright project in this repo) rather
// than "chromium".
//
// The field report says "waypoints/route" and does not identify one
// screen — both Planning and pre-ride are covered as candidate contexts.
// Every snapshot below captures camera attributes, the map container's
// real bounding box, AND visualViewport.scale together, and "usefully
// framed" is judged by a meaningful zoom/geometry condition, never by a
// marker merely sitting inside the container (which is trivially true
// even at raw zoom 0). Recovery is only evaluated once a fresh original-
// style request has been proven to occur.
//
// Independent helpers per this repo's own no-shared-e2e-helpers-across-
// specs convention (see mapImageryCameraFraming.spec.ts/
// mapImageryRecovery.spec.ts, whose own duplicated helpers this mirrors).

test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

const CACHED_LOCATION = { latitude: 51.5, longitude: -0.1 };

// Mirrors mapImageryCameraFraming.spec.ts's own identical tolerance —
// duplicated locally per this repo's no-shared-e2e-helpers-across-specs
// convention. Exact-value tolerance is correct for a restored setCamera
// snapshot (not a padded fitBounds result).
const CAMERA_VALUE_TOLERANCE = 1e-6;

function numbersClose(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(Number.parseFloat(a) - Number.parseFloat(b)) < CAMERA_VALUE_TOLERANCE;
}

/** Asserts the two camera snapshots are the SAME camera (centre/zoom/
 * bearing/pitch), not merely both "meaningfully framed" — required to
 * prove a corrupted intermediate camera doesn't get silently replaced by
 * a DIFFERENT, coincidentally-also-meaningful one rather than the actual
 * pre-pinch camera being preserved. */
function assertCameraMatches(
  actual: CameraAttributeSnapshot,
  expected: CameraAttributeSnapshot,
  label: string,
): void {
  expect(
    numbersClose(
      actual.centre?.split(",")[0] ?? null,
      expected.centre?.split(",")[0] ?? null,
    ),
    `${label}: centre longitude`,
  ).toBe(true);
  expect(
    numbersClose(
      actual.centre?.split(",")[1] ?? null,
      expected.centre?.split(",")[1] ?? null,
    ),
    `${label}: centre latitude`,
  ).toBe(true);
  expect(numbersClose(actual.zoom, expected.zoom), `${label}: zoom`).toBe(true);
  expect(numbersClose(actual.bearing, expected.bearing), `${label}: bearing`).toBe(true);
  expect(numbersClose(actual.pitch, expected.pitch), `${label}: pitch`).toBe(true);
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FullCameraSnapshot {
  label: string;
  camera: CameraAttributeSnapshot;
  containerBox: Box | null;
  visualViewportScale: number | null;
}

/** Captures camera attributes, the map container's own real on-screen
 * bounding box, and visualViewport.scale together — a marker's bounding
 * box sitting inside the container is NOT sufficient evidence of useful
 * framing on its own (a crosshair-placed marker is trivially "inside" the
 * container even at raw zoom 0), and page-level pinch scaling versus a
 * genuine MapLibre camera-zoom change cannot be told apart from camera
 * attributes alone. */
async function readFullSnapshot(
  page: Page,
  mapContainer: Locator,
  label: string,
): Promise<FullCameraSnapshot> {
  const camera = await readCameraAttributesAtomically(mapContainer);
  const containerBox = await mapContainer.boundingBox();
  const visualViewportScale = await page.evaluate(
    () => window.visualViewport?.scale ?? null,
  );
  const snapshot = { label, camera, containerBox, visualViewportScale };
  console.log(`[camera-snapshot] ${JSON.stringify(snapshot)}`);
  return snapshot;
}

/** Comfortably above MapLibre's own raw default zoom (0), comfortably
 * below what a real regional/waypoint/route fitBounds produces in this
 * suite's viewport. Mirrors mapImageryCameraFraming.spec.ts's own
 * identical constant/rationale. */
const RAW_WORLD_ZOOM_CEILING = 2;

function zoomOf(snapshot: FullCameraSnapshot): number {
  return snapshot.camera.zoom ? Number.parseFloat(snapshot.camera.zoom) : 0;
}

/** True only under a meaningful zoom/geometry condition — never merely
 * "a marker is somewhere inside the container." */
function isMeaningfullyFramed(snapshot: FullCameraSnapshot): boolean {
  return zoomOf(snapshot) > RAW_WORLD_ZOOM_CEILING && snapshot.containerBox !== null;
}

interface PinchOptions {
  startSpacingPx: number;
  endSpacingPx: number;
  steps?: number;
}

/** Dispatches a genuine two-finger touch gesture via CDP
 * Input.dispatchTouchEvent — two stable touch ids, several bounded
 * touchMove steps, an explicit touchEnd. Playwright 1.61.1's
 * page.touchscreen only exposes tap() (single point), so this is the
 * lowest-level primitive capable of a real pinch. A "small" pinch (the
 * field report's own wording) uses a modest spacing delta. */
async function dispatchTwoFingerPinch(
  page: Page,
  center: { x: number; y: number },
  { startSpacingPx, endSpacingPx, steps = 6 }: PinchOptions,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const touchPoints = (spacing: number) => [
    { x: center.x - spacing / 2, y: center.y, id: 1 },
    { x: center.x + spacing / 2, y: center.y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touchPoints(startSpacingPx),
  });
  // A real frame-spaced delay between steps — dispatching all touchMove
  // events back-to-back with no gap let MapLibre's TwoFingersTouchZoomHandler
  // process them out of step with the browser's own render loop, observed
  // directly to sometimes produce a net zoom-OUT from a spacing sequence
  // that only ever increases (zoom-in). 40ms approximates one frame at a
  // conservative ~24fps, comfortably above typical single-frame budgets.
  await new Promise((resolve) => setTimeout(resolve, 40));
  for (let i = 1; i <= steps; i++) {
    const spacing = startSpacingPx + ((endSpacingPx - startSpacingPx) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touchPoints(spacing),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Polls data-camera-zoom until two consecutive reads, spaced apart, agree
 * — a genuine settle rather than a single lucky sample (a poll can pass
 * before an in-flight ease finishes; see this repo's own established
 * "sample repeatedly, don't stop at first success" lesson). */
async function waitForCameraToSettle(mapContainer: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const first = await mapContainer.getAttribute("data-camera-zoom");
        await new Promise((resolve) => setTimeout(resolve, 120));
        const second = await mapContainer.getAttribute("data-camera-zoom");
        return first === second ? first : undefined;
      },
      { timeout: 10_000 },
    )
    .not.toBeUndefined();
}

async function pinchAndSettle(
  page: Page,
  mapContainer: Locator,
  options: PinchOptions,
): Promise<void> {
  const box = await mapContainer.boundingBox();
  if (!box) throw new Error("expected the map container to lay out before pinching");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dispatchTwoFingerPinch(page, center, options);
  await waitForCameraToSettle(mapContainer);
}

/** The field report's own "small" pinch — a modest spacing delta,
 * deliberately not a dramatic zoom gesture. */
const SMALL_PINCH: PinchOptions = { startSpacingPx: 60, endSpacingPx: 74 };
/** A larger, deliberate zoom-in gesture, used only to construct a
 * genuinely non-default manually-established camera in the reverse-
 * direction control below. */
const DELIBERATE_ZOOM_IN_PINCH: PinchOptions = { startSpacingPx: 40, endSpacingPx: 220 };

async function pressZoomIn(page: Page, mapContainer: Locator): Promise<void> {
  const zoomBefore = await mapContainer.getAttribute("data-camera-zoom");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(zoomBefore);
  await waitForCameraToSettle(mapContainer);
}

async function openPlanningOffline(
  page: Page,
  styleController: StyleFailureController,
): Promise<Locator> {
  styleController.failStyle();
  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-fallback-banner")).toBeVisible({ timeout: 15_000 });
  return page.locator('[data-testid="map-container"]');
}

// Locator.click's `position` is relative to the ELEMENT's own top-left
// corner, not the page/viewport — the map container itself is only
// ~318-360px tall on this project's narrower 412px-wide, ~840px-tall
// Pixel-7-emulated viewport (confirmed via this file's own logged
// containerBox snapshots), so a page-scale y offset (e.g. 500) lands well
// past the container's own bottom edge, on the "planning-section" panel
// below the map instead. x/y here are chosen to sit below every
// top-anchored control cluster (.planning-map-zoom-controls top:8px/
// left:8px, .planning-map-controls top:8px/right:8px, .map-status-overlay
// top:72px whose retry button can wrap down further on this narrower
// viewport than mapImageryCameraFraming.spec.ts's own {150,150} — written
// for the wide desktop chromium project — ever collides with there) while
// staying safely inside the container's own shortest observed height.
const SAFE_MAP_TAP_POSITION = { x: 190, y: 250 };

async function placeWaypoint(mapContainer: Locator, page: Page): Promise<void> {
  await mapContainer.click({ position: SAFE_MAP_TAP_POSITION });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
}

// Mirrors planning.spec.ts's own identical helper — duplicated locally
// per this repo's established e2e-spec precedent.
function isFullyWithin(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// A second tap position, genuinely separated from SAFE_MAP_TAP_POSITION,
// still within the same safe band (clear of every top-anchored control
// cluster, within the container's own shortest observed height).
const SECOND_SAFE_MAP_TAP_POSITION = { x: 320, y: 290 };

/** Places two genuinely separated waypoints on an already cached-location-
 * framed camera (geolocation resolved before the map ever attached, so
 * Planning's own initial regional box-fit genuinely applies while still
 * offline) and proves the resulting view is meaningfully framed by BOTH a
 * real zoom condition AND real waypoint-geometry containment — two
 * distinct markers, each fully inside the map container — not merely a
 * single, trivially-contained point. */
// Callers must grant geolocation permission and set the coordinate BEFORE
// opening Planning (before openPlanningOffline/page.goto) — Planning's own
// mount effect calls requestApproximateLocation() exactly once and never
// retries later just because permission was subsequently granted, matching
// this file's own pre-existing "case 2" pattern.
async function establishPlanningViewWithTwoWaypoints(
  page: Page,
  mapContainer: Locator,
): Promise<void> {
  await expect
    .poll(async () => zoomOf(await readFullSnapshot(page, mapContainer, "A (poll)")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(RAW_WORLD_ZOOM_CEILING);

  await mapContainer.click({ position: SAFE_MAP_TAP_POSITION });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await mapContainer.click({ position: SECOND_SAFE_MAP_TAP_POSITION });

  const markers = page.locator(".planning-waypoint-marker");
  await expect(markers).toHaveCount(2);
  const mapBox = await mapContainer.boundingBox();
  if (!mapBox) throw new Error("expected the map container to lay out");
  for (const marker of await markers.all()) {
    const markerBox = await marker.boundingBox();
    if (!markerBox) throw new Error("expected each waypoint marker to lay out");
    expect(isFullyWithin(markerBox, mapBox)).toBe(true);
  }
}

async function importGpxAndOpenPreRideOffline(
  page: Page,
  styleController: StyleFailureController,
): Promise<Locator> {
  styleController.failStyle();
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByTestId("map-fallback-banner")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  return page.locator('[data-testid="map-container"]');
}

async function recoverViaRetryButton(
  page: Page,
  mapContainer: Locator,
  styleController: StyleFailureController,
): Promise<void> {
  const succeededBefore = styleController.succeededStyleRequestCount();
  styleController.succeedStyle();
  await page.getByTestId("retry-map-imagery-button").click();
  await expect
    .poll(() => styleController.succeededStyleRequestCount())
    .toBeGreaterThan(succeededBefore);
  await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached({
    timeout: 15_000,
  });
  // Proves the fresh original-style success actually produced a new
  // generation's settled camera before C is read, rather than a transient
  // reading mid-recreation (e.g. a new instance's own pre-style-ready
  // default-transform settle).
  await waitForCameraToSettle(mapContainer);
}

async function recoverViaOnlineEvent(
  page: Page,
  mapContainer: Locator,
  styleController: StyleFailureController,
): Promise<void> {
  const succeededBefore = styleController.succeededStyleRequestCount();
  styleController.succeedStyle();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() => styleController.succeededStyleRequestCount())
    .toBeGreaterThan(succeededBefore);
  await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached({
    timeout: 15_000,
  });
  await waitForCameraToSettle(mapContainer);
}

/** Item 94 follow-up v2: attempts recovery via `trigger` WITHOUT ever
 * calling styleController.succeedStyle() first, so the retry's own
 * attempt to reach the real remote style genuinely fails again — the
 * "sustained offline" reproduction. Proves, in order: (1) the fallback
 * genuinely unmounts, synchronously with the triggering action, well
 * before its own remote-style request could possibly resolve — a stale
 * leftover banner could never satisfy this; (2) a genuinely NEW
 * remote-style request was attempted and failed (styleController's own
 * failedStyleRequestCount, a real network-level proof, not DOM state);
 * (3) a fresh fallback generation subsequently completed and its camera
 * genuinely settled. Does NOT call succeedStyle() — the style endpoint
 * stays unavailable throughout, matching the field report's "press Retry
 * map imagery" (or, for the online-triggered variant, "connectivity
 * returns") while imagery specifically remains unreachable. */
async function attemptFailingRecoveryToFallback(
  page: Page,
  mapContainer: Locator,
  styleController: StyleFailureController,
  trigger: () => Promise<void>,
): Promise<void> {
  const failedBefore = styleController.failedStyleRequestCount();
  const banner = page.getByTestId("map-fallback-banner");
  await trigger();
  await expect(banner).not.toBeAttached({ timeout: 15_000 });
  await expect
    .poll(() => styleController.failedStyleRequestCount())
    .toBeGreaterThan(failedBefore);
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await waitForCameraToSettle(mapContainer);
}

// --- Planning: case 1 — newly placed waypoint, offline from the start ---
// Cannot by itself distinguish "pinch corrupts an established camera" from
// "nothing was ever established" — record which it turns out to be.

for (const recoverVia of ["retry", "online"] as const) {
  test(`Planning case 1 (newly placed waypoint, offline): small pinch then ${recoverVia} recovery`, async ({
    page,
  }) => {
    const styleController = await installLocalMapStyleWithFailureControl(page);
    const mapContainer = await openPlanningOffline(page, styleController);
    await placeWaypoint(mapContainer, page);

    const a = await readFullSnapshot(
      page,
      mapContainer,
      "A (waypoint placed, pre-pinch)",
    );
    await pinchAndSettle(page, mapContainer, SMALL_PINCH);
    const b = await readFullSnapshot(page, mapContainer, "B (post-pinch, still offline)");

    if (recoverVia === "retry")
      await recoverViaRetryButton(page, mapContainer, styleController);
    else await recoverViaOnlineEvent(page, mapContainer, styleController);
    const c = await readFullSnapshot(
      page,
      mapContainer,
      `C (post-${recoverVia}-recovery)`,
    );

    test.info().annotations.push({
      type: "camera-race-case-1",
      description: JSON.stringify({ recoverVia, a, b, c }),
    });
    expect(isMeaningfullyFramed(c)).toBe(true);
  });
}

// --- Planning: case 2 — unquestionably-useful pre-existing camera ---
// Cached-location framing: geolocation resolves BEFORE the map ever
// attaches, so Planning's own initial ~50x50km regional box-fit genuinely
// applies while still offline (fallback style active throughout), proven
// framed before the pinch — the case that actually tests whether a pinch
// corrupts an already-established Planning camera.

for (const recoverVia of ["retry", "online"] as const) {
  test(`Planning case 2 (cached-location-framed camera, offline): small pinch then ${recoverVia} recovery`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(CACHED_LOCATION);
    const styleController = await installLocalMapStyleWithFailureControl(page);
    const mapContainer = await openPlanningOffline(page, styleController);

    // Planning's own mount effect resolves requestApproximateLocation()
    // independently of map-tile connectivity and box-fits the regional
    // area once it does — wait for that real fit to land before treating
    // A as established.
    await expect
      .poll(async () => zoomOf(await readFullSnapshot(page, mapContainer, "A (poll)")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(RAW_WORLD_ZOOM_CEILING);
    await placeWaypoint(mapContainer, page);

    const a = await readFullSnapshot(
      page,
      mapContainer,
      "A (cached-location framed + waypoint)",
    );
    expect(isMeaningfullyFramed(a)).toBe(true);

    await pinchAndSettle(page, mapContainer, SMALL_PINCH);
    const b = await readFullSnapshot(page, mapContainer, "B (post-pinch, still offline)");

    if (recoverVia === "retry")
      await recoverViaRetryButton(page, mapContainer, styleController);
    else await recoverViaOnlineEvent(page, mapContainer, styleController);
    const c = await readFullSnapshot(
      page,
      mapContainer,
      `C (post-${recoverVia}-recovery)`,
    );

    test.info().annotations.push({
      type: "camera-race-case-2",
      description: JSON.stringify({ recoverVia, a, b, c }),
    });
    expect(isMeaningfullyFramed(c)).toBe(true);
  });
}

// --- Planning: case 3 — manually-established camera before any app fit ---
// The reverse-direction control: a rider deliberately zooms in (a genuine
// prior gesture) before geolocation/any app command ever lands. A fix
// must not discard this legitimate early interaction. The reported SMALL
// pinch is then performed a second time, on top of this already-manual
// camera.

for (const recoverVia of ["retry", "online"] as const) {
  test(`Planning case 3 (manually-established camera before any app fit): small pinch then ${recoverVia} recovery`, async ({
    page,
  }) => {
    const styleController = await installLocalMapStyleWithFailureControl(page);
    const mapContainer = await openPlanningOffline(page, styleController);

    await pinchAndSettle(page, mapContainer, DELIBERATE_ZOOM_IN_PINCH);
    const a = await readFullSnapshot(
      page,
      mapContainer,
      "A (manually zoomed in, no app fit ever)",
    );
    expect(isMeaningfullyFramed(a)).toBe(true);

    await pinchAndSettle(page, mapContainer, SMALL_PINCH);
    const b = await readFullSnapshot(
      page,
      mapContainer,
      "B (post-small-pinch, still offline)",
    );

    if (recoverVia === "retry")
      await recoverViaRetryButton(page, mapContainer, styleController);
    else await recoverViaOnlineEvent(page, mapContainer, styleController);
    const c = await readFullSnapshot(
      page,
      mapContainer,
      `C (post-${recoverVia}-recovery)`,
    );

    test.info().annotations.push({
      type: "camera-race-case-3",
      description: JSON.stringify({ recoverVia, a, b, c }),
    });
    // The manually-built camera must survive — this is a preservation
    // contract, not a "must be reframed" contract.
    expect(isMeaningfullyFramed(c)).toBe(true);
  });
}

// --- Zoom-button comparison: measured, not presumed safe ---

test("Planning case 1 with the Zoom in button instead of a pinch", async ({ page }) => {
  const styleController = await installLocalMapStyleWithFailureControl(page);
  const mapContainer = await openPlanningOffline(page, styleController);
  await placeWaypoint(mapContainer, page);

  const a = await readFullSnapshot(page, mapContainer, "A (waypoint placed, pre-button)");
  await pressZoomIn(page, mapContainer);
  const b = await readFullSnapshot(
    page,
    mapContainer,
    "B (post-zoom-button, still offline)",
  );

  await recoverViaRetryButton(page, mapContainer, styleController);
  const c = await readFullSnapshot(page, mapContainer, "C (post-retry-recovery)");

  test.info().annotations.push({
    type: "camera-race-case-1-button",
    description: JSON.stringify({ a, b, c }),
  });
  expect(isMeaningfullyFramed(c)).toBe(true);
});

test("Planning case 2 with the Zoom in button instead of a pinch", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(CACHED_LOCATION);
  const styleController = await installLocalMapStyleWithFailureControl(page);
  const mapContainer = await openPlanningOffline(page, styleController);

  await expect
    .poll(async () => zoomOf(await readFullSnapshot(page, mapContainer, "A (poll)")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(RAW_WORLD_ZOOM_CEILING);
  await placeWaypoint(mapContainer, page);

  const a = await readFullSnapshot(
    page,
    mapContainer,
    "A (cached-location framed + waypoint)",
  );
  expect(isMeaningfullyFramed(a)).toBe(true);

  await pressZoomIn(page, mapContainer);
  const b = await readFullSnapshot(
    page,
    mapContainer,
    "B (post-zoom-button, still offline)",
  );

  await recoverViaRetryButton(page, mapContainer, styleController);
  const c = await readFullSnapshot(page, mapContainer, "C (post-retry-recovery)");

  test.info().annotations.push({
    type: "camera-race-case-2-button",
    description: JSON.stringify({ a, b, c }),
  });
  expect(isMeaningfullyFramed(c)).toBe(true);
});

// --- Pre-ride: primary case — fallback genuinely active, route framed ---

for (const recoverVia of ["retry", "online"] as const) {
  test(`Pre-ride (route framed, fallback active): small pinch then ${recoverVia} recovery`, async ({
    page,
  }) => {
    const styleController = await installLocalMapStyleWithFailureControl(page);
    const mapContainer = await importGpxAndOpenPreRideOffline(page, styleController);

    const a = await readFullSnapshot(
      page,
      mapContainer,
      "A (route open, fallback active)",
    );
    await pinchAndSettle(page, mapContainer, SMALL_PINCH);
    const b = await readFullSnapshot(page, mapContainer, "B (post-pinch, still offline)");

    if (recoverVia === "retry")
      await recoverViaRetryButton(page, mapContainer, styleController);
    else await recoverViaOnlineEvent(page, mapContainer, styleController);
    const c = await readFullSnapshot(
      page,
      mapContainer,
      `C (post-${recoverVia}-recovery)`,
    );

    test.info().annotations.push({
      type: "camera-race-preride",
      description: JSON.stringify({ recoverVia, a, b, c }),
    });
    expect(isMeaningfullyFramed(c)).toBe(true);
    await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  });
}

// No pre-ride Zoom-button comparison: RidingScreen only renders
// .ride-map-zoom-controls once nav.geolocationStatus === "watching" (i.e.
// after Start/Resume riding has actually begun) — confirmed by reading
// RidingScreen.tsx directly. The pre-ride preview screen this file's
// primary case exercises has no Zoom in/out control to press at all, so
// there is nothing to compare here; this is a genuine scoping fact, not a
// gap in this file's coverage.

// --- Pre-ride, supplementary: gesture before the ORIGINAL style ever
// reaches styleStructurallyReady. A narrower, different race from the
// primary case above (fallback already settled) — does not replace it.

test("Pre-ride supplementary: pinch before the original style ever settles, then retry recovery", async ({
  page,
}) => {
  const styleController = await installLocalMapStyleWithFailureControl(page);
  styleController.failStyle();
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  const mapContainer = page.locator('[data-testid="map-container"]');
  // Deliberately pinch as early as possible, without waiting for the
  // fallback banner — the closest this harness can get to "before the
  // original style attempt has settled," given installLocalMapStyleWithFailureControl
  // has no artificial style-delay knob. This is a narrower, best-effort
  // approximation, not a guaranteed-long stall.
  await dispatchTwoFingerPinch(page, { x: 200, y: 300 }, SMALL_PINCH);
  await expect(page.getByTestId("map-fallback-banner")).toBeVisible({ timeout: 15_000 });
  await waitForCameraToSettle(mapContainer);
  const a = await readFullSnapshot(
    page,
    mapContainer,
    "A (pinch raced against original style)",
  );

  await recoverViaRetryButton(page, mapContainer, styleController);
  const c = await readFullSnapshot(page, mapContainer, "C (post-retry-recovery)");

  test.info().annotations.push({
    type: "camera-race-preride-supplementary",
    description: JSON.stringify({ a, c }),
  });
  expect(isMeaningfullyFramed(c)).toBe(true);
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
});

// --- Item 94 follow-up v2: sustained-offline retry cascade ---
// A physical-device retest of the v0.4.2 fix (the cases above) found it
// insufficient for a distinct, more precise reproduction: pressing Retry
// (or reconnecting) while imagery is STILL unreachable makes MapView
// internally attempt the real remote style a second time (which fails
// again) before automatically falling back once more — and that
// intermediate, doomed attempt's own spurious pre-style-ready settle can
// corrupt the camera the surviving fallback generation then restores. See
// MapView.tsx's own "item 94 follow-up v2" comment (near the top of its
// map-creation effect) for the confirmed mechanism.
//
// Unlike the cases above (which always call succeedStyle() before
// triggering recovery, so the retry's own remote attempt always succeeds
// on the first try), every test below deliberately keeps the style
// endpoint failing through the FIRST recovery attempt — the intermediate
// camera is asserted BEFORE any genuine success, so a future
// implementation that merely reframes correctly on eventual success
// (while still passing through a wrong intermediate state) cannot pass.

// Deliberately NOT parametrized with a "newly placed waypoint(s), no
// geolocation" variant: that starting state never genuinely establishes a
// camera before the pinch (per this file's own case 1 above), so a pinch
// on it is correctly NOT durably preserved — recovery legitimately
// reframes to the waypoint instead, per v0.4.2's own confirmed, correct
// behaviour. Asserting exact preservation there would be asserting the
// wrong contract. Only the genuinely-established case can test "does a
// real, useful pre-retry camera survive the sustained-offline cascade".
test("Planning (cached-location-framed, two separated waypoints): small pinch survives a retry whose own remote-style attempt also fails, both immediately and after genuine recovery", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(CACHED_LOCATION);
  const styleController = await installLocalMapStyleWithFailureControl(page);
  const mapContainer = await openPlanningOffline(page, styleController);
  await establishPlanningViewWithTwoWaypoints(page, mapContainer);

  await pinchAndSettle(page, mapContainer, SMALL_PINCH);
  const postPinch = await readFullSnapshot(
    page,
    mapContainer,
    "post-pinch (still offline)",
  );

  // The retry's own remote-style attempt genuinely fails again — no
  // succeedStyle() call — so this exercises the real, confirmed
  // sustained-offline cascade: attempt real style (fails) -> automatic
  // fallback (generation N -> N+1 within one retryToken effect run).
  await attemptFailingRecoveryToFallback(page, mapContainer, styleController, () =>
    page.getByTestId("retry-map-imagery-button").click(),
  );
  const intermediate = await readFullSnapshot(
    page,
    mapContainer,
    "immediately after the failed retry's own fallback (before genuine recovery)",
  );
  assertCameraMatches(
    intermediate.camera,
    postPinch.camera,
    "intermediate camera after the failed-retry fallback",
  );

  // Now let a genuine recovery succeed, and prove the SAME camera still
  // holds — not merely that it happens to look correct once real success
  // eventually arrives.
  await recoverViaRetryButton(page, mapContainer, styleController);
  const final = await readFullSnapshot(
    page,
    mapContainer,
    "final camera after genuine recovery",
  );
  assertCameraMatches(
    final.camera,
    postPinch.camera,
    "final camera after genuine recovery",
  );

  test.info().annotations.push({
    type: "camera-race-sustained-offline-retry",
    description: JSON.stringify({ postPinch, intermediate, final }),
  });
});

test("Planning: small pinch survives connectivity returning while imagery is still unreachable (genuine offline-to-online transition, not a synthetic event)", async ({
  page,
  context,
}) => {
  // Geolocation must be granted/set BEFORE Planning ever mounts — see
  // establishPlanningViewWithTwoWaypoints's own doc comment.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(CACHED_LOCATION);
  const styleController = await installLocalMapStyleWithFailureControl(page);
  const mapContainer = await openPlanningOffline(page, styleController);
  // A genuine browser-level offline state, applied only once the app
  // shell itself has already loaded (setOffline(true) blocks ALL network
  // traffic, including the local preview server's own app-shell
  // requests, confirmed directly — it cannot be applied before page.goto)
  // — not merely a mocked style failure, matching the field report's own
  // "remain offline" starting condition more faithfully. Proven
  // compatible with page.route() interception by existing precedent in
  // this repo (e.g. mapImageryRecovery.spec.ts's "being offline alone..."
  // test): route handlers still fully control the outcome regardless of
  // setOffline's own state.
  await context.setOffline(true);
  await establishPlanningViewWithTwoWaypoints(page, mapContainer);

  await pinchAndSettle(page, mapContainer, SMALL_PINCH);
  const postPinch = await readFullSnapshot(
    page,
    mapContainer,
    "post-pinch (still offline)",
  );

  try {
    // The genuine offline -> online transition: a real browser-level
    // network-state change (fires the page's own real "online" event),
    // NOT a synthetic dispatchEvent — while the style endpoint itself
    // stays unavailable throughout (styleController.failStyle() is never
    // cleared here), matching "online but imagery still unreachable"
    // rather than "still offline".
    await attemptFailingRecoveryToFallback(page, mapContainer, styleController, () =>
      page.context().setOffline(false),
    );
    const intermediate = await readFullSnapshot(
      page,
      mapContainer,
      "immediately after the failed reconnection's own fallback (before genuine recovery)",
    );
    assertCameraMatches(
      intermediate.camera,
      postPinch.camera,
      "intermediate camera after the failed-reconnection fallback",
    );

    await recoverViaOnlineEvent(page, mapContainer, styleController);
    const final = await readFullSnapshot(
      page,
      mapContainer,
      "final camera after genuine recovery",
    );
    assertCameraMatches(
      final.camera,
      postPinch.camera,
      "final camera after genuine recovery",
    );

    test.info().annotations.push({
      type: "camera-race-sustained-offline-online-then-unreachable",
      description: JSON.stringify({ postPinch, intermediate, final }),
    });
  } finally {
    await context.setOffline(false);
  }
});

test("Pre-ride: small pinch survives a retry whose own remote-style attempt also fails, both immediately and after genuine recovery", async ({
  page,
}) => {
  const styleController = await installLocalMapStyleWithFailureControl(page);
  const mapContainer = await importGpxAndOpenPreRideOffline(page, styleController);

  await pinchAndSettle(page, mapContainer, SMALL_PINCH);
  const postPinch = await readFullSnapshot(
    page,
    mapContainer,
    "post-pinch (still offline)",
  );

  await attemptFailingRecoveryToFallback(page, mapContainer, styleController, () =>
    page.getByTestId("retry-map-imagery-button").click(),
  );
  const intermediate = await readFullSnapshot(
    page,
    mapContainer,
    "immediately after the failed retry's own fallback (before genuine recovery)",
  );
  assertCameraMatches(
    intermediate.camera,
    postPinch.camera,
    "intermediate camera after the failed-retry fallback",
  );
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();

  await recoverViaRetryButton(page, mapContainer, styleController);
  const final = await readFullSnapshot(
    page,
    mapContainer,
    "final camera after genuine recovery",
  );
  assertCameraMatches(
    final.camera,
    postPinch.camera,
    "final camera after genuine recovery",
  );
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();

  test.info().annotations.push({
    type: "camera-race-preride-sustained-offline-retry",
    description: JSON.stringify({ postPinch, intermediate, final }),
  });
});
