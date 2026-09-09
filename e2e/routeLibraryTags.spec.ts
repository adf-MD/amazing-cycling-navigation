import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Backlog item 100 stage 2: the compact tag editor and reusable
// suggestions. Own local helpers, per this project's established
// no-shared-e2e-helpers-across-specs convention.

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

test.use({ viewport: { width: 390, height: 844 } });
// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// routeLibraryPinning.spec.ts, which needs the same workaround.
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
// (title as a bare, class-less <h2>, per RouteListItem.tsx) — item 100
// stage 3's own "Filter by tags" chips share suggestion names, so a
// suggestion click must stay scoped to the specific editor it's open in.
function getListItemForName(page: Page, name: string) {
  return page.locator(
    `li:has(.route-card-title:text-is("${name}")), li:has(h2:text-is("${name}"))`,
  );
}

async function openTagEditor(
  page: Page,
  routeName: string,
  label: "Add tags" | "Edit tags" = "Add tags",
) {
  await getListItemForName(page, routeName)
    .getByRole("button", { name: label, exact: true })
    .click();
}

function visibleCardTitles(page: Page) {
  return page.locator(".route-card-title").allInnerTexts();
}

/** Imports a target route, then enough filler routes (most-recent sort
 * pushes the target below the fold) and enough short tags (added but not
 * yet saved) that the reappearing ordinary card, once saved, is genuinely
 * taller than the visible band between the sticky header and the visible
 * viewport — backlog item 100's card-reveal-after-save follow-up. Leaves
 * the target's tag editor open with the draft tags added, unsaved. */
async function importRouteWithManyTags(
  page: Page,
  targetName: string,
  fillerCount: number,
  tagCount: number,
) {
  await importRoute(page, targetName);
  for (let i = 1; i <= fillerCount; i++) {
    await importRoute(page, `Reveal Filler ${String(i)}`);
  }
  await openTagEditor(page, targetName);
  const tagInput = page.getByLabel("Add a tag");
  for (let i = 1; i <= tagCount; i++) {
    await tagInput.fill(`tag-${String(i).padStart(3, "0")}`);
    await tagInput.press("Enter");
  }
}

interface RevealGeometryBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface RevealGeometry {
  header: RevealGeometryBox | null;
  card: RevealGeometryBox | null;
  title: RevealGeometryBox | null;
  button: RevealGeometryBox | null;
  visibleTop: number;
  visibleBottom: number;
  scrollX: number;
  scrollWidth: number;
  clientWidth: number;
}

/** Measures the sticky header, the target card, its title and its "Edit
 * tags" button atomically in one evaluate() call — mirrors
 * rideSessionSwitchGuard.spec.ts's own item-95 geometry convention, so
 * nothing can shift/scroll between reads. */
async function measureRevealGeometry(
  page: Page,
  targetName: string,
): Promise<RevealGeometry> {
  return page.evaluate((name) => {
    const toBox = (el: Element | null | undefined) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    };
    const header = document.querySelector("header.app-header--sticky");
    const items = Array.from(document.querySelectorAll("li[data-route-id]"));
    const li = items.find(
      (el) => el.querySelector(".route-card-title, h2")?.textContent.trim() === name,
    );
    const title = li?.querySelector(".route-card-title");
    const button = Array.from(li?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent.trim() === "Edit tags",
    );
    const vv = window.visualViewport;
    return {
      header: toBox(header),
      card: toBox(li),
      title: toBox(title),
      button: toBox(button),
      visibleTop: vv?.offsetTop ?? 0,
      visibleBottom: vv ? vv.offsetTop + vv.height : window.innerHeight,
      scrollX: window.scrollX,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  }, targetName);
}

/** A small, documented pixel tolerance for the reveal geometry assertions
 * below — sub-pixel layout rounding, not a meaningful placement error. */
const REVEAL_TOLERANCE_PX = 2;

/** Polls (never a fixed sleep) until window.scrollY has genuinely stopped
 * changing across several consecutive real animation frames — the reveal's
 * own scrollBy call uses behavior:"smooth" unless reduced motion is
 * requested, so geometry read immediately after the click can otherwise be
 * a mid-animation snapshot. Mirrors rideSessionSwitchGuard.spec.ts's own
 * item-95 "poll until scrollY has genuinely stopped changing" convention. */
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

test("adding, reusing, deduplicating and removing tags through the real tag editor persists across reload without disturbing search, pin or sort", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto("/");
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Zebra Loop");

  // Pin one route first, so the pin/sort-unaffected assertion below has
  // something real to check against.
  await getListItemForName(page, "Zebra Loop")
    .getByRole("button", { name: "Pin Zebra Loop", exact: true })
    .click();
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual(["Zebra Loop", "Alpine Climb"]);
  }).toPass();
  const orderBeforeTagging = await visibleCardTitles(page);

  // Add two tags, one multi-word, to Alpine Climb and save.
  await openTagEditor(page, "Alpine Climb");
  const tagInput = page.getByLabel("Add a tag");
  await tagInput.fill("Gravel");
  await page.getByRole("button", { name: "Add tag", exact: true }).click();
  await tagInput.fill("Weekend ride");
  await tagInput.press("Enter");
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, "Alpine Climb").getByRole("button", { name: "Edit tags" }),
  ).toBeVisible();
  await expect(
    getListItemForName(page, "Alpine Climb").getByText("Gravel"),
  ).toBeVisible();
  await expect(
    getListItemForName(page, "Alpine Climb").getByText("Weekend ride"),
  ).toBeVisible();

  // Open Zebra Loop's editor and select the "Gravel" suggestion. Scoped
  // to Zebra Loop's own editor: item 100 stage 3 adds a "Filter by tags"
  // chip of the same name once any route carries "Gravel".
  await openTagEditor(page, "Zebra Loop");
  const zebraLoopItem = getListItemForName(page, "Zebra Loop");
  await expect(
    zebraLoopItem.getByRole("button", { name: "Gravel", exact: true }),
  ).toBeVisible();
  await zebraLoopItem.getByRole("button", { name: "Gravel", exact: true }).click();

  // Typing a casing/whitespace variant of an existing suggestion must not
  // create a duplicate identity — it must adopt the established spelling.
  await tagInput.fill("  gravel  ");
  await tagInput.press("Enter");
  await expect(
    zebraLoopItem.getByRole("button", { name: "Gravel", exact: true }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, "Zebra Loop").getByRole("button", { name: "Edit tags" }),
  ).toBeVisible();
  await expect(getListItemForName(page, "Zebra Loop").getByText("Gravel")).toBeVisible();

  // Reload: both cards retain their intended tags.
  await page.reload();
  await expect(
    getListItemForName(page, "Alpine Climb").getByText("Gravel"),
  ).toBeVisible();
  await expect(
    getListItemForName(page, "Alpine Climb").getByText("Weekend ride"),
  ).toBeVisible();
  await expect(getListItemForName(page, "Zebra Loop").getByText("Gravel")).toBeVisible();

  // Remove a tag from Alpine Climb and save an empty collection — its
  // last remaining tag stays intact until explicitly toggled off too.
  // Scoped to Alpine Climb's own editor: both "Weekend ride" and
  // "Gravel" are also, by now, established filter chips of the same name.
  await openTagEditor(page, "Alpine Climb", "Edit tags");
  const alpineClimbItem = getListItemForName(page, "Alpine Climb");
  await alpineClimbItem
    .getByRole("button", { name: "Weekend ride", exact: true })
    .click();
  await alpineClimbItem.getByRole("button", { name: "Gravel", exact: true }).click();
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, "Alpine Climb").getByRole("button", { name: "Add tags" }),
  ).toBeVisible();
  await expect(getListItemForName(page, "Alpine Climb").getByText("Gravel")).toBeHidden();

  // Search remains name-only: a term matching only a tag finds nothing.
  await page.getByLabel("Search routes").fill("Gravel");
  await expect(page.getByText("No routes match")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();

  // Pin/sort order is exactly as before all the tag activity above.
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual(orderBeforeTagging);
  }).toPass();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test("a successful Save tags reveals the card's top and title below the sticky header, not just the focused button (item 100 follow-up)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto("/");
  await importRouteWithManyTags(page, "Reveal Target Route", 10, 100);

  const scrollXBefore = await page.evaluate(() => window.scrollX);
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, "Reveal Target Route").getByRole("button", {
      name: "Edit tags",
    }),
  ).toBeVisible();
  await waitForScrollToSettle(page);

  const geometry = await measureRevealGeometry(page, "Reveal Target Route");
  if (!geometry.header || !geometry.card || !geometry.title || !geometry.button) {
    throw new Error("expected header, card, title and button to all be measurable");
  }

  // The card is taller than the visible band (100 tags), so only its top
  // and title are guaranteed — never its bottom, which is the whole point
  // of top-prioritisation over the browser's own button-only native scroll.
  expect(geometry.title.top).toBeGreaterThanOrEqual(
    geometry.header.bottom - REVEAL_TOLERANCE_PX,
  );
  expect(geometry.title.bottom).toBeLessThanOrEqual(
    geometry.visibleBottom + REVEAL_TOLERANCE_PX,
  );
  expect(geometry.card.top).toBeGreaterThanOrEqual(
    geometry.header.bottom - REVEAL_TOLERANCE_PX,
  );
  await expect(
    getListItemForName(page, "Reveal Target Route").getByRole("button", {
      name: "Edit tags",
    }),
  ).toBeFocused();
  expect(geometry.scrollX).toBe(scrollXBefore);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);

  expect(consoleErrors).toEqual([]);
});

test("does not scroll the page when the card is already visible before saving tags (item 100 follow-up)", async ({
  page,
}) => {
  await page.goto("/");
  await importRoute(page, "Already Visible Route");
  await openTagEditor(page, "Already Visible Route");
  await page.getByLabel("Add a tag").fill("Gravel");
  await page.getByRole("button", { name: "Add tag", exact: true }).click();

  const scrollYBefore = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, "Already Visible Route").getByRole("button", {
      name: "Edit tags",
    }),
  ).toBeVisible();

  const scrollYAfter = await page.evaluate(() => window.scrollY);
  expect(scrollYAfter).toBe(scrollYBefore);
});

test("Cancel discards the draft, returns focus to the tags button, and leaves it comfortably visible without a forced reveal (item 100 follow-up)", async ({
  page,
}) => {
  await page.goto("/");
  await importRouteWithManyTags(page, "Cancel Target Route", 10, 100);

  // Deliberately no scrollY assertion here: native focus-scroll (kept
  // unchanged for Cancel) may legitimately make its own small adjustment —
  // only draft-discard, correct focus and comfortable visibility are the
  // contract for this path.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const item = getListItemForName(page, "Cancel Target Route");
  await expect(item.getByRole("button", { name: "Add tags" })).toBeVisible();
  await expect(item.getByRole("button", { name: "Add tags" })).toBeFocused();
  expect(await item.locator(".route-card-tags").count()).toBe(0);

  const buttonBox = await item.getByRole("button", { name: "Add tags" }).boundingBox();
  if (!buttonBox) throw new Error("expected the Add tags button to have a bounding box");
  const viewportSize = page.viewportSize();
  if (!viewportSize) throw new Error("expected a viewport size");
  expect(buttonBox.y).toBeGreaterThanOrEqual(0);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(viewportSize.height);
});

/** This item's own contract is that the tag editor stays fully contained
 * and every interactive tag control meets the shared 44x44 touch-target
 * minimum — checked via real bounding boxes, not screenshots. Mirrors
 * routeLibrarySearchSort.spec.ts's own item-99-follow-up geometry
 * convention. */
async function expectContainedWithinViewport(
  locator: ReturnType<Page["locator"]>,
  viewportWidth: number,
) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("expected element to have a bounding box");
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
}

async function expectAtLeastTouchTarget(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("expected element to have a bounding box");
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function seedOneTaggedRoute(page: Page) {
  await page.goto("/");
  await importRoute(page, "A very long multi word route name for wrapping");
  await openTagEditor(page, "A very long multi word route name for wrapping");
  await page
    .getByLabel("Add a tag")
    .fill("A rather long descriptive tag for wrap testing");
  await page.getByRole("button", { name: "Add tag", exact: true }).click();
}

test.describe("tag editor geometry and accessibility (item 100 stage 2)", () => {
  test.describe("200% text at ordinary phone width", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the open editor, its controls and the card stay contained, with every interactive tag control at least 44x44", async ({
      page,
    }) => {
      await seedOneTaggedRoute(page);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });

      const viewportWidth = page.viewportSize()?.width;
      if (viewportWidth === undefined) throw new Error("expected a viewport width");

      await expectContainedWithinViewport(page.locator(".tag-editor"), viewportWidth);
      await expectContainedWithinViewport(page.getByLabel("Add a tag"), viewportWidth);
      const suggestionButton = page.locator(".tag-suggestion").first();
      await expectContainedWithinViewport(suggestionButton, viewportWidth);
      await expectAtLeastTouchTarget(suggestionButton);
      await expectAtLeastTouchTarget(
        page.getByRole("button", { name: "Add tag", exact: true }),
      );
      await expectAtLeastTouchTarget(
        page.getByRole("button", { name: "Save tags", exact: true }),
      );
      await expectAtLeastTouchTarget(page.getByRole("button", { name: "Cancel" }));

      // A whole-document overflow check here would also trip on this app
      // shell's own pre-existing, unrelated primary-navigation overflow at
      // 200% text (confirmed present identically with no tag editor open at
      // all — see routeLibrarySearchSort.spec.ts's own item-99-follow-up
      // comment) — the scoped containment checks above are what this item
      // actually governs.
    });

    test("a successful Save tags still reveals the card's top and title below the sticky header (item 100 follow-up)", async ({
      page,
    }) => {
      await page.goto("/");
      await importRouteWithManyTags(page, "Reveal Target Route", 10, 40);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });

      await page.getByRole("button", { name: "Save tags", exact: true }).click();
      await expect(
        getListItemForName(page, "Reveal Target Route").getByRole("button", {
          name: "Edit tags",
        }),
      ).toBeVisible();
      await waitForScrollToSettle(page);

      const geometry = await measureRevealGeometry(page, "Reveal Target Route");
      if (!geometry.header || !geometry.title) {
        throw new Error("expected the header and title to both be measurable");
      }
      expect(geometry.title.top).toBeGreaterThanOrEqual(
        geometry.header.bottom - REVEAL_TOLERANCE_PX,
      );
      expect(geometry.title.bottom).toBeLessThanOrEqual(
        geometry.visibleBottom + REVEAL_TOLERANCE_PX,
      );
    });
  });

  test.describe("844x390 short landscape", () => {
    test.use({ viewport: { width: 844, height: 390 } });

    test("the open editor and its controls stay contained and reachable", async ({
      page,
    }) => {
      await seedOneTaggedRoute(page);

      await expectContainedWithinViewport(page.locator(".tag-editor"), 844);
      const suggestionButton = page.locator(".tag-suggestion").first();
      await expectAtLeastTouchTarget(suggestionButton);
      await expectAtLeastTouchTarget(
        page.getByRole("button", { name: "Save tags", exact: true }),
      );

      await suggestionButton.focus();
      await expect(suggestionButton).toBeFocused();
    });

    test("a successful Save tags still reveals the card's top and title below the sticky header (item 100 follow-up)", async ({
      page,
    }) => {
      await page.goto("/");
      await importRouteWithManyTags(page, "Reveal Target Route", 10, 40);

      await page.getByRole("button", { name: "Save tags", exact: true }).click();
      await expect(
        getListItemForName(page, "Reveal Target Route").getByRole("button", {
          name: "Edit tags",
        }),
      ).toBeVisible();
      await waitForScrollToSettle(page);

      const geometry = await measureRevealGeometry(page, "Reveal Target Route");
      if (!geometry.header || !geometry.title) {
        throw new Error("expected the header and title to both be measurable");
      }
      expect(geometry.title.top).toBeGreaterThanOrEqual(
        geometry.header.bottom - REVEAL_TOLERANCE_PX,
      );
      expect(geometry.title.bottom).toBeLessThanOrEqual(
        geometry.visibleBottom + REVEAL_TOLERANCE_PX,
      );
    });
  });
});
