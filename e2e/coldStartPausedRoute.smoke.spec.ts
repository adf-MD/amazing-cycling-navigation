import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { editCopyAnnouncement } from "./support/editCopyNotice.ts";
import {
  readActiveRideStateRow,
  readSavedRouteId,
  writeActiveRideStateRow,
} from "./support/rideStateDb.ts";

// Backlog item 132, in both engines (this file runs under the "chromium"
// and "webkit-smoke" projects), in English and German where wording
// matters: after a real reload — the browser's stand-in for fully closing
// and reopening the installed PWA, not device evidence — the first entry
// into Ride shows a stored route ride's own paused screen, not the Ride
// launcher's summary of it. Restoring it starts no location watch; Resume
// stays an explicit tap.
//
// Watches are counted by wrapping navigator.geolocation before the app's
// own scripts run; the counters restart on every page load. Storage-read
// failures are synthetic: an init script wraps IDBObjectStore.prototype.get
// for the rideState store and fails exactly the reads a test plans, so no
// production seam is involved. Nothing here contacts a live map or routing
// provider.
//
// Unfinished rides are created through the real UI, as in
// ridingPauseAfterResume.smoke.spec.ts, whose helpers are duplicated here
// per this project's convention.

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
    startRiding: "Start riding",
    editCopy: "Edit copy",
    endRide: "End ride",
    endConfirmTitle: "End this ride?",
    cancel: "Cancel",
    backToRideOptions: "Back to Ride options",
    stale: "Stale",
    retry: "Retry",
    restoreFailed: "Your ride could not be restored on this device. Try again.",
    checkFailed:
      "Your unfinished ride status could not be checked. Nothing has been changed.",
    unfinishedRide: "You have an unfinished ride on this route.",
    chooseRoute: "Choose a route",
    routeProfile: "Route profile",
    elevationChart: "Elevation profile chart",
  },
  de: {
    ride: "Fahren",
    routes: "Routen",
    resumeRide: "Fahrt fortsetzen",
    startRiding: "Fahrt starten",
    editCopy: "Kopie bearbeiten",
    endRide: "Fahrt beenden",
    endConfirmTitle: "Diese Fahrt beenden?",
    cancel: "Abbrechen",
    backToRideOptions: "Zurück zur Auswahl",
    stale: "Veraltet",
    retry: "Erneut versuchen",
    restoreFailed:
      "Deine Fahrt konnte auf diesem Gerät nicht wiederhergestellt werden. Versuche es erneut.",
    checkFailed: "Der Fahrtstatus konnte nicht geprüft werden. Es wurde nichts geändert.",
    unfinishedRide: "Du hast auf dieser Route eine unbeendete Fahrt.",
    chooseRoute: "Route wählen",
    routeProfile: "Höhenprofil",
    elevationChart: "Höhenprofildiagramm",
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
    <name>Cold-start paused route test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

/** Counts watchPosition/clearWatch calls. With window.__acnWithholdFixes
 * set (see withholdFixes), a watch is counted but never reaches the real
 * geolocation, so no fix ever arrives. */
async function installGeolocationCounters(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const holder = window as unknown as {
      __acnWatches: number;
      __acnClears: number;
      __acnWithholdFixes?: boolean;
    };
    holder.__acnWatches = 0;
    holder.__acnClears = 0;
    const geolocation = navigator.geolocation;
    const watch = geolocation.watchPosition.bind(geolocation);
    const clear = geolocation.clearWatch.bind(geolocation);
    const withheldIds = new Set<number>();
    let nextWithheldId = 1_000_000;
    geolocation.watchPosition = (
      ...args: Parameters<typeof geolocation.watchPosition>
    ) => {
      holder.__acnWatches += 1;
      if (holder.__acnWithholdFixes === true) {
        const id = (nextWithheldId += 1);
        withheldIds.add(id);
        return id;
      }
      return watch(...args);
    };
    geolocation.clearWatch = (watchId: number) => {
      holder.__acnClears += 1;
      if (withheldIds.delete(watchId)) return;
      clear(watchId);
    };
  });
}

async function withholdFixes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __acnWithholdFixes: boolean }).__acnWithholdFixes = true;
  });
}

/** Fails the rideState reads a test plans, in order: "fail" throws a
 * synthetic DOMException from IDBObjectStore.prototype.get, which Dexie
 * turns into a rejected read; "pass", or an empty plan, reads normally.
 * Arm it only immediately before the action under test — the e2e storage
 * helpers read the same store. */
async function installRideStateReadFaults(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const holder = window as unknown as { __acnRideStateReadPlan: string[] };
    holder.__acnRideStateReadPlan = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange,
    ) {
      if (this.name === "rideState" && holder.__acnRideStateReadPlan.shift() === "fail") {
        throw new DOMException("Synthetic ride-state read fault", "UnknownError");
      }
      return originalGet.call(this, query);
    };
  });
}

async function planRideStateReads(page: Page, plan: ("pass" | "fail")[]): Promise<void> {
  await page.evaluate((steps) => {
    (window as unknown as { __acnRideStateReadPlan: string[] }).__acnRideStateReadPlan =
      steps;
  }, plan);
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

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  return consoleErrors;
}

/** The remaining distance the status card shows, as a number of km, or
 * null when no card shows it. Read from its spelled-out label. */
async function remainingKm(page: Page): Promise<number | null> {
  const label = page.locator(
    '[aria-label*="kilometres remaining"], [aria-label^="Noch "][aria-label*="Kilometer"]',
  );
  if ((await label.count()) === 0) return null;
  const text = (await label.first().textContent()) ?? "";
  const match = /([\d.,]+)\s*km/.exec(text);
  return match?.[1] ? Number(match[1].replace(",", ".")) : null;
}

const ROUTE_NAME = "cold-start-paused-route";

/** A real route ride with a fix and progress 400 m along, created through
 * the UI and still tracking: the state a phone is in when the PWA is
 * closed mid-ride. Returns the stored row and the card's remaining km. */
async function establishUnfinishedRide(
  page: Page,
  context: BrowserContext,
): Promise<{ routeId: string; row: Record<string, unknown>; remaining: number }> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${ROUTE_NAME}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });
  await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();
  const routeId = await readSavedRouteId(page, ROUTE_NAME);
  if (!routeId) throw new Error("expected the imported route's id");
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({
      kind: "route",
      routeId,
      lastFix: expect.anything(),
      matchedDistanceFromStartMetres: expect.any(Number),
    });
  await expect.poll(() => remainingKm(page)).not.toBeNull();
  const remaining = await remainingKm(page);
  const row = await readActiveRideStateRow(page);
  if (!row || remaining === null) throw new Error("expected a stored ride with progress");
  return { routeId, row, remaining };
}

async function reloadInto(page: Page, language: Language): Promise<void> {
  if (language !== "en") await seedLanguagePreference(page, language);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: COPY[language].routes }),
  ).toBeVisible();
}

function rideTab(page: Page, language: Language) {
  return page.getByRole("button", { name: COPY[language].ride, exact: true });
}

/** The full paused route screen, as opposed to the launcher's summary:
 * its own route heading, map, route profile, Resume ride, Edit copy, Back
 * to Ride options and End ride, with no launcher text. */
async function expectFullPausedScreen(page: Page, language: Language): Promise<void> {
  const copy = COPY[language];
  await expect(page.getByRole("button", { name: copy.resumeRide })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: ROUTE_NAME, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: copy.routeProfile, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: copy.elevationChart, exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: copy.editCopy })).toBeVisible();
  await expect(page.getByRole("button", { name: copy.backToRideOptions })).toBeVisible();
  await expect(
    page.getByRole("button", { name: copy.endRide, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(copy.unfinishedRide)).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.startRiding })).toHaveCount(0);
}

for (const language of LANGUAGES) {
  const copy = COPY[language];

  test(`(${language}) a reload then Ride shows the full paused route screen with its restored progress, changes nothing stored and starts no watch`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const consoleErrors = collectConsoleErrors(page);
    await installLocalMapStyle(page);
    await installGeolocationCounters(page);
    const { row, remaining } = await establishUnfinishedRide(page, context);

    await reloadInto(page, language);
    await rideTab(page, language).click();

    await expectFullPausedScreen(page, language);
    await expect(page.getByText(copy.stale, { exact: false }).first()).toBeVisible();
    expect(await remainingKm(page)).toBe(remaining);
    await expectWatchesToStay(page, 0);
    expect(await readActiveRideStateRow(page)).toEqual(row);
    expect(consoleErrors).toEqual([]);
  });

  test(`(${language}) a failed check on entering Ride offers Retry, and Retry opens the paused screen without a watch`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await installLocalMapStyle(page);
    await installGeolocationCounters(page);
    await installRideStateReadFaults(page);
    await establishUnfinishedRide(page, context);
    await reloadInto(page, language);

    await planRideStateReads(page, ["fail"]);
    await rideTab(page, language).click();
    await expect(page.getByRole("alert")).toHaveText(copy.checkFailed);
    await expect(page.getByRole("button", { name: copy.chooseRoute })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.resumeRide })).toHaveCount(0);

    await page.getByRole("button", { name: copy.retry }).click();
    await expectFullPausedScreen(page, language);
    await expectWatchesToStay(page, 0);
  });

  for (const entry of ["ride-tab", "routes-card"] as const) {
    test(`(${language}, ${entry}) a failed restoration on the paused route screen explains itself, and its Retry restores the screen without a watch`, async ({
      page,
      context,
    }) => {
      test.setTimeout(90_000);
      await installLocalMapStyle(page);
      await installGeolocationCounters(page);
      await installRideStateReadFaults(page);
      const { row } = await establishUnfinishedRide(page, context);
      await reloadInto(page, language);

      // The first read — the launcher's check, or the Routes card's guard —
      // succeeds; the screen's own restoration read fails.
      await planRideStateReads(page, ["pass", "fail"]);
      if (entry === "ride-tab") {
        await rideTab(page, language).click();
      } else {
        await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
      }
      const alert = page.getByRole("alert");
      await expect(alert).toContainText(copy.restoreFailed);
      await expect(alert.getByRole("button", { name: copy.retry })).toBeVisible();
      await expect(
        alert.getByRole("button", { name: copy.backToRideOptions }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: copy.startRiding })).toHaveCount(0);
      await expect(page.getByRole("button", { name: copy.resumeRide })).toHaveCount(0);

      await alert.getByRole("button", { name: copy.retry }).click();
      await expectFullPausedScreen(page, language);
      await expectWatchesToStay(page, 0);
      expect(await readActiveRideStateRow(page)).toEqual(row);
    });
  }

  test(`(${language}) a ride paused before its first fix reopens as Resume ride with End ride; End ride's Cancel keeps it and its confirmation ends it, keeping the route`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await installLocalMapStyle(page);
    await installGeolocationCounters(page);
    await withholdFixes(page);
    await context.grantPermissions(["geolocation"]);

    // A fresh ride whose first fix never arrives, then a successful Pause.
    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${ROUTE_NAME}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildStraightRouteGpx()),
    });
    await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
    await page.getByRole("button", { name: "Start riding" }).click();
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await expect(pause).toBeVisible();
    await expect.poll(() => watches(page)).toBe(1);
    await pause.click();
    await expect.poll(() => clears(page)).toBe(1);
    const routeId = await readSavedRouteId(page, ROUTE_NAME);
    await expect
      .poll(() => readActiveRideStateRow(page))
      .toMatchObject({ kind: "route", routeId, lastFix: null });
    const row = await readActiveRideStateRow(page);

    // That actual saved session, restored after a reload, on the full
    // paused route screen — not the launcher's summary, which also offers
    // Resume ride and End ride — and offered as a ride to resume or end.
    await reloadInto(page, language);
    await rideTab(page, language).click();
    await expectFullPausedScreen(page, language);
    const endRide = page.getByRole("button", { name: copy.endRide, exact: true });
    await expectWatchesToStay(page, 0);

    // End ride, then Cancel: the session stays exactly as stored.
    await endRide.click();
    const confirmation = page.getByRole("dialog", { name: copy.endConfirmTitle });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: copy.cancel }).click();
    await expect(confirmation).toHaveCount(0);
    expect(await readActiveRideStateRow(page)).toEqual(row);

    // End ride, confirmed: the session is cleared, the route stays.
    await endRide.click();
    await page
      .getByRole("dialog", { name: copy.endConfirmTitle })
      .getByRole("button", { name: copy.endRide, exact: true })
      .click();
    await expect(page.getByRole("button", { name: copy.chooseRoute })).toBeVisible();
    await expect.poll(() => readActiveRideStateRow(page)).toBeNull();
    expect(await readSavedRouteId(page, ROUTE_NAME)).toBe(routeId);
    await expectWatchesToStay(page, 0);
  });
}

test("(en) Resume, Pause, Routes and back, a second Resume and a second Pause each start or stop exactly one watch and keep the same session", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const consoleErrors = collectConsoleErrors(page);
  await installLocalMapStyle(page);
  await installGeolocationCounters(page);
  const { routeId, row } = await establishUnfinishedRide(page, context);
  await reloadInto(page, "en");

  await rideTab(page, "en").click();
  await expectFullPausedScreen(page, "en");
  await expectWatchesToStay(page, 0);

  const resume = page.getByRole("button", { name: "Resume ride" });
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  await resume.click();
  await expect(pause).toBeVisible();
  await expect.poll(() => watches(page)).toBe(1);

  await pause.click();
  await expect.poll(() => clears(page)).toBe(1);
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Routes" })).toBeVisible();
  await rideTab(page, "en").click();
  await expect(resume.or(pause)).toBeVisible();
  await expectWatchesToStay(page, 1);
  await expect(resume).toBeVisible();
  await expect(pause).toHaveCount(0);

  await resume.click();
  await expect(pause).toBeVisible();
  await expect.poll(() => watches(page)).toBe(2);
  await pause.click();
  await expect(resume).toBeVisible();
  await expect.poll(() => clears(page)).toBe(2);
  await expectWatchesToStay(page, 2);
  await expect
    .poll(() => readActiveRideStateRow(page))
    .toMatchObject({ kind: "route", routeId, startedAt: row.startedAt });
  expect(consoleErrors).toEqual([]);
});

test("(en) Back to Ride options shows the launcher's summary and never returns to the paused screen by itself, and its Resume ride still starts one watch", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await installLocalMapStyle(page);
  await installGeolocationCounters(page);
  await establishUnfinishedRide(page, context);
  await reloadInto(page, "en");

  await rideTab(page, "en").click();
  await expectFullPausedScreen(page, "en");
  await page.getByRole("button", { name: "Back to Ride options" }).click();

  const summary = page.getByText("You have an unfinished ride on this route.");
  for (let sample = 0; sample < 10; sample += 1) {
    await expect(summary).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit copy" })).toHaveCount(0);
    await page.waitForTimeout(150);
  }
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Routes" })).toBeVisible();
  await rideTab(page, "en").click();
  await expect(summary).toBeVisible();
  await page.waitForTimeout(500);
  await expect(summary).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit copy" })).toHaveCount(0);
  expect(await watches(page)).toBe(0);

  // The launcher's own one-tap Resume ride (items 72 and 131) still works.
  await page.getByRole("button", { name: "Resume ride" }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect.poll(() => watches(page)).toBe(1);
});

test("(en) a stored ride whose route was deleted, or of an unsupported kind, keeps the launcher's Discard, with no route screen", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await installLocalMapStyle(page);
  await installGeolocationCounters(page);
  const { row } = await establishUnfinishedRide(page, context);

  await writeActiveRideStateRow(page, { ...row, routeId: "route-no-longer-in-library" });
  await reloadInto(page, "en");
  await rideTab(page, "en").click();
  await expect(page.getByText(/no longer in your library/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Discard unfinished ride" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Ride options" })).toHaveCount(0);

  await writeActiveRideStateRow(page, { ...row, kind: "training-session" });
  await reloadInto(page, "en");
  await rideTab(page, "en").click();
  await expect(
    page.getByText("This unfinished ride can't be recovered by this version of the app."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Discard unfinished ride" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Ride options" })).toHaveCount(0);
  await expectWatchesToStay(page, 0);
});

test("(en) Edit copy on the cold-start paused screen opens Planning with the route's copy", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await installLocalMapStyle(page);
  await installGeolocationCounters(page);
  await establishUnfinishedRide(page, context);
  await reloadInto(page, "en");

  await rideTab(page, "en").click();
  await expectFullPausedScreen(page, "en");
  await page.getByRole("button", { name: "Edit copy" }).click();

  await expect(page.getByRole("heading", { name: "Plan a route" })).toBeVisible();
  // Item 141's compact notice: the forward indicator, collapsed, with the
  // copy's explanation in its announcement (either provenance).
  const indicator = page.getByRole("button", { name: "Editing a copy", exact: true });
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveAttribute("aria-expanded", "false");
  await expect(editCopyAnnouncement(page)).toHaveText(
    /^Editable (copy created from the route's original planning waypoints|waypoints were estimated from this route)\./,
  );
  expect(await watches(page)).toBe(0);
});
