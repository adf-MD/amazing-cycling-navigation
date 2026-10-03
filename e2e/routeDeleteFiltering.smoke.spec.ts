import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readSavedRouteId } from "./support/rideStateDb.ts";

// Backlog item 124, slice 3 (inventory D-03), in both engines (this file
// runs under the "chromium" and "webkit-smoke" projects): when the search
// or a tag filter hides a route whose Delete confirmation is open but not
// yet confirmed, that confirmation is dismissed — quietly, with no focus
// moved and nothing scrolled — and stays closed when the route returns,
// so the rider's typing keeps reaching the search field. Sorting or
// pinning, which never hides the route, leaves it open.
//
// Real input throughout: the mouse at measured centres (each first proved
// inside the usable band and on top there), the keyboard for typing, and
// a real wheel for scrolling — never Playwright's actionability scroll for
// anything under test. The one exception is the sort control, a native
// <select> whose popup cannot be driven by the pointer in a headless
// engine: its change is made with selectOption, a synthetic step, and
// labelled as such.
//
// Not covered here: a confirmed deletion still running when its route is
// hidden (which must continue normally), and a failed confirmed deletion
// (whose confirmation and error must be kept). This comment used to say a
// Dexie write could not be held open or made to fail in a browser; it can
// — a test-owned readwrite transaction on the store holds it, and aborting
// the app's queued transaction fails it — and both cases, by search and by
// tag filter, are in e2e/routeDeleteFailure.smoke.spec.ts (backlog item
// 124, D-02), with RouteLibrary.test.tsx holding them on real IndexedDB
// transactions too. Desktop engines have no software keyboard, so the
// iPhone keyboard closing is not reproduced: this proves where focus and
// keystrokes go.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const GAP = 8;
const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
// Imported in this order; the library lists the most recent first, so the
// target is the second card from the top.
const ROUTE_NAMES = [
  "Alpine Climb",
  "Coastal Ride",
  "Forest Loop",
  "Harbour Run",
  "Lakeside Spin",
  "Moor Crossing",
  "River Path",
  "Valley Tour",
];
const TARGET = "River Path";
const SEARCH = "Valley";

async function importRoutes(page: Page): Promise<void> {
  const gpx = await readFile(FIXTURE_GPX_PATH, "utf-8");
  for (const name of ROUTE_NAMES) {
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${name}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(gpx),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

function card(name: string): string {
  return `li.route-card:has(.route-card-title:text-is("${name}"))`;
}

async function cardSelector(page: Page, name: string): Promise<string> {
  const id = await page
    .locator("li.route-card", {
      has: page.getByRole("button", { name, exact: true }),
    })
    .getAttribute("data-route-id");
  if (!id) throw new Error(`expected ${name}'s route id`);
  return `li[data-route-id="${id}"]`;
}

/** Records the vertical deltas the application itself asks window.scrollBy
 * for; the browser's own focus scrolling never goes through it. */
async function recordDeliberateScrolls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as {
      __acnScrollBy?: number[];
      __acnPatched?: boolean;
    };
    holder.__acnScrollBy = [];
    if (holder.__acnPatched === true) return;
    holder.__acnPatched = true;
    const original: (options?: ScrollToOptions) => void = window.scrollBy.bind(window);
    window.scrollBy = (options?: ScrollToOptions) => {
      holder.__acnScrollBy?.push(options?.top ?? 0);
      original(options);
    };
  });
}

function deliberateScrolls(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as { __acnScrollBy?: number[] }).__acnScrollBy ?? [],
  );
}

/** Waits until scrollY has held still for a run of timer-driven samples
 * (not animation frames, which headless WebKit can defer). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = window.scrollY;
        let stable = 0;
        const tick = () => {
          const now = window.scrollY;
          stable = now === last ? stable + 1 : 0;
          last = now;
          if (stable >= 6) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        setTimeout(tick, 25);
      }),
  );
}

/** A real mouse press at the control's measured centre, which must be
 * inside the usable band and the topmost element there. */
async function pointerPress(page: Page, selector: string): Promise<void> {
  const point = await page.evaluate(
    ({ selector, gap }) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`expected ${selector}`);
      const r = node.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const header = document.querySelector("header.app-header--sticky");
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      const vv = window.visualViewport;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        inBand: y > headerBottom + gap / 2 && y < visibleBottom - gap / 2,
        onTop: hit !== null && (hit === node || node.contains(hit)),
      };
    },
    { selector, gap: GAP },
  );
  expect(point.inBand, `${selector}: pressable inside the band`).toBe(true);
  expect(point.onTop, `${selector}: topmost at its centre`).toBe(true);
  await page.mouse.click(point.x, point.y);
}

/** A real wheel back to the top of the page, over the route list. */
async function wheelToTop(page: Page): Promise<void> {
  await page.mouse.move(195, 600);
  await page.mouse.wheel(0, -5_000);
  await settle(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

/** Tags the located element so the in-page helpers above, which use
 * document.querySelector, can find it. */
async function mark(locator: ReturnType<Page["locator"]>, key: string): Promise<string> {
  await locator.evaluate((node, key) => {
    node.setAttribute("data-e2e", key);
  }, key);
  return `[data-e2e="${key}"]`;
}

function isFocused(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    (selector) => document.activeElement === document.querySelector(selector),
    selector,
  );
}

async function openDeleteFor(page: Page, target: string): Promise<void> {
  await pointerPress(page, `${target} .route-list-item-actions > button.btn-danger`);
  await expect(page.locator(`${target} [role="dialog"]`)).toHaveCount(1);
  await expect(page.locator(`${target} [role="dialog"] .btn-secondary`)).toBeFocused();
  await settle(page);
}

async function expectAllRoutesStored(page: Page): Promise<void> {
  for (const name of ROUTE_NAMES) {
    expect(await readSavedRouteId(page, name), name).not.toBeNull();
  }
}

test("a search that hides the route dismisses its open Delete; the route returns closed, and every keystroke keeps reaching the search field", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installLocalMapStyle(page);
  await page.goto("/");
  await importRoutes(page);
  const target = await cardSelector(page, TARGET);
  const SEARCH_INPUT = await mark(page.getByLabel("Search routes"), "search");

  await openDeleteFor(page, target);
  await wheelToTop(page);
  await pointerPress(page, SEARCH_INPUT);
  expect(await isFocused(page, SEARCH_INPUT)).toBe(true);
  await recordDeliberateScrolls(page);

  // Typed one key at a time; the route is hidden part-way through.
  await page.keyboard.type(SEARCH, { delay: 30 });
  await expect(page.locator(SEARCH_INPUT)).toHaveValue(SEARCH);
  await expect(page.locator(card(TARGET))).toHaveCount(0);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  expect(await isFocused(page, SEARCH_INPUT)).toBe(true);

  // Deleted one key at a time; the route returns part-way through. Were its
  // confirmation still pending, its remount would take focus to Cancel and
  // the remaining Backspaces would never reach the field.
  for (const key of Array.from(SEARCH, () => "Backspace")) {
    await page.keyboard.press(key);
  }
  await expect(page.locator(SEARCH_INPUT)).toHaveValue("");
  await expect(page.locator(card(TARGET))).toHaveCount(1);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  expect(await isFocused(page, SEARCH_INPUT)).toBe(true);

  // Further typing still lands in the search field.
  await page.keyboard.type("Riv");
  await expect(page.locator(SEARCH_INPUT)).toHaveValue("Riv");
  await expect(page.locator(".route-card-title")).toHaveText([TARGET]);
  await settle(page);
  expect(await deliberateScrolls(page), "nothing scrolled deliberately").toEqual([]);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expectAllRoutesStored(page);
});

test("a tag filter that hides the route dismisses its open Delete; it returns closed and focus stays on the chip", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installLocalMapStyle(page);
  await page.goto("/");
  await importRoutes(page);

  // "Valley Tour" — not the target — carries the only tag.
  await page
    .locator(card("Valley Tour"))
    .getByRole("button", { name: "Add tags", exact: true })
    .click();
  const tagInput = page.getByLabel("Add a tag");
  await tagInput.fill("Weekend");
  await tagInput.press("Enter");
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    page.locator(card("Valley Tour")).getByRole("button", { name: "Edit tags" }),
  ).toBeVisible();
  await wheelToTop(page);

  // Delete first, then back up to the filters — opening the chooser
  // pushes the list down, below the window in WebKit's metrics.
  const target = await cardSelector(page, TARGET);
  await openDeleteFor(page, target);
  await wheelToTop(page);
  await pointerPress(
    page,
    await mark(
      page.getByRole("button", { name: "Filter by tags", exact: true }),
      "filters",
    ),
  );
  const chip = page
    .getByRole("group", { name: "Filter by tags" })
    .getByRole("button", { name: /^Weekend/ });
  await expect(chip).toBeVisible();
  const chipSelector = await mark(chip, "chip");
  await expect(page.locator(`${target} [role="dialog"]`)).toHaveCount(1);
  await recordDeliberateScrolls(page);

  await pointerPress(page, chipSelector);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(card(TARGET))).toHaveCount(0);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  expect(await isFocused(page, chipSelector)).toBe(true);

  // Deselected with a real key press on the focused chip.
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(card(TARGET))).toHaveCount(1);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  expect(await isFocused(page, chipSelector)).toBe(true);
  await settle(page);
  expect(await deliberateScrolls(page), "nothing scrolled deliberately").toEqual([]);
  await expectAllRoutesStored(page);
});

test("sorting and pinning, which never hide the route, leave its Delete confirmation open", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installLocalMapStyle(page);
  await page.goto("/");
  await importRoutes(page);
  const target = await cardSelector(page, TARGET);
  const dialog = page.locator(`${target} [role="dialog"]`);

  await openDeleteFor(page, target);

  // Synthetic step: a native <select>'s popup cannot be driven by the
  // pointer here, so its change is made directly.
  await page.getByLabel("Sort by").selectOption("name-asc");
  await expect(page.locator(".route-card-title").first()).toHaveText("Alpine Climb");
  await expect(dialog).toHaveCount(1);

  await wheelToTop(page);
  await pointerPress(
    page,
    await mark(
      page.getByRole("button", { name: "Pin Alpine Climb", exact: true }),
      "pin",
    ),
  );
  await expect(
    page
      .locator(card("Alpine Climb"))
      .getByRole("button", { name: "Unpin Alpine Climb" }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(1);
  await expectAllRoutesStored(page);
});

test("after its route has been hidden and returned, Delete opens again with slice 1's minimal reveal", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installLocalMapStyle(page);
  await page.goto("/");
  await importRoutes(page);
  const target = await cardSelector(page, TARGET);

  const SEARCH_INPUT = await mark(page.getByLabel("Search routes"), "search");

  await openDeleteFor(page, target);
  await wheelToTop(page);
  await pointerPress(page, SEARCH_INPUT);
  await page.keyboard.type(SEARCH);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  for (const key of Array.from(SEARCH, () => "Backspace")) {
    await page.keyboard.press(key);
  }
  await expect(page.locator(card(TARGET))).toHaveCount(1);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);

  // Delete placed just inside the band's bottom, so the confirmation that
  // opens below it needs revealing.
  await page.evaluate(
    ({ trigger, gap }) => {
      const node = document.querySelector(trigger);
      if (!node) throw new Error(`expected ${trigger}`);
      const vv = window.visualViewport;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const r = node.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r.top - (visibleBottom - gap - r.height - 4));
    },
    { trigger: `${target} .route-list-item-actions > button.btn-danger`, gap: GAP },
  );
  await settle(page);
  await recordDeliberateScrolls(page);
  await openDeleteFor(page, target);
  const geometry = await page.evaluate(
    ({ dialog, gap }) => {
      const header = document.querySelector("header.app-header--sticky");
      const vv = window.visualViewport;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const r = document.querySelector(dialog)?.getBoundingClientRect();
      return {
        top: r?.top ?? 0,
        bottom: r?.bottom ?? 0,
        bandTop: (header?.getBoundingClientRect().bottom ?? 0) + gap,
        bandBottom: visibleBottom - gap,
      };
    },
    { dialog: `${target} [role="dialog"]`, gap: GAP },
  );
  const deltas = await deliberateScrolls(page);
  expect(deltas, "one minimal reveal").toHaveLength(1);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.bandTop - 1);
  expect(Math.abs(geometry.bottom - geometry.bandBottom)).toBeLessThanOrEqual(1.5);
  await expectAllRoutesStored(page);
});
