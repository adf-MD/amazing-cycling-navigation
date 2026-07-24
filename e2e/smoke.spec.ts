import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

test("app shell loads with no console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Amazing Cycling Navigation" }),
  ).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("imports a GPX file, opens Riding mode, and the map reaches a usable state", async ({
  page,
  context,
}) => {
  // A real MapLibre fitBounds/resize call against real WebGL is never
  // exercised by unit tests (jsdom has no WebGL), so this is the only
  // layer of testing that would catch a silent runtime exception in the
  // map camera path.
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  await page.goto("/");

  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);

  const routeButton = page.getByRole("button", { name: "smoke-route" });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();

  // A <canvas> exists the instant MapLibre is constructed, regardless of
  // whether it ever finishes loading — waiting for the loading indicator
  // to clear only proves the style loaded, not that the route itself
  // rendered (a real bug that slipped past this exact check previously:
  // MapLibre's Web Worker script failed to load in the production
  // bundle, so the map reached "ready" via a plain background while the
  // route's GeoJSON source silently never processed). The assertions
  // below check the actual rendered output instead.
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect(mapContainer.locator("canvas")).toBeVisible();

  // Proves the worker actually finished processing the route's GeoJSON
  // source (not just that setGeoJsonSourceData was called).
  await expect(mapContainer).toHaveAttribute("data-route-loaded", "true", {
    timeout: 15_000,
  });

  // Proves real, non-empty geometry was submitted in the first place.
  const coordinateCount = await mapContainer.getAttribute("data-route-coordinate-count");
  expect(Number(coordinateCount)).toBeGreaterThan(0);

  // Proves the camera actually moved to the route's location — the
  // fixture route sits within roughly (51.5000,-0.1000)-(51.5036,-0.0946);
  // the style's own default view is nowhere near this (typically far
  // zoomed out, centred elsewhere or at [0,0]). Starting the ride
  // requests "following", which recentres on the mocked GPS fix via an
  // animated ease — poll rather than reading once, since that ease takes
  // a moment to settle.
  await expect
    .poll(
      async () => {
        const attr = await mapContainer.getAttribute("data-camera-center");
        const [lon, lat] = (attr ?? "").split(",").map(Number);
        return lon > -0.101 && lon < -0.094 && lat > 51.499 && lat < 51.504;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const cameraCenterAttr = await mapContainer.getAttribute("data-camera-center");
  const [cameraLon, cameraLat] = (cameraCenterAttr ?? "").split(",").map(Number);
  expect(cameraLon).toBeGreaterThan(-0.101);
  expect(cameraLon).toBeLessThan(-0.094);
  expect(cameraLat).toBeGreaterThan(51.499);
  expect(cameraLat).toBeLessThan(51.504);

  expect(consoleErrors).toEqual([]);
});
