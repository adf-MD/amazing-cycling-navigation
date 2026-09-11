import { expect, test, type Locator, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation), and
// this test needs to mock the ORS endpoint reliably.
test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

interface CapturedOrsRequestBody {
  options?: { avoid_features?: string[] };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Mirrors layout.spec.ts's own identical helpers, duplicated locally
// rather than shared — this project's established e2e-spec precedent.
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

/** Deterministically drives the map to a zoom comfortably within
 * routeWidthPolicy.ts's "close" band (>= ROUTE_WIDTH_CLOSE_ZOOM) via
 * MapLibre's own real, deterministic KeyboardHandler — mirrors this
 * file's own "pressing Northwards twice" test's choice of the keyboard
 * handler over a synthetic pointer/wheel gesture, and
 * lowZoomLegibility.spec.ts's own near-identical zoomToBand helper
 * (duplicated here rather than shared, matching this file's established
 * precedent of not sharing e2e interaction helpers across spec files).
 * Needed because a fresh session's own initial framing zoom is not
 * guaranteed to already be in the "close" band, and the caller's own
 * claim — that a waypoint's list badge and its map marker visually
 * match — is only made for that band: the map marker's own *size* (never
 * its colour) is intentionally zoom-responsive (backlog item 23), while
 * the list badge deliberately is not.
 *
 * Waits for data-camera-zoom to genuinely change between presses, not
 * merely to be non-empty: under heavy parallel CI load, sending the next
 * Shift+= before the previous one's easeTo has actually settled reads a
 * mid-flight tr.zoom (both presses share the fixed "keyboardHandler"
 * easeId), under-compounding the nominal +2-per-press increment enough
 * that 15 presses can land short of the close band — reproduced locally
 * under sustained worker contention. Capturing the value immediately
 * before each press and polling for a genuine change (rather than a
 * longer timeout, a retry, or fewer/looser attempts) makes each press
 * count its full increment before the next is sent. */
async function zoomToCloseRange(page: Page, mapContainer: Locator): Promise<void> {
  const canvas = mapContainer.locator("canvas");
  await canvas.focus();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const band = await mapContainer.getAttribute("data-marker-zoom-band");
    if (band === "close") return;
    const zoomBefore = await mapContainer.getAttribute("data-camera-zoom");
    await page.keyboard.press("Shift+=");
    await expect
      .poll(() => mapContainer.getAttribute("data-camera-zoom"), { timeout: 2_000 })
      .not.toBe(zoomBefore);
  }
  await expect(mapContainer).toHaveAttribute("data-marker-zoom-band", "close");
}

/**
 * Deterministically establishes a genuine manual rotation and tilt via
 * MapLibre's own built-in KeyboardHandler rather than a synthetic pointer
 * drag through DragRotateHandler — shared by this file's "pressing
 * Northwards twice" test and its "Locate me" test below, both of which
 * need the identical deterministic precondition (a plain local e2e
 * helper, not a production test seam).
 *
 * MapLibre sets tabindex="0" on the <canvas> itself (map.ts's
 * _setupContainer), not the container div, so focus the canvas
 * specifically; there is no isTrusted gating anywhere in this path, so a
 * plain programmatic focus() is enough to make it document.activeElement.
 * Shift+ArrowRight/Shift+ArrowUp each dispatch exactly one trusted
 * keydown+keyup, which KeyboardHandler.keydown() turns into a single
 * fixed +15°/+10° map.easeTo() call through MapLibre's own ordinary
 * camera-animation pipeline (_prepareEase -> movestart/rotatestart ->
 * per-frame move/rotate -> _afterEase -> rotateend -> moveend) — the same
 * pipeline a real drag, or this app's own North-up reset, already uses.
 * There is no drag/inertia state machine in this path, so it cannot
 * reproduce the DragRotateHandler stuck-gesture failure mode this file's
 * own tests have hit in CI (see CLAUDE.md future-backlog item 21) —
 * including, previously, the "Locate me" test's own former right-button
 * diagonal drag, which used the flaky gesture for the exact same purpose
 * this helper now serves deterministically.
 *
 * Shift+ArrowUp is sent only once the bearing rotation above has fully
 * settled: both key presses share the keyboard handler's fixed easeId
 * ("keyboardHandler"), and camera.ts's easeTo/_stop/_afterEase suppress
 * an in-flight ease's own end events when a same-id ease interrupts it,
 * so sending it earlier would make the resulting bearing/pitch
 * non-deterministic.
 */
async function establishManualRotationAndPitch(
  page: Page,
  mapContainer: Locator,
): Promise<void> {
  const canvas = mapContainer.locator("canvas");
  await canvas.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => mapContainer.getAttribute("data-camera-bearing")).not.toBe("0");
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).not.toBe("0");
}

// MapView.tsx's POSITION_LAYER_ID paint colour for the current-location dot.
const CURRENT_POSITION_DOT_COLOUR: readonly [number, number, number] = [0x1a, 0x73, 0xe8];

/** Runs entirely inside the page: decodes a screenshot PNG and counts
 * pixels close to the current-location dot's known fill colour, proving
 * the real MapLibre circle layer actually paints — not just that
 * PlanningScreen called setGeoJsonSourceData (see PlanningScreen.test.tsx's
 * mock-level assertions for that). Mirrors gradientColouring.spec.ts's own
 * screenshot-decode-and-sample technique, duplicated locally here rather
 * than imported, matching that file's own precedent of not sharing it
 * across spec files. */
async function countCurrentPositionDotPixels({
  pngBase64,
  colour,
}: {
  pngBase64: string;
  colour: readonly [number, number, number];
}): Promise<number> {
  const COLOUR_THRESHOLD_SQUARED = 400;

  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(new Error("failed to decode captured screenshot"));
    };
  });
  image.src = `data:image/png;base64,${pngBase64}`;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context unavailable");
  }
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

  let pixelCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - colour[0];
    const dg = data[i + 1] - colour[1];
    const db = data[i + 2] - colour[2];
    if (dr * dr + dg * dg + db * db <= COLOUR_THRESHOLD_SQUARED) {
      pixelCount++;
    }
  }
  return pixelCount;
}

// Deliberately wrong ascent/descent — the app must compute its own via its
// documented smoothing policy rather than trusting the provider's numbers
// (see routing/normalizeOpenRouteServiceRoute.ts).
const MOCK_ORS_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        summary: { distance: 950, duration: 200, ascent: 999, descent: 999 },
        segments: [
          {
            distance: 950,
            duration: 200,
            steps: [
              {
                distance: 950,
                duration: 200,
                type: 0,
                instruction: "Head north",
                way_points: [0, 9],
              },
            ],
          },
        ],
        extras: {
          surface: {
            // Two adjacent, different questionable surface types (8
            // "Compacted Gravel", 10 "Gravel"), followed by paved — proves
            // they render as two distinct, separately selectable entries
            // rather than silently merging just because they share a
            // classification.
            values: [
              [0, 2, 8],
              [2, 4, 10],
              [4, 9, 1],
            ],
          },
        },
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.1, 51.5, 10],
          [-0.099, 51.5005, 12],
          [-0.098, 51.501, 15],
          [-0.097, 51.5015, 20],
          [-0.096, 51.502, 25],
          [-0.095, 51.5025, 22],
          [-0.094, 51.503, 18],
          [-0.093, 51.5035, 14],
          [-0.092, 51.504, 11],
          [-0.091, 51.5045, 9],
        ],
      },
    },
  ],
};

/** A minimal, valid ORS directions response whose LineString geometry is
 * exactly the coordinates it was asked to route between — used by the
 * multi-leg test below, where each of the two-waypoint leg requests must
 * get back a response that actually starts/ends at what it requested, so
 * stitchPlannedRouteLegs.ts's seam check passes for real (unlike the
 * fixed MOCK_ORS_RESPONSE above, which only ever represents one whole
 * route, not an individual leg). */
function buildMockOrsResponseForCoordinates(coordinates: readonly (readonly number[])[]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          summary: { distance: 100, duration: 20 },
        },
        geometry: {
          type: "LineString",
          coordinates: coordinates.map(([lon, lat]) => [lon, lat, 10]),
        },
      },
    ],
  };
}

test("configures a key, plans a route via a mocked ORS response, saves it, and reopens it without the provider", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  // Re-binds window.fetch through a trivial wrapper before the app's own
  // scripts run. Verified necessary by bisection: without it, the POST to
  // the (page.route-mocked) ORS endpoint intermittently never reaches
  // Playwright's request interception at all in this test environment —
  // a Chromium/CDP request-interception timing quirk, not anything this
  // app's code does differently. Harmless in any environment: it forwards
  // every call unchanged to the real fetch.
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");

  // Configure the key in Settings — never a real one, a fixed dummy string.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();

  // Mocks the ORS endpoint before any request can be made — asserts the
  // request shape (URL, Authorization header) as it captures it.
  let capturedUrl: string | null = null;
  let capturedAuthHeader = "";
  await page.route(ORS_URL_GLOB, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      capturedUrl = request.url();
      capturedAuthHeader = request.headers().authorization;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(MOCK_ORS_RESPONSE),
    });
  });

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  // Two direct map clicks place two waypoints — no key needed for this
  // part, and the notice must not be shown once a key is saved.
  await expect(
    page.getByText("Road routing requires your personal OpenRouteService key."),
  ).toBeHidden();
  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 100, y: 100 } });
  await mapContainer.click({ position: { x: 200, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

  expect(capturedUrl).toContain("/directions/cycling-road/geojson");
  expect(capturedAuthHeader).toBe(DUMMY_KEY);

  const summaryText = await summaryRegion.innerText();
  expect(summaryText).toMatch(/km/);
  // Proves the provider's own (deliberately wrong) ascent was discarded.
  expect(summaryText).not.toContain("999 m ascent");

  // Planning now shows its own elevation profile (see
  // gradientColouring.spec.ts for the fuller gradient-colouring
  // coverage) — a lightweight presence check here, not a duplicate.
  await expect(
    summaryRegion.getByRole("img", { name: "Elevation profile chart" }),
  ).toBeVisible();

  // Two adjacent, different questionable surface types must render as two
  // distinct, separately selectable entries — the collapsed label is
  // generic ("Questionable surface"), so the specific category is only
  // distinguishable once each is expanded.
  const questionableButtons = page.getByRole("button", { name: /^Questionable surface/ });
  await expect(questionableButtons).toHaveCount(2);

  await questionableButtons.nth(0).click();
  await expect(page.getByText("Surface: Compacted gravel")).toBeVisible();
  await questionableButtons.nth(0).click(); // toggle closed

  await questionableButtons.nth(1).click();
  await expect(page.getByText("Surface: Gravel / fine gravel")).toBeVisible();
  await questionableButtons.nth(1).click();

  const saveButton = page.getByRole("button", { name: /save route/i });
  const exportButton = page.getByRole("button", { name: /export gpx/i });
  await expect(saveButton).toBeEnabled();
  await expect(exportButton).toBeEnabled();

  const routeName = "E2E Planned Loop";
  const nameInput = page.getByLabel("Route name");
  await nameInput.fill(routeName);
  await saveButton.click();

  // Saving switches straight to Riding mode with the new route, from the
  // top of the document — by this point Planning's own long form (map,
  // waypoints, route options, overview, save/export) has scrolled the page
  // well below 0.
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  // Reopening a saved route must never need the provider — unroute the
  // mock and fail loudly if anything still tries to reach it.
  await page.unroute(ORS_URL_GLOB);
  let unexpectedOrsRequest = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    unexpectedOrsRequest = true;
    await route.abort("failed");
  });

  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByRole("button", { name: routeName, exact: true }).click();

  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// The one reload-recovery path not already covered elsewhere: every other
// e2e reload test (e.g. reverseRoute.spec.ts's "reloading after creating
// the reverse draft...") goes through RidingScreen's edit-copy/reverse
// draft-seeding flow. This proves a plain, hand-built Planning draft — no
// key, no calculation, no save — survives an ordinary reload too, exactly
// the invariant the hydration/autosave race fix (see CLAUDE.md) protects.
test("reloading Planning after placing waypoints and a route name recovers the same draft with no automatic routing request", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  let orsRequestCount = 0;
  await page.route(ORS_URL_GLOB, async (route) => {
    if (route.request().method() === "POST") orsRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(MOCK_ORS_RESPONSE),
    });
  });

  await page.goto("/");

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 100, y: 100 } });
  await mapContainer.click({ position: { x: 200, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  const routeName = "E2E Reload Draft";
  await page.getByLabel("Route name").fill(routeName);

  // Past the draft-autosave debounce, so the placed waypoints and typed
  // name are genuinely persisted before reloading.
  await page.waitForTimeout(1_200);
  expect(orsRequestCount).toBe(0);

  await page.reload();
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(page.getByLabel("Route name")).toHaveValue(routeName);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();
  // The reload and re-hydration themselves must not issue any routing
  // request — the mocked count is unchanged from before the reload.
  expect(orsRequestCount).toBe(0);

  // Backlog item 35: the restored draft's two waypoints get a one-time
  // camera fit — proved two ways, real marker geometry (not merely the
  // sidebar list) and genuine settled-camera state (not MapLibre's raw,
  // un-settled default).
  await expect.poll(() => mapContainer.getAttribute("data-camera-center")).not.toBe("");
  await expect(mapContainer).toHaveAttribute("data-camera-zoom", /^\d/);
  const waypointMarkers = page.locator(".planning-waypoint-marker");
  await expect(waypointMarkers).toHaveCount(2);
  const mapBox = await mapContainer.boundingBox();
  if (!mapBox) {
    throw new Error("expected the map container to lay out");
  }
  for (const marker of await waypointMarkers.all()) {
    const markerBox = await marker.boundingBox();
    if (!markerBox) {
      throw new Error("expected a waypoint marker to lay out");
    }
    expect(isFullyWithin(markerBox, mapBox)).toBe(true);
  }

  const CENTRE_CHANGE_TOLERANCE_DEGREES = 1e-4; // ~11 m, mirrors the Locate-me test's own tolerance

  // Backlog item 52: Planning's top-left Zoom in/out controls change only
  // zoom, at the map's current centre — never pan/recentre, never touch
  // bearing/pitch, and never restart Locate-me's own state machine.
  const locateButton = page.getByRole("button", { name: "Locate me" });
  const zoomInButton = page.getByRole("button", { name: "Zoom in" });
  const zoomOutButton = page.getByRole("button", { name: "Zoom out" });
  const centreBeforeZoom = await mapContainer.getAttribute("data-camera-center");
  const bearingBeforeZoom = await mapContainer.getAttribute("data-camera-bearing");
  const pitchBeforeZoom = await mapContainer.getAttribute("data-camera-pitch");
  const zoomBeforeZoomIn = await mapContainer.getAttribute("data-camera-zoom");

  await zoomInButton.click();
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(zoomBeforeZoomIn);
  const zoomAfterZoomIn = await mapContainer.getAttribute("data-camera-zoom");
  expect(Number(zoomAfterZoomIn)).toBeGreaterThan(Number(zoomBeforeZoomIn));

  await zoomOutButton.click();
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-zoom"))
    .not.toBe(zoomAfterZoomIn);
  const zoomAfterZoomOut = await mapContainer.getAttribute("data-camera-zoom");
  expect(Number(zoomAfterZoomOut)).toBeLessThan(Number(zoomAfterZoomIn));

  const centreAfterZoom = await mapContainer.getAttribute("data-camera-center");
  if (!centreAfterZoom || !centreBeforeZoom) {
    throw new Error("expected a settled camera centre before and after zooming");
  }
  const [lonBeforeZoom, latBeforeZoom] = centreBeforeZoom.split(",").map(Number);
  const [lonAfterZoom, latAfterZoom] = centreAfterZoom.split(",").map(Number);
  expect(Math.abs(lonAfterZoom - lonBeforeZoom)).toBeLessThanOrEqual(
    CENTRE_CHANGE_TOLERANCE_DEGREES,
  );
  expect(Math.abs(latAfterZoom - latBeforeZoom)).toBeLessThanOrEqual(
    CENTRE_CHANGE_TOLERANCE_DEGREES,
  );
  expect(await mapContainer.getAttribute("data-camera-bearing")).toBe(bearingBeforeZoom);
  expect(await mapContainer.getAttribute("data-camera-pitch")).toBe(pitchBeforeZoom);

  expect(await locateButton.textContent()).not.toBe("Locating…");
  await expect(page.getByText("Your location could not be determined.")).toHaveCount(0);

  // A genuine manual pan (mirrors the "Locate me recentres..." test's own
  // deterministic technique — an unmodified ArrowRight via MapLibre's
  // KeyboardHandler, not a synthetic drag) must not be undone by a
  // subsequent, unrelated waypoint edit.
  await mapContainer.locator("canvas").focus();
  const centreBeforePan = await mapContainer.getAttribute("data-camera-center");
  await page.keyboard.press("ArrowRight");
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
  const zoomAfterPan = await mapContainer.getAttribute("data-camera-zoom");
  const bearingAfterPan = await mapContainer.getAttribute("data-camera-bearing");
  const pitchAfterPan = await mapContainer.getAttribute("data-camera-pitch");

  // The draft remains editable after reload — a third waypoint placed now
  // is accepted normally, proving hydration completed and autosave is
  // live again, not stuck blocking further edits. This is also the
  // "non-camera waypoint edit" half of the manual-pan-preservation proof
  // above: placing it must not move the camera the rider just established.
  await mapContainer.click({ position: { x: 300, y: 200 } });
  await expect(
    page.getByRole("button", { name: "Waypoint 3", exact: true }),
  ).toBeVisible();

  expect(await mapContainer.getAttribute("data-camera-center")).toBe(centreAfterPan);
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(zoomAfterPan);
  expect(await mapContainer.getAttribute("data-camera-bearing")).toBe(bearingAfterPan);
  expect(await mapContainer.getAttribute("data-camera-pitch")).toBe(pitchAfterPan);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("reloading Planning with a single restored waypoint frames it inside the visible map, not a degenerate zero-area fit", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 150, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  // Past the draft-autosave debounce, so the single placed waypoint is
  // genuinely persisted before reloading.
  await page.waitForTimeout(1_200);

  await page.reload();
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  await expect.poll(() => mapContainer.getAttribute("data-camera-center")).not.toBe("");
  const zoom = await mapContainer.getAttribute("data-camera-zoom");
  expect(zoom).not.toBe("");
  expect(zoom).not.toBeNull();
  // A degenerate zero-area fit (computeBoundingBox on a single coordinate,
  // rather than the local-area box this single-waypoint case must use
  // instead) would jump to fitBounds's hardcoded maxZoom of 16 — proving
  // the zoom stays comfortably below that confirms the ~50 km local-area
  // box was used, not a tight, marginless zoom-in.
  expect(Number(zoom)).toBeLessThan(15);

  const marker = page.locator(".planning-waypoint-marker");
  await expect(marker).toHaveCount(1);
  const markerBox = await marker.boundingBox();
  const mapBox = await mapContainer.boundingBox();
  if (!markerBox || !mapBox) {
    throw new Error("expected the marker and map container to lay out");
  }
  expect(isFullyWithin(markerBox, mapBox)).toBe(true);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("selecting General cycling and disabling avoid-ferries in the current-draft Change disclosure routes via the cycling-regular endpoint with no ferry avoidance", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();

  // A plain object, not two separate `let` bindings — TypeScript 6's
  // closure narrowing otherwise narrows a bare `let` reassigned only
  // inside this async route callback to `never` at every later read,
  // even behind optional chaining (confirmed in isolation; see the
  // captured object property pattern used here instead).
  const captured: { url: string | null; body: CapturedOrsRequestBody | null } = {
    url: null,
    body: null,
  };
  await page.route(ORS_URL_GLOB, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      captured.url = request.url();
      captured.body = request.postDataJSON() as CapturedOrsRequestBody;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(MOCK_ORS_RESPONSE),
    });
  });

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  // Zero ORS requests before Calculate, and the compact summary reflects
  // the default (Road bike, ferries avoided) before any change.
  await expect(
    page.getByText("Routing: Road bike · Ferries avoided", { exact: true }),
  ).toBeVisible();

  // Opening/editing the current-draft Change disclosure controls this
  // draft, not the Settings default.
  await page.getByText("Change", { exact: true }).click();
  const roadBikeButton = page.getByRole("button", { name: "Road bike", exact: true });
  const generalCyclingButton = page.getByRole("button", {
    name: "General cycling",
    exact: true,
  });
  const ferriesCheckbox = page.getByRole("checkbox", {
    name: "Avoid ferries for this draft",
  });
  await expect(roadBikeButton).toHaveAttribute("aria-pressed", "true");
  await expect(generalCyclingButton).toHaveAttribute("aria-pressed", "false");
  await expect(ferriesCheckbox).toBeChecked();

  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 100, y: 100 } });
  await mapContainer.click({ position: { x: 200, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();

  await generalCyclingButton.click();
  await expect(generalCyclingButton).toHaveAttribute("aria-pressed", "true");
  await expect(roadBikeButton).toHaveAttribute("aria-pressed", "false");
  await ferriesCheckbox.uncheck();
  await expect(ferriesCheckbox).not.toBeChecked();
  await expect(
    page.getByText("Routing: General cycling · Ferries allowed", { exact: true }),
  ).toBeVisible();

  // No routing request until Calculate is pressed explicitly.
  expect(captured.url).toBeNull();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

  expect(captured.url).toContain("/directions/cycling-regular/geojson");
  expect(captured.url).not.toContain("/directions/cycling-road/geojson");
  expect(captured.body?.options?.avoid_features ?? []).not.toContain("ferries");
  await expect(
    summaryRegion.getByText(/General cycling \(cycling-regular\)/),
  ).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a genuinely fresh draft picks up the Settings default cycling profile, with no routing request until Calculate", async ({
  page,
}) => {
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  let unexpectedOrsRequest = false;
  await page.route(ORS_URL_GLOB, async (route) => {
    unexpectedOrsRequest = true;
    await route.abort("failed");
  });

  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  const profileGroup = page.getByRole("group", { name: "Default cycling profile" });
  await profileGroup
    .getByRole("button", { name: "General cycling", exact: true })
    .click();
  await expect(
    profileGroup.getByRole("button", { name: "General cycling", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(
    page.getByText("Routing: General cycling · Ferries avoided", { exact: true }),
  ).toBeVisible();

  expect(unexpectedOrsRequest).toBe(false);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});

test("the action card's Calculate button sits above the Waypoints heading in actual visual/DOM order", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  const waypointsHeading = page.getByRole("heading", { level: 2, name: "Waypoints" });
  await expect(calculateButton).toBeVisible();
  await expect(waypointsHeading).toBeVisible();

  const [calculateBox, waypointsBox] = await Promise.all([
    calculateButton.boundingBox(),
    waypointsHeading.boundingBox(),
  ]);
  if (!calculateBox || !waypointsBox) {
    throw new Error(
      "expected both the Calculate button and Waypoints heading to have a box",
    );
  }
  expect(calculateBox.y).toBeLessThan(waypointsBox.y);

  const documentOrder = await page.evaluate(() => {
    const calculate = Array.from(document.querySelectorAll("button")).find((button) =>
      /calculate route/i.test(button.textContent),
    );
    const waypointsHeadingEl = Array.from(document.querySelectorAll("h2")).find(
      (heading) => heading.textContent === "Waypoints",
    );
    if (!calculate || !waypointsHeadingEl) return null;
    return Boolean(
      calculate.compareDocumentPosition(waypointsHeadingEl) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(documentOrder).toBe(true);
});

test("plans a route across three waypoints using exactly one routing request per section", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();

  // Body-aware, unlike the fixed-response mock above: each leg request
  // gets back a response that actually starts/ends where it asked,
  // proving three waypoints become two real two-coordinate requests
  // rather than one whole-route request.
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

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 80, y: 80 } });
  await mapContainer.click({ position: { x: 180, y: 120 } });
  await mapContainer.click({ position: { x: 280, y: 160 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waypoint 3", exact: true }),
  ).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

  // Exactly two sections (A->B, B->C), each a genuine two-point request,
  // and the shared waypoint lines up as the first leg's own end.
  expect(requestedCoordinatePairs).toHaveLength(2);
  expect(requestedCoordinatePairs[0]).toHaveLength(2);
  expect(requestedCoordinatePairs[1]).toHaveLength(2);
  expect(requestedCoordinatePairs[1]?.[0]).toEqual(requestedCoordinatePairs[0]?.[1]);

  const summaryText = await summaryRegion.innerText();
  expect(summaryText).toMatch(/km|m\b/);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("aligns the crosshair exactly with the map's own visual centre, and renders a numbered waypoint marker", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  // jsdom can assert style strings but not real rendered geometry — this
  // is the one assertion only a real browser can make, catching the
  // previous double CSS offset (translate(-50%,-50%) plus a redundant
  // negative margin) that a style-string check alone would miss.
  const crosshair = page.getByTestId("planning-crosshair");
  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect(crosshair).toBeVisible();
  const crosshairBox = await crosshair.boundingBox();
  const mapBox = await mapContainer.boundingBox();
  if (!crosshairBox || !mapBox) {
    throw new Error("expected both the crosshair and the map container to lay out");
  }

  const crosshairCentreX = crosshairBox.x + crosshairBox.width / 2;
  const crosshairCentreY = crosshairBox.y + crosshairBox.height / 2;
  const mapCentreX = mapBox.x + mapBox.width / 2;
  const mapCentreY = mapBox.y + mapBox.height / 2;
  expect(Math.abs(crosshairCentreX - mapCentreX)).toBeLessThanOrEqual(1);
  expect(Math.abs(crosshairCentreY - mapCentreY)).toBeLessThanOrEqual(1);

  // A waypoint placed exactly under the (now correctly centred) crosshair
  // renders as a real, DOM-based maplibregl.Marker — proving the actual
  // browser integration mounts, not merely that MapView called setMarkers
  // (see MapView.test.tsx's mock-level assertions for that).
  const addWaypointButton = page.getByRole("button", { name: "Add waypoint here" });
  await expect(addWaypointButton).toBeEnabled();
  await addWaypointButton.click();

  const marker = page.locator(".planning-waypoint-marker");
  await expect(marker).toHaveText("1");
  await expect(marker).toHaveClass(/planning-waypoint-marker--start/);
  await expect(page.getByRole("img", { name: "Start waypoint 1" })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("shows a visible current-location dot once geolocation resolves", async ({
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
  await context.setGeolocation({ latitude: 53.8, longitude: -1.5 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  // Force an explicit, verifiable success signal via Locate me rather than
  // relying on the initial auto-frame, which stays silent on failure.
  const locateButton = page.getByRole("button", { name: "Locate me" });
  await expect(locateButton).toBeEnabled();
  await locateButton.click();
  await expect(locateButton).toBeEnabled();
  await expect(
    page.getByText("Your location could not be determined."),
  ).not.toBeVisible();

  // The genuinely fresh session's own initial auto-frame (see
  // localAreaBounds.ts) centres the camera on this same resolved
  // coordinate, so the dot should be visible somewhere on the canvas once
  // MapLibre's paint/placement cycle settles.
  const canvasLocator = page.locator('[data-testid="map-container"] canvas');
  await page.waitForTimeout(500);
  const pngBuffer = await canvasLocator.screenshot();
  const pixelCount = await page.evaluate(countCurrentPositionDotPixels, {
    pngBase64: pngBuffer.toString("base64"),
    colour: CURRENT_POSITION_DOT_COLOUR,
  });
  expect(pixelCount).toBeGreaterThan(0);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("pressing Northwards twice, with a manual rotation in between, rotates back to north both times", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const mapContainer = page.locator('[data-testid="map-container"]');
  const canvas = mapContainer.locator("canvas");
  const northButton = page.getByRole("button", { name: "North-up, top-down view" });

  await northButton.click();
  await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");
  await expect(mapContainer).toHaveAttribute("data-camera-pitch", "0");
  await expect(northButton).toHaveAttribute("aria-pressed", "true");

  // Baseline for the centre/zoom-preservation check below. onCameraSettled
  // (MapView.tsx) publishes centre, zoom, bearing and pitch together in one
  // batch, so by the time the bearing/pitch assertions above have passed,
  // centre and zoom are already settled and non-empty too — no extra wait
  // needed.
  const centreBaseline = await mapContainer.getAttribute("data-camera-center");
  const zoomBaseline = await mapContainer.getAttribute("data-camera-zoom");
  if (!centreBaseline || !zoomBaseline) {
    throw new Error(
      "expected the map's camera to have settled after the first Northwards press",
    );
  }

  await expect(canvas).toBeVisible();

  // Deterministically establishes a genuine intervening manual rotation and
  // tilt via MapLibre's own built-in KeyboardHandler — see
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

  // New coverage: pressing North-up preserves centre and zoom across BOTH
  // presses (setCamera(null, null, 0, 0, ...)'s contract) — the existing
  // "Locate me" test above only proves centre/zoom preservation for a
  // different action.
  const CENTRE_PRESERVED_TOLERANCE_DEGREES = 1e-4; // ~11 m — matches this file's own CENTRE_CHANGE_TOLERANCE_DEGREES magnitude, reused here as a "no meaningful change" bound
  const centreAfter = await mapContainer.getAttribute("data-camera-center");
  if (!centreAfter) {
    throw new Error(
      "expected the map's camera to have settled after the second Northwards press",
    );
  }
  const [lonBaseline, latBaseline] = centreBaseline.split(",").map(Number);
  const [lonAfter, latAfter] = centreAfter.split(",").map(Number);
  expect(Math.abs(lonAfter - lonBaseline)).toBeLessThan(
    CENTRE_PRESERVED_TOLERANCE_DEGREES,
  );
  expect(Math.abs(latAfter - latBaseline)).toBeLessThan(
    CENTRE_PRESERVED_TOLERANCE_DEGREES,
  );
  // Exact-string equality is safe for zoom here, mirroring the "Locate me"
  // test's own justification: onCameraSettled batches
  // centre/zoom/bearing/pitch together in one publish, so once bearing/
  // pitch have already been asserted back to "0" above, zoom is read from
  // that same settled render.
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(zoomBaseline);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Locate me recentres without disturbing live zoom, bearing or pitch", async ({
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
  await context.setGeolocation({ latitude: 53.8, longitude: -1.5 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const mapContainer = page.locator('[data-testid="map-container"]');
  const locateButton = page.getByRole("button", { name: "Locate me" });

  // Get past the session's first framing (the automatic fresh-session
  // effect, or this press itself, whichever wins the race — either way
  // the app-level result is the same) before isolating the recentre-only
  // path this test targets.
  await expect(locateButton).toBeEnabled();
  await locateButton.click();
  await expect(locateButton).toBeEnabled();
  await expect(
    page.getByText("Your location could not be determined."),
  ).not.toBeVisible();

  // Deterministically establishes a genuine manual rotation and tilt via
  // MapLibre's own built-in KeyboardHandler — see
  // establishManualRotationAndPitch's own doc comment. Replaces a former
  // synthetic right-button diagonal drag through DragRotateHandler, which
  // was this test's own instance of the documented CI-only stuck-gesture
  // flake (CLAUDE.md future-backlog item 21): a real drag can, rarely and
  // environment-sensitively, never fire the rotate/pitch end events the
  // poll below waited on, timing the whole test out.
  await establishManualRotationAndPitch(page, mapContainer);

  const centreBeforePan = await mapContainer.getAttribute("data-camera-center");

  // Deterministically pans the centre via MapLibre's own KeyboardHandler
  // (an unmodified arrow key) instead of a synthetic left-button pointer
  // drag — the same rationale as establishManualRotationAndPitch, and it
  // removes this test's second, independent gesture-state dependency
  // while retaining the same real purpose: moving the centre well away
  // from the GPS fix, so the later recentre genuinely has something to
  // correct. An unmodified ArrowRight leaves bearingDir/pitchDir/zoomDir
  // all at 0 (only Shift sets bearingDir/pitchDir, only +/- sets zoomDir
  // — keyboard.ts's keydown()), so its easeTo call pans via a 100px
  // screen-space offset while carrying tr.bearing/tr.pitch/tr.zoom
  // straight through unchanged — exactly the rotation/tilt
  // establishManualRotationAndPitch just settled, still intact once this
  // pan itself settles.
  await page.keyboard.press("ArrowRight");

  const CENTRE_CHANGE_TOLERANCE_DEGREES = 1e-4; // ~11 m — far above Mercator round-trip noise, comfortably below a real pan
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

  const zoomBefore = await mapContainer.getAttribute("data-camera-zoom");
  const bearingBefore = await mapContainer.getAttribute("data-camera-bearing");
  const pitchBefore = await mapContainer.getAttribute("data-camera-pitch");

  await locateButton.click();

  // The fixed geolocation mock makes the recentred target deterministic —
  // poll for the centre actually returning close to it, the canonical
  // "transition genuinely completed" signal (mirrors smoke.spec.ts's own
  // data-camera-center poll), rather than an arbitrary sleep.
  await expect
    .poll(async () => {
      const raw = await mapContainer.getAttribute("data-camera-center");
      if (!raw) return false;
      const [lon, lat] = raw.split(",").map(Number);
      return Math.abs(lon - -1.5) < 0.01 && Math.abs(lat - 53.8) < 0.01;
    })
    .toBe(true);

  // Exact-string equality is safe here (not just "close"): MapView's
  // onCameraSettled sets cameraCenter and cameraOrientation together in one
  // batch, so once the centre poll above has settled, zoom/bearing/pitch
  // are read from that same published render — the values Locate me's
  // recentre-only path is expected to leave completely untouched.
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(zoomBefore);
  expect(await mapContainer.getAttribute("data-camera-bearing")).toBe(bearingBefore);
  expect(await mapContainer.getAttribute("data-camera-pitch")).toBe(pitchBefore);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// Visual slice 4 ("Planning workflow organisation"): proves the
// reorganised Planning screen behaves at a narrow iPhone width, not just
// on this file's other tests' default desktop viewport.
test.describe("phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("phone layout: no horizontal overflow, map chrome stays contained, a route can still be calculated and its actions stay reachable", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });
    await page.addInitScript(() => {
      const originalFetch = fetch;
      globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
    });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
    await page.getByRole("button", { name: "Save on this device" }).click();
    await expect(
      page.getByText(/key saved on this device, not yet verified/i),
    ).toBeVisible();

    await page.route(ORS_URL_GLOB, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(MOCK_ORS_RESPONSE),
      });
    });

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const readScrollWidths = () =>
      page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }));

    const initialScrollWidths = await readScrollWidths();
    expect(initialScrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(initialScrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    const mapContainer = page.locator('[data-testid="map-container"]');
    const mapWrapper = page.locator(".planning-map-container");
    const crosshair = page.getByTestId("planning-crosshair");
    const attribution = page.getByTestId("map-attribution");
    const locateButton = page.getByRole("button", { name: "Locate me" });
    const northUpButton = page.getByRole("button", { name: "North-up, top-down view" });

    await expect(mapContainer.locator("canvas")).toBeVisible();

    const [wrapperBox, crosshairBox, attributionBox, locateBox, northUpBox] =
      await Promise.all([
        mapWrapper.boundingBox(),
        crosshair.boundingBox(),
        attribution.boundingBox(),
        locateButton.boundingBox(),
        northUpButton.boundingBox(),
      ]);
    if (!wrapperBox || !crosshairBox || !attributionBox || !locateBox || !northUpBox) {
      throw new Error("expected all located map-chrome elements to have a bounding box");
    }
    expect(isFullyWithin(crosshairBox, wrapperBox)).toBe(true);
    expect(isFullyWithin(attributionBox, wrapperBox)).toBe(true);
    expect(isFullyWithin(locateBox, wrapperBox)).toBe(true);
    expect(isFullyWithin(northUpBox, wrapperBox)).toBe(true);
    expect(intersects(attributionBox, locateBox)).toBe(false);
    expect(intersects(attributionBox, northUpBox)).toBe(false);

    // Backlog item 52: the new top-left Zoom in/out cluster is a real
    // ≥44×44px touch target, fully inside the map, with a genuine gap
    // between the two buttons and no intersection with the top-right
    // North-up/Locate-me cluster or the attribution.
    const zoomInButton = page.getByRole("button", { name: "Zoom in" });
    const zoomOutButton = page.getByRole("button", { name: "Zoom out" });
    const [zoomInBox, zoomOutBox] = await Promise.all([
      zoomInButton.boundingBox(),
      zoomOutButton.boundingBox(),
    ]);
    if (!zoomInBox || !zoomOutBox) {
      throw new Error("expected both zoom controls to have a bounding box");
    }
    expect(zoomInBox.width).toBeGreaterThanOrEqual(44);
    expect(zoomInBox.height).toBeGreaterThanOrEqual(44);
    expect(zoomOutBox.width).toBeGreaterThanOrEqual(44);
    expect(zoomOutBox.height).toBeGreaterThanOrEqual(44);
    expect(isFullyWithin(zoomInBox, wrapperBox)).toBe(true);
    expect(isFullyWithin(zoomOutBox, wrapperBox)).toBe(true);
    expect(intersects(zoomInBox, zoomOutBox)).toBe(false);
    expect(intersects(zoomInBox, locateBox)).toBe(false);
    expect(intersects(zoomInBox, northUpBox)).toBe(false);
    expect(intersects(zoomOutBox, locateBox)).toBe(false);
    expect(intersects(zoomOutBox, northUpBox)).toBe(false);
    expect(intersects(zoomInBox, attributionBox)).toBe(false);
    expect(intersects(zoomOutBox, attributionBox)).toBe(false);

    // Two waypoints placed via direct map taps, exactly like the desktop
    // flow above.
    await mapContainer.click({ position: { x: 100, y: 100 } });
    await mapContainer.click({ position: { x: 150, y: 150 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Waypoint 2", exact: true }),
    ).toBeVisible();

    // Removing WaypointList's inline TOUCH_TARGET_STYLE (see CLAUDE.md's
    // visual-slice-4 paragraph) must not shrink a real touch target below
    // the accepted minimum — Vitest's css:false environment cannot verify
    // this, so it is only ever provable here.
    const deleteButton = page.getByRole("button", { name: "Delete Waypoint 2" });
    const deleteBox = await deleteButton.boundingBox();
    if (!deleteBox) throw new Error("expected the Delete button to have a bounding box");
    expect(deleteBox.width).toBeGreaterThanOrEqual(44);
    expect(deleteBox.height).toBeGreaterThanOrEqual(44);

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    const summaryRegion = page.getByRole("region", { name: "Route summary" });
    await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

    const saveButton = page.getByRole("button", { name: /save route/i });
    const exportButton = page.getByRole("button", { name: /export gpx/i });
    await saveButton.scrollIntoViewIfNeeded();
    await expect(saveButton).toBeEnabled();
    await exportButton.scrollIntoViewIfNeeded();
    await expect(exportButton).toBeEnabled();

    // Post-deployment item 48 follow-up: the routing summary and its
    // "Change" disclosure must read as one clearly hierarchical card — the
    // current routing values primary, "Change" a smaller secondary
    // affordance beneath them, both inside the same bordered <summary> —
    // and introduce no horizontal overflow either closed or open, with
    // every control it reveals keeping a real ≥44x44px touch target.
    // Vitest's css:false environment cannot verify any of this.
    const routingValue = page.getByText(/^routing:/i);
    const changeLabel = page.getByText("Change", { exact: true });
    // <summary> is the real disclosure header now — it holds both the
    // routing value and the Change affordance, stacked. Traversed via
    // xpath, mirroring this file's existing ancestor-lookup convention for
    // <details> just below.
    const disclosureSummary = changeLabel.locator("xpath=ancestor::summary");
    // The action row (Change's label plus the chevron) — changeLabel's own
    // immediate parent — used for overlap checks against the value line.
    const actionRow = changeLabel.locator("xpath=..");
    const chevron = page.locator(".planning-routing-disclosure-chevron");
    // The outer <details> control's own box, not <summary>'s: closed,
    // <summary> itself carries the border/padding that makes it read as a
    // card header; open, that border/padding relocates onto the outer
    // <details> instead (so the revealed content gets a frame) while
    // <summary>'s own shrinks to 0 — <summary>'s own bounding box
    // therefore legitimately relocates inward between states even though
    // the rendered header content does not move, so the card's overall
    // position must be measured on <details>, not <summary>.
    const changeDetails = changeLabel.locator("xpath=ancestor::details");
    await disclosureSummary.scrollIntoViewIfNeeded();

    const [summaryClosedBox, changeDetailsClosedBox, valueClosedBox, actionClosedBox] =
      await Promise.all([
        disclosureSummary.boundingBox(),
        changeDetails.boundingBox(),
        routingValue.boundingBox(),
        actionRow.boundingBox(),
      ]);
    if (
      !summaryClosedBox ||
      !changeDetailsClosedBox ||
      !valueClosedBox ||
      !actionClosedBox
    ) {
      throw new Error("expected the routing-disclosure header controls to have a box");
    }

    // The whole <summary> is the tappable header, not just the word
    // "Change" — a real ≥44x44px touch target (backlog item 48's own
    // requirement, restated here since <summary> now carries far more
    // content than a single closed label).
    expect(summaryClosedBox.width).toBeGreaterThanOrEqual(44);
    expect(summaryClosedBox.height).toBeGreaterThanOrEqual(44);

    // The routing value sits above "Change" within the header, neither
    // overlaps the other, and both stay inside the bordered <details>
    // card — a hierarchy proof, not (any more) an exact-button-height
    // match, which this follow-up deliberately supersedes.
    expect(valueClosedBox.y).toBeLessThan(actionClosedBox.y);
    expect(intersects(valueClosedBox, actionClosedBox)).toBe(false);
    expect(isFullyWithin(valueClosedBox, changeDetailsClosedBox)).toBe(true);
    expect(isFullyWithin(actionClosedBox, changeDetailsClosedBox)).toBe(true);

    // "Change" must read as secondary, not dominant: strictly smaller and
    // no heavier than the routing value it sits beneath — Vitest's
    // css:false environment cannot see computed font-size/font-weight at
    // all.
    const [valueFontSize, valueFontWeight, changeFontSize, changeFontWeight] =
      await Promise.all([
        routingValue.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
        routingValue.evaluate((el) =>
          Number.parseInt(getComputedStyle(el).fontWeight, 10),
        ),
        changeLabel.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
        changeLabel.evaluate((el) =>
          Number.parseInt(getComputedStyle(el).fontWeight, 10),
        ),
      ]);
    expect(changeFontSize).toBeLessThan(valueFontSize);
    expect(changeFontWeight).toBeLessThanOrEqual(valueFontWeight);

    const closedChevronTransform = await chevron.evaluate(
      (el) => getComputedStyle(el).transform,
    );

    // The entire header is tappable, not just the word "Change" or the
    // chevron — clicking the routing-value text itself must open it too.
    await routingValue.click();
    const draftRoadBike = page.getByRole("button", { name: "Road bike", exact: true });
    const draftGeneralCycling = page.getByRole("button", {
      name: "General cycling",
      exact: true,
    });
    const draftFerriesCheckbox = page.getByRole("checkbox", {
      name: "Avoid ferries for this draft",
    });
    for (const control of [draftRoadBike, draftGeneralCycling, draftFerriesCheckbox]) {
      const box = await control.boundingBox();
      if (!box) throw new Error("expected the current-draft control to have a box");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // The chevron communicates open/closed via a real shape change (never
    // colour alone), and the routing value stays visible in the same
    // header while open — there is exactly one copy of it, and of
    // "Change", anywhere on screen (no separate paragraph left outside
    // the disclosure, and no duplicate inside the revealed content).
    const openChevronTransform = await chevron.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(openChevronTransform).not.toBe(closedChevronTransform);
    await expect(routingValue).toBeVisible();
    await expect(page.getByText(/^routing:/i)).toHaveCount(1);
    await expect(page.getByText("Change", { exact: true })).toHaveCount(1);

    // Opening the header must not shift the outer disclosure card
    // horizontally or resize it, since its revealed content is much wider
    // than its closed header (backlog item 48).
    const [changeDetailsOpenBox, routingValueOpenBox] = await Promise.all([
      changeDetails.boundingBox(),
      routingValue.boundingBox(),
    ]);
    if (!changeDetailsOpenBox || !routingValueOpenBox) {
      throw new Error("expected the routing-disclosure controls to have a box");
    }
    expect(
      Math.abs(changeDetailsOpenBox.x - changeDetailsClosedBox.x),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(changeDetailsOpenBox.width - changeDetailsClosedBox.width),
    ).toBeLessThanOrEqual(1);
    expect(isFullyWithin(routingValueOpenBox, changeDetailsOpenBox)).toBe(true);

    const openScrollWidths = await readScrollWidths();
    expect(openScrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(openScrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    // Closing it again restores the exact original geometry — the card
    // only ever grew downward, never sideways.
    await routingValue.click();
    const [changeDetailsReclosedBox, summaryReclosedBox] = await Promise.all([
      changeDetails.boundingBox(),
      disclosureSummary.boundingBox(),
    ]);
    if (!changeDetailsReclosedBox || !summaryReclosedBox) {
      throw new Error("expected the routing-disclosure controls to have a box");
    }
    expect(
      Math.abs(summaryReclosedBox.height - summaryClosedBox.height),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(changeDetailsReclosedBox.x - changeDetailsClosedBox.x),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(changeDetailsReclosedBox.width - changeDetailsClosedBox.width),
    ).toBeLessThanOrEqual(1);

    const reclosedScrollWidths = await readScrollWidths();
    expect(reclosedScrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(reclosedScrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    // A longer state (General cycling · Ferries allowed) must remain just
    // as usable: still no overlap between the value and the action row,
    // still fully contained within the card, still no overflow.
    await routingValue.click();
    await draftGeneralCycling.click();
    await draftFerriesCheckbox.click();
    await expect(
      page.getByText("Routing: General cycling · Ferries allowed", { exact: true }),
    ).toBeVisible();

    const [longerValueBox, longerActionBox, longerDetailsBox] = await Promise.all([
      routingValue.boundingBox(),
      actionRow.boundingBox(),
      changeDetails.boundingBox(),
    ]);
    if (!longerValueBox || !longerActionBox || !longerDetailsBox) {
      throw new Error(
        "expected the longer-state routing-disclosure controls to have a box",
      );
    }
    expect(intersects(longerValueBox, longerActionBox)).toBe(false);
    expect(isFullyWithin(longerValueBox, longerDetailsBox)).toBe(true);
    expect(isFullyWithin(longerActionBox, longerDetailsBox)).toBe(true);

    const longerScrollWidths = await readScrollWidths();
    expect(longerScrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(longerScrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  // CLAUDE.md item 34: a real, confirmed field bug on the deployed iPhone
  // PWA — a selected, double-digit final waypoint row's Delete button
  // could wrap onto its own second line, while similar unselected rows
  // stayed on one line. .waypoint-row-main's fix (a CSS grid instead of
  // flex-wrap, in index.css) cannot be observed in Vitest's css: false
  // environment, so this is the sole proof that Delete never wraps, at
  // the ordinals that actually exposed the defect. Places 12 waypoints via
  // direct map taps — this never contacts OpenRouteService, since
  // Calculate route is a separate, explicit action — at positions clear of
  // the top-right Locate-me/north-up control column
  // (.planning-map-controls, top:8px right:8px, ~48px wide) and the
  // top-left Zoom in/out column (.planning-map-zoom-controls, top:8px
  // left:8px, ~48px wide — backlog item 52) so every tap reliably lands on
  // the map itself, not a control.
  test("phone layout: a double-digit waypoint count keeps Delete on the same row as Select/Move, unselected and selected, with no horizontal overflow", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const readScrollWidths = () =>
      page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }));

    const initialScrollWidths = await readScrollWidths();
    expect(initialScrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(initialScrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    const mapContainer = page.locator('[data-testid="map-container"]');
    await expect(mapContainer.locator("canvas")).toBeVisible();

    const TAP_X_POSITIONS = [70, 110, 180, 250];
    const TAP_Y_POSITIONS = [60, 110, 160];
    let waypointCount = 0;
    for (const y of TAP_Y_POSITIONS) {
      for (const x of TAP_X_POSITIONS) {
        await mapContainer.click({ position: { x, y } });
        waypointCount += 1;
        const label = waypointCount === 1 ? "Start" : `Waypoint ${String(waypointCount)}`;
        await expect(
          page.getByRole("button", { name: label, exact: true }),
        ).toBeVisible();
      }
    }
    expect(waypointCount).toBe(12);

    function rowMainByLabel(label: string): Locator {
      return page
        .locator(".waypoint-row-main")
        .filter({ has: page.getByRole("button", { name: label, exact: true }) });
    }

    // A genuine single-row geometry proof, not an inference from
    // visibility: if Delete had wrapped onto its own line, the wrapper's
    // own height would be roughly double a single control's height, and
    // Delete's vertical centre would sit well below Select/Move's.
    async function assertSingleRowGeometry(label: string): Promise<Box> {
      const rowMain = rowMainByLabel(label);
      const selectButton = page.getByRole("button", { name: label, exact: true });
      const moveUpButton = page.getByRole("button", { name: `Move ${label} up` });
      const moveDownButton = page.getByRole("button", { name: `Move ${label} down` });
      const deleteButton = page.getByRole("button", { name: `Delete ${label}` });

      const [rowBox, selectBox, moveUpBox, moveDownBox, deleteBox] = await Promise.all([
        rowMain.boundingBox(),
        selectButton.boundingBox(),
        moveUpButton.boundingBox(),
        moveDownButton.boundingBox(),
        deleteButton.boundingBox(),
      ]);
      if (!rowBox || !selectBox || !moveUpBox || !moveDownBox || !deleteBox) {
        throw new Error(
          `expected every control in the ${label} row to have a bounding box`,
        );
      }

      const tallestChild = Math.max(selectBox.height, moveUpBox.height, deleteBox.height);
      expect(rowBox.height).toBeLessThanOrEqual(tallestChild + 4);

      const selectCentreY = selectBox.y + selectBox.height / 2;
      const moveUpCentreY = moveUpBox.y + moveUpBox.height / 2;
      const deleteCentreY = deleteBox.y + deleteBox.height / 2;
      expect(Math.abs(moveUpCentreY - selectCentreY)).toBeLessThan(6);
      expect(Math.abs(deleteCentreY - selectCentreY)).toBeLessThan(6);

      // Every control meets the 44x44 CSS-pixel touch-target minimum,
      // including a disabled Move up/down button.
      for (const box of [selectBox, moveUpBox, moveDownBox, deleteBox]) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }

      return rowBox;
    }

    // Unselected double-digit row.
    await assertSingleRowGeometry("Waypoint 10");

    // The final double-digit row, selected — the exact scenario that
    // showed the bug on the deployed iPhone PWA (a selected row's bolder,
    // wider label most easily crossed the old flex-wrap threshold).
    await page.getByRole("button", { name: "Waypoint 12", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Waypoint 12", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const selectedRowBox = await assertSingleRowGeometry("Waypoint 12");

    // The relocate group (Move/Insert after) sits below the main row and
    // does not change the main row's own geometry.
    const relocateBox = await page
      .getByRole("group", { name: "Waypoint 12 actions" })
      .boundingBox();
    if (!relocateBox)
      throw new Error("expected the relocate group to have a bounding box");
    expect(relocateBox.y).toBeGreaterThanOrEqual(
      selectedRowBox.y + selectedRowBox.height - 2,
    );

    const finalScrollWidths = await readScrollWidths();
    expect(finalScrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(finalScrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  // Corrective follow-up to item 34: the 3-column .waypoint-row-main grid
  // (above) proved Delete never wraps, but real iPhone testing after that
  // fix found a second, narrower defect the 12-waypoint fixture above
  // never exercised — inside column 1 (.waypoint-row-select), "Waypoint
  // 10"'s own label wrapped onto two lines specifically when ordinal 10
  // was an endpoint badge (white .waypoint-row-ordinal--finish or green
  // --start-finish, border: 3px solid) but not as an ordinary intermediate
  // waypoint (border: 2px solid). This test proves all three roles ordinal
  // 10 can hold stay single-line: closed-loop start-finish (via Return to
  // start), open-route finish (a genuinely new 10th waypoint after Undo),
  // and ordinary (once an 11th waypoint bumps it inward) — plus that the
  // label's own left edge lands at the same x position regardless of role,
  // proving the fixed badge slot. Never contacts OpenRouteService: map
  // taps, Return to start and Undo are all local waypointHistoryReducer
  // operations, and Calculate route is never clicked.
  test("phone layout: ordinal 10's label stays single-line as start-finish, finish and ordinary badge roles", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    await expect(mapContainer.locator("canvas")).toBeVisible();

    // 9 distinct waypoints via direct map taps — a subset of the item-34
    // test's own proven-safe tap grid, clear of .planning-map-controls
    // (top:8px right:8px, ~48px wide) and .planning-map-zoom-controls
    // (top:8px left:8px, ~48px wide — backlog item 52).
    const TAP_X_POSITIONS = [70, 110, 180];
    const TAP_Y_POSITIONS = [60, 110, 160];
    let waypointCount = 0;
    for (const y of TAP_Y_POSITIONS) {
      for (const x of TAP_X_POSITIONS) {
        await mapContainer.click({ position: { x, y } });
        waypointCount += 1;
        const label = waypointCount === 1 ? "Start" : `Waypoint ${String(waypointCount)}`;
        await expect(
          page.getByRole("button", { name: label, exact: true }),
        ).toBeVisible();
      }
    }
    expect(waypointCount).toBe(9);

    async function assertOrdinalTenRoleClass(
      role: "start-finish" | "finish" | "ordinary",
    ): Promise<void> {
      const badge = page
        .getByRole("button", { name: "Waypoint 10", exact: true })
        .locator(".waypoint-row-ordinal");
      if (role === "ordinary") {
        await expect(badge).toHaveClass("waypoint-row-ordinal");
      } else {
        await expect(badge).toHaveClass(new RegExp(`waypoint-row-ordinal--${role}`));
      }
    }

    // Single-line + containment + same-vertical-band + touch-target proof
    // for "Waypoint 10", mirroring the item-34 test's own
    // assertSingleRowGeometry above — duplicated locally rather than
    // shared, per this file's established precedent (see isFullyWithin's
    // own comment). Returns .waypoint-row-label's own left edge (x),
    // collected by the caller to prove the badge-slot-centred requirement
    // across all three role states.
    async function assertOrdinalTenSingleLine(): Promise<number> {
      const rowName = "Waypoint 10";
      const rowMain = page
        .locator(".waypoint-row-main")
        .filter({ has: page.getByRole("button", { name: rowName, exact: true }) });
      const selectButton = page.getByRole("button", { name: rowName, exact: true });
      const label = selectButton.locator(".waypoint-row-label");
      const startLabel = page
        .getByRole("button", { name: "Start", exact: true })
        .locator(".waypoint-row-label");
      const moveUpButton = page.getByRole("button", { name: `Move ${rowName} up` });
      const moveDownButton = page.getByRole("button", { name: `Move ${rowName} down` });
      const deleteButton = page.getByRole("button", { name: `Delete ${rowName}` });

      const [
        rowBox,
        selectBox,
        labelBox,
        startLabelBox,
        moveUpBox,
        moveDownBox,
        deleteBox,
      ] = await Promise.all([
        rowMain.boundingBox(),
        selectButton.boundingBox(),
        label.boundingBox(),
        startLabel.boundingBox(),
        moveUpButton.boundingBox(),
        moveDownButton.boundingBox(),
        deleteButton.boundingBox(),
      ]);
      if (
        !rowBox ||
        !selectBox ||
        !labelBox ||
        !startLabelBox ||
        !moveUpBox ||
        !moveDownBox ||
        !deleteBox
      ) {
        throw new Error(
          `expected every control in the ${rowName} row (and Start's own label) to have a bounding box`,
        );
      }

      // Single-line proof without a hardcoded pixel constant: a genuine
      // 2-line wrap would be roughly double a known-single-line label's
      // own height ("Start", guaranteed short).
      expect(Math.abs(labelBox.height - startLabelBox.height)).toBeLessThan(4);

      // The label never extends outside its own button.
      expect(isFullyWithin(labelBox, selectBox)).toBe(true);

      // Select/Move/Delete stay in the same vertical band, mirroring the
      // item-34 test's own assertSingleRowGeometry tolerances exactly.
      const tallestChild = Math.max(selectBox.height, moveUpBox.height, deleteBox.height);
      expect(rowBox.height).toBeLessThanOrEqual(tallestChild + 4);
      const selectCentreY = selectBox.y + selectBox.height / 2;
      const moveUpCentreY = moveUpBox.y + moveUpBox.height / 2;
      const deleteCentreY = deleteBox.y + deleteBox.height / 2;
      expect(Math.abs(moveUpCentreY - selectCentreY)).toBeLessThan(6);
      expect(Math.abs(deleteCentreY - selectCentreY)).toBeLessThan(6);

      // Every control meets the 44x44 CSS-pixel touch-target minimum.
      for (const box of [selectBox, moveUpBox, moveDownBox, deleteBox]) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }

      return labelBox.x;
    }

    const labelLeftXByRole: number[] = [];

    // State A: closed loop — appends waypoint 10 as a coordinate duplicate
    // of waypoint 1 (waypointHistory.ts's returnToStart), making both ends
    // "start-finish" (green, border: 3px solid, 40% radius).
    const returnToStartButton = page.getByRole("button", { name: "Return to start" });
    await expect(returnToStartButton).toBeEnabled();
    await returnToStartButton.click();
    await expect(
      page.getByRole("button", { name: "Waypoint 10", exact: true }),
    ).toBeVisible();
    await assertOrdinalTenRoleClass("start-finish");
    labelLeftXByRole.push(await assertOrdinalTenSingleLine());

    // Undo removes the return-to-start waypoint, restoring exactly the
    // prior 9-waypoint present array (waypointHistoryReducer's own "undo"
    // case).
    const undoButton = page.getByRole("button", { name: "Undo" });
    await expect(undoButton).toBeEnabled();
    await undoButton.click();
    await expect(
      page.getByRole("button", { name: "Waypoint 10", exact: true }),
    ).toHaveCount(0);

    // State B: a genuinely new 10th waypoint, at a map position distinct
    // from waypoint 1's own coordinate — open route, so ordinal 10 becomes
    // the white "finish" role.
    await mapContainer.click({ position: { x: 250, y: 60 } });
    await expect(
      page.getByRole("button", { name: "Waypoint 10", exact: true }),
    ).toBeVisible();
    await assertOrdinalTenRoleClass("finish");
    labelLeftXByRole.push(await assertOrdinalTenSingleLine());

    // State C: an 11th waypoint bumps ordinal 10 back to an ordinary,
    // intermediate orange badge (ordinal 11 becomes the new finish).
    await mapContainer.click({ position: { x: 250, y: 110 } });
    await expect(
      page.getByRole("button", { name: "Waypoint 11", exact: true }),
    ).toBeVisible();
    await assertOrdinalTenRoleClass("ordinary");
    labelLeftXByRole.push(await assertOrdinalTenSingleLine());

    // Badge-slot-centred proof: the label begins at the same x position
    // across all three badge roles, regardless of border-width (2px vs
    // 3px) or badge shape/colour.
    expect(Math.max(...labelLeftXByRole) - Math.min(...labelLeftXByRole)).toBeLessThan(2);

    const scrollWidths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(scrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(scrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  // Visual slice 5 (corrective) + deterministic-precondition hardening
  // (future-backlog item 21): the same manual-rotation contract as the
  // desktop "pressing Northwards twice" test above, proven again at this
  // narrower height/width — Planning's own .planning-map-container height
  // is viewport-relative (44dvh), so a rotation regression could plausibly
  // reproduce at one width and not another. Reuses this describe block's
  // own 390×844 viewport rather than declaring a second one, and the same
  // MapLibre KeyboardHandler precondition mechanism as the desktop test
  // (see its comments for the full rationale) rather than a synthetic
  // pointer drag — this test's own distinguishing purpose stays the
  // layout/overflow assertions at the end, not re-proving the centre/
  // zoom-preservation numeric check the desktop test already covers.
  test("pressing Northwards twice on a phone viewport, with a manual rotation in between, rotates back to north both times without layout overflow", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    const mapWrapper = page.locator(".planning-map-container");
    const canvas = mapContainer.locator("canvas");
    const northButton = page.getByRole("button", { name: "North-up, top-down view" });
    const locateButton = page.getByRole("button", { name: "Locate me" });

    await northButton.click();
    await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");
    await expect(mapContainer).toHaveAttribute("data-camera-pitch", "0");
    await expect(northButton).toHaveAttribute("aria-pressed", "true");

    await expect(canvas).toBeVisible();

    // Same deterministic MapLibre KeyboardHandler mechanism as the desktop
    // "pressing Northwards twice" test above — see its comments for the
    // full mechanism/root-cause-elimination rationale. Never a shortcut
    // that sets the diagnostic attributes directly.
    await canvas.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect
      .poll(() => mapContainer.getAttribute("data-camera-bearing"))
      .not.toBe("0");
    await page.keyboard.press("Shift+ArrowUp");
    await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).not.toBe("0");
    await expect(northButton).toHaveAttribute("aria-pressed", "false");

    await northButton.click();
    await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");
    await expect(mapContainer).toHaveAttribute("data-camera-pitch", "0");
    await expect(northButton).toHaveAttribute("aria-pressed", "true");

    const scrollWidths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(scrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(scrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    const [wrapperBox, northUpBox, locateBox] = await Promise.all([
      mapWrapper.boundingBox(),
      northButton.boundingBox(),
      locateButton.boundingBox(),
    ]);
    if (!wrapperBox || !northUpBox || !locateBox) {
      throw new Error("expected the map wrapper and its controls to have a bounding box");
    }
    expect(isFullyWithin(northUpBox, wrapperBox)).toBe(true);
    expect(isFullyWithin(locateBox, wrapperBox)).toBe(true);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  // Future-backlog item 17: the waypoint list's ordinal badge must
  // visually communicate the same start/ordinary/finish/loop role as the
  // map's own marker for that waypoint (see WaypointList.tsx's
  // waypointRoles prop, sourced from planningLayer.ts's
  // deriveWaypointRoles — the same derivation buildWaypointMarkerSpecs
  // uses for the map). Colour, border-width and border-radius are all
  // compared as literal computed-style equality — both surfaces share the
  // exact same hardcoded hex/px/percentage literals, and this Chromium
  // build's getComputedStyle leaves a percentage border-radius
  // unresolved (returns "50%"/"40%" as specified, not a pixel value), so
  // comparing the literal strings directly is both correct and simpler
  // than normalising against each element's differing absolute box size
  // (badge 24px vs marker 26px+).
  test("waypoint list badges visually match the map's own start/ordinary/finish/loop marker roles", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 80, y: 80 } });
    await mapContainer.click({ position: { x: 180, y: 120 } });
    await mapContainer.click({ position: { x: 280, y: 160 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Waypoint 2", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Waypoint 3", exact: true }),
    ).toBeVisible();

    // This test's own claim (badge visually matches marker) holds only in
    // the map marker's "close" zoom band — see zoomToCloseRange's own doc
    // comment. A fresh session's initial framing zoom is not guaranteed to
    // already be in that band.
    await zoomToCloseRange(page, mapContainer);

    // borderTopLeftRadius is compared as its own literal computed-style
    // string (e.g. "50%"/"40%"), not resolved against each element's own
    // pixel width — this Chromium build's getComputedStyle leaves a
    // percentage border-radius unresolved, so dividing by the badge's
    // (24px) and marker's (26px+) differing absolute widths would produce
    // different ratios even for two elements sharing the exact same CSS
    // rule. Literal string equality is both correct and simpler here,
    // since badge and marker are styled from the same hardcoded literals.
    const readVisualStyle = (locator: Locator) =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderTopWidth: style.borderTopWidth,
          borderRadius: style.borderTopLeftRadius,
        };
      });

    // Open route: Start / ordinary / Finish, each row's badge compared
    // against its own corresponding map marker.
    const openRouteRoles: { rowName: string; markerLabel: string }[] = [
      { rowName: "Start", markerLabel: "Start waypoint 1" },
      { rowName: "Waypoint 2", markerLabel: "Waypoint 2" },
      { rowName: "Waypoint 3", markerLabel: "Finish waypoint 3" },
    ];
    for (const { rowName, markerLabel } of openRouteRoles) {
      const badge = page
        .getByRole("button", { name: rowName, exact: true })
        .locator(".waypoint-row-ordinal");
      const marker = page.getByRole("img", { name: markerLabel });
      await expect(badge).toBeVisible();
      await expect(marker).toBeVisible();
      const [badgeStyle, markerStyle] = await Promise.all([
        readVisualStyle(badge),
        readVisualStyle(marker),
      ]);
      expect(badgeStyle.backgroundColor).toBe(markerStyle.backgroundColor);
      expect(badgeStyle.borderTopWidth).toBe(markerStyle.borderTopWidth);
      expect(badgeStyle.borderRadius).toBe(markerStyle.borderRadius);
    }

    // Close the loop — appends a 4th waypoint at the same coordinate as
    // the first (see waypointHistory.ts's returnToStart reducer case).
    const returnToStartButton = page.getByRole("button", { name: "Return to start" });
    await expect(returnToStartButton).toBeEnabled();
    await returnToStartButton.click();
    await expect(
      page.getByRole("button", { name: "Waypoint 4", exact: true }),
    ).toBeVisible();

    const loopMarker = page.getByRole("img", {
      name: "Start and finish waypoints 1 and 4",
    });
    await expect(loopMarker).toBeVisible();
    const loopMarkerStyle = await readVisualStyle(loopMarker);

    for (const rowName of ["Start", "Waypoint 4"]) {
      const badge = page
        .getByRole("button", { name: rowName, exact: true })
        .locator(".waypoint-row-ordinal");
      await expect(badge).toHaveClass(/waypoint-row-ordinal--start-finish/);
      const badgeStyle = await readVisualStyle(badge);
      expect(badgeStyle.backgroundColor).toBe(loopMarkerStyle.backgroundColor);
      expect(badgeStyle.borderTopWidth).toBe(loopMarkerStyle.borderTopWidth);
      expect(badgeStyle.borderRadius).toBe(loopMarkerStyle.borderRadius);
    }

    // Each row still shows its own individual ordinal, never the map's
    // combined "1/4" label.
    await expect(
      page
        .getByRole("button", { name: "Start", exact: true })
        .locator(".waypoint-row-ordinal"),
    ).toHaveText("1");
    await expect(
      page
        .getByRole("button", { name: "Waypoint 4", exact: true })
        .locator(".waypoint-row-ordinal"),
    ).toHaveText("4");

    const scrollWidths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(scrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(scrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Backlog item 110 — the north-up control's north-pointing arrow.
//
// This block carries the item's own empirical proof of the bearing sign.
// Nothing in the repository previously asserted the relationship between
// a MapLibre bearing and a screen rotation, so it is established here
// against the real map and real projection rather than assumed from a
// table: two waypoints whose north/south relationship is proved from
// their STORED coordinates, then measured on screen after a rotation.
// ---------------------------------------------------------------------
test.describe("north-pointing orientation indicator (backlog item 110)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** The rotation the arrow is actually painted with, recovered from the
   * composited matrix rather than from the inline style string: the
   * declaration could be present and still be overridden, invalid, or
   * dropped. `matrix(a, b, c, d, e, f)` for a pure rotation has
   * a = cos, b = sin, so atan2(b, a) is the applied angle. */
  async function paintedRotationDegrees(locator: Locator): Promise<number> {
    return locator.evaluate((element) => {
      const { transform } = getComputedStyle(element);
      if (transform === "none") return 0;
      const values = transform
        .slice(transform.indexOf("(") + 1, transform.lastIndexOf(")"))
        .split(",")
        .map((value) => Number.parseFloat(value));
      // matrix(a, b, c, d, e, f): for a pure rotation a = cos, b = sin.
      if (values.length < 2) {
        throw new Error(`could not parse a rotation from "${transform}"`);
      }
      return (Math.atan2(values[1], values[0]) * 180) / Math.PI;
    });
  }

  /** The union of everything the control actually paints, in page
   * coordinates. Child SVG elements report their painted geometry through
   * getBoundingClientRect, ancestor transforms included — which is what
   * makes this meaningful for a rotated glyph, where the <svg> element's
   * own box is mostly empty space and grows with the angle. */
  async function paintedInkExtent(button: Locator): Promise<Box> {
    return button.evaluate((element) => {
      const rects = [...element.querySelectorAll("path, circle")].map((shape) =>
        shape.getBoundingClientRect(),
      );
      if (rects.length === 0) {
        throw new Error("expected the control to paint at least one shape");
      }
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      return {
        x: left,
        y: top,
        width: Math.max(...rects.map((r) => r.right)) - left,
        height: Math.max(...rects.map((r) => r.bottom)) - top,
      };
    });
  }

  /** The shortest signed distance between two angles, so 359 and -1
   * compare as one degree apart rather than 360. */
  function angularDifferenceDegrees(a: number, b: number): number {
    return Math.abs((((a - b + 180) % 360) + 360) % 360) - 180;
  }

  async function readStoredWaypoints(
    page: Page,
  ): Promise<{ longitude: number; latitude: number }[]> {
    return page.evaluate(
      () =>
        new Promise<{ longitude: number; latitude: number }[]>((resolve, reject) => {
          const openRequest = indexedDB.open("amazing-cycling-navigation");
          openRequest.onerror = () => {
            reject(new Error("could not open the application database"));
          };
          openRequest.onsuccess = () => {
            const database = openRequest.result;
            const store = database
              .transaction("planningDrafts", "readonly")
              .objectStore("planningDrafts");
            const getRequest = store.get("draft");
            getRequest.onsuccess = () => {
              const row = getRequest.result as
                { waypoints?: { coordinate: [number, number] }[] } | undefined;
              database.close();
              resolve(
                (row?.waypoints ?? []).map((waypoint) => ({
                  longitude: waypoint.coordinate[0],
                  latitude: waypoint.coordinate[1],
                })),
              );
            };
            getRequest.onerror = () => {
              database.close();
              reject(new Error("could not read the planning draft"));
            };
          };
        }),
    );
  }

  async function openPlanning(page: Page) {
    await page.goto("/");
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    const mapContainer = page.locator('[data-testid="map-container"]');
    const northUpButton = page.getByRole("button", {
      name: "North-up, top-down view",
    });
    await expect(northUpButton).toBeVisible();
    return { mapContainer, northUpButton, arrow: northUpButton.locator("svg") };
  }

  /** Rotates via MapLibre's own built-in KeyboardHandler, exactly as this
   * file's existing establishManualRotationAndPitch does — a genuine
   * trusted gesture through the map's ordinary ease pipeline, and never
   * the CI-flaky DragRotateHandler (future-backlog item 21). */
  async function rotateBy(
    page: Page,
    mapContainer: Locator,
    presses: number,
  ): Promise<number> {
    const canvas = mapContainer.locator("canvas");
    await canvas.focus();
    for (let press = 0; press < presses; press++) {
      const before = await mapContainer.getAttribute("data-camera-bearing");
      await page.keyboard.press("Shift+ArrowRight");
      await expect
        .poll(() => mapContainer.getAttribute("data-camera-bearing"))
        .not.toBe(before);
    }
    const settled = await mapContainer.getAttribute("data-camera-bearing");
    return Number.parseFloat(settled ?? "0");
  }

  test("the arrow points at geographic north, proved against the map's own projection", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
    const { mapContainer, arrow } = await openPlanning(page);

    // Waypoint 1 at the settled centre, then pan up the screen and place
    // waypoint 2. Panning "up" is NOT taken as evidence of anything: the
    // north/south relationship is asserted from the stored coordinates
    // below.
    const addWaypoint = page.getByRole("button", { name: "Add waypoint here" });
    await expect(addWaypoint).toBeEnabled();
    await addWaypoint.click();
    await expect(page.locator(".planning-waypoint-marker")).toHaveCount(1);

    const canvas = mapContainer.locator("canvas");
    await canvas.focus();
    const centreBefore = await mapContainer.getAttribute("data-camera-center");
    await page.keyboard.press("ArrowUp");
    await expect
      .poll(() => mapContainer.getAttribute("data-camera-center"))
      .not.toBe(centreBefore);
    await expect(addWaypoint).toBeEnabled();
    await addWaypoint.click();
    await expect(page.locator(".planning-waypoint-marker")).toHaveCount(2);

    // The premise, asserted rather than assumed.
    const waypoints = await expect
      .poll(async () => await readStoredWaypoints(page))
      .toHaveLength(2)
      .then(() => readStoredWaypoints(page));
    if (waypoints.length !== 2) {
      throw new Error("expected exactly two waypoints to have been stored");
    }
    const south = waypoints[0];
    const north = waypoints[1];
    expect(north.latitude).toBeGreaterThan(south.latitude);
    expect(Math.abs(north.longitude - south.longitude)).toBeLessThan(1e-6);

    // With the map north-up, the northern waypoint paints above the
    // southern one and the arrow points up.
    const markers = page.locator(".planning-waypoint-marker");
    const upBoxes = await Promise.all([
      markers.nth(0).boundingBox(),
      markers.nth(1).boundingBox(),
    ]);
    const [southUp, northUp] = upBoxes;
    if (!southUp || !northUp) {
      throw new Error("expected both waypoint markers to lay out");
    }
    expect(northUp.y).toBeLessThan(southUp.y);
    expect(await paintedRotationDegrees(arrow)).toBeCloseTo(0, 5);

    // Now rotate to a genuinely non-zero bearing and re-measure. A
    // positive MapLibre bearing means that compass direction is drawn at
    // the top, so north must swing to the LEFT — which is what fixes the
    // transform's sign, empirically.
    const bearing = await rotateBy(page, mapContainer, 6);
    expect(Math.abs(bearing)).toBeGreaterThan(1);

    const rotatedBoxes = await Promise.all([
      markers.nth(0).boundingBox(),
      markers.nth(1).boundingBox(),
    ]);
    const [southRotated, northRotated] = rotatedBoxes;
    if (!southRotated || !northRotated) {
      throw new Error("expected both waypoint markers to lay out after rotation");
    }
    // The item's own recorded convention evidence, printed so the run log
    // carries the measured numbers rather than only a pass.
    console.log(
      `[item-110-convention] bearing=${String(bearing)} ` +
        `northMarker=(${String(Math.round(northRotated.x))},${String(Math.round(northRotated.y))}) ` +
        `southMarker=(${String(Math.round(southRotated.x))},${String(Math.round(southRotated.y))}) ` +
        `arrowRotation=${String(await paintedRotationDegrees(arrow))}`,
    );
    expect(northRotated.x).toBeLessThan(southRotated.x);

    // And the arrow agrees with the map: it is painted at exactly the
    // negation of the settled bearing, which is the direction the two
    // markers just demonstrated geographically.
    const painted = await paintedRotationDegrees(arrow);
    expect(angularDifferenceDegrees(painted, -bearing)).toBeLessThan(1);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("pressing the control returns the map to north-up and the arrow to up", async ({
    page,
  }) => {
    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
    const { mapContainer, northUpButton, arrow } = await openPlanning(page);

    const bearing = await rotateBy(page, mapContainer, 4);
    expect(Math.abs(bearing)).toBeGreaterThan(1);
    expect(Math.abs(await paintedRotationDegrees(arrow))).toBeGreaterThan(1);
    await expect(northUpButton).toHaveAttribute("aria-pressed", "false");

    await northUpButton.click();

    await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");
    await expect(northUpButton).toHaveAttribute("aria-pressed", "true");
    expect(await paintedRotationDegrees(arrow)).toBeCloseTo(0, 5);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });

  test("the control shows a rotating glyph rather than a static N, without moving or resizing the button", async ({
    page,
  }) => {
    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
    const { mapContainer, northUpButton, arrow } = await openPlanning(page);

    // The visual content is a glyph, not the old literal letter.
    await expect(arrow).toBeVisible();
    await expect(northUpButton).toHaveText("");
    await expect(arrow).toHaveAttribute("aria-hidden", "true");
    // The accessible name and toggle semantics are unchanged. A fresh
    // Planning map settles north-up, so the control starts pressed.
    await expect(northUpButton).toHaveAttribute("aria-pressed", "true");

    const buttonBox = await northUpButton.boundingBox();
    const arrowBox = await arrow.boundingBox();
    const mapBox = await mapContainer.boundingBox();
    const locateBox = await page.getByRole("button", { name: "Locate me" }).boundingBox();
    const zoomInBox = await page.getByRole("button", { name: "Zoom in" }).boundingBox();
    const zoomOutBox = await page.getByRole("button", { name: "Zoom out" }).boundingBox();
    if (!buttonBox || !arrowBox || !mapBox || !locateBox || !zoomInBox || !zoomOutBox) {
      throw new Error("expected the control, its glyph and its neighbours to lay out");
    }

    // A real touch target, unchanged by swapping the glyph in. Asserted
    // as the exact 48px the follow-up is required to preserve, not merely
    // as "at least 44": enlarging the control instead of its symbol would
    // satisfy a minimum while breaking the actual contract.
    expect(buttonBox.width).toBe(48);
    expect(buttonBox.height).toBe(48);
    for (const control of [
      page.getByRole("button", { name: "Locate me" }),
      page.getByRole("button", { name: "Zoom in" }),
      page.getByRole("button", { name: "Zoom out" }),
    ]) {
      const box = await control.boundingBox();
      if (!box) throw new Error("expected every Planning map control to lay out");
      expect(box.width).toBe(48);
      expect(box.height).toBe(48);
    }
    expect(isFullyWithin(buttonBox, mapBox)).toBe(true);
    expect(isFullyWithin(arrowBox, buttonBox)).toBe(true);

    // The glyph is centred in its control — the one thing a block-level
    // svg inside a button could plausibly get wrong.
    expect(
      Math.abs(arrowBox.x + arrowBox.width / 2 - (buttonBox.x + buttonBox.width / 2)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(arrowBox.y + arrowBox.height / 2 - (buttonBox.y + buttonBox.height / 2)),
    ).toBeLessThanOrEqual(1);

    // No collision with the neighbouring map controls.
    expect(intersects(buttonBox, locateBox)).toBe(false);
    expect(intersects(buttonBox, zoomInBox)).toBe(false);
    expect(intersects(buttonBox, zoomOutBox)).toBe(false);

    // Item 110 negative control 5. A 48px circular button is rotationally
    // symmetric, so its box alone cannot tell "the glyph rotated" from
    // "the whole button rotated". Assert both halves.
    await rotateBy(page, mapContainer, 3);
    await expect(northUpButton).toHaveAttribute("aria-pressed", "false");
    expect(Math.abs(await paintedRotationDegrees(arrow))).toBeGreaterThan(1);
    expect(
      await northUpButton.evaluate((element) => getComputedStyle(element).transform),
    ).toBe("none");

    // Rotating the glyph must not have disturbed the control's own box.
    const buttonBoxAfter = await northUpButton.boundingBox();
    if (!buttonBoxAfter) {
      throw new Error("expected the control to still lay out after rotation");
    }
    expect(Math.abs(buttonBoxAfter.width - buttonBox.width)).toBeLessThan(0.5);
    expect(Math.abs(buttonBoxAfter.height - buttonBox.height)).toBeLessThan(0.5);
    expect(Math.abs(buttonBoxAfter.x - buttonBox.x)).toBeLessThan(0.5);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });

  /**
   * The composited colour at a set of offsets from the control's centre,
   * read back from a real screenshot of the button.
   *
   * The offsets are deliberately rotation-invariant. Every point within
   * the dart's inradius of the centre lies inside the dart at any bearing,
   * while the upright letter reaches less far on both axes; the probe
   * radius sits between the two, so the axial probes are always pointer
   * and the stems are always letter, at every bearing and with no
   * per-angle bookkeeping. All of it is expressed in viewBox units and
   * scaled by the rendered size, so it holds at any icon size. Sampled at
   * a 3x device scale — the same ratio the installed iPhone renders at —
   * so a one-pixel CSS margin is three real pixels rather than a coin toss
   * against antialiasing.
   */
  async function sampleControlColours(
    button: Locator,
    offsets: readonly (readonly [number, number])[],
  ): Promise<string[]> {
    const shot = (await button.screenshot()).toString("base64");
    return button.evaluate(
      async (element, { pngBase64, points }) => {
        const box = element.getBoundingClientRect();
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => {
            resolve();
          };
          image.onerror = () => {
            reject(new Error("could not decode the control screenshot"));
          };
          image.src = `data:image/png;base64,${pngBase64}`;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(image, 0, 0);
        const scale = image.width / box.width;
        const median = (values: number[]) =>
          [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
        return points.map(([dx, dy]) => {
          const x = Math.round((box.width / 2 + dx) * scale);
          const y = Math.round((box.height / 2 + dy) * scale);
          // The per-channel median of a 3x3 device-pixel block, not a
          // single pixel. At this device scale that block spans a third
          // of a CSS pixel, so it cannot stray onto a neighbouring
          // feature — but it does discard the one antialiased pixel a
          // probe can land on when it sits about a pixel from an edge.
          // A better measurement, not a looser match.
          const red: number[] = [];
          const green: number[] = [];
          const blue: number[] = [];
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const pixel = context.getImageData(x + ox, y + oy, 1, 1).data;
              red.push(pixel[0]);
              green.push(pixel[1]);
              blue.push(pixel[2]);
            }
          }
          return [red, green, blue].map((values) => String(median(values))).join(",");
        });
      },
      { pngBase64: shot, points: offsets.map(([x, y]) => [x, y] as [number, number]) },
    );
  }

  /** The rotation actually composited onto an SVG child, ancestor CSS
   * transforms included. A screen CTM of the form [a 0 0 d] carries no
   * rotation at all, which is the letter's whole contract. */
  async function screenRotationOf(shape: Locator): Promise<{ b: number; c: number }> {
    return shape.evaluate((element) => {
      const matrix = (element as SVGGraphicsElement).getScreenCTM();
      if (!matrix) throw new Error("expected a screen CTM");
      return { b: matrix.b, c: matrix.c };
    });
  }

  /**
   * The probe offsets, in the icon's own viewBox units rather than in
   * pixels.
   *
   * They were pixel constants until the icon grew from 38px to 42px, at
   * which point they silently detuned: the letter's reach grows with the
   * box, so a fixed 4.2px probe that had cleared the letter by 0.79px
   * vertically at 38px clears it by only 0.44px at 42px — about 1.3
   * device pixels at this scale, against an antialiased edge. Expressed
   * as units and multiplied by the svg's *rendered* width below, every
   * margin is preserved in proportion at any size, and these cannot go
   * stale again.
   *
   * PROBE_RADIUS sits between the upright letter's reach (1.89 units
   * across, 2.15 down) and the dart's 3.3425-unit inradius.
   */
  const PROBE_RADIUS_UNITS = 2.6526;

  /** The centre of one of the letter's two vertical stems — 0.95 units
   * wide and full height, so it survives antialiasing at any device
   * scale. Deliberately NOT the glyph's centre, which is its diagonal:
   * the thinnest part of the letter, roughly 0.73 units across, which
   * blends almost entirely into the pointer behind it and would make this
   * probe read the pointer's own colour. */
  const STEM_OFFSET_UNITS = 1.4147;

  const ICON_VIEWBOX_UNITS = 24;

  /** The icon's rendered size, read from the element rather than assumed,
   * so the offsets above convert to pixels at whatever size ships. */
  async function iconPixelsPerUnit(arrow: Locator): Promise<number> {
    const width = await arrow.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    return width / ICON_VIEWBOX_UNITS;
  }

  test.describe("composited letter separation", () => {
    // The installed iPhone renders at 3x; sampling there too means an
    // antialiased edge spans real pixels rather than swallowing the margin.
    test.use({ deviceScaleFactor: 3 });

    test("the north control's letter stays upright and clear of the pointer at every representative bearing, in both colour states", async ({
      page,
    }) => {
      const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
      const { mapContainer, northUpButton } = await openPlanning(page);
      const arrow = northUpButton.locator("svg");
      const letter = northUpButton.locator("svg g path");

      /** Two points always on the letter's ink, then four always on the
       * pointer around it. Both sets are rotation-invariant: the letter
       * is fixed upright, and every point inside the dart's inradius
       * stays inside the dart at any bearing. Scaled from the icon's
       * rendered size, so they hold whatever that size is. */
      const pxPerUnit = await iconPixelsPerUnit(arrow);
      const stemOffsetPx = STEM_OFFSET_UNITS * pxPerUnit;
      const probeRadiusPx = PROBE_RADIUS_UNITS * pxPerUnit;
      const letterProbes = [
        [-stemOffsetPx, 0],
        [stemOffsetPx, 0],
      ] as const;
      const pointerProbes = [
        [-probeRadiusPx, 0],
        [probeRadiusPx, 0],
        [0, -probeRadiusPx],
        [0, probeRadiusPx],
      ] as const;
      const probes = [...letterProbes, ...pointerProbes];

      /** The control's own two token colours, as the browser resolves
       * them. Asserting the samples against THESE, rather than merely
       * against each other, is what makes the probe discriminating: an
       * absent letter would still leave the centre "different from" a
       * surround that had fallen off the pointer altogether. */
      async function expectedColours(): Promise<{ pointer: string; letter: string }> {
        return northUpButton.evaluate((element) => {
          const style = getComputedStyle(element);
          const toTriple = (value: string) => {
            const parts = /(\d+),\s*(\d+),\s*(\d+)/.exec(value);
            if (!parts) throw new Error(`unparsed colour ${value}`);
            return `${parts[1]},${parts[2]},${parts[3]}`;
          };
          // The pointer is filled with currentColor; the letter is filled
          // with whatever the button paints behind it.
          return {
            pointer: toTriple(style.color),
            letter: toTriple(style.backgroundColor),
          };
        });
      }

      /**
       * A sample must read decisively as one of the control's two
       * colours rather than the other.
       *
       * Stated as a ratio rather than an absolute tolerance on purpose.
       * The letter clears the pointer's edge by about a pixel — that is
       * the whole design, and it is what the 360-degree geometry sweep
       * proves exactly — so a probe placed to be safely inside the
       * pointer still catches part of an antialiased edge ramp. An
       * absolute threshold would then be measuring the browser's
       * antialiasing rather than the separation. This measures the
       * separation itself, and stays brutally discriminating: the two
       * colours are 239 levels apart, so a letter that vanished, rotated
       * away or lost its inverse fill reads as the wrong colour by an
       * enormous margin.
       */
      function expectReadsAs(
        actual: string,
        expected: string,
        other: string,
        what: string,
      ): void {
        const distance = (a: string, b: string) => {
          const left = a.split(",").map(Number);
          const right = b.split(",").map(Number);
          return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
        };
        const toExpected = distance(actual, expected);
        const toOther = distance(actual, other);
        expect(
          toOther,
          `${what}: sampled ${actual}, which is nearer ${other} than ${expected}`,
        ).toBeGreaterThan(toExpected * 2);
      }

      // Pressed state first: a fresh Planning map settles north-up, so the
      // control is pressed and paints its accent letter on a white pointer.
      await expect(northUpButton).toHaveAttribute("aria-pressed", "true");
      const pressedColours = await expectedColours();
      const pressedSamples = await sampleControlColours(northUpButton, probes);
      for (const sample of pressedSamples.slice(0, letterProbes.length)) {
        expectReadsAs(
          sample,
          pressedColours.letter,
          pressedColours.pointer,
          "pressed letter",
        );
      }
      for (const sample of pressedSamples.slice(letterProbes.length)) {
        expectReadsAs(
          sample,
          pressedColours.pointer,
          pressedColours.letter,
          "pressed pointer",
        );
      }
      expect(pressedColours.letter).not.toBe(pressedColours.pointer);

      // Then a sweep of representative bearings in the idle state.
      for (let press = 1; press <= 12; press++) {
        await rotateBy(page, mapContainer, 1);
        const bearing = Number.parseFloat(
          (await mapContainer.getAttribute("data-camera-bearing")) ?? "0",
        );
        if (bearing === 0) continue;

        // Upright: no rotation survives onto the letter, however far the
        // pointer has turned.
        const { b, c } = await screenRotationOf(letter);
        expect(Math.abs(b), `letter rotated at ${String(bearing)}deg`).toBeLessThan(
          0.001,
        );
        expect(Math.abs(c), `letter rotated at ${String(bearing)}deg`).toBeLessThan(
          0.001,
        );

        // And still legibly separated: the letter reads as the letter
        // colour, and every point a pixel beyond it reads as the pointer.
        const idle = await expectedColours();
        const samples = await sampleControlColours(northUpButton, probes);
        for (const sample of samples.slice(0, letterProbes.length)) {
          expectReadsAs(
            sample,
            idle.letter,
            idle.pointer,
            `letter at ${String(bearing)}deg`,
          );
        }
        for (const sample of samples.slice(letterProbes.length)) {
          expectReadsAs(
            sample,
            idle.pointer,
            idle.letter,
            `pointer at ${String(bearing)}deg`,
          );
        }
        expect(idle.letter).not.toBe(idle.pointer);
      }

      expect(unexpectedOpenFreeMapRequests).toEqual([]);
    });
  });

  test("the right-hand controls read North-up then Locate me, in the DOM, on screen and to the keyboard", async ({
    page,
  }) => {
    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
    const { northUpButton } = await openPlanning(page);
    const locateButton = page.getByRole("button", { name: "Locate me" });
    await expect(locateButton).toBeVisible();

    // 1. DOM order — the markup itself, not a CSS arrangement of it.
    const domLabels = await page
      .locator(".planning-map-controls")
      .evaluate((cluster) =>
        [...cluster.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
      );
    expect(domLabels).toEqual(["North-up, top-down view", "Locate me"]);

    // 2. Visual order — and it must agree with the DOM, which is the
    // whole point. Nothing may reorder them in CSS.
    const northBox = await northUpButton.boundingBox();
    const locateBox = await locateButton.boundingBox();
    if (!northBox || !locateBox) {
      throw new Error("expected both right-hand controls to lay out");
    }
    expect(northBox.y).toBeLessThan(locateBox.y);
    expect(northBox.y + northBox.height).toBeLessThanOrEqual(locateBox.y);
    const cssOrder = await page.locator(".planning-map-controls").evaluate((cluster) => {
      const container = getComputedStyle(cluster);
      return {
        flexDirection: container.flexDirection,
        childOrders: [...cluster.querySelectorAll("button")].map(
          (b) => getComputedStyle(b).order,
        ),
      };
    });
    expect(cssOrder.flexDirection).toBe("column");
    expect(cssOrder.childOrders).toEqual(["0", "0"]);

    // 3. Keyboard order — sequential focus, driven by real Tab presses.
    await northUpButton.focus();
    await expect(northUpButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(locateButton).toBeFocused();

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });

  test("at 200% browser text the control stays contained and adds no horizontal overflow of its own", async ({
    page,
  }) => {
    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
    const { mapContainer, northUpButton, arrow } = await openPlanning(page);

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await rotateBy(page, mapContainer, 3);

    const buttonBox = await northUpButton.boundingBox();
    const mapBox = await mapContainer.boundingBox();
    if (!buttonBox || !mapBox) {
      throw new Error("expected the control to lay out at 200% text");
    }

    // The glyph is sized in px, not em, so enlarged text must not burst
    // the control out of the map or shrink it below a usable target.
    expect(buttonBox.width).toBeGreaterThanOrEqual(44);
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    expect(isFullyWithin(buttonBox, mapBox)).toBe(true);

    // Containment is measured on what the control actually PAINTS, not on
    // the <svg> element's box. Since item 110's follow-up the icon box is
    // larger than the artwork inside it and carries a rotation, so the
    // element's axis-aligned box grows with the angle (a 42px square at
    // 45 degrees measures 59.4px) while the ink never leaves a circle of
    // radius 19.3px about the centre. The element box would therefore
    // report a false overflow; the ink is the real invariant, and this is
    // a stricter check than the one it replaces, not a looser one.
    const ink = await paintedInkExtent(northUpButton);
    expect(isFullyWithin(ink, buttonBox)).toBe(true);
    expect(Math.abs(await paintedRotationDegrees(arrow))).toBeGreaterThan(1);

    // A whole-document scrollWidth check at 200% trips on this app
    // shell's own pre-existing, unrelated primary-navigation overflow —
    // already documented in routeLibraryTags.spec.ts and
    // planningPlacementControlLayering.spec.ts. The honest, load-bearing
    // assertion is that this control contributes nothing to it.
    const overflow = await northUpButton.evaluate((element) => {
      const withControl = document.documentElement.scrollWidth;
      const original = element.style.display;
      element.style.display = "none";
      const withoutControl = document.documentElement.scrollWidth;
      element.style.display = original;
      return { withControl, withoutControl };
    });
    expect(overflow.withControl).toBe(overflow.withoutControl);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });
});
