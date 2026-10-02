import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Backlog item 131, in both engines (this file runs under the "chromium"
// and "webkit-smoke" projects), in English and German: a ride resumed from
// the Ride launcher's one-tap Resume ride, then paused.
//
// (A) Pause shows the ordinary paused controls, not the pending
//     "Resuming your ride…" status — the display.
// (B) After that Pause, Routes and back keeps the ride paused and starts
//     no watch; only an explicit Resume starts one, and a second Pause
//     still works — the instruction's lifetime.
//
// (A) and (B) are separate tests on purpose: (B) waits only on the Pause
// itself (the watch cleared, the main navigation back) and never on the
// paused controls, so a broken display cannot hide a replayed watch.
//
// The unfinished ride is created through the real UI, then the page is
// reloaded so the launcher's cold resume is the path under test, as in
// ridingLauncher.spec.ts (whose helpers are duplicated locally, per this
// project's convention). Watches are counted by wrapping
// navigator.geolocation before the app's own scripts run; the counters
// restart on every page load.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 50;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];

const COPY = {
  en: {
    ride: "Ride",
    routes: "Routes",
    resumeRide: "Resume ride",
    resuming: "Resuming your ride…",
  },
  de: {
    ride: "Fahren",
    routes: "Routen",
    resumeRide: "Fahrt fortsetzen",
    resuming: "Deine Fahrt wird fortgesetzt…",
  },
} as const;

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
    <name>Pause after resume test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function installGeolocationCounters(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const holder = window as unknown as { __acnWatches: number; __acnClears: number };
    holder.__acnWatches = 0;
    holder.__acnClears = 0;
    const geolocation = navigator.geolocation;
    const watch = geolocation.watchPosition.bind(geolocation);
    const clear = geolocation.clearWatch.bind(geolocation);
    geolocation.watchPosition = (
      ...args: Parameters<typeof geolocation.watchPosition>
    ) => {
      holder.__acnWatches += 1;
      return watch(...args);
    };
    geolocation.clearWatch = (watchId: number) => {
      holder.__acnClears += 1;
      clear(watchId);
    };
  });
}

function watches(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __acnWatches: number }).__acnWatches,
  );
}

function clears(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __acnClears: number }).__acnClears);
}

/** Samples repeatedly, never stopping at the first success, that the
 * watch count stays where it is. */
async function expectWatchesToStay(page: Page, count: number): Promise<void> {
  for (let sample = 0; sample < 10; sample += 1) {
    expect(await watches(page), `watch count, sample ${String(sample)}`).toBe(count);
    await page.waitForTimeout(150);
  }
}

async function seedLanguagePreference(page: Page, language: Language): Promise<void> {
  await page.evaluate(
    async ({ dbName, language }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 50);
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

/** A real, unfinished route ride with a fix and progress, then a reload:
 * the app lands on Routes, and the Ride launcher offers Resume ride. */
async function prepareLauncherResume(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<{ consoleErrors: string[]; routeId: string }> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  await installLocalMapStyle(page);
  await installGeolocationCounters(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  const routeName = "pause-after-resume-route";
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${routeName}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();
  const routeId = await readSavedRouteId(page, routeName);
  if (!routeId) throw new Error("expected the imported route's id");
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "route", routeId, lastFix: expect.anything() });

  if (language !== "en") await seedLanguagePreference(page, language);
  await page.reload();
  await page.getByRole("button", { name: COPY[language].ride, exact: true }).click();
  await expect(
    page.getByRole("button", { name: COPY[language].resumeRide }),
  ).toBeVisible();
  expect(await watches(page)).toBe(0);
  return { consoleErrors, routeId };
}

/** The launcher's one-tap Resume ride, reaching active tracking. */
async function resumeFromLauncher(page: Page, language: Language): Promise<void> {
  await page.getByRole("button", { name: COPY[language].resumeRide }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect.poll(() => watches(page)).toBe(1);
}

for (const language of LANGUAGES) {
  test(`(A, ${language}) Pause after a launcher Resume shows the ordinary paused controls, stops the watch and keeps the session`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { consoleErrors, routeId } = await prepareLauncherResume(
      page,
      context,
      language,
    );
    await resumeFromLauncher(page, language);

    await page.getByRole("button", { name: "Pause", exact: true }).click();

    await expect(
      page.getByRole("button", { name: COPY[language].resumeRide }),
    ).toBeVisible();
    await expect(page.getByText(COPY[language].resuming)).toHaveCount(0);
    await expect.poll(() => clears(page)).toBe(1);
    await expect
      .poll(() => readActiveRideStateRow(page))
      .toMatchObject({ kind: "route", routeId, lastFix: expect.anything() });
    await expectWatchesToStay(page, 1);
    expect(consoleErrors).toEqual([]);
  });

  test(`(B, ${language}) after that Pause, Routes and back stays paused with no new watch; an explicit Resume starts one and a second Pause works`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { consoleErrors, routeId } = await prepareLauncherResume(
      page,
      context,
      language,
    );
    await resumeFromLauncher(page, language);

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    // Waits on the Pause itself only — never on the paused controls.
    await expect.poll(() => clears(page)).toBe(1);
    const routesTab = page.getByRole("button", {
      name: COPY[language].routes,
      exact: true,
    });
    await expect(routesTab).toBeVisible();

    await routesTab.click();
    await expect(
      page.getByRole("heading", { level: 1, name: COPY[language].routes }),
    ).toBeVisible();
    await page.getByRole("button", { name: COPY[language].ride, exact: true }).click();

    // Restoration has settled once either control shows: the paused
    // screen's Resume ride, or — were the instruction replayed — Pause.
    const resume = page.getByRole("button", { name: COPY[language].resumeRide });
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await expect(resume.or(pause)).toBeVisible();
    await expectWatchesToStay(page, 1);
    await expect(resume).toBeVisible();
    await expect(pause).toHaveCount(0);

    // Only a fresh, explicit Resume starts tracking again — exactly once.
    await resume.click();
    await expect(pause).toBeVisible();
    await expect.poll(() => watches(page)).toBe(2);

    await pause.click();
    await expect(resume).toBeVisible();
    await expect(page.getByText(COPY[language].resuming)).toHaveCount(0);
    await expect.poll(() => clears(page)).toBe(2);
    await expectWatchesToStay(page, 2);
    await expect
      .poll(() => readActiveRideStateRow(page))
      .toMatchObject({ kind: "route", routeId, lastFix: expect.anything() });
    expect(consoleErrors).toEqual([]);
  });
}
