import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Backlog item 134, in both engines (this file runs under the "chromium"
// and "webkit-smoke" projects): on the full paused-route screen, Resume
// ride is unavailable while a confirmed End ride is finishing, as Back to
// Ride options is.
//
// The End's conditional clear is held behind a real readwrite transaction
// on rideState, opened in the page and kept alive by chained reads, so the
// pending state is deterministic and the stored row read afterwards is
// what the clear really left. The disabled Resume ride is never clicked: a
// normal Playwright click would wait for it to become enabled, and a forced
// one would bypass exactly what is under test. Its disabled state, the
// watch count and the stored row are checked instead.
//
// The failure is synthetic: an init script aborts the transaction of the
// next delete issued on rideState at the moment it is issued — the clear's
// own, which deletes only after its read, so only once the hold is
// released — and records whether it really aborted and never completed.
//
// English only: no copy changes. No test in this file contacts a live map
// or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const ROUTE_NAME = "resume-during-end-route";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildStraightRouteGpx(): string {
  const points = Array.from({ length: 51 }, (_, index) => {
    const distanceMetres = 20 * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Resume during End test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

interface Probe {
  watches: number;
  clears: number;
  abortArmed: boolean;
  abortCaptured: boolean;
  aborted: boolean;
  completed: boolean;
  holdStarted: boolean;
  holdFinished: boolean;
  holdRelease: boolean;
}

/** Counts watchPosition/clearWatch calls and installs the armable
 * abort-at-issue interceptor, before the app's own scripts run. */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = {
      watches: 0,
      clears: 0,
      abortArmed: false,
      abortCaptured: false,
      aborted: false,
      completed: false,
      holdStarted: false,
      holdFinished: false,
      holdRelease: false,
    };
    (window as unknown as { __acnItem134Probe: typeof probe }).__acnItem134Probe = probe;
    const geolocation = navigator.geolocation;
    const watch = geolocation.watchPosition.bind(geolocation);
    const clear = geolocation.clearWatch.bind(geolocation);
    geolocation.watchPosition = (
      ...args: Parameters<typeof geolocation.watchPosition>
    ) => {
      probe.watches += 1;
      return watch(...args);
    };
    geolocation.clearWatch = (watchId: number) => {
      probe.clears += 1;
      clear(watchId);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange,
    ) {
      const request = originalDelete.call(this, query);
      if (this.name === "rideState" && probe.abortArmed && !probe.abortCaptured) {
        probe.abortCaptured = true;
        const transaction = this.transaction;
        transaction.addEventListener("abort", () => {
          probe.aborted = true;
        });
        transaction.addEventListener("complete", () => {
          probe.completed = true;
        });
        transaction.abort();
      }
      return request;
    };
  });
}

function readProbe(page: Page): Promise<Probe> {
  return page.evaluate(() => ({
    ...(window as unknown as { __acnItem134Probe: Probe }).__acnItem134Probe,
  }));
}

async function armClearAbort(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __acnItem134Probe: Probe }).__acnItem134Probe.abortArmed =
      true;
  });
}

/** Holds a readwrite transaction on rideState, kept alive by chained gets,
 * until released or 30 s pass; resolves once the hold is active. Nothing
 * may read rideState from the test while it is held. */
async function startHold(page: Page): Promise<void> {
  await page.evaluate(
    (dbName) =>
      new Promise<void>((resolve, reject) => {
        const probe = (window as unknown as { __acnItem134Probe: Probe })
          .__acnItem134Probe;
        probe.holdRelease = false;
        probe.holdStarted = false;
        probe.holdFinished = false;
        const request = indexedDB.open(dbName);
        request.onerror = () => {
          reject(new Error("the hold's connection could not be opened"));
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("rideState", "readwrite");
          const store = transaction.objectStore("rideState");
          transaction.oncomplete = () => {
            probe.holdFinished = true;
            database.close();
          };
          transaction.onabort = () => {
            probe.holdFinished = true;
            database.close();
          };
          const deadline = Date.now() + 30_000;
          const loop = () => {
            const get = store.get("acn-e2e-hold");
            get.onsuccess = () => {
              if (!probe.holdStarted) {
                probe.holdStarted = true;
                resolve();
              }
              if (!probe.holdRelease && Date.now() < deadline) loop();
            };
          };
          loop();
        };
      }),
    DB_NAME,
  );
}

async function releaseHold(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __acnItem134Probe: Probe }).__acnItem134Probe.holdRelease =
      true;
  });
  await expect.poll(async () => (await readProbe(page)).holdFinished).toBe(true);
}

/** Samples repeatedly, never stopping at the first success, that no watch
 * is added. */
async function expectWatchesToStay(page: Page, count: number): Promise<void> {
  for (let sample = 0; sample < 8; sample += 1) {
    expect((await readProbe(page)).watches, `watch count, sample ${String(sample)}`).toBe(
      count,
    );
    await page.waitForTimeout(150);
  }
}

/** Samples the stored row repeatedly after the hold has been released. */
async function expectStoredRowToStay(
  page: Page,
  expected: Record<string, unknown> | null,
): Promise<void> {
  for (let sample = 0; sample < 6; sample += 1) {
    expect(
      await readActiveRideStateRow(page),
      `stored row, sample ${String(sample)}`,
    ).toEqual(expected);
    await page.waitForTimeout(200);
  }
}

/** A real route ride with a fix, then Pause: the full paused-route screen,
 * with its session stored and no watch running. Returns the stored row. */
async function pausedRouteRide(
  page: Page,
  context: BrowserContext,
): Promise<Record<string, unknown>> {
  await installLocalMapStyle(page);
  await installProbe(page);
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
    .toMatchObject({ kind: "route", routeId, lastFix: expect.anything() });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeEnabled();
  await expect.poll(async () => (await readProbe(page)).clears).toBeGreaterThan(0);
  const row = await readActiveRideStateRow(page);
  if (!row) throw new Error("expected the paused ride's stored row");
  expect(typeof row.sessionId).toBe("string");
  return row;
}

/** Opens and confirms the paused panel's End ride; with the store held,
 * its clear waits behind the hold. */
async function confirmEndRide(page: Page): Promise<void> {
  await page.locator(".ride-end-ride-panel-row > button").click();
  const dialog = page.getByRole("dialog", { name: "End this ride?" });
  await dialog.getByRole("button", { name: "End ride" }).click();
  await expect(dialog.getByRole("button", { name: "Ending ride…" })).toBeDisabled();
}

test("Resume ride is unavailable while a confirmed End ride finishes, and the ended session stays cleared", async ({
  page,
  context,
}) => {
  await pausedRouteRide(page, context);
  const watchesBefore = (await readProbe(page)).watches;
  await startHold(page);
  try {
    await confirmEndRide(page);
    await expect(page.getByRole("button", { name: "Resume ride" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Back to Ride options" }),
    ).toBeDisabled();
    // A moving rider: no watch exists to receive it, and none is added.
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(500) });
    await expectWatchesToStay(page, watchesBefore);
  } finally {
    await releaseHold(page);
  }

  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expectStoredRowToStay(page, null);
  expect((await readProbe(page)).watches).toBe(watchesBefore);

  // Reopening: nothing comes back.
  await page.reload();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toHaveCount(0);
  await expectStoredRowToStay(page, null);
  expect((await readProbe(page)).watches).toBe(0);
});

test("after a failed End the ride stays paused with its session, Resume ride is offered again, and only the rider's Resume starts tracking", async ({
  page,
  context,
}) => {
  const paused = await pausedRouteRide(page, context);
  const watchesBefore = (await readProbe(page)).watches;
  await armClearAbort(page);
  await startHold(page);
  try {
    await confirmEndRide(page);
    await expect(page.getByRole("button", { name: "Resume ride" })).toBeDisabled();
  } finally {
    await releaseHold(page);
  }

  const error = page.getByText("The ride could not be ended on this device. Try again.");
  await expect(error).toBeVisible();
  // The fixture failed the clear's own transaction: caught as its delete
  // was issued, aborted, and never completed.
  const fixture = await readProbe(page);
  expect(fixture.abortCaptured).toBe(true);
  expect(fixture.aborted).toBe(true);
  expect(fixture.completed).toBe(false);

  await expect(page.locator(".ride-start-panel").getByRole("alert")).toContainText(
    "The ride could not be ended on this device. Try again.",
  );
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
  await expectStoredRowToStay(page, paused);
  const resume = page.getByRole("button", { name: "Resume ride" });
  await expect(resume).toBeEnabled();
  await expectWatchesToStay(page, watchesBefore);

  await resume.click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect.poll(async () => (await readProbe(page)).watches).toBe(watchesBefore + 1);
  await expectWatchesToStay(page, watchesBefore + 1);
  const pausedFix = paused.lastFix as { timestampMs: number };
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(560) });
  await expect
    .poll(async () => {
      const row = await readActiveRideStateRow(page);
      return (row?.lastFix as { timestampMs?: number } | undefined)?.timestampMs ?? 0;
    })
    .toBeGreaterThan(pausedFix.timestampMs);
  const continued = await readActiveRideStateRow(page);
  expect(continued?.sessionId).toBe(paused.sessionId);

  // Reopening: the session survives, paused, and starts no tracking.
  await page.reload();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeEnabled();
  expect((await readProbe(page)).watches).toBe(0);
});
