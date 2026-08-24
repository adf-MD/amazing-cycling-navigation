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

test("no Screen on control appears when navigator.wakeLock is unsupported", async ({
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

  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(page.getByRole("checkbox", { name: /screen on/i })).not.toBeAttached();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("enabling Screen on requests a lock, releases while hidden, and reacquires when visible again, with no visible success line", async ({
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

  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const checkbox = page.getByRole("checkbox", { name: /screen on/i });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  // The success status text is visually hidden (backlog item 68 — a
  // permanent visible "Screen staying awake." line was judged too much
  // scarce vertical space), so its own visibility can't be asserted via
  // toBeVisible()/toBeHidden() (a visually-hidden element still has a
  // non-empty bounding box). Prove it via attachment instead — it is only
  // ever mounted while the lock is genuinely active, exactly as before —
  // plus a direct bounding-box check that activating it adds no height.
  const control = page.locator(".ride-wake-lock-control");
  const controlBoxBeforeActive = await control.boundingBox();
  // The whole card (backlog item 75) must also not resize — proves the
  // wake-lock control's own zero-height guarantee still holds once it's a
  // flex child of the shared card's top row, not a top-level sibling.
  const card = page.locator(".ride-status-card");
  const cardBoxBeforeActive = await card.boundingBox();
  const status = page.getByText("Screen staying awake.");
  await expect(status).not.toBeAttached();

  await checkbox.check();
  await expect(status).toBeAttached();
  const controlBoxAfterActive = await control.boundingBox();
  const cardBoxAfterActive = await card.boundingBox();
  if (!controlBoxBeforeActive || !controlBoxAfterActive) {
    throw new Error("expected the wake-lock control to have a bounding box");
  }
  if (!cardBoxBeforeActive || !cardBoxAfterActive) {
    throw new Error("expected the status card to have a bounding box");
  }
  expect(controlBoxAfterActive.height).toBe(controlBoxBeforeActive.height);
  expect(cardBoxAfterActive.height).toBe(cardBoxBeforeActive.height);

  await setDocumentVisibility(page, "hidden");
  await expect(status).not.toBeAttached();

  await setDocumentVisibility(page, "visible");
  await expect(status).toBeAttached();

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

  test("the compact row sits below the immersive header (and its route title), and its info popover overlays without displacing layout", async ({
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

    const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const checkbox = page.getByRole("checkbox", { name: /screen on/i });
    const heading = page.getByRole("heading", { name: "smoke-route" });
    await expect(checkbox).toBeVisible();
    await expect(heading).toBeVisible();

    const checkboxBox = await checkbox.boundingBox();
    const headingBoxBefore = await heading.boundingBox();
    if (!checkboxBox || !headingBoxBefore) {
      throw new Error("expected the checkbox and route title to have a bounding box");
    }
    // Item 56 first corrected a real, screenshot-evidenced field finding
    // from item 55 (the wake-lock control previously rendered before the
    // header). Item 68 relocated it again, into the shared compact
    // active-status area alongside the route/GPS status line — still
    // below the header, just further down than item 56's original
    // "directly after the header" placement.
    expect(checkboxBox.y).toBeGreaterThan(headingBoxBefore.y);

    // The checkbox itself is deliberately small (backlog item 68); its
    // enclosing label is the real >=44x44px touch target instead.
    const label = page.locator(".wake-lock-label");
    const labelBox = await label.boundingBox();
    if (!labelBox) {
      throw new Error("expected the wake-lock label to have a bounding box");
    }
    expect(labelBox.height).toBeGreaterThanOrEqual(44);

    await expect(page.getByText(/keeps the display on/i)).toBeHidden();

    const infoButton = page.getByRole("button", { name: "About Screen on" });
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
    // unambiguously outside RidingWakeLockControl's own subtree instead.
    // During active Riding (backlog item 56) the global app-level header
    // is genuinely absent from the DOM — <header> now matches only the
    // immersive Pause/title/End header, itself part of the Riding section
    // rather than outside it — but its own left padding (before the Pause
    // button) is still a safe, non-interactive click target.
    await page.locator("header").click({ position: { x: 4, y: 4 } });
    await expect(popover).toBeHidden();

    await checkbox.check();
    // Visually hidden, not visible — see the dedicated lifecycle test
    // above for the full "no visible line added" proof.
    await expect(page.getByText("Screen staying awake.")).toBeAttached();

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
