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

test("imports a GPX file, opens Riding mode, and shows the map or an explicit tile-unavailable state", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  await page.goto("/");

  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);

  const routeButton = page.getByRole("button", { name: "smoke-route" });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();

  const mapCanvas = page.locator('[data-testid="map-container"] canvas');
  const tilesUnavailableBanner = page.getByTestId("tiles-unavailable-banner");
  await expect(mapCanvas.or(tilesUnavailableBanner)).toBeVisible({ timeout: 15_000 });
});
