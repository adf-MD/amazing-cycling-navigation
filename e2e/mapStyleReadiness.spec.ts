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

// Backlog item 96: the "Map imagery is taking longer than usual to
// load…" notice must never flash on an ordinary fast load — it has its
// own 2-second presentation grace, proven at the exact-boundary level by
// MapView.test.tsx's fake-timer suite. This test proves the real-browser
// consequence: across a genuine, fast local-style load, the notice
// element was never attached to the DOM at all, not merely absent at a
// final snapshot. The observer is installed via page.addInitScript
// before any app script runs, so a transient insertion earlier than any
// subsequent Playwright poll could observe cannot escape it.
test("does not flash the slow-imagery notice during an ordinary, fast local load", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __e2eBannerEverAttached: boolean }).__e2eBannerEverAttached =
      false;
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="map-imagery-delayed-banner"]')) {
        (
          window as unknown as { __e2eBannerEverAttached: boolean }
        ).__e2eBannerEverAttached = true;
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });

  await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Plan" }).click();

  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');
  await expect(mapContainer.locator("canvas")).toBeVisible();

  const bannerEverAttached = await page.evaluate(
    () =>
      (window as unknown as { __e2eBannerEverAttached: boolean }).__e2eBannerEverAttached,
  );
  expect(bannerEverAttached).toBe(false);
});
