import { expect, test } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation), and
// this test needs to mock the ORS endpoint reliably.
test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

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

  // Saving switches straight to Riding mode with the new route.
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

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

test("selecting General cycling routes via the cycling-regular endpoint, not the default cycling-road one", async ({
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

  let capturedUrl: string | null = null;
  await page.route(ORS_URL_GLOB, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      capturedUrl = request.url();
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

  // Road bike is selected by default, before any waypoint is placed.
  const roadBikeButton = page.getByRole("button", { name: "Road bike", exact: true });
  const generalCyclingButton = page.getByRole("button", {
    name: "General cycling",
    exact: true,
  });
  await expect(roadBikeButton).toHaveAttribute("aria-pressed", "true");
  await expect(generalCyclingButton).toHaveAttribute("aria-pressed", "false");

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

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

  expect(capturedUrl).toContain("/directions/cycling-regular/geojson");
  expect(capturedUrl).not.toContain("/directions/cycling-road/geojson");
  await expect(
    summaryRegion.getByText(/General cycling \(cycling-regular\)/),
  ).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
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
  const northButton = page.getByRole("button", { name: "North-up, top-down view" });

  await northButton.click();
  await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");

  const mapBox = await mapContainer.boundingBox();
  if (!mapBox) {
    throw new Error("expected the map container to lay out");
  }
  const centreX = mapBox.x + mapBox.width / 2;
  const centreY = mapBox.y + mapBox.height / 2;

  // MapLibre's default DragRotateHandler binds to a right-button drag
  // (same gesture as distanceBadges.spec.ts/directionArrows.spec.ts).
  await page.mouse.move(centreX, centreY);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(centreX + 150, centreY - 100, { steps: 10 });
  await page.mouse.up({ button: "right" });

  // Proves the drag genuinely rotated the map first — otherwise the second
  // Northwards press below would prove nothing.
  await expect.poll(() => mapContainer.getAttribute("data-camera-bearing")).not.toBe("0");

  await northButton.click();
  await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");

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

  const mapBox = await mapContainer.boundingBox();
  if (!mapBox) {
    throw new Error("expected the map container to lay out");
  }
  const centreX = mapBox.x + mapBox.width / 2;
  const centreY = mapBox.y + mapBox.height / 2;

  // A real diagonal right-button drag rotates and pitches simultaneously
  // (MapLibre's DragRotateHandler drives bearing from the horizontal
  // component and pitch from the vertical one), reaching non-round live
  // values — never ones Locate me could accidentally reproduce.
  await page.mouse.move(centreX, centreY);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(centreX + 120, centreY - 100, { steps: 10 });
  await page.mouse.up({ button: "right" });

  // MapView only republishes data-camera-* once its onCameraSettled handler
  // fires and React re-renders (see MapView.tsx) — reading these attributes
  // immediately after mouse.up can race ahead of that publish and observe a
  // stale pre-gesture value. Poll until both are genuinely away from zero,
  // using a numeric tolerance rather than a string compare, before trusting
  // them as this gesture's settled result. A longer-than-default poll
  // timeout is deliberate here (not a global change — every other
  // assertion in this file keeps Playwright's default): under heavy
  // parallel load, real WebGL settling was observed to occasionally take
  // longer than the default 5 s while still genuinely completing, so this
  // widens the budget for that one observable condition rather than
  // guessing at a fixed delay.
  const AWAY_FROM_ZERO_TOLERANCE_DEGREES = 0.5;
  const CAMERA_SETTLE_POLL_TIMEOUT_MS = 15_000;
  const isAwayFromZero = (value: string | null): boolean => {
    if (value === null) return false;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && Math.abs(parsed) > AWAY_FROM_ZERO_TOLERANCE_DEGREES;
  };
  await expect
    .poll(
      async () => {
        const bearing = await mapContainer.getAttribute("data-camera-bearing");
        const pitch = await mapContainer.getAttribute("data-camera-pitch");
        return isAwayFromZero(bearing) && isAwayFromZero(pitch);
      },
      { timeout: CAMERA_SETTLE_POLL_TIMEOUT_MS },
    )
    .toBe(true);

  const centreBeforePan = await mapContainer.getAttribute("data-camera-center");

  // A left-button pan, moving the centre well away from the GPS fix —
  // deterministic proof (independent of any wheel-zoom pivot behaviour)
  // that the later recentre genuinely has something to correct.
  await page.mouse.move(centreX, centreY);
  await page.mouse.down();
  await page.mouse.move(centreX + 150, centreY + 100, { steps: 10 });
  await page.mouse.up();

  // Same race as above, for the pan: wait for the published centre to
  // genuinely move away from its pre-pan value, and confirm the rotate/
  // pitch gesture's result is still present in that same settled read,
  // before capturing the baseline Locate me must preserve. Same widened,
  // per-assertion poll timeout as above, for the same reason.
  const CENTRE_CHANGE_TOLERANCE_DEGREES = 1e-4; // ~11 m — far above Mercator round-trip noise, comfortably below a real pan
  await expect
    .poll(
      async () => {
        const centre = await mapContainer.getAttribute("data-camera-center");
        const bearing = await mapContainer.getAttribute("data-camera-bearing");
        const pitch = await mapContainer.getAttribute("data-camera-pitch");
        if (!centre || !centreBeforePan) return false;
        const [lon, lat] = centre.split(",").map(Number);
        const [prevLon, prevLat] = centreBeforePan.split(",").map(Number);
        const centreChanged =
          Math.abs(lon - prevLon) > CENTRE_CHANGE_TOLERANCE_DEGREES ||
          Math.abs(lat - prevLat) > CENTRE_CHANGE_TOLERANCE_DEGREES;
        return centreChanged && isAwayFromZero(bearing) && isAwayFromZero(pitch);
      },
      { timeout: CAMERA_SETTLE_POLL_TIMEOUT_MS },
    )
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

    const finalScrollWidths = await readScrollWidths();
    expect(finalScrollWidths.documentWidth).toBeLessThanOrEqual(390);
    expect(finalScrollWidths.bodyWidth).toBeLessThanOrEqual(390);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
