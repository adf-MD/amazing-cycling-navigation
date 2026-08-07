import { expect, test, type Locator, type Page } from "@playwright/test";
import { forceMapStyleFailure, installLocalMapStyle } from "./support/localMapStyle.ts";

/**
 * Backlog item 23 ("Low-zoom route-colour and waypoint-marker
 * legibility"): coarse, non-pixel e2e coverage of the zoom-responsive
 * route-width policy (routeWidthPolicy.ts) and Planning's waypoint-marker
 * zoom-band CSS (planningLayer.ts's deriveMarkerZoomBand, index.css's
 * data-marker-zoom-band descendant rules). Precise width/stop values are
 * unit-tested directly against the real paint-property arguments passed
 * to addLineLayer (see mapAdapter.test.ts, MapView.test.tsx) — this file
 * proves the real, rendered outcome: the route keeps rendering, waypoint
 * markers visibly shrink and restore, touch targets and identities are
 * preserved, and the same behaviour holds in Planning, pre-ride Riding
 * overview and under the local fallback style.
 */

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";

const MOCK_ORS_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { summary: { distance: 950, duration: 200 } },
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

/**
 * Presses a MapLibre KeyboardHandler zoom key repeatedly until the map
 * container's own data-marker-zoom-band settles at the expected band —
 * mirrors planning.spec.ts's "pressing Northwards twice" test's own
 * choice of MapLibre's real, deterministic KeyboardHandler over a
 * synthetic pointer/wheel gesture (avoids that test's documented
 * DragRotateHandler CI flakiness class entirely, since there is no
 * drag/inertia state machine in this path). `Shift+=`/`Shift+-` each
 * request a 2-zoom-level change per press (keyboard.ts); pressing several
 * times, regardless of the map's starting zoom, reliably drives the
 * camera to (or close to) MapLibre's own zoom clamp in that direction,
 * which is always comfortably past ROUTE_WIDTH_CLOSE_ZOOM/
 * ROUTE_WIDTH_OVERVIEW_ZOOM (routeWidthPolicy.ts) either way — so this
 * never needs to know or import the exact threshold values.
 *
 * Waits for data-camera-zoom to genuinely change between presses, not
 * merely to be non-empty: under heavy parallel CI load, sending the next
 * press before the previous one's easeTo has actually settled reads a
 * mid-flight tr.zoom (successive presses share the fixed
 * "keyboardHandler" easeId), under-compounding the nominal +2-per-press
 * increment enough that 15 presses can land short of the target band —
 * reproduced locally under sustained worker contention (see
 * planning.spec.ts's own zoomToCloseRange, which hit the identical
 * failure mode and carries the same fix). Capturing the value immediately
 * before each press and polling for a genuine change (rather than a
 * longer timeout, a retry, or fewer/looser attempts) makes each press
 * count its full increment before the next is sent.
 */
async function zoomToBand(
  page: Page,
  mapContainer: Locator,
  direction: "in" | "out",
  expectedBand: "close" | "overview",
): Promise<void> {
  const key = direction === "in" ? "Shift+=" : "Shift+-";
  const canvas = mapContainer.locator("canvas");
  await canvas.focus();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const band = await mapContainer.getAttribute("data-marker-zoom-band");
    if (band === expectedBand) return;
    const zoomBefore = await mapContainer.getAttribute("data-camera-zoom");
    await page.keyboard.press(key);
    await expect
      .poll(() => mapContainer.getAttribute("data-camera-zoom"), { timeout: 2_000 })
      .not.toBe(zoomBefore);
  }
  await expect(mapContainer).toHaveAttribute("data-marker-zoom-band", expectedBand);
}

function boundingBoxOrThrow(box: { width: number; height: number } | null) {
  if (!box) throw new Error("expected a visible element with a bounding box");
  return box;
}

test.describe("Planning: waypoint marker zoom scaling", () => {
  test("markers shrink at overview zoom and restore at close zoom, staying individually identifiable, with an unaffected >=44x44 WaypointList touch target", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');

    // A dense ~14-waypoint fixture (CLAUDE.md's own manual-acceptance
    // baseline: "a Planning route with approximately 14 numbered
    // waypoints"), tightly packed within the visible map area — no route
    // calculation needed, since this test only exercises marker
    // presentation, not routing.
    const waypointCount = 14;
    for (let index = 0; index < waypointCount; index += 1) {
      await mapContainer.click({
        position: { x: 40 + (index % 7) * 35, y: 40 + Math.floor(index / 7) * 70 },
      });
    }

    const markers = mapContainer.getByRole("img");
    await expect(markers).toHaveCount(waypointCount);

    const startMarker = mapContainer.getByRole("img", { name: "Start waypoint 1" });
    const finishMarker = mapContainer.getByRole("img", {
      name: `Finish waypoint ${String(waypointCount)}`,
    });
    const startRow = page.getByRole("button", { name: "Start", exact: true });
    await expect(startRow).toBeVisible();

    // Selects an ordinary waypoint so the selection ring's own
    // distinguishability across zoom is also proven, not just role shape.
    await page.getByRole("button", { name: "Waypoint 5", exact: true }).click();
    const selectedMarker = mapContainer.getByRole("img", { name: "Waypoint 5" });
    await expect(selectedMarker).toHaveClass(/planning-waypoint-marker--selected/);

    await zoomToBand(page, mapContainer, "in", "close");
    const closeStartBox = boundingBoxOrThrow(await startMarker.boundingBox());
    const closeRowBox = boundingBoxOrThrow(await startRow.boundingBox());
    expect(closeRowBox.width).toBeGreaterThanOrEqual(44);
    expect(closeRowBox.height).toBeGreaterThanOrEqual(44);

    await zoomToBand(page, mapContainer, "out", "overview");
    // Start, an ordinary waypoint's own marker and the finish marker all
    // stay present and individually identifiable — nothing clustered or
    // replaced with an aggregate marker.
    await expect(markers).toHaveCount(waypointCount);
    await expect(startMarker).toBeVisible();
    await expect(finishMarker).toBeVisible();
    await expect(selectedMarker).toHaveClass(/planning-waypoint-marker--selected/);

    const overviewStartBox = boundingBoxOrThrow(await startMarker.boundingBox());
    expect(overviewStartBox.width).toBeLessThan(closeStartBox.width);
    expect(overviewStartBox.height).toBeLessThan(closeStartBox.height);

    // The map marker's own box may shrink freely — WaypointList's row
    // remains the sole, unaffected >=44x44 selection surface at every
    // zoom (see index.css's data-marker-zoom-band comment).
    const overviewRowBox = boundingBoxOrThrow(await startRow.boundingBox());
    expect(overviewRowBox.width).toBeGreaterThanOrEqual(44);
    expect(overviewRowBox.height).toBeGreaterThanOrEqual(44);

    // Tapping a visually reduced waypoint still selects the exact
    // intended marker (deselect-on-repeat-tap, backlog item 22, is
    // unaffected by this slice).
    await page.getByRole("button", { name: "Waypoint 5", exact: true }).click();
    await expect(selectedMarker).not.toHaveClass(/planning-waypoint-marker--selected/);

    await zoomToBand(page, mapContainer, "in", "close");
    const restoredStartBox = boundingBoxOrThrow(await startMarker.boundingBox());
    expect(restoredStartBox.width).toBe(closeStartBox.width);
    expect(restoredStartBox.height).toBe(closeStartBox.height);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("still shrinks markers and renders the route on the local fallback style", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      // The browser itself logs this for the tile-style request this test
      // deliberately aborts below, to force the local fallback style — an
      // expected artefact of that intentional abort, not an app error
      // (mirrors directionArrows.spec.ts's own planRouteOnFallbackMap
      // helper and its identical justification).
      if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    await forceMapStyleFailure(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible();

    const mapContainer = page.locator('[data-testid="map-container"]');
    await mapContainer.click({ position: { x: 80, y: 80 } });
    await mapContainer.click({ position: { x: 180, y: 120 } });

    const startMarker = mapContainer.getByRole("img", { name: "Start waypoint 1" });
    await expect(startMarker).toBeVisible();

    await zoomToBand(page, mapContainer, "in", "close");
    const closeBox = boundingBoxOrThrow(await startMarker.boundingBox());

    await zoomToBand(page, mapContainer, "out", "overview");
    await expect(startMarker).toBeVisible();
    const overviewBox = boundingBoxOrThrow(await startMarker.boundingBox());
    expect(overviewBox.width).toBeLessThan(closeBox.width);

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Planning and Riding: route rendering across zoom", () => {
  test("a calculated route keeps rendering, in both Planning and the saved route's pre-ride overview, as the map is zoomed from close to overview and back", async ({
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

    await page.route(ORS_URL_GLOB, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(MOCK_ORS_RESPONSE),
      });
    });

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const planningMapContainer = page.locator('[data-testid="map-container"]');
    await planningMapContainer.click({ position: { x: 100, y: 100 } });
    await planningMapContainer.click({ position: { x: 200, y: 150 } });

    const calculateButton = page.getByRole("button", { name: /calculate route/i });
    await expect(calculateButton).toBeEnabled();
    await calculateButton.click();
    await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(planningMapContainer).toHaveAttribute("data-route-loaded", "true");

    await zoomToBand(page, planningMapContainer, "out", "overview");
    // The route line's own source is untouched by zoom (see
    // MapView.test.tsx's "never alters classified route-feature/gradient
    // source data across a zoom change") — the observable, e2e-provable
    // consequence is that the map keeps reporting the route as loaded and
    // the canvas keeps rendering, never an error or a blank map.
    await expect(planningMapContainer).toHaveAttribute("data-route-loaded", "true");
    await expect(planningMapContainer.locator("canvas")).toBeVisible();

    await zoomToBand(page, planningMapContainer, "in", "close");
    await expect(planningMapContainer).toHaveAttribute("data-route-loaded", "true");

    const routeName = "E2E Low-zoom Route";
    await page.getByLabel("Route name").fill(routeName);
    const saveButton = page.getByRole("button", { name: /save route/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Saving switches to the pre-ride overview for the new route.
    await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
    const ridingMapContainer = page.locator('[data-testid="map-container"]');
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(ridingMapContainer).toHaveAttribute("data-route-loaded", "true");

    await zoomToBand(page, ridingMapContainer, "out", "overview");
    await expect(ridingMapContainer).toHaveAttribute("data-route-loaded", "true");
    await expect(ridingMapContainer.locator("canvas")).toBeVisible();
    // Pre-ride (idle) never shows the North-up/Follow-location controls
    // (RidingScreen.tsx gates both on an active geolocation watch) — this
    // slice does not change that, and there is nothing further to assert
    // about them in this state.

    await zoomToBand(page, ridingMapContainer, "in", "close");
    await expect(ridingMapContainer).toHaveAttribute("data-route-loaded", "true");

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
