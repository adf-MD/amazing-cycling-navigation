import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 100 stage 3: the Route Library tag-filter control. Own
// local helpers, per this project's established no-shared-e2e-helpers-
// across-specs convention (see routeLibraryTags.spec.ts).

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

async function openTagEditor(
  page: Page,
  routeName: string,
  label: "Add tags" | "Edit tags" = "Add tags",
) {
  await getListItemForName(page, routeName)
    .getByRole("button", { name: label, exact: true })
    .click();
}

async function tagRoute(page: Page, routeName: string, tag: string) {
  await openTagEditor(page, routeName);
  const tagInput = page.getByLabel("Add a tag");
  await tagInput.fill(tag);
  await tagInput.press("Enter");
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, routeName).getByRole("button", { name: "Edit tags" }),
  ).toBeVisible();
}

function visibleCardTitles(page: Page) {
  return page.locator(".route-card-title").allInnerTexts();
}

// Scopes a filter-chip lookup to the "Filter by tags" region, since an
// open card editor's own suggestion button can share the same accessible
// name as a filter chip.
/** Expands the filter chooser if collapsed. Backlog item 106 made it a
 * disclosure that starts closed, and opening it also closes an idle
 * manager, so ordering matters where both are involved. */
async function expandTagFilters(page: Page) {
  const disclosure = page.getByRole("button", { name: "Filter by tags", exact: true });
  if ((await disclosure.getAttribute("aria-expanded")) === "true") return;
  await disclosure.click();
  await expect(page.getByRole("group", { name: "Filter by tags" })).toBeVisible();
}

function getTagFilterButton(page: Page, name: string) {
  return page
    .getByRole("group", { name: "Filter by tags" })
    .getByRole("button", { name, exact: true });
}

test("importing, tagging, filtering (AND semantics), combining with search, clearing, pin/sort preservation, route-open/return restoration and safe edit-caused disappearance", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");

  // Padding routes so the list genuinely scrolls at 390x844, for a real
  // route-open/return scroll-restoration proof below.
  for (let index = 0; index < 6; index += 1) {
    await importRoute(page, `Padding Route ${String(index)}`);
  }
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Coastal Ride");
  await importRoute(page, "Both Peaks");
  await importRoute(page, "Zebra Loop");

  await tagRoute(page, "Alpine Climb", "Gravel");
  await tagRoute(page, "Coastal Ride", "Weekend");
  await tagRoute(page, "Both Peaks", "Gravel");
  await openTagEditor(page, "Both Peaks", "Edit tags");
  await getListItemForName(page, "Both Peaks")
    .getByRole("button", { name: "Weekend", exact: true })
    .click();
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(getListItemForName(page, "Both Peaks").getByText("Weekend")).toBeVisible();

  // Pin a padding route, and tag it "Gravel" too — a pinned route that
  // does NOT match the active filter must still be hidden by it (already
  // proven in the unit suite), so this route needs the tag to correctly
  // demonstrate pin priority surviving filtering below.
  await getListItemForName(page, "Padding Route 0")
    .getByRole("button", { name: "Pin Padding Route 0", exact: true })
    .click();
  await expect(
    getListItemForName(page, "Padding Route 0").getByRole("button", {
      name: "Unpin Padding Route 0",
    }),
  ).toBeVisible();
  await tagRoute(page, "Padding Route 0", "Gravel");
  await page.getByLabel("Sort by").selectOption("name-asc");

  // Selecting one tag narrows to the single list of matching routes.
  // "Padding Route 0" matches too and, being pinned, sorts first.
  await expandTagFilters(page);
  await getTagFilterButton(page, "Gravel").click();
  await expect
    .poll(() => visibleCardTitles(page))
    .toEqual(["Padding Route 0", "Alpine Climb", "Both Peaks"]);

  // Adding a second selected tag applies AND semantics, not OR.
  await getTagFilterButton(page, "Weekend").click();
  await expect.poll(() => visibleCardTitles(page)).toEqual(["Both Peaks"]);
  await expect(getTagFilterButton(page, "Gravel")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(getTagFilterButton(page, "Weekend")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // A name query composes with the active tag filters as an intersection.
  await page.getByLabel("Search routes").fill("Alpine");
  await expect(
    page.getByText("No routes match “Alpine” and the selected tags."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();

  // Clear tag filters restores the full (unfiltered) list without
  // touching search.
  await page.getByRole("button", { name: "Clear tag filters", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear tag filters" })).toHaveCount(0);
  await expect.poll(() => visibleCardTitles(page)).toContain("Zebra Loop");

  // Re-select the AND combination and confirm pin priority and the
  // selected sort order both survive filtering.
  await getTagFilterButton(page, "Gravel").click();
  await getTagFilterButton(page, "Weekend").click();
  await expect.poll(() => visibleCardTitles(page)).toEqual(["Both Peaks"]);
  await getTagFilterButton(page, "Weekend").click(); // toggle off, back to Gravel-only
  await expect
    .poll(() => visibleCardTitles(page))
    .toEqual(["Padding Route 0", "Alpine Climb", "Both Peaks"]); // pinned first, then name-asc

  // Open a matching route far down the filtered list and return: the
  // tag-filter selection, search text and scroll position all restore.
  const cards = page.locator(".route-list > li");
  const lastCard = cards.last();
  await lastCard.scrollIntoViewIfNeeded();
  const scrollYBeforeOpen = await page.evaluate(() => window.scrollY);
  const lastCardName = await lastCard.locator(".route-card-title").innerText();
  await lastCard.locator(".route-card-title").click();
  await expect(page.getByRole("heading", { name: lastCardName })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.getByRole("button", { name: "Routes" }).click();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  // Backlog item 106: the chooser itself comes back collapsed (a fresh
  // RouteLibrary mount), but the selection is restored and still filtering
  // — visible without expanding anything, via the count and Clear row.
  await expect(page.getByText("1 filter active")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear tag filters" })).toBeVisible();
  // Scroll restoration is asserted BEFORE expanding: clicking the
  // disclosure scrolls it into view, and it sits near the top of the page.
  // The target is the saved offset clamped to what the document can
  // actually reach — the filter chooser now returns collapsed (item 106),
  // so the page is genuinely shorter than when the offset was captured,
  // and the browser clamps the restore accordingly. Computed from the live
  // document rather than hard-coded, so it stays honest if the layout
  // changes again.
  await expect
    .poll(() =>
      page.evaluate((saved) => {
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - document.documentElement.clientHeight,
        );
        return window.scrollY === Math.min(saved, maxScroll);
      }, scrollYBeforeOpen),
    )
    .toBe(true);
  await expandTagFilters(page);
  await expect(getTagFilterButton(page, "Gravel")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(getTagFilterButton(page, "Weekend")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Editing away the currently-filtered-on tag drops the route out of
  // the active result without trapping the save or losing focus to
  // <body>.
  await openTagEditor(page, "Alpine Climb", "Edit tags");
  await getListItemForName(page, "Alpine Climb")
    .getByRole("button", { name: "Gravel", exact: true })
    .click();
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(getListItemForName(page, "Alpine Climb")).toHaveCount(0);
  const activeElementTag = await page.evaluate(
    () => document.activeElement?.tagName ?? null,
  );
  expect(activeElementTag).not.toBe("BODY");
  // Backlog item 100 follow-up: the card-reveal-after-save mechanism must
  // never act on a route that has disappeared from the filtered result —
  // its own render-time success signal structurally can't fire for a
  // component that unmounts instead of re-rendering with the new tags.
  // Deliberately no scrollY assertion here: RouteLibrary's own established
  // fallback-focus target (asserted above and below) may legitimately
  // cause its own native focus-scroll — this only proves the reveal
  // mechanism itself never fires alongside it.
  expect(consoleErrors).toEqual([]);

  // A full reload persists the saved tags but resets the transient
  // tag-filter selection, matching the existing name-search contract.
  await page.reload();
  await expect(page.getByRole("button", { name: "Clear tag filters" })).toHaveCount(0);
  await expect(page.getByText(/filters? active/)).toHaveCount(0);
  await expandTagFilters(page);
  await expect(getTagFilterButton(page, "Gravel")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(
    getListItemForName(page, "Coastal Ride").getByText("Weekend"),
  ).toBeVisible();
  await expect(getListItemForName(page, "Both Peaks").getByText("Gravel")).toBeVisible();
  await expect(getListItemForName(page, "Both Peaks").getByText("Weekend")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

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

async function seedFilterableRoutes(page: Page) {
  await page.goto("/");
  await importRoute(page, "A very long multi word route name for wrapping");
  await tagRoute(
    page,
    "A very long multi word route name for wrapping",
    "A rather long descriptive tag for wrap testing",
  );
}

test.describe("tag-filter region geometry and accessibility (item 100 stage 3)", () => {
  test.describe("200% text at ordinary phone width", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the filter region, its chips and Clear action stay contained, with every interactive control at least 44x44, and long tag labels wrap", async ({
      page,
    }) => {
      await seedFilterableRoutes(page);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });

      const viewportWidth = page.viewportSize()?.width;
      if (viewportWidth === undefined) throw new Error("expected a viewport width");

      await expandTagFilters(page);
      const region = page.getByRole("group", { name: "Filter by tags" });
      await expectContainedWithinViewport(region, viewportWidth);
      const chip = region.getByRole("button").first();
      await expectContainedWithinViewport(chip, viewportWidth);
      await expectAtLeastTouchTarget(chip);

      await chip.click();
      const clearButton = page.getByRole("button", { name: "Clear tag filters" });
      await expectContainedWithinViewport(clearButton, viewportWidth);
      await expectAtLeastTouchTarget(clearButton);

      // A whole-document overflow check here would also trip on this app
      // shell's own pre-existing, unrelated primary-navigation overflow
      // at 200% text (see routeLibraryTags.spec.ts's own identical
      // comment) — the scoped containment checks above are what this
      // item actually governs.
    });
  });

  test.describe("844x390 short landscape", () => {
    test.use({ viewport: { width: 844, height: 390 } });

    test("the filter region and its controls stay contained and reachable", async ({
      page,
    }) => {
      await seedFilterableRoutes(page);

      await expandTagFilters(page);
      const region = page.getByRole("group", { name: "Filter by tags" });
      await expectContainedWithinViewport(region, 844);
      const chip = region.getByRole("button").first();
      await expectAtLeastTouchTarget(chip);

      await chip.focus();
      await expect(chip).toBeFocused();
    });
  });
});

// Backlog item 106's third strand, proven by real geometry rather than a
// screenshot: the installed-iPhone screenshot showed "Manage tags"
// floating beside the much taller filter block (both were siblings in one
// vertically-centred toolbar .row), and every unselected chip label sitting
// optically off-centre because an empty check-mark slot occupied real
// space to its left.
test.describe("tag-control layout (item 106)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const ALIGNMENT_TOLERANCE_PX = 2;

  async function seedTaggedRoutes(page: Page) {
    await page.goto("/");
    await importRoute(page, "Alpine Climb");
    await importRoute(page, "Zebra Loop");
    await tagRoute(page, "Alpine Climb", "Gravel");
    await tagRoute(page, "Zebra Loop", "Weekend");
  }

  test("presents Filter by tags and Manage tags as aligned peer disclosures in one row", async ({
    page,
  }) => {
    await seedTaggedRoutes(page);

    const filter = page.getByRole("button", { name: "Filter by tags", exact: true });
    const manage = page.getByRole("button", { name: "Manage tags", exact: true });
    await expect(filter).toBeVisible();
    await expect(manage).toBeVisible();

    const filterBox = await filter.boundingBox();
    const manageBox = await manage.boundingBox();
    if (!filterBox || !manageBox)
      throw new Error("expected both disclosures to be laid out");

    // Peers on one line: same top edge and same height, which the old
    // "short button vertically centred against a tall block" arrangement
    // could not satisfy.
    expect(Math.abs(filterBox.y - manageBox.y)).toBeLessThanOrEqual(
      ALIGNMENT_TOLERANCE_PX,
    );
    expect(Math.abs(filterBox.height - manageBox.height)).toBeLessThanOrEqual(
      ALIGNMENT_TOLERANCE_PX,
    );
    expect(filterBox.height).toBeGreaterThanOrEqual(44);
    expect(manageBox.height).toBeGreaterThanOrEqual(44);

    // Genuine siblings in one container, not scattered through the toolbar.
    const shareRow = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const byText = (label: string) =>
        buttons.find((button) => button.textContent.trim().startsWith(label)) ?? null;
      const filterButton = byText("Filter by tags");
      const manageButton = byText("Manage tags");
      if (!filterButton || !manageButton) return false;
      return filterButton.parentElement === manageButton.parentElement;
    });
    expect(shareRow).toBe(true);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("centres an unselected chip's label, and keeps the chip's width unchanged when it is toggled", async ({
    page,
  }) => {
    await seedTaggedRoutes(page);
    await expandTagFilters(page);

    const chip = getTagFilterButton(page, "Gravel");
    await expect(chip).toHaveAttribute("aria-pressed", "false");

    const measure = async () =>
      page.evaluate(() => {
        const chips = Array.from(document.querySelectorAll(".tag-filter-chip"));
        const target = chips.find(
          (element) =>
            element.querySelector(".tag-filter-label")?.textContent.trim() === "Gravel",
        );
        const label = target?.querySelector(".tag-filter-label");
        if (!target || !label) return null;
        const chipRect = target.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        return {
          chipCentre: chipRect.left + chipRect.width / 2,
          labelCentre: labelRect.left + labelRect.width / 2,
          width: chipRect.width,
        };
      });

    const unselected = await measure();
    if (!unselected) throw new Error("expected the Gravel chip and its label");
    // The defect this replaces offset the label by roughly half of
    // (1em + gap) — several CSS pixels — because the empty check slot sat
    // in flow to its left.
    expect(Math.abs(unselected.labelCentre - unselected.chipCentre)).toBeLessThanOrEqual(
      ALIGNMENT_TOLERANCE_PX,
    );

    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const selected = await measure();
    if (!selected) throw new Error("expected the Gravel chip after selection");
    // Reserving the slot symmetrically rather than removing it means the
    // chip never changes width as it is toggled, so the wrapped rows never
    // reflow under the finger that just tapped one.
    expect(Math.abs(selected.width - unselected.width)).toBeLessThanOrEqual(
      ALIGNMENT_TOLERANCE_PX,
    );
    expect(Math.abs(selected.labelCentre - selected.chipCentre)).toBeLessThanOrEqual(
      ALIGNMENT_TOLERANCE_PX,
    );
  });

  test("keeps the active count and Clear visible while collapsed, and still filters", async ({
    page,
  }) => {
    await seedTaggedRoutes(page);
    await expandTagFilters(page);
    await getTagFilterButton(page, "Gravel").click();
    const filteredTitles = await visibleCardTitles(page);

    await page.getByRole("button", { name: "Filter by tags", exact: true }).click();
    await expect(page.getByRole("group", { name: "Filter by tags" })).toHaveCount(0);
    await expect(page.getByText("1 filter active")).toBeVisible();
    const clear = page.getByRole("button", { name: "Clear tag filters", exact: true });
    await expect(clear).toBeVisible();
    const clearBox = await clear.boundingBox();
    if (!clearBox) throw new Error("expected Clear to be laid out");
    expect(clearBox.height).toBeGreaterThanOrEqual(44);

    // Collapsed filtering is still filtering.
    expect(await visibleCardTitles(page)).toEqual(filteredTitles);

    await clear.click();
    await expect(page.getByText("1 filter active")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Filter by tags", exact: true }),
    ).toBeFocused();
  });
});
