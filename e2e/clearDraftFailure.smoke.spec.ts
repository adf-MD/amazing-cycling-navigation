import { expect, test, type Locator, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Backlog item 124's inventory case D-01 — a failing Clear draft in
// Planning — in both engines (this file runs under the "chromium" and
// "webkit-smoke" projects), at 390x844 portrait, in English and German, at
// ordinary and 200% root text where layout matters.
//
// - While the rider is still waiting at Clear draft, a failure returns focus
//   to the re-enabled Clear draft without the browser's own focus scroll,
//   and reveals the button and its message by the minimum.
// - Once the rider has moved on — scrolled, tapped elsewhere, moved focus,
//   typed, left Planning — a failure takes no focus and moves nothing, and
//   its message stays in the Clear draft area.
// - Each attempt has its own guard, so a retry starts afresh.
//
// Pending and failing deletes are controlled in the page, by test-only
// fixtures installed before the app's scripts run:
// - a hold: the test's own readwrite transaction on planningDrafts, kept
//   alive by chained reads, so the app's delete queues behind it. Bounded by
//   a deadline, and always released (afterEach). The held store is never
//   read by the test;
// - a wrapper around IDBObjectStore.prototype.delete that counts the app's
//   draft deletes and keeps their transactions, so a release can abort a
//   queued delete — a failure that arrives after the rider has done
//   something else. Only deletes are aborted: an autosave put queued behind
//   the same hold still goes through;
// - an immediate fault: that delete throws.
// These are synthetic. They show what the interface does once a clear is
// pending or fails, not that such failures happen on a device.
//
// Input is real: pointer clicks at measured centres, key presses and wheel
// input. The app's own scroll calls are recorded, and so are focus calls
// made by script that actually moved focus, with their options and the
// page's position just before them. Outcomes are asserted twice over, and
// labelled:
// - [behaviour] what the rider sees: where focus is, whether the page moved
//   back towards Clear draft, and whether a needed reveal was the minimum;
// - [implementation] how it was done: a focus call with preventScroll, and
//   at most one deliberate scroll.
// A collapsing confirmation can move the page by itself — Chromium's scroll
// anchoring, or clamping — so a kept position is asserted as "the rider's
// anchor did not move down" and "the app made no scroll call", never as a
// raw scrollY.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const GAP = 8;
const HOLD_DEADLINE_MS = 30_000;

const DRAFT_NAME = "Clear draft failure";
const DRAFT = {
  id: "draft",
  waypoints: [
    { id: "wp-a", coordinate: [-0.1, 51.5] },
    { id: "wp-b", coordinate: [-0.09, 51.51] },
    { id: "wp-c", coordinate: [-0.08, 51.5] },
  ],
  routeName: DRAFT_NAME,
  avoidFerries: true,
  profile: "cycling-road",
  updatedAt: "2026-10-02T08:00:00.000Z",
};

const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];
const TEXT_SIZES = ["ordinary", "200%"] as const;
type TextSize = (typeof TEXT_SIZES)[number];

const COPY = {
  en: {
    plan: "Plan",
    routes: "Routes",
    clearDraft: "Clear draft",
    confirmTitle: "Clear this draft?",
    clearing: "Clearing…",
    cancel: "Cancel",
    failed: "The draft could not be cleared on this device. Try again.",
    routeName: "Route name",
  },
  de: {
    plan: "Planen",
    routes: "Routen",
    clearDraft: "Entwurf verwerfen",
    confirmTitle: "Diesen Entwurf verwerfen?",
    clearing: "Wird verworfen…",
    cancel: "Abbrechen",
    failed:
      "Der Entwurf konnte auf diesem Gerät nicht gelöscht werden. Versuche es erneut.",
    routeName: "Routenname",
  },
} as const;

interface Rect {
  top: number;
  bottom: number;
}

/** A focus call made by script that left focus on its target. */
interface FocusRecord {
  tag: string;
  text: string;
  inDialog: boolean;
  preventScroll: boolean;
  scrollYBefore: number;
  scrollYAfter: number;
  /** The target's own .row, in viewport coordinates, just before the call. */
  rowBefore: Rect | null;
}

/** The in-page fixture state; see installFixtures. */
interface AcnFixture {
  puts: number;
  deletes: number;
  deleteTxs: IDBTransaction[];
  faultDelete: boolean;
  hold: { stop: boolean; finished: string | null } | null;
  scrolls: string[];
  focusCalls: FocusRecord[];
}
type FixtureWindow = Window & {
  __acn: AcnFixture;
  __acnFocusAnchor?: Element | null;
};

/** Installed before any of the app's scripts run, so every draft write and
 * delete the app makes passes through the wrappers. */
async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixture: AcnFixture = {
      puts: 0,
      deletes: 0,
      deleteTxs: [],
      faultDelete: false,
      hold: null,
      scrolls: [],
      focusCalls: [],
    };
    (window as unknown as FixtureWindow).__acn = fixture;

    const isAppDraftRequest = (store: IDBObjectStore): boolean => {
      const tx = store.transaction as IDBTransaction & { __acnHold?: boolean };
      return store.name === "planningDrafts" && tx.__acnHold !== true;
    };

    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (isAppDraftRequest(this)) fixture.puts += 1;
      return put.apply(this, args);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["delete"]>
    ) {
      if (isAppDraftRequest(this)) {
        fixture.deletes += 1;
        fixture.deleteTxs.push(this.transaction);
        if (fixture.faultDelete) {
          throw new DOMException("synthetic fault", "UnknownError");
        }
      }
      return remove.apply(this, args);
    };

    // The caller's own arguments are forwarded unchanged: scrollBy(options)
    // and scrollBy(x, y) are different overloads.
    for (const name of ["scrollBy", "scrollTo", "scroll"] as const) {
      const original = window[name].bind(window) as (...args: unknown[]) => void;
      window[name] = (...args: unknown[]) => {
        fixture.scrolls.push(`${name} ${JSON.stringify(args)}`);
        original(...args);
      };
    }
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
    // call on a disabled button does nothing, and React's own commit makes
    // one when a focused button it disables is blurred.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      const row = this.closest(".row")?.getBoundingClientRect();
      const scrollYBefore = window.scrollY;
      focus.call(this, options);
      if (document.activeElement !== this) return;
      fixture.focusCalls.push({
        tag: this.tagName,
        text: this.textContent.trim(),
        inDialog: this.closest('[role="dialog"]') !== null,
        preventScroll: options?.preventScroll === true,
        scrollYBefore,
        scrollYAfter: window.scrollY,
        rowBefore: row ? { top: row.top, bottom: row.bottom } : null,
      });
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

/** Starts the test's own readwrite transaction on planningDrafts and
 * resolves once it is running, so the app's later delete queues behind it.
 * Ends by itself at the deadline. */
async function startHold(page: Page): Promise<void> {
  await page.evaluate(
    ({ dbName, deadlineMs }) =>
      new Promise<void>((resolve, reject) => {
        const fixture = (window as unknown as FixtureWindow).__acn;
        const request = indexedDB.open(dbName);
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "hold: open failed"));
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("planningDrafts", "readwrite") as IDBTransaction & {
            __acnHold?: boolean;
          };
          tx.__acnHold = true;
          const hold = { stop: false, finished: null as string | null };
          fixture.hold = hold;
          const objectStore = tx.objectStore("planningDrafts");
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
    { dbName: DB_NAME, deadlineMs: HOLD_DEADLINE_MS },
  );
}

/** Ends the hold. With `failQueuedDelete`, the app's queued draft delete is
 * aborted first, so it fails after whatever the rider did meanwhile. */
async function releaseHold(page: Page, failQueuedDelete: boolean): Promise<void> {
  await page.evaluate((fail) => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    if (!fixture.hold) throw new Error("no hold to release");
    if (fail) {
      for (const tx of fixture.deleteTxs) {
        try {
          tx.abort();
        } catch {
          // Already finished: only the queued delete can still be aborted.
        }
      }
    }
    fixture.hold.stop = true;
  }, failQueuedDelete);
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__acn.hold?.finished != null,
    null,
    { timeout: 10_000 },
  );
}

/** The fixture's counters and records, read one at a time: transactions
 * are not serialisable, so the whole state is never returned. */
const puts = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.puts);
const deletes = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.deletes);
const appScrolls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.scrolls);
const focusCalls = (page: Page): Promise<FocusRecord[]> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.focusCalls);

async function setDeleteFault(page: Page, on: boolean): Promise<void> {
  await page.evaluate((on) => {
    (window as unknown as FixtureWindow).__acn.faultDelete = on;
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

/** The usable band: below the sticky navigation, above the viewport's
 * bottom, with the same 8 px margins the reveal itself keeps. */
function band(page: Page): Promise<Rect> {
  return page.evaluate((gap) => {
    const header = document.querySelector("header.app-header--sticky");
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    return { top: headerBottom + gap, bottom: innerHeight - gap };
  }, GAP);
}

async function box(locator: Locator): Promise<Rect> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element is not laid out");
  return { top: b.y, bottom: b.y + b.height };
}

const scrollYOf = (page: Page): Promise<number> => page.evaluate(() => window.scrollY);

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

/** Scrolls by wheel until `locator`'s bottom sits about `inset` px above the
 * band's bottom, then proves it is inside the band. */
async function placeNearBandBottom(
  page: Page,
  locator: Locator,
  inset = 16,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const b = await band(page);
    const target = await box(locator);
    const dy = target.bottom - (b.bottom - inset);
    if (Math.abs(dy) <= 4) break;
    await wheelBy(page, dy);
  }
  const b = await band(page);
  const target = await box(locator);
  expect(target.top, "placed inside the band").toBeGreaterThanOrEqual(b.top);
  expect(target.bottom, "placed inside the band").toBeLessThanOrEqual(b.bottom);
}

/** A point on plain page content inside the band: no control, no map, no
 * header, nothing inside the Clear draft area. */
async function blankPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate((gap) => {
    const header = document.querySelector("header.app-header--sticky");
    const top = (header ? header.getBoundingClientRect().bottom : 0) + gap;
    for (let y = innerHeight - gap - 4; y > top; y -= 8) {
      for (const x of [3, 6, 10]) {
        const hit = document.elementFromPoint(x, y);
        if (
          hit &&
          !hit.closest(
            "button, input, select, textarea, summary, label, a, details, [role='dialog'], .row, header, .maplibregl-map, [data-testid='map-container']",
          )
        ) {
          return { x, y };
        }
      }
    }
    throw new Error("no blank point in the band");
  }, GAP);
}

const navButton = (page: Page, label: string): Locator =>
  page.getByRole("navigation").getByRole("button", { name: label, exact: true });
const confirmation = (page: Page, language: Language): Locator =>
  page.getByRole("dialog", { name: COPY[language].confirmTitle });
/** Clear draft itself — only ever mounted while its confirmation is not. */
const clearDraftTrigger = (page: Page, language: Language): Locator =>
  page.locator(".row > button.btn-danger", { hasText: COPY[language].clearDraft });
const failureAlert = (page: Page, language: Language): Locator =>
  page.getByRole("alert").filter({ hasText: COPY[language].failed });
const routeNameField = (page: Page, language: Language): Locator =>
  page.getByLabel(COPY[language].routeName, { exact: true });

async function seedLanguagePreference(page: Page, language: Language): Promise<void> {
  await writeRow(page, "appPreferences", { id: "app", language });
}

/** Stores the draft, applies the language, opens Planning, waits for its
 * first autosave to land so no later write is still on its way, and applies
 * the root text size. */
async function openPlanning(
  page: Page,
  language: Language,
  textSize: TextSize,
): Promise<void> {
  await installLocalMapStyle(page);
  await installFixtures(page);
  await page.goto("/");
  await expect(navButton(page, COPY.en.plan)).toBeVisible();
  await writeRow(page, "planningDrafts", DRAFT);
  if (language !== "en") await seedLanguagePreference(page, language);
  await page.reload();
  await navButton(page, COPY[language].plan).click();
  await expect(routeNameField(page, language)).toHaveValue(DRAFT_NAME);
  await expect(page.locator(".waypoint-list li")).toHaveCount(DRAFT.waypoints.length);
  await expect.poll(() => puts(page), { timeout: 10_000 }).toBeGreaterThan(0);
  if (textSize === "200%") await setRootText(page, "200%");
  await settle(page);
}

/** Opens the confirmation from a real tap on Clear draft, placed near the
 * band's bottom as a rider reaching for it would find it. */
async function openConfirmation(page: Page, language: Language): Promise<void> {
  const trigger = clearDraftTrigger(page, language);
  await placeNearBandBottom(page, trigger);
  await pointerClick(page, trigger);
  await expect(confirmation(page, language)).toBeVisible();
  await settle(page);
}

/** Confirms with a real tap on the confirmation's own Clear draft. With
 * `held`, the delete queues behind a hold and this returns once the app has
 * issued it. */
async function confirmClear(
  page: Page,
  language: Language,
  { held }: { held: boolean },
): Promise<void> {
  const deletesBefore = await deletes(page);
  if (held) await startHold(page);
  await pointerClick(
    page,
    confirmation(page, language).getByRole("button", {
      name: COPY[language].clearDraft,
      exact: true,
    }),
  );
  await expect.poll(() => deletes(page), { timeout: 5_000 }).toBe(deletesBefore + 1);
  if (held) {
    await expect(
      confirmation(page, language).getByRole("button", {
        name: COPY[language].clearing,
        exact: true,
      }),
    ).toBeDisabled();
  }
}

async function failHeldClear(page: Page, language: Language): Promise<void> {
  await releaseHold(page, true);
  await expect(failureAlert(page, language)).toBeVisible();
  await settle(page);
}

/** Samples a condition repeatedly over a window, so "nothing happened" is
 * not concluded from a single early look. */
async function expectToHold(
  description: string,
  check: () => Promise<boolean>,
  windowMs = 1_000,
): Promise<void> {
  const end = Date.now() + windowMs;
  while (Date.now() < end) {
    expect(await check(), description).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const isFocused = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => document.activeElement === element);

async function triggerFocusCalls(page: Page, language: Language): Promise<FocusRecord[]> {
  const calls = await focusCalls(page);
  return calls.filter(
    (call) =>
      call.tag === "BUTTON" && !call.inDialog && call.text === COPY[language].clearDraft,
  );
}

/** The message sits in Clear draft's own row, as an alert. */
async function expectMessageInClearDraftArea(
  page: Page,
  language: Language,
): Promise<void> {
  const trigger = clearDraftTrigger(page, language);
  await expect(failureAlert(page, language)).toBeVisible();
  await expect(confirmation(page, language)).toHaveCount(0);
  const sameRow = await failureAlert(page, language).evaluate(
    (alert, triggerText) =>
      Array.from(alert.parentElement?.children ?? []).some(
        (child) => child.tagName === "BUTTON" && child.textContent.trim() === triggerText,
      ),
    COPY[language].clearDraft,
  );
  expect.soft(sameRow, "[behaviour] the message is in Clear draft's own row").toBe(true);
  await expect(trigger).toBeEnabled();
}

/** The rider was still waiting: focus is back on Clear draft, and the page
 * moved exactly the minimum from where the failure left the row. */
async function expectRestoredByTheMinimum(page: Page, language: Language): Promise<void> {
  await expectMessageInClearDraftArea(page, language);
  const trigger = clearDraftTrigger(page, language);
  expect
    .soft(await isFocused(trigger), "[behaviour] focus is back on Clear draft")
    .toBe(true);
  const calls = await triggerFocusCalls(page, language);
  expect(calls, "one focus call landed on Clear draft").toHaveLength(1);
  const call = calls[0];
  if (!call.rowBefore) throw new Error("the focus call recorded no row");
  const b = await band(page);
  const rowHeight = call.rowBefore.bottom - call.rowBefore.top;
  expect(rowHeight, "the button and its message fit the band").toBeLessThanOrEqual(
    b.bottom - b.top,
  );
  const minimum =
    call.rowBefore.bottom > b.bottom
      ? call.rowBefore.bottom - b.bottom
      : call.rowBefore.top < b.top
        ? call.rowBefore.top - b.top
        : 0;
  const moved = (await scrollYOf(page)) - call.scrollYBefore;
  test.info().annotations.push({
    type: "reveal",
    description: `row before focus ${JSON.stringify(call.rowBefore)}, band ${JSON.stringify(b)}, minimum ${minimum.toFixed(1)} px, moved ${moved.toFixed(1)} px`,
  });
  expect
    .soft(
      Math.abs(moved - minimum),
      `[behaviour] moved ${moved.toFixed(1)} px from where the failure left the row; the minimum is ${minimum.toFixed(1)} px`,
    )
    .toBeLessThanOrEqual(1);
  const row = await box(trigger.locator("xpath=.."));
  expect
    .soft(
      row.top >= b.top - 1 && row.bottom <= b.bottom + 1,
      `[behaviour] the button and its message end inside the band (${JSON.stringify(row)})`,
    )
    .toBe(true);
  expect
    .soft(call.preventScroll, "[implementation] focus({ preventScroll: true })")
    .toBe(true);
  const scrolls = await appScrolls(page);
  expect
    .soft(
      scrolls.length,
      `[implementation] at most one deliberate scroll: ${scrolls.join("; ")}`,
    )
    .toBeLessThanOrEqual(1);
}

/** The rider had moved on: nothing took focus, nothing scrolled the page
 * back, and the message is still there. */
async function expectActivityKept(
  page: Page,
  language: Language,
  anchor: Locator,
  anchorTopBefore: number,
): Promise<void> {
  await expectMessageInClearDraftArea(page, language);
  const trigger = clearDraftTrigger(page, language);
  expect
    .soft(await isFocused(trigger), "[behaviour] Clear draft did not take focus")
    .toBe(false);
  expect
    .soft(
      await triggerFocusCalls(page, language),
      "[behaviour] no focus moved to Clear draft",
    )
    .toEqual([]);
  const anchorTopAfter = (await box(anchor)).top;
  test.info().annotations.push({
    type: "position",
    description: `anchor top ${anchorTopBefore.toFixed(1)} → ${anchorTopAfter.toFixed(1)} px`,
  });
  expect
    .soft(
      anchorTopAfter,
      "[behaviour] the page was not scrolled back towards Clear draft (the rider's anchor did not move down)",
    )
    .toBeLessThanOrEqual(anchorTopBefore + 1);
  expect
    .soft(await appScrolls(page), "[implementation] no deliberate scroll")
    .toEqual([]);
}

test.afterEach(async ({ page }) => {
  await page
    .evaluate(() => {
      const fixture = (window as unknown as FixtureWindow).__acn as
        AcnFixture | undefined;
      if (fixture?.hold) fixture.hold.stop = true;
    })
    .catch(() => undefined);
});

for (const language of LANGUAGES) {
  for (const textSize of TEXT_SIZES) {
    const label = `${language}, ${textSize} text`;

    test(`waiting, ${label}: an immediate failure returns focus to Clear draft without the browser's focus scroll and reveals it and its message by the minimum`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      await openPlanning(page, language, textSize);
      await openConfirmation(page, language);
      await setDeleteFault(page, true);
      await resetRecords(page);

      await confirmClear(page, language, { held: false });
      await expect(failureAlert(page, language)).toBeVisible();
      await settle(page);

      await expectRestoredByTheMinimum(page, language);
      expect(pageErrors).toEqual([]);
    });

    test(`waiting, ${label}: a delayed failure while the rider waits does the same`, async ({
      page,
    }) => {
      await openPlanning(page, language, textSize);
      await openConfirmation(page, language);
      await confirmClear(page, language, { held: true });
      // The busy state is unchanged: both actions disabled, the working label.
      await expect(
        confirmation(page, language).getByRole("button", {
          name: COPY[language].cancel,
          exact: true,
        }),
      ).toBeDisabled();
      await resetRecords(page);

      await failHeldClear(page, language);

      await expectRestoredByTheMinimum(page, language);
      const stored = await readPlanningDraftRow(page);
      expect(stored?.routeName).toBe(DRAFT_NAME);
      expect(Array.isArray(stored?.waypoints) ? stored.waypoints.length : -1).toBe(
        DRAFT.waypoints.length,
      );
    });

    test(`moved on, ${label}: after a wheel scroll down, a delayed failure takes no focus and scrolls nothing back`, async ({
      page,
    }) => {
      await openPlanning(page, language, textSize);
      await openConfirmation(page, language);
      await confirmClear(page, language, { held: true });
      await wheelBy(page, 300);
      const anchor = routeNameField(page, language);
      const anchorTop = (await box(anchor)).top;
      const scrollYBefore = await scrollYOf(page);
      await resetRecords(page);

      await failHeldClear(page, language);

      await expectActivityKept(page, language, anchor, anchorTop);
      test.info().annotations.push({
        type: "scrollY",
        description: `${String(scrollYBefore)} → ${String(await scrollYOf(page))}`,
      });
    });

    test(`moved on, ${label}: Route name tapped and typed into keeps focus and every keystroke`, async ({
      page,
    }) => {
      await openPlanning(page, language, textSize);
      await openConfirmation(page, language);
      await confirmClear(page, language, { held: true });
      const field = routeNameField(page, language);
      await placeNearBandBottom(page, field, 40);
      await pointerClick(page, field);
      await page.keyboard.press("End");
      await page.keyboard.type("AB");
      const anchorTop = (await box(field)).top;
      await resetRecords(page);

      await failHeldClear(page, language);
      await page.keyboard.type("C");

      await expectActivityKept(page, language, field, anchorTop);
      expect
        .soft(await isFocused(field), "[behaviour] focus stays in Route name")
        .toBe(true);
      await expect(field).toHaveValue(`${DRAFT_NAME}ABC`);
      // Persistence is untouched: the edit is autosaved over the kept draft.
      await expect
        .poll(async () => (await readPlanningDraftRow(page))?.routeName, {
          timeout: 5_000,
        })
        .toBe(`${DRAFT_NAME}ABC`);
      const stored = await readPlanningDraftRow(page);
      expect(Array.isArray(stored?.waypoints) ? stored.waypoints.length : -1).toBe(
        DRAFT.waypoints.length,
      );
    });
  }
}

for (const textSize of TEXT_SIZES) {
  test(`moved on, en, ${textSize} text: after a wheel scroll up, a delayed failure leaves the page exactly where the rider put it`, async ({
    page,
  }) => {
    await openPlanning(page, "en", textSize);
    await openConfirmation(page, "en");
    await confirmClear(page, "en", { held: true });
    await wheelBy(page, -300);
    // The routing disclosure sits above the Clear draft area, so the
    // collapse happens below it.
    const anchor = page.locator("summary").first();
    const anchorTop = (await box(anchor)).top;
    const scrollYBefore = await scrollYOf(page);
    await resetRecords(page);

    await failHeldClear(page, "en");

    await expectActivityKept(page, "en", anchor, anchorTop);
    expect
      .soft(
        Math.abs((await scrollYOf(page)) - scrollYBefore),
        "[behaviour] the position is unchanged",
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(
        Math.abs((await box(anchor)).top - anchorTop),
        "[behaviour] the anchor is unchanged",
      )
      .toBeLessThanOrEqual(1);
  });
}

test("moved on: Shift+Tab to the routing disclosure keeps focus there, and Enter then opens that disclosure, not Clear draft", async ({
  page,
}) => {
  await openPlanning(page, "en", "ordinary");
  await openConfirmation(page, "en");
  await confirmClear(page, "en", { held: true });
  await expect(
    confirmation(page, "en").getByRole("heading", { name: COPY.en.confirmTitle }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const summary = page.locator("summary").first();
  await expect(summary).toBeFocused();
  const anchorTop = (await box(summary)).top;
  await resetRecords(page);

  await failHeldClear(page, "en");

  await expectActivityKept(page, "en", summary, anchorTop);
  expect
    .soft(await isFocused(summary), "[behaviour] focus stays on the disclosure")
    .toBe(true);
  // The rider's next key reaches the disclosure, not Clear draft.
  await page.keyboard.press("Enter");
  await expect(page.locator("details").first()).toHaveAttribute("open", "");
  await expect(confirmation(page, "en")).toHaveCount(0);
});

test("moved on: a tap on blank space, which leaves focus on <body>, still counts as moving on", async ({
  page,
}) => {
  await openPlanning(page, "en", "ordinary");
  await openConfirmation(page, "en");
  await confirmClear(page, "en", { held: true });
  const point = await blankPoint(page);
  await page.mouse.click(point.x, point.y);
  const anchor = routeNameField(page, "en");
  const anchorTop = (await box(anchor)).top;
  await resetRecords(page);

  await failHeldClear(page, "en");

  await expectActivityKept(page, "en", anchor, anchorTop);
});

test("waiting: a refused Escape and a tap on the disabled action are still this interaction, so a failure returns focus", async ({
  page,
}) => {
  await openPlanning(page, "en", "ordinary");
  await openConfirmation(page, "en");
  await confirmClear(page, "en", { held: true });
  await page.keyboard.press("Escape");
  await expectToHold("Escape is refused while clearing", async () =>
    confirmation(page, "en").isVisible(),
  );
  await pointerClick(
    page,
    confirmation(page, "en").getByRole("button", { name: COPY.en.clearing, exact: true }),
  );
  await expect(confirmation(page, "en")).toBeVisible();
  await resetRecords(page);

  await failHeldClear(page, "en");

  await expectRestoredByTheMinimum(page, "en");
});

test("leaving Planning while the clear is pending: a later failure takes no focus and moves nothing on Routes, and the draft is intact on return", async ({
  page,
}) => {
  await openPlanning(page, "en", "ordinary");
  await openConfirmation(page, "en");
  await confirmClear(page, "en", { held: true });
  await navButton(page, COPY.en.routes).click();
  await expect(navButton(page, COPY.en.routes)).toHaveAttribute("aria-current", "page");
  await settle(page);
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).__acnFocusAnchor = document.activeElement;
  });
  const scrollYBefore = await scrollYOf(page);
  await resetRecords(page);

  await releaseHold(page, true);

  await expectToHold(
    "nothing on Routes is focused or scrolled by the failure",
    async () => {
      const [focused, scrolled, focusKept] = await Promise.all([
        focusCalls(page),
        appScrolls(page),
        page.evaluate(
          () =>
            document.activeElement ===
            (window as unknown as FixtureWindow).__acnFocusAnchor,
        ),
      ]);
      return focused.length === 0 && scrolled.length === 0 && focusKept;
    },
  );
  expect(await scrollYOf(page)).toBe(scrollYBefore);
  await expect(navButton(page, COPY.en.routes)).toHaveAttribute("aria-current", "page");

  await navButton(page, COPY.en.plan).click();
  await expect(routeNameField(page, "en")).toHaveValue(DRAFT_NAME);
  await expect(page.locator(".waypoint-list li")).toHaveCount(DRAFT.waypoints.length);
  const stored = await readPlanningDraftRow(page);
  expect(stored?.routeName).toBe(DRAFT_NAME);
});

test("retry: each attempt has its own guard — moved on, then a fresh attempt while waiting returns focus, then a successful clear removes the message", async ({
  page,
}) => {
  await openPlanning(page, "en", "ordinary");

  // First attempt: the rider scrolls away, and the failure leaves them be.
  await openConfirmation(page, "en");
  await confirmClear(page, "en", { held: true });
  await wheelBy(page, 300);
  const anchor = routeNameField(page, "en");
  const anchorTop = (await box(anchor)).top;
  await resetRecords(page);
  await failHeldClear(page, "en");
  await expectActivityKept(page, "en", anchor, anchorTop);

  // Second attempt: the rider waits, and focus comes back.
  await openConfirmation(page, "en");
  await expect(failureAlert(page, "en")).toHaveCount(0);
  await confirmClear(page, "en", { held: true });
  await resetRecords(page);
  await failHeldClear(page, "en");
  await expectRestoredByTheMinimum(page, "en");

  // Third attempt succeeds.
  await openConfirmation(page, "en");
  await resetRecords(page);
  await confirmClear(page, "en", { held: false });
  await expect(page.locator(".waypoint-list li")).toHaveCount(0);
  await expect(failureAlert(page, "en")).toHaveCount(0);
  expect(await triggerFocusCalls(page, "en")).toEqual([]);
});
