import { expect, test } from "@playwright/test";

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
            values: [
              [0, 4, 6],
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
  expect(consoleErrors).toEqual([]);
});
