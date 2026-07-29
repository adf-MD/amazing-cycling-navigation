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

test("map attribution stays inside the map and clear of the elevation controls and camera buttons", async ({
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
  await page.getByRole("button", { name: "smoke-route" }).click();
  await page.getByRole("button", { name: "Start riding" }).click();

  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect(mapContainer.locator("canvas")).toBeVisible();

  // Both camera buttons and the elevation-window group visible together is
  // the richest simultaneous-controls scenario for this layout check.
  const followButton = page.getByRole("button", { name: "Follow my location" });
  const northUpButton = page.getByRole("button", { name: "North-up, top-down view" });
  const elevationGroup = page.getByRole("group", { name: "Elevation profile view" });
  await expect(followButton).toBeVisible();
  await expect(northUpButton).toBeVisible();
  await expect(elevationGroup).toBeVisible();

  const attribution = page.getByTestId("map-attribution");
  await expect(attribution).toBeVisible();

  const [mapBox, attributionBox, followBox, northUpBox, elevationBox] = await Promise.all(
    [
      mapContainer.boundingBox(),
      attribution.boundingBox(),
      followButton.boundingBox(),
      northUpButton.boundingBox(),
      elevationGroup.boundingBox(),
    ],
  );
  if (!mapBox || !attributionBox || !followBox || !northUpBox || !elevationBox) {
    throw new Error("expected all located elements to have a bounding box");
  }

  expect(isFullyWithin(attributionBox, mapBox)).toBe(true);
  expect(intersects(attributionBox, followBox)).toBe(false);
  expect(intersects(attributionBox, northUpBox)).toBe(false);

  // A real, deliberate gap — not pinned to an exact pixel value, since a
  // minor CSS tweak shouldn't make this flaky, only prove the controls no
  // longer appear attached to the map's edge.
  const gap = elevationBox.y - (mapBox.y + mapBox.height);
  expect(gap).toBeGreaterThanOrEqual(4);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
