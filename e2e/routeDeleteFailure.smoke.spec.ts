import { expect, test, type Locator, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 124's inventory case D-02 — Delete route's pending and
// failure lifecycle — in both engines (this file runs under the "chromium"
// and "webkit-smoke" projects), at 390x844 portrait, in English and German,
// at ordinary and 200% root text where layout matters.
//
// - While a confirmed deletion runs, its route stays listed with
//   "Deleting…" and every conflicting action refused, whatever the rider
//   does meanwhile, including leaving Routes; after it commits, the card
//   stays a disabled "Deleting…" until the list itself no longer has it.
// - A failure shows the ordinary translated message beside its route.
//   While the rider is still waiting at the card, Cancel takes focus without
//   the browser's own focus scroll and the grown confirmation is revealed by
//   the minimum (its action row first when it cannot fit); once they have
//   moved on, nothing takes focus and nothing moves.
// - A failure that lands while the rider's own search or tag filter hides
//   the route adds nothing to the list; the route returns with its failed
//   confirmation, without taking focus (the rider's option A, 3 October
//   2026).
// - After a success, focus is repaired to the neighbouring card only when it
//   was inside the removed card, and the page is moved back only while the
//   rider was still waiting.
//
// Pending, failing and committed deletions are controlled in the page by
// test-only fixtures installed before the app's scripts run:
// - a hold: the test's own readwrite transaction on routes, kept alive by
//   chained reads, so the app's delete queues behind it. Bounded by a
//   deadline and always released (afterEach). The held store is never read
//   by the test while held;
// - a wrapper around IDBObjectStore.prototype.delete that counts the app's
//   route deletes and keeps their transactions, so a release can abort a
//   queued delete — a failure arriving after the rider did something else;
// - an immediate fault: that delete throws;
// - a read fault: the routes list's reads throw, standing in for a live
//   query that fails after a commit.
// These are synthetic. They show what the interface does once a deletion is
// pending or fails, not that such failures happen on a device.
//
// Input is real: pointer clicks at measured centres, key presses and wheel
// input, except where a disabled control is the subject — there a click is
// dispatched to it directly, since Playwright refuses disabled targets.
// The app's scroll calls are recorded, and so are focus calls made by
// script that actually moved focus, with their options and the geometry
// just before them; a MutationObserver records every committed state of the
// target card. Outcomes are labelled:
// - [behaviour] what the rider sees: where focus is, whether the page moved
//   and by how much, what the card shows;
// - [implementation] how it was done: focus with preventScroll, at most one
//   deliberate scroll.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const GAP = 8;
const HOLD_DEADLINE_MS = 30_000;

// Seeded in this order, each newer than the last; the library lists the
// newest first, so the target is the fourth card and the neighbour that
// takes its place below it is the fifth.
const ROUTE_NAMES = [
  "Alpine Climb",
  "Coastal Ride",
  "Forest Loop",
  "Harbour Run",
  "Lakeside Spin",
  "Moor Crossing",
  "River Path",
  "Valley Tour",
] as const;
const TARGET = "Moor Crossing";
const NEIGHBOUR = "Lakeside Spin";
const OTHER = "Coastal Ride";
const TAGGED = "Valley Tour";
const TAG = "Weekend";

const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];
type TextSize = "ordinary" | "200%";

const COPY = {
  en: {
    routes: "Routes",
    settings: "Settings",
    delete: "Delete",
    deleteRoute: "Delete route",
    deleting: "Deleting…",
    cancel: "Cancel",
    confirmTitle: (name: string) => `Delete “${name}”?`,
    failed: "That route could not be deleted.",
    search: "Search routes",
    rename: "Rename",
    addTags: "Add tags",
    export: "Export",
    pin: (name: string) => `Pin ${name}`,
    manageTags: "Manage tags",
    busyDeleting: "Wait for the route deletion to finish, then manage tags.",
    loading: "Loading routes…",
    filterByTags: "Filter by tags",
  },
  de: {
    routes: "Routen",
    settings: "Einstellungen",
    delete: "Löschen",
    deleteRoute: "Route löschen",
    deleting: "Wird gelöscht…",
    cancel: "Abbrechen",
    confirmTitle: (name: string) => `„${name}“ löschen?`,
    failed: "Diese Route konnte nicht gelöscht werden.",
    search: "Routen durchsuchen",
    rename: "Umbenennen",
    addTags: "Tags hinzufügen",
    export: "Exportieren",
    pin: (name: string) => `${name} oben fixieren`,
    manageTags: "Tags verwalten",
    busyDeleting:
      "Warte, bis die Route gelöscht wurde. Danach kannst du die Tags verwalten.",
    loading: "Routen werden geladen…",
    filterByTags: "Nach Tags filtern",
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
  /** The target itself, in viewport coordinates, just before the call. */
  targetBefore: Rect;
  /** Its confirmation and that confirmation's action row, if inside one. */
  insetBefore: Rect | null;
  actionsBefore: Rect | null;
}

/** One committed state of the observed card. */
interface CardState {
  present: boolean;
  hasDialog: boolean;
  nameDisabled: boolean;
  confirmDisabled: boolean;
}

interface AcnFixture {
  deletes: number;
  deleteTxs: IDBTransaction[];
  faultDelete: boolean;
  faultReads: boolean;
  hold: { stop: boolean; finished: string | null } | null;
  scrolls: string[];
  focusCalls: FocusRecord[];
  cardStates: CardState[];
}
type FixtureWindow = Window & { __acn: AcnFixture };

async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixture: AcnFixture = {
      deletes: 0,
      deleteTxs: [],
      faultDelete: false,
      faultReads: false,
      hold: null,
      scrolls: [],
      focusCalls: [],
      cardStates: [],
    };
    (window as unknown as FixtureWindow).__acn = fixture;

    // The test's own transactions — the hold, and its reads of what is
    // stored — are never counted or faulted.
    const isHold = (tx: IDBTransaction): boolean => {
      const tagged = tx as IDBTransaction & { __acnHold?: boolean; __acnProbe?: boolean };
      return tagged.__acnHold === true || tagged.__acnProbe === true;
    };

    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["delete"]>
    ) {
      if (this.name === "routes" && !isHold(this.transaction)) {
        fixture.deletes += 1;
        fixture.deleteTxs.push(this.transaction);
        if (fixture.faultDelete) {
          throw new DOMException("synthetic fault", "UnknownError");
        }
      }
      return remove.apply(this, args);
    };
    // The routes list's reads, faulted on demand.
    for (const proto of [IDBIndex.prototype, IDBObjectStore.prototype]) {
      for (const method of ["getAll", "openCursor"] as const) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
        const original = proto[method] as (...args: unknown[]) => IDBRequest;
        Object.defineProperty(proto, method, {
          configurable: true,
          writable: true,
          value: function (this: IDBIndex | IDBObjectStore, ...args: unknown[]) {
            const store = this instanceof IDBIndex ? this.objectStore : this;
            if (
              fixture.faultReads &&
              store.name === "routes" &&
              !isHold(store.transaction)
            ) {
              throw new DOMException("synthetic read fault", "UnknownError");
            }
            return original.apply(this, args);
          },
        });
      }
    }

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
    const rectOf = (element: Element | null) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    // Only calls that actually leave focus on their target are recorded.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      const targetBefore = rectOf(this) ?? { top: 0, bottom: 0 };
      const insetBefore = rectOf(this.closest('[role="dialog"]'));
      const actionsBefore = rectOf(this.closest(".route-delete-confirm-actions"));
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
        targetBefore,
        insetBefore,
        actionsBefore,
      });
    };
  });
}

function routeRow(index: number, name: string) {
  const day = String(index + 1).padStart(2, "0");
  return {
    id: `d02-route-${String(index)}`,
    name,
    createdAt: `2026-09-${day}T08:00:00.000Z`,
    points: [
      { coordinate: [-0.1, 51.5], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [-0.09, 51.5], elevationMetres: 14, distanceFromStartMetres: 700 },
    ],
    manoeuvres: [],
    distanceMetres: 700,
    ascentMetres: 4,
    descentMetres: 0,
    warnings: [],
    source: { kind: "gpx-import" },
    tags: name === TAGGED ? [TAG] : [],
  };
}

async function writeRows(page: Page, store: string, rows: object[]): Promise<void> {
  await page.evaluate(
    ({ dbName, store, rows }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, "readwrite");
          for (const row of rows) tx.objectStore(store).put(row);
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
    { dbName: DB_NAME, store, rows },
  );
}

/** The stored route names — only ever read once no hold is running. */
async function storedRouteNames(page: Page): Promise<string[]> {
  return page.evaluate(
    (dbName) =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("routes", "readonly") as IDBTransaction & {
            __acnProbe?: boolean;
          };
          tx.__acnProbe = true;
          const all = tx.objectStore("routes").getAll();
          all.onsuccess = () => {
            db.close();
            resolve((all.result as { name: string }[]).map((row) => row.name).sort());
          };
          all.onerror = () => {
            reject(new Error("could not read the stored routes"));
          };
        };
        request.onerror = () => {
          reject(new Error("could not open the database"));
        };
      }),
    DB_NAME,
  );
}

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
          const tx = db.transaction("routes", "readwrite") as IDBTransaction & {
            __acnHold?: boolean;
          };
          tx.__acnHold = true;
          const hold = { stop: false, finished: null as string | null };
          fixture.hold = hold;
          const objectStore = tx.objectStore("routes");
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

/** Ends the hold. With `failQueuedDelete`, the app's queued route delete is
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
          // Already finished: only a queued delete can still be aborted.
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

const deletes = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.deletes);
const appScrolls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.scrolls);
const focusCalls = (page: Page): Promise<FocusRecord[]> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.focusCalls);
const cardStates = (page: Page): Promise<CardState[]> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acn.cardStates);

async function setFault(
  page: Page,
  kind: "faultDelete" | "faultReads",
  on: boolean,
): Promise<void> {
  await page.evaluate(
    ({ kind, on }) => {
      (window as unknown as FixtureWindow).__acn[kind] = on;
    },
    { kind, on },
  );
}

async function resetRecords(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    fixture.scrolls = [];
    fixture.focusCalls = [];
  });
}

/** Records every committed state of one card — through a MutationObserver,
 * whose callback runs after React's commit and its layout effects, so a
 * state it never sees was never painted either. */
async function observeCard(page: Page, routeId: string): Promise<void> {
  await page.evaluate((routeId) => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    fixture.cardStates = [];
    const read = (): CardState => {
      const card = document.querySelector(`li[data-route-id="${routeId}"]`);
      if (!card) {
        return {
          present: false,
          hasDialog: false,
          nameDisabled: false,
          confirmDisabled: false,
        };
      }
      const name = card.querySelector<HTMLButtonElement>(".route-card-title");
      const confirm = card.querySelector<HTMLButtonElement>(
        '[role="dialog"] .route-delete-confirm-actions .btn-danger',
      );
      return {
        present: true,
        hasDialog: card.querySelector('[role="dialog"]') !== null,
        nameDisabled: name?.disabled ?? false,
        confirmDisabled: confirm?.disabled ?? false,
      };
    };
    fixture.cardStates.push(read());
    new MutationObserver(() => {
      fixture.cardStates.push(read());
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }, routeId);
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

/** Wheel input over the route list, never the header. */
async function wheelBy(page: Page, dy: number): Promise<void> {
  await page.mouse.move(6, 600);
  await page.mouse.wheel(0, dy);
  await settle(page);
}

async function placeNearBandBottom(
  page: Page,
  locator: Locator,
  inset: number,
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

/** A point on plain page content inside the band: no control, no card. */
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
            "button, input, select, textarea, label, a, [role='dialog'], li, header",
          )
        ) {
          return { x, y };
        }
      }
    }
    throw new Error("no blank point in the band");
  }, GAP);
}

/** What the rider sees at the top of the usable band, marked so it can be
 * measured again later. A failure grows its confirmation downwards, which
 * moves everything below the message by itself — so a kept position is
 * judged from content above it, never from a card further down. Scanned
 * from the band's top only, which a wheel scroll leaves above the message
 * in every case here. */
async function topAnchor(page: Page): Promise<Locator> {
  await page.evaluate((gap) => {
    document.querySelector("[data-e2e-anchor]")?.removeAttribute("data-e2e-anchor");
    const header = document.querySelector("header.app-header--sticky");
    const top = (header ? header.getBoundingClientRect().bottom : 0) + gap;
    for (let y = top + 4; y < innerHeight / 2; y += 8) {
      const hit = document.elementFromPoint(195, y);
      // Anything above the failure message's insertion point — including
      // the confirmation's own title and explanation — stays put when it
      // grows; its action row, and everything after it, does not.
      if (
        hit &&
        hit !== document.body &&
        !hit.closest('.route-delete-confirm-actions, [role="alert"]')
      ) {
        hit.setAttribute("data-e2e-anchor", "");
        return;
      }
    }
    throw new Error("no anchor at the top of the band");
  }, GAP);
  return page.locator("[data-e2e-anchor]");
}

const navButton = (page: Page, label: string): Locator =>
  page.getByRole("navigation").getByRole("button", { name: label, exact: true });
const cardById = (page: Page, name: string): Locator =>
  page.locator(`li[data-route-id="${routeIdOf(name)}"]`);
const routeIdOf = (name: string): string =>
  `d02-route-${String(ROUTE_NAMES.findIndex((routeName) => routeName === name))}`;
const dialogOf = (page: Page, language: Language, name: string): Locator =>
  cardById(page, name).getByRole("dialog", { name: COPY[language].confirmTitle(name) });
const failureAlert = (page: Page, language: Language, name: string): Locator =>
  dialogOf(page, language, name).getByRole("alert");
const searchField = (page: Page, language: Language): Locator =>
  page.getByLabel(COPY[language].search, { exact: true });

const isFocused = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => document.activeElement === element);
const focusedSummary = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return "<body>";
    return `${active.tagName} ${active.textContent.trim().slice(0, 40)}`;
  });

/** Seeds the routes and the language, then opens Routes at the text size. */
async function openRoutes(
  page: Page,
  language: Language,
  textSize: TextSize = "ordinary",
): Promise<void> {
  await installLocalMapStyle(page);
  await installFixtures(page);
  await page.goto("/");
  await expect(navButton(page, COPY.en.routes)).toBeVisible();
  await writeRows(
    page,
    "routes",
    ROUTE_NAMES.map((name, index) => routeRow(index, name)),
  );
  if (language !== "en") {
    await writeRows(page, "appPreferences", [{ id: "app", language }]);
  }
  await page.reload();
  await expect(cardById(page, TARGET)).toBeVisible();
  await expect(page.locator("li.route-card")).toHaveCount(ROUTE_NAMES.length);
  if (textSize === "200%") await setRootText(page, "200%");
  await settle(page);
}

/** Opens the target's confirmation from a real tap on its Delete, placed
 * `inset` px above the band's bottom first, as a rider scrolling down to it
 * would find it. */
async function openDelete(
  page: Page,
  language: Language,
  name = TARGET,
  inset = 60,
): Promise<void> {
  const trigger = cardById(page, name).locator(".route-list-item-actions > .btn-danger");
  await placeNearBandBottom(page, trigger, inset);
  await pointerClick(page, trigger);
  await expect(dialogOf(page, language, name)).toBeVisible();
  await expect(
    dialogOf(page, language, name).getByRole("button", { name: COPY[language].cancel }),
  ).toBeFocused();
  await settle(page);
}

/** Confirms with a real tap. With `held`, the delete queues behind a hold
 * and this returns once the app has issued it and shows "Deleting…". */
async function confirmDelete(
  page: Page,
  language: Language,
  { held, name = TARGET }: { held: boolean; name?: string },
): Promise<void> {
  const deletesBefore = await deletes(page);
  if (held) await startHold(page);
  await pointerClick(
    page,
    dialogOf(page, language, name).getByRole("button", {
      name: COPY[language].deleteRoute,
      exact: true,
    }),
  );
  await expect.poll(() => deletes(page), { timeout: 5_000 }).toBe(deletesBefore + 1);
  if (held) {
    await expect(
      dialogOf(page, language, name).getByRole("button", {
        name: COPY[language].deleting,
        exact: true,
      }),
    ).toBeDisabled();
  }
}

/** Samples a condition repeatedly, so "nothing happened" is not concluded
 * from a single early look. */
async function expectToHold(
  description: string,
  check: () => Promise<boolean>,
  windowMs = 800,
): Promise<void> {
  const end = Date.now() + windowMs;
  while (Date.now() < end) {
    expect(await check(), description).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

/** The ordinary translated message, and never a storage error's own text. */
async function expectTranslatedFailure(
  page: Page,
  language: Language,
  name = TARGET,
): Promise<void> {
  await expect(failureAlert(page, language, name)).toHaveText(COPY[language].failed);
  const dialogText = await dialogOf(page, language, name).innerText();
  expect
    .soft(
      /synthetic|abort|transaction|UnknownError/i.test(dialogText),
      `[behaviour] no technical text in the confirmation: ${dialogText}`,
    )
    .toBe(false);
  await expect(
    dialogOf(page, language, name).getByRole("button", {
      name: COPY[language].deleteRoute,
      exact: true,
    }),
  ).toBeEnabled();
}

/** The rider was still waiting: Cancel has focus, and the page moved
 * exactly the minimum, from where the failure left the confirmation, to
 * show all of it — or its complete action row when it cannot fit. */
async function expectRestoredByTheMinimum(page: Page, language: Language): Promise<void> {
  await expectTranslatedFailure(page, language);
  const dialog = dialogOf(page, language, TARGET);
  const cancel = dialog.getByRole("button", { name: COPY[language].cancel, exact: true });
  expect
    .soft(
      await isFocused(cancel),
      `[behaviour] Cancel has focus (focus: ${await focusedSummary(page)})`,
    )
    .toBe(true);
  const b = await band(page);
  const actions = await box(dialog.locator(".route-delete-confirm-actions"));
  expect
    .soft(
      actions.top >= b.top - 1 && actions.bottom <= b.bottom + 1,
      `[behaviour] the complete action row ends inside the band (${JSON.stringify(actions)}, band ${JSON.stringify(b)})`,
    )
    .toBe(true);
  const calls = (await focusCalls(page)).filter(
    (call) =>
      call.tag === "BUTTON" && call.inDialog && call.text === COPY[language].cancel,
  );
  expect
    .soft(calls.length, "[behaviour] one focus call landed on Cancel after the failure")
    .toBe(1);
  const call = calls.at(0);
  if (call?.insetBefore && call.actionsBefore) {
    const inset = call.insetBefore;
    const fits = inset.bottom - inset.top <= b.bottom - b.top;
    const subject = fits ? inset : call.actionsBefore;
    const minimum =
      subject.bottom > b.bottom
        ? subject.bottom - b.bottom
        : subject.top < b.top
          ? subject.top - b.top
          : 0;
    const moved = (await scrollYOf(page)) - call.scrollYBefore;
    test.info().annotations.push({
      type: "reveal",
      description: `${fits ? "fits" : "oversized"}: inset ${JSON.stringify(inset)}, actions ${JSON.stringify(call.actionsBefore)}, band ${JSON.stringify(b)}, minimum ${minimum.toFixed(1)} px, moved ${moved.toFixed(1)} px`,
    });
    expect
      .soft(
        Math.abs(moved - minimum),
        `[behaviour] moved ${moved.toFixed(1)} px from where the failure left the confirmation; the minimum is ${minimum.toFixed(1)} px`,
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(call.preventScroll, "[implementation] focus({ preventScroll: true })")
      .toBe(true);
  }
  const scrolls = await appScrolls(page);
  expect
    .soft(
      scrolls.length,
      `[implementation] at most one deliberate scroll: ${scrolls.join("; ")}`,
    )
    .toBeLessThanOrEqual(1);
}

/** The rider had moved on: nothing took focus to the confirmation, nothing
 * scrolled the page back, and the message is there. */
async function expectActivityKept(
  page: Page,
  language: Language,
  anchor: Locator,
  anchorTopBefore: number,
): Promise<void> {
  await expectTranslatedFailure(page, language);
  const intoDialog = (await focusCalls(page)).filter((call) => call.inDialog);
  expect.soft(intoDialog, "[behaviour] no focus moved into the confirmation").toEqual([]);
  const anchorTopAfter = (await box(anchor)).top;
  test.info().annotations.push({
    type: "position",
    description: `anchor top ${anchorTopBefore.toFixed(1)} → ${anchorTopAfter.toFixed(1)} px`,
  });
  expect
    .soft(
      Math.abs(anchorTopAfter - anchorTopBefore),
      "[behaviour] the page did not move (the rider's anchor stayed put)",
    )
    .toBeLessThanOrEqual(1);
  expect
    .soft(await appScrolls(page), "[implementation] no deliberate scroll")
    .toEqual([]);
}

/** No committed state after Confirm showed the deleted route as an ordinary
 * card: from its first "Deleting…" state until it left the list it kept its
 * confirmation, a disabled name and a disabled "Deleting…". */
async function expectNoOrdinaryCardState(page: Page): Promise<void> {
  const states = await cardStates(page);
  const firstBusy = states.findIndex((state) => state.present && state.confirmDisabled);
  expect
    .soft(firstBusy, '[behaviour] "Deleting…" was committed')
    .toBeGreaterThanOrEqual(0);
  const ordinary = states
    .slice(Math.max(firstBusy, 0))
    .filter(
      (state) =>
        state.present &&
        (!state.hasDialog || !state.nameDisabled || !state.confirmDisabled),
    );
  test.info().annotations.push({
    type: "card states",
    description: `${String(states.length)} recorded, first busy at ${String(firstBusy)}, ${String(ordinary.length)} ordinary after it`,
  });
  expect
    .soft(
      ordinary,
      "[behaviour] the deleted route was never committed as an ordinary card",
    )
    .toEqual([]);
  expect(states.at(-1)?.present, "the card has left the list").toBe(false);
}

/** After a success with focus inside the removed card: focus is on the
 * neighbour's name, and the page moved at most the minimum that shows it. */
async function expectRepairedToNeighbour(
  page: Page,
  { revealAllowed }: { revealAllowed: boolean },
): Promise<void> {
  const neighbourName = cardById(page, NEIGHBOUR).locator(".route-card-title");
  expect
    .soft(
      await isFocused(neighbourName),
      `[behaviour] focus moved to the neighbour's name (focus: ${await focusedSummary(page)})`,
    )
    .toBe(true);
  const calls = (await focusCalls(page)).filter(
    (call) => call.tag === "BUTTON" && call.text === NEIGHBOUR,
  );
  expect.soft(calls.length, "[behaviour] one focus call landed on the neighbour").toBe(1);
  const call = calls.at(0);
  const b = await band(page);
  if (call) {
    const target = call.targetBefore;
    const minimum = !revealAllowed
      ? 0
      : target.bottom > b.bottom
        ? target.bottom - b.bottom
        : target.top < b.top
          ? target.top - b.top
          : 0;
    const moved = (await scrollYOf(page)) - call.scrollYBefore;
    test.info().annotations.push({
      type: "repair",
      description: `neighbour before ${JSON.stringify(target)}, band ${JSON.stringify(b)}, minimum ${minimum.toFixed(1)} px, moved ${moved.toFixed(1)} px`,
    });
    expect
      .soft(
        Math.abs(moved - minimum),
        `[behaviour] the page moved ${moved.toFixed(1)} px; at most the minimum ${minimum.toFixed(1)} px was allowed`,
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(call.preventScroll, "[implementation] focus({ preventScroll: true })")
      .toBe(true);
  }
  const scrolls = await appScrolls(page);
  expect
    .soft(
      scrolls.length,
      `[implementation] ${revealAllowed ? "at most one" : "no"} deliberate scroll: ${scrolls.join("; ")}`,
    )
    .toBeLessThanOrEqual(revealAllowed ? 1 : 0);
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

// ---------------------------------------------------------------------------
// Failure while the rider waits
// ---------------------------------------------------------------------------

for (const language of LANGUAGES) {
  for (const textSize of ["ordinary", "200%"] as const) {
    test(`waiting, ${language}, ${textSize} text: an immediate failure shows the translated message, focuses Cancel without the browser's focus scroll and reveals by the minimum`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      await openRoutes(page, language, textSize);
      await openDelete(page, language);
      await setFault(page, "faultDelete", true);
      await resetRecords(page);

      await confirmDelete(page, language, { held: false });
      await expect(failureAlert(page, language, TARGET)).toBeVisible();
      await settle(page);

      await expectRestoredByTheMinimum(page, language);
      // Escape then closes it, returning focus to the card's Delete.
      await page.keyboard.press("Escape");
      await expect(dialogOf(page, language, TARGET)).toHaveCount(0);
      await expect(
        cardById(page, TARGET).locator(".route-list-item-actions > .btn-danger"),
      ).toBeFocused();
      await setFault(page, "faultDelete", false);
      expect(await storedRouteNames(page)).toContain(TARGET);
      expect(pageErrors).toEqual([]);
    });
  }
}

for (const [language, textSize] of [
  ["en", "ordinary"],
  ["de", "200%"],
] as const) {
  test(`waiting, ${language}, ${textSize} text: a delayed failure keeps the route as "Deleting…", refuses Escape on the parked title, then focuses Cancel and reveals by the minimum`, async ({
    page,
  }) => {
    await openRoutes(page, language, textSize);
    await openDelete(page, language);
    await confirmDelete(page, language, { held: true });
    const dialog = dialogOf(page, language, TARGET);
    await expect(
      dialog.getByRole("button", { name: COPY[language].cancel }),
    ).toBeDisabled();
    expect
      .soft(
        await dialog
          .getByRole("heading", { name: COPY[language].confirmTitle(TARGET) })
          .evaluate((element) => document.activeElement === element),
        `[behaviour] focus waits on the confirmation's title (focus: ${await focusedSummary(page)})`,
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expectToHold("the confirmation stays open, still deleting", async () => {
      return (
        (await dialog.count()) === 1 &&
        (await dialog
          .getByRole("button", { name: COPY[language].deleting, exact: true })
          .isDisabled())
      );
    });
    await resetRecords(page);

    await releaseHold(page, true);
    await expect(failureAlert(page, language, TARGET)).toBeVisible();
    await settle(page);

    await expectRestoredByTheMinimum(page, language);
    expect(await storedRouteNames(page)).toContain(TARGET);
  });
}

test("waiting, en: a tap on the confirmation's own text still counts as waiting", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  await pointerClick(page, dialogOf(page, "en", TARGET).locator("p").first());
  await resetRecords(page);

  await releaseHold(page, true);
  await expect(failureAlert(page, "en", TARGET)).toBeVisible();
  await settle(page);

  await expectRestoredByTheMinimum(page, "en");
});

// ---------------------------------------------------------------------------
// Failure after the rider has moved on
// ---------------------------------------------------------------------------

for (const [language, textSize] of [
  ["en", "ordinary"],
  ["de", "200%"],
] as const) {
  test(`moved on, ${language}, ${textSize} text: after a wheel scroll, a delayed failure takes no focus and moves nothing`, async ({
    page,
  }) => {
    await openRoutes(page, language, textSize);
    await openDelete(page, language);
    await confirmDelete(page, language, { held: true });
    await wheelBy(page, 240);
    const anchor = await topAnchor(page);
    const anchorTop = (await box(anchor)).top;
    await resetRecords(page);

    await releaseHold(page, true);
    await expect(failureAlert(page, language, TARGET)).toBeVisible();
    await settle(page);

    await expectActivityKept(page, language, anchor, anchorTop);
  });
}

test("moved on, en: typing in Search, with the route still listed, keeps every keystroke and takes no focus", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  await wheelBy(page, -5_000);
  const search = searchField(page, "en");
  await pointerClick(page, search);
  await page.keyboard.type("Mo", { delay: 30 });
  await expect(page.locator("li.route-card")).toHaveCount(1);
  const anchorTop = (await box(search)).top;
  await resetRecords(page);

  await releaseHold(page, true);
  await expect(failureAlert(page, "en", TARGET)).toBeVisible();
  await settle(page);

  await expectActivityKept(page, "en", search, anchorTop);
  expect.soft(await isFocused(search), "[behaviour] focus stays in Search").toBe(true);
  await page.keyboard.type("or");
  await expect(search).toHaveValue("Moor");
});

test("moved on, en: after a tap on blank space, a delayed failure takes no focus and moves nothing", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  const point = await blankPoint(page);
  await page.mouse.click(point.x, point.y);
  const anchor = await topAnchor(page);
  const anchorTop = (await box(anchor)).top;
  await resetRecords(page);

  await releaseHold(page, true);
  await expect(failureAlert(page, "en", TARGET)).toBeVisible();
  await settle(page);

  await expectActivityKept(page, "en", anchor, anchorTop);
});

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

for (const held of [false, true]) {
  test(`success, en, ${held ? "held" : "unheld"}: never an ordinary card, no page jump, focus repaired to the neighbour`, async ({
    page,
  }) => {
    await openRoutes(page, "en");
    await openDelete(page, "en");
    await observeCard(page, routeIdOf(TARGET));
    await resetRecords(page);

    await confirmDelete(page, "en", { held });
    if (held) {
      await expectToHold("still listed as Deleting…", async () =>
        dialogOf(page, "en", TARGET)
          .getByRole("button", { name: COPY.en.deleting, exact: true })
          .isVisible(),
      );
      await releaseHold(page, false);
    }
    await expect(cardById(page, TARGET)).toHaveCount(0);
    await settle(page);

    await expectNoOrdinaryCardState(page);
    await expectRepairedToNeighbour(page, { revealAllowed: true });
    expect(await storedRouteNames(page)).not.toContain(TARGET);
  });
}

test("success, de, 200% text: focus repaired to the neighbour, revealed by no more than the minimum", async ({
  page,
}) => {
  await openRoutes(page, "de", "200%");
  await openDelete(page, "de");
  await resetRecords(page);

  await confirmDelete(page, "de", { held: false });
  await expect(cardById(page, TARGET)).toHaveCount(0);
  await settle(page);

  await expectRepairedToNeighbour(page, { revealAllowed: true });
});

test("success, en: focus the rider moved to Search stays there, and nothing moves", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  await wheelBy(page, -5_000);
  const search = searchField(page, "en");
  await pointerClick(page, search);
  const anchorTop = (await box(search)).top;
  await resetRecords(page);

  await releaseHold(page, false);
  await expect(cardById(page, TARGET)).toHaveCount(0);
  await settle(page);

  expect.soft(await isFocused(search), "[behaviour] focus stays in Search").toBe(true);
  expect
    .soft((await box(search)).top, "[behaviour] the page did not move")
    .toBeCloseTo(anchorTop, 0);
  expect.soft(await focusCalls(page), "[behaviour] no focus moved").toEqual([]);
  expect
    .soft(await appScrolls(page), "[implementation] no deliberate scroll")
    .toEqual([]);
});

test("success, en: after a wheel scroll with focus still on the title, focus is repaired without scrolling back", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  await wheelBy(page, 240);
  await resetRecords(page);

  await releaseHold(page, false);
  await expect(cardById(page, TARGET)).toHaveCount(0);
  await settle(page);

  await expectRepairedToNeighbour(page, { revealAllowed: false });
});

test("success, en: after a tap on blank space, focus is left alone", async ({ page }) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  const point = await blankPoint(page);
  await page.mouse.click(point.x, point.y);
  const focusBefore = await focusedSummary(page);
  await resetRecords(page);

  await releaseHold(page, false);
  await expect(cardById(page, TARGET)).toHaveCount(0);
  await settle(page);

  expect.soft(await focusCalls(page), "[behaviour] no focus moved").toEqual([]);
  expect
    .soft(await focusedSummary(page), "[behaviour] focus unchanged")
    .toBe(focusBefore);
  expect
    .soft(await appScrolls(page), "[implementation] no deliberate scroll")
    .toEqual([]);
});

// ---------------------------------------------------------------------------
// Filtering while pending (option A)
// ---------------------------------------------------------------------------

for (const outcome of ["commit", "abort"] as const) {
  test(`filtering, en: Search hides the deleting route, then it ${outcome === "commit" ? "commits" : "fails"} — focus stays in Search${outcome === "abort" ? "; the route returns with its failure when the search is cleared, taking no focus" : ""}`, async ({
    page,
  }) => {
    await openRoutes(page, "en");
    await openDelete(page, "en");
    await confirmDelete(page, "en", { held: true });
    await wheelBy(page, -5_000);
    const search = searchField(page, "en");
    await pointerClick(page, search);
    await page.keyboard.type("Valley", { delay: 30 });
    await expect(cardById(page, TARGET)).toHaveCount(0);
    await resetRecords(page);

    await releaseHold(page, outcome === "abort");
    await settle(page);
    expect.soft(await isFocused(search), "[behaviour] focus stays in Search").toBe(true);
    // Hidden by the rider's own search, the outcome adds nothing to the
    // list: no message there, no focus move.
    await expectToHold("nothing is added to the list", async () => {
      return (await page.getByRole("alert").count()) === 0;
    });

    for (const key of Array.from("Valley", () => "Backspace")) {
      await page.keyboard.press(key);
    }
    await expect(search).toHaveValue("");
    await settle(page);
    if (outcome === "abort") {
      await expectTranslatedFailure(page, "en");
      expect(await storedRouteNames(page)).toContain(TARGET);
    } else {
      await expect(cardById(page, TARGET)).toHaveCount(0);
      expect(await storedRouteNames(page)).not.toContain(TARGET);
    }
    expect
      .soft(
        await isFocused(search),
        "[behaviour] every Backspace reached Search, which keeps focus",
      )
      .toBe(true);
    expect.soft(await focusCalls(page), "[behaviour] no focus moved").toEqual([]);
    expect
      .soft(await appScrolls(page), "[implementation] no deliberate scroll")
      .toEqual([]);
  });
}

test("filtering, de: a tag filter hides the deleting route, it fails, and removing the filter brings back its failed confirmation without taking focus", async ({
  page,
}) => {
  await openRoutes(page, "de");
  await openDelete(page, "de");
  await confirmDelete(page, "de", { held: true });
  await wheelBy(page, -5_000);
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY.de.filterByTags, exact: true }),
  );
  const chip = page
    .getByRole("group", { name: COPY.de.filterByTags })
    .getByRole("button", { name: new RegExp(`^${TAG}`) });
  await expect(chip).toBeVisible();
  await pointerClick(page, chip);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(cardById(page, TARGET)).toHaveCount(0);
  await resetRecords(page);

  await releaseHold(page, true);
  await settle(page);
  await expectToHold("nothing is added to the list", async () => {
    return (await page.getByRole("alert").count()) === 0;
  });
  expect.soft(await isFocused(chip), "[behaviour] focus stays on the chip").toBe(true);

  // Deselected with a real key press on the focused chip.
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await settle(page);
  await expectTranslatedFailure(page, "de");
  expect.soft(await isFocused(chip), "[behaviour] focus stays on the chip").toBe(true);
  expect.soft(await focusCalls(page), "[behaviour] no focus moved").toEqual([]);
  expect
    .soft(await appScrolls(page), "[implementation] no deliberate scroll")
    .toEqual([]);
  expect(await storedRouteNames(page)).toContain(TARGET);
});

// ---------------------------------------------------------------------------
// Navigation while pending
// ---------------------------------------------------------------------------

test("navigation, en: leaving Routes while the deletion runs and returning shows it still Deleting…, actions unavailable, no focus taken; it leaves once committed", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  await navButton(page, COPY.en.settings).click();
  await expect(cardById(page, TARGET)).toHaveCount(0);
  await resetRecords(page);

  await navButton(page, COPY.en.routes).click();
  const dialog = dialogOf(page, "en", TARGET);
  await expect(dialog.getByRole("button", { name: COPY.en.deleting })).toBeDisabled();
  for (const name of [
    TARGET,
    COPY.en.rename,
    COPY.en.addTags,
    COPY.en.export,
    COPY.en.delete,
  ]) {
    await expect(
      cardById(page, TARGET).getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  }
  expect.soft(await focusCalls(page), "[behaviour] no focus moved on return").toEqual([]);
  expect
    .soft(
      await isFocused(navButton(page, COPY.en.routes)),
      "[behaviour] focus stays on the tab",
    )
    .toBe(true);

  await releaseHold(page, false);
  await expect(cardById(page, TARGET)).toHaveCount(0);
  expect
    .soft(await focusCalls(page), "[behaviour] no focus moved on removal")
    .toEqual([]);
  expect(await storedRouteNames(page)).not.toContain(TARGET);
});

test("navigation, en: returning after the list's cache has gone waits on Loading routes…, and a failure then shows the failed confirmation without focus", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  await navButton(page, COPY.en.settings).click();
  await page.waitForTimeout(3_600);
  await resetRecords(page);

  await navButton(page, COPY.en.routes).click();
  await expect(page.getByText(COPY.en.loading)).toBeVisible();

  await releaseHold(page, true);
  await expectTranslatedFailure(page, "en");
  expect.soft(await focusCalls(page), "[behaviour] no focus moved").toEqual([]);
  expect
    .soft(
      await isFocused(navButton(page, COPY.en.routes)),
      "[behaviour] focus stays on the tab",
    )
    .toBe(true);
});

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

test("retry, en: after moving on, a retry while waiting restores Cancel afresh, and a successful retry removes the route and its message", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  await wheelBy(page, 120);
  await releaseHold(page, true);
  await expectTranslatedFailure(page, "en");
  const cancel = dialogOf(page, "en", TARGET).getByRole("button", {
    name: COPY.en.cancel,
    exact: true,
  });
  expect
    .soft(await isFocused(cancel), "[behaviour] the first attempt took no focus")
    .toBe(false);

  await placeNearBandBottom(
    page,
    dialogOf(page, "en", TARGET).locator(".route-delete-confirm-actions"),
    20,
  );
  await setFault(page, "faultDelete", true);
  await resetRecords(page);
  await confirmDelete(page, "en", { held: false });
  await settle(page);
  expect
    .soft(
      await isFocused(cancel),
      "[behaviour] the retry, still waiting, restored Cancel",
    )
    .toBe(true);

  await setFault(page, "faultDelete", false);
  await confirmDelete(page, "en", { held: false });
  await expect(cardById(page, TARGET)).toHaveCount(0);
  await expect(page.getByText(COPY.en.failed)).toHaveCount(0);
  expect(await storedRouteNames(page)).not.toContain(TARGET);
});

// ---------------------------------------------------------------------------
// Refused actions while pending
// ---------------------------------------------------------------------------

test("refused, en: while the deletion runs, the card's own actions do nothing, Manage tags explains, another Delete opens nothing, and a second press deletes nothing more", async ({
  page,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  const target = cardById(page, TARGET);

  for (const name of [
    TARGET,
    COPY.en.rename,
    COPY.en.addTags,
    COPY.en.export,
    COPY.en.delete,
    COPY.en.pin(TARGET),
    COPY.en.deleting,
  ]) {
    await target.getByRole("button", { name, exact: true }).dispatchEvent("click");
  }
  await expectToHold("the deleting card is unchanged", async () => {
    return (
      (await page.getByRole("heading", { level: 1, name: COPY.en.routes }).isVisible()) &&
      (await target.getByLabel("Route name").count()) === 0 &&
      (await target.getByLabel("Add a tag").count()) === 0 &&
      (await target.getByRole("dialog").count()) === 1
    );
  });
  expect(await deletes(page), "one delete only").toBe(1);

  await wheelBy(page, -5_000);
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY.en.manageTags, exact: true }),
  );
  await expect(page.getByText(COPY.en.busyDeleting)).toBeVisible();

  const other = cardById(page, OTHER).locator(".route-list-item-actions > .btn-danger");
  await other.dispatchEvent("click");
  await expect(page.getByRole("dialog")).toHaveCount(1);

  await releaseHold(page, false);
  await expect(target).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Another page, and a failing live query
// ---------------------------------------------------------------------------

test("another page, en: a route deleted elsewhere while ours is pending, and ours then fails, leaves the list with no message", async ({
  page,
  context,
}) => {
  await openRoutes(page, "en");
  const other = await context.newPage();
  await installLocalMapStyle(other);
  await other.goto("/");
  await expect(cardById(other, TARGET)).toBeVisible();
  await openDelete(page, "en");
  await openDelete(other, "en");

  await confirmDelete(page, "en", { held: true });
  // The other page's own delete queues behind ours.
  await pointerClick(
    other,
    dialogOf(other, "en", TARGET).getByRole("button", { name: COPY.en.deleteRoute }),
  );
  await releaseHold(page, true);

  await expect(cardById(page, TARGET)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await storedRouteNames(page)).not.toContain(TARGET);
  await other.close();
});

test("another page, en: a route deleted elsewhere after ours failed leaves the list, and its failed confirmation with it", async ({
  page,
  context,
}) => {
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await setFault(page, "faultDelete", true);
  await confirmDelete(page, "en", { held: false });
  await expectTranslatedFailure(page, "en");

  const other = await context.newPage();
  await installLocalMapStyle(other);
  await other.goto("/");
  await openDelete(other, "en");
  await pointerClick(
    other,
    dialogOf(other, "en", TARGET).getByRole("button", { name: COPY.en.deleteRoute }),
  );
  await expect(cardById(other, TARGET)).toHaveCount(0);

  await expect(cardById(page, TARGET)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await other.close();
});

test("characterisation, en: when the list's re-read fails after a commit, the card stays a disabled Deleting… and the list stays busy until reload", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await openRoutes(page, "en");
  await openDelete(page, "en");
  await confirmDelete(page, "en", { held: true });
  await setFault(page, "faultReads", true);

  await releaseHold(page, false);
  await expect
    .poll(async () => (await storedRouteNames(page)).includes(TARGET))
    .toBe(false);

  // Committed in storage, but the list never re-read: the card fails safe.
  await expectToHold("still a disabled Deleting…", async () =>
    dialogOf(page, "en", TARGET)
      .getByRole("button", { name: COPY.en.deleting, exact: true })
      .isDisabled(),
  );
  await expect(
    cardById(page, OTHER).getByRole("button", { name: COPY.en.pin(OTHER), exact: true }),
  ).toBeDisabled();
  await wheelBy(page, -5_000);
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY.en.manageTags, exact: true }),
  );
  await expect(page.getByText(COPY.en.busyDeleting)).toBeVisible();
  expect(pageErrors).toEqual([]);

  await setFault(page, "faultReads", false);
  await page.reload();
  await expect(page.locator("li.route-card")).toHaveCount(ROUTE_NAMES.length - 1);
  await expect(cardById(page, TARGET)).toHaveCount(0);
});
