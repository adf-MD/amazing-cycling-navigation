import { expect, test } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) —
// see planning.spec.ts, which needs the same workaround.
test.use({ serviceWorkers: "block" });

// Isolates installLocalMapStyle's own contract from the larger ORS/GPX
// flows the other specs exercise: if this fails while those pass (or
// vice versa), the failure localises straight to the style-serving
// mechanism itself. Route/marker-layer behaviour against the local
// style is proven separately by planning.spec.ts's crosshair/marker
// and three-waypoint tests, not duplicated here.
test("Planning's map reaches ready via the locally fulfilled style alone, with no fallback banner and no other OpenFreeMap request", async ({
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
  await expect(mapContainer.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("map-fallback-banner")).not.toBeAttached();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
