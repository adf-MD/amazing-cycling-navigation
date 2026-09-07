import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

// Item 99: distinct synthetic fixtures so distance and total-ascent sorting
// are genuinely discriminating in the real app, unlike every other route in
// this spec (all imported from the one identical smoke-route.gpx). The
// no-elevation fixture carries track points with no <ele> tag at all — a
// real, non-falsified way to reach ascentMetres: null through the
// production import pipeline (GPX behaviour: "Handle missing elevation
// explicitly. Do not invent elevation silently.").
const SHORT_FLAT_GPX_PATH = fileURLToPath(
  new URL("./fixtures/sort-short-flat-route.gpx", import.meta.url),
);
const NO_ELEVATION_GPX_PATH = fileURLToPath(
  new URL("./fixtures/sort-no-elevation-route.gpx", import.meta.url),
);
const LONG_HILLY_GPX_PATH = fileURLToPath(
  new URL("./fixtures/sort-long-hilly-route.gpx", import.meta.url),
);

test.use({ viewport: { width: 390, height: 844 } });

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// routeLibraryScroll.spec.ts/layout.spec.ts/planning.spec.ts, which need
// the same workaround.
test.use({ serviceWorkers: "block" });

async function importRoute(page: Page, name: string, gpxPath: string = FIXTURE_GPX_PATH) {
  const gpxContents = await readFile(gpxPath, "utf-8");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpxContents),
  });
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

async function importManyRoutes(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) {
    await importRoute(page, `Route ${String(i).padStart(2, "0")}`);
  }
}

function visibleCardTitles(page: Page) {
  return page.locator(".route-card-title").allInnerTexts();
}

function routeCard(page: Page, routeName: string) {
  return page
    .locator("li.route-card")
    .filter({ has: page.getByRole("button", { name: routeName, exact: true }) });
}

async function routeCardMetaText(page: Page, routeName: string): Promise<string> {
  return routeCard(page, routeName).locator(".route-card-meta").innerText();
}

/** Parses the rendered "X.X km · Y m ascent" / "X.X km · ascent not
 * available" card summary (formatDistanceKm/formatAscent's own output
 * shapes) back into numbers, so a test can assert on the actual canonical
 * values the production importer produced rather than a hand-predicted
 * geometry/smoothing outcome. */
function parseRouteMeta(text: string): {
  distanceKm: number;
  ascentMetres: number | null;
} {
  const match = /^(\d+\.\d) km · (.+)$/.exec(text);
  if (!match) throw new Error(`Unexpected route card meta text: ${text}`);
  const [, distanceText, ascentText] = match;
  if (ascentText === "ascent not available") {
    return { distanceKm: Number(distanceText), ascentMetres: null };
  }
  const ascentMatch = /^(\d+) m ascent$/.exec(ascentText);
  if (!ascentMatch) throw new Error(`Unexpected ascent text: ${ascentText}`);
  return { distanceKm: Number(distanceText), ascentMetres: Number(ascentMatch[1]) };
}

test("shows Most recent by default; search filters by substring; Name A-Z reorders; reload keeps sort but clears search; clearing search restores the full alphabetical list; no horizontal overflow", async ({
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
  // Imported in an order where recency (import order) and alphabetical
  // order genuinely differ, so the two sort modes are distinguishable.
  await importRoute(page, "Zebra Loop");
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Mid Ride");

  await expect(page.locator(".route-list > li")).toHaveCount(3);
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Mid Ride",
      "Alpine Climb",
      "Zebra Loop",
    ]);
  }).toPass();

  const search = page.getByLabel("Search routes");
  await search.fill("alpine");
  await expect(page.locator(".route-list > li")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Alpine Climb", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Sort by").selectOption("name-asc");
  // Still filtered to just Alpine Climb — switching sort must not clear
  // the active search.
  await expect(page.locator(".route-list > li")).toHaveCount(1);

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(page.locator(".route-list > li")).toHaveCount(3);
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Alpine Climb",
      "Mid Ride",
      "Zebra Loop",
    ]);
  }).toPass();

  await page.reload();

  await expect(page.getByLabel("Search routes")).toHaveValue("");
  await expect(page.getByLabel("Sort by")).toHaveValue("name-asc");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Alpine Climb",
      "Mid Ride",
      "Zebra Loop",
    ]);
  }).toPass();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test("opening a filtered, sorted, lower route shows Riding from the top; returning restores the search, sort and scroll position", async ({
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
  await importManyRoutes(page, 20);

  await page.getByLabel("Sort by").selectOption("name-asc");
  const search = page.getByLabel("Search routes");
  await search.fill("route");
  await expect(page.locator(".route-list > li")).toHaveCount(20);

  const cards = page.locator(".route-list > li");
  const lastCard = cards.last();
  await lastCard.scrollIntoViewIfNeeded();

  const scrollYBeforeOpen = await page.evaluate(() => window.scrollY);
  expect(scrollYBeforeOpen).toBeGreaterThan(0);

  const lastCardName = await lastCard.locator(".route-card-title").innerText();
  expect(lastCardName).toBe("Route 19"); // alphabetically last under name-asc

  await lastCard.locator(".route-card-title").click();

  await expect(page.getByRole("heading", { name: lastCardName })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.getByRole("button", { name: "Routes" }).click();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  await expect(page.getByLabel("Search routes")).toHaveValue("route");
  await expect(page.getByLabel("Sort by")).toHaveValue("name-asc");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollYBeforeOpen);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the sort select exposes exactly four choices, distance and total-ascent sorting order correctly with unknown ascent sorting last, search stays active through a sort change, the sort select stays focused, and the choice survives reload (item 99 follow-up)", async ({
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
  await importRoute(page, "Short Flat", SHORT_FLAT_GPX_PATH);
  await importRoute(page, "No Elevation", NO_ELEVATION_GPX_PATH);
  await importRoute(page, "Long Hilly", LONG_HILLY_GPX_PATH);

  // Verify the production importer actually produced the intended,
  // genuinely distinct canonical summaries — including a real
  // ascentMetres: null for the elevation-free import, not merely an
  // accidental 0 — BEFORE relying on any ordering assertion below. This
  // guards against an accidentally non-discriminating fixture.
  const shortMeta = parseRouteMeta(await routeCardMetaText(page, "Short Flat"));
  const noElevationMeta = parseRouteMeta(await routeCardMetaText(page, "No Elevation"));
  const longMeta = parseRouteMeta(await routeCardMetaText(page, "Long Hilly"));

  expect(shortMeta.distanceKm).toBeGreaterThan(0);
  expect(shortMeta.distanceKm).toBeLessThan(noElevationMeta.distanceKm);
  expect(noElevationMeta.distanceKm).toBeLessThan(longMeta.distanceKm);
  expect(shortMeta.ascentMetres).toBe(0);
  expect(noElevationMeta.ascentMetres).toBeNull();
  const longAscentMetres = longMeta.ascentMetres;
  if (longAscentMetres === null)
    throw new Error("expected Long Hilly to have a known ascent");
  expect(longAscentMetres).toBeGreaterThan(50);

  // The real, browser-rendered select exposes exactly the four agreed
  // choices, in order, with their final values and labels (item 99
  // follow-up: distance-asc/ascent-asc are retired).
  const sortOptionEntries = await page
    .locator("#route-library-sort option")
    .evaluateAll((options) =>
      options.map((option) => [(option as HTMLOptionElement).value, option.textContent]),
    );
  expect(sortOptionEntries).toEqual([
    ["most-recent", "Most recent"],
    ["name-asc", "Name A–Z"],
    ["distance-desc", "Longest route"],
    ["ascent-desc", "Most total ascent"],
  ]);

  await page.getByLabel("Sort by").selectOption("distance-desc");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Long Hilly",
      "No Elevation",
      "Short Flat",
    ]);
  }).toPass();

  // "No Elevation" (unknown ascent) sorts last even under descending order,
  // never reordered to the front.
  await page.getByLabel("Sort by").selectOption("ascent-desc");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Long Hilly",
      "Short Flat",
      "No Elevation",
    ]);
  }).toPass();

  // Search stays active through a sort change; clearing search restores
  // the full, correctly-sorted list.
  const search = page.getByLabel("Search routes");
  await search.fill("hilly");
  await expect(page.locator(".route-list > li")).toHaveCount(1);
  await page.getByLabel("Sort by").selectOption("distance-desc");
  await expect(page.locator(".route-list > li")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Long Hilly",
      "No Elevation",
      "Short Flat",
    ]);
  }).toPass();

  // The sort select stays focused through a reorder. Clicking first (a
  // genuine user gesture, unlike selectOption alone, which does not
  // reliably focus a native <select> in every browser engine) mirrors how
  // a rider actually operates this control.
  const sortSelect = page.getByLabel("Sort by");
  await sortSelect.click();
  await sortSelect.selectOption("distance-desc");
  await expect(sortSelect).toBeFocused();

  // A distance/ascent sort choice survives reload.
  await page.reload();
  await expect(page.getByLabel("Sort by")).toHaveValue("distance-desc");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Long Hilly",
      "No Elevation",
      "Short Flat",
    ]);
  }).toPass();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test.describe("four-option toolbar at enlarged text and short landscape (item 99 follow-up)", () => {
  async function seedThreeRoutes(page: Page) {
    await page.goto("/");
    await importRoute(page, "Short Flat", SHORT_FLAT_GPX_PATH);
    await importRoute(page, "No Elevation", NO_ELEVATION_GPX_PATH);
    await importRoute(page, "Long Hilly", LONG_HILLY_GPX_PATH);
    // Select a non-default sort so all four real options are the ones
    // actually rendered/measured, not merely present in markup.
    await page.getByLabel("Sort by").selectOption("ascent-desc");
  }

  /** This item's own contract is that "the toolbar and route cards remain
   * contained with no horizontal page overflow" — a whole-document
   * scrollWidth check would also trip on this app shell's own pre-existing,
   * unrelated primary-navigation overflow at 200% text (confirmed present
   * identically with the ORIGINAL two-option "Most recent" selected too,
   * so it is not caused by this item's longer labels, and fixing app-shell
   * navigation chrome is out of this item's scope — see item 103). Scoping
   * the check to the toolbar and card list directly tests what this item
   * actually governs, independent of that unrelated pre-existing gap. */
  async function expectContainedWithinViewport(
    locator: ReturnType<Page["locator"]>,
    viewportWidth: number,
  ) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("expected element to have a bounding box");
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
  }

  test.describe("200% text at ordinary phone width", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the Sort by control and route cards stay contained within the viewport", async ({
      page,
    }) => {
      await seedThreeRoutes(page);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });

      const sortSelect = page.getByLabel("Sort by");
      await expect(sortSelect).toBeVisible();
      const viewportWidth = page.viewportSize()?.width;
      if (viewportWidth === undefined) throw new Error("expected a viewport width");

      await expectContainedWithinViewport(sortSelect, viewportWidth);
      await expectContainedWithinViewport(page.locator(".route-list"), viewportWidth);
    });
  });

  test.describe("844x390 short landscape", () => {
    test.use({ viewport: { width: 844, height: 390 } });

    test("the Sort by control and route cards stay contained within the viewport", async ({
      page,
    }) => {
      await seedThreeRoutes(page);

      const sortSelect = page.getByLabel("Sort by");
      await expect(sortSelect).toBeVisible();

      await expectContainedWithinViewport(sortSelect, 844);
      await expectContainedWithinViewport(page.locator(".route-list"), 844);
    });
  });
});
