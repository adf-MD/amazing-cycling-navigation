import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

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

// Narrow iPhone-width portrait viewport — the project's primary target
// device (see CLAUDE.md) and the tightest layout for the attribution
// overlay to stay clear of the right-hand camera controls.
test.use({ viewport: { width: 390, height: 844 } });

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) —
// see planning.spec.ts, which needs the same workaround. This file's
// one test needs it too, to reliably mock the tile-style request.
test.use({ serviceWorkers: "block" });

test("map attribution stays inside the map and clear of the camera buttons", async ({
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
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();

  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect(mapContainer.locator("canvas")).toBeVisible();

  // Active Riding now defaults to, and this test stays on, the Map view
  // (backlog item 56) — the elevation-window group lives in the separate
  // Profile pane and can no longer be simultaneously visible with the
  // camera buttons at all, so checking their relative geometry is no
  // longer meaningful here; the Profile pane's own layout is covered by
  // ridingElevationWindows.spec.ts's phone-viewport test instead.
  const followButton = page.getByRole("button", { name: "Follow my location" });
  const northUpButton = page.getByRole("button", { name: "North-up, top-down view" });
  await expect(followButton).toBeVisible();
  await expect(northUpButton).toBeVisible();

  const attribution = page.getByTestId("map-attribution");
  await expect(attribution).toBeVisible();

  const [mapBox, attributionBox, followBox, northUpBox] = await Promise.all([
    mapContainer.boundingBox(),
    attribution.boundingBox(),
    followButton.boundingBox(),
    northUpButton.boundingBox(),
  ]);
  if (!mapBox || !attributionBox || !followBox || !northUpBox) {
    throw new Error("expected all located elements to have a bounding box");
  }

  expect(isFullyWithin(attributionBox, mapBox)).toBe(true);
  // Camera controls moved from bottom-right to top-right (backlog item
  // 53) — attribution's bottom-left corner no longer shares any edge with
  // them, so these checks are now a baseline sanity check rather than the
  // narrow proof they originally were; see the dedicated
  // "top-left Zoom and top-right North-up/Follow clusters" test below for
  // the actual geometry proof of the new layout.
  expect(intersects(attributionBox, followBox)).toBe(false);
  expect(intersects(attributionBox, northUpBox)).toBe(false);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// Backlog item 53: proves the new top-left Zoom in/out cluster and the
// moved top-right North-up/Follow cluster, with real bounding-box
// geometry against the running app — mirroring planning.spec.ts's own
// item-52 phone-viewport proof for the equivalent Planning controls.
test("Riding: top-left Zoom and top-right North-up/Follow clusters are separate, fully contained, real touch targets", async ({
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
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();

  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect(mapContainer.locator("canvas")).toBeVisible();

  const zoomInButton = page.getByRole("button", { name: "Zoom in" });
  const zoomOutButton = page.getByRole("button", { name: "Zoom out" });
  const northUpButton = page.getByRole("button", { name: "North-up, top-down view" });
  const followButton = page.getByRole("button", { name: "Follow my location" });
  const attribution = page.getByTestId("map-attribution");
  await expect(zoomInButton).toBeVisible();
  await expect(zoomOutButton).toBeVisible();
  await expect(northUpButton).toBeVisible();
  await expect(followButton).toBeVisible();

  const [mapBox, zoomInBox, zoomOutBox, northUpBox, followBox, attributionBox] =
    await Promise.all([
      mapContainer.boundingBox(),
      zoomInButton.boundingBox(),
      zoomOutButton.boundingBox(),
      northUpButton.boundingBox(),
      followButton.boundingBox(),
      attribution.boundingBox(),
    ]);
  if (
    !mapBox ||
    !zoomInBox ||
    !zoomOutBox ||
    !northUpBox ||
    !followBox ||
    !attributionBox
  ) {
    throw new Error("expected all located map-chrome elements to have a bounding box");
  }

  // All four controls fully inside the map.
  expect(isFullyWithin(zoomInBox, mapBox)).toBe(true);
  expect(isFullyWithin(zoomOutBox, mapBox)).toBe(true);
  expect(isFullyWithin(northUpBox, mapBox)).toBe(true);
  expect(isFullyWithin(followBox, mapBox)).toBe(true);

  // Real ≥44×44px touch targets.
  for (const box of [zoomInBox, zoomOutBox, northUpBox, followBox]) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  // A real gap within each cluster.
  expect(intersects(zoomInBox, zoomOutBox)).toBe(false);
  expect(intersects(northUpBox, followBox)).toBe(false);

  // The top-left Zoom cluster and the top-right North-up/Follow cluster
  // never intersect each other.
  expect(intersects(zoomInBox, northUpBox)).toBe(false);
  expect(intersects(zoomInBox, followBox)).toBe(false);
  expect(intersects(zoomOutBox, northUpBox)).toBe(false);
  expect(intersects(zoomOutBox, followBox)).toBe(false);

  // Neither cluster intersects the map attribution.
  expect(intersects(zoomInBox, attributionBox)).toBe(false);
  expect(intersects(zoomOutBox, attributionBox)).toBe(false);
  expect(intersects(northUpBox, attributionBox)).toBe(false);
  expect(intersects(followBox, attributionBox)).toBe(false);

  // No horizontal overflow at this phone viewport.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the map grows to a viewport-aware height once riding starts, and its canvas reflows to match", async ({
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
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();

  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect(mapContainer.locator("canvas")).toBeVisible();

  const preRideBox = await mapContainer.boundingBox();
  if (!preRideBox) throw new Error("expected the pre-ride map to have a bounding box");

  await page.getByRole("button", { name: "Start riding" }).click();

  // The wrapper's CSS height changes the instant the active class applies,
  // but MapLibre's own canvas backing store only catches up once its
  // ResizeObserver callback fires — poll rather than assume both happen in
  // the same frame.
  await expect
    .poll(async () => {
      const box = await mapContainer.boundingBox();
      return box?.height ?? null;
    })
    .not.toBe(preRideBox.height);

  const [activeBox, canvasBox] = await Promise.all([
    mapContainer.boundingBox(),
    mapContainer.locator("canvas").boundingBox(),
  ]);
  if (!activeBox || !canvasBox) {
    throw new Error(
      "expected the active-riding map and its canvas to have a bounding box",
    );
  }

  // A real, deliberate increase, not pinned to an exact pixel value — this
  // is what CSS alone would already prove.
  expect(activeBox.height).toBeGreaterThan(preRideBox.height);
  // This is what actually proves MapLibre's canvas backing store reflowed
  // via MapView.tsx's existing ResizeObserver/resize() wiring, rather than
  // the canvas being left stretched or clipped at its old pixel size while
  // only the wrapper <div> around it grew.
  expect(Math.abs(canvasBox.height - activeBox.height)).toBeLessThan(2);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
