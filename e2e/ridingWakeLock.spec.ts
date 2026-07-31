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

/**
 * A browser-level stub for navigator.wakeLock — deliberately not relying
 * on the real OS/browser to actually grant a lock (a real Chromium build
 * does support the Wake Lock API, but headless/CI/virtual-display
 * environments make whether a real grant succeeds unpredictable). Counts
 * every request() call on `window.__wakeLockRequestCount` so the test can
 * assert exactly how many live requests were made. Defined via
 * Object.defineProperty on the navigator instance (not `delete`/plain
 * assignment) so it reliably shadows a real, potentially non-configurable
 * prototype-level implementation.
 */
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
    Object.defineProperty(navigator, "wakeLock", {
      value: stub,
      configurable: true,
    });
  });
}

async function setDocumentVisibility(page: Page, state: "visible" | "hidden") {
  await page.evaluate((nextState) => {
    Object.defineProperty(document, "visibilityState", {
      value: nextState,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("no Keep screen awake control appears when navigator.wakeLock is unsupported", async ({
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
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);

  const routeButton = page.getByRole("button", { name: "smoke-route" });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(
    page.getByRole("checkbox", { name: /keep screen awake/i }),
  ).not.toBeAttached();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("enabling Keep screen awake requests a lock, releases while hidden, and reacquires when visible again", async ({
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
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);

  const routeButton = page.getByRole("button", { name: "smoke-route" });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const checkbox = page.getByRole("checkbox", { name: /keep screen awake/i });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await checkbox.check();
  await expect(page.getByText("Screen staying awake.")).toBeVisible();

  await setDocumentVisibility(page, "hidden");
  await expect(page.getByText("Screen staying awake.")).toBeHidden();

  await setDocumentVisibility(page, "visible");
  await expect(page.getByText("Screen staying awake.")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __wakeLockRequestCount: number })
            .__wakeLockRequestCount,
      ),
    )
    .toBe(2);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
