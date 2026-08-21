import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Proves backlog item 55 (Immersive active-Riding shell and Pause
// lifecycle): while route Riding or free roam is genuinely GPS-tracking,
// the global MainNavigation is genuinely absent from the DOM, replaced by
// RidingScreen's/FreeRoamScreen's own compact Pause/title/End header
// (RidingImmersiveHeader.tsx); Pause is a reversible, confirmation-free
// action that stops the watch, releases the wake lock, persists a full
// resumable snapshot, and returns to the Ride launcher with the global
// nav restored — all without ever clearing storage (contrast with End/
// Finish ride, already proven in ridingFinishAndEnd.spec.ts/freeRoam.spec.ts).
// A wholly independent spec file per this repo's no-shared-e2e-helpers
// convention — stickyNavigation.spec.ts stays scoped to the global nav
// header's own sticky/absent contract; this file owns the immersive
// header's full four-sided safe-area behaviour, the Pause lifecycle, and
// the GPS-restart-gating contract.

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Matches ridingFinishAndEnd.spec.ts's/ridingLauncher.spec.ts's own
// conversion factor at the same latitude — duplicated locally per this
// repo's established no-shared-e2e-helpers-across-specs convention.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

/** A simple, straight, densely-sampled GPX track — deliberately independent
 * of OpenRouteService, matching ridingFinishAndEnd.spec.ts's own fixture. */
function buildStraightRouteGpx(name: string): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function importAndOpenRoute(page: Page, name: string): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx(name)),
  });
  const routeButton = page.getByRole("button", { name, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

function globalNavHeaderLocator(page: Page) {
  return page.locator("header.app-header--sticky");
}

function immersiveHeaderLocator(page: Page) {
  return page.locator("header.riding-immersive-header");
}

/** Transparently wraps navigator.geolocation.watchPosition with a call
 * counter exposed on window, before any app script runs. Delegates to the
 * real implementation unchanged, so context.setGeolocation-driven fixes
 * still work elsewhere in a test; only counts invocations. Duplicated from
 * ridingLauncher.spec.ts per this repo's established no-shared-e2e-helpers
 * convention. */
async function installGeolocationWatchCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const geolocation = navigator.geolocation;
    const original = geolocation.watchPosition.bind(geolocation);
    (
      window as unknown as { __e2eWatchPositionCallCount: number }
    ).__e2eWatchPositionCallCount = 0;
    geolocation.watchPosition = (
      ...args: Parameters<typeof geolocation.watchPosition>
    ) => {
      (
        window as unknown as { __e2eWatchPositionCallCount: number }
      ).__e2eWatchPositionCallCount += 1;
      return original(...args);
    };
  });
}

async function readWatchPositionCallCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eWatchPositionCallCount?: number })
        .__e2eWatchPositionCallCount ?? 0,
  );
}

/** Mirrors androidRiding.spec.ts's own stub, extended with a release
 * observation (via a window-level flag rather than a second counter, since
 * only "was the currently-held lock ever released" matters here) —
 * duplicated locally per this repo's no-shared-e2e-helpers convention. */
async function installStubWakeLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as {
      __wakeLockRequestCount: number;
      __wakeLockLastReleased: boolean;
    };
    win.__wakeLockRequestCount = 0;
    win.__wakeLockLastReleased = false;
    const stub = {
      request: (): Promise<unknown> => {
        win.__wakeLockRequestCount += 1;
        win.__wakeLockLastReleased = false;
        const listeners = new Set<() => void>();
        return Promise.resolve({
          get released() {
            return win.__wakeLockLastReleased;
          },
          release: (): Promise<void> => {
            if (!win.__wakeLockLastReleased) {
              win.__wakeLockLastReleased = true;
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

async function readWakeLockState(
  page: Page,
): Promise<{ requestCount: number; lastReleased: boolean }> {
  return page.evaluate(() => {
    const win = window as unknown as {
      __wakeLockRequestCount?: number;
      __wakeLockLastReleased?: boolean;
    };
    return {
      requestCount: win.__wakeLockRequestCount ?? 0,
      lastReleased: win.__wakeLockLastReleased ?? false,
    };
  });
}

/** page.addInitScript runs before document.documentElement necessarily
 * exists, so a MutationObserver on `document` itself (always present)
 * applies the override the instant <html> is inserted — mirrors
 * stickyNavigation.spec.ts's own useSyntheticSafeAreaInsetTop exactly,
 * extended here to all four sides (that file only ever needed top).
 * Duplicated locally per this repo's no-shared-e2e-helpers convention. */
async function useSyntheticSafeAreaInsets(
  page: Page,
  insetsPx: { top: number; right: number; bottom: number; left: number },
): Promise<void> {
  await page.addInitScript((insets) => {
    const applyTo = (html: Element) => {
      const style = (html as HTMLElement).style;
      style.setProperty("--safe-area-inset-top", `${String(insets.top)}px`);
      style.setProperty("--safe-area-inset-right", `${String(insets.right)}px`);
      style.setProperty("--safe-area-inset-bottom", `${String(insets.bottom)}px`);
      style.setProperty("--safe-area-inset-left", `${String(insets.left)}px`);
    };
    const existingHtml = document.querySelector("html");
    if (existingHtml) {
      applyTo(existingHtml);
    } else {
      new MutationObserver((_mutations, observer) => {
        const html = document.querySelector("html");
        if (html) {
          applyTo(html);
          observer.disconnect();
        }
      }).observe(document, { childList: true });
    }
  }, insetsPx);
}

test("active route Riding hides the global nav; Pause stops the watch, persists a resumable snapshot with no confirmation, and keeps the same route screen mounted showing Resume ride directly — GPS never restarts merely from showing that panel, only on the explicit Resume ride tap (backlog item 72)", async ({
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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installGeolocationWatchCounter(page);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  const routeName = "immersive-shell-pause-route";
  await page.goto("/");
  await importAndOpenRoute(page, routeName);

  // Pre-ride: the global nav is still visible and sticky, exactly like
  // every other non-immersive screen — only genuinely active tracking
  // hides it.
  await expect(globalNavHeaderLocator(page)).toHaveCSS("position", "sticky");
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  // Immersive shell active: global nav genuinely absent, the compact
  // header shown instead, exactly one watchPosition call so far.
  await expect(globalNavHeaderLocator(page)).toHaveCount(0);
  await expect(immersiveHeaderLocator(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: routeName })).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(1);

  // Establish persisted progress partway along the route.
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(300) });
  await expect(page.getByText("On route")).toBeVisible();

  const pauseButton = page.getByRole("button", { name: "Pause" });
  await expect(pauseButton).toBeVisible();

  // Pause is a single, confirmation-free tap — no alertdialog anywhere
  // before, during, or immediately after (contrast with End ride).
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await pauseButton.click();

  // Global nav restored; immersive header gone — the SAME route screen
  // stays mounted, showing its own resumable panel directly, with no
  // launcher round-trip (backlog item 72).
  await expect(immersiveHeaderLocator(page)).toHaveCount(0);
  await expect(globalNavHeaderLocator(page)).toHaveCSS("position", "sticky");
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  const resumeButton = page.getByRole("button", { name: "Resume ride" });
  await expect(resumeButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeHidden();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // Storage retains a full resumable snapshot — never cleared by Pause
  // (contrast with End/Finish ride, which always clear it first).
  const pausedRow = await readActiveRideStateRow(page);
  expect(pausedRow).toMatchObject({
    kind: "route",
    lastFix: expect.anything(),
  });

  // Merely showing the paused panel must never restart geolocation — only
  // the explicit further "Resume ride" tap may.
  expect(await readWatchPositionCallCount(page)).toBe(1);

  await resumeButton.click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(globalNavHeaderLocator(page)).toHaveCount(0);
  await expect(immersiveHeaderLocator(page)).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(2);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Pause on route Riding releases the wake lock while preserving the rider's Keep-screen-awake preference in the persisted snapshot, and restores it once resumed", async ({
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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  const routeName = "immersive-shell-pause-wake-lock-route";
  await page.goto("/");
  await importAndOpenRoute(page, routeName);
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const checkbox = page.getByRole("checkbox", { name: /keep screen on/i });
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await expect(page.getByText("Screen staying awake.")).toBeAttached();
  let wakeLockState = await readWakeLockState(page);
  expect(wakeLockState.requestCount).toBe(1);
  expect(wakeLockState.lastReleased).toBe(false);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();

  wakeLockState = await readWakeLockState(page);
  expect(wakeLockState.lastReleased).toBe(true);

  const pausedRow = await readActiveRideStateRow(page);
  expect(pausedRow).toMatchObject({ wakeLockDesired: true });

  // Resuming re-acquires the lock, and the checkbox reflects the
  // preserved preference without the rider needing to re-check it — one
  // tap, no launcher round-trip (backlog item 72).
  await page.getByRole("button", { name: "Resume ride" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const resumedCheckbox = page.getByRole("checkbox", { name: /keep screen on/i });
  await expect(resumedCheckbox).toBeChecked();
  await expect.poll(async () => (await readWakeLockState(page)).requestCount).toBe(2);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the End-ride confirmation renders inline directly beneath the immersive header, and Cancel/finalise both still work correctly", async ({
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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  // Deliberately avoids the substring "ride" anywhere in the route name:
  // getByRole's default name matching is a case-insensitive substring
  // match, and this test's own dialog heading ("End this ride?") already
  // contains it — a route name that also contained it could transiently
  // double-match a bare name: "Ride" query against a still-mounting/
  // unmounting DOM during the confirm-to-launcher transition below.
  const routeName = "immersive-shell-end-confirmation-route";
  await page.goto("/");
  await importAndOpenRoute(page, routeName);
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const endRideButton = page.getByRole("button", { name: "End ride" });
  await endRideButton.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();

  const dialogFollowsHeaderDirectly = await page.evaluate(() => {
    const header = document.querySelector(".riding-immersive-header");
    const endSlot = document.querySelector(".riding-immersive-header-end");
    const confirmRow = document.querySelector(".ride-end-ride-confirm-row");
    const alertDialog = document.querySelector('[role="alertdialog"]');
    if (!header || !endSlot || !confirmRow || !alertDialog) return false;
    return (
      !endSlot.contains(alertDialog) &&
      header.nextElementSibling === confirmRow &&
      confirmRow.contains(alertDialog)
    );
  });
  expect(dialogFollowsHeaderDirectly).toBe(true);

  // Pause stays available while the End-ride confirmation is merely open
  // (a non-destructive, cancellable decision) — the two actions' mutual
  // exclusion only actually engages once one of them is genuinely in
  // flight (see RidingScreen.pause.test.tsx's own unit-level proof of
  // both directions of that narrower window).
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(endRideButton).toBeFocused();
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();

  await endRideButton.click();
  await dialog.getByRole("button", { name: "End ride" }).click();

  // finish() (useRideNavigation.ts) awaits the storage clear strictly
  // before RidingScreen's own onRideFinalized fires — a race-free signal
  // that finalisation has genuinely completed, mirroring
  // ridingFinishAndEnd.spec.ts's own established waitForClearedRideState
  // convention, ahead of the DOM-level heading assertion below.
  await expect.poll(() => readActiveRideStateRow(page), { timeout: 10_000 }).toBeNull();
  await expect(page.getByRole("heading", { name: "Ride", exact: true })).toBeVisible();
  await expect(globalNavHeaderLocator(page)).toHaveCSS("position", "sticky");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Finish ride restores the normal app shell exactly like Pause and End ride do", async ({
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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  const routeName = "immersive-shell-finish-route";
  await page.goto("/");
  await importAndOpenRoute(page, routeName);
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(immersiveHeaderLocator(page)).toBeVisible();

  // Two consecutive interior fixes (arming), then two consecutive fixes at
  // the finish (confirming) — mirrors ridingFinishAndEnd.spec.ts's own
  // established completion-arming sequence, including waiting for each
  // fix's own observable effect before issuing the next (each
  // context.setGeolocation call must be individually processed — issuing
  // several back-to-back with no wait between them risks the app only
  // ever observing the last one).
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(420) });
  await expect(page.getByText("Route complete")).toBeHidden();
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(ROUTE_LENGTH_METRES),
  });
  await expect(page.getByText("0.0 km · 0 m ascent")).toBeVisible();
  await expect(page.getByText("Route complete")).toBeHidden();
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(ROUTE_LENGTH_METRES),
  });
  await expect(page.getByText("Route complete")).toBeVisible();
  const finishButton = page.getByRole("button", { name: "Finish ride" });
  await expect(finishButton).toBeVisible();
  await finishButton.click();

  await expect(page.getByRole("heading", { name: "Ride" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(immersiveHeaderLocator(page)).toHaveCount(0);
  await expect(globalNavHeaderLocator(page)).toHaveCSS("position", "sticky");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Pause on active free roam releases the wake lock, persists a resumable snapshot, and returns to the launcher with the global nav restored", async ({
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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installGeolocationWatchCounter(page);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(globalNavHeaderLocator(page)).toHaveCSS("position", "sticky");
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(globalNavHeaderLocator(page)).toHaveCount(0);
  await expect(immersiveHeaderLocator(page)).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(1);

  const checkbox = page.getByRole("checkbox", { name: /keep screen on/i });
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await expect(page.getByText("Screen staying awake.")).toBeAttached();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Pause" }).click();

  await expect(immersiveHeaderLocator(page)).toHaveCount(0);
  await expect(globalNavHeaderLocator(page)).toHaveCSS("position", "sticky");
  await expect(page.getByRole("heading", { name: "Ride" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume free roam" })).toBeVisible();

  const wakeLockState = await readWakeLockState(page);
  expect(wakeLockState.lastReleased).toBe(true);

  const pausedRow = await readActiveRideStateRow(page);
  expect(pausedRow).toMatchObject({
    kind: "free-roam",
    lastFix: expect.anything(),
    wakeLockDesired: true,
  });
  expect(await readWatchPositionCallCount(page)).toBe(1);

  await page.getByRole("button", { name: "Resume free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(globalNavHeaderLocator(page)).toHaveCount(0);
  await expect(immersiveHeaderLocator(page)).toBeVisible();
  expect(await readWatchPositionCallCount(page)).toBe(2);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test.describe("390×844 phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the immersive header's opaque box starts at the true viewport top, respects a synthetic four-sided safe-area inset, and its Pause/End controls stay real ≥44×44px touch targets with no horizontal overflow", async ({
    page,
    context,
  }) => {
    await useSyntheticSafeAreaInsets(page, { top: 59, right: 20, bottom: 34, left: 20 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    const routeName = "immersive-shell-safe-area-route";
    await page.goto("/");
    await importAndOpenRoute(page, routeName);
    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const header = immersiveHeaderLocator(page);
    await expect(header).toHaveCSS("position", "sticky");
    const headerBox = await header.boundingBox();
    if (!headerBox)
      throw new Error("expected the immersive header to have a bounding box");

    // RidingWakeLockControl renders before this header in document order
    // (unchanged from before item 55 — see .riding-immersive-header's own
    // CSS comment, and stickyNavigation.spec.ts's identical finding for
    // this same layout), so at rest (scroll 0) the header's own natural
    // flow position sits below that control, not yet genuinely "stuck".
    // The touch-target/horizontal checks below don't depend on this, so
    // they use this pre-scroll box; the true-viewport-top proof is a
    // separate, later check after scrolling to the very bottom of this
    // page's own scrollable range.
    const pauseButton = page.getByRole("button", { name: "Pause" });
    const endButton = page.getByRole("button", { name: "End ride" });
    for (const control of [pauseButton, endButton]) {
      const box = await control.boundingBox();
      if (!box) throw new Error("expected a header control to have a bounding box");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      // Fully inside the header's own box — never overflowing past its
      // left/right edges under the synthetic horizontal inset.
      expect(box.x).toBeGreaterThanOrEqual(headerBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
    }

    // Pause sits left of End ride, with no overlap between them.
    const pauseBox = await pauseButton.boundingBox();
    const endBox = await endButton.boundingBox();
    if (!pauseBox || !endBox)
      throw new Error("expected both controls to have a bounding box");
    expect(pauseBox.x + pauseBox.width).toBeLessThanOrEqual(endBox.x);

    const viewport = page.viewportSize();
    if (!viewport)
      throw new Error("expected the phone-viewport project to set a viewport");
    const widths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(widths.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(widths.bodyWidth).toBeLessThanOrEqual(viewport.width);

    // The opaque box (background/border-bottom) starts at the true
    // viewport top once genuinely stuck, not below the synthetic
    // safe-area strip — proven by scrolling to the very bottom of this
    // page's own scrollable range and confirming it settles at y ≈ 0,
    // mirroring stickyNavigation.spec.ts's own identical technique (a
    // two-step "partially, then further" comparison is unreliable here
    // given this page's modest total scrollable range).
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const scrolledBox = await header.boundingBox();
    if (!scrolledBox) throw new Error("expected the header to still have a bounding box");
    expect(scrolledBox.y).toBeGreaterThanOrEqual(0);
    expect(scrolledBox.y).toBeLessThan(2);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });

  test("a long route name is visually truncated with an ellipsis and never pushes Pause or End ride out of the viewport", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    const routeName =
      "An implausibly long route name that would otherwise push the header's Pause and End ride buttons off the edge of a narrow phone screen entirely";
    await page.goto("/");
    await importAndOpenRoute(page, routeName);
    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    const viewport = page.viewportSize();
    if (!viewport)
      throw new Error("expected the phone-viewport project to set a viewport");

    const pauseButton = page.getByRole("button", { name: "Pause" });
    const endButton = page.getByRole("button", { name: "End ride" });
    const pauseBox = await pauseButton.boundingBox();
    const endBox = await endButton.boundingBox();
    if (!pauseBox || !endBox)
      throw new Error("expected both controls to have a bounding box");
    expect(pauseBox.x).toBeGreaterThanOrEqual(0);
    expect(endBox.x + endBox.width).toBeLessThanOrEqual(viewport.width);

    // The full, untruncated name is still the title's accessible name and
    // DOM text content — only its painted width is clipped.
    const title = page.getByRole("heading", { level: 1, name: routeName });
    await expect(title).toBeVisible();
    const truncationState = await title.evaluate((element) => ({
      textContent: element.textContent,
      isVisuallyTruncated: element.scrollWidth > element.clientWidth,
      textOverflow: getComputedStyle(element).textOverflow,
    }));
    expect(truncationState.textContent).toBe(routeName);
    expect(truncationState.isVisuallyTruncated).toBe(true);
    expect(truncationState.textOverflow).toBe("ellipsis");

    const widths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(widths.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(widths.bodyWidth).toBeLessThanOrEqual(viewport.width);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });

  test("the immersive header and its controls stay usable across a portrait-to-landscape viewport change", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    const routeName = "immersive-shell-orientation-route";
    await page.goto("/");
    await importAndOpenRoute(page, routeName);
    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await expect(immersiveHeaderLocator(page)).toBeVisible();

    // Portrait → landscape (dimensions swapped).
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(immersiveHeaderLocator(page)).toBeVisible();
    const landscapeViewport = page.viewportSize();
    if (!landscapeViewport) throw new Error("expected a viewport after resizing");

    const pauseButton = page.getByRole("button", { name: "Pause" });
    const endButton = page.getByRole("button", { name: "End ride" });
    for (const control of [pauseButton, endButton]) {
      const box = await control.boundingBox();
      if (!box) throw new Error("expected a header control to have a bounding box");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const landscapeWidths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(landscapeWidths.documentWidth).toBeLessThanOrEqual(landscapeViewport.width);
    expect(landscapeWidths.bodyWidth).toBeLessThanOrEqual(landscapeViewport.width);

    // Pause still works correctly after the orientation change.
    await pauseButton.click();
    await expect(immersiveHeaderLocator(page)).toHaveCount(0);
    await expect(globalNavHeaderLocator(page)).toHaveCSS("position", "sticky");
    await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });
});
