import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

test.use({ viewport: { width: 390, height: 844 } });

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// routeLibraryScroll.spec.ts/layout.spec.ts/planning.spec.ts, which need
// the same workaround.
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

async function importManyRoutes(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) {
    await importRoute(page, `Route ${String(i).padStart(2, "0")}`);
  }
}

function visibleCardTitles(page: Page) {
  return page.locator(".route-card-title").allInnerTexts();
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
