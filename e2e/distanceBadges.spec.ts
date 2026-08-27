import { expect, test, type Locator, type Page } from "@playwright/test";
import { inflateSync as zlibInflateSync } from "node:zlib";
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Mirrors freeRoam.spec.ts's own identical helper — duplicated locally per
// this repo's established no-shared-e2e-helpers-across-specs convention.
function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Minimal, dependency-free PNG decoder for 8-bit, non-interlaced RGB
 * (colour type 2) or RGBA (colour type 6) — the two formats a Playwright
 * screenshot buffer actually uses. Copied from the proven precedent in
 * ridingSelectedFeatureSummary.spec.ts (backlog item 85) rather than
 * imported, per this repo's no-shared-e2e-helpers-across-specs convention. */
function decodePng(buf: Buffer): {
  width: number;
  height: number;
  pixels: Buffer;
  bytesPerPixel: number;
} {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `unsupported PNG format bitDepth=${String(bitDepth)} colorType=${String(colorType)}`,
    );
  }
  const raw = zlibInflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rawOffset + x];
      const a = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
      const b = y > 0 ? pixels[prevRowStart + x] : 0;
      const c =
        y > 0 && x >= bytesPerPixel ? pixels[prevRowStart + x - bytesPerPixel] : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = (rawByte + a) & 0xff;
          break;
        case 2:
          value = (rawByte + b) & 0xff;
          break;
        case 3:
          value = (rawByte + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = (rawByte + predictor) & 0xff;
          break;
        }
        default:
          throw new Error(`unsupported filter type ${String(filterType)}`);
      }
      pixels[rowStart + x] = value;
    }
    rawOffset += stride;
  }
  return { width, height, pixels, bytesPerPixel };
}

type DecodedImage = ReturnType<typeof decodePng>;

function pixelAt(img: DecodedImage, x: number, y: number): [number, number, number] {
  const idx = y * img.width * img.bytesPerPixel + x * img.bytesPerPixel;
  return [img.pixels[idx], img.pixels[idx + 1], img.pixels[idx + 2]];
}

function colourClose(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  tolerance: number,
): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance
  );
}

/** Fraction of pixels within [x0, x1) x [y0, y1) (image-pixel coordinates,
 * clamped to the image bounds) that are within `tolerance` of `expected`.
 * A coverage fraction, not a single sample point, so antialiasing at a
 * region's own boundary or a badge's rounded corners cannot flip the
 * result on a one-pixel fluke. */
function regionCoverage(
  img: DecodedImage,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  expected: readonly [number, number, number],
  tolerance: number,
): number {
  let matched = 0;
  let total = 0;
  for (
    let y = Math.max(0, Math.floor(y0));
    y < Math.min(img.height, Math.ceil(y1));
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(x0));
      x < Math.min(img.width, Math.ceil(x1));
      x += 1
    ) {
      total += 1;
      if (colourClose(pixelAt(img, x, y), expected, tolerance)) matched += 1;
    }
  }
  return total === 0 ? 0 : matched / total;
}

const BADGE_WHITE: [number, number, number] = [255, 255, 255];
const BADGE_DARK: [number, number, number] = [16, 16, 16]; // #101010
const PAINT_TOLERANCE = 24;
const PAINT_COVERAGE_THRESHOLD = 0.7;

/** Real composite-pixel evidence that a distance badge is genuinely
 * painted above the map, not merely present in the DOM with a non-null
 * bounding box (which a badge sunk behind the WebGL canvas would still
 * have). Crops exactly to the badge's own border box, then samples two
 * region types by coverage fraction rather than a single fragile pixel:
 * the left/right padding strips (guaranteed clear of the centred text and
 * the rounded corners, by construction of the fixed-padding box model)
 * for the white background fill, and the top/bottom border bands (also
 * clear of the corners) for the dark border. Both checks are paired with
 * a visible-vs-hidden comparison of the identical clip region — the
 * badge's own inline style is toggled off and restored in `finally` —
 * requiring the hidden crop's coverage of the badge's own colours to drop
 * substantially, and a substantial fraction of the whole crop to differ.
 * An identical visible/hidden crop, or unmoved coverage fractions, means
 * the DOM element is not actually contributing to the composite image. */
async function verifyBadgePaint(page: Page, badge: Locator): Promise<void> {
  // MapLibre's own .maplibregl-marker rule sets will-change: transform,
  // which promotes every marker to its own GPU-composited layer — after a
  // gesture that moves the camera (a drag-rotate in particular), the JS
  // camera-settle attributes and getBoundingClientRect() can both already
  // reflect the final state a frame or more before the compositor thread
  // has actually painted it, so a screenshot taken immediately afterwards
  // can still show the previous frame (confirmed empirically: an edge
  // coverage sample landing on stale background rather than the badge's
  // own border after a real rotation gesture). Two rendered frames is
  // enough to let the compositor catch up.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

  const box = await badge.boundingBox();
  if (!box) throw new Error("expected the distance badge to lay out");

  const style = await badge.evaluate((el) => {
    const computed = getComputedStyle(el);
    return {
      borderWidth: parseFloat(computed.borderTopWidth),
      paddingLeft: parseFloat(computed.paddingLeft),
      radius: parseFloat(computed.borderTopLeftRadius),
    };
  });

  const visibleCrop = await page.screenshot({ clip: box });
  const originalDisplay = await badge.evaluate((el) => el.style.display);
  let hiddenCrop: Buffer;
  try {
    await badge.evaluate((el) => {
      el.style.display = "none";
    });
    hiddenCrop = await page.screenshot({ clip: box });
  } finally {
    await badge.evaluate((el, original) => {
      el.style.display = original;
    }, originalDisplay);
  }

  const visibleImg = decodePng(visibleCrop);
  const hiddenImg = decodePng(hiddenCrop);

  const scaleX = visibleImg.width / box.width;
  const scaleY = visibleImg.height / box.height;
  const borderPxX = style.borderWidth * scaleX;
  const borderPxY = style.borderWidth * scaleY;
  const radiusPxX = style.radius * scaleX;
  const radiusPxY = style.radius * scaleY;
  const paddingPxX = style.paddingLeft * scaleX;

  const bgY0 = radiusPxY + borderPxY + 1;
  const bgY1 = visibleImg.height - radiusPxY - borderPxY - 1;
  const leftBgX0 = borderPxX + 1;
  const leftBgX1 = Math.max(leftBgX0 + 1, borderPxX + paddingPxX - 1);
  const rightBgX1 = visibleImg.width - borderPxX - 1;
  const rightBgX0 = Math.min(
    rightBgX1 - 1,
    visibleImg.width - borderPxX - paddingPxX + 1,
  );

  const edgeX0 = radiusPxX + 1;
  const edgeX1 = visibleImg.width - radiusPxX - 1;

  function backgroundCoverageOf(img: DecodedImage): number {
    return Math.max(
      regionCoverage(img, leftBgX0, leftBgX1, bgY0, bgY1, BADGE_WHITE, PAINT_TOLERANCE),
      regionCoverage(img, rightBgX0, rightBgX1, bgY0, bgY1, BADGE_WHITE, PAINT_TOLERANCE),
    );
  }

  // boundingBox() reports fractional CSS coordinates that do not always
  // line up with the screenshot's rasterised device-pixel rows (the same
  // gotcha documented in ridingSelectedFeatureSummary.spec.ts's own
  // expectBottomEdgePainted — confirmed here too: a badge with a
  // fractional box.y can shift the crop by a row, so row 0 is sometimes
  // background, not border). Rather than assume the border occupies a
  // fixed row range, scan a small bounded window of candidate single-row
  // bands near each edge and take the best-covered one — a genuine
  // border row spans nearly the full width at high coverage, while a
  // row shifted onto the background/corner transition covers only a
  // fraction of it, so this cannot be fooled into accepting the wrong row.
  function edgeCoverageOf(img: DecodedImage): number {
    const searchLimit = Math.min(4, Math.floor(img.height / 4));
    let best = 0;
    for (let step = 0; step <= searchLimit; step += 1) {
      const topCoverage = regionCoverage(
        img,
        edgeX0,
        edgeX1,
        step,
        step + 1,
        BADGE_DARK,
        PAINT_TOLERANCE,
      );
      const bottomCoverage = regionCoverage(
        img,
        edgeX0,
        edgeX1,
        img.height - 1 - step,
        img.height - step,
        BADGE_DARK,
        PAINT_TOLERANCE,
      );
      best = Math.max(best, topCoverage, bottomCoverage);
    }
    return best;
  }

  const visibleBackgroundCoverage = backgroundCoverageOf(visibleImg);
  const visibleEdgeCoverage = edgeCoverageOf(visibleImg);

  // The primary, absolute proof: a meaningful portion of the badge's own
  // fill and border colours is actually present in the composite image.
  expect(visibleBackgroundCoverage).toBeGreaterThan(PAINT_COVERAGE_THRESHOLD);
  expect(visibleEdgeCoverage).toBeGreaterThan(PAINT_COVERAGE_THRESHOLD);

  // The supporting, relative proof: hiding the exact same element visibly
  // changes the exact same clip, and the change is specifically a loss of
  // the badge's own colours — not merely offered as sufficient evidence on
  // its own, since a coincidentally similar background could produce an
  // identical crop for an unrelated reason.
  const hiddenBackgroundCoverage = backgroundCoverageOf(hiddenImg);
  const hiddenEdgeCoverage = edgeCoverageOf(hiddenImg);

  let differingPixels = 0;
  const totalPixels = visibleImg.width * visibleImg.height;
  for (let y = 0; y < visibleImg.height; y += 1) {
    for (let x = 0; x < visibleImg.width; x += 1) {
      if (
        !colourClose(pixelAt(visibleImg, x, y), pixelAt(hiddenImg, x, y), PAINT_TOLERANCE)
      ) {
        differingPixels += 1;
      }
    }
  }
  const diffFraction = differingPixels / totalPixels;

  expect(diffFraction).toBeGreaterThan(0.2);
  expect(hiddenBackgroundCoverage).toBeLessThan(visibleBackgroundCoverage - 0.3);
  expect(hiddenEdgeCoverage).toBeLessThan(visibleEdgeCoverage - 0.3);
}

/** Picks a badge whose border box does not overlap any waypoint marker or
 * map control cluster present on screen, so a paint proof never risks
 * sampling a coincidentally-overlapping element instead. Throws rather
 * than silently skipping if every badge overlaps something, since that
 * would mean the fixture needs adjusting, not the assertion relaxing. */
async function pickNonOverlappingBadge(page: Page): Promise<Locator> {
  const badges = page.locator(".distance-badge-marker");
  const badgeCount = await badges.count();
  const allBadgeBoxes: (Box | null)[] = [];
  for (let i = 0; i < badgeCount; i += 1) {
    allBadgeBoxes.push(await badges.nth(i).boundingBox());
  }
  const obstacleLocators = [
    page.locator(".planning-waypoint-marker"),
    page.locator(".planning-map-controls"),
    page.locator(".planning-map-zoom-controls"),
    page.locator(".planning-map-status-overlay"),
    page.locator(".map-status-overlay"),
    page.locator(".map-attribution"),
    page.locator(".ride-map-zoom-controls"),
    page.locator(".ride-map-camera-controls"),
    page.locator(".ride-map-paused-toast"),
    page.locator(".ride-climb-cue"),
    page.locator("header.riding-immersive-header"),
  ];
  const obstacleBoxes: Box[] = [];
  for (const locator of obstacleLocators) {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const box = await locator.nth(i).boundingBox();
      if (box) obstacleBoxes.push(box);
    }
  }

  // Bounds against the map container's own box, not the whole page
  // viewport: Planning's sticky header sits above the map, so a badge
  // whose projected position has moved above the map's own top edge
  // (confirmed empirically after a real 90° rotation: a badge landed at
  // y≈23, inside the header's nav icon, while the page viewport itself
  // happily starts at y=0) would wrongly pass a page-viewport-only check
  // despite not being within the map area — or the visible page — at all.
  const mapContainerBox = await page
    .locator('[data-testid="map-container"]')
    .boundingBox();

  for (let i = 0; i < badgeCount; i += 1) {
    const box = allBadgeBoxes[i];
    if (!box) continue;
    // A badge near the route's finish (or, in Riding, off the initial
    // camera framing) can lay out partially or fully outside the actual
    // map area — page.screenshot({ clip }) throws on that, so only a
    // fully on-screen candidate is usable for a paint proof.
    if (mapContainerBox) {
      const withinMapContainer =
        box.x >= mapContainerBox.x &&
        box.y >= mapContainerBox.y &&
        box.x + box.width <= mapContainerBox.x + mapContainerBox.width &&
        box.y + box.height <= mapContainerBox.y + mapContainerBox.height;
      if (!withinMapContainer) continue;
    }
    // Two badges can end up close enough on screen to overlap each other
    // (a coincidence merge only combines near-identical route distances;
    // it does not guarantee every remaining pair stays visually apart,
    // especially after a bearing rotation reshuffles screen positions) —
    // a candidate whose composite pixels would include a neighbouring
    // badge is not a clean sample either.
    const overlapsAnotherBadge = allBadgeBoxes.some(
      (other, j) => j !== i && other !== null && intersects(box, other),
    );
    if (overlapsAnotherBadge) continue;
    if (!obstacleBoxes.some((obstacle) => intersects(box, obstacle))) {
      return badges.nth(i);
    }
  }
  throw new Error(
    `expected at least one of ${String(badgeCount)} distance badges to be clear of every waypoint marker, control cluster and other badge, and fully within the map container`,
  );
}

/** Waits until every one of the map's own settled-camera attributes
 * (center, zoom and bearing) stops changing across two consecutive polls.
 * A badge's own DOM count can already be "stable" (waitForStableBadgeCount)
 * while its on-screen position is still mid-flight — e.g. Riding's
 * transition from the pre-ride overview into a rider-following view can
 * ease the camera for a while without crossing a rounded-zoom boundary,
 * so the badge interval (and therefore count) never changes even though
 * every boundingBox() read during that ease returns a different position;
 * a drag-rotate gesture, similarly, changes bearing without necessarily
 * moving the centre at all, so checking centre alone can report "settled"
 * while the bearing ease is still mid-flight (confirmed empirically: a
 * pixel sample taken right after mouse.up landed half inside the badge's
 * expected crop and half still background). A paint proof needs the
 * position itself to have actually settled, not just the count. */
async function waitForCameraSettled(page: Page): Promise<void> {
  const mapContainer = page.locator('[data-testid="map-container"]');
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const [center, zoom, bearing] = await Promise.all([
          mapContainer.getAttribute("data-camera-center"),
          mapContainer.getAttribute("data-camera-zoom"),
          mapContainer.getAttribute("data-camera-bearing"),
        ]);
        const current =
          center === null || zoom === null || bearing === null
            ? null
            : `${center}|${zoom}|${bearing}`;
        const stable = current !== null && current === previous;
        previous = current;
        return stable;
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBe(true);
}

/** Confirms it is actually valid to compare two elements' numeric
 * z-index values directly, rather than assuming it — a naive comparison
 * is only meaningful when nothing between either element and their
 * nearest common ancestor establishes its own stacking context (which
 * would compare that whole subtree as a single unit against the other
 * element instead of comparing the two elements' own z-index values
 * against each other). Walks both elements' ancestor chains up to their
 * common ancestor and checks every element strictly in between for the
 * common ways a stacking context is established (a non-static position
 * with a non-auto z-index, opacity below 1, a transform, a filter,
 * isolation, a non-normal mix-blend-mode, a layout/paint-affecting
 * will-change, or a layout/paint/strict/content containment). Not
 * exhaustive against every CSS mechanism that can create a stacking
 * context, but covers every mechanism this project's stylesheet or
 * MapLibre's own CSS actually uses. */
async function haveStackingSafeAncestry(
  page: Page,
  a: Locator,
  b: Locator,
): Promise<boolean> {
  const handleA = await a.elementHandle();
  const handleB = await b.elementHandle();
  if (!handleA || !handleB) {
    throw new Error("expected both elements to exist for an ancestry check");
  }
  return page.evaluate(
    ([elA, elB]) => {
      function establishesStackingContext(el: Element): boolean {
        const style = getComputedStyle(el);
        if (style.position !== "static" && style.zIndex !== "auto") return true;
        if (parseFloat(style.opacity) < 1) return true;
        if (style.transform !== "none") return true;
        if (style.filter !== "none") return true;
        if (style.isolation === "isolate") return true;
        if (style.mixBlendMode !== "normal") return true;
        if (
          style.willChange
            .split(",")
            .some((property) =>
              ["transform", "opacity", "filter"].includes(property.trim()),
            )
        ) {
          return true;
        }
        if (
          ["layout", "paint", "strict", "content"].some((keyword) =>
            style.contain.includes(keyword),
          )
        ) {
          return true;
        }
        return false;
      }
      function ancestorsOf(el: Element): Element[] {
        const chain: Element[] = [];
        let current = el.parentElement;
        while (current) {
          chain.push(current);
          current = current.parentElement;
        }
        return chain;
      }
      const ancestorsA = ancestorsOf(elA as Element);
      const ancestorsB = ancestorsOf(elB as Element);
      const common = ancestorsA.find((el) => ancestorsB.includes(el));
      if (!common)
        throw new Error("expected the two elements to share a common ancestor");
      const pathA = ancestorsA.slice(0, ancestorsA.indexOf(common));
      const pathB = ancestorsB.slice(0, ancestorsB.indexOf(common));
      return ![...pathA, ...pathB].some((el) => establishesStackingContext(el));
    },
    [handleA, handleB],
  );
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

  // A dedicated controlled-geometry route, rather than reusing the
  // click-driven route above: with no geolocation permission granted, a
  // fresh Planning session's default framing is wide enough that two
  // clicks ~450 screen-px apart resolve to a route hundreds of real
  // kilometres long, escalating to the full 24-badge cap all bunched into
  // that same short on-screen span — every badge ends up overlapping a
  // waypoint marker, which is a property of that test's incidental
  // geography, not something a paint proof should depend on. This test
  // instead pins the routed geometry to a known, real ~28 km separation
  // (mirroring the "Fallback and rotation" describe block's own approach
  // of returning fixed coordinates from the mocked ORS response
  // regardless of where the waypoints were actually clicked), so the
  // badges reliably spread across the full visible route and at least one
  // stays clear of both waypoint markers and every control cluster.
  test("renders a genuinely painted badge above normal map imagery", async ({ page }) => {
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

    await installLocalMapStyle(page);
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

    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 100, y: 100 } });
    await mapContainer.click({ position: { x: 400, y: 200 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    const summaryRegion = page.getByRole("region", { name: "Route summary" });
    await expect(summaryRegion).toBeVisible({ timeout: 15_000 });

    await waitForStableBadgeCount(page);

    // Real composite-pixel evidence, not merely DOM presence — this is
    // the fail-first proof for backlog item 84: a badge sunk behind the
    // WebGL canvas by a negative z-index still has DOM presence and a
    // non-null bounding box, so only sampling the actual painted pixels
    // can distinguish "present" from "visible".
    await verifyBadgePaint(page, await pickNonOverlappingBadge(page));

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

  test("changes the visible badge subset only after a real zoom-band change settles, keeping shared distances identical", async ({
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

    await installLocalMapStyle(page);

    // 80 km — long enough that the 10/20 km bands and the 5 km band are
    // each observable (7, 3 and 15 candidates respectively, all under
    // MAX_ACTIVE_DISTANCE_BADGES's cap of 24), without needing to reach
    // the 1 km band at all (which this route length would cap back down
    // to 5 km anyway, per distanceBadgeLayer.ts's own escalation rule).
    const zoomBandEastLon = FIXTURE_START_LON + 80_000 / FIXTURE_METRES_PER_DEGREE_LON;
    await page.route(ORS_URL_GLOB, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(
          buildMockOrsResponseForCoordinates([
            [FIXTURE_START_LON, FIXTURE_LAT, 10],
            [zoomBandEastLon, FIXTURE_LAT, 10],
          ]),
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

    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 100, y: 100 } });
    await mapContainer.click({ position: { x: 400, y: 200 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();
    await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
      timeout: 15_000,
    });

    await waitForStableBadgeCount(page);
    const initialKilometres = await getVisibleBadgeKilometres(page);
    const initialAriaLabels = new Set(
      await page
        .locator(".distance-badge-marker")
        .evaluateAll((elements) => elements.map((el) => el.getAttribute("aria-label"))),
    );

    // MapLibre's real KeyboardHandler (Shift+= requests a deterministic
    // +2 zoom levels per press) — mirrors lowZoomLegibility.spec.ts's own
    // documented choice over a synthetic wheel/drag gesture, and its same
    // "wait for data-camera-zoom to genuinely change" fix for a press
    // sent before the previous one's easeTo settled under load.
    const canvas = mapContainer.locator("canvas");
    await canvas.focus();
    let laterKilometres = initialKilometres;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      laterKilometres = await getVisibleBadgeKilometres(page);
      const changed =
        laterKilometres.length !== initialKilometres.length ||
        laterKilometres.some((km, index) => km !== initialKilometres[index]);
      if (changed) break;
      const zoomBefore = await mapContainer.getAttribute("data-camera-zoom");
      await page.keyboard.press("Shift+=");
      await expect
        .poll(() => mapContainer.getAttribute("data-camera-zoom"), { timeout: 2_000 })
        .not.toBe(zoomBefore);
      await waitForStableBadgeCount(page);
      laterKilometres = await getVisibleBadgeKilometres(page);
    }

    // A genuine band change occurred, settled, and produced a strictly
    // finer subset — not merely a different, unrelated one. 1/5/10/20 km
    // is a nested family (every coarser interval's multiples are also
    // multiples of every finer one), so every distance visible before
    // zooming in must still be present afterwards.
    expect(laterKilometres.length).toBeGreaterThan(initialKilometres.length);
    expect(initialKilometres.every((km) => laterKilometres.includes(km))).toBe(true);

    // Zooming changes only the displayed subset, never a shared
    // landmark's own identity — deliberately not asserting anything about
    // screen coordinates: projection legitimately moves a fixed
    // geographic point to a different pixel position as zoom changes. The
    // underlying fixed-route-coordinate invariant for a shared distance
    // is already proven at the unit level (distanceBadgeLayer.test.ts's
    // and MapView.test.tsx's own coincidence/identity suites); this only
    // confirms that identity survives a real end-to-end browser zoom.
    const laterAriaLabels = await page
      .locator(".distance-badge-marker")
      .evaluateAll((elements) => elements.map((el) => el.getAttribute("aria-label")));
    for (const label of initialAriaLabels) {
      expect(laterAriaLabels).toContain(label);
    }

    expect(consoleErrors).toEqual([]);
  });

  test("a waypoint marker stays visually above a badge that lands at the exact same point", async ({
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

    await installLocalMapStyle(page);

    // Body-aware, like the "updates badges after an edit..." test's own
    // proven-working mock: echoes back whatever coordinates were actually
    // requested for every calculation, including the later one triggered
    // by adding a third waypoint below.
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
    // Mirrors the "updates badges after an edit..." test's own proven
    // click positions exactly: a route's "Unknown surface" warning spans
    // its entire length (this mock never supplies surface data), and
    // Planning explicitly blocks placing or moving a waypoint while a
    // route/warning segment is selected — a click that lands precisely on
    // the thin rendered route line (as any position chosen to exactly
    // match a badge's own coordinate necessarily would) selects that
    // warning instead of adding a waypoint. These positions are known,
    // from that other test, to land in ordinary empty space instead.
    await mapContainer.click({ position: { x: 80, y: 100 } });
    await mapContainer.click({ position: { x: 400, y: 200 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();

    const summaryRegion = page.getByRole("region", { name: "Route summary" });
    await expect(summaryRegion).toBeVisible({ timeout: 15_000 });
    await waitForStableBadgeCount(page);

    const summaryTextBefore = await summaryRegion.innerText();
    await mapContainer.click({ position: { x: 250, y: 260 } });
    await expect(
      page.getByRole("button", { name: "Waypoint 3", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await summaryRegion.innerText()) !== summaryTextBefore, {
        timeout: 15_000,
      })
      .toBe(true);
    await waitForStableBadgeCount(page);

    // Any on-screen badge works: this test forces the overlap itself
    // rather than relying on a waypoint's own real coordinate having
    // landed exactly on one (see the note above on why that can't be
    // produced through ordinary interaction on a fully-warned route). A
    // fresh, click-driven route's default framing is wide enough that
    // many badges legitimately overlap a waypoint marker already (see
    // pickNonOverlappingBadge's own docs) — irrelevant here, since this
    // test forces its own overlap regardless, so only on-screen laid-out
    // matters, not clearance from other markers.
    const badgeLocators = page.locator(".distance-badge-marker");
    const badgeCountForSelection = await badgeLocators.count();
    const viewportForSelection = page.viewportSize();
    let targetBadge: Locator | null = null;
    for (let i = 0; i < badgeCountForSelection; i += 1) {
      const candidate = badgeLocators.nth(i);
      const box = await candidate.boundingBox();
      if (!box || !viewportForSelection) continue;
      const withinViewport =
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewportForSelection.width &&
        box.y + box.height <= viewportForSelection.height;
      if (withinViewport) {
        targetBadge = candidate;
        break;
      }
    }
    if (!targetBadge) {
      throw new Error(
        "expected at least one distance badge to lay out within the viewport",
      );
    }
    await expect(targetBadge).toBeVisible();
    // Deliberately targets "Waypoint 2" specifically, not the newly-added
    // third waypoint: adding it made the third point the new Finish,
    // styled white with a dark border (.planning-waypoint-marker--finish)
    // — visually identical to a badge's own white/dark colours, which
    // would make a "whose colour painted on top" pixel comparison
    // meaningless. Waypoint 2, now an ordinary interior point, keeps the
    // plain, unambiguous orange (#f2a900) base style.
    const plainWaypointMarker = page.getByRole("img", {
      name: "Waypoint 2",
      exact: true,
    });
    await expect(plainWaypointMarker).toBeVisible();

    const badgeBox = await targetBadge.boundingBox();
    const waypointBoxBefore = await plainWaypointMarker.boundingBox();
    if (!badgeBox || !waypointBoxBefore) {
      throw new Error("expected both the badge and the new waypoint marker to lay out");
    }

    // Forces the deterministic overlap this test needs via a temporary
    // inline transform on the waypoint marker (restored in `finally`,
    // mirroring the show/hide toggle verifyBadgePaint itself uses) —
    // this still exercises the real, live CSS stacking rules and produces
    // genuine composite pixels; it only supplies the geometric
    // precondition (two real markers occupying the same screen position)
    // that Planning's warning-selection gate makes impractical to reach
    // through ordinary map interaction on a route with no known surface
    // data anywhere along it.
    const dx =
      badgeBox.x +
      badgeBox.width / 2 -
      (waypointBoxBefore.x + waypointBoxBefore.width / 2);
    const dy =
      badgeBox.y +
      badgeBox.height / 2 -
      (waypointBoxBefore.y + waypointBoxBefore.height / 2);
    const originalTransform = await plainWaypointMarker.evaluate(
      (el) => el.style.transform,
    );
    try {
      await plainWaypointMarker.evaluate(
        (el, [tx, ty]) => {
          el.style.transform = `${el.style.transform} translate(${String(tx)}px, ${String(ty)}px)`;
        },
        [dx, dy],
      );

      const waypointBoxAfter = await plainWaypointMarker.boundingBox();
      if (!waypointBoxAfter) {
        throw new Error(
          "expected the waypoint marker to still lay out after the forced move",
        );
      }
      expect(intersects(badgeBox, waypointBoxAfter)).toBe(true);

      // Confirm a numeric z-index comparison between these two elements
      // is actually meaningful here (see haveStackingSafeAncestry) before
      // treating the pixel evidence below as attributable to that
      // comparison rather than some unrelated intervening stacking
      // context.
      expect(await haveStackingSafeAncestry(page, targetBadge, plainWaypointMarker)).toBe(
        true,
      );
      const waypointZIndex = await plainWaypointMarker.evaluate(
        (el) => getComputedStyle(el).zIndex,
      );
      const badgeZIndex = await targetBadge.evaluate((el) => getComputedStyle(el).zIndex);
      expect(Number(waypointZIndex)).toBeGreaterThan(Number(badgeZIndex));

      // The real, decisive evidence: sample the actual overlap region and
      // confirm the composite pixels show the waypoint marker's own fill
      // colour (#f2a900), not the badge's white background or dark
      // border — a numeric z-index comparison alone cannot prove which
      // element a real browser actually painted on top.
      const overlapBox = {
        x: Math.max(badgeBox.x, waypointBoxAfter.x),
        y: Math.max(badgeBox.y, waypointBoxAfter.y),
        width:
          Math.min(
            badgeBox.x + badgeBox.width,
            waypointBoxAfter.x + waypointBoxAfter.width,
          ) - Math.max(badgeBox.x, waypointBoxAfter.x),
        height:
          Math.min(
            badgeBox.y + badgeBox.height,
            waypointBoxAfter.y + waypointBoxAfter.height,
          ) - Math.max(badgeBox.y, waypointBoxAfter.y),
      };
      const overlapCrop = await page.screenshot({ clip: overlapBox });
      const overlapImg = decodePng(overlapCrop);
      // The waypoint marker is a circle with its own white border
      // (.planning-waypoint-marker's border, distinct from the badge's
      // dark one) and its own ordinal digit (dark-on-orange) both dilute
      // coverage over the whole crop — measured ~0.47 for a correctly-
      // painted marker (a circle's ~0.79 area fraction of its bounding
      // square, further reduced by the border and digit), never reaching
      // PAINT_COVERAGE_THRESHOLD (0.7, calibrated for a rectangular
      // badge's own clear interior) regardless of which element is really
      // on top. A markedly lower bar than that measured baseline still
      // clearly distinguishes "the waypoint is genuinely on top" (~0.47)
      // from "the badge is on top instead" (0, confirmed empirically
      // before this test's z-index fields were corrected).
      const WAYPOINT_OVERLAP_COVERAGE_THRESHOLD = 0.25;
      const waypointOrangeCoverage = regionCoverage(
        overlapImg,
        0,
        overlapImg.width,
        0,
        overlapImg.height,
        [0xf2, 0xa9, 0x00],
        PAINT_TOLERANCE,
      );
      expect(waypointOrangeCoverage).toBeGreaterThan(WAYPOINT_OVERLAP_COVERAGE_THRESHOLD);
    } finally {
      await plainWaypointMarker.evaluate((el, original) => {
        el.style.transform = original;
      }, originalTransform);
    }

    expect(consoleErrors).toEqual([]);
  });

  test("stays below every real map control/attribution overlay and never intercepts pointer input", async ({
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

    await installLocalMapStyle(page);
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
    await mapContainer.click({ position: { x: 80, y: 100 } });
    await mapContainer.click({ position: { x: 400, y: 200 } });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();
    await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
      timeout: 15_000,
    });
    await waitForStableBadgeCount(page);

    const badge = page.locator(".distance-badge-marker").first();
    await expect(badge).toBeVisible();

    expect(await badge.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

    const badgeZIndex = Number(await badge.evaluate((el) => getComputedStyle(el).zIndex));

    // Every real always-on Planning overlay this badge could ever need to
    // stay below. A numeric z-index comparison is only meaningful once
    // the ancestry between the two elements is confirmed to introduce no
    // intervening stacking context (haveStackingSafeAncestry) — see the
    // coincident-waypoint test above for the same caveat and why it
    // matters (a naive comparison can be right for the wrong reason).
    const overlaySelectors = [
      ".map-attribution",
      ".planning-map-controls",
      ".planning-map-zoom-controls",
    ];
    for (const selector of overlaySelectors) {
      const overlay = page.locator(selector).first();
      await expect(overlay).toBeVisible();
      const isAncestrySafe = await haveStackingSafeAncestry(page, badge, overlay);
      expect(isAncestrySafe).toBe(true);
      const overlayZIndex = Number(
        await overlay.evaluate((el) => getComputedStyle(el).zIndex),
      );
      expect(badgeZIndex).toBeLessThan(overlayZIndex);
    }

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

    const startRidingButton = page.getByRole("button", { name: "Start riding" });
    await expect(startRidingButton).toBeVisible();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    await waitForStableBadgeCount(page);
    await waitForCameraSettled(page);

    // Real paint evidence in Riding too, not just Planning — proved here
    // in the pre-ride, full-route overview (CLAUDE.md's "pre-ride
    // briefing and camera framing"), not after Start riding: the active
    // ride's own course-up, tightly-zoomed follow camera can legitimately
    // show no badge at all (a real ~45 km route's next interval marker
    // can be many kilometres ahead of a close single-position follow
    // view), so a "pick a visible one" assertion there would be flaky by
    // construction rather than testing anything real. The CSS mechanism
    // fixed here is identical in every context; the Planning and fallback
    // proofs already cover it directly, and this covers the distinct
    // pre-start/full-route Riding presentation.
    await verifyBadgePaint(page, await pickNonOverlappingBadge(page));

    await startRidingButton.click();
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

    // The cleanest fail-first signal of all: the fallback's flat, known
    // background colour is unambiguously distinct from the badge's own
    // white fill and dark border, so a badge sunk behind the canvas would
    // sample as the fallback colour, never white/dark, with no tolerance
    // ambiguity from map imagery.
    await verifyBadgePaint(page, await pickNonOverlappingBadge(page));

    expect(consoleErrors).toEqual([]);
  });

  test("retrying imagery does not duplicate badges", async ({ page }) => {
    const consoleErrors = await planLongRouteOnFallbackMap(page);

    const countBeforeRetry = await waitForStableBadgeCount(page);
    const textsBeforeRetry = (
      await page.locator(".distance-badge-marker").allTextContents()
    ).sort();
    await verifyBadgePaint(page, await pickNonOverlappingBadge(page));

    await page.getByTestId("retry-map-imagery-button").click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

    const countAfterRetry = await waitForStableBadgeCount(page);
    expect(countAfterRetry).toBe(countBeforeRetry);
    const textsAfterRetry = (
      await page.locator(".distance-badge-marker").allTextContents()
    ).sort();
    expect(textsAfterRetry).toEqual(textsBeforeRetry);

    // The reinstalled set is genuinely repainted, not just re-counted and
    // re-texted — re-selected fresh rather than reusing the pre-retry
    // Locator, since a retry may recreate the underlying marker elements.
    await verifyBadgePaint(page, await pickNonOverlappingBadge(page));

    expect(consoleErrors).toEqual([]);
  });

  test("badge labels stay upright and remain painted after the map is rotated", async ({
    page,
  }) => {
    const consoleErrors = await planLongRouteOnFallbackMap(page);

    await waitForStableBadgeCount(page);

    const badge = await pickNonOverlappingBadge(page);
    const boxBefore = await badge.boundingBox();
    if (!boxBefore) {
      throw new Error("expected a distance badge to lay out before rotation");
    }
    await verifyBadgePaint(page, badge);

    const mapContainer = page.locator('[data-testid="map-container"]');

    // MapLibre's own KeyboardHandler (Shift+ArrowRight triggers a single
    // fixed +15° easeTo through the ordinary camera-animation pipeline),
    // not a synthetic right-button drag through DragRotateHandler —
    // mirrors planning.spec.ts's own establishManualRotationAndPitch and
    // its documented rationale (CLAUDE.md future-backlog item 21): a real
    // drag's inertia/momentum decay is a known, pre-existing source of
    // flakiness in this exact codebase. The original width/height-only
    // assertion below tolerated a few pixels of leftover drift from that
    // decay; an exact pixel paint sample does not, and was confirmed
    // failing consistently and reproducibly with the drag gesture even
    // after settling on every camera attribute this file can observe —
    // the keyboard pipeline has no drag/inertia state machine to decay.
    const canvas = mapContainer.locator("canvas");
    await canvas.focus();
    // A single +15° press, not the original drag gesture's full ~90°
    // turn: this fallback route is wide and short, and the map area's own
    // aspect ratio is wider still, so a full 90° swap turns most of the
    // route's own on-screen extent vertical — taller than the map's own
    // shallow height — pushing every remaining badge outside the visible
    // map area entirely (confirmed empirically: after a full 90° turn,
    // neither of the two candidate badges stayed within the map
    // container's bounds at all). Any nonzero rotation that leaves a
    // screen-aligned marker's own box dimensions unchanged already proves
    // the invariant below; a modest turn keeps the route on-screen too.
    const bearingBeforePress = await mapContainer.getAttribute("data-camera-bearing");
    await page.keyboard.press("Shift+ArrowRight");
    await expect
      .poll(() => mapContainer.getAttribute("data-camera-bearing"))
      .not.toBe(bearingBeforePress);
    await waitForCameraSettled(page);

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

    // Real paint evidence, not just unchanged dimensions — a marker that
    // rotated along with the map but still happened to lay out at the
    // same size would pass the checks above while failing this one. Picks
    // fresh rather than reusing the exact pre-rotation badge: a bearing
    // change moves every marker's screen position by a different amount,
    // so the specific badge proved clear before rotation is not
    // guaranteed to still be clear of every other badge afterwards — the
    // width/height invariant above already proves that specific element
    // individually; this proves the general "a badge stays painted after
    // rotation" claim using whichever badge is genuinely clear now.
    await verifyBadgePaint(page, await pickNonOverlappingBadge(page));

    expect(consoleErrors).toEqual([]);
  });
});
