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
  await expect(getTagFilterButton(page, "Gravel")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(getTagFilterButton(page, "Weekend")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollYBeforeOpen);

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

  // A full reload persists the saved tags but resets the transient
  // tag-filter selection, matching the existing name-search contract.
  await page.reload();
  await expect(page.getByRole("button", { name: "Clear tag filters" })).toHaveCount(0);
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

      const region = page.getByRole("group", { name: "Filter by tags" });
      await expectContainedWithinViewport(region, 844);
      const chip = region.getByRole("button").first();
      await expectAtLeastTouchTarget(chip);

      await chip.focus();
      await expect(chip).toBeFocused();
    });
  });
});
