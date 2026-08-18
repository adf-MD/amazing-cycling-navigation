import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { forceMapStyleFailure, installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround for ORS mocking, and
// this spec also needs it to reliably block the map tile-style request.
test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/distance-badges-route.gpx", import.meta.url),
);
// Must match the fixture's own start point and longitude spacing (see
// distance-badges-route.gpx) — used to compute a geolocation coordinate
// a given distance along the route without hardcoding a second copy of
// the fixture's geometry.
const FIXTURE_START_LON = -0.5;
const FIXTURE_LAT = 51.5;
const FIXTURE_METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

function lonAtMetresAlongFixture(distanceMetres: number): number {
  return FIXTURE_START_LON + distanceMetres / FIXTURE_METRES_PER_DEGREE_LON;
}

// A same-latitude, ~28km two-point route — long enough that at least the
// coarsest (20km) approved interval still places a badge regardless of
// which zoom band a real fitBounds happens to settle on for the test
// viewport, without hardcoding an assumption about that zoom.
const WEST_COORDINATE = [-0.4, 51.5, 10];
const EAST_COORDINATE = [0.0, 51.5, 10];

function buildMockOrsResponseForCoordinates(coordinates: readonly (readonly number[])[]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: 28_000, duration: 4000 } },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

async function getVisibleBadgeKilometres(page: Page): Promise<number[]> {
  const labels = await page.locator(".distance-badge-marker").allTextContents();
  return labels
    .map((text) => /(\d+)/.exec(text))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

/** Waits until the badge count is non-zero AND unchanged across two
 * consecutive checks — a real map can fire more than one "moveend" in
 * quick succession while it settles (an initial construction-time
 * camera event, then the deliberate fitBounds call), and each one
 * recomputes the badge interval. Reading the count the instant it first
 * becomes non-zero can catch an intermediate, not-yet-final zoom band
 * rather than the one the map actually settles on. */
async function waitForStableBadgeCount(page: Page): Promise<number> {
  let previousCount = -1;
  await expect
    .poll(
      async () => {
        const currentCount = await page.locator(".distance-badge-marker").count();
        const stable = currentCount > 0 && currentCount === previousCount;
        previousCount = currentCount;
        return stable;
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBe(true);
  return page.locator(".distance-badge-marker").count();
}

test.describe("Planning", () => {
  test("shows distance badges only once a route is successfully calculated", async ({
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

    let requestedCoordinates: (readonly number[])[] = [];
    await page.route(ORS_URL_GLOB, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { coordinates: (readonly number[])[] };
        requestedCoordinates = body.coordinates.map((c) => [...c, 10]);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(buildMockOrsResponseForCoordinates(requestedCoordinates)),
      });
    });

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    // x:80 clears .planning-map-zoom-controls (top:8px left:8px, ~48px
    // wide — backlog item 52), which x:60 sat only 4px short of.
    await mapContainer.click({ position: { x: 80, y: 100 } });
    await mapContainer.click({ position: { x: 400, y: 200 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    // No routed geometry yet — only the dashed unrouted preview — so no
    // distance badges must appear.
    expect(await page.locator(".distance-badge-marker").count()).toBe(0);

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    const summaryRegion = page.getByRole("region", { name: "Route summary" });
    await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

    await waitForStableBadgeCount(page);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("updates badges after an edit and recalculation, without a camera jump", async ({
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

    // Body-aware, like planning.spec.ts's own multi-leg test: echoes back
    // whatever coordinates were actually requested, so a later edit's new
    // leg gets a response that genuinely starts/ends where it asked.
    await page.route(ORS_URL_GLOB, async (route) => {
      const request = route.request();
      let responseCoordinates: (readonly number[])[] = [];
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { coordinates: (readonly number[])[] };
        responseCoordinates = body.coordinates.map((c) => [...c, 10]);
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
    // x:80 clears .planning-map-zoom-controls (top:8px left:8px, ~48px
    // wide — backlog item 52), which x:60 sat only 4px short of.
    await mapContainer.click({ position: { x: 80, y: 100 } });
    await mapContainer.click({ position: { x: 400, y: 200 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    const summaryRegion = page.getByRole("region", { name: "Route summary" });
    await expect(summaryRegion).toBeVisible({ timeout: 15_000 });
    await waitForStableBadgeCount(page);

    const cameraCenterBefore = await mapContainer.getAttribute("data-camera-center");

    // The edit: append a third waypoint, extending the route — triggers
    // an automatic debounced recalculation of just the new leg (see
    // CLAUDE.md's Planning slice notes), with no further button click.
    await mapContainer.click({ position: { x: 250, y: 260 } });
    await expect(
      page.getByRole("button", { name: "Waypoint 3", exact: true }),
    ).toBeVisible();

    // The summary text changing proves the recalculation actually
    // completed (distance grew to include the new leg), not just that
    // the click registered.
    const summaryTextBefore = await summaryRegion.innerText();
    await expect
      .poll(async () => (await summaryRegion.innerText()) !== summaryTextBefore, {
        timeout: 15_000,
      })
      .toBe(true);

    await waitForStableBadgeCount(page);

    const cameraCenterAfter = await mapContainer.getAttribute("data-camera-center");
    expect(cameraCenterAfter).toBe(cameraCenterBefore);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Riding", () => {
  test("labels remain absolute from the original start as progress advances, never renumbered", async ({
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
    await context.setGeolocation({ latitude: FIXTURE_LAT, longitude: FIXTURE_START_LON });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);

    const routeButton = page.getByRole("button", {
      name: "distance-badges-route",
      exact: true,
    });
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    await waitForStableBadgeCount(page);

    const initialKilometres = await getVisibleBadgeKilometres(page);
    const [firstBadgeKm] = initialKilometres;

    // Advances well past the first currently-visible badge — regardless
    // of which interval is active, the badge that was nearest the start
    // must disappear, and whatever remains must still read as a larger
    // absolute value, never reset to a small one relative to the new
    // position (the exact failure mode this test targets).
    const advanceToMetres = firstBadgeKm * 1000 + 800;
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(advanceToMetres),
    });

    await expect
      .poll(
        async () => {
          const km = await getVisibleBadgeKilometres(page);
          const [nearest] = km;
          return km.length > 0 && nearest > firstBadgeKm;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const laterKilometres = await getVisibleBadgeKilometres(page);
    expect(laterKilometres.every((km) => km > firstBadgeKm)).toBe(true);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Fallback and rotation", () => {
  async function planLongRouteOnFallbackMap(page: Page): Promise<string[]> {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });
    await page.addInitScript(() => {
      const originalFetch = fetch;
      globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
    });

    await forceMapStyleFailure(page);
    await page.route(ORS_URL_GLOB, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(
          buildMockOrsResponseForCoordinates([WEST_COORDINATE, EAST_COORDINATE]),
        ),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
    await page.getByRole("button", { name: "Save on this device" }).click();
    await expect(
      page.getByText(/key saved on this device, not yet verified/i),
    ).toBeVisible();

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 100, y: 100 } });
    await mapContainer.click({ position: { x: 400, y: 200 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    const summaryRegion = page.getByRole("region", { name: "Route summary" });
    await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

    return consoleErrors;
  }

  test("badges render on the plain fallback background", async ({ page }) => {
    const consoleErrors = await planLongRouteOnFallbackMap(page);

    await waitForStableBadgeCount(page);

    expect(consoleErrors).toEqual([]);
  });

  test("retrying imagery does not duplicate badges", async ({ page }) => {
    const consoleErrors = await planLongRouteOnFallbackMap(page);

    const countBeforeRetry = await waitForStableBadgeCount(page);
    const textsBeforeRetry = (
      await page.locator(".distance-badge-marker").allTextContents()
    ).sort();

    await page.getByTestId("retry-map-imagery-button").click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

    const countAfterRetry = await waitForStableBadgeCount(page);
    expect(countAfterRetry).toBe(countBeforeRetry);
    const textsAfterRetry = (
      await page.locator(".distance-badge-marker").allTextContents()
    ).sort();
    expect(textsAfterRetry).toEqual(textsBeforeRetry);

    expect(consoleErrors).toEqual([]);
  });

  test("badge labels stay upright after the map is rotated", async ({ page }) => {
    const consoleErrors = await planLongRouteOnFallbackMap(page);

    await waitForStableBadgeCount(page);

    const badge = page.locator(".distance-badge-marker").first();
    const boxBefore = await badge.boundingBox();
    if (!boxBefore) {
      throw new Error("expected a distance badge to lay out before rotation");
    }

    const mapContainer = page.locator('[data-testid="map-container"]');
    const mapBox = await mapContainer.boundingBox();
    if (!mapBox) {
      throw new Error("expected the map container to lay out");
    }
    const centreX = mapBox.x + mapBox.width / 2;
    const centreY = mapBox.y + mapBox.height / 2;

    // MapLibre's default DragRotateHandler binds to a right-button drag
    // (see directionArrows.spec.ts's identical gesture).
    await page.mouse.move(centreX, centreY - 100);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(centreX + 150, centreY - 100, { steps: 10 });
    await page.mouse.up({ button: "right" });

    const boxAfter = await badge.boundingBox();
    if (!boxAfter) {
      throw new Error("expected the same distance badge to still lay out after rotation");
    }

    // A DOM marker that rotated along with the map would swap its
    // width/height under a ~90° turn; MapLibre's default screen-space
    // marker alignment keeps it screen-aligned regardless, so its own
    // box dimensions stay the same shape.
    expect(Math.abs(boxAfter.width - boxBefore.width)).toBeLessThan(2);
    expect(Math.abs(boxAfter.height - boxBefore.height)).toBeLessThan(2);

    expect(consoleErrors).toEqual([]);
  });
});
