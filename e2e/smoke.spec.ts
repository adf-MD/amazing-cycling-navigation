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
  // to clear is what actually proves the map reached a usable state
  // (real tiles or the local fallback), not just that a canvas exists.
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('[data-testid="map-container"] canvas')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
