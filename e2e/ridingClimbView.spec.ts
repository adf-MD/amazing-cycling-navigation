import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { inflateSync as zlibInflateSync } from "node:zlib";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround for ORS mocking. This
// spec also needs it to reliably serve the local map style.
test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/two-climbs-route.gpx", import.meta.url),
);

// Matches two-climbs-route.gpx: a flat lead-in, a first climb (~460-1180 m,
// uncategorised), a short reversal dip too brief to register as its own
// recognised descent, a second, steeper climb (~1440-2500 m, category-3),
// and a flat tail. Exact boundaries are smoothing-driven edge rounding
// (see gradientColouring.spec.ts's own comment on a similarly-shaped
// fixture) — verified directly against the app's real detectRouteFeatures
// output while building this fixture, not hand-estimated from the GPX's
// own keyframe distances.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const FIXTURE_LAT = 51.5;
const FIXTURE_START_LON = -0.08;
const BEFORE_CLIMB_1_METRES = 200;
const CLIMB_1_MID_METRES = 800;
const CLIMB_2_MID_METRES = 2000;

function lonAtMetresAlongFixture(distanceMetres: number): number {
  return FIXTURE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

/** Mirrors ridingMapProfileViews.spec.ts's own identically-named helpers —
 * duplicated locally per this repo's no-shared-e2e-helpers convention. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

/** Every riding map overlay uses this same inset from the map's own edges
 * (see .ride-map-zoom-controls/.ride-map-camera-controls/.map-attribution
 * and, for backlog item 115, .ride-climb-cue's own right inset). */
const MAP_OVERLAY_INSET_PX = 8;

/** Backlog item 115: how much clear space either side of the PAINTED route
 * ahead the cue must leave. Deliberately wider than the route's own painted
 * line and its direction-arrow glyphs together (measured as a ~40px band on
 * this fixture), so that "clear of the route ahead" means genuine glancing
 * room rather than merely not touching the ink. */
const ROUTE_CORRIDOR_SAFETY_BAND_PX = 24;

/** Backlog item 115: mirrors the `@container ride-map-overlay
 * (min-height: 14rem)` condition in src/index.css at the 16px root font
 * size these tests run at. Only ever used to DERIVE viewport heights that
 * land comfortably either side of it — never asserted against on its own,
 * which would merely restate the constant. */
const BOTTOM_PLACEMENT_MIN_MAP_HEIGHT_PX = 14 * 16;

/** Comfortably clear of the threshold in both directions, so neither
 * straddling case is decided by a subpixel rounding difference. */
const THRESHOLD_STRADDLE_MARGIN_PX = 36;

/** Minimal, dependency-free PNG decoder for 8-bit, non-interlaced RGB
 * (colour type 2) or RGBA (colour type 6) — the two formats a Playwright
 * screenshot buffer actually uses. Copied from the proven precedent in
 * distanceBadges.spec.ts/ridingSelectedFeatureSummary.spec.ts rather than
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

/**
 * Backlog item 115. Captures the map's own PAINTED content with every DOM
 * overlay temporarily hidden, so that what is measured afterwards is the
 * MapLibre canvas alone — the route line, its direction arrows and the
 * rider's position marker — and never the very chrome whose placement is
 * under test. Mirrors distanceBadges.spec.ts's own visible/hidden crop
 * pairing. Restores visibility before returning, whatever happens.
 */
async function captureMapPaint(
  page: Page,
  mapContainer: Locator,
): Promise<{ image: DecodedImage; scale: number; origin: { x: number; y: number } }> {
  const mapBox = await mapContainer.boundingBox();
  if (!mapBox) throw new Error("expected the map container to have a bounding box");
  const OVERLAY_SELECTORS = [
    // Both the slot and the cue itself, so that a build in which the cue is
    // NOT wrapped (any earlier implementation this test is measured
    // against) is captured just as cleanly.
    ".ride-climb-cue-slot",
    ".ride-climb-cue",
    ".ride-map-zoom-controls",
    ".ride-map-camera-controls",
    ".ride-map-paused-toast",
    ".map-attribution",
    ".map-status-overlay",
  ];
  await page.evaluate((selectors) => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        element.style.visibility = "hidden";
      }
    }
  }, OVERLAY_SELECTORS);
  try {
    const shot = await page.screenshot({ clip: mapBox });
    const image = decodePng(shot);
    return {
      image,
      scale: image.width / mapBox.width,
      origin: { x: mapBox.x, y: mapBox.y },
    };
  } finally {
    await page.evaluate((selectors) => {
      for (const selector of selectors) {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          element.style.visibility = "";
        }
      }
    }, OVERLAY_SELECTORS);
  }
}

/** The most frequent colour in a decoded image. The specs in this file
 * serve a sourceless local style, so the map's own backdrop is a single
 * flat colour — reading it off the image itself avoids hard-coding either
 * the style's or the palette's own values anywhere. */
function modalColour(img: DecodedImage): [number, number, number] {
  const counts = new Map<number, number>();
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const [r, g, b] = pixelAt(img, x, y);
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return [(bestKey >> 16) & 0xff, (bestKey >> 8) & 0xff, bestKey & 0xff];
}

function colourDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** A bounding box over every pixel the predicate accepts, expressed in page
 * CSS pixels. Returns null when nothing matched, so callers can assert that
 * their probe genuinely found something rather than silently proving
 * nothing. */
function paintedExtent(
  capture: { image: DecodedImage; scale: number; origin: { x: number; y: number } },
  region: { x0: number; y0: number; x1: number; y1: number },
  accept: (rgb: [number, number, number]) => boolean,
): { box: Box; pixelCount: number } | null {
  const { image, scale, origin } = capture;
  const px0 = Math.max(0, Math.floor(region.x0 * scale));
  const py0 = Math.max(0, Math.floor(region.y0 * scale));
  const px1 = Math.min(image.width - 1, Math.ceil(region.x1 * scale));
  const py1 = Math.min(image.height - 1, Math.ceil(region.y1 * scale));
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pixelCount = 0;
  for (let y = py0; y <= py1; y += 1) {
    for (let x = px0; x <= px1; x += 1) {
      if (!accept(pixelAt(image, x, y))) continue;
      pixelCount += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (pixelCount === 0) return null;
  return {
    pixelCount,
    box: {
      x: origin.x + minX / scale,
      y: origin.y + minY / scale,
      width: (maxX - minX + 1) / scale,
      height: (maxY - minY + 1) / scale,
    },
  };
}

/**
 * backlog item 82: proves the climb cue's title/detail text is genuinely
 * readable, not merely present in the DOM. scrollWidth<=clientWidth alone
 * only proves horizontal containment, not that wrapped text is fully
 * visible vertically — so this also checks (a) computed style no longer
 * clips via overflow:hidden/text-overflow:ellipsis (proves the intended
 * CSS actually shipped, mirroring item 85's own pairing of computed-style
 * with geometry evidence) and (b) both text elements' own bounding boxes
 * are fully contained within the cue's own box, proving no vertical
 * overflow/clipping either.
 */
async function expectClimbCueTextFullyReadable(page: Page): Promise<void> {
  const cue = page.locator(".ride-climb-cue");
  const title = page.locator(".ride-climb-cue-title");
  const detail = page.locator(".ride-climb-cue-detail");

  const [cueBox, titleBox, detailBox, titleStyle, detailStyle] = await Promise.all([
    cue.boundingBox(),
    title.boundingBox(),
    detail.boundingBox(),
    title.evaluate((element) => {
      const style = getComputedStyle(element);
      return { overflow: style.overflow, textOverflow: style.textOverflow };
    }),
    detail.evaluate((element) => {
      const style = getComputedStyle(element);
      return { overflow: style.overflow, textOverflow: style.textOverflow };
    }),
  ]);

  if (!cueBox || !titleBox || !detailBox) {
    throw new Error(
      "expected the climb cue and its text elements to have bounding boxes",
    );
  }

  expect(titleStyle.overflow).not.toBe("hidden");
  expect(titleStyle.textOverflow).not.toBe("ellipsis");
  expect(detailStyle.overflow).not.toBe("hidden");
  expect(detailStyle.textOverflow).not.toBe("ellipsis");

  expect(isFullyWithin(titleBox, cueBox)).toBe(true);
  expect(isFullyWithin(detailBox, cueBox)).toBe(true);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
}

// backlog item 80: the fixed 4-slot active grid zeroes elevation-window-
// group's own inline padding and switches the selected ring (and the
// focus-visible outline) to an inset treatment so neither can protrude
// past the button's own border box — together these let the group's own
// edge and the selected button's own edge coincide exactly, satisfying
// "flush with the shared Profile content edge" without reintroducing item
// 76's clipping bug (previously guarded by an 8px group inset plus an
// outward ring, checked via RING_SPREAD_PX). Playwright's boundingBox()
// excludes box-shadow/outline entirely, so the inset-vs-outward distinction
// is confirmed separately via computed style. Mirrors
// ridingElevationWindows.spec.ts's and ridingMapProfileViews.spec.ts's own
// identically-purposed helper, duplicated locally per this repo's
// no-shared-e2e-helpers convention.
const FLUSH_TOLERANCE_PX = 0.5;

async function expectSelectedButtonFlushWithGroupEdge(
  page: Page,
  edge: "left" | "right",
): Promise<void> {
  const group = page.getByRole("group", { name: "Elevation profile view" });
  const selectedButton = group.locator(".elevation-window-button.is-selected");
  const groupBox = await group.boundingBox();
  const selectedBox = await selectedButton.boundingBox();
  if (!groupBox || !selectedBox) {
    throw new Error(
      "expected both the elevation-window group and its selected button to have a bounding box",
    );
  }
  const delta =
    edge === "left"
      ? Math.abs(selectedBox.x - groupBox.x)
      : Math.abs(selectedBox.x + selectedBox.width - (groupBox.x + groupBox.width));
  expect(delta).toBeLessThanOrEqual(FLUSH_TOLERANCE_PX);
  const boxShadow = await selectedButton.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(boxShadow).toContain("inset");
}

/** Shared import → Start riding flow, reused by both the main flow test and
 * the phone-viewport geometry test below — mirrors
 * ridingMapProfileViews.spec.ts's own importAndStartRiding, duplicated
 * locally per this repo's no-shared-e2e-helpers convention. */
async function importAndStartRiding(page: Page): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  // The route library labels an imported route by its GPX filename (minus
  // extension), not the file's own <name> tag.
  const routeButton = page.getByRole("button", {
    name: "two-climbs-route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

test("auto-selects Climb view on entering each recognised climb, respects a manual standard-view choice mid-climb, and shows no percentage", async ({
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

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(BEFORE_CLIMB_1_METRES),
    accuracy: 5,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await importAndStartRiding(page);

  // Active Riding defaults to the Map view (backlog item 56). Before
  // entering the first climb, the Map-pane climb cue (backlog item 57)
  // stays hidden — it is active-climb-only, never shown for a merely
  // upcoming climb. The Profile-pane Climb button, by contrast, is now
  // offered before the first climb too (backlog item 71), as a manual,
  // read-only preview of it.
  await expect(page.getByRole("button", { name: "Map" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const viewClimbButton = page.getByRole("button", { name: "View climb" });
  await expect(viewClimbButton).toBeHidden();

  const mapContainer = page.locator('[data-testid="map-container"]');
  const boxBeforeClimb = await mapContainer.boundingBox();
  expect(boxBeforeClimb).not.toBeNull();

  // backlog item 71: manually previewing the next recognised climb before
  // it begins, then leaving the preview via a standard view, must not
  // switch away from Map, must not show the Map cue, and must not
  // suppress the climb's own later automatic entry.
  await page.getByRole("button", { name: "Profile" }).click();
  const profileClimbButton = page.getByRole("button", { name: "Climb" });
  await expect(profileClimbButton).toBeVisible();
  await expect(profileClimbButton).toHaveAttribute("aria-pressed", "false");
  await profileClimbButton.click();
  await expect(profileClimbButton).toHaveAttribute("aria-pressed", "true");

  const previewPanel = page.getByRole("region", { name: "Climb preview" });
  await expect(previewPanel).toContainText("Climb 1");
  await expect(previewPanel).toContainText(/Starts in/);

  const previewChart = page.getByRole("img", { name: "Elevation profile for Climb 1" });
  await expect(previewChart.locator("line.elevation-chart-marker")).toHaveCount(0);
  await expect(previewChart.locator("circle.elevation-chart-marker-dot")).toHaveCount(0);

  await page.getByRole("button", { name: "2 km" }).click();
  await expect(profileClimbButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("region", { name: "Climb preview" })).toBeHidden();

  await page.getByRole("button", { name: "Map" }).click();
  await expect(viewClimbButton).toBeHidden();

  // Enters the first recognised climb — the Map climb cue appears without
  // switching away from Map (backlog item 57's own "must never
  // automatically switch away from Map" requirement).
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
    accuracy: 5,
  });

  await expect(viewClimbButton).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Map" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // The cue is a non-layout-affecting overlay — the map's own box is
  // unchanged by its appearance.
  const boxWithClimbCue = await mapContainer.boundingBox();
  expect(boxWithClimbCue).toEqual(boxBeforeClimb);

  // A single "View climb" activation switches to Profile with Climb
  // already selected, in one action.
  await viewClimbButton.click();
  await expect(page.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const climbButton = page.getByRole("button", { name: "Climb" });
  await expect(climbButton).toHaveAttribute("aria-pressed", "true");

  const progressPanel = page.getByRole("region", { name: "Climb progress" });
  await expect(progressPanel).toBeVisible();
  await expect(progressPanel).toContainText("Climb 1");
  // Distance to summit and elevation remaining are the primary hierarchy
  // (backlog item 71); distance completed and the other metrics remain
  // present in the quieter secondary area.
  await expect(progressPanel).toContainText("Distance to summit");
  await expect(progressPanel).toContainText("Elevation remaining");
  await expect(progressPanel).toContainText(/Distance completed: \d+\.\d km/);
  // No percentage-complete value anywhere in the panel — the panel's only
  // legitimate "%" use is the current-gradient figure, e.g. "+6.0%".
  await expect(progressPanel.getByText(/\d+%\s*(complete|done)/i)).toHaveCount(0);
  await expect(progressPanel.getByRole("progressbar")).toHaveCount(0);

  // The current-position marker (vertical line + dot) is present.
  const chart = page.getByRole("img", { name: "Elevation profile chart" });
  await expect(chart.locator("line.elevation-chart-marker")).toBeAttached();
  await expect(chart.locator("circle.elevation-chart-marker-dot")).toBeAttached();

  // Multiple authoritative detailed gradient fill colours are present —
  // the smoothed local gradient varies across this climb's own range (see
  // the fixture comment above), so more than one fill colour is expected.
  const fillPaths = chart.locator("path.elevation-chart-area-fill");
  await expect(fillPaths.first()).toBeAttached();
  const fillColours = new Set(
    await fillPaths.evaluateAll((paths) =>
      paths.map((path) => path.getAttribute("fill")),
    ),
  );
  expect(fillColours.size).toBeGreaterThan(1);

  // Manually selecting a standard view dismisses Climb for the rest of
  // this climb — "10 km" is deliberately distinct from the app's own
  // default "2 km" view, so this action is unambiguously a genuine
  // manual selection, not a no-op against an already-selected default.
  await page.getByRole("button", { name: "10 km" }).click();
  await expect(climbButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "10 km" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The dismissal suppresses the Map cue too, immediately, for the rest of
  // this climb.
  await page.getByRole("button", { name: "Map" }).click();
  await expect(viewClimbButton).toBeHidden();

  // Advancing further within the same climb must not force Climb view (or
  // the Map cue) back open.
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES + 200),
    accuracy: 5,
  });
  await expect(viewClimbButton).toBeHidden();

  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page.getByRole("button", { name: "10 km" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(climbButton).toHaveAttribute("aria-pressed", "false");

  // Entering the second, different climb auto-selects Climb view again,
  // even though the first climb was dismissed.
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(CLIMB_2_MID_METRES),
    accuracy: 5,
  });
  await expect(climbButton).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
  await expect(progressPanel).toContainText("Climb 2");

  // The Map cue is re-offered for this later, distinct climb too, and can
  // be opened normally.
  await page.getByRole("button", { name: "Map" }).click();
  await expect(viewClimbButton).toBeVisible({ timeout: 15_000 });
  await viewClimbButton.click();
  await expect(page.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(climbButton).toHaveAttribute("aria-pressed", "true");
  await expect(progressPanel).toContainText("Climb 2");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test.describe("390×844 phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the Map climb cue is a real touch target, stays within the map, and does not overlap the control clusters, attribution or switcher", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    const cueButton = page.getByRole("button", { name: "View climb" });
    await expect(cueButton).toBeVisible({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    const cue = page.locator(".ride-climb-cue");
    const zoomControls = page.locator(".ride-map-zoom-controls");
    const cameraControls = page.locator(".ride-map-camera-controls");
    const attribution = page.locator(".map-attribution");
    const switcher = page.getByRole("group", { name: "Riding view" });

    const [
      mapBox,
      cueBox,
      cueButtonBox,
      zoomBox,
      cameraBox,
      attributionBox,
      switcherBox,
    ] = await Promise.all([
      mapContainer.boundingBox(),
      cue.boundingBox(),
      cueButton.boundingBox(),
      zoomControls.boundingBox(),
      cameraControls.boundingBox(),
      attribution.boundingBox(),
      switcher.boundingBox(),
    ]);
    expect(mapBox).not.toBeNull();
    expect(cueBox).not.toBeNull();
    expect(cueButtonBox).not.toBeNull();
    expect(zoomBox).not.toBeNull();
    expect(cameraBox).not.toBeNull();
    expect(attributionBox).not.toBeNull();
    expect(switcherBox).not.toBeNull();
    if (
      !mapBox ||
      !cueBox ||
      !cueButtonBox ||
      !zoomBox ||
      !cameraBox ||
      !attributionBox ||
      !switcherBox
    ) {
      throw new Error("expected every located element to have a bounding box");
    }

    // A real ≥44×44 px touch target.
    expect(cueButtonBox.width).toBeGreaterThanOrEqual(44);
    expect(cueButtonBox.height).toBeGreaterThanOrEqual(44);

    // Fully within the map, and clear of every other overlay.
    expect(isFullyWithin(cueBox, mapBox)).toBe(true);
    expect(intersects(cueBox, zoomBox)).toBe(false);
    expect(intersects(cueBox, cameraBox)).toBe(false);
    expect(intersects(cueBox, attributionBox)).toBe(false);
    expect(intersects(cueBox, switcherBox)).toBe(false);

    // backlog item 82: Climb active and the remaining-distance line are
    // fully readable, not merely present — see mapImageryRecovery.spec.ts's
    // own dedicated test for the cue's non-overlap with a genuinely
    // triggered .map-status-overlay banner, which this file does not
    // duplicate.
    await expectClimbCueTextFullyReadable(page);
  });

  /**
   * Backlog item 108. The cue used to be pinned to the FULL control-safe
   * span via `right: 64px`, whatever it held. Measured on this exact
   * viewport before the change: the map is 358px wide, the span 230px, the
   * text block 206px wide holding at most ~120px of content, and the
   * View climb action — 112.5px, never shrinkable — was pushed onto its own
   * line by item 82's flex-wrap safety net, which fired on every render
   * here rather than only at extremes. The cue measured 230x91.
   *
   * The fix removes the wasted WIDTH, not the height: the height is pinned
   * by the action's own 44px touch target and is deliberately unchanged.
   * Measured after: 144x91. These assertions therefore test reduced width
   * and continued non-intersection with the controls, NOT a shorter cue.
   *
   * Placing the action beside the text at this width was measured to be
   * impossible without shrinking type or shortening a label: ~120px of text
   * plus 112.5px of button plus padding needs ~245px inside a box whose
   * absolute control-safe maximum is 246px.
   *
   * Backlog item 115 kept every one of item 108's claims and moved the box
   * to the map's lower right, so the two anchor-specific assertions below
   * changed with it; see this file's own item 115 tests for the placement
   * proof itself.
   */
  test("the Map climb cue no longer spans the full control-safe width, covering materially less of the route ahead (backlog item 108)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    const cueButton = page.getByRole("button", { name: "View climb" });
    await expect(cueButton).toBeVisible({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    const cue = page.locator(".ride-climb-cue");
    const zoomControls = page.locator(".ride-map-zoom-controls");
    const cameraControls = page.locator(".ride-map-camera-controls");

    const [mapBox, cueBox, zoomBox, cameraBox] = await Promise.all([
      mapContainer.boundingBox(),
      cue.boundingBox(),
      zoomControls.boundingBox(),
      cameraControls.boundingBox(),
    ]);
    if (!mapBox || !cueBox || !zoomBox || !cameraBox) {
      throw new Error("expected every located element to have a bounding box");
    }

    // The full control-safe span the cue used to occupy unconditionally:
    // 8px inset + 48px button column + 8px gap, on each side.
    const fullControlSafeSpan = mapBox.width - 128;

    // The primary discriminating claim. 40px of margin sits comfortably
    // between the measured 144px and the 230px the parent produced.
    expect(cueBox.width).toBeLessThanOrEqual(fullControlSafeSpan - 40);

    // Backlog item 115 moved the anchor from the control-safe LEFT edge to
    // the map's own right inset; the item 108 width claim above is
    // unaffected, since the box still shrink-to-fits its own content. The
    // two assertions this replaces (a 64px left offset, and a horizontal
    // gap to the top-right camera cluster) described the old top placement
    // and are no longer meaningful: the cue and that cluster now sit at
    // opposite ends of the map and share no rows at all.
    expect(mapBox.x + mapBox.width - (cueBox.x + cueBox.width)).toBeCloseTo(
      MAP_OVERLAY_INSET_PX,
      0,
    );

    // Reclaimed route-ahead space, stated as a real clearance rather than
    // only as an absence of overlap: the cue's top edge now sits well below
    // the camera cluster's bottom edge, where the parent shared its row.
    const verticalGapToCameraControls = cueBox.y - (cameraBox.y + cameraBox.height);
    expect(verticalGapToCameraControls).toBeGreaterThanOrEqual(40);

    // Unchanged guarantees.
    expect(isFullyWithin(cueBox, mapBox)).toBe(true);
    expect(intersects(cueBox, zoomBox)).toBe(false);
    expect(intersects(cueBox, cameraBox)).toBe(false);
    const cueButtonBox = await cueButton.boundingBox();
    if (!cueButtonBox) throw new Error("expected the View climb button to have a box");
    expect(cueButtonBox.width).toBeGreaterThanOrEqual(44);
    expect(cueButtonBox.height).toBeGreaterThanOrEqual(44);
    await expectClimbCueTextFullyReadable(page);

    // Both text lines stay on one line each at this width. NOTE: this was
    // already true on the parent implementation for this fixture's own
    // short distances, so it is a compatibility guard here, not
    // fail-first evidence — the width assertion above carries that.
    const [titleLines, detailLines] = await page.evaluate(() => {
      // Counts real line boxes as the number of DISTINCT rect tops within
      // a Range over the text content. Two refinements matter here:
      // getComputedStyle(...).lineHeight resolves to "normal", so a
      // height/line-height ratio would be NaN; and the detail is rendered
      // from two adjacent JSX text nodes ("{distance}" and " remaining"),
      // which yield one rect EACH on the same line — so a raw rect count
      // would report two lines for a single line of text.
      const lineCount = (selector: string): number => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return Number.NaN;
        const range = document.createRange();
        range.selectNodeContents(element);
        const tops = new Set(
          Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
        );
        return tops.size;
      };
      return [lineCount(".ride-climb-cue-title"), lineCount(".ride-climb-cue-detail")];
    });
    expect(titleLines).toBe(1);
    expect(detailLines).toBe(1);

    // Width stress: the longest remaining-distance string formatDistanceKm
    // can realistically produce for a single recognised climb. Written
    // straight into the live element and measured synchronously — a
    // genuine layout stress of the real node, not a claim about app state.
    await page.evaluate(() => {
      const detail = document.querySelector(".ride-climb-cue-detail");
      if (detail) detail.textContent = "23.4 km remaining";
    });
    const stressedCueBox = await cue.boundingBox();
    if (!stressedCueBox) throw new Error("expected the cue to have a box under stress");
    expect(stressedCueBox.width).toBeLessThanOrEqual(fullControlSafeSpan - 40);
    expect(intersects(stressedCueBox, cameraBox)).toBe(false);
    expect(intersects(stressedCueBox, zoomBox)).toBe(false);
    expect(isFullyWithin(stressedCueBox, mapBox)).toBe(true);
  });

  /**
   * Backlog item 115. A bicycle field test reported that the top-centre cue
   * covered the route ahead. These assertions are about the PAINTED map, not
   * about CSS: the route ahead and the rider's marker are both located in a
   * screenshot of the canvas taken with every DOM overlay hidden, so nothing
   * here can be satisfied by the cue accidentally measuring itself.
   *
   * The corridor is derived from the route's own projection rather than from
   * a fixed fraction of the map. That distinction matters: at this viewport
   * the map is 358px wide and the cue 144px, so a naive "middle third"
   * corridor would intersect a perfectly acceptable lower-right cue and
   * reject the approved design. What the rider actually needs clear is the
   * painted route between them and the map's far edge, plus glancing room.
   */
  test("the Map climb cue sits in the map's lower right, clear of the painted route ahead and the rider's own marker (backlog item 115)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    const cueButton = page.getByRole("button", { name: "View climb" });
    await expect(cueButton).toBeVisible({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    const cue = page.locator(".ride-climb-cue");
    const [mapBox, cueBox] = await Promise.all([
      mapContainer.boundingBox(),
      cue.boundingBox(),
    ]);
    if (!mapBox || !cueBox) {
      throw new Error("expected the map and the cue to have bounding boxes");
    }

    // Lower right, and genuinely inset from both of those edges rather than
    // flush against them.
    expect(mapBox.x + mapBox.width - (cueBox.x + cueBox.width)).toBeCloseTo(
      MAP_OVERLAY_INSET_PX,
      0,
    );
    const insetFromMapBottom = mapBox.y + mapBox.height - (cueBox.y + cueBox.height);
    expect(insetFromMapBottom).toBeGreaterThanOrEqual(MAP_OVERLAY_INSET_PX);
    // In the map's lower half and its right half — the quadrant nearest the
    // Profile control below the map.
    expect(cueBox.y).toBeGreaterThan(mapBox.y + mapBox.height / 2);
    expect(cueBox.x).toBeGreaterThan(mapBox.x + mapBox.width / 2);
    expect(isFullyWithin(cueBox, mapBox)).toBe(true);

    const capture = await captureMapPaint(page, mapContainer);
    const background = modalColour(capture.image);

    // The rider's marker, located by paint but only within the region the
    // following camera actually anchors it to — the middle of the map,
    // biased below centre for look-ahead (see mapAdapter.ts's documented
    // follow offset). Searching the whole canvas would happily accept any
    // other blue ink as "the rider".
    const anchorRegion = {
      x0: mapBox.width / 2 - 60,
      x1: mapBox.width / 2 + 60,
      y0: mapBox.height / 2,
      y1: mapBox.height / 2 + 120,
    };
    const marker = paintedExtent(
      capture,
      anchorRegion,
      ([r, g, b]) => b > 150 && b - r > 80 && b - g > 40,
    );
    expect(
      marker,
      "expected the rider's position marker to be painted at the follow anchor",
    ).not.toBeNull();
    if (!marker) throw new Error("unreachable");
    expect(marker.pixelCount).toBeGreaterThan(40);
    expect(intersects(marker.box, cueBox)).toBe(false);

    // The route AHEAD: painted, non-background map ink strictly above the
    // rider's marker. "Above" is the forward direction because the following
    // camera rotates to travel-up, from the route's own tangent — and that
    // is not assumed here: the assertions below require the located ink to
    // form a narrow band genuinely running from near the map's top edge down
    // to the rider, which is only true of a route projected ahead of them.
    // If the camera were north-up instead, the route would cross the map
    // horizontally and neither assertion could hold.
    const routeAhead = paintedExtent(
      capture,
      { x0: 0, x1: mapBox.width, y0: 0, y1: marker.box.y - mapBox.y },
      (rgb) => colourDistance(rgb, background) > 24,
    );
    expect(
      routeAhead,
      "expected the route ahead to be painted above the rider",
    ).not.toBeNull();
    if (!routeAhead) throw new Error("unreachable");
    // A genuine located projection, not a stray pixel: it spans most of the
    // distance between the map's top edge and the rider.
    const availableAhead = marker.box.y - mapBox.y;
    expect(routeAhead.box.height).toBeGreaterThan(availableAhead * 0.7);
    // ...and it is a route-shaped band, not the whole map.
    expect(routeAhead.box.width).toBeLessThan(mapBox.width / 2);

    const corridor: Box = {
      x: routeAhead.box.x - ROUTE_CORRIDOR_SAFETY_BAND_PX,
      y: routeAhead.box.y - ROUTE_CORRIDOR_SAFETY_BAND_PX,
      width: routeAhead.box.width + 2 * ROUTE_CORRIDOR_SAFETY_BAND_PX,
      height: routeAhead.box.height + 2 * ROUTE_CORRIDOR_SAFETY_BAND_PX,
    };
    expect(intersects(cueBox, corridor)).toBe(false);

    // The action still does its one job.
    await cueButton.click();
    await expect(
      page.getByRole("button", { name: "Profile", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: /Climb/ }).first()).toBeVisible();
  });

  /**
   * Backlog item 115. A manual gesture pausing Follow can genuinely co-occur
   * with an active climb, and .ride-map-paused-toast is bottom-centred — so
   * moving the cue to the bottom right created a collision that had to be
   * resolved by shifting the CUE, never by moving the toast (which appears
   * on free roam too) and never by z-index alone, which would leave one of
   * the two messages unreadable.
   */
  test("an active climb cue and the Follow-paused toast coexist without intersecting (backlog item 115)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    const cue = page.locator(".ride-climb-cue");
    await expect(page.getByRole("button", { name: "View climb" })).toBeVisible({
      timeout: 15_000,
    });
    const mapContainer = page.locator('[data-testid="map-container"]');
    const cueBoxBefore = await cue.boundingBox();
    if (!cueBoxBefore) throw new Error("expected the cue to have a bounding box");

    // A real, trusted MapLibre keyboard gesture — not a synthetic pointer
    // drag — mirroring ridingCamera.spec.ts's own convention.
    const centreBefore = await mapContainer.getAttribute("data-camera-center");
    await mapContainer.locator("canvas").focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => mapContainer.getAttribute("data-camera-center"))
      .not.toBe(centreBefore);

    const toast = page.getByText("Map follow paused.");
    await expect(toast).toBeVisible();
    // Neither message is hidden to resolve the collision.
    await expect(cue).toBeVisible();

    const [mapBox, cueBox, toastBox, attributionBox] = await Promise.all([
      mapContainer.boundingBox(),
      cue.boundingBox(),
      toast.boundingBox(),
      page.locator(".map-attribution").boundingBox(),
    ]);
    if (!mapBox || !cueBox || !toastBox || !attributionBox) {
      throw new Error("expected every located element to have a bounding box");
    }

    expect(intersects(cueBox, toastBox)).toBe(false);
    expect(intersects(cueBox, attributionBox)).toBe(false);
    // The cue moved UP to clear the toast; the toast kept its own position.
    expect(cueBox.y).toBeLessThan(cueBoxBefore.y);
    expect(toastBox.y + toastBox.height).toBeCloseTo(
      mapBox.y + mapBox.height - MAP_OVERLAY_INSET_PX,
      0,
    );
    // A normal design-token gap, not a hairline.
    expect(toastBox.y - (cueBox.y + cueBox.height)).toBeGreaterThanOrEqual(8);
    // Still right-aligned, still contained.
    expect(mapBox.x + mapBox.width - (cueBox.x + cueBox.width)).toBeCloseTo(
      MAP_OVERLAY_INSET_PX,
      0,
    );
    expect(isFullyWithin(cueBox, mapBox)).toBe(true);
    await expectClimbCueTextFullyReadable(page);
  });

  /**
   * Backlog item 115. The lower-right placement is an enhancement gated on
   * the map having room for it; below that it falls back to item 57's proven
   * top placement rather than manufacturing a collision with the
   * attribution and the paused-Follow toast. Both sides of the threshold are
   * exercised comfortably clear of it, and the viewport heights are DERIVED
   * from a live measurement of how much of the screen the map actually gets,
   * so this proves the flip rather than restating the CSS constant.
   */
  test("the lower-right placement applies only when the map is tall enough, falling back to the top placement below that (backlog item 115)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    const cue = page.locator(".ride-climb-cue");
    const mapContainer = page.locator('[data-testid="map-container"]');
    await expect(page.getByRole("button", { name: "View climb" })).toBeVisible({
      timeout: 15_000,
    });

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("expected a fixed viewport size");
    const baselineMapBox = await mapContainer.boundingBox();
    if (!baselineMapBox) throw new Error("expected the map container to have a box");
    // Everything the immersive shell spends on chrome above and below the
    // map, measured rather than assumed.
    const nonMapChromeHeight = viewport.height - baselineMapBox.height;

    const placementFor = async (
      targetMapHeight: number,
    ): Promise<{ mapHeight: number; anchoredToBottom: boolean }> => {
      await page.setViewportSize({
        width: viewport.width,
        height: Math.round(nonMapChromeHeight + targetMapHeight),
      });
      await expect
        .poll(async () => (await mapContainer.boundingBox())?.height ?? 0)
        .toBeCloseTo(targetMapHeight, 0);
      const [mapBox, cueBox] = await Promise.all([
        mapContainer.boundingBox(),
        cue.boundingBox(),
      ]);
      if (!mapBox || !cueBox) throw new Error("expected boxes after the resize");
      const topInset = cueBox.y - mapBox.y;
      const bottomInset = mapBox.y + mapBox.height - (cueBox.y + cueBox.height);
      return { mapHeight: mapBox.height, anchoredToBottom: bottomInset < topInset };
    };

    const tall = await placementFor(
      BOTTOM_PLACEMENT_MIN_MAP_HEIGHT_PX + THRESHOLD_STRADDLE_MARGIN_PX,
    );
    expect(tall.mapHeight).toBeGreaterThan(BOTTOM_PLACEMENT_MIN_MAP_HEIGHT_PX);
    expect(tall.anchoredToBottom).toBe(true);

    const short = await placementFor(
      BOTTOM_PLACEMENT_MIN_MAP_HEIGHT_PX - THRESHOLD_STRADDLE_MARGIN_PX,
    );
    expect(short.mapHeight).toBeLessThan(BOTTOM_PLACEMENT_MIN_MAP_HEIGHT_PX);
    expect(short.anchoredToBottom).toBe(false);

    // Whichever branch applies, the cue stays readable and its action stays
    // a real touch target.
    await expectClimbCueTextFullyReadable(page);
    const cueButtonBox = await page
      .getByRole("button", { name: "View climb" })
      .boundingBox();
    if (!cueButtonBox) throw new Error("expected the View climb button to have a box");
    expect(cueButtonBox.width).toBeGreaterThanOrEqual(44);
    expect(cueButtonBox.height).toBeGreaterThanOrEqual(44);
  });

  test("the Map climb cue remains fully readable and contained at short landscape (backlog item 82)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    const cueButton = page.getByRole("button", { name: "View climb" });
    await expect(cueButton).toBeVisible({ timeout: 15_000 });

    await page.setViewportSize({ width: 844, height: 390 });

    await expectClimbCueTextFullyReadable(page);
    const cueButtonBox = await cueButton.boundingBox();
    if (!cueButtonBox) throw new Error("expected View climb to have a bounding box");
    expect(cueButtonBox.width).toBeGreaterThanOrEqual(44);
    expect(cueButtonBox.height).toBeGreaterThanOrEqual(44);

    // Backlog item 108: controlled reflow is allowed here — the cue widens
    // to its safe maximum and its content wraps — but it must still never
    // reach either control cluster.
    const [cueBox, zoomBox, cameraBox, mapBox] = await Promise.all([
      page.locator(".ride-climb-cue").boundingBox(),
      page.locator(".ride-map-zoom-controls").boundingBox(),
      page.locator(".ride-map-camera-controls").boundingBox(),
      page.locator('[data-testid="map-container"]').boundingBox(),
    ]);
    if (!cueBox || !zoomBox || !cameraBox || !mapBox) {
      throw new Error("expected every located element to have a bounding box");
    }
    expect(intersects(cueBox, zoomBox)).toBe(false);
    expect(intersects(cueBox, cameraBox)).toBe(false);
    // Horizontal containment specifically: it never widens past the
    // control-safe span, whatever the text does inside it.
    expect(cueBox.x).toBeGreaterThanOrEqual(mapBox.x);
    expect(cueBox.x + cueBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);

    // Deliberately NOT asserted: full vertical containment within the map.
    // The immersive shell compresses the map to its own 160px floor at this
    // viewport, and the cue's wrapped content can need more than that.
    //
    // Backlog item 115 corrected this comment, which previously attributed
    // its own numbers ("map 358x206, cue 230x206") to 200% ROOT TEXT — those
    // belong to the 200% portrait case in the next test, not to short
    // landscape. Measured here at 844x390: map 812x160, cue 144x91 at the
    // map's own y+8, i.e. contained in practice. The non-assertion is kept
    // rather than tightened because landscape is explicitly not an
    // acceptance-tested orientation for this project, so nothing should
    // come to depend on its exact geometry. Item 115 also leaves the
    // placement itself untouched at this size: the map's 160px height is
    // below the height at which the lower-right placement engages, so the
    // cue keeps item 57's top placement here.
  });

  test("the Map climb cue remains fully readable and contained at 200% enlarged text (backlog item 82)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    const cueButton = page.getByRole("button", { name: "View climb" });
    await expect(cueButton).toBeVisible({ timeout: 15_000 });

    // Simulates a large Dynamic-Type-style zoom via the document's own
    // root font size, mirroring ridingMapProfileViews.spec.ts's own
    // established convention, since OS-level text scaling cannot be
    // emulated in this environment.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    await expectClimbCueTextFullyReadable(page);
    const cueButtonBox = await cueButton.boundingBox();
    if (!cueButtonBox) throw new Error("expected View climb to have a bounding box");
    expect(cueButtonBox.width).toBeGreaterThanOrEqual(44);
    expect(cueButtonBox.height).toBeGreaterThanOrEqual(44);

    /*
     * Backlog item 115: what is and is not guaranteed at this text size.
     *
     * The immersive map compresses to roughly 358x206 here while the cue,
     * .map-attribution (two wrapped lines) and .ride-map-paused-toast all
     * grow with the text. The bottom of the map is genuinely
     * over-constrained at that size — no arrangement clears all three — so
     * item 115's lower-right placement deliberately does NOT engage, and the
     * cue keeps item 57's proven top placement. Pairwise non-intersection
     * with the attribution and the toast is therefore asserted only in the
     * height-qualified lower-right branch (see this file's own item 115
     * tests), never here: the residual overlap at 200% is a preserved
     * pre-existing limitation, neither introduced nor fixed by item 115, and
     * shrinking the attribution to manufacture room was explicitly rejected
     * because it must stay legible and compliant.
     *
     * What IS required here: the top placement really is in force, the cue
     * is horizontally contained, its text is readable, and View climb stays
     * genuinely operable.
     */
    const mapContainer = page.locator('[data-testid="map-container"]');
    const cue = page.locator(".ride-climb-cue");
    const [mapBox, cueBox] = await Promise.all([
      mapContainer.boundingBox(),
      cue.boundingBox(),
    ]);
    if (!mapBox || !cueBox) {
      throw new Error("expected the map and the cue to have bounding boxes");
    }
    expect(mapBox.height).toBeLessThan(BOTTOM_PLACEMENT_MIN_MAP_HEIGHT_PX);
    expect(cueBox.y - mapBox.y).toBeCloseTo(MAP_OVERLAY_INSET_PX, 0);

    // Horizontal containment, and no document-level horizontal overflow —
    // both already covered by expectClimbCueTextFullyReadable's own
    // scrollWidth check, restated here as geometry.
    expect(cueBox.x).toBeGreaterThanOrEqual(mapBox.x);
    expect(cueBox.x + cueBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);

    // Operable, stated as the part of the action that is actually on screen
    // rather than as whole-box containment the map's own overflow: hidden
    // cannot deliver at this size.
    const visibleActionHeight =
      Math.min(cueButtonBox.y + cueButtonBox.height, mapBox.y + mapBox.height) -
      cueButtonBox.y;
    expect(visibleActionHeight).toBeGreaterThanOrEqual(44);
    await cueButton.click();
    await expect(
      page.getByRole("button", { name: "Profile", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("the Profile climb-preview card and the restructured active-progress card fit at phone width and enlarged text, with no document scroll, and the selected Climb button's ring sits flush with the group's right edge in the four-button state (backlog items 76, 80)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(BEFORE_CLIMB_1_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    await page.getByRole("button", { name: "Profile" }).click();
    await page.getByRole("button", { name: "Climb" }).click();
    await expect(page.getByRole("region", { name: "Climb preview" })).toBeVisible();

    // Climb is the last (rightmost) button once available — the
    // conditional four-button state (Full/2 km/10 km/Climb) must keep the
    // same symmetric right-edge alignment the three-button state gets.
    await expectSelectedButtonFlushWithGroupEdge(page, "right");

    // backlog item 80: the fixed 4-column grid sizes every rendered button
    // identically, whether 3 or 4 are present — proven here empirically in
    // a real browser, not just structurally.
    const buttonWidths = await page
      .getByRole("group", { name: "Elevation profile view" })
      .locator(".elevation-window-button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().width),
      );
    expect(buttonWidths).toHaveLength(4);
    for (const width of buttonWidths) {
      expect(Math.abs(width - buttonWidths[0])).toBeLessThanOrEqual(1);
    }

    // The fixed shell itself must never scroll as a document — only the
    // bounded .ride-profile-pane--immersive fallback may, and only when
    // its own content genuinely doesn't fit (see index.css's own comment
    // on that class, and backlog item 70's precedent test). The preview
    // stacks a chart plus the full RouteFeatureDetailsPanel fact list, so
    // it is not asserted to fit with zero internal scroll the way item
    // 70's own lighter worst case was — only that the *document* itself
    // stays put and the header/switcher remain reachable.
    const hasDocumentOverflow = async (): Promise<{
      horizontal: boolean;
      vertical: boolean;
    }> =>
      page.evaluate(() => ({
        horizontal:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        vertical:
          document.documentElement.scrollHeight > document.documentElement.clientHeight,
      }));

    expect(await hasDocumentOverflow()).toEqual({ horizontal: false, vertical: false });

    // Now the live, restructured active-progress card — the primary
    // distance-to-summit/elevation-remaining pair plus the secondary row
    // — at the same phone width.
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });
    await expect(page.getByRole("region", { name: "Climb progress" })).toBeVisible({
      timeout: 15_000,
    });
    expect(await hasDocumentOverflow()).toEqual({ horizontal: false, vertical: false });

    // Simulates a large Dynamic-Type-style zoom via the document's own
    // root font size (mirrors ridingMapProfileViews.spec.ts's own
    // enlarged-text pattern) — the header and switcher stay fixed, only
    // Profile's own content may need its bounded internal scroll.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const header = page.locator("header.riding-immersive-header");
    const switcher = page.getByRole("group", { name: "Riding view" });
    await expect(header).toBeVisible();
    await expect(switcher).toBeVisible();
    const enlargedOverflow = await hasDocumentOverflow();
    expect(enlargedOverflow.horizontal).toBe(false);

    // The four-button flush edge alignment must hold at 200% text too, not
    // only at ordinary text size.
    await expectSelectedButtonFlushWithGroupEdge(page, "right");

    // backlog item 80: keyboard focus on the rightmost (Climb) button stays
    // fully inset too, so it can never be clipped by the immersive pane's
    // overflow-y: auto. Uses real Tab navigation (not a scripted .focus()
    // call) since Chromium's :focus-visible heuristic does not reliably
    // engage for scripted focus.
    await page.getByRole("button", { name: "10 km" }).focus();
    await page.keyboard.press("Tab");
    const climbButton = page.getByRole("button", { name: "Climb" });
    await expect(climbButton).toBeFocused();
    const outlineOffset = await climbButton.evaluate(
      (el) => getComputedStyle(el).outlineOffset,
    );
    expect(outlineOffset).toBe("-2px");
  });
});
