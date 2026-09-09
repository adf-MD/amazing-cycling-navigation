import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 100 stage 4A: the global tag lifecycle — rename, merge and
// delete a tag across every saved route from the Route Library's own
// "Manage tags" panel. Own local helpers, per this project's established
// no-shared-e2e-helpers-across-specs convention (see
// routeLibraryTags.spec.ts).
//
// NOT covered here, deliberately: the write-failure path. IndexedDB
// writes never pass through page.route(), so a rejected transaction
// cannot be injected from a Playwright test; that path (panel stays open,
// typed name retained, filters unchanged, accessible error, retry
// succeeds) is proven in RouteLibrary.tagManagement.test.tsx against the
// real repository instead.

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

test.use({ viewport: { width: 390, height: 844 } });
// Requests handled by the app's own service worker never reach
// page.route()'s interception — see routeLibraryPinning.spec.ts, which
// needs the same workaround.
test.use({ serviceWorkers: "block" });

async function importRoute(page: Page, name: string) {
  const gpxContents = await readFile(FIXTURE_GPX_PATH, "utf-8");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpxContents),
  });
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

// Matches a route's own <li> whether it's showing its ordinary card
// (title as a .route-card-title button) or its own open tag editor
// (title as a bare, class-less <h2>, per RouteListItem.tsx).
function getListItemForName(page: Page, name: string) {
  return page.locator(
    `li:has(.route-card-title:text-is("${name}")), li:has(h2:text-is("${name}"))`,
  );
}

async function tagRoute(page: Page, routeName: string, tag: string) {
  const card = getListItemForName(page, routeName);
  const addTags = card.getByRole("button", { name: "Add tags", exact: true });
  const editTags = card.getByRole("button", { name: "Edit tags", exact: true });
  if (await addTags.count()) {
    await addTags.click();
  } else {
    await editTags.click();
  }
  const tagInput = page.getByLabel("Add a tag");
  await tagInput.fill(tag);
  await tagInput.press("Enter");
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(editTags).toBeVisible();
}

function getManager(page: Page) {
  return page.getByRole("group", { name: "Manage tags" });
}

function getTagFilterButton(page: Page, name: string) {
  return page
    .getByRole("group", { name: "Filter by tags" })
    .getByRole("button", { name, exact: true });
}

async function openManager(page: Page) {
  await page.getByRole("button", { name: "Manage tags", exact: true }).click();
  await expect(getManager(page)).toBeVisible();
}

async function chooseTag(page: Page, optionLabel: string) {
  await getManager(page).getByLabel("Tag to manage").selectOption({ label: optionLabel });
}

function visibleCardTitles(page: Page) {
  return page.locator(".route-card-title").allInnerTexts();
}

/** Mirrors routeLibraryTags.spec.ts's own geometry convention: real
 * bounding boxes, never screenshots, and never a bare non-null assertion
 * (@typescript-eslint/no-non-null-assertion is an error in this repo). */
async function expectAtLeastTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("expected element to have a bounding box");
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function expectContainedWithinViewport(locator: Locator, viewportWidth: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("expected element to have a bounding box");
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
}

test("renaming, merging and deleting a tag globally, with filter reconciliation, persistence and a final-tag empty state", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  // This journey opens a route at the end, so the map's style request is
  // served locally rather than from the live tile provider.
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Zebra Loop");
  await importRoute(page, "Coastal Spin");
  await tagRoute(page, "Alpine Climb", "Gravel");
  await tagRoute(page, "Alpine Climb", "Road");
  await tagRoute(page, "Zebra Loop", "Gravel");
  await tagRoute(page, "Coastal Spin", "Road");

  // Counts come from the whole corpus, not the currently filtered view.
  await getTagFilterButton(page, "Gravel").click();
  await expect(page.getByRole("button", { name: "Coastal Spin" })).toBeHidden();
  await openManager(page);
  await expect(
    getManager(page).getByRole("option", { name: "Gravel (2 routes)" }),
  ).toBeAttached();
  await expect(
    getManager(page).getByRole("option", { name: "Road (2 routes)" }),
  ).toBeAttached();

  // A plain rename applies at once, and the active filter follows the tag.
  await chooseTag(page, "Gravel (2 routes)");
  await getManager(page).getByLabel("New name").fill("Trail");
  await getManager(page).getByRole("button", { name: "Rename tag", exact: true }).click();

  await expect(page.getByText("Renamed “Gravel” to “Trail” on 2 routes.")).toBeVisible();
  await expect(getTagFilterButton(page, "Trail")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: "Filter by tags" }).getByRole("button", {
      name: "Gravel",
      exact: true,
    }),
  ).toHaveCount(0);
  // Both halves matter: losing the selection instead of following it would
  // show every route, which a visibility-only check would happily accept.
  expect(await visibleCardTitles(page)).toEqual(["Zebra Loop", "Alpine Climb"]);
  await expect(getListItemForName(page, "Alpine Climb").getByText("Trail")).toBeVisible();

  // A reload proves the rename is genuinely persisted, not just in memory.
  await page.reload();
  await expect(getListItemForName(page, "Alpine Climb").getByText("Trail")).toBeVisible();
  await expect(getListItemForName(page, "Zebra Loop").getByText("Trail")).toBeVisible();

  // A merge into an existing tag needs an explicit confirmation, and the
  // route that carried both ends with exactly one tag.
  await openManager(page);
  await chooseTag(page, "Trail (2 routes)");
  await getManager(page).getByLabel("New name").fill("Road");
  await expect(
    getManager(page).getByText("Merge “Trail” into “Road” on 2 routes."),
  ).toBeVisible();
  await getManager(page).getByRole("button", { name: "Merge tags", exact: true }).click();
  const mergeDialog = page.getByRole("alertdialog");
  await expect(mergeDialog).toContainText("Merge “Trail” into “Road”?");
  await expect(mergeDialog).toContainText("2 routes");
  await expect(mergeDialog).toContainText("No route is deleted.");
  await mergeDialog.getByRole("button", { name: "Merge tags", exact: true }).click();

  await expect(page.getByText("Merged “Trail” into “Road” on 2 routes.")).toBeVisible();
  await expect(
    getListItemForName(page, "Alpine Climb").locator(".route-card-tag"),
  ).toHaveCount(1);
  await expect(getListItemForName(page, "Alpine Climb").getByText("Road")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Filter by tags" }).getByRole("button"),
  ).toHaveCount(1);

  // Deleting the last remaining tag leaves a coherent empty state with
  // every route still present and focus on a stable control.
  await getManager(page).getByRole("button", { name: "Delete tag", exact: true }).click();
  const deleteDialog = page.getByRole("alertdialog");
  await expect(deleteDialog).toContainText("Delete the tag “Road”?");
  await expect(deleteDialog).toContainText("routes themselves are not deleted");
  await deleteDialog.getByRole("button", { name: "Delete tag", exact: true }).click();

  await expect(
    page.getByRole("button", { name: "Manage tags", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Filter by tags" })).toHaveCount(0);
  await expect(getManager(page)).toHaveCount(0);
  expect(await visibleCardTitles(page)).toEqual([
    "Coastal Spin",
    "Zebra Loop",
    "Alpine Climb",
  ]);
  await expect(page.getByLabel("Search routes")).toBeFocused();
  await expect(page.locator(".route-card-tag")).toHaveCount(0);

  // Search, sorting, pinning and opening a route all still work.
  await page.getByLabel("Search routes").fill("Zebra");
  expect(await visibleCardTitles(page)).toEqual(["Zebra Loop"]);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByLabel("Sort by").selectOption({ label: "Name A–Z" });
  // The chosen order is persisted and read back through the preferences
  // live query, so it lands a round trip later, not on the change event.
  await expect
    .poll(() => visibleCardTitles(page))
    .toEqual(["Alpine Climb", "Coastal Spin", "Zebra Loop"]);
  await getListItemForName(page, "Zebra Loop")
    .getByRole("button", { name: /^Pin /, exact: false })
    .click();
  await expect.poll(async () => (await visibleCardTitles(page))[0]).toBe("Zebra Loop");
  await page.getByRole("button", { name: "Alpine Climb", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alpine Climb" })).toBeVisible();
  await page.getByRole("button", { name: "Routes" }).click();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("cancelling a confirmation, with Escape and with Cancel, changes nothing", async ({
  page,
}) => {
  await page.goto("/");
  await importRoute(page, "Alpine Climb");
  await tagRoute(page, "Alpine Climb", "Gravel");

  await openManager(page);
  await chooseTag(page, "Gravel (1 route)");
  await getManager(page).getByRole("button", { name: "Delete tag", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    getListItemForName(page, "Alpine Climb").getByText("Gravel"),
  ).toBeVisible();

  await getManager(page).getByRole("button", { name: "Delete tag", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    getManager(page).getByRole("button", { name: "Delete tag", exact: true }),
  ).toBeFocused();
  await expect(
    getListItemForName(page, "Alpine Climb").getByText("Gravel"),
  ).toBeVisible();
});

test("a deliberate case-only rename changes the spelling everywhere without creating a second tag", async ({
  page,
}) => {
  await page.goto("/");
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Zebra Loop");
  await tagRoute(page, "Alpine Climb", "gravel");
  await tagRoute(page, "Zebra Loop", "gravel");

  await openManager(page);
  await chooseTag(page, "gravel (2 routes)");
  await getManager(page).getByLabel("New name").fill("Gravel");
  await getManager(page).getByRole("button", { name: "Rename tag", exact: true }).click();

  await expect(page.getByText("Renamed “gravel” to “Gravel” on 2 routes.")).toBeVisible();
  await expect(
    getListItemForName(page, "Alpine Climb").getByText("Gravel"),
  ).toBeVisible();
  await expect(getListItemForName(page, "Zebra Loop").getByText("Gravel")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Filter by tags" }).getByRole("button"),
  ).toHaveCount(1);
});

test.describe("390x844 portrait at 200% text", () => {
  test("keeps the manager contained and every control touch-usable", async ({ page }) => {
    await page.goto("/");
    await importRoute(page, "Alpine Climb");
    await tagRoute(page, "Alpine Climb", "A deliberately long gravel tag name");

    await openManager(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const manager = getManager(page);
    await expectContainedWithinViewport(manager, 390);
    await expectContainedWithinViewport(manager.getByLabel("Tag to manage"), 390);
    await expectAtLeastTouchTarget(manager.getByLabel("Tag to manage"));
    await expectAtLeastTouchTarget(
      manager.getByRole("button", { name: "Rename tag", exact: true }),
    );
    await expectAtLeastTouchTarget(
      manager.getByRole("button", { name: "Delete tag", exact: true }),
    );
    await expectAtLeastTouchTarget(
      manager.getByRole("button", { name: "Close", exact: true }),
    );
    // A whole-document overflow check would also trip on this app shell's
    // own pre-existing, unrelated primary-navigation overflow at 200% text
    // (see routeLibrarySearchSort.spec.ts's item-99 note, deferred to item
    // 103) — the scoped containment checks above are what this item
    // actually governs.
  });
});

test.describe("844x390 short landscape", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("keeps the manager usable and contained", async ({ page }) => {
    await page.goto("/");
    await importRoute(page, "Alpine Climb");
    await tagRoute(page, "Alpine Climb", "Gravel");

    await openManager(page);
    await expectContainedWithinViewport(getManager(page), 844);
    await expectAtLeastTouchTarget(getManager(page).getByLabel("Tag to manage"));

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

/** Polls (never a fixed sleep) until window.scrollY has genuinely stopped
 * changing across several consecutive real animation frames. The reveal's
 * own scrollBy uses behavior:"smooth" unless reduced motion is requested,
 * so geometry read immediately after the action can otherwise be a
 * mid-animation snapshot — indistinguishable from no scroll at all. Copied
 * rather than shared, per this project's no-shared-e2e-helpers convention
 * (routeLibraryTags.spec.ts carries the same poll). */
async function waitForScrollToSettle(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              let stableFrames = 0;
              let lastY: number | null = null;
              const check = () => {
                const y = window.scrollY;
                stableFrames = lastY !== null && y === lastY ? stableFrames + 1 : 0;
                lastY = y;
                if (stableFrames >= 10) {
                  resolve(true);
                  return;
                }
                requestAnimationFrame(check);
              };
              requestAnimationFrame(check);
            }),
        ),
      { timeout: 5000 },
    )
    .toBe(true);
}

interface PanelGeometryBox {
  top: number;
  bottom: number;
}

interface PanelGeometry {
  header: PanelGeometryBox | null;
  panel: PanelGeometryBox | null;
  heading: PanelGeometryBox | null;
  visibleBottom: number;
  scrollX: number;
  scrollY: number;
}

/** Measures the sticky header, the Manage tags panel and its own heading
 * atomically in one evaluate() call, so nothing can shift between reads. */
async function measurePanelGeometry(page: Page): Promise<PanelGeometry> {
  return page.evaluate(() => {
    const toBox = (el: Element | null | undefined) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    const panel = document.querySelector(".tag-manager");
    const vv = window.visualViewport;
    return {
      header: toBox(document.querySelector("header.app-header--sticky")),
      panel: toBox(panel),
      heading: toBox(panel?.querySelector("h2")),
      visibleBottom: vv ? vv.offsetTop + vv.height : window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  });
}

const PANEL_REVEAL_TOLERANCE_PX = 2;

interface ScrollByCounterWindow extends Window {
  __acnScrollByCalls?: number;
  __acnScrollByPatched?: boolean;
}

/** Counts the application's OWN deliberate scrolls. Every reveal in this
 * feature goes through routeCardTopReveal.ts's single
 * `window.scrollBy({ top, left: 0, behavior })` call, while the browser's
 * native focus-scroll does not — so this separates "the app decided to
 * scroll" from "the view moved because focus moved", which a raw scrollY
 * comparison cannot. Resets the counter on each call. */
async function instrumentDeliberateScrolls(page: Page) {
  await page.evaluate(() => {
    const holder = window as ScrollByCounterWindow;
    holder.__acnScrollByCalls = 0;
    if (holder.__acnScrollByPatched === true) return;
    holder.__acnScrollByPatched = true;
    const original = window.scrollBy.bind(window);
    window.scrollBy = ((options?: ScrollToOptions) => {
      holder.__acnScrollByCalls = (holder.__acnScrollByCalls ?? 0) + 1;
      original(options);
    }) as typeof window.scrollBy;
  });
}

async function countDeliberateScrolls(page: Page): Promise<number> {
  return page.evaluate(() => (window as ScrollByCounterWindow).__acnScrollByCalls ?? 0);
}

/** Scrolls the window so the Manage tags panel's own top sits a given
 * distance ABOVE the sticky header's bottom edge — the state the installed
 * iPhone reaches when the on-screen keyboard shrinks the visual viewport
 * around a panel that was already near the top of a long list. Deliberately
 * a window scroll rather than relying on Playwright's own
 * scroll-into-view, which would be undone the moment a locator is clicked. */
async function scrollPanelTopAboveHeader(page: Page, overlapPx: number) {
  await page.evaluate((overlap) => {
    const header = document.querySelector("header.app-header--sticky");
    const panel = document.querySelector(".tag-manager");
    if (!header || !panel) throw new Error("expected a header and an open panel");
    const headerBottom = header.getBoundingClientRect().bottom;
    const panelTop = panel.getBoundingClientRect().top;
    window.scrollBy({
      top: panelTop - (headerBottom - overlap),
      left: 0,
      behavior: "auto",
    });
  }, overlapPx);
  await waitForScrollToSettle(page);
}

// Backlog item 105's second behaviour. A successful global operation leaves
// the panel open, so its own top/heading must be brought back below the
// sticky header. Every other transition through the same focus hand-off
// keeps 0.4.19's behaviour and must not scroll deliberately.
test.describe("Manage tags panel reveal (item 105)", () => {
  async function seedTwoTags(page: Page) {
    // No installLocalMapStyle here: these tests never open a route, so the
    // map is never mounted and no tile-provider request is ever made —
    // matching the other Route Library-only tests in this file.
    await page.goto("/");
    for (let i = 1; i <= 8; i++) {
      await importRoute(page, `Panel Filler ${String(i)}`);
    }
    await tagRoute(page, "Panel Filler 1", "Gravel");
    await tagRoute(page, "Panel Filler 2", "Gravel");
    await tagRoute(page, "Panel Filler 3", "Road");
  }

  test("a successful rename reveals the panel's top below the sticky header", async ({
    page,
  }) => {
    await seedTwoTags(page);
    await openManager(page);
    await chooseTag(page, "Gravel (2 routes)");
    await getManager(page).getByLabel("New name").fill("Trail");

    // Focus the action FIRST, then scroll, then activate by keyboard: a
    // locator click would scroll the button back into view and silently
    // undo the occlusion this test depends on.
    const rename = getManager(page).getByRole("button", { name: "Rename tag" });
    await rename.focus();
    await scrollPanelTopAboveHeader(page, 60);

    const before = await measurePanelGeometry(page);
    if (!before.header || !before.panel) {
      throw new Error("expected the header and panel to be measurable");
    }
    // The precondition the test rests on — fails loudly rather than
    // passing for the wrong reason if the layout ever changes.
    expect(before.panel.top).toBeLessThan(before.header.bottom);
    const scrollXBefore = before.scrollX;

    await instrumentDeliberateScrolls(page);
    await page.keyboard.press("Enter");
    await expect(getTagFilterButton(page, "Trail")).toBeVisible();
    await waitForScrollToSettle(page);

    const after = await measurePanelGeometry(page);
    if (!after.header || !after.panel || !after.heading) {
      throw new Error("expected the header, panel and heading to be measurable");
    }
    expect(after.panel.top).toBeGreaterThanOrEqual(
      after.header.bottom - PANEL_REVEAL_TOLERANCE_PX,
    );
    expect(after.heading.bottom).toBeLessThanOrEqual(
      after.visibleBottom + PANEL_REVEAL_TOLERANCE_PX,
    );
    // The post-success focus target is unchanged from 0.4.19.
    await expect(getManager(page).getByLabel("Tag to manage")).toBeFocused();
    expect(after.scrollX).toBe(scrollXBefore);
    // Exactly one deliberate scroll, and the positive control for the
    // instrumented counter used by the no-scroll test below: without this,
    // a counter that silently observed nothing would let that test pass
    // vacuously.
    expect(await countDeliberateScrolls(page)).toBe(1);
  });

  // The negative control for the test above: the same successful rename,
  // differing only in that the panel's top was already framed, must scroll
  // nothing. Without this, a reveal that fired unconditionally — or one
  // that scrolled for any reason at all — would look identical.
  test("performs no scroll when the panel's top is already framed", async ({ page }) => {
    await seedTwoTags(page);
    await openManager(page);
    await chooseTag(page, "Gravel (2 routes)");
    await getManager(page).getByLabel("New name").fill("Trail");
    await waitForScrollToSettle(page);

    const before = await measurePanelGeometry(page);
    if (!before.header || !before.panel) {
      throw new Error("expected the header and panel to be measurable");
    }
    expect(before.panel.top).toBeGreaterThanOrEqual(before.header.bottom);

    await getManager(page).getByRole("button", { name: "Rename tag" }).focus();
    await page.keyboard.press("Enter");
    await expect(getTagFilterButton(page, "Trail")).toBeVisible();
    await waitForScrollToSettle(page);

    const after = await measurePanelGeometry(page);
    expect(after.scrollY).toBe(before.scrollY);
  });

  test("never scrolls deliberately when a confirmation is cancelled or the panel is closed", async ({
    page,
  }) => {
    await seedTwoTags(page);
    await openManager(page);
    await chooseTag(page, "Gravel (2 routes)");
    const deleteTag = getManager(page).getByRole("button", { name: "Delete tag" });
    await deleteTag.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await waitForScrollToSettle(page);

    // Escape rather than a Cancel click: dismissing by keyboard needs no
    // scroll-into-view, so any movement observed would be the application's
    // own doing rather than Playwright's.
    await instrumentDeliberateScrolls(page);
    const beforeCancel = await measurePanelGeometry(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(deleteTag).toBeFocused();
    await waitForScrollToSettle(page);
    expect((await measurePanelGeometry(page)).scrollY).toBe(beforeCancel.scrollY);
    expect(await countDeliberateScrolls(page)).toBe(0);

    // Closing the panel is deliberately NOT asserted on raw scrollY. Focus
    // returns to the "Manage tags" button, which sits well above the panel,
    // and the browser's own focus-scroll legitimately brings it into view —
    // that IS "where the viewport naturally ends after the panel closes".
    // What must not happen is a deliberate scroll of the application's own,
    // and native focus-scroll never goes through window.scrollBy, so the
    // instrumented count is what discriminates the two.
    await instrumentDeliberateScrolls(page);
    await getManager(page).getByRole("button", { name: "Close" }).focus();
    await page.keyboard.press("Enter");
    await expect(getManager(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Manage tags" })).toBeFocused();
    await waitForScrollToSettle(page);
    expect(await countDeliberateScrolls(page)).toBe(0);
  });
});
