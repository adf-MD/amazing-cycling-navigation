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

test.describe("compact control on a narrow phone viewport", () => {
  // Matches layout.spec.ts's own narrow iPhone-width portrait viewport —
  // the project's primary target device.
  test.use({ viewport: { width: 390, height: 844 } });

  test("the compact row sits above the route title, and its info popover overlays without displacing layout", async ({
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
    const heading = page.getByRole("heading", { name: "smoke-route" });
    await expect(checkbox).toBeVisible();
    await expect(heading).toBeVisible();

    const checkboxBox = await checkbox.boundingBox();
    const headingBoxBefore = await heading.boundingBox();
    if (!checkboxBox || !headingBoxBefore) {
      throw new Error("expected the checkbox and route title to have a bounding box");
    }
    expect(checkboxBox.y).toBeLessThan(headingBoxBefore.y);

    await expect(page.getByText(/keeps the display on/i)).toBeHidden();

    const infoButton = page.getByRole("button", { name: "About Keep screen awake" });
    await infoButton.click();

    const popover = page.getByRole("note");
    await expect(popover).toBeVisible();
    await expect(
      page.getByText(
        "Keeps the display on while Riding mode is visible. This may increase battery use.",
      ),
    ).toBeVisible();

    // Opening the popover overlays content rather than pushing the route
    // title further down the page.
    const headingBoxAfter = await heading.boundingBox();
    if (!headingBoxAfter) {
      throw new Error("expected the route title to have a bounding box");
    }
    expect(headingBoxAfter.y).toBe(headingBoxBefore.y);

    const popoverBox = await popover.boundingBox();
    const viewport = page.viewportSize();
    if (!popoverBox || !viewport) {
      throw new Error("expected the popover and viewport to have a size");
    }
    expect(popoverBox.x).toBeGreaterThanOrEqual(0);
    expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(viewport.width);
    expect(popoverBox.y).toBeGreaterThanOrEqual(0);
    expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(viewport.height);

    // Close via the button, reopen and close via Escape, reopen and close
    // via an outside click.
    await infoButton.click();
    await expect(popover).toBeHidden();

    await infoButton.click();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();

    await infoButton.click();
    // The popover overlays the route title by design, so click a target
    // unambiguously outside the whole Riding section instead: the
    // app-level header (App.tsx), which sits above <main> entirely.
    await page.getByRole("heading", { name: "Amazing Cycling Navigation" }).click();
    await expect(popover).toBeHidden();

    await checkbox.check();
    await expect(page.getByText("Screen staying awake.")).toBeVisible();

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
