import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves route-distance badges (backlog item 84) under Android device
// emulation (this file's own "android-chrome" Playwright project,
// devices["Pixel 7"] — Chromium-emulated, not real Android Chrome/
// WebView; see docs/android-chrome-acceptance.md). Mirrors
// distanceBadges.spec.ts's own "renders a genuinely painted badge above
// normal map imagery" test, narrowed to the one assertion this file
// exists to add: that the same composite-pixel paint proof holds under a
// mobile viewport, touch UA and higher device pixel ratio (Pixel 7's
// deviceScaleFactor is 2.625, unlike the desktop chromium project's 1) —
// not a second full re-proof of every desktop scenario.
//
// Uses an in-browser PNG decode (Image() + a throwaway <canvas>) fed a
// base64-encoded Playwright screenshot buffer, rather than the Node-side
// hand-rolled decoder distanceBadges.spec.ts copies from
// ridingSelectedFeatureSummary.spec.ts — a single assertion does not
// justify duplicating that ~90-line decoder a third time. Critically,
// this never calls canvas.toDataURL() on MapLibre's own WebGL canvas,
// which would not reflect genuine composited output under
// preserveDrawingBuffer:false; the canvas used here only decodes the
// already-composited PNG bytes Playwright's own screenshot capture
// produced, which does not have that limitation.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

// A same-latitude, ~28 km two-point route — fixed and returned regardless
// of where the waypoints were actually clicked (mirrors distanceBadges.
// spec.ts's own "Fallback and rotation" pattern). A fresh, no-geolocation
// Planning session's default framing is wide enough that two clicks a few
// hundred pixels apart can resolve to a route hundreds or thousands of
// kilometres long (confirmed empirically), packing all
// MAX_ACTIVE_DISTANCE_BADGES badges into a short on-screen span with no
// clearance from either waypoint marker — a known-length route avoids
// that entirely.
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Waits until the badge count is non-zero and unchanged across two
 * consecutive checks — mirrors distanceBadges.spec.ts's own identical
 * helper, duplicated locally per this repo's no-shared-e2e-helpers
 * convention. */
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

test("renders a genuinely painted badge above normal map imagery on a mobile viewport", async ({
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
  // Positions kept well within the Pixel 7 viewport's 412px width (unlike
  // the desktop suite's own wider positions) — mirrors androidPlanning.
  // spec.ts's own proven waypoint-placement coordinates.
  await mapContainer.click({ position: { x: 80, y: 100 } });
  await mapContainer.click({ position: { x: 300, y: 200 } });
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const calculateButton = page.getByRole("button", { name: /calculate route/i });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
    timeout: 15_000,
  });
  await waitForStableBadgeCount(page);

  // Picks a badge clear of both waypoint markers and every other badge —
  // a fresh, click-driven, no-geolocation Planning session's default
  // framing is wide enough that many badges legitimately overlap a
  // waypoint marker, so only an explicit clearance check gives a clean
  // sample (mirrors distanceBadges.spec.ts's own pickNonOverlappingBadge).
  const badgeLocators = page.locator(".distance-badge-marker");
  const badgeCount = await badgeLocators.count();
  const allBadgeBoxes: (Box | null)[] = [];
  for (let i = 0; i < badgeCount; i += 1) {
    allBadgeBoxes.push(await badgeLocators.nth(i).boundingBox());
  }
  const waypointMarkers = page.locator(".planning-waypoint-marker");
  const waypointCount = await waypointMarkers.count();
  const waypointBoxes: Box[] = [];
  for (let i = 0; i < waypointCount; i += 1) {
    const box = await waypointMarkers.nth(i).boundingBox();
    if (box) waypointBoxes.push(box);
  }
  const mapContainerBox = await mapContainer.boundingBox();
  if (!mapContainerBox) throw new Error("expected the map container to lay out");

  let targetIndex = -1;
  for (let i = 0; i < badgeCount; i += 1) {
    const box = allBadgeBoxes[i];
    if (!box) continue;
    const withinMapContainer =
      box.x >= mapContainerBox.x &&
      box.y >= mapContainerBox.y &&
      box.x + box.width <= mapContainerBox.x + mapContainerBox.width &&
      box.y + box.height <= mapContainerBox.y + mapContainerBox.height;
    if (!withinMapContainer) continue;
    const overlapsAnotherBadge = allBadgeBoxes.some(
      (other, j) => j !== i && other !== null && intersects(box, other),
    );
    if (overlapsAnotherBadge) continue;
    if (!waypointBoxes.some((obstacle) => intersects(box, obstacle))) {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) {
    throw new Error(
      `expected at least one of ${String(badgeCount)} distance badges to be clear of every waypoint marker and other badge, and fully within the map container`,
    );
  }

  const badge = badgeLocators.nth(targetIndex);
  const box = allBadgeBoxes[targetIndex];
  if (!box) throw new Error("expected the selected distance badge to lay out");

  const style = await badge.evaluate((el) => {
    const computed = getComputedStyle(el);
    return {
      borderWidth: parseFloat(computed.borderTopWidth),
      paddingLeft: parseFloat(computed.paddingLeft),
      radius: parseFloat(computed.borderTopLeftRadius),
    };
  });

  const crop = await page.screenshot({ clip: box });
  const base64 = crop.toString("base64");

  // All pixel decoding and region-coverage counting happens in-browser,
  // against a throwaway <canvas> that only ever decodes the already-
  // composited screenshot PNG — never MapLibre's own WebGL canvas.
  const coverage = await page.evaluate(
    async ({ base64Png, cssWidth, cssHeight, borderWidth, paddingLeft, radius }) => {
      const image = new Image();
      const decoded = new Promise<void>((resolve, reject) => {
        image.onload = () => {
          resolve();
        };
        image.onerror = () => {
          reject(new Error("failed to decode screenshot PNG"));
        };
      });
      image.src = `data:image/png;base64,${base64Png}`;
      await decoded;

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("expected a 2d canvas context");
      ctx.drawImage(image, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      function pixelAt(x: number, y: number): [number, number, number] {
        const idx = (y * width + x) * 4;
        return [data[idx], data[idx + 1], data[idx + 2]];
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
      function regionCoverage(
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
          y < Math.min(height, Math.ceil(y1));
          y += 1
        ) {
          for (
            let x = Math.max(0, Math.floor(x0));
            x < Math.min(width, Math.ceil(x1));
            x += 1
          ) {
            total += 1;
            if (colourClose(pixelAt(x, y), expected, tolerance)) matched += 1;
          }
        }
        return total === 0 ? 0 : matched / total;
      }

      const scaleX = width / cssWidth;
      const scaleY = height / cssHeight;
      const borderPxX = borderWidth * scaleX;
      const borderPxY = borderWidth * scaleY;
      const radiusPxX = radius * scaleX;
      const radiusPxY = radius * scaleY;
      const paddingPxX = paddingLeft * scaleX;
      const tolerance = 24;

      const bgY0 = radiusPxY + borderPxY + 1;
      const bgY1 = height - radiusPxY - borderPxY - 1;
      const leftBgX0 = borderPxX + 1;
      const leftBgX1 = Math.max(leftBgX0 + 1, borderPxX + paddingPxX - 1);
      const rightBgX1 = width - borderPxX - 1;
      const rightBgX0 = Math.min(rightBgX1 - 1, width - borderPxX - paddingPxX + 1);
      const backgroundCoverage = Math.max(
        regionCoverage(leftBgX0, leftBgX1, bgY0, bgY1, [255, 255, 255], tolerance),
        regionCoverage(rightBgX0, rightBgX1, bgY0, bgY1, [255, 255, 255], tolerance),
      );

      // Scans a small window near each edge rather than assuming the
      // border occupies a fixed row range — boundingBox()'s fractional
      // CSS coordinates do not always line up with rasterised device
      // pixels (see distanceBadges.spec.ts's own identical rationale).
      const edgeX0 = radiusPxX + 1;
      const edgeX1 = width - radiusPxX - 1;
      const searchLimit = Math.min(4, Math.floor(height / 4));
      let edgeCoverage = 0;
      for (let step = 0; step <= searchLimit; step += 1) {
        edgeCoverage = Math.max(
          edgeCoverage,
          regionCoverage(edgeX0, edgeX1, step, step + 1, [16, 16, 16], tolerance),
          regionCoverage(
            edgeX0,
            edgeX1,
            height - 1 - step,
            height - step,
            [16, 16, 16],
            tolerance,
          ),
        );
      }

      return { backgroundCoverage, edgeCoverage };
    },
    {
      base64Png: base64,
      cssWidth: box.width,
      cssHeight: box.height,
      borderWidth: style.borderWidth,
      paddingLeft: style.paddingLeft,
      radius: style.radius,
    },
  );

  // A badge sunk behind the WebGL canvas by a negative z-index would
  // sample as whatever the map painted at that screen location, never as
  // the badge's own white background or dark border.
  expect(coverage.backgroundCoverage).toBeGreaterThan(0.7);
  expect(coverage.edgeCoverage).toBeGreaterThan(0.7);

  expect(consoleErrors).toEqual([]);
});
