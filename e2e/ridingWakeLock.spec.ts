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

  await expect(page.getByRole("button", { name: "Screen on" })).not.toBeAttached();

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

  const toggle = page.getByRole("button", { name: "Screen on" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle.getByText("Off")).toBeVisible();

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

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle.getByText("On", { exact: true })).toBeVisible();
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

  test("the toggle sits below the immersive header (and its route title), is a real >=44x44 target with visible unclipped focus, and never displaces layout", async ({
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

    const toggle = page.getByRole("button", { name: "Screen on" });
    const heading = page.getByRole("heading", { name: "smoke-route" });
    await expect(toggle).toBeVisible();
    await expect(heading).toBeVisible();

    const toggleBoxBefore = await toggle.boundingBox();
    const headingBoxBefore = await heading.boundingBox();
    if (!toggleBoxBefore || !headingBoxBefore) {
      throw new Error("expected the toggle and route title to have a bounding box");
    }
    // Item 56 first corrected a real, screenshot-evidenced field finding
    // from item 55 (the wake-lock control previously rendered before the
    // header). Item 68 relocated it again, into the shared compact
    // active-status area alongside the route/GPS status line; item 82
    // then unified the checkbox+information-button pair into this one
    // toggle — still below the header throughout.
    expect(toggleBoxBefore.y).toBeGreaterThan(headingBoxBefore.y);

    // A genuine >=44x44 CSS-pixel touch target — the whole button, not
    // merely an internal glyph.
    expect(toggleBoxBefore.width).toBeGreaterThanOrEqual(44);
    expect(toggleBoxBefore.height).toBeGreaterThanOrEqual(44);

    // The non-colour on/off cue is present and correct before any press.
    await expect(toggle.getByText("Off")).toBeVisible();

    // Keyboard-focusable with a visible, unclipped focus outline — proven
    // via a real Tab traversal (mirroring ridingClimbView.spec.ts's own
    // documented gotcha: a scripted .focus() does not reliably engage
    // Chromium's :focus-visible heuristic). A bounded loop, rather than a
    // single Tab press, since the exact number of intervening focusable
    // elements (e.g. End ride, in the header) is an implementation detail
    // this test should not have to hard-code.
    await page.getByRole("button", { name: "Pause" }).focus();
    let reachedToggleByTab = false;
    for (let tabPress = 0; tabPress < 10; tabPress += 1) {
      await page.keyboard.press("Tab");
      if (await toggle.evaluate((element) => element === document.activeElement)) {
        reachedToggleByTab = true;
        break;
      }
    }
    expect(reachedToggleByTab).toBe(true);
    await expect(toggle).toBeFocused();
    const outlineWidth = await toggle.evaluate(
      (element) => getComputedStyle(element).outlineWidth,
    );
    expect(outlineWidth).not.toBe("0px");
    const focusBox = await toggle.boundingBox();
    const viewport = page.viewportSize();
    if (!focusBox || !viewport) {
      throw new Error("expected the toggle and viewport to have a size");
    }
    // The focused control (including its outline) stays fully onscreen —
    // no clipping ancestor cuts it off.
    expect(focusBox.x).toBeGreaterThanOrEqual(0);
    expect(focusBox.x + focusBox.width).toBeLessThanOrEqual(viewport.width);

    // Pressing it via the keyboard toggles state and paints via
    // aria-pressed alone (backlog item 82) — never displacing the route
    // title, unlike the former popover overlay this replaces.
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle.getByText("On", { exact: true })).toBeVisible();
    // Visually hidden, not visible — see the dedicated lifecycle test
    // above for the full "no visible line added" proof.
    await expect(page.getByText("Screen staying awake.")).toBeAttached();

    const headingBoxAfter = await heading.boundingBox();
    const toggleBoxAfter = await toggle.boundingBox();
    if (!headingBoxAfter || !toggleBoxAfter) {
      throw new Error("expected the route title and toggle to have a bounding box");
    }
    expect(headingBoxAfter.y).toBe(headingBoxBefore.y);
    expect(toggleBoxAfter.height).toBe(toggleBoxBefore.height);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
