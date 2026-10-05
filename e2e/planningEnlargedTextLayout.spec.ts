import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import {
  installLocalMapStyle,
  installLocalMapStyleWithFailureControl,
} from "./support/localMapStyle.ts";

// Backlog item 114: the behaviour around Planning's enlarged-text layout —
// that the ordinary layout is untouched, that the switch happens in both
// directions without disturbing the map, that the map's own messages and
// attribution really work where they are rendered (MapView portals them
// below the map), and that nothing else adopts the layout. The 200% layout
// geometry itself is planningEnlargedTextLayout.smoke.spec.ts's job.

test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 844 },
  { width: 375, height: 667 },
] as const;

async function openPlanning(page: Page, context: BrowserContext): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await page.goto("/");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.locator(".planning-crosshair-callout")).toBeEnabled({
    timeout: 15_000,
  });
  await expect(page.getByTestId("map-container")).toHaveAttribute(
    "data-map-ready",
    "true",
    {
      timeout: 20_000,
    },
  );
}

async function setRootFontSize(page: Page, value: string): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = value;
  }, value);
}

/** Where the attribution actually is: inside the map (the ordinary layout)
 * or in the strip below it (the enlarged layout). */
async function attributionIsInsideMap(page: Page): Promise<boolean> {
  return page
    .locator(".map-attribution")
    .evaluate((el) => el.closest(".planning-map-container") !== null);
}

async function expectEnlarged(page: Page): Promise<void> {
  await expect.poll(() => attributionIsInsideMap(page)).toBe(false);
}

async function expectOrdinary(page: Page): Promise<void> {
  await expect.poll(() => attributionIsInsideMap(page)).toBe(true);
}

/** The ordinary Planning layout: attribution in the map's bottom-left at
 * its 8px insets on one line, the placement control centred 44px above the
 * map's bottom edge, MapView's imagery overlay inside the map, Planning's
 * own messages below it (item 128), and — with no message showing — the
 * empty below-map block adding nothing, so the next panel is still one
 * ordinary 16px gap below the map. */
async function readOrdinarySignature(page: Page) {
  return page.evaluate(() => {
    const need = (selector: string): HTMLElement => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el;
    };
    const map = need(".planning-map-container");
    const control = need(".planning-crosshair-callout");
    const attribution = need(".map-attribution");
    const messages = need(".planning-map-messages");
    const below = map.nextElementSibling;
    const next = below?.nextElementSibling ?? null;
    const m = map.getBoundingClientRect();
    const c = control.getBoundingClientRect();
    const a = attribution.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(attribution);
    const lines = new Set(
      [...range.getClientRects()]
        .filter((q) => q.width > 0)
        .map((q) => Math.round(q.top)),
    ).size;
    return {
      attributionInsideMap: map.contains(attribution),
      attributionLeftInset: a.left - m.left,
      attributionBottomInset: m.bottom - a.bottom,
      attributionLines: lines,
      controlBottomOffset: m.bottom - c.bottom,
      controlCentreOffset: c.left + c.width / 2 - (m.left + m.width / 2),
      // Absent counts as not inside, so a layout that dropped either
      // overlay fails the assertion rather than the measurement.
      imageryOverlayInsideMap: map.contains(
        document.querySelector(".map-status-overlay"),
      ),
      planningMessagesBelowMap:
        !map.contains(messages) &&
        below?.classList.contains("planning-map-below") === true &&
        below.contains(messages),
      inMapStatusOverlays: map.querySelectorAll(".planning-map-status-overlay").length,
      belowBlockHeight: below ? below.getBoundingClientRect().height : Number.NaN,
      nextIsPanel: next?.classList.contains("planning-section") ?? false,
      gapToNextPanel: next ? next.getBoundingClientRect().top - m.bottom : Number.NaN,
      attributionNodes: document.querySelectorAll(".map-attribution").length,
    };
  });
}

function expectOrdinarySignature(
  signature: Awaited<ReturnType<typeof readOrdinarySignature>>,
  context: string,
): void {
  const report = `${context}: ${JSON.stringify(signature)}`;
  expect(signature.attributionNodes, report).toBe(1);
  expect(signature.attributionInsideMap, report).toBe(true);
  expect(signature.attributionLeftInset, report).toBeCloseTo(8, 0);
  expect(signature.attributionBottomInset, report).toBeCloseTo(8, 0);
  expect(signature.attributionLines, report).toBe(1);
  expect(signature.controlBottomOffset, report).toBeCloseTo(44, 0);
  expect(Math.abs(signature.controlCentreOffset), report).toBeLessThanOrEqual(0.5);
  expect(signature.imageryOverlayInsideMap, report).toBe(true);
  expect(signature.planningMessagesBelowMap, report).toBe(true);
  expect(signature.inMapStatusOverlays, report).toBe(0);
  expect(signature.belowBlockHeight, report).toBe(0);
  expect(signature.nextIsPanel, report).toBe(true);
  expect(signature.gapToNextPanel, report).toBeCloseTo(16, 0);
}

/** Page-absolute boxes (scroll-independent) of what must never move when a
 * message comes or goes. */
async function readStableBoxes(page: Page) {
  return page.evaluate(() => {
    const abs = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      const b = el.getBoundingClientRect();
      return [b.left, b.top + window.scrollY, b.width, b.height].map(
        (v) => Math.round(v * 2) / 2,
      );
    };
    return {
      map: abs(".planning-map-container"),
      control: abs(".planning-crosshair-callout"),
      crosshair: abs(".planning-crosshair"),
      attribution: abs(".map-attribution"),
    };
  });
}

/** The enlarged layout's below-map block holds no empty message area: its
 * height is exactly the attribution strip's. */
async function readBelowMapHeights(page: Page) {
  return page.evaluate(() => {
    const below = document.querySelector(".planning-map-below");
    const strip = document.querySelector(".planning-map-attribution-strip");
    if (!below || !strip)
      throw new Error("expected the enlarged layout's below-map block");
    return {
      below: below.getBoundingClientRect().height,
      strip: strip.getBoundingClientRect().height,
    };
  });
}

test.describe("ordinary text", () => {
  for (const size of SIZES) {
    test(`at 100% text, ${String(size.width)}x${String(size.height)} keeps the ordinary Planning layout exactly`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize(size);
      await installLocalMapStyle(page);
      await openPlanning(page, context);
      expectOrdinarySignature(await readOrdinarySignature(page), "100% text");
    });
  }

  test("a keyboard that shrank the layout viewport and left the switch's size reference at its 280px floor would not switch layouts (a proxy, not device evidence)", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installLocalMapStyle(page);
    await openPlanning(page, context);
    // iOS Safari and current Android Chrome do not resize the layout
    // viewport for the on-screen keyboard (index.html sets no
    // interactive-widget), so this is the worst case rather than the usual
    // one: a keyboard taking most of the height, as a resizes-content
    // browser would.
    await page.setViewportSize({ width: 390, height: 480 });
    // Item 122: the switch reads the size reference, which keeps the
    // enlarged layout's height and sits at its 280px floor (17.5rem at
    // 16px); the ordinary map itself is at its own, higher 340px floor.
    await expect
      .poll(() =>
        page
          .locator(".planning-map-size-reference")
          .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
      )
      .toBe(280);
    await expect
      .poll(() =>
        page
          .locator(".planning-map-container")
          .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
      )
      .toBe(340);
    expectOrdinarySignature(await readOrdinarySignature(page), "reference at its floor");
  });
});

test.describe("switching", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("before the first paint: opened at 200% text, the attribution is never painted inside the map", async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      // An init script runs before the parser has created <html>, so the
      // root font size is applied the moment that element exists — still
      // before any application script runs.
      const applyRootFontSize = () => {
        // Typed as nullable because it genuinely is null before parsing.
        const root = document.documentElement as HTMLElement | null;
        if (root) root.style.fontSize = "200%";
      };
      applyRootFontSize();
      new MutationObserver(applyRootFontSize).observe(document, { childList: true });
      const w = window as unknown as {
        __insideMapFrames: number;
        __attributionFrames: number;
      };
      w.__insideMapFrames = 0;
      w.__attributionFrames = 0;
      const sample = () => {
        const attribution = document.querySelector(".map-attribution");
        if (attribution) {
          w.__attributionFrames += 1;
          if (attribution.closest(".planning-map-container")) w.__insideMapFrames += 1;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await installLocalMapStyle(page);
    await openPlanning(page, context);
    expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe(
      "200%",
    );
    await expectEnlarged(page);
    const frames = await page.evaluate(() => {
      const w = window as unknown as {
        __insideMapFrames: number;
        __attributionFrames: number;
      };
      return { inside: w.__insideMapFrames, total: w.__attributionFrames };
    });
    expect(frames.total).toBeGreaterThan(0);
    expect(frames.inside).toBe(0);
  });

  test("after mount: switching 100% → 200% → 100% → 200% alternates the layouts and never recreates the map canvas", async ({
    page,
    context,
  }) => {
    await installLocalMapStyle(page);
    await openPlanning(page, context);
    expectOrdinarySignature(await readOrdinarySignature(page), "start");
    await page.evaluate(() => {
      (window as unknown as { __canvas: Element | null }).__canvas =
        document.querySelector(".maplibregl-canvas");
    });

    await setRootFontSize(page, "200%");
    await expectEnlarged(page);
    await setRootFontSize(page, "");
    await expectOrdinary(page);
    expectOrdinarySignature(await readOrdinarySignature(page), "back at 100%");
    await setRootFontSize(page, "200%");
    await expectEnlarged(page);

    const sameCanvas = await page.evaluate(() => {
      const canvas = document.querySelector(".maplibregl-canvas");
      return (
        canvas !== null &&
        canvas === (window as unknown as { __canvas: Element | null }).__canvas
      );
    });
    expect(sameCanvas).toBe(true);
    expect(await page.locator(".map-attribution").count()).toBe(1);
  });

  test("near the threshold it switches in both directions", async ({ page, context }) => {
    // At 390x844 the map is 358px wide, so the enlarged layout engages once
    // the root font exceeds 358/17 = 21.06px (131.6%) and releases below
    // 358/17.25 = 20.75px (129.7%) — see enlargedTextLayout.ts. 125% and
    // 140% sit clearly either side.
    await installLocalMapStyle(page);
    await openPlanning(page, context);
    await setRootFontSize(page, "125%");
    await expectOrdinary(page);
    await setRootFontSize(page, "140%");
    await expectEnlarged(page);
    await setRootFontSize(page, "125%");
    await expectOrdinary(page);
    expect(await page.locator(".map-attribution").count()).toBe(1);
  });
});

test.describe("map messages in the enlarged layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Retry in the in-flow imagery message really retries, and when imagery recovers the message leaves no empty area and nothing above it moves", async ({
    page,
    context,
  }) => {
    const style = await installLocalMapStyleWithFailureControl(page);
    style.failStyle();
    await openPlanning(page, context);
    const banner = page.getByTestId("map-fallback-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });

    await setRootFontSize(page, "200%");
    await expectEnlarged(page);
    await expect
      .poll(() => banner.evaluate((el) => el.closest(".planning-map-messages") !== null))
      .toBe(true);
    await expect(banner).toHaveAttribute("role", "status");
    const before = await readStableBoxes(page);

    style.succeedStyle();
    const succeededBefore = style.succeededStyleRequestCount();
    await page.getByTestId("retry-map-imagery-button").click();
    await expect
      .poll(() => style.succeededStyleRequestCount())
      .toBeGreaterThan(succeededBefore);
    await expect(banner).not.toBeAttached({ timeout: 15_000 });
    // The retried map reports its own full load; any transient loading
    // message has gone by then.
    await expect(page.getByTestId("map-container")).toHaveAttribute(
      "data-map-ready",
      "true",
      {
        timeout: 20_000,
      },
    );
    await expect(page.locator(".map-status-message")).toHaveCount(0);

    expect(await readStableBoxes(page)).toEqual(before);
    const heights = await readBelowMapHeights(page);
    expect(heights.below).toBeCloseTo(heights.strip, 1);
  });

  test("the imagery message follows the layout across switches, and Retry still works afterwards", async ({
    page,
    context,
  }) => {
    const style = await installLocalMapStyleWithFailureControl(page);
    style.failStyle();
    await openPlanning(page, context);
    const banner = page.getByTestId("map-fallback-banner");
    const retry = page.getByTestId("retry-map-imagery-button");
    await expect(banner).toBeVisible({ timeout: 15_000 });

    const insideMap = () =>
      banner.evaluate((el) => el.closest(".planning-map-container") !== null);
    await setRootFontSize(page, "200%");
    await expect.poll(insideMap).toBe(false);
    await setRootFontSize(page, "");
    await expect.poll(insideMap).toBe(true);
    await setRootFontSize(page, "200%");
    await expect.poll(insideMap).toBe(false);
    await expect(retry).toHaveCount(1);

    const failedBefore = style.failedStyleRequestCount();
    await retry.click();
    await expect
      .poll(() => style.failedStyleRequestCount())
      .toBeGreaterThan(failedBefore);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect.poll(insideMap).toBe(false);
    await expect(retry).toHaveCount(1);
  });

  test("a location failure appears in flow below the map and clears on a later successful Locate me, leaving no empty area", async ({
    page,
    context,
  }) => {
    await installLocalMapStyle(page);
    await openPlanning(page, context);
    await setRootFontSize(page, "200%");
    await expectEnlarged(page);
    const before = await readStableBoxes(page);

    await page.evaluate(() => {
      const w = window as unknown as {
        __realGetCurrentPosition: Geolocation["getCurrentPosition"];
      };
      w.__realGetCurrentPosition = navigator.geolocation.getCurrentPosition.bind(
        navigator.geolocation,
      );
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        error?.({
          code: 1,
          message: "denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      };
    });
    await page.getByRole("button", { name: "Locate me" }).click();
    const message = page.getByText("Your location could not be determined.");
    await expect(message).toBeVisible();
    await expect(message).toHaveAttribute("role", "status");
    expect(
      await message.evaluate((el) => el.closest(".planning-map-messages") !== null),
    ).toBe(true);
    expect(await readStableBoxes(page)).toEqual(before);

    await page.evaluate(() => {
      const w = window as unknown as {
        __realGetCurrentPosition: Geolocation["getCurrentPosition"];
      };
      navigator.geolocation.getCurrentPosition = w.__realGetCurrentPosition;
    });
    await page.getByRole("button", { name: "Locate me" }).click();
    await expect(message).not.toBeAttached();
    const heights = await readBelowMapHeights(page);
    expect(heights.below).toBeCloseTo(heights.strip, 1);
  });
});

test("at 200% text the map still pans from beside the placement control, without adding a waypoint", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installLocalMapStyle(page);
  await openPlanning(page, context);
  await setRootFontSize(page, "200%");
  await expectEnlarged(page);

  const map = page.getByTestId("map-container");
  const control = page.locator(".planning-crosshair-callout");
  await control.scrollIntoViewIfNeeded();
  const mapBox = await page.locator(".planning-map-container").boundingBox();
  const controlBox = await control.boundingBox();
  if (!mapBox || !controlBox) throw new Error("expected the map and control to lay out");
  // Beside the control, clear of its 4px isolation band, inside the map.
  const startX = (mapBox.x + controlBox.x - 4) / 2;
  const startY = controlBox.y + controlBox.height / 2;
  expect(startX).toBeLessThan(controlBox.x - 4);
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.classList.contains("maplibregl-canvas"),
      { x: startX, y: startY },
    ),
  ).toBe(true);

  const waypointsBefore = await page.locator(".waypoint-list li").count();
  const centreBefore = await map.getAttribute("data-camera-center");
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY - 40, { steps: 12 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect.poll(() => map.getAttribute("data-camera-center")).not.toBe(centreBefore);
  expect(await page.locator(".waypoint-list li").count()).toBe(waypointsBefore);
});

test("Riding keeps its own attribution inside its map at 200% text", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await setRootFontSize(page, "200%");
  await page.waitForTimeout(300);
  const attribution = page.locator(".map-attribution");
  await expect(attribution).toHaveCount(1);
  expect(
    await attribution.evaluate((el) => el.closest(".ride-map-container") !== null),
  ).toBe(true);
});
