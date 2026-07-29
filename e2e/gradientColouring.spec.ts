import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { forceMapStyleFailure } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround for ORS mocking. This
// spec also needs it to reliably block the map tile-style request.
test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/gradient-route.gpx", import.meta.url),
);

// Matches gradient-route.gpx and the mocked ORS geometry below: a flat
// first 1000 m (10 m elevation throughout), then a sustained, steep
// (20%) climb from 1000 m to 2000 m — comfortably past every threshold
// in src/navigation/gradient.ts (MAX_ELEVATION_GAP_METRES,
// MIN_GRADE_WINDOW_METRES, GRADE_BASELINE_WINDOW_METRES,
// MIN_SEGMENT_LENGTH_METRES), so it classifies cleanly as one sustained
// "very-steep-climb" run. The climb (1000 m, 20% average grade) is also a
// recognised macro ClimbFeature: climbScore = 1000 * 20 = 20,000, which
// falls in [16000, 32000) -> category-3 (src/navigation/routeFeaturePalette.ts).
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const FIXTURE_LAT = 51.5;
const FIXTURE_START_LON = -0.05;
const STEP_METRES = 100;
const POINT_COUNT = 21;
const FLAT_ELEVATION_METRES = 10;
const CLIMB_GRADE_PERCENT = 20;
const CLIMB_START_METRES = 1000;

function lonAtMetresAlongFixture(distanceMetres: number): number {
  return FIXTURE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildGradientRouteCoordinates(): number[][] {
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

function buildMockOrsResponse(coordinates: readonly (readonly number[])[]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: 2000, duration: 400 } },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

/** Runs entirely inside the page: decodes a screenshot PNG (see
 * directionArrows.spec.ts's own identical rationale for base64 + Image
 * decode over canvas.toDataURL), then counts pixels close to each named
 * target colour and each colour's mean on-screen x — enough to prove a
 * colour renders, and roughly where. Generic over the colour map so both
 * macro (route-feature) and micro (local-gradient) colours can be sampled
 * with the same helper. */
interface ColourSample {
  pixelCount: number;
  centroidX: number;
}

async function sampleColourPixels({
  pngBase64,
  colours,
}: {
  pngBase64: string;
  colours: Record<string, readonly [number, number, number]>;
}): Promise<Record<string, ColourSample>> {
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
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);

  function closeTo(
    r: number,
    g: number,
    b: number,
    target: readonly [number, number, number],
  ): boolean {
    const dr = r - target[0];
    const dg = g - target[1];
    const db = b - target[2];
    return dr * dr + dg * dg + db * db <= COLOUR_THRESHOLD_SQUARED;
  }

  const counts: Record<string, number> = {};
  const sumXs: Record<string, number> = {};
  for (const name of Object.keys(colours)) {
    counts[name] = 0;
    sumXs[name] = 0;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      for (const [name, target] of Object.entries(colours)) {
        if (closeTo(r, g, b, target)) {
          counts[name] = (counts[name] ?? 0) + 1;
          sumXs[name] = (sumXs[name] ?? 0) + x;
          break;
        }
      }
    }
  }

  const result: Record<string, ColourSample> = {};
  for (const name of Object.keys(colours)) {
    const count = counts[name] ?? 0;
    result[name] = {
      pixelCount: count,
      centroidX: count > 0 ? (sumXs[name] ?? 0) / count : -1,
    };
  }
  return result;
}

const MACRO_CATEGORY_3_COLOUR: readonly [number, number, number] = [0xfd, 0xd8, 0x35];
const MICRO_VERY_STEEP_CLIMB_COLOUR: readonly [number, number, number] = [
  0x5b, 0x3f, 0xa6,
];
const BASE_ROUTE_COLOUR: readonly [number, number, number] = [0x0a, 0x5f, 0x38];

async function captureColourSample(
  page: Page,
  colours: Record<string, readonly [number, number, number]>,
): Promise<Record<string, ColourSample>> {
  const canvasLocator = page.locator('[data-testid="map-container"] canvas');
  // Mirrors directionArrows.spec.ts's own settle wait — MapLibre's paint/
  // placement cycle runs independently of the source data already being
  // set.
  await page.waitForTimeout(500);
  const pngBuffer = await canvasLocator.screenshot();
  return page.evaluate(sampleColourPixels, {
    pngBase64: pngBuffer.toString("base64"),
    colours,
  });
}

test.describe("Planning", () => {
  test("shows the recognised climb in its macro category colour by default, with no per-segment detail until selected", async ({
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
        body: JSON.stringify(buildMockOrsResponse(buildGradientRouteCoordinates())),
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

    await expect(
      summaryRegion.getByRole("img", { name: "Elevation profile chart" }),
    ).toBeVisible();

    // The "Gradient colours" disclosure is collapsed by default.
    const disclosureSummary = summaryRegion.getByText("Gradient colours");
    await expect(disclosureSummary).toBeVisible();
    await expect(summaryRegion.getByText(/Category 3 climb/)).toBeHidden();
    await disclosureSummary.click();
    await expect(summaryRegion.getByText(/Category 3 climb/)).toBeVisible();
    // No feature is selected yet, so the detailed local-gradient legend
    // section has nothing to show.
    await expect(summaryRegion.getByText(/Very steep climb \(/)).toBeHidden();

    const macroSample = await captureColourSample(page, {
      macro: MACRO_CATEGORY_3_COLOUR,
      micro: MICRO_VERY_STEEP_CLIMB_COLOUR,
      base: BASE_ROUTE_COLOUR,
    });
    // Macro colouring covers the climb by default; no detailed local-
    // gradient colouring shows anywhere until a feature is selected.
    expect(macroSample.macro.pixelCount).toBeGreaterThan(0);
    expect(macroSample.micro.pixelCount).toBe(0);
    // The flat section (west/start half) stays the plain base route
    // colour, not a distinct "flat" class colour.
    expect(macroSample.base.pixelCount).toBeGreaterThan(0);
    expect(macroSample.base.centroidX).toBeLessThan(macroSample.macro.centroidX);

    // Selecting the climb reveals the details panel and the detailed
    // local-gradient colouring inside it. Selected via the elevation
    // chart, not the map: this fixture also carries an "unknown surface"
    // warning spanning almost the entire route, so a map tap would hit
    // that (correctly higher-priority) warning first — see
    // routeFeatureColouring.spec.ts for map-tap selection and the
    // warning-priority scenario on a fixture without that overlap. The
    // climb is the second (eastern) half of the domain, so a tap at 75%
    // of the chart's own width lands inside it.
    const chartTapTarget = summaryRegion.locator("rect.elevation-chart-tap-target");
    const chartBox = await chartTapTarget.boundingBox();
    if (!chartBox)
      throw new Error("expected the elevation chart's tap target to be visible");
    await chartTapTarget.click({
      position: { x: chartBox.width * 0.75, y: chartBox.height / 2 },
    });
    await expect(
      summaryRegion.getByRole("region", { name: "Route feature details" }),
    ).toBeVisible();
    await expect(
      summaryRegion.getByRole("heading", { name: "Category 3 climb" }),
    ).toBeVisible();

    const selectedSample = await captureColourSample(page, {
      micro: MICRO_VERY_STEEP_CLIMB_COLOUR,
    });
    expect(selectedSample.micro.pixelCount).toBeGreaterThan(0);

    // Clearing the selection removes the detailed colouring again.
    await summaryRegion.getByRole("button", { name: "Clear selection" }).click();
    await expect(
      summaryRegion.getByRole("region", { name: "Route feature details" }),
    ).toBeHidden();
    const clearedSample = await captureColourSample(page, {
      micro: MICRO_VERY_STEEP_CLIMB_COLOUR,
    });
    expect(clearedSample.micro.pixelCount).toBe(0);

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Riding", () => {
  test("shows the macro climb colour throughout, and detailed local-gradient colouring once the rider is on the climb", async ({
    page,
    context,
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
    await page.addInitScript(() => {
      const originalFetch = fetch;
      globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
    });

    await context.grantPermissions(["geolocation"]);
    // Starts close to (but before) the flat/climb boundary, not the very
    // route start — the Riding camera follows tightly at NAVIGATION_ZOOM
    // once riding begins, so starting at the route's own start would put
    // the climb, over 1 km away, off-screen entirely.
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_START_METRES - 100),
    });

    await forceMapStyleFailure(page);

    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);

    // The route library labels an imported route by its GPX filename
    // (minus extension), not the file's own <name> tag.
    const routeButton = page.getByRole("button", { name: "gradient-route" });
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

    // Before the rider reaches the climb, it's macro-coloured but not yet
    // "active", so no detailed local-gradient colouring shows.
    const beforeEntering = await captureColourSample(page, {
      macro: MACRO_CATEGORY_3_COLOUR,
      micro: MICRO_VERY_STEEP_CLIMB_COLOUR,
    });
    expect(beforeEntering.macro.pixelCount).toBeGreaterThan(0);
    expect(beforeEntering.micro.pixelCount).toBe(0);

    // Advances into the climb — it becomes the rider's active feature, so
    // its remaining portion now also shows detailed local-gradient colour.
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_START_METRES + 50),
    });

    await expect
      .poll(
        async () => {
          const sample = await captureColourSample(page, {
            micro: MICRO_VERY_STEEP_CLIMB_COLOUR,
          });
          return sample.micro.pixelCount;
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toBeGreaterThan(0);

    expect(consoleErrors).toEqual([]);
  });
});
