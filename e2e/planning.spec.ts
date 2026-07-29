import { expect, test } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation), and
// this test needs to mock the ORS endpoint reliably.
test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

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
