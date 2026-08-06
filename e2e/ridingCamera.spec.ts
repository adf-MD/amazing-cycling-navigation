import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround.
test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
const ROUTE_START = { latitude: 51.5, longitude: -0.1 };

async function startRiding(page: Page) {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

// Two independent `easeTo` calls to the exact same nominal target don't
// read back bit-identical from MapLibre's own live transform afterwards —
// its internal Mercator projection/unprojection round-trip introduces
// noise on the order of 1e-13 degrees (confirmed by direct observation
// while writing this test), many orders of magnitude below any real GPS
// or rendering precision. A tolerance this loose still fails on any
// genuine functional discrepancy (e.g. a materially different bearing,
// pitch or zoom, or a centre off by metres) while absorbing that noise.
const CAMERA_VALUE_TOLERANCE = 1e-6;

function numbersClose(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(Number.parseFloat(a) - Number.parseFloat(b)) < CAMERA_VALUE_TOLERANCE;
}

function centresClose(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const [aLon, aLat] = a.split(",");
  const [bLon, bLat] = b.split(",");
  return numbersClose(aLon, bLon) && numbersClose(aLat, bLat);
}

test("Riding: pressing Northwards twice, with a manual rotation in between, rotates back to north both times", async ({
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
  await context.setGeolocation(ROUTE_START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await startRiding(page);

  const mapContainer = page.locator('[data-testid="map-container"]');
  const northButton = page.getByRole("button", { name: "North-up, top-down view" });
  await expect(northButton).toBeVisible();

  await northButton.click();
  await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");

  const mapBox = await mapContainer.boundingBox();
  if (!mapBox) {
    throw new Error("expected the map container to lay out");
  }
  const centreX = mapBox.x + mapBox.width / 2;
  const centreY = mapBox.y + mapBox.height / 2;

  // MapLibre's default DragRotateHandler binds to a right-button drag —
  // same gesture planning.spec.ts's own Northwards regression test uses.
  await page.mouse.move(centreX, centreY);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(centreX + 150, centreY - 100, { steps: 10 });
  await page.mouse.up({ button: "right" });

  // Proves the drag genuinely rotated the map first — otherwise the second
  // Northwards press below would prove nothing.
  await expect.poll(() => mapContainer.getAttribute("data-camera-bearing")).not.toBe("0");

  await northButton.click();
  await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");
  await expect(mapContainer).toHaveAttribute("data-camera-pitch", "0");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Riding: re-pressing Follow location with an unchanged GPS fix, after a manual gesture, resumes following", async ({
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
  await context.setGeolocation(ROUTE_START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await startRiding(page);

  const mapContainer = page.locator('[data-testid="map-container"]');
  const followButton = page.getByRole("button", { name: "Follow my location" });
  await expect(followButton).toHaveAttribute("aria-pressed", "true");

  // Wait for the follow camera itself to genuinely settle, then capture
  // it — this test never emits a second, different GPS fix, so a correct
  // re-press must reproduce these exact values. Polling on pitch "35"
  // (FOLLOW_PITCH_DEGREES, distinct from the route's own initial overview
  // fit, which never tilts) is the reliable "follow has landed" signal —
  // polling on centre alone would be satisfied early by that unrelated
  // overview-fit transition, which also has a non-"0,0" centre.
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  const followedCentre = await mapContainer.getAttribute("data-camera-center");
  const followedBearing = await mapContainer.getAttribute("data-camera-bearing");
  const followedPitch = await mapContainer.getAttribute("data-camera-pitch");
  const followedZoom = await mapContainer.getAttribute("data-camera-zoom");

  const mapBox = await mapContainer.boundingBox();
  if (!mapBox) {
    throw new Error("expected the map container to lay out");
  }
  const centreX = mapBox.x + mapBox.width / 2;
  const centreY = mapBox.y + mapBox.height / 2;

  // A real diagonal right-button drag rotates and pitches simultaneously,
  // and also pauses follow mode (a genuine MapLibre user gesture).
  await page.mouse.move(centreX, centreY);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(centreX + 120, centreY - 100, { steps: 10 });
  await page.mouse.up({ button: "right" });

  await expect(followButton).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => mapContainer.getAttribute("data-camera-bearing"))
    .not.toBe(followedBearing);

  // No new/different geolocation is set here — deliberately the same
  // stationary fix as before. This is the scenario this task's fix
  // targets: a rider re-pressing Follow without having moved.
  await followButton.click();

  await expect(followButton).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => {
      const centre = await mapContainer.getAttribute("data-camera-center");
      const bearing = await mapContainer.getAttribute("data-camera-bearing");
      const pitch = await mapContainer.getAttribute("data-camera-pitch");
      const zoom = await mapContainer.getAttribute("data-camera-zoom");
      return (
        centresClose(centre, followedCentre) &&
        numbersClose(bearing, followedBearing) &&
        numbersClose(pitch, followedPitch) &&
        numbersClose(zoom, followedZoom)
      );
    })
    .toBe(true);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
