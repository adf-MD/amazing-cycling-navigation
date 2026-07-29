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
// MIN_SEGMENT_LENGTH_METRES), so both halves classify cleanly and
// consistently as "flat" and "very-steep-climb".
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
 * decode over canvas.toDataURL), then counts pixels close to the "flat"
 * and "very-steep-climb" gradient palette colours (src/navigation/
 * gradientPalette.ts) and each colour's mean on-screen x — enough to
 * prove both classes render, and that they appear in the expected west
 * (flat) → east (climb) order, without needing a full line-orientation
 * detector like the direction-arrow spec's (gradient colour identity
 * itself already tells the two apart, unlike a single-colour arrow). */
interface GradientColourSample {
  flatPixelCount: number;
  climbPixelCount: number;
  flatCentroidX: number;
  climbCentroidX: number;
}

async function sampleGradientColours({
  pngBase64,
}: {
  pngBase64: string;
}): Promise<GradientColourSample> {
  const FLAT_COLOUR: readonly [number, number, number] = [0x2e, 0x7d, 0x63];
  const CLIMB_COLOUR: readonly [number, number, number] = [0x5b, 0x3f, 0xa6];
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

  let flatCount = 0;
  let flatSumX = 0;
  let climbCount = 0;
  let climbSumX = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (closeTo(r, g, b, FLAT_COLOUR)) {
        flatCount++;
        flatSumX += x;
      } else if (closeTo(r, g, b, CLIMB_COLOUR)) {
        climbCount++;
        climbSumX += x;
      }
    }
  }

  return {
    flatPixelCount: flatCount,
    climbPixelCount: climbCount,
    flatCentroidX: flatCount > 0 ? flatSumX / flatCount : -1,
    climbCentroidX: climbCount > 0 ? climbSumX / climbCount : -1,
  };
}

async function captureGradientColourSample(page: Page): Promise<GradientColourSample> {
  const canvasLocator = page.locator('[data-testid="map-container"] canvas');
  // Mirrors directionArrows.spec.ts's own settle wait — MapLibre's paint/
  // placement cycle runs independently of the source data already being
  // set.
  await page.waitForTimeout(500);
  const pngBuffer = await canvasLocator.screenshot();
  return page.evaluate(sampleGradientColours, {
    pngBase64: pngBuffer.toString("base64"),
  });
}

test.describe("Planning", () => {
  test("map gradient colours agree with the elevation profile's legend, flat and climb visually distinct", async ({
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

    // The elevation profile (now shown in Planning too) and its legend
    // agree with the map: both the flat and very-steep-climb bands are
    // present.
    await expect(
      summaryRegion.getByRole("img", { name: "Elevation profile chart" }),
    ).toBeVisible();
    await expect(page.getByText(/Flat \(/)).toBeVisible();
    await expect(page.getByText(/Very steep climb \(/)).toBeVisible();

    const sample = await captureGradientColourSample(page);
    expect(sample.flatPixelCount).toBeGreaterThan(0);
    expect(sample.climbPixelCount).toBeGreaterThan(0);
    // The fixture's flat section is the west (start) half and the climb
    // is the east (finish) half — an unrotated, north-up map keeps west
    // at a smaller on-screen x.
    expect(sample.flatCentroidX).toBeLessThan(sample.climbCentroidX);

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Riding", () => {
  test("mutes the completed flat section while keeping the remaining climb gradient-coloured", async ({
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

    const beforeAdvancing = await captureGradientColourSample(page);
    expect(beforeAdvancing.flatPixelCount).toBeGreaterThan(0);
    expect(beforeAdvancing.climbPixelCount).toBeGreaterThan(0);

    // Advances just past the flat/climb boundary, so the entire flat
    // section is now behind the rider (completed, muted grey) while the
    // climb remains fully ahead (remaining, gradient-coloured) — the
    // gradient overlay uses the same live matchedDistanceFromStartMetres
    // as the route line/arrows, so this must track immediately.
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_START_METRES + 50),
    });

    await expect
      .poll(
        async () => {
          const sample = await captureGradientColourSample(page);
          return sample.flatPixelCount;
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toBeLessThan(beforeAdvancing.flatPixelCount);

    const afterAdvancing = await captureGradientColourSample(page);
    expect(afterAdvancing.climbPixelCount).toBeGreaterThan(0);

    expect(consoleErrors).toEqual([]);
  });
});
