import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves active Riding + geolocation, and (folded in, per CLAUDE.md
// backlog item 25's own lighter-touch instruction for Wake Lock, since
// its state machine is already proven at the hook level and in
// ridingWakeLock.spec.ts) Screen Wake Lock, under Android device
// emulation (this file's own "android-chrome" Playwright project,
// devices["Pixel 7"] — Chromium-emulated, not real Android Chrome; see
// docs/android-chrome-acceptance.md). No Android-specific geolocation
// code exists to test — confirmed by source audit
// (`grep -rniE "useragent|isAndroid" src/` returns nothing); this file
// exercises the same standards-based navigator.geolocation.watchPosition
// path already proven at a desktop viewport in
// ridingCamera.spec.ts/layout.spec.ts, under mobile emulation only.

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

/** Mirrors ridingWakeLock.spec.ts's own stub — duplicated locally per
 * this repo's no-shared-e2e-helpers convention. */
async function installStubWakeLock(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __wakeLockRequestCount: number }).__wakeLockRequestCount = 0;
    const stub = {
      request: (): Promise<unknown> => {
        (
          window as unknown as { __wakeLockRequestCount: number }
        ).__wakeLockRequestCount += 1;
        const listeners = new Set<() => void>();
        let released = false;
        return Promise.resolve({
          get released() {
            return released;
          },
          release: (): Promise<void> => {
            if (!released) {
              released = true;
              for (const listener of listeners) listener();
            }
            return Promise.resolve();
          },
          addEventListener: (type: string, listener: () => void) => {
            if (type === "release") listeners.add(listener);
          },
          removeEventListener: (type: string, listener: () => void) => {
            if (type === "release") listeners.delete(listener);
          },
        });
      },
    };
    Object.defineProperty(navigator, "wakeLock", { value: stub, configurable: true });
  });
}

test("shows the route, follows the GPS fix, and keeps camera controls operable, with the header out of sticky flow while tracking", async ({
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
  await expect(mapContainer.locator("canvas")).toBeVisible();
  await expect(mapContainer).toHaveAttribute("data-route-loaded", "true", {
    timeout: 15_000,
  });

  const followButton = page.getByRole("button", { name: "Follow my location" });
  const northButton = page.getByRole("button", { name: "North-up, top-down view" });
  await expect(followButton).toBeVisible();
  await expect(northButton).toBeVisible();
  await expect(followButton).toHaveAttribute("aria-pressed", "true");

  await northButton.click();
  await expect(mapContainer).toHaveAttribute("data-camera-bearing", "0");
  await expect(northButton).toHaveAttribute("aria-pressed", "true");

  // The global nav header is genuinely absent the instant geolocation is
  // genuinely watching (backlog item 55, superseding the old "static"
  // contract) — mirrors stickyNavigation.spec.ts's own contract, proven
  // again here under Android device emulation.
  await expect(page.locator("header.app-header--sticky")).toHaveCount(0);
  await expect(page.locator("header.riding-immersive-header")).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Keep screen awake: visible and requests a lock when supported", async ({
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

  await installStubWakeLock(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(ROUTE_START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await startRiding(page);

  const checkbox = page.getByRole("checkbox", { name: /keep screen awake/i });
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await expect(page.getByText("Screen staying awake.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __wakeLockRequestCount: number })
            .__wakeLockRequestCount,
      ),
    )
    .toBe(1);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("no Keep screen awake control appears, and Riding still renders, when navigator.wakeLock is unsupported", async ({
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

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      value: undefined,
      configurable: true,
    });
  });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(ROUTE_START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await startRiding(page);

  await expect(
    page.getByRole("checkbox", { name: /keep screen awake/i }),
  ).not.toBeAttached();
  await expect(page.locator('[data-testid="map-container"] canvas')).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a rejecting Wake Lock request surfaces the existing retry state without crashing Riding", async ({
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

  await page.addInitScript(() => {
    const stub = {
      request: (): Promise<unknown> =>
        Promise.reject(new Error("simulated wake lock denial")),
    };
    Object.defineProperty(navigator, "wakeLock", { value: stub, configurable: true });
  });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(ROUTE_START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await startRiding(page);

  const checkbox = page.getByRole("checkbox", { name: /keep screen awake/i });
  await expect(checkbox).toBeVisible();
  await checkbox.check();

  const retryAlert = page.getByRole("alert");
  await expect(retryAlert).toBeVisible();
  await expect(retryAlert.getByText("The screen could not be kept awake.")).toBeVisible();
  await expect(
    retryAlert.getByRole("button", { name: "Tap to try again" }),
  ).toBeVisible();
  await expect(page.locator('[data-testid="map-container"] canvas')).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
