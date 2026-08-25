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
// MIN_SEGMENT_LENGTH_METRES), so its detailed local gradient classifies
// cleanly as one sustained "extremely-steep-climb" band (>=12%, see
// src/navigation/routeFeatures.ts's classifyClimbGradientBand). The climb
// (1000 m, 20% average grade) is also a recognised macro ClimbFeature:
// climbScore = 1000 * 20 = 20,000, which falls in [16000, 32000) ->
// category-3 (src/navigation/routeFeaturePalette.ts).
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
const MICRO_EXTREMELY_STEEP_CLIMB_COLOUR: readonly [number, number, number] = [
  0x8e, 0x00, 0x00,
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
    await expect(summaryRegion.getByText(/Extremely steep climb/)).toBeHidden();

    const macroSample = await captureColourSample(page, {
      macro: MACRO_CATEGORY_3_COLOUR,
      micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
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
      micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
    });
    expect(selectedSample.micro.pixelCount).toBeGreaterThan(0);

    // Clearing the selection removes the detailed colouring again.
    await summaryRegion.getByRole("button", { name: "Clear selection" }).click();
    await expect(
      summaryRegion.getByRole("region", { name: "Route feature details" }),
    ).toBeHidden();
    const clearedSample = await captureColourSample(page, {
      micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
    });
    expect(clearedSample.micro.pixelCount).toBe(0);

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Planning: legend visibility", () => {
  test("expanding the legend reveals line samples with a real, non-transparent rendered colour", async ({
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

    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 100, y: 150 } });
    await mapContainer.click({ position: { x: 300, y: 150 } });
    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    const summaryRegion = page.getByRole("region", { name: "Route summary" });
    await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

    await summaryRegion.getByText("Gradient colours").click();

    // This is the check that would have caught the original bug: the
    // swatch's backgroundColor was set correctly all along, but with no
    // width/height anywhere, it painted onto a 0x0 box — invisible in a
    // real browser despite the colour being "correct" in the DOM.
    const swatch = summaryRegion.locator(".gradient-colour-swatch").first();
    await expect(swatch).toBeVisible();
    const box = await swatch.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
    const backgroundColor = await swatch.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(backgroundColor).not.toBe("");
    expect(backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(backgroundColor).not.toBe("transparent");

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Planning: descent colouring", () => {
  // A flat lead-in (0-500 m, 200 m elevation), then a sustained 15%
  // descent (500-1500 m, dropping to 50 m), then a short flat tail
  // (1500-2000 m) — comfortably past every eligibility/analysis
  // threshold, so it's recognised as one descent feature. Average
  // gradient -15% falls at or below -9%, so classifyDescentBand
  // (src/navigation/routeFeatures.ts) resolves it to "very-steep" — the
  // same colour (#1a1a4e) is used at both the macro (whole-descent) and
  // local (selected) level, since descent macro/local classification is
  // literally the same scheme (unlike a climb's category vs local band).
  const DESCENT_STEP_METRES = 100;
  const DESCENT_START_METRES = 500;
  const DESCENT_END_METRES = 1500;
  const DESCENT_START_ELEVATION_METRES = 200;
  const DESCENT_GRADE_PERCENT = -15;
  const DESCENT_POINT_COUNT = 21;

  function buildDescentRouteCoordinates(): number[][] {
    return Array.from({ length: DESCENT_POINT_COUNT }, (_, index) => {
      const distanceMetres = index * DESCENT_STEP_METRES;
      let elevation = DESCENT_START_ELEVATION_METRES;
      if (distanceMetres > DESCENT_START_METRES) {
        const descended =
          Math.min(distanceMetres, DESCENT_END_METRES) - DESCENT_START_METRES;
        elevation += (descended * DESCENT_GRADE_PERCENT) / 100;
      }
      return [lonAtMetresAlongFixture(distanceMetres), FIXTURE_LAT, elevation];
    });
  }

  const VERY_STEEP_DESCENT_COLOUR: readonly [number, number, number] = [0x1a, 0x1a, 0x4e];

  test("colours a recognised descent blue by default, and retains the same blue once selected (backlog item 79: no inline safety disclaimer here any more)", async ({
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
        body: JSON.stringify(buildMockOrsResponse(buildDescentRouteCoordinates())),
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

    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 100, y: 150 } });
    await mapContainer.click({ position: { x: 300, y: 150 } });
    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    const summaryRegion = page.getByRole("region", { name: "Route summary" });
    await expect(summaryRegion).toBeVisible({ timeout: 15_000 });
    await expect(
      summaryRegion.getByRole("img", { name: "Elevation profile chart" }),
    ).toBeVisible();

    const macroSample = await captureColourSample(page, {
      descent: VERY_STEEP_DESCENT_COLOUR,
    });
    expect(macroSample.descent.pixelCount).toBeGreaterThan(0);

    // The descent occupies roughly the middle half of the 2000 m route.
    const chartTapTarget = summaryRegion.locator("rect.elevation-chart-tap-target");
    const chartBox = await chartTapTarget.boundingBox();
    if (!chartBox)
      throw new Error("expected the elevation chart's tap target to be visible");
    await chartTapTarget.click({
      position: { x: chartBox.width * 0.5, y: chartBox.height / 2 },
    });
    await expect(
      summaryRegion.getByRole("region", { name: "Route feature details" }),
    ).toBeVisible();
    await expect(
      summaryRegion.getByRole("heading", { name: "Recognised descent" }),
    ).toBeVisible();
    // The blue-intensity safety sentence moved to Settings' own "Local
    // gradient colours" disclosure (backlog item 79) — no longer shown
    // inline on the selected-descent details card here or in Riding.
    await expect(summaryRegion.getByText(/Blue intensity reflects/)).not.toBeVisible();

    const selectedSample = await captureColourSample(page, {
      descent: VERY_STEEP_DESCENT_COLOUR,
    });
    // Selecting a descent changes its selection styling, not its base
    // blue — the same colour is still present, at both macro and local
    // level.
    expect(selectedSample.descent.pixelCount).toBeGreaterThan(0);

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
    const routeButton = page.getByRole("button", {
      name: "gradient-route",
      exact: true,
    });
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

    // Before the rider reaches the climb, it's macro-coloured but not yet
    // "active", so no detailed local-gradient colouring shows.
    const beforeEntering = await captureColourSample(page, {
      macro: MACRO_CATEGORY_3_COLOUR,
      micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
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
            micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
          });
          return sample.micro.pixelCount;
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toBeGreaterThan(0);

    expect(consoleErrors).toEqual([]);
  });

  test("the pre-ride climb selector defaults to All route, lets the rider select the climb and switch back and forth, and disappears once riding starts", async ({
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

    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
    const routeButton = page.getByRole("button", {
      name: "gradient-route",
      exact: true,
    });
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();
    const startButton = page.getByRole("button", { name: "Start riding" });
    await expect(startButton).toBeVisible();

    // No climb is selected by default, before any interaction — the
    // dropdown starts on "All route", no numbered details heading shows,
    // and only the macro category colour renders (no detailed local-
    // gradient overlay yet).
    const select = page.getByRole("combobox", { name: "Recognised climbs" });
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("all");
    // The exact start distance is smoothing-driven edge rounding (see
    // routeFeatureColouring.spec.ts's own comment on the same fixture
    // shape) — comfortably within 0.9-1.0 km, not exactly 1.0.
    await expect(
      page.getByRole("option", { name: /Climb 1 · Category 3 · starts at 0\.\d km/ }),
    ).toBeAttached();
    await expect(
      page.getByRole("heading", { name: "Climb 1 · Category 3" }),
    ).toBeHidden();
    await expect(page.getByText("1 recognised climb on this route")).toBeVisible();

    const defaultSample = await captureColourSample(page, {
      macro: MACRO_CATEGORY_3_COLOUR,
      micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
    });
    expect(defaultSample.macro.pixelCount).toBeGreaterThan(0);
    expect(defaultSample.micro.pixelCount).toBe(0);

    // Selecting the route's one recognised climb shows its details and its
    // detailed local-gradient colouring — index 1, since index 0 is always
    // "All route" and this fixture has exactly one recognised climb. The
    // macro category colour itself is not separately visible on the
    // climb's own range while it's selected: micro is drawn on top at the
    // same width, per the existing selected-feature layering (see the
    // "Planning" test above) — only the flat lead-in (plain base route
    // colour, not a macro feature) is unaffected by the selection.
    await select.selectOption({ index: 1 });
    await expect(
      page.getByRole("heading", { name: "Climb 1 · Category 3" }),
    ).toBeVisible();
    await expect(page.getByText("1 recognised climb on this route")).toBeHidden();

    const preSelectedSample = await captureColourSample(page, {
      base: BASE_ROUTE_COLOUR,
      micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
    });
    expect(preSelectedSample.base.pixelCount).toBeGreaterThan(0);
    expect(preSelectedSample.micro.pixelCount).toBeGreaterThan(0);

    // Switching to "All route" clears the details card, shows the
    // route-level count instead, and removes the detailed colouring —
    // the macro colouring stays exactly as it was.
    await select.selectOption({ label: "All route" });
    await expect(
      page.getByRole("heading", { name: "Climb 1 · Category 3" }),
    ).toBeHidden();
    await expect(page.getByText("1 recognised climb on this route")).toBeVisible();
    const allRouteSample = await captureColourSample(page, {
      macro: MACRO_CATEGORY_3_COLOUR,
      micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
    });
    expect(allRouteSample.macro.pixelCount).toBeGreaterThan(0);
    expect(allRouteSample.micro.pixelCount).toBe(0);

    // Selecting it again from the dropdown restores both.
    await select.selectOption({ index: 1 });
    await expect(
      page.getByRole("heading", { name: "Climb 1 · Category 3" }),
    ).toBeVisible();
    const reselectedSample = await captureColourSample(page, {
      micro: MICRO_EXTREMELY_STEEP_CLIMB_COLOUR,
    });
    expect(reselectedSample.micro.pixelCount).toBeGreaterThan(0);

    // The new detailed pre-ride climb chart, added alongside the dropdown,
    // renders its own filled area with the same authoritative local-
    // gradient colours as the active current-climb view, and — since this
    // is a read-only preview, not an active ride — has no rider-position
    // marker.
    const detailChart = page.getByRole("img", { name: "Elevation profile for Climb 1" });
    await expect(detailChart).toBeVisible();
    expect(
      await detailChart.locator(".elevation-chart-area-fill").count(),
    ).toBeGreaterThan(0);
    expect(await detailChart.locator(".elevation-chart-marker").count()).toBe(0);

    // Starting the ride hides the pre-ride selector entirely.
    await startButton.click();
    await expect(select).toBeHidden();

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Riding: pre-ride climb chart layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the pre-ride selected-climb chart introduces no horizontal overflow at the project's narrow mobile viewport", async ({
    page,
  }) => {
    await forceMapStyleFailure(page);

    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
    const routeButton = page.getByRole("button", {
      name: "gradient-route",
      exact: true,
    });
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    // No climb is selected by default — select the route's one recognised
    // climb (index 1; index 0 is always "All route") to bring the new
    // detailed chart on screen.
    await page
      .getByRole("combobox", { name: "Recognised climbs" })
      .selectOption({ index: 1 });
    await expect(
      page.getByRole("heading", { name: "Climb 1 · Category 3" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Elevation profile for Climb 1" }),
    ).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });

  test("presents the pre-ride route briefing in reading order with no horizontal overflow, and starting the ride removes the pre-ride-only panels", async ({
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

    await forceMapStyleFailure(page);

    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
    const routeButton = page.getByRole("button", {
      name: "gradient-route",
      exact: true,
    });
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const startButton = page.getByRole("button", { name: "Start riding" });
    await expect(startButton).toBeVisible();
    await expect(page.getByTestId("map-container")).toBeVisible();
    await expect(page.locator(".ride-start-panel")).toBeVisible();
    await expect(page.locator(".ride-profile-panel")).toBeVisible();

    // Reading/keyboard order: the route's own h1, then the two top-level
    // pre-ride h2 sections, in DOM order — Route profile (the card the
    // climb selector is now embedded within) before Recognised climbs.
    const headingTexts = await page.locator("h1, h2").allTextContents();
    expect(headingTexts).toEqual([
      "gradient-route",
      "Route profile",
      "Recognised climbs",
    ]);

    // Recognised climbs is now embedded inside the Route profile card, not
    // a separate top-level block.
    const climbSelectorInsideProfilePanel = await page.evaluate(() => {
      const panel = document.querySelector(".ride-profile-panel");
      const selectorSection = document.querySelector(
        'section[aria-label="Recognised climbs"]',
      );
      return (
        panel !== null && selectorSection !== null && panel.contains(selectorSection)
      );
    });
    expect(climbSelectorInsideProfilePanel).toBe(true);

    await page
      .getByRole("combobox", { name: "Recognised climbs" })
      .selectOption({ index: 1 });
    await expect(
      page.getByRole("heading", { name: "Climb 1 · Category 3" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Elevation profile for Climb 1" }),
    ).toBeVisible();

    // The selected climb's details/detail-chart sit immediately after the
    // Recognised climbs selector, with nothing in between.
    const climbSelectorFollowedByDetails = await page.evaluate(() => {
      const selectorSection = document.querySelector(
        'section[aria-label="Recognised climbs"]',
      );
      const detailsSection = document.querySelector(
        'section[aria-label="Route feature details"]',
      );
      return selectorSection?.nextElementSibling === detailsSection;
    });
    expect(climbSelectorFollowedByDetails).toBe(true);

    const scrollWidthWithClimbSelected = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidthWithClimbSelected).toBeLessThanOrEqual(390);

    await startButton.click();
    await expect(page.locator(".ride-start-panel")).toBeHidden();
    await expect(page.getByRole("combobox", { name: "Recognised climbs" })).toBeHidden();
    await expect(page.locator(".ride-profile-panel")).toBeHidden();
    // Active Riding now defaults to the Map view (backlog item 56) — the
    // elevation section lives in the separate, initially aria-hidden
    // Profile pane, reachable via the Map/Profile switcher.
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.locator(".ride-elevation-section")).toBeVisible();

    // The now-active immersive header (backlog item 55, superseding item
    // 40's own .ride-end-ride-row structure) sits at the very top of the
    // screen, ahead of the map, with its End-ride trigger inside the
    // header's own End slot; its confirmation opens as its own row
    // immediately after the header.
    const immersiveHeader = page.locator(".riding-immersive-header");
    await expect(immersiveHeader).toBeVisible();
    const headerPrecedesMap = await page.evaluate(() => {
      const header = document.querySelector(".riding-immersive-header");
      const mapContainer = document.querySelector('[data-testid="map-container"]');
      if (!header || !mapContainer) return false;
      return Boolean(
        header.compareDocumentPosition(mapContainer) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(headerPrecedesMap).toBe(true);

    await immersiveHeader.getByRole("button", { name: "End ride" }).click();
    const endRideDialog = page.getByRole("alertdialog");
    await expect(endRideDialog).toBeVisible();
    // The header's own End slot goes empty once the confirmation opens
    // (backlog item 55's "replace the End trigger with the confirmation
    // in place" requirement), and the confirmation renders as its own
    // full-width row immediately after the header — superseding item 50's
    // original .ride-end-ride-row single-container structure.
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

    const scrollWidthWithDialogOpen = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidthWithDialogOpen).toBeLessThanOrEqual(390);

    await endRideDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(endRideDialog).toBeHidden();

    const scrollWidthActive = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidthActive).toBeLessThanOrEqual(390);

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Riding: pre-ride full profile (item 77)", () => {
  // Extends the same flat-then-climb shape as buildGradientRouteCoordinates
  // (flat 0-1000 m @10 m, climb 1000-2000 m @20% -> 210 m, category-3) with
  // a further sustained -15% descent tail (2000-3000 m, down to 60 m) —
  // recognised as its own separate feature (a large net elevation swing at
  // the reversal, well past REVERSAL_BRIDGE_ELEVATION_METRES/
  // REVERSAL_BRIDGE_DISTANCE_METRES) at the "very-steep" band, the same
  // fixture shape and colour already used by "Planning: descent colouring"
  // above. Built as an in-memory GPX buffer (mirrors
  // ridingMapProfileViews.spec.ts's own established convention) rather than
  // a new committed fixture file, since no existing GPX fixture combines a
  // climb and a descent.
  const DESCENT_TAIL_START_METRES = 2000;
  const DESCENT_TAIL_END_METRES = 3000;
  const DESCENT_TAIL_GRADE_PERCENT = -15;
  const DESCENT_TAIL_START_ELEVATION_METRES = 210;

  function buildClimbThenDescentRouteGpx(name: string): string {
    const climbPoints = buildGradientRouteCoordinates();
    const descentStepMetres = STEP_METRES;
    const descentPointCount =
      (DESCENT_TAIL_END_METRES - DESCENT_TAIL_START_METRES) / descentStepMetres;
    const descentPoints = Array.from({ length: descentPointCount }, (_, index) => {
      const distanceMetres = DESCENT_TAIL_START_METRES + (index + 1) * descentStepMetres;
      const descended = (index + 1) * descentStepMetres;
      const elevation =
        DESCENT_TAIL_START_ELEVATION_METRES +
        (descended * DESCENT_TAIL_GRADE_PERCENT) / 100;
      return [lonAtMetresAlongFixture(distanceMetres), FIXTURE_LAT, elevation];
    });
    const trkpts = [...climbPoints, ...descentPoints]
      .map(
        ([lon, lat, ele]) =>
          `      <trkpt lat="${String(lat)}" lon="${String(lon)}"><ele>${String(ele)}</ele></trkpt>`,
      )
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
  }

  const VERY_STEEP_DESCENT_COLOUR: readonly [number, number, number] = [0x1a, 0x1a, 0x4e];

  async function importClimbThenDescentRoute(page: Page): Promise<void> {
    await page.getByLabel("Import GPX file").setInputFiles({
      name: "climb-then-descent-route.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildClimbThenDescentRouteGpx("climb-then-descent-route")),
    });
    const routeButton = page.getByRole("button", {
      name: "climb-then-descent-route",
      exact: true,
    });
    await expect(routeButton).toBeVisible();
    await routeButton.click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  }

  test("the pre-ride map still shows the recognised descent in blue, even though the profile chart no longer colours it", async ({
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

    await forceMapStyleFailure(page);

    await page.goto("/");
    await importClimbThenDescentRoute(page);
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

    // Not clicking "Start riding" — this is the pre-ride full overview.
    await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();

    // The chart's disclosure is now the climb-only legend...
    await expect(page.getByText("Climb categories")).toBeVisible();
    await expect(page.getByText("Gradient colours")).toBeHidden();

    // ...but the map overlay — a separate rendering pipeline entirely
    // (real MapLibre paint, not this component's SVG) — still shows both
    // the climb and the descent in their normal colours, unaffected.
    const mapSample = await captureColourSample(page, {
      macro: MACRO_CATEGORY_3_COLOUR,
      descent: VERY_STEEP_DESCENT_COLOUR,
    });
    expect(mapSample.macro.pixelCount).toBeGreaterThan(0);
    expect(mapSample.descent.pixelCount).toBeGreaterThan(0);

    expect(consoleErrors).toEqual([]);
  });

  test("the Climb categories disclosure expands to a real, non-transparent rendered swatch", async ({
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

    await forceMapStyleFailure(page);

    await page.goto("/");
    await importClimbThenDescentRoute(page);

    const disclosureSummary = page.getByText("Climb categories");
    await expect(disclosureSummary).toBeVisible();
    await disclosureSummary.click();

    // Mirrors "Planning: legend visibility" above — the check that would
    // have caught the original swatch-invisibility bug (a correct
    // backgroundColor with no width/height, painting onto a 0x0 box).
    const swatch = page.locator(".gradient-colour-swatch").first();
    await expect(swatch).toBeVisible();
    const box = await swatch.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
    const backgroundColor = await swatch.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(backgroundColor).not.toBe("");
    expect(backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(backgroundColor).not.toBe("transparent");

    expect(consoleErrors).toEqual([]);
  });

  test.describe("390x844 phone viewport", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the expanded Climb categories disclosure introduces no horizontal overflow, and the pre-ride reading order is unchanged", async ({
      page,
    }) => {
      await forceMapStyleFailure(page);

      await page.goto("/");
      await importClimbThenDescentRoute(page);

      // Reading order: Route profile (chart + disclosure), then Recognised
      // climbs, then the selected-feature details once a climb is chosen —
      // unchanged by item 77, which only alters the disclosure's own
      // content within the same "Route profile" section.
      const headingTexts = await page.locator("h1, h2").allTextContents();
      expect(headingTexts).toEqual([
        "climb-then-descent-route",
        "Route profile",
        "Recognised climbs",
      ]);

      const disclosureSummary = page.getByText("Climb categories");
      await expect(disclosureSummary).toBeVisible();
      await disclosureSummary.click();
      await expect(page.locator(".route-feature-legend-entry").first()).toBeVisible();

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(390);

      await page
        .getByRole("combobox", { name: "Recognised climbs" })
        .selectOption({ index: 1 });
      await expect(
        page.getByRole("heading", { name: "Climb 1 · Category 3" }),
      ).toBeVisible();

      const selectorFollowedByDetails = await page.evaluate(() => {
        const selectorSection = document.querySelector(
          'section[aria-label="Recognised climbs"]',
        );
        const detailsSection = document.querySelector(
          'section[aria-label="Route feature details"]',
        );
        return selectorSection?.nextElementSibling === detailsSection;
      });
      expect(selectorFollowedByDetails).toBe(true);

      const scrollWidthWithSelection = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scrollWidthWithSelection).toBeLessThanOrEqual(390);
    });
  });

  test.describe("selected-feature compact local legends and selected-descent chart (item 78, refined by item 79)", () => {
    test("selecting the climb reveals a collapsed 'Local gradient colours on this climb' disclosure that expands to a real, non-transparent rendered swatch showing only the grade range", async ({
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

      await forceMapStyleFailure(page);

      await page.goto("/");
      await importClimbThenDescentRoute(page);

      await page
        .getByRole("combobox", { name: "Recognised climbs" })
        .selectOption({ index: 1 });

      const disclosureSummary = page.getByText("Local gradient colours on this climb");
      await expect(disclosureSummary).toBeVisible();
      const disclosure = page.locator("details", { has: disclosureSummary });
      await expect(disclosure).not.toHaveAttribute("open", "");

      await disclosureSummary.click();
      const swatch = disclosure.locator(".gradient-colour-swatch").first();
      await expect(swatch).toBeVisible();
      const box = await swatch.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.width).toBeGreaterThan(0);
      expect(box?.height).toBeGreaterThan(0);
      const backgroundColor = await swatch.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(backgroundColor).not.toBe("");
      expect(backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(backgroundColor).not.toBe("transparent");

      // Compact key (backlog item 79): a real grade-range row, no band
      // name or colour name.
      const entryText = await disclosure
        .locator(".gradient-legend-entry")
        .first()
        .innerText();
      expect(entryText).toMatch(/%/);
      expect(entryText).not.toMatch(/climb/i);

      expect(consoleErrors).toEqual([]);
    });

    test("tapping the descent reveals a collapsed 'Local gradient colours on this descent' disclosure that expands to a real, non-transparent rendered swatch showing only the grade range", async ({
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

      await forceMapStyleFailure(page);

      await page.goto("/");
      await importClimbThenDescentRoute(page);

      // The descent tail is the last third of the 0-3000 m domain — a tap
      // at 90% of the chart's width lands solidly inside it.
      const chartTapTarget = page.locator("rect.elevation-chart-tap-target");
      const chartBox = await chartTapTarget.boundingBox();
      if (!chartBox)
        throw new Error("expected the elevation chart's tap target to be visible");
      await chartTapTarget.click({
        position: { x: chartBox.width * 0.9, y: chartBox.height / 2 },
      });
      await expect(
        page.getByRole("heading", { name: "Recognised descent" }),
      ).toBeVisible();

      const disclosureSummary = page.getByText("Local gradient colours on this descent");
      await expect(disclosureSummary).toBeVisible();
      const disclosure = page.locator("details", { has: disclosureSummary });
      await expect(disclosure).not.toHaveAttribute("open", "");

      await disclosureSummary.click();
      const swatch = disclosure.locator(".gradient-colour-swatch").first();
      await expect(swatch).toBeVisible();
      const box = await swatch.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.width).toBeGreaterThan(0);
      expect(box?.height).toBeGreaterThan(0);

      // Compact key (backlog item 79): a real grade-range row, no key
      // name or colour name.
      const entryText = await disclosure
        .locator(".gradient-legend-entry")
        .first()
        .innerText();
      expect(entryText).toMatch(/%/);
      expect(entryText).not.toMatch(/descent/i);

      expect(consoleErrors).toEqual([]);
    });

    test("selecting the same recognised descent shows a detailed descent-only elevation chart with the correct accessible name, no marker and no overflow", async ({
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

      await forceMapStyleFailure(page);

      await page.goto("/");
      await importClimbThenDescentRoute(page);

      const chartTapTarget = page.locator("rect.elevation-chart-tap-target");
      const chartBox = await chartTapTarget.boundingBox();
      if (!chartBox)
        throw new Error("expected the elevation chart's tap target to be visible");
      await chartTapTarget.click({
        position: { x: chartBox.width * 0.9, y: chartBox.height / 2 },
      });

      const detailChart = page.getByRole("img", {
        name: "Elevation profile for selected recognised descent",
      });
      await expect(detailChart).toBeVisible();
      await expect(detailChart.locator("line.elevation-chart-marker")).toHaveCount(0);
      await expect(detailChart.locator("circle.elevation-chart-marker-dot")).toHaveCount(
        0,
      );
      await expect(detailChart.locator("path.elevation-chart-completed")).toHaveCount(0);

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

      expect(consoleErrors).toEqual([]);
    });

    test("the recognised-climb select renders at least 52px tall", async ({ page }) => {
      await forceMapStyleFailure(page);

      await page.goto("/");
      await importClimbThenDescentRoute(page);

      const select = page.getByRole("combobox", { name: "Recognised climbs" });
      const box = await select.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.height).toBeGreaterThanOrEqual(52);
    });

    test("Settings' 'Local gradient colours' disclosure shows the complete palette, independent of any open route, with no horizontal overflow at the narrow mobile viewport", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await forceMapStyleFailure(page);

      await page.goto("/");
      await page.getByRole("button", { name: "Settings" }).click();

      const summary = page.getByText("Local gradient colours", { exact: true });
      await expect(summary).toBeVisible();
      const disclosure = page.locator("details", { has: summary });
      await expect(disclosure).not.toHaveAttribute("open", "");

      await summary.click();
      // /^Hard climb/ excludes "Very hard climb", which also contains
      // "hard climb" as a case-insensitive substring.
      await expect(disclosure.getByText(/^Hard climb/)).toBeVisible();
      await expect(disclosure.getByText("Very steep descent")).toBeVisible();
      await expect(
        disclosure.getByText(
          "Blue intensity reflects gradient steepness only, not surface, bends, traffic or other conditions.",
        ),
      ).toBeVisible();

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(390);
    });

    test.describe("390x844 phone viewport", () => {
      test.use({ viewport: { width: 390, height: 844 } });

      test("both expanded local-gradient disclosures introduce no horizontal overflow, and reading order is unchanged", async ({
        page,
      }) => {
        await forceMapStyleFailure(page);

        await page.goto("/");
        await importClimbThenDescentRoute(page);

        const headingTexts = await page.locator("h1, h2").allTextContents();
        expect(headingTexts).toEqual([
          "climb-then-descent-route",
          "Route profile",
          "Recognised climbs",
        ]);

        await page
          .getByRole("combobox", { name: "Recognised climbs" })
          .selectOption({ index: 1 });
        await page.getByText("Local gradient colours on this climb").click();
        await expect(page.locator(".gradient-legend-entry").first()).toBeVisible();

        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        expect(scrollWidth).toBeLessThanOrEqual(390);

        await page
          .getByRole("combobox", { name: "Recognised climbs" })
          .selectOption({ index: 0 });
        const chartTapTarget = page.locator("rect.elevation-chart-tap-target");
        const chartBox = await chartTapTarget.boundingBox();
        if (!chartBox)
          throw new Error("expected the elevation chart's tap target to be visible");
        await chartTapTarget.click({
          position: { x: chartBox.width * 0.9, y: chartBox.height / 2 },
        });
        await expect(
          page.getByRole("img", {
            name: "Elevation profile for selected recognised descent",
          }),
        ).toBeVisible();
        await page.getByText("Local gradient colours on this descent").click();
        await expect(page.locator(".gradient-legend-entry").first()).toBeVisible();

        const scrollWidthWithDescent = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        expect(scrollWidthWithDescent).toBeLessThanOrEqual(390);

        const headingTextsAfter = await page.locator("h1, h2").allTextContents();
        expect(headingTextsAfter).toEqual(headingTexts);
      });
    });
  });
});
