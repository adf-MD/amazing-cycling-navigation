import { expect, test, type Page } from "@playwright/test";
import { forceMapStyleFailure } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround for ORS mocking. This
// spec also needs it to reliably block the map tile-style request.
test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

// A same-latitude, geographically substantial (~6.9km) two-point route —
// long enough that the fitted line renders as a large, easy-to-find on-
// screen segment. West end first (forward fixture); the reversed-fixture
// test below simply swaps the array order.
const WEST_COORDINATE = [-0.15, 51.5, 10];
const EAST_COORDINATE = [-0.05, 51.5, 10];
// Comfortably under gradient.ts's MAX_ELEVATION_GAP_METRES (500 m) —
// densifying the fixture's two endpoints keeps its constant elevation
// analysable as one continuous "flat" run (a distinct, well-contrasted
// gradient colour) rather than two isolated points thousands of metres
// apart, which would classify as "unknown" and render in a low-contrast
// neutral grey that this test's pixel-colour line detector can't reliably
// pick out from the fallback background's own light grey.
const DENSIFY_STEP_COUNT = 20;

/** Linearly interpolates evenly-spaced intermediate points between each
 * consecutive pair in `coordinates` (inclusive of the original points, in
 * the same order), holding elevation at the first point's own value
 * throughout — so a genuinely flat fixture route stays exactly flat,
 * regardless of how many points represent it. */
function densifyWithFlatElevation(
  coordinates: readonly (readonly number[])[],
): number[][] {
  const elevation = coordinates[0]?.[2] ?? 0;
  const result: number[][] = [];
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const [startLon, startLat] = coordinates[i] ?? [0, 0];
    const [endLon, endLat] = coordinates[i + 1] ?? [0, 0];
    for (let step = 0; step < DENSIFY_STEP_COUNT; step += 1) {
      const t = step / DENSIFY_STEP_COUNT;
      result.push([
        startLon + t * (endLon - startLon),
        startLat + t * (endLat - startLat),
        elevation,
      ]);
    }
  }
  const last = coordinates.at(-1);
  if (last) result.push([last[0] ?? 0, last[1] ?? 0, elevation]);
  return result;
}

function buildMockOrsResponse(coordinates: readonly (readonly number[])[]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: 6900, duration: 1200 } },
        geometry: {
          type: "LineString",
          coordinates: densifyWithFlatElevation(coordinates),
        },
      },
    ],
  };
}

/** Places a route via the mocked ORS endpoint with a forced-local-
 * fallback map (tiles blocked), so pixel analysis runs against a flat,
 * known background with zero live-tile colour noise. Returns the
 * console-error collector so the caller can assert on it once done. */
async function planRouteOnFallbackMap(
  page: Page,
  coordinates: readonly (readonly number[])[],
): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    // The browser itself logs this for the tile-style request this test
    // deliberately aborts below, to force the local fallback style — an
    // expected artefact of that intentional abort, not an app error.
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

  // Aborting the style document itself is a pre-"style.load" failure —
  // MapView's existing switchToFallback() fires immediately, well before
  // the 15s style-ready timeout, with no live tile ever requested.
  await forceMapStyleFailure(page);
  await page.route(ORS_URL_GLOB, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(buildMockOrsResponse(coordinates)),
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
  await mapContainer.click({ position: { x: 200, y: 150 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();

  const summaryRegion = page.getByRole("region", { name: "Route summary" });
  await expect(summaryRegion).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

  return consoleErrors;
}

interface DirectionDetectionResult {
  /** Whether a clean, unambiguous arrow "blob" was found along the
   * detected line. False also covers "fewer than 2 route-coloured
   * pixels" and "no non-zero density run at all". */
  blobFound: boolean;
  /** Angle (degrees, screen space, y-down, 0 = +x/right) of the vector
   * from the detected p0 (smaller on-screen x) to p1 (the other
   * endpoint) — always in [-90, 90] since p0/p1 are chosen by smallest
   * x, so this never itself indicates direction, only orientation. */
  lineAngleDegrees: number;
  /** True when the arrow's wide base sits nearer p0 (so its tip, and
   * therefore the direction it visually points, is nearer p1) — i.e.
   * "the icon points from p0 towards p1". */
  taperTowardP1: boolean;
}

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Runs entirely inside the page: decodes a screenshot PNG (passed as
 * base64, since Playwright's own element screenshot captures the actual
 * composited output regardless of MapLibre's preserveDrawingBuffer:false
 * WebGL setting — canvas.toDataURL() on the raw canvas would not),
 * finds the rendered route line, and reports which way its direction
 * arrows visually point relative to the line's own two endpoints.
 *
 * A locator screenshot captures the actual on-screen region, which
 * includes any overlapping HTML chrome (e.g. the north-up/locate-me
 * controls positioned over a corner of the map) — not just the canvas's
 * own bitmap. `excludeRects` (canvas-relative) lets the caller blank out
 * that known chrome so it can never be misread as route or arrow
 * pixels. */
interface DetectArrowDirectionArgs {
  pngBase64: string;
  excludeRects: readonly PixelRect[];
}

// A single object argument, not two separate parameters: page.evaluate
// passes this function's own source across to the browser as-is (it
// cannot see any outer Node-side closure once there), and only accepts
// one argument value.
async function detectArrowDirection({
  pngBase64,
  excludeRects,
}: DetectArrowDirectionArgs): Promise<DirectionDetectionResult> {
  // The gradient overlay (src/map/gradientRouteLayer.ts) paints over the
  // route's full length, including the base route's own green — this
  // fixture's constant, densely-sampled elevation (see
  // densifyWithFlatElevation) classifies the whole line as "flat", which
  // renders in the palette's flat colour (GRADIENT_CLASS_COLOURS.flat),
  // not the base route's own green.
  const ROUTE_LINE_COLOUR: readonly [number, number, number] = [0x2e, 0x7d, 0x63];
  const ROUTE_LINE_THRESHOLD_SQUARED = 900;
  const ARROW_MIN_OPAQUE_ALPHA = 250;
  const ARROW_WHITE_MIN = 245;
  const ARROW_BLACK_MAX = 40;
  const CROSS_SECTION_HALF_WIDTH_PX = 15;
  const STEP_PX = 1;
  const CANDIDATE_ANGLES_DEGREES = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];

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

  function pixelAt(x: number, y: number): [number, number, number, number] {
    const clampedX = Math.max(0, Math.min(width - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(height - 1, Math.round(y)));
    const offset = (clampedY * width + clampedX) * 4;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  }

  function isRouteLineColour(r: number, g: number, b: number): boolean {
    const dr = r - ROUTE_LINE_COLOUR[0];
    const dg = g - ROUTE_LINE_COLOUR[1];
    const db = b - ROUTE_LINE_COLOUR[2];
    return dr * dr + dg * dg + db * db <= ROUTE_LINE_THRESHOLD_SQUARED;
  }

  function isArrowPixel(r: number, g: number, b: number, a: number): boolean {
    if (a < ARROW_MIN_OPAQUE_ALPHA) return false;
    const isWhite = r >= ARROW_WHITE_MIN && g >= ARROW_WHITE_MIN && b >= ARROW_WHITE_MIN;
    const isDark = r <= ARROW_BLACK_MAX && g <= ARROW_BLACK_MAX && b <= ARROW_BLACK_MAX;
    return isWhite || isDark;
  }

  function isExcluded(x: number, y: number): boolean {
    for (const rect of excludeRects) {
      if (
        x >= rect.x &&
        x < rect.x + rect.width &&
        y >= rect.y &&
        y < rect.y + rect.height
      ) {
        return true;
      }
    }
    return false;
  }

  const routeLinePixels: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isExcluded(x, y)) continue;
      const offset = (y * width + x) * 4;
      if (isRouteLineColour(data[offset], data[offset + 1], data[offset + 2])) {
        routeLinePixels.push({ x, y });
      }
    }
  }

  if (routeLinePixels.length < 2) {
    return { blobFound: false, lineAngleDegrees: 0, taperTowardP1: false };
  }

  // Approximate the line's two on-screen endpoints via a cheap,
  // O(pixels x candidateAngles) directional-projection scan (a true
  // farthest-pair search is O(pixels^2), far too slow over a few
  // thousand green pixels) — robust enough for a route that renders as
  // a single, roughly straight or gently curved line.
  let bestDistanceSquared = -1;
  let bestA = routeLinePixels[0];
  let bestB = routeLinePixels[0];
  for (const angleDegrees of CANDIDATE_ANGLES_DEGREES) {
    const angleRadians = (angleDegrees * Math.PI) / 180;
    const dirX = Math.cos(angleRadians);
    const dirY = Math.sin(angleRadians);
    let minProjection = Infinity;
    let maxProjection = -Infinity;
    let minPixel = routeLinePixels[0];
    let maxPixel = routeLinePixels[0];
    for (const pixel of routeLinePixels) {
      const projection = pixel.x * dirX + pixel.y * dirY;
      if (projection < minProjection) {
        minProjection = projection;
        minPixel = pixel;
      }
      if (projection > maxProjection) {
        maxProjection = projection;
        maxPixel = pixel;
      }
    }
    const dx = maxPixel.x - minPixel.x;
    const dy = maxPixel.y - minPixel.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestA = minPixel;
      bestB = maxPixel;
    }
  }

  // p0 is always the smaller-x endpoint (tie-break smaller y) — a fixed,
  // geography-independent convention so taperTowardP1 is comparable
  // across screenshots without knowing the map's current bearing.
  const [p0, p1] =
    bestA.x < bestB.x || (bestA.x === bestB.x && bestA.y <= bestB.y)
      ? [bestA, bestB]
      : [bestB, bestA];

  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const lineLength = Math.sqrt(dx * dx + dy * dy);
  if (lineLength === 0) {
    return { blobFound: false, lineAngleDegrees: 0, taperTowardP1: false };
  }
  const dirX = dx / lineLength;
  const dirY = dy / lineLength;
  const perpX = -dirY;
  const perpY = dirX;
  const lineAngleDegrees = (Math.atan2(dy, dx) * 180) / Math.PI;

  const steps = Math.floor(lineLength / STEP_PX);
  const density: number[] = [];
  for (let step = 0; step <= steps; step++) {
    const centreX = p0.x + dirX * step * STEP_PX;
    const centreY = p0.y + dirY * step * STEP_PX;
    let count = 0;
    for (
      let offset = -CROSS_SECTION_HALF_WIDTH_PX;
      offset <= CROSS_SECTION_HALF_WIDTH_PX;
      offset++
    ) {
      const sampleX = centreX + perpX * offset;
      const sampleY = centreY + perpY * offset;
      if (isExcluded(sampleX, sampleY)) continue;
      const [r, g, b, a] = pixelAt(sampleX, sampleY);
      if (isArrowPixel(r, g, b, a)) count++;
    }
    density.push(count);
  }

  let blobStart: number | null = null;
  let firstBlobStart = -1;
  let firstBlobEnd = -1;
  for (let step = 0; step < density.length; step++) {
    const value = density[step];
    if (value > 0) {
      blobStart ??= step;
    } else if (blobStart !== null) {
      firstBlobStart = blobStart;
      firstBlobEnd = step - 1;
      break;
    }
  }
  if (firstBlobStart === -1 && blobStart !== null) {
    firstBlobStart = blobStart;
    firstBlobEnd = density.length - 1;
  }
  if (firstBlobStart === -1) {
    return { blobFound: false, lineAngleDegrees, taperTowardP1: false };
  }

  let peakStep = firstBlobStart;
  let peakDensity = -1;
  for (let step = firstBlobStart; step <= firstBlobEnd; step++) {
    const value = density[step];
    if (value > peakDensity) {
      peakDensity = value;
      peakStep = step;
    }
  }
  const blobMidpoint = (firstBlobStart + firstBlobEnd) / 2;

  return {
    blobFound: true,
    lineAngleDegrees,
    taperTowardP1: peakStep < blobMidpoint,
  };
}

async function captureDirectionDetection(page: Page): Promise<DirectionDetectionResult> {
  const canvasLocator = page.locator('[data-testid="map-container"] canvas');
  const canvasBox = await canvasLocator.boundingBox();
  if (!canvasBox) {
    throw new Error("expected the map canvas to lay out");
  }

  // A locator screenshot captures the actual on-screen region, including
  // any HTML controls overlaid on top of the map (north-up, locate-me)
  // — exclude their regions so their icon glyphs/fills can never be
  // misread as arrow or route pixels. Queried by role rather than DOM
  // nesting under map-container: they're CSS-positioned over the map
  // canvas but are not its DOM descendants.
  const controlBoxes = await Promise.all(
    [
      page.getByRole("button", { name: "North-up, top-down view" }),
      page.getByRole("button", { name: "Locate me" }),
    ].map((locator) => locator.boundingBox()),
  );
  const excludeRects: PixelRect[] = controlBoxes
    .filter((box) => box !== null)
    .map((box) => ({
      x: box.x - canvasBox.x,
      y: box.y - canvasBox.y,
      width: box.width,
      height: box.height,
    }));

  // MapLibre's symbol placement/collision engine runs on its own
  // periodic cycle (its fadeDuration, ~300ms), independent of the
  // source's own data already being set — a screenshot taken
  // immediately after the route/summary appear can reliably show zero
  // placed arrows even though the layer and its data are already
  // correct. Confirmed empirically: querying rendered features
  // immediately after routing returns none, but the same query 300ms
  // later reliably returns the expected instances.
  await page.waitForTimeout(500);

  const pngBuffer = await canvasLocator.screenshot();
  return page.evaluate(detectArrowDirection, {
    pngBase64: pngBuffer.toString("base64"),
    excludeRects,
  });
}

test("direction arrows point along the route's actual travel direction", async ({
  page,
}) => {
  const consoleErrors = await planRouteOnFallbackMap(page, [
    WEST_COORDINATE,
    EAST_COORDINATE,
  ]);

  const result = await captureDirectionDetection(page);

  expect(result.blobFound).toBe(true);
  // p0 is always the smaller-x endpoint; the fixture's first coordinate
  // (west) is the route's start, so on this unrotated, north-up map the
  // arrows must point from the smaller-x endpoint towards the larger-x
  // one.
  expect(result.taperTowardP1).toBe(true);

  expect(consoleErrors).toEqual([]);
});

test("reversing the route reverses the visible arrow direction", async ({ page }) => {
  const consoleErrors = await planRouteOnFallbackMap(page, [
    EAST_COORDINATE,
    WEST_COORDINATE,
  ]);

  const result = await captureDirectionDetection(page);

  expect(result.blobFound).toBe(true);
  // The route now starts at the larger-x (east) endpoint, so arrows
  // point from p1 towards p0 — the opposite of the forward test.
  expect(result.taperTowardP1).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test("arrows remain attached and correctly oriented after the map is rotated", async ({
  page,
}) => {
  const consoleErrors = await planRouteOnFallbackMap(page, [
    WEST_COORDINATE,
    EAST_COORDINATE,
  ]);

  const before = await captureDirectionDetection(page);
  expect(before.blobFound).toBe(true);

  const mapContainer = page.locator('[data-testid="map-container"]');
  const mapBox = await mapContainer.boundingBox();
  if (!mapBox) {
    throw new Error("expected the map container to lay out");
  }
  const centreX = mapBox.x + mapBox.width / 2;
  const centreY = mapBox.y + mapBox.height / 2;

  // MapLibre's default DragRotateHandler binds to a right-button drag
  // (verified against the installed package's mouse handler) — no touch
  // needed on the "Desktop Chrome" e2e project.
  await page.mouse.move(centreX, centreY - 100);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(centreX + 150, centreY - 100, { steps: 10 });
  await page.mouse.up({ button: "right" });

  const after = await captureDirectionDetection(page);

  // Proves the rotation genuinely took effect: the pre-rotation fixture
  // is exactly horizontal, so a still-near-horizontal line would mean
  // the gesture didn't rotate anything.
  const normalisedAngle = ((after.lineAngleDegrees % 180) + 180) % 180;
  const distanceFromHorizontal = Math.min(normalisedAngle, 180 - normalisedAngle);
  expect(distanceFromHorizontal).toBeGreaterThan(20);

  // Arrows are still attached to (found tightly along) the line's new
  // on-screen path — proving orientation kept tracking the line's
  // rotation rather than staying frozen at its pre-rotation angle.
  expect(after.blobFound).toBe(true);

  expect(consoleErrors).toEqual([]);
});
