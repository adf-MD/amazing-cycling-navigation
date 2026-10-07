import { expect, test, type Locator, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow, readSavedRouteId } from "./support/rideStateDb.ts";
import {
  expectEditCopyNotice,
  expectNoEditCopyNotice,
} from "./support/editCopyNotice.ts";

// Backlog item 124's inventory case D-06 (Edit copy), in both engines (this
// file runs under the "chromium" and "webkit-smoke" projects), at 390x844
// portrait, in English and German where copy or layout matters.
//
// - While a confirmed replacement is written, the confirmation's actions are
//   disabled with a working label, focus waits on its own title, and Cancel
//   and Escape are refused.
// - Completion navigates to Planning only while the rider is still in the
//   Ride context they started from; leaving Ride, or leaving and returning,
//   keeps them where they are.
// - A failure returns focus to the re-enabled Edit copy, revealing it and its
//   message by the minimum, only while the rider has stayed in the
//   interaction — including input during the direct path's preliminary
//   draft check.
// - A Planning screen opened while the replacement is being made never shows
//   a draft older than the confirmed replacement, so its autosave cannot
//   write that older draft back over the copy.
//
// Pending and failing writes are controlled in the page, by test-only
// fixtures installed before the app's scripts run:
// - a hold: the test's own readwrite transaction on one object store, kept
//   alive by chained reads, so the app's request on that store queues behind
//   it. Bounded by a deadline, and always released (afterEach). A held store
//   is never read by the test: stored rows are read only after release;
// - a wrapper around IDBObjectStore.prototype.put that counts the app's
//   Planning-draft writes and keeps their transactions, so a release can
//   abort a queued write — a failure that arrives after the rider has done
//   something else;
// - an immediate fault: that put throws.
// These are synthetic. They show what the interface does once a write is
// pending or fails, not that such failures happen on a device.
//
// Input is real: pointer clicks at measured centres, key presses and wheel
// input. The app's own scrollBy/scrollTo/scrollIntoView calls are recorded,
// so "the page was left where the rider put it" is asserted as "the app made
// no scroll call", never as a raw scrollY, which a collapsing confirmation
// and scroll anchoring can move by themselves. Focus moves made by script
// are recorded too, but only those that actually moved focus.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const GAP = 8;
const HOLD_DEADLINE_MS = 30_000;
// Planning autosaves 900 ms after its draft is applied, and after each edit.
const AUTOSAVE_SETTLE_MS = 2_000;

const ROUTE_NAME = "edit-copy-busy-route";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const ROUTE_SEGMENTS = 50;
const ROUTE_LENGTH_DEGREES_LON = 0.0144303623099218; // 1 km at this latitude

const OLD_DRAFT_NAME = "Unsaved plan";
const OLD_DRAFT = {
  id: "draft",
  waypoints: [
    { id: "wp-a", coordinate: [-0.1, 51.5] },
    { id: "wp-b", coordinate: [-0.09, 51.51] },
  ],
  routeName: OLD_DRAFT_NAME,
  avoidFerries: true,
  profile: "cycling-road",
  updatedAt: "2026-10-02T08:00:00.000Z",
};

const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];

const COPY = {
  en: {
    editCopy: "Edit copy",
    working: "Creating editable copy…",
    confirmTitle: "Replace your current draft?",
    confirmLabel: "Replace and edit",
    cancel: "Cancel",
    failed: "The editable copy could not be created on this device. Try again.",
    routes: "Routes",
    ride: "Ride",
    plan: "Plan",
  },
  de: {
    editCopy: "Kopie bearbeiten",
    working: "Kopie zum Bearbeiten wird erstellt…",
    confirmTitle: "Aktuellen Entwurf ersetzen?",
    confirmLabel: "Ersetzen und bearbeiten",
    cancel: "Abbrechen",
    failed:
      "Es konnte auf diesem Gerät keine Kopie zum Bearbeiten erstellt werden. Versuche es erneut.",
    routes: "Routen",
    ride: "Fahren",
    plan: "Planen",
  },
} as const;

type HeldStore = "planningDrafts" | "planningPreferences";

/** The in-page fixture state; see installFixtures. */
interface AcnFixture {
  writes: number;
  txs: IDBTransaction[];
  faultPut: boolean;
  hold: { stop: boolean; finished: string | null } | null;
  scrolls: string[];
  focusCalls: Element[];
}
type FixtureWindow = Window & { __acn: AcnFixture; __acnAnchor?: Element | null };

function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const lon = ROUTE_START_LON + (ROUTE_LENGTH_DEGREES_LON / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lon)}"><ele>10.0</ele></trkpt>`;
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

/** Installed before any of the app's scripts run, so every write the app
 * makes passes through the wrapper. */
async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixture: AcnFixture = {
      writes: 0,
      txs: [],
      faultPut: false,
      hold: null,
      scrolls: [],
      focusCalls: [],
    };
    (window as unknown as FixtureWindow).__acn = fixture;

    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const tx = this.transaction as IDBTransaction & { __acnHold?: boolean };
      if (this.name === "planningDrafts" && tx.__acnHold !== true) {
        fixture.writes += 1;
        fixture.txs.push(tx);
        if (fixture.faultPut) throw new DOMException("synthetic fault", "UnknownError");
      }
      return put.apply(this, args);
    };

    // The caller's own arguments are forwarded unchanged: scrollBy(options)
    // and scrollBy(x, y) are different overloads.
    const scrollBy = window.scrollBy.bind(window) as (...args: unknown[]) => void;
    window.scrollBy = (...args: unknown[]) => {
      fixture.scrolls.push(`scrollBy ${JSON.stringify(args)}`);
      scrollBy(...args);
    };
    const scrollTo = window.scrollTo.bind(window) as (...args: unknown[]) => void;
    window.scrollTo = (...args: unknown[]) => {
      fixture.scrolls.push(`scrollTo ${JSON.stringify(args)}`);
      scrollTo(...args);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: Element,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      fixture.scrolls.push(`scrollIntoView ${this.tagName}`);
      scrollIntoView.call(this, arg);
    };
    // Only calls that actually leave focus on their target are recorded: a
    // call on a disabled button does nothing — React's own commit makes one
    // when a focused button it disables is blurred (its selection restore)
    // — and counting it would credit a focus move that never happened.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      focus.call(this, options);
      if (document.activeElement === this) fixture.focusCalls.push(this);
    };
  });
}

async function writeRow(page: Page, store: string, row: object): Promise<void> {
  await page.evaluate(
    ({ dbName, store, row }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(row);
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
      }),
    { dbName: DB_NAME, store, row },
  );
}

/** Starts the test's own readwrite transaction on `store` and resolves once
 * it is running, so any later request the app makes on that store queues
 * behind it. Ends by itself at the deadline. */
async function startHold(page: Page, store: HeldStore): Promise<void> {
  await page.evaluate(
    ({ dbName, store, deadlineMs }) =>
      new Promise<void>((resolve, reject) => {
        const fixture = (window as unknown as FixtureWindow).__acn;
        const request = indexedDB.open(dbName);
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "hold: open failed"));
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, "readwrite") as IDBTransaction & {
            __acnHold?: boolean;
          };
          tx.__acnHold = true;
          const hold = { stop: false, finished: null as string | null };
          fixture.hold = hold;
          const objectStore = tx.objectStore(store);
          const deadline = performance.now() + deadlineMs;
          let started = false;
          const loop = () => {
            const get = objectStore.get("acn-e2e-hold");
            get.onsuccess = () => {
              if (!started) {
                started = true;
                resolve();
              }
              if (!hold.stop && performance.now() < deadline) loop();
            };
          };
          loop();
          tx.oncomplete = () => {
            hold.finished = "complete";
            db.close();
          };
          tx.onabort = () => {
            hold.finished = "abort";
            db.close();
          };
        };
      }),
    { dbName: DB_NAME, store, deadlineMs: HOLD_DEADLINE_MS },
  );
}

/** Ends the hold. With `failQueuedWrite`, the app's queued draft write is
 * aborted first, so it fails after whatever the rider did meanwhile. */
async function releaseHold(page: Page, failQueuedWrite: boolean): Promise<void> {
  await page.evaluate((fail) => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    if (!fixture.hold) throw new Error("no hold to release");
    if (fail) {
      for (const tx of fixture.txs) {
        try {
          tx.abort();
        } catch {
          // Already finished: only the queued write can still be aborted.
        }
      }
    }
    fixture.hold.stop = true;
  }, failQueuedWrite);
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__acn.hold?.finished != null,
    null,
    { timeout: 10_000 },
  );
}

const writes = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.writes);

async function setPutFault(page: Page, on: boolean): Promise<void> {
  await page.evaluate((on) => {
    (window as unknown as FixtureWindow).__acn.faultPut = on;
  }, on);
}

/** Clears the scroll and focus records, so later assertions see only what
 * happened after this point. */
async function resetRecords(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    fixture.scrolls = [];
    fixture.focusCalls = [];
  });
}

const appScrolls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.scrolls);

/** Whether script moved focus to the button labelled `label` since the last
 * reset. */
async function scriptFocusedButton(page: Page, label: string): Promise<boolean> {
  return page.evaluate(
    (label) =>
      (window as unknown as FixtureWindow).__acn.focusCalls.some(
        (element) => element.tagName === "BUTTON" && element.textContent.trim() === label,
      ),
    label,
  );
}

async function seedLanguagePreference(page: Page, language: Language): Promise<void> {
  await writeRow(page, "appPreferences", { id: "app", language });
}

async function setRootText(page: Page, size: string): Promise<void> {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = size;
  }, size);
  await settle(page);
}

/** Waits for scrollY to hold still over timer-driven samples (never
 * animation frames: headless WebKit can defer them). */
async function settle(page: Page, quietMs = 300): Promise<void> {
  await page.evaluate(
    (quietMs) =>
      new Promise<void>((resolve) => {
        let last = scrollY;
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          if (scrollY !== last) {
            last = scrollY;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > 5_000) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        setTimeout(tick, 25);
      }),
    quietMs,
  );
}

interface Band {
  top: number;
  bottom: number;
}

/** The usable band: below the sticky navigation, above the viewport's
 * bottom, with the same 8 px margins the reveal itself keeps. */
function band(page: Page): Promise<Band> {
  return page.evaluate((gap) => {
    const header = document.querySelector("header.app-header--sticky");
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    return { top: headerBottom + gap, bottom: innerHeight - gap };
  }, GAP);
}

async function box(locator: Locator): Promise<{ top: number; bottom: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element is not laid out");
  return { top: b.y, bottom: b.y + b.height };
}

/** A real mouse click at the element's centre, after proving that point
 * lies inside the viewport and hits the element itself (or something inside
 * it) — never through Playwright's own scroll-into-view. */
async function pointerClick(page: Page, locator: Locator): Promise<void> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("pointerClick: element is not laid out");
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  expect(y, "the click point is inside the viewport").toBeGreaterThan(0);
  expect(y, "the click point is inside the viewport").toBeLessThan(844);
  const hits = await locator.evaluate(
    (element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit !== null && (hit === element || element.contains(hit));
    },
    { x, y },
  );
  expect(hits, "the click point hits the intended element").toBe(true);
  await page.mouse.click(x, y);
}

/** Wheel input over ordinary page content, never the map or the header. */
async function wheelBy(page: Page, dy: number): Promise<void> {
  const point = await page.evaluate(() => {
    for (let y = innerHeight - 30; y > 100; y -= 20) {
      const hit = document.elementFromPoint(6, y);
      if (hit && !hit.closest(".maplibregl-map, [data-testid='map-container'], header")) {
        return { x: 6, y };
      }
    }
    throw new Error("no wheel point outside the map");
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, dy);
  await settle(page);
}

/** Proves the rider's scroll took Edit copy above the usable band, so a
 * failure that still returned focus there would have had to scroll back. */
async function expectAboveBand(page: Page, locator: Locator): Promise<void> {
  const b = await band(page);
  const target = await box(locator);
  expect(target.bottom, `scrolled out of the band (${JSON.stringify(b)})`).toBeLessThan(
    b.top,
  );
}

const editCopyButton = (page: Page, language: Language): Locator =>
  page.getByRole("button", { name: COPY[language].editCopy, exact: true });
const confirmation = (page: Page, language: Language): Locator =>
  page.getByRole("dialog", { name: COPY[language].confirmTitle });
const editCopyAlert = (page: Page, language: Language): Locator =>
  page.getByRole("alert").filter({ hasText: COPY[language].failed });
const navButton = (page: Page, label: string): Locator =>
  page.getByRole("navigation").getByRole("button", { name: label, exact: true });

async function currentDestination(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.querySelector('nav [aria-current="page"]')?.textContent.trim() ?? null,
  );
}

/** Samples a condition repeatedly over a window, so "nothing happened" is
 * not concluded from a single early look. */
async function expectToHold(
  description: string,
  check: () => Promise<boolean>,
  windowMs = 1_500,
): Promise<void> {
  const end = Date.now() + windowMs;
  while (Date.now() < end) {
    expect(await check(), description).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function activeElementSummary(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return "body";
    return `${active.tagName.toLowerCase()}:${active.textContent.trim().slice(0, 60)}`;
  });
}

/** Remembers the focused element so a later check can prove it is still the
 * very same node. */
async function rememberFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).__acnAnchor = document.activeElement;
  });
}
const focusUnchanged = (page: Page): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement === (window as unknown as FixtureWindow).__acnAnchor,
  );

/** Imports the route, optionally stores a meaningful Planning draft, applies
 * the language and opens the route's pre-ride screen from Routes. Returns
 * the route's id. */
async function openPreRide(
  page: Page,
  language: Language,
  { withDraft }: { withDraft: boolean },
): Promise<string> {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  await installLocalMapStyle(page);
  await installFixtures(page);
  await page.context().grantPermissions(["geolocation"]);
  await page
    .context()
    .setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${ROUTE_NAME}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });
  await expect(page.getByRole("button", { name: ROUTE_NAME, exact: true })).toBeVisible();
  const routeId = await readSavedRouteId(page, ROUTE_NAME);
  if (!routeId) throw new Error("expected the imported route's id");
  if (withDraft) await writeRow(page, "planningDrafts", OLD_DRAFT);
  if (language !== "en") await seedLanguagePreference(page, language);
  await page.reload();
  await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
  await expect(editCopyButton(page, language)).toBeEnabled();
  await settle(page);
  expect(consoleErrors).toEqual([]);
  return routeId;
}

/** Opens the replacement confirmation with a real click on Edit copy. */
async function openConfirmation(page: Page, language: Language): Promise<Locator> {
  await pointerClick(page, editCopyButton(page, language));
  const dialog = confirmation(page, language);
  await expect(dialog).toBeVisible();
  await settle(page);
  return dialog;
}

async function pressReplaceAndEdit(page: Page, language: Language, dialog: Locator) {
  await pointerClick(
    page,
    dialog.getByRole("button", { name: COPY[language].confirmLabel, exact: true }),
  );
}

interface DraftSummary {
  routeName: unknown;
  waypoints: number | null;
  editCopySourceRouteId: unknown;
}
async function storedDraft(page: Page): Promise<DraftSummary | null> {
  const row = await readPlanningDraftRow(page);
  if (!row) return null;
  return {
    routeName: row.routeName,
    waypoints: Array.isArray(row.waypoints) ? row.waypoints.length : null,
    editCopySourceRouteId: row.editCopySourceRouteId ?? null,
  };
}

/** Whether some text field currently holds `value` (Planning's route-name
 * field), read from the live property rather than the attribute. */
const hasFieldValue = (page: Page, value: string): Promise<boolean> =>
  page.evaluate(
    (value) =>
      [...document.querySelectorAll("input")].some((input) => input.value === value),
    value,
  );

async function expectPlanningShowsCopy(page: Page, language: Language): Promise<void> {
  await expect.poll(() => currentDestination(page)).toBe(COPY[language].plan);
  await expectEditCopyNotice(page, "estimated", language);
  await expect.poll(() => hasFieldValue(page, ROUTE_NAME)).toBe(true);
}

test.afterEach(async ({ page }) => {
  await page
    .evaluate(() => {
      const hold = (window as unknown as { __acn?: AcnFixture }).__acn?.hold;
      if (hold) hold.stop = true;
    })
    .catch(() => undefined);
});

// ---------------------------------------------------------------- pending

for (const language of LANGUAGES) {
  test(`(${language}) while the confirmed replacement is written, both actions are disabled with the working label, focus waits on the title, Cancel and Escape are refused, and it writes once`, async ({
    page,
  }) => {
    const routeId = await openPreRide(page, language, { withDraft: true });
    const dialog = await openConfirmation(page, language);
    await startHold(page, "planningDrafts");
    await pressReplaceAndEdit(page, language, dialog);

    const working = dialog.getByRole("button", {
      name: COPY[language].working,
      exact: true,
    });
    const cancel = dialog.getByRole("button", {
      name: COPY[language].cancel,
      exact: true,
    });
    await expect(working).toBeDisabled();
    await expect(cancel).toBeDisabled();
    expect(await activeElementSummary(page)).toBe(`h2:${COPY[language].confirmTitle}`);
    await expect.poll(() => writes(page)).toBe(1);

    await page.keyboard.press("Escape");
    await pointerClick(page, cancel);
    await pointerClick(page, working);
    await expectToHold("the confirmation stays open, refusing Cancel and Escape", () =>
      dialog.isVisible(),
    );
    expect(await writes(page), "still exactly one write").toBe(1);

    await releaseHold(page, false);
    await expectPlanningShowsCopy(page, language);
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    expect(await storedDraft(page)).toMatchObject({
      routeName: ROUTE_NAME,
      editCopySourceRouteId: routeId,
    });
  });
}

// ------------------------------------------------------------- navigation

for (const language of LANGUAGES) {
  test(`(${language}) a replacement completing after the rider left for Routes keeps them on Routes with their focus, and Plan then shows the copy`, async ({
    page,
  }) => {
    const routeId = await openPreRide(page, language, { withDraft: true });
    const dialog = await openConfirmation(page, language);
    await startHold(page, "planningDrafts");
    await pressReplaceAndEdit(page, language, dialog);
    await pointerClick(page, navButton(page, COPY[language].routes));
    await expect.poll(() => currentDestination(page)).toBe(COPY[language].routes);
    await settle(page);
    await rememberFocus(page);
    await resetRecords(page);

    await releaseHold(page, false);
    await expectToHold("Routes stays the current screen", async () => {
      return (await currentDestination(page)) === COPY[language].routes;
    });
    expect(await focusUnchanged(page), "focus stays where the rider left it").toBe(true);
    expect(await appScrolls(page), "the app made no scroll call").toEqual([]);
    expect(await storedDraft(page)).toMatchObject({
      routeName: ROUTE_NAME,
      editCopySourceRouteId: routeId,
    });

    await pointerClick(page, navButton(page, COPY[language].plan));
    await expectPlanningShowsCopy(page, language);
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    expect(await storedDraft(page)).toMatchObject({
      routeName: ROUTE_NAME,
      editCopySourceRouteId: routeId,
    });
  });
}

test("(en) leaving Ride and returning before the replacement completes keeps the rider on Ride", async ({
  page,
}) => {
  const language = "en";
  const routeId = await openPreRide(page, language, { withDraft: true });
  const dialog = await openConfirmation(page, language);
  await startHold(page, "planningDrafts");
  await pressReplaceAndEdit(page, language, dialog);
  await pointerClick(page, navButton(page, COPY[language].routes));
  await expect.poll(() => currentDestination(page)).toBe(COPY[language].routes);
  await pointerClick(page, navButton(page, COPY[language].ride));
  await expect(editCopyButton(page, language)).toBeVisible();
  await settle(page);
  await rememberFocus(page);
  await resetRecords(page);

  await releaseHold(page, false);
  await expectToHold("Ride stays the current screen", async () => {
    return (await currentDestination(page)) === COPY[language].ride;
  });
  await expect(editCopyButton(page, language)).toBeVisible();
  expect(await focusUnchanged(page), "focus stays where the rider left it").toBe(true);
  expect(await appScrolls(page), "the app made no scroll call").toEqual([]);
  expect(await storedDraft(page)).toMatchObject({
    routeName: ROUTE_NAME,
    editCopySourceRouteId: routeId,
  });
});

// Backlog item 125: Planning's remembered scroll position belongs to the
// draft Edit copy replaces, but a copy completing after the rider has moved
// on must leave the screen they are using alone — it only stops that old
// position being restored later.
test("(en) a replacement completing after the rider moved on to Plan and scrolled it makes no scroll call, and Plan's next arrival starts at the top (backlog item 125)", async ({
  page,
}) => {
  const language = "en";
  const routeId = await openPreRide(page, language, { withDraft: true });
  await pointerClick(page, navButton(page, COPY[language].plan));
  await expect.poll(() => currentDestination(page)).toBe(COPY[language].plan);
  await settle(page);
  await wheelBy(page, 400);
  expect(
    await page.evaluate(() => scrollY),
    "Planning has a position to remember",
  ).toBeGreaterThan(100);
  await pointerClick(page, navButton(page, COPY[language].ride));
  await expect(editCopyButton(page, language)).toBeVisible();
  await settle(page);

  const dialog = await openConfirmation(page, language);
  await startHold(page, "planningDrafts");
  await pressReplaceAndEdit(page, language, dialog);
  await pointerClick(page, navButton(page, COPY[language].plan));
  await expect.poll(() => currentDestination(page)).toBe(COPY[language].plan);
  await settle(page);
  await wheelBy(page, 200);
  await resetRecords(page);

  await releaseHold(page, false);
  await expect
    .poll(() => storedDraft(page))
    .toMatchObject({
      routeName: ROUTE_NAME,
      editCopySourceRouteId: routeId,
    });
  await expectToHold("Plan stays the current screen", async () => {
    return (await currentDestination(page)) === COPY[language].plan;
  });
  expect(await appScrolls(page), "the app made no scroll call").toEqual([]);

  await pointerClick(page, navButton(page, COPY[language].routes));
  await expect.poll(() => currentDestination(page)).toBe(COPY[language].routes);
  await settle(page);
  await pointerClick(page, navButton(page, COPY[language].plan));
  await expectPlanningShowsCopy(page, language);
  await settle(page);
  expect(await page.evaluate(() => scrollY), "the new draft starts at the top").toBe(0);
});

// ---------------------------------------------------------------- failure

for (const language of LANGUAGES) {
  test(`(${language}) a held replacement that fails returns focus to the re-enabled Edit copy, with its message in view`, async ({
    page,
  }) => {
    await openPreRide(page, language, { withDraft: true });
    const dialog = await openConfirmation(page, language);
    await startHold(page, "planningDrafts");
    await pressReplaceAndEdit(page, language, dialog);
    await expect.poll(() => writes(page)).toBe(1);
    await resetRecords(page);

    await releaseHold(page, true);
    await expect(editCopyAlert(page, language)).toBeVisible();
    await expect(dialog).toBeHidden();
    const editCopy = editCopyButton(page, language);
    await expect(editCopy).toBeEnabled();
    await expect
      .poll(() => activeElementSummary(page))
      .toBe(`button:${COPY[language].editCopy}`);
    const b = await band(page);
    const button = await box(editCopy);
    const message = await box(editCopyAlert(page, language));
    expect(button.top).toBeGreaterThanOrEqual(b.top - 1);
    expect(message.bottom).toBeLessThanOrEqual(b.bottom + 1);
    expect(
      (await appScrolls(page)).length,
      "at most one deliberate reveal",
    ).toBeLessThanOrEqual(1);
    expect(await currentDestination(page)).toBe(COPY[language].ride);
    expect(await storedDraft(page)).toMatchObject({
      routeName: OLD_DRAFT_NAME,
      editCopySourceRouteId: null,
    });
  });
}

test("(en) a held replacement that fails after the rider scrolled away keeps their position and does not take focus", async ({
  page,
}) => {
  const language = "en";
  await openPreRide(page, language, { withDraft: true });
  const dialog = await openConfirmation(page, language);
  await startHold(page, "planningDrafts");
  await pressReplaceAndEdit(page, language, dialog);
  await wheelBy(page, 400);
  // While busy, Edit copy and the confirmation's action both read the
  // working label; Edit copy comes first.
  await expectAboveBand(
    page,
    page.getByRole("button", { name: COPY[language].working, exact: true }).first(),
  );
  // Start riding sits above Edit copy and keeps its label throughout.
  const anchor = page.getByRole("button", { name: "Start riding", exact: true });
  const anchorBefore = await anchor.boundingBox();
  await resetRecords(page);

  await releaseHold(page, true);
  await expect(editCopyAlert(page, language)).toBeAttached();
  await expect(editCopyButton(page, language)).toBeEnabled();
  await settle(page);
  expect(await appScrolls(page), "the app made no scroll call").toEqual([]);
  expect(await scriptFocusedButton(page, COPY[language].editCopy), "no focus taken").toBe(
    false,
  );
  expect(await activeElementSummary(page)).not.toBe(`button:${COPY[language].editCopy}`);
  // Start riding sits above the collapsing confirmation, so only the
  // browser's own clamping could move it; with this much page below, none
  // happens.
  const anchorAfter = await anchor.boundingBox();
  expect(anchorAfter?.y).toBeCloseTo(anchorBefore?.y ?? Number.NaN, 0);
});

test("(en) a held replacement that fails after the rider moved focus on keeps that focus", async ({
  page,
}) => {
  const language = "en";
  await openPreRide(page, language, { withDraft: true });
  const dialog = await openConfirmation(page, language);
  await startHold(page, "planningDrafts");
  await pressReplaceAndEdit(page, language, dialog);
  await page.keyboard.press("Tab");
  const moved = await activeElementSummary(page);
  expect(moved).not.toBe("body");
  expect(moved).not.toBe(`h2:${COPY[language].confirmTitle}`);
  await rememberFocus(page);
  await resetRecords(page);

  await releaseHold(page, true);
  await expect(editCopyAlert(page, language)).toBeAttached();
  await expect(editCopyButton(page, language)).toBeEnabled();
  await settle(page);
  expect(await focusUnchanged(page), "focus stays where the rider moved it").toBe(true);
  expect(await appScrolls(page), "the app made no scroll call").toEqual([]);
  expect(await scriptFocusedButton(page, COPY[language].editCopy), "no focus taken").toBe(
    false,
  );
});

// ------------------------------------- the direct path's preliminary check

test("(en) with no draft, repeated clicks and a scroll during the preliminary check give one write, and its failure takes neither focus nor position", async ({
  page,
}) => {
  const language = "en";
  await openPreRide(page, language, { withDraft: false });
  await setPutFault(page, true);
  await startHold(page, "planningDrafts");
  const editCopy = editCopyButton(page, language);
  await pointerClick(page, editCopy);
  await pointerClick(page, editCopy);
  await pointerClick(page, editCopy);
  await wheelBy(page, 400);
  await expectAboveBand(page, editCopy);
  await resetRecords(page);

  await releaseHold(page, false);
  await expect(editCopyAlert(page, language)).toBeAttached();
  await expect(editCopy).toBeEnabled();
  await settle(page);
  expect(await writes(page), "exactly one write").toBe(1);
  expect(await appScrolls(page), "the app made no scroll call").toEqual([]);
  expect(await scriptFocusedButton(page, COPY[language].editCopy), "no focus taken").toBe(
    false,
  );
  expect(await currentDestination(page)).toBe(COPY[language].ride);
});

test("(en) with no draft and no other input, a failed write returns focus to Edit copy once it is enabled", async ({
  page,
}) => {
  const language = "en";
  await openPreRide(page, language, { withDraft: false });
  await setPutFault(page, true);
  await startHold(page, "planningDrafts");
  await pointerClick(page, editCopyButton(page, language));
  await resetRecords(page);

  await releaseHold(page, false);
  await expect(editCopyAlert(page, language)).toBeVisible();
  await expect(editCopyButton(page, language)).toBeEnabled();
  await expect
    .poll(() => activeElementSummary(page))
    .toBe(`button:${COPY[language].editCopy}`);
  expect(await scriptFocusedButton(page, COPY[language].editCopy)).toBe(true);
  expect(await writes(page)).toBe(1);
});

for (const store of ["planningDrafts", "planningPreferences"] as const) {
  test(`(en) with no draft, leaving Ride while the preliminary check waits on ${store} writes nothing and stays on Routes`, async ({
    page,
  }) => {
    const language = "en";
    await openPreRide(page, language, { withDraft: false });
    await startHold(page, store);
    await pointerClick(page, editCopyButton(page, language));
    await pointerClick(page, navButton(page, COPY[language].routes));
    await expect.poll(() => currentDestination(page)).toBe(COPY[language].routes);

    await releaseHold(page, false);
    await expectToHold("Routes stays the current screen", async () => {
      return (await currentDestination(page)) === COPY[language].routes;
    });
    expect(await writes(page), "no write").toBe(0);
    expect(await storedDraft(page)).toBeNull();
  });
}

// ----------------------------------------------------------- 200% text

for (const language of LANGUAGES) {
  test(`(${language}, 200% text) with no draft, an immediate failure reveals Edit copy and its message by the minimum`, async ({
    page,
  }) => {
    await openPreRide(page, language, { withDraft: false });
    await setRootText(page, "200%");
    await setPutFault(page, true);
    await resetRecords(page);

    await pointerClick(page, editCopyButton(page, language));
    await expect(editCopyAlert(page, language)).toBeAttached();
    await expect(editCopyButton(page, language)).toBeEnabled();
    await expect
      .poll(() => activeElementSummary(page))
      .toBe(`button:${COPY[language].editCopy}`);
    await settle(page);
    const b = await band(page);
    const button = await box(editCopyButton(page, language));
    const message = await box(editCopyAlert(page, language));
    const scrolls = await appScrolls(page);
    expect(scrolls.length, `app scrolls: ${scrolls.join(" | ")}`).toBeLessThanOrEqual(1);
    expect(button.top, "Edit copy below the navigation").toBeGreaterThanOrEqual(
      b.top - 1,
    );
    expect(message.bottom, "its message above the bottom").toBeLessThanOrEqual(
      b.bottom + 1,
    );
    if (scrolls.length === 1) {
      // Minimal: the group's bottom lands on the band's bottom, or its top
      // on the band's top — never further.
      const atBottom = Math.abs(message.bottom - b.bottom) <= 1;
      const atTop = Math.abs(button.top - b.top) <= 1;
      expect(atBottom || atTop, `minimal reveal (band ${JSON.stringify(b)})`).toBe(true);
    }
  });

  test(`(${language}, 200% text) the working label is contained within its action`, async ({
    page,
  }) => {
    await openPreRide(page, language, { withDraft: true });
    await setRootText(page, "200%");
    const dialog = await openConfirmation(page, language);
    await startHold(page, "planningDrafts");
    await pressReplaceAndEdit(page, language, dialog);
    const working = dialog.getByRole("button", {
      name: COPY[language].working,
      exact: true,
    });
    await expect(working).toBeDisabled();

    const fit = await working.evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect();
      const own = button.getBoundingClientRect();
      const dialogBox = button.closest('[role="dialog"]')?.getBoundingClientRect();
      return {
        textInside:
          text.left >= own.left - 0.5 &&
          text.right <= own.right + 0.5 &&
          text.top >= own.top - 0.5 &&
          text.bottom <= own.bottom + 0.5,
        buttonInside:
          !!dialogBox &&
          own.left >= dialogBox.left - 0.5 &&
          own.right <= dialogBox.right + 0.5,
        noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(fit).toEqual({ textInside: true, buttonInside: true, noPageOverflow: true });
    await releaseHold(page, false);
  });
}

// --------------------------------- Planning opened while the copy is made

for (const language of LANGUAGES) {
  test(`(${language}) Plan opened while the preferences read was held after confirming shows the copy, and autosave keeps it`, async ({
    page,
  }) => {
    const routeId = await openPreRide(page, language, { withDraft: true });
    const dialog = await openConfirmation(page, language);
    await startHold(page, "planningPreferences");
    await pressReplaceAndEdit(page, language, dialog);
    await pointerClick(page, navButton(page, COPY[language].plan));
    await expect.poll(() => currentDestination(page)).toBe(COPY[language].plan);
    // Released before Planning's first autosave.
    await releaseHold(page, false);
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

    expect(await storedDraft(page), "the stored draft after autosave").toMatchObject({
      routeName: ROUTE_NAME,
      editCopySourceRouteId: routeId,
    });
    await expectPlanningShowsCopy(page, language);
  });
}

test("(en) Plan opened while the preferences read was held after confirming, released only after autosave, shows the copy that is stored", async ({
  page,
}) => {
  const language = "en";
  const routeId = await openPreRide(page, language, { withDraft: true });
  const dialog = await openConfirmation(page, language);
  await startHold(page, "planningPreferences");
  await pressReplaceAndEdit(page, language, dialog);
  await pointerClick(page, navButton(page, COPY[language].plan));
  await expect.poll(() => currentDestination(page)).toBe(COPY[language].plan);
  await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
  await releaseHold(page, false);
  await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

  expect(await storedDraft(page), "the stored draft").toMatchObject({
    routeName: ROUTE_NAME,
    editCopySourceRouteId: routeId,
  });
  await expectPlanningShowsCopy(page, language);
});

test("(en) an edit in Plan after the copy appears is stored on top of the copy", async ({
  page,
}) => {
  const language = "en";
  const routeId = await openPreRide(page, language, { withDraft: true });
  const dialog = await openConfirmation(page, language);
  await startHold(page, "planningPreferences");
  await pressReplaceAndEdit(page, language, dialog);
  await pointerClick(page, navButton(page, COPY[language].plan));
  await expect.poll(() => currentDestination(page)).toBe(COPY[language].plan);
  await releaseHold(page, false);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(async () => (await storedDraft(page))?.editCopySourceRouteId)
    .toBe(routeId);
  const copyWaypoints = (await storedDraft(page))?.waypoints ?? Number.NaN;

  await page
    .locator('[data-testid="map-container"]')
    .click({ position: { x: 120, y: 130 } });
  await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

  expect(await storedDraft(page), "the stored draft after the edit").toMatchObject({
    routeName: ROUTE_NAME,
    editCopySourceRouteId: routeId,
    waypoints: copyWaypoints + 1,
  });
});

for (const fail of [false, true]) {
  test(`(en) Plan opened while the confirmed write itself is held shows ${fail ? "the earlier draft when it fails" : "the copy when it lands"}`, async ({
    page,
  }) => {
    const language = "en";
    const routeId = await openPreRide(page, language, { withDraft: true });
    const dialog = await openConfirmation(page, language);
    await startHold(page, "planningDrafts");
    await pressReplaceAndEdit(page, language, dialog);
    await expect.poll(() => writes(page)).toBe(1);
    await pointerClick(page, navButton(page, COPY[language].plan));
    await expect.poll(() => currentDestination(page)).toBe(COPY[language].plan);

    await releaseHold(page, fail);
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    if (fail) {
      await expect.poll(() => hasFieldValue(page, OLD_DRAFT_NAME)).toBe(true);
      await expectNoEditCopyNotice(page, language);
      expect(await storedDraft(page)).toMatchObject({
        routeName: OLD_DRAFT_NAME,
        editCopySourceRouteId: null,
      });
    } else {
      await expectPlanningShowsCopy(page, language);
      expect(await storedDraft(page)).toMatchObject({
        routeName: ROUTE_NAME,
        editCopySourceRouteId: routeId,
      });
    }
  });
}

// Characterises Planning's existing rule rather than D-06's: an edit made
// while Planning is still loading its draft takes precedence over that draft
// (item 30's hydration fix), so a copy still being written when the rider
// edits is superseded by the rider's own newer edit. Nothing the rider did is
// discarded. Reachable only while the write is held.
test("(en) an edit made while Plan is still loading behind the held write takes precedence, as Planning's existing rule says", async ({
  page,
}) => {
  const language = "en";
  await openPreRide(page, language, { withDraft: true });
  const dialog = await openConfirmation(page, language);
  await startHold(page, "planningDrafts");
  await pressReplaceAndEdit(page, language, dialog);
  await pointerClick(page, navButton(page, COPY[language].plan));
  await expect.poll(() => currentDestination(page)).toBe(COPY[language].plan);
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await page
    .locator('[data-testid="map-container"]')
    .click({ position: { x: 120, y: 130 } });

  await releaseHold(page, false);
  await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
  expect(await storedDraft(page), "the rider's own edit is what is stored").toMatchObject(
    {
      waypoints: 1,
      editCopySourceRouteId: null,
    },
  );
});
