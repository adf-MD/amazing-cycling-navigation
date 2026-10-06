import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Backlog item 139: a failed End ride's error in the active riding headers,
// in both engines (this file runs under the "chromium" and "webkit-smoke"
// projects), at 390x844 portrait, in English and German, at ordinary and
// 200% root text, while riding a route and in free roam.
//
// The error used to render inside the header's End slot, which never
// shrinks: the one-line sentence widened the slot, collapsed the title to
// its padding, pushed End ride left and ran past the fixed shell's edge,
// which clipped it. It is now its own wrapping row directly beneath the
// header. Each case checks, against the same ride before its confirmation
// opened, that:
// - Pause, End ride, End's slot and the title keep their boxes;
// - the whole sentence is inside the screen and the fixed shell, with no
//   horizontal clipping, as the only alert;
// - End ride keeps focus, the stored session survives, and an ordinary
//   retry then ends the ride.
//
// The failure is synthetic: the app's existing test-only seam,
// window.__acnE2eRideStateClearFailure, fails the first clear only. It is
// armed just before End is confirmed, and its call count proves that the
// End's own clear was the one failed and that the retry cleared again.
// Browser text scaling is not iOS Larger Text, and nothing here is
// installed-iPhone evidence. No test in this file contacts a live map or
// routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const TOLERANCE_PX = 0.5;
const ROUTE_NAME = "end-failure-header-route";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

const MODES = ["route riding", "free roam"] as const;
type Mode = (typeof MODES)[number];
const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];
const TEXT_SIZES = ["100%", "200%"] as const;
type TextSize = (typeof TEXT_SIZES)[number];

const COPY = {
  en: {
    nav: "Ride",
    startFreeRoam: "Start free roam",
    startRiding: "Start riding",
    endRide: "End ride",
    chooseRoute: "Choose a route",
    failed: "The ride could not be ended on this device. Try again.",
  },
  de: {
    nav: "Fahren",
    startFreeRoam: "Freies Fahren starten",
    startRiding: "Fahrt starten",
    endRide: "Fahrt beenden",
    chooseRoute: "Route wählen",
    failed: "Die Fahrt konnte auf diesem Gerät nicht beendet werden. Versuche es erneut.",
  },
} as const;

/** Duplicated from language.spec.ts per this repo's no-shared-e2e-helpers
 * convention: writes the app-preferences singleton directly. */
async function seedLanguagePreference(page: Page, language: Language): Promise<void> {
  await page.evaluate(
    async ({ dbName, language }) => {
      await new Promise<void>((resolve, reject) => {
        // Dexie stores schema version N as IndexedDB version N*10.
        const request = indexedDB.open(dbName, 50);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("appPreferences")) {
            db.createObjectStore("appPreferences", { keyPath: "id" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("appPreferences", "readwrite");
          tx.objectStore("appPreferences").put({ id: "app", language });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error(tx.error?.message ?? "IndexedDB request failed"));
          };
        };
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "IndexedDB request failed"));
        };
      });
    },
    { dbName: DB_NAME, language },
  );
}

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${ROUTE_NAME}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

/** Starts the ride through the interface and waits for its stored session. */
async function startRide(
  page: Page,
  context: BrowserContext,
  mode: Mode,
  language: Language,
): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await page.goto("/");
  if (mode === "route riding") {
    // Import in English, where the file input's label is known, then switch.
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${ROUTE_NAME}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildStraightRouteGpx()),
    });
    await expect(
      page.getByRole("button", { name: ROUTE_NAME, exact: true }),
    ).toBeVisible();
    await seedLanguagePreference(page, language);
    await page.reload();
    await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
    await page.getByRole("button", { name: COPY[language].startRiding }).click();
  } else {
    await seedLanguagePreference(page, language);
    await page.reload();
    await page.getByRole("button", { name: COPY[language].nav, exact: true }).click();
    await page.getByRole("button", { name: COPY[language].startFreeRoam }).click();
  }
  await expect(page.locator("header.riding-immersive-header")).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ sessionId: expect.any(String) });
}

/** Waits until the header and the map region hold still over timer-driven
 * samples (never animation frames: headless WebKit can defer them). */
async function settle(page: Page, quietMs = 300): Promise<void> {
  await page.evaluate(
    (quietMs) =>
      new Promise<void>((resolve) => {
        const read = () =>
          JSON.stringify(
            [
              "header.riding-immersive-header",
              ".ride-content-area--immersive",
              "[role='alert']",
            ].map((selector) =>
              document.querySelector(selector)?.getBoundingClientRect(),
            ),
          );
        let last = read();
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          const now = read();
          if (now !== last) {
            last = now;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > 5_000) {
            resolve();
          } else {
            setTimeout(tick, 25);
          }
        };
        setTimeout(tick, 25);
      }),
    quietMs,
  );
}

async function setRootText(page: Page, size: TextSize): Promise<void> {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = size;
  }, size);
  await page.waitForTimeout(150);
  await settle(page);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HeaderBoxes {
  pause: Box;
  end: Box;
  endSlot: Box;
  title: Box;
  mapRegionHeight: number;
}

function measureHeader(page: Page): Promise<HeaderBoxes> {
  return page.evaluate(() => {
    const box = (selector: string): Box => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      pause: box("header.riding-immersive-header .riding-immersive-header-start button"),
      end: box("header.riding-immersive-header .riding-immersive-header-end button"),
      endSlot: box("header.riding-immersive-header .riding-immersive-header-end"),
      title: box("header.riding-immersive-header .riding-immersive-header-title"),
      mapRegionHeight: box(".ride-content-area--immersive").height,
    };
  });
}

/** Soft, so every moved box is reported, not only the first. */
function expectSameBox(label: string, before: Box, after: Box): void {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect
      .soft(Math.abs(after[key] - before[key]), `${label} ${key}`)
      .toBeLessThanOrEqual(TOLERANCE_PX);
  }
}

interface ErrorPlacement {
  alertsWithText: number;
  failureAlerts: number;
  insideHeader: boolean;
  belowHeader: boolean;
  scrollWidth: number;
  clientWidth: number;
  lineCount: number;
  linesOutsideScreen: string[];
  pageScrollWidth: number;
  pageClientWidth: number;
}

function measureError(page: Page, failedText: string): Promise<ErrorPlacement> {
  return page.evaluate((failedText) => {
    const alerts = [...document.querySelectorAll<HTMLElement>("[role='alert']")].filter(
      (alert) => alert.textContent.trim().length > 0,
    );
    const failures = alerts.filter((alert) => alert.textContent === failedText);
    const error = failures.at(0);
    const header = document.querySelector("header.riding-immersive-header");
    const shell = document.querySelector(".riding-fixed-shell");
    if (!error || !header || !shell) throw new Error("missing error, header or shell");
    const shellBox = shell.getBoundingClientRect();
    const errorBox = error.getBoundingClientRect();
    // The text's own extent, line by line: scrollWidth cannot show text
    // clipped by an ancestor, and never reads below the element's own box.
    const range = document.createRange();
    range.selectNodeContents(error);
    const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const outside = lines.filter(
      (rect) =>
        rect.left < Math.max(0, shellBox.left, errorBox.left) - 0.5 ||
        rect.right > Math.min(innerWidth, shellBox.right, errorBox.right) + 0.5 ||
        rect.top < Math.max(0, shellBox.top) - 0.5 ||
        rect.bottom > Math.min(innerHeight, shellBox.bottom) + 0.5,
    );
    const root = document.scrollingElement ?? document.documentElement;
    return {
      alertsWithText: alerts.length,
      failureAlerts: failures.length,
      insideHeader: header.contains(error),
      belowHeader: errorBox.top >= header.getBoundingClientRect().bottom - 0.5,
      scrollWidth: error.scrollWidth,
      clientWidth: error.clientWidth,
      lineCount: new Set(lines.map((rect) => Math.round(rect.top))).size,
      linesOutsideScreen: outside.map(
        (rect) =>
          `${rect.left.toFixed(1)}–${rect.right.toFixed(1)} × ${rect.top.toFixed(1)}–${rect.bottom.toFixed(1)}`,
      ),
      pageScrollWidth: root.scrollWidth,
      pageClientWidth: root.clientWidth,
    };
  }, failedText);
}

/** Fails the next clear of the stored session, and only that one. */
async function armFirstClearFailure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as {
      __e2eRideStateClearCalls: number;
      __acnE2eRideStateClearFailure?: () => Error | undefined;
    };
    target.__e2eRideStateClearCalls = 0;
    target.__acnE2eRideStateClearFailure = () => {
      target.__e2eRideStateClearCalls += 1;
      return target.__e2eRideStateClearCalls === 1
        ? new Error("e2e forced clear failure")
        : undefined;
    };
  });
}

function clearCalls(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eRideStateClearCalls: number })
        .__e2eRideStateClearCalls,
  );
}

const headerEndRide = (page: Page, language: Language): Locator =>
  page
    .locator("header.riding-immersive-header")
    .getByRole("button", { name: COPY[language].endRide, exact: true });

async function confirmEndRide(page: Page, language: Language): Promise<void> {
  await headerEndRide(page, language).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: COPY[language].endRide, exact: true }).click();
}

for (const mode of MODES) {
  for (const language of LANGUAGES) {
    for (const size of TEXT_SIZES) {
      test(`${mode} (${language}, ${size} root text): a failed End's error is its own row below the header, with Pause and End ride unmoved, and a retry ends the ride`, async ({
        page,
        context,
      }) => {
        await installLocalMapStyle(page);
        await startRide(page, context, mode, language);
        await setRootText(page, size);
        const before = await measureHeader(page);
        const storedBefore = await readActiveRideStateRow(page);

        await armFirstClearFailure(page);
        await confirmEndRide(page, language);
        await expect(
          page.getByRole("alert").filter({ hasText: COPY[language].failed }),
        ).toBeVisible();
        await settle(page);
        expect(await clearCalls(page), "the End's own clear was the one failed").toBe(1);

        // [behaviour] The whole sentence is on screen: no line of it outside
        // the screen, the fixed shell or its own box, and no page overflow.
        // Soft, with the geometry below, so a regression reports what the
        // rider would see before the structural checks.
        const placement = await measureError(page, COPY[language].failed);
        expect.soft(placement.linesOutsideScreen, "lines not wholly visible").toEqual([]);
        expect
          .soft(placement.scrollWidth, "the error's own overflow")
          .toBeLessThanOrEqual(placement.clientWidth);
        expect
          .soft(placement.pageScrollWidth, "page overflow")
          .toBeLessThanOrEqual(placement.pageClientWidth);

        // [behaviour] Pause, End ride, End's slot and the title are where
        // they were before the confirmation opened.
        const after = await measureHeader(page);
        expectSameBox("Pause", before.pause, after.pause);
        expectSameBox("End ride", before.end, after.end);
        expectSameBox("End's slot", before.endSlot, after.endSlot);
        expectSameBox("title", before.title, after.title);
        test.info().annotations.push({
          type: "map region",
          description: `${String(Math.round(before.mapRegionHeight))} px before, ${String(Math.round(after.mapRegionHeight))} px with the error (${String(placement.lineCount)} line(s))`,
        });

        // [structure] It is the only alert, a row of its own below the
        // header rather than inside it.
        expect(placement.failureAlerts).toBe(1);
        expect(placement.alertsWithText).toBe(1);
        expect(placement.insideHeader).toBe(false);
        expect(placement.belowHeader).toBe(true);

        // End ride keeps focus, and the stored session survives.
        await expect(headerEndRide(page, language)).toBeFocused();
        const storedAfter = await readActiveRideStateRow(page);
        expect(storedAfter?.sessionId).toBe(storedBefore?.sessionId);
        expect(storedAfter?.kind).toBe(storedBefore?.kind);

        // An ordinary retry ends the ride.
        await confirmEndRide(page, language);
        await expect(
          page.getByRole("button", { name: COPY[language].chooseRoute }),
        ).toBeVisible();
        await expect.poll(() => readActiveRideStateRow(page)).toBeNull();
        expect(await clearCalls(page), "the retry cleared again").toBe(2);
      });
    }
  }
}
