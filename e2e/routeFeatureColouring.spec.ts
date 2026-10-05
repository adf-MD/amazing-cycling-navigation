import { expect, test, type Locator, type Page } from "@playwright/test";
import { forceMapStyleFailure } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround for ORS mocking.
test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

// A flat 500 m lead-in followed by a sustained, steep (20%) 1000 m climb
// — comfortably past every recognised-climb eligibility threshold in
// src/navigation/routeFeatures.ts (length >= 500 m, average gradient
// >= 3%, climbScore >= 1500): length 1000 m * average gradient 20% =
// climbScore 20000, which falls in [16000, 32000) -> category-3
// (src/navigation/routeFeaturePalette.ts). Surface code 1 ("paved", see
// src/routing/surfaceCodes.ts) is applied to the whole route so no
// surface warning is generated — this fixture is deliberately "clean" so
// a map tap always resolves to the climb, never a competing warning; see
// the "surface warning takes priority" test below for the opposite case.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const FIXTURE_LAT = 51.5;
const FIXTURE_START_LON = -0.05;
const STEP_METRES = 100;
const POINT_COUNT = 16;
const FLAT_ELEVATION_METRES = 10;
const CLIMB_GRADE_PERCENT = 20;
const CLIMB_START_METRES = 500;

function lonAtMetresAlongFixture(distanceMetres: number): number {
  return FIXTURE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildCoordinates(): number[][] {
  return Array.from({ length: POINT_COUNT }, (_, index) => {
    const distanceMetres = index * STEP_METRES;
    const elevation =
      distanceMetres <= CLIMB_START_METRES
        ? FLAT_ELEVATION_METRES
        : FLAT_ELEVATION_METRES +
          ((distanceMetres - CLIMB_START_METRES) * CLIMB_GRADE_PERCENT) / 100;
    return [lonAtMetresAlongFixture(distanceMetres), FIXTURE_LAT, elevation];
  });
}

function buildCleanMockOrsResponse() {
  const coordinates = buildCoordinates();
  const totalDistanceMetres = (POINT_COUNT - 1) * STEP_METRES;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          summary: { distance: totalDistanceMetres, duration: 300 },
          extras: { surface: { values: [[0, POINT_COUNT - 1, 1]] } },
        },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

/** Same climb geometry, but with an explicit "unpaved" (questionable
 * surface, code 2) tag over the climb's own [500, 1500] m range — a
 * genuine overlap for the warning-priority test below. */
function buildWarningOverlapMockOrsResponse() {
  const coordinates = buildCoordinates();
  const totalDistanceMetres = (POINT_COUNT - 1) * STEP_METRES;
  const climbStartIndex = CLIMB_START_METRES / STEP_METRES;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          summary: { distance: totalDistanceMetres, duration: 300 },
          extras: {
            surface: {
              values: [
                [0, climbStartIndex, 1],
                [climbStartIndex, POINT_COUNT - 1, 2],
              ],
            },
          },
        },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

async function setUpPlanningWithMockRoute(
  page: Page,
  orsResponse: unknown,
): Promise<Locator> {
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
      body: JSON.stringify(orsResponse),
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
  await mapContainer.click({ position: { x: 100, y: 150 } });
  await mapContainer.click({ position: { x: 300, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });
  return summaryRegion;
}

/** Taps the fitted route on the map with a real click, `x` pixels into the
 * map. Calculate route fits the camera to the route, a horizontal line at
 * FIXTURE_LAT, so the camera is centred on that latitude and the line
 * crosses the map's vertical centre. The tap therefore targets that centre
 * rather than a fixed height: item 122 made the Planning map 400px tall at
 * this 1280x720 viewport (320px before), so the line moved from y≈160 to
 * y≈200, and the old fixed y=150 — 10px from the line before, inside the
 * map's ±14px tap tolerance — landed 50px from it, where a mouse click
 * places a waypoint instead of selecting the route. */
async function tapFittedRoute(page: Page, x: number): Promise<void> {
  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect
    .poll(async () =>
      Number((await mapContainer.getAttribute("data-camera-center"))?.split(",")[1]),
    )
    .toBeCloseTo(FIXTURE_LAT, 4);
  const box = await mapContainer.boundingBox();
  if (!box) throw new Error("the map is not laid out");
  await mapContainer.click({ position: { x, y: Math.round(box.height / 2) } });
}

test.describe("Planning", () => {
  test("tapping the climb on the map selects it, shows the details panel, and clearing removes it", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const summaryRegion = await setUpPlanningWithMockRoute(
      page,
      buildCleanMockOrsResponse(),
    );

    await expect(
      summaryRegion.getByRole("region", { name: "Route feature details" }),
    ).toBeHidden();

    // The camera re-fits to the calculated route after Calculate route —
    // the climb is the eastern (second) half of the fitted route line, so
    // a tap well into the right side of the map lands on it.
    await tapFittedRoute(page, 950);

    const detailsPanel = summaryRegion.getByRole("region", {
      name: "Route feature details",
    });
    await expect(detailsPanel).toBeVisible();
    await expect(
      detailsPanel.getByRole("heading", { name: "Category 3 climb" }),
    ).toBeVisible();
    // Exact length/average-gradient figures are already covered precisely
    // by src/navigation/routeFeatures.test.ts's unit tests, including the
    // smoothing-driven edge rounding right at the flat/climb transition
    // this fixture exercises; here it's enough to confirm the wiring
    // (real, plausible route-position/gradient figures reach the panel).
    await expect(
      detailsPanel.getByText(/Route position: 0\.\d–1\.5\u00a0km/),
    ).toBeVisible();
    await expect(
      detailsPanel.getByText(/Average gradient: \+(1[5-9]\.\d|20\.0)%/),
    ).toBeVisible();
    await expect(detailsPanel.getByText(/Climb score: \d+/)).toBeVisible();

    await detailsPanel.getByRole("button", { name: "Clear selection" }).click();
    await expect(
      summaryRegion.getByRole("region", { name: "Route feature details" }),
    ).toBeHidden();

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Planning: surface-warning priority", () => {
  test("a surface warning takes priority over an overlapping recognised climb on a map tap", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const summaryRegion = await setUpPlanningWithMockRoute(
      page,
      buildWarningOverlapMockOrsResponse(),
    );

    // Both the recognised climb and a questionable-surface warning cover
    // the same [500, 1500] m range on this fixture.
    const warningButton = summaryRegion.getByRole("button", {
      name: /^Questionable surface/i,
    });
    await expect(warningButton).toBeVisible();
    await expect(warningButton).toHaveAttribute("aria-pressed", "false");

    await tapFittedRoute(page, 950);

    // The warning — not the climb — is selected.
    await expect(warningButton).toHaveAttribute("aria-pressed", "true");
    await expect(
      summaryRegion.getByRole("region", { name: "Route feature details" }),
    ).toBeHidden();

    // The warning remains selectable and obvious even though a recognised
    // climb also covers the same stretch, and the surface-warning list
    // itself is unaffected by any climb/descent presentation.
    await summaryRegion.getByRole("button", { name: "Clear warning selection" }).click();
    await expect(warningButton).toHaveAttribute("aria-pressed", "false");

    expect(consoleErrors).toEqual([]);
  });
});
