import { expect, test, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 125 in both engines (this file runs under the "chromium" and
// "webkit-smoke" projects): a representative subset of
// screenScrollRestoration.spec.ts, plus the Settings/Status switcher staying
// put, in English and German, and an item 118 reveal after a restored
// arrival. Desktop browsers at 390×844 portrait, never the installed iPhone.
//
// Waits are timer-driven (never animation frames, which headless WebKit can
// defer); scroll positions are set programmatically once a view has settled
// and only ever read back. No live map or routing provider is contacted.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];

const COPY = {
  en: {
    main: "Main",
    switcher: "Settings and Status",
    routes: "Routes",
    settings: "Settings",
    status: "Status",
  },
  de: {
    main: "Hauptbereiche",
    switcher: "Einstellungen und Status",
    routes: "Routen",
    settings: "Einstellungen",
    status: "Status",
  },
} as const;

const SETTINGS_MARKER = "#language-heading";
const STATUS_MARKER = "#diagnostics-system-status-heading";
const ROUTES_MARKER = ".route-list > li";

function routeGpx(name: string): string {
  const points = Array.from({ length: 11 }, (_, index) => {
    const lon = -0.1 + (100 * index) / (1000 / 0.0144303623099218);
    return `      <trkpt lat="51.5" lon="${String(lon)}"><ele>10.0</ele></trkpt>`;
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

async function importRoutes(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const name = `Route ${String(index).padStart(2, "0")}`;
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${name}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(routeGpx(name)),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

async function seedLanguage(page: Page, language: Language): Promise<void> {
  if (language === "en") return;
  await page.evaluate(
    ({ dbName, language }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => {
          reject(new Error("open failed"));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction("appPreferences", "readwrite");
          transaction.objectStore("appPreferences").put({ id: "app", language });
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { dbName: DB_NAME, language },
  );
  await page.reload();
}

/** Records every scroll call the app itself makes, from the start. */
async function installScrollCallRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __appScrolls: string[] }).__appScrolls = calls;
    const scrollTo = window.scrollTo.bind(window);
    window.scrollTo = ((...args: Parameters<typeof window.scrollTo>) => {
      calls.push(`scrollTo ${JSON.stringify(args)}`);
      scrollTo(...args);
    }) as typeof window.scrollTo;
    const scrollBy = window.scrollBy.bind(window);
    window.scrollBy = ((...args: Parameters<typeof window.scrollBy>) => {
      calls.push(`scrollBy ${JSON.stringify(args)}`);
      scrollBy(...args);
    }) as typeof window.scrollBy;
  });
}

const resetScrollCalls = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __appScrolls: string[] }).__appScrolls.length = 0;
  });
const scrollCalls = (page: Page) =>
  page.evaluate(() => [
    ...(window as unknown as { __appScrolls: string[] }).__appScrolls,
  ]);

const mainNav = (page: Page, language: Language, label: string) =>
  page
    .getByRole("navigation", { name: COPY[language].main })
    .getByRole("button", { name: label, exact: true });
const switcherNav = (page: Page, language: Language) =>
  page.getByRole("navigation", { name: COPY[language].switcher });
const switcherButton = (page: Page, language: Language, label: string) =>
  switcherNav(page, language).getByRole("button", { name: label, exact: true });

/** Waits until scrollY has held still for `quietMs` of timer samples. */
async function settle(page: Page, quietMs = 200): Promise<number> {
  return page.evaluate(
    (quietMs) =>
      new Promise<number>((resolve) => {
        let last = scrollY;
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          if (scrollY !== last) {
            last = scrollY;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > 5_000) {
            resolve(scrollY);
            return;
          }
          setTimeout(tick, 10);
        };
        setTimeout(tick, 10);
      }),
    quietMs,
  );
}

const scrollYOf = (page: Page) => page.evaluate(() => scrollY);

/**
 * Runs a few animation frames, so an arrival's settle loop has finished
 * before a test scrolls programmatically. A rider's own touch or wheel ends
 * that loop at once; a test's scroll is neither. Headless WebKit defers
 * frames until pointer activity, so without this the loop's next frame ran
 * at the test's next click and undid its scroll (as item 121 measured);
 * requesting frames forces them to run.
 */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames += 1;
          if (frames >= 6) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

async function scrollViewTo(page: Page, fraction: number): Promise<number> {
  await settleFrames(page);
  await page.evaluate((fraction) => {
    const scroller = document.scrollingElement ?? document.documentElement;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    window.scrollTo({ top: Math.round(max * fraction), left: 0, behavior: "auto" });
  }, fraction);
  return settle(page);
}

async function expectBackAt(page: Page, marker: string, expected: number): Promise<void> {
  await expect(page.locator(marker).first()).toBeAttached();
  await expect
    .poll(async () => Math.abs((await scrollYOf(page)) - expected) <= 1)
    .toBe(true);
  expect(Math.abs((await settle(page)) - expected)).toBeLessThanOrEqual(1);
}

const switcherTop = (page: Page, language: Language) =>
  switcherNav(page, language).evaluate((element) => element.getBoundingClientRect().top);

for (const language of LANGUAGES) {
  test(`(${language}) Settings and Status keep their own positions in both directions, with the switcher held still`, async ({
    page,
  }) => {
    await installLocalMapStyle(page);
    await page.goto("/");
    await seedLanguage(page, language);
    const copy = COPY[language];

    await mainNav(page, language, copy.settings).click();
    await expect(page.locator(SETTINGS_MARKER)).toBeAttached();
    await settle(page);
    const settingsAt = await scrollViewTo(page, 0.7);
    expect(settingsAt).toBeGreaterThan(200);
    const stuckTop = await switcherTop(page, language);

    await switcherButton(page, language, copy.status).click();
    await expectBackAt(page, STATUS_MARKER, 0); // first visit: the top
    expect(await switcherTop(page, language)).toBeCloseTo(stuckTop, 0);
    const statusAt = await scrollViewTo(page, 0.4);
    expect(statusAt).toBeGreaterThan(100);
    expect(statusAt).not.toBe(settingsAt);

    await switcherButton(page, language, copy.settings).click();
    await expectBackAt(page, SETTINGS_MARKER, settingsAt);
    expect(await switcherTop(page, language)).toBeCloseTo(stuckTop, 0);

    await switcherButton(page, language, copy.status).click();
    await expectBackAt(page, STATUS_MARKER, statusAt);
    expect(await switcherTop(page, language)).toBeCloseTo(stuckTop, 0);
  });
}

test("(en) Routes and Settings each come back where they were left, in both directions", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await page.goto("/");
  await importRoutes(page, 12);
  await settle(page);
  const routesAt = await scrollViewTo(page, 0.6);
  expect(routesAt).toBeGreaterThan(200);

  await mainNav(page, "en", "Settings").click();
  await expectBackAt(page, SETTINGS_MARKER, 0);
  const settingsAt = await scrollViewTo(page, 0.3);
  expect(settingsAt).not.toBe(routesAt);

  await mainNav(page, "en", "Routes").click();
  await expectBackAt(page, ROUTES_MARKER, routesAt);
  await mainNav(page, "en", "Settings").click();
  await expectBackAt(page, SETTINGS_MARKER, settingsAt);
  await mainNav(page, "en", "Routes").click();
  await expectBackAt(page, ROUTES_MARKER, routesAt);
});

test("(en) Routes, shorter than its saved position on return, comes back clamped to its new bottom", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await page.goto("/");
  await importRoutes(page, 12);
  await settle(page);
  const bottom = await scrollViewTo(page, 1);
  await mainNav(page, "en", "Settings").click();
  await expect(page.locator(SETTINGS_MARKER)).toBeAttached();
  await settle(page);

  await page.setViewportSize({ width: 390, height: 1300 });
  await mainNav(page, "en", "Routes").click();
  await expect(page.locator(ROUTES_MARKER).first()).toBeVisible();
  const settledAt = await settle(page, 400);
  const newBottom = await page.evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    return scroller.scrollHeight - scroller.clientHeight;
  });

  expect(newBottom).toBeLessThan(bottom);
  expect(Math.abs(settledAt - newBottom)).toBeLessThanOrEqual(1);
});

test("(en) after a restored Settings arrival, Delete key's confirmation still comes into view and Cancel's focus return is not pulled back", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await installScrollCallRecorder(page);
  await page.goto("/");
  await mainNav(page, "en", "Settings").click();
  await page.getByLabel("OpenRouteService API key").fill("dummy-e2e-key");
  await page.getByRole("button", { name: "Save on this device" }).click();
  const deleteKey = page.getByRole("button", { name: "Delete key", exact: true });
  await expect(deleteKey).toBeVisible();
  await settle(page);

  // Leave Settings with Delete key at the bottom of the window, so its
  // confirmation opens partly below it.
  const target = await deleteKey.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.max(0, Math.round(scrollY + box.bottom - innerHeight + 12));
  });
  await settleFrames(page);
  await page.evaluate((top) => {
    window.scrollTo({ top, left: 0, behavior: "auto" });
  }, target);
  const leftAt = await settle(page);
  await switcherButton(page, "en", "Status").click();
  await expect(page.locator(STATUS_MARKER)).toBeAttached();
  await settle(page);
  await switcherButton(page, "en", "Settings").click();
  await expectBackAt(page, SETTINGS_MARKER, leftAt);

  await resetScrollCalls(page);
  const box = await deleteKey.boundingBox();
  if (!box) throw new Error("Delete key is not laid out");
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const dialog = page.getByRole("dialog", { name: "Delete OpenRouteService key" });
  await expect(dialog).toBeVisible();
  await settle(page);
  const actions = await dialog.getByRole("button", { name: "Cancel" }).boundingBox();
  if (!actions) throw new Error("Cancel is not laid out");
  expect(
    actions.y + actions.height,
    "the confirmation's actions are in view",
  ).toBeLessThanOrEqual(844);
  const revealedAt = await scrollYOf(page);
  expect(revealedAt, "item 118's reveal moved the page by the minimum").toBeGreaterThan(
    leftAt,
  );

  await resetScrollCalls(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteKey).toBeFocused();
  const afterCancel = await settle(page, 400);
  expect(
    (await scrollCalls(page)).filter((call) => call.includes(`"top":${String(leftAt)}`)),
    "the restore is not reapplied",
  ).toEqual([]);
  expect(Math.abs(afterCancel - revealedAt)).toBeLessThanOrEqual(1);
});
