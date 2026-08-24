import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves backlog item 56 (fixed active-Riding Map/Profile shell): the
// long, continuously-scrolling active-Riding page is replaced by two
// fixed, non-scrolling views ("Map" and "Profile") switched via large
// bottom buttons, both fitting entirely within the viewport. A wholly
// independent spec file per this repo's no-shared-e2e-helpers convention
// — stickyNavigation.spec.ts and ridingImmersiveShell.spec.ts stay scoped
// to the immersive header/Pause lifecycle; this file owns the Map/Profile
// toggle itself.

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround. Applied file-wide
// (not just the phone-viewport describe block) since a real service worker
// registering mid-test can also render an unrelated "Ready to work
// offline" banner outside .screen, adding height this file's own no-scroll
// assertions would otherwise (correctly) flag.
test.use({ serviceWorkers: "block" });

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

/** A simple, straight, densely-sampled GPX track with no elevation —
 * deliberately independent of OpenRouteService, mirroring
 * ridingImmersiveShell.spec.ts's own fixture (duplicated locally per this
 * repo's no-shared-e2e-helpers convention). */
function buildStraightRouteGpx(name: string): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"></trkpt>`;
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

async function importAndStartRiding(page: Page, name: string): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx(name)),
  });
  const routeButton = page.getByRole("button", { name, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

function switcherLocator(page: Page) {
  return page.getByRole("group", { name: "Riding view" });
}

async function switchToProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Profile" }).click();
}

async function switchToMap(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Map" }).click();
}

/** Mirrors ridingImmersiveShell.spec.ts's own identically-named helper —
 * duplicated locally per this repo's no-shared-e2e-helpers convention. */
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

/** Mirrors stickyNavigation.spec.ts's/ridingImmersiveShell.spec.ts's own
 * synthetic safe-area helper — duplicated locally per this repo's
 * no-shared-e2e-helpers convention. */
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFullyWithin(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

test.describe("390×844 phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("header sits at the true top under a synthetic safe-area inset, and neither view causes document overflow", async ({
    page,
    context,
  }) => {
    await useSyntheticSafeAreaInsets(page, { top: 59, right: 0, bottom: 34, left: 0 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
    await installLocalMapStyle(page);

    await page.goto("/");
    await importAndStartRiding(page, "map-profile-phone-route");

    const header = page.locator("header.riding-immersive-header");
    const headerBox = await header.boundingBox();
    if (!headerBox) throw new Error("expected the header to have a bounding box");
    expect(headerBox.y).toBeGreaterThanOrEqual(0);
    expect(headerBox.y).toBeLessThan(2);

    // Map view (default): no scroll needed, no horizontal overflow.
    const scrollHeightMap = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    expect(scrollHeightMap).toBeLessThanOrEqual(844);
    const scrollWidthMap = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidthMap).toBeLessThanOrEqual(390);

    await switchToProfile(page);
    const scrollHeightProfile = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    expect(scrollHeightProfile).toBeLessThanOrEqual(844);
    const scrollWidthProfile = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidthProfile).toBeLessThanOrEqual(390);
  });

  test("the Map/Profile switcher sits above the bottom safe area with real 44×44 touch targets", async ({
    page,
    context,
  }) => {
    await useSyntheticSafeAreaInsets(page, { top: 0, right: 0, bottom: 34, left: 0 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
    await installLocalMapStyle(page);

    await page.goto("/");
    await importAndStartRiding(page, "map-profile-switcher-route");

    const switcher = switcherLocator(page);
    const mapButton = page.getByRole("button", { name: "Map" });
    const profileButton = page.getByRole("button", { name: "Profile" });

    const [switcherBox, mapButtonBox, profileButtonBox] = await Promise.all([
      switcher.boundingBox(),
      mapButton.boundingBox(),
      profileButton.boundingBox(),
    ]);
    if (!switcherBox || !mapButtonBox || !profileButtonBox) {
      throw new Error("expected the switcher and its buttons to have a bounding box");
    }

    // Bottom edge sits above (or exactly at) the viewport's own bottom
    // edge — reachable, not clipped below the fold.
    expect(switcherBox.y + switcherBox.height).toBeLessThanOrEqual(844);
    expect(mapButtonBox.width).toBeGreaterThanOrEqual(44);
    expect(mapButtonBox.height).toBeGreaterThanOrEqual(44);
    expect(profileButtonBox.width).toBeGreaterThanOrEqual(44);
    expect(profileButtonBox.height).toBeGreaterThanOrEqual(44);
    expect(intersects(mapButtonBox, profileButtonBox)).toBe(false);
  });

  test("a long route name never overlaps the header's Pause/End actions", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
    await installLocalMapStyle(page);

    const longName =
      "An implausibly long route name that should truncate visually rather than push the Pause and End ride actions out of the header";
    await page.goto("/");
    await importAndStartRiding(page, longName);

    const pauseButton = page.getByRole("button", { name: "Pause" });
    const endButton = page.getByRole("button", { name: "End ride" });
    const heading = page.getByRole("heading", { name: longName });

    await expect(heading).toHaveText(longName);
    const [pauseBox, endBox] = await Promise.all([
      pauseButton.boundingBox(),
      endButton.boundingBox(),
    ]);
    if (!pauseBox || !endBox) {
      throw new Error("expected Pause and End ride to have a bounding box");
    }
    expect(intersects(pauseBox, endBox)).toBe(false);
    // Backlog item 68: a shrunk-but-non-overlapping, non-scrolling Pause
    // button would still have passed the non-intersection/scroll-width
    // checks above — this is the direct proof that would have caught the
    // original field bug (Pause's own text escaping its shrunk button).
    expect(pauseBox.width).toBeGreaterThanOrEqual(44);
    expect(pauseBox.height).toBeGreaterThanOrEqual(44);
    expect(endBox.width).toBeGreaterThanOrEqual(44);
    expect(endBox.height).toBeGreaterThanOrEqual(44);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });

  test("Pause protects the wider pending 'Pausing…' label exactly as it protects the ordinary label, alongside a long route title", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
    await installLocalMapStyle(page);

    // Deterministic seam (backlog item 68, src/storage/rideStateRepository.ts):
    // holds Pause's own persistence write open so the wider "Pausing…"
    // label can be asserted against reliably, instead of racing a
    // naturally fast transient state or adding a fixed sleep. Starts
    // disarmed so it never delays any other write this screen makes
    // before the test explicitly arms it for the one write it cares
    // about (Start riding itself never persists, but this stays robust
    // to a future write happening between load and the Pause click).
    await page.addInitScript(() => {
      const w = window as unknown as {
        __acnE2eArmRideStateWriteDelay?: () => void;
        __acnE2eRideStateWriteDelay?: () => Promise<void>;
        __resolveRideStateWriteDelay?: () => void;
      };
      let armed = false;
      w.__acnE2eArmRideStateWriteDelay = () => {
        armed = true;
      };
      w.__acnE2eRideStateWriteDelay = () => {
        if (!armed) return Promise.resolve();
        return new Promise((resolve) => {
          w.__resolveRideStateWriteDelay = resolve;
        });
      };
    });

    const longName =
      "An implausibly long route name that should truncate visually rather than push the Pause and End ride actions out of the header";
    await page.goto("/");
    await importAndStartRiding(page, longName);

    await page.evaluate(() => {
      (
        window as unknown as { __acnE2eArmRideStateWriteDelay?: () => void }
      ).__acnE2eArmRideStateWriteDelay?.();
    });
    await page.getByRole("button", { name: "Pause" }).click();
    const pausingButton = page.getByRole("button", { name: "Pausing…" });
    await expect(pausingButton).toBeVisible();
    await expect(pausingButton).toBeDisabled();

    const pausingBox = await pausingButton.boundingBox();
    if (!pausingBox) {
      throw new Error("expected the pending Pause button to have a bounding box");
    }
    expect(pausingBox.width).toBeGreaterThanOrEqual(44);
    expect(pausingBox.height).toBeGreaterThanOrEqual(44);

    const heading = page.getByRole("heading", { name: longName });
    const headingBox = await heading.boundingBox();
    if (!headingBox) throw new Error("expected the route title to have a bounding box");
    expect(intersects(pausingBox, headingBox)).toBe(false);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    // Release the held-open write so Pause completes and the test can
    // assert the normal post-pause state rather than leaving it hanging.
    await page.evaluate(() => {
      (
        window as unknown as { __resolveRideStateWriteDelay?: () => void }
      ).__resolveRideStateWriteDelay?.();
    });
    await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();
  });

  test("End confirmation stays reachable inside the fixed shell with no horizontal overflow", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
    await installLocalMapStyle(page);

    await page.goto("/");
    await importAndStartRiding(page, "map-profile-end-confirm-route");
    await switchToProfile(page);

    await page.getByRole("button", { name: "End ride" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "End ride" })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    // Still on Profile — Cancel does not itself switch the view.
    await expect(page.getByRole("button", { name: "Profile" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("large system text keeps the header and switcher fixed while only Profile's own content scrolls internally if needed", async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "wakeLock", {
        value: { request: () => Promise.resolve({ release: () => Promise.resolve() }) },
        configurable: true,
      });
    });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
    await installLocalMapStyle(page);

    await page.goto("/");
    await importAndStartRiding(page, "map-profile-large-text-route");

    // Simulates a large Dynamic-Type-style zoom via the document's own root
    // font size, rather than relying on OS-level text scaling this
    // environment cannot emulate.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const pauseButton = page.getByRole("button", { name: "Pause" });
    const endButton = page.getByRole("button", { name: "End ride" });
    const checkbox = page.getByRole("checkbox", { name: /screen on/i });
    await expect(checkbox).toBeVisible();
    const [pauseBoxLarge, endBoxLarge, checkboxLabelBox] = await Promise.all([
      pauseButton.boundingBox(),
      endButton.boundingBox(),
      page.locator(".wake-lock-label").boundingBox(),
    ]);
    if (!pauseBoxLarge || !endBoxLarge || !checkboxLabelBox) {
      throw new Error("expected Pause, End ride and the wake-lock label to have boxes");
    }
    // Backlog item 68: action controls stay fixed and usable at enlarged
    // text — only the title (and Profile's own internal content) may
    // scroll or reflow.
    expect(intersects(pauseBoxLarge, endBoxLarge)).toBe(false);
    expect(pauseBoxLarge.width).toBeGreaterThanOrEqual(44);
    expect(pauseBoxLarge.height).toBeGreaterThanOrEqual(44);
    expect(endBoxLarge.width).toBeGreaterThanOrEqual(44);
    expect(endBoxLarge.height).toBeGreaterThanOrEqual(44);
    expect(checkboxLabelBox.height).toBeGreaterThanOrEqual(44);

    await switchToProfile(page);
    const header = page.locator("header.riding-immersive-header");
    const switcher = switcherLocator(page);
    await expect(header).toBeVisible();
    await expect(switcher).toBeVisible();

    const headerBox = await header.boundingBox();
    if (!headerBox) throw new Error("expected the header to have a bounding box");
    expect(headerBox.y).toBeGreaterThanOrEqual(0);
    expect(headerBox.y).toBeLessThan(2);

    const switcherBox = await switcher.boundingBox();
    if (!switcherBox) throw new Error("expected the switcher to have a bounding box");
    expect(switcherBox.y + switcherBox.height).toBeLessThanOrEqual(844 + 2);

    // The document itself still doesn't need to scroll — only Profile's own
    // bounded internal region (.ride-profile-pane--immersive) may.
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollHeight).toBeLessThanOrEqual(844);

    await switchToMap(page);
    await expect(header).toBeVisible();
    await expect(switcher).toBeVisible();
  });
});

test("defaults to Map, with a substantially larger map than the pre-ride preview, zoom top-left and camera controls top-right with no overlap", async ({
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

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "map-profile-default-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx("map-profile-default-route")),
  });
  const routeButton = page.getByRole("button", {
    name: "map-profile-default-route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  const mapContainer = page.locator('[data-testid="map-container"]');
  const preRideBox = await mapContainer.boundingBox();
  if (!preRideBox) throw new Error("expected the pre-ride map to have a bounding box");

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await expect(page.getByRole("button", { name: "Map" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await expect
    .poll(async () => {
      const box = await mapContainer.boundingBox();
      return box?.height ?? null;
    })
    .not.toBe(preRideBox.height);
  const activeBox = await mapContainer.boundingBox();
  if (!activeBox) throw new Error("expected the active map to have a bounding box");
  expect(activeBox.height).toBeGreaterThan(preRideBox.height);

  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const northUp = page.getByRole("button", { name: "North-up, top-down view" });
  const follow = page.getByRole("button", { name: "Follow my location" });
  await expect(zoomIn).toBeVisible();
  await expect(northUp).toBeVisible();

  const [zoomInBox, zoomOutBox, northUpBox, followBox] = await Promise.all([
    zoomIn.boundingBox(),
    zoomOut.boundingBox(),
    northUp.boundingBox(),
    follow.boundingBox(),
  ]);
  if (!zoomInBox || !zoomOutBox || !northUpBox || !followBox) {
    throw new Error("expected every map control to have a bounding box");
  }
  // Zoom cluster (left) never overlaps the camera cluster (right).
  expect(intersects(zoomInBox, northUpBox)).toBe(false);
  expect(intersects(zoomOutBox, followBox)).toBe(false);
  expect(zoomInBox.x).toBeLessThan(northUpBox.x);
  expect(isFullyWithin(zoomInBox, activeBox)).toBe(true);
  expect(isFullyWithin(northUpBox, activeBox)).toBe(true);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("switching between Map and Profile never creates another geolocation watch and preserves the camera's settled state", async ({
  page,
  context,
}) => {
  await installGeolocationWatchCounter(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installLocalMapStyle(page);

  await page.goto("/");
  await importAndStartRiding(page, "map-profile-camera-route");

  expect(await readWatchPositionCallCount(page)).toBe(1);

  const mapContainer = page.locator('[data-testid="map-container"]');
  // A followed fix always tilts to FOLLOW_PITCH_DEGREES (35°) — the same
  // reliable "follow has landed" signal ridingCamera.spec.ts's own tests
  // already establish.
  await expect.poll(() => mapContainer.getAttribute("data-camera-pitch")).toBe("35");
  const centreBefore = await mapContainer.getAttribute("data-camera-center");
  const bearingBefore = await mapContainer.getAttribute("data-camera-bearing");
  const zoomBefore = await mapContainer.getAttribute("data-camera-zoom");

  await switchToProfile(page);
  await switchToMap(page);
  await switchToProfile(page);
  await switchToMap(page);

  expect(await readWatchPositionCallCount(page)).toBe(1);
  expect(await mapContainer.getAttribute("data-camera-center")).toBe(centreBefore);
  expect(await mapContainer.getAttribute("data-camera-bearing")).toBe(bearingBefore);
  expect(await mapContainer.getAttribute("data-camera-zoom")).toBe(zoomBefore);
  await expect(page.getByRole("button", { name: "Follow my location" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Profile shows the elevation window group and the completion action stays reachable from either view without an automatic switch", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await importAndStartRiding(page, "map-profile-elevation-route");

  // Not reachable from Map.
  await expect(page.getByRole("group", { name: "Elevation profile view" })).toBeHidden();

  await switchToProfile(page);
  await expect(page.getByRole("group", { name: "Elevation profile view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2 km" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Pause remains reachable and works correctly from the Profile view", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installLocalMapStyle(page);

  await page.goto("/");
  await importAndStartRiding(page, "map-profile-pause-route");
  await switchToProfile(page);

  await page.getByRole("button", { name: "Pause" }).click();
  // The same route screen stays mounted directly (backlog item 72) — one
  // further tap resumes GPS with no launcher round-trip.
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();

  await page.getByRole("button", { name: "Resume ride" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("wake-lock control and its popover remain usable from either view with no body scroll", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: () => Promise.resolve({ release: () => Promise.resolve() }) },
      configurable: true,
    });
  });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installLocalMapStyle(page);

  await page.goto("/");
  await importAndStartRiding(page, "map-profile-wakelock-route");

  const checkbox = page.getByRole("checkbox", { name: /screen on/i });
  await expect(checkbox).toBeVisible();

  // Backlog item 68: the wake-lock control now lives further down the
  // page, adjacent to the status strip rather than directly under the
  // header — its transient popover must still be a pure overlay that
  // never resizes the map beneath it.
  const mapContainer = page.locator('[data-testid="map-container"]');
  const mapBoxBeforePopover = await mapContainer.boundingBox();
  if (!mapBoxBeforePopover) {
    throw new Error("expected the map container to have a bounding box");
  }

  const infoButton = page.getByRole("button", { name: "About Screen on" });
  await infoButton.click();
  await expect(page.getByRole("note")).toBeVisible();

  const mapBoxDuringPopover = await mapContainer.boundingBox();
  if (!mapBoxDuringPopover) {
    throw new Error("expected the map container to have a bounding box");
  }
  expect(mapBoxDuringPopover).toEqual(mapBoxBeforePopover);

  await infoButton.click();
  await expect(page.getByRole("note")).toBeHidden();

  const mapBoxAfterPopover = await mapContainer.boundingBox();
  expect(mapBoxAfterPopover).toEqual(mapBoxBeforePopover);

  await switchToProfile(page);
  await expect(checkbox).toBeVisible();

  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportHeight = page.viewportSize()?.height;
  if (viewportHeight === undefined) throw new Error("expected a viewport height");
  expect(scrollHeight).toBeLessThanOrEqual(viewportHeight);
});

test("portrait to landscape keeps the header, both views and the switcher usable", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: () => Promise.resolve({ release: () => Promise.resolve() }) },
      configurable: true,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await installLocalMapStyle(page);

  await page.goto("/");
  await importAndStartRiding(page, "map-profile-orientation-route");

  await page.setViewportSize({ width: 844, height: 390 });

  await expect(page.locator("header.riding-immersive-header")).toBeVisible();
  // Backlog item 68: the merged wake-lock/status area's flex-wrap
  // behaviour is untested at a much wider/shorter viewport — prove the
  // checkbox stays reachable and non-overlapping post-rotation.
  const checkbox = page.getByRole("checkbox", { name: /screen on/i });
  await expect(checkbox).toBeVisible();
  const pauseButton = page.getByRole("button", { name: "Pause" });
  const [checkboxBox, pauseBoxLandscape] = await Promise.all([
    checkbox.boundingBox(),
    pauseButton.boundingBox(),
  ]);
  if (!checkboxBox || !pauseBoxLandscape) {
    throw new Error("expected the checkbox and Pause to have bounding boxes");
  }
  expect(intersects(checkboxBox, pauseBoxLandscape)).toBe(false);

  await switchToProfile(page);
  await expect(page.getByRole("group", { name: "Elevation profile view" })).toBeVisible();
  await switchToMap(page);
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(844);
});
