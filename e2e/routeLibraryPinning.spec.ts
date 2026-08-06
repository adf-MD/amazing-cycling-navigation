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
// routeLibraryScroll.spec.ts/routeLibrarySearchSort.spec.ts, which need the
// same workaround.
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

// Route cards render in one continuous document order — the Pinned group's
// <ul> always precedes Other routes' <ul> when both are present — so this
// single helper's return order already reflects the combined
// pinned-then-unpinned contract, without needing a separate per-group
// locator.
function visibleCardTitles(page: Page) {
  return page.locator(".route-card-title").allInnerTexts();
}

function groupHeadings(page: Page) {
  return page.locator("h2").allInnerTexts();
}

/**
 * Pins a route and waits for the UI to genuinely reflect the write
 * (aria-pressed flips) before returning. Used between two pin actions
 * instead of a blind delay: this forces one real IndexedDB write + live-
 * query refresh + re-render to complete first, which reliably takes more
 * than a millisecond, so a second pinnedAt timestamp is guaranteed to
 * differ without ever asserting on wall-clock timing directly.
 */
async function pinAndWait(page: Page, name: string) {
  await page.getByRole("button", { name: `Pin ${name}`, exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Unpin ${name}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
}

async function unpinAndWait(page: Page, name: string) {
  await page.getByRole("button", { name: `Unpin ${name}`, exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Pin ${name}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
}

test("pinning creates a Pinned group above unpinned routes, orders newest-pinned-first, sort affects only Other routes, search filters both groups, and reload preserves pin state and order", async ({
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
  // Imported oldest -> newest: Mountain Pass, Alpine Climb, Zebra Loop.
  await importRoute(page, "Mountain Pass");
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Zebra Loop");

  // Initial Most recent order, no pins yet.
  await expect(groupHeadings(page)).resolves.toEqual([]);
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Zebra Loop",
      "Alpine Climb",
      "Mountain Pass",
    ]);
  }).toPass();

  // Pin Alpine Climb -> a Pinned group appears above Other routes; the
  // remaining unpinned pair still orders by Most recent (Zebra Loop newer).
  await pinAndWait(page, "Alpine Climb");
  await expect(async () => {
    expect(await groupHeadings(page)).toEqual(["Pinned", "Other routes"]);
  }).toPass();
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Alpine Climb",
      "Zebra Loop",
      "Mountain Pass",
    ]);
  }).toPass();

  // Changing the sort order genuinely reorders the two remaining unpinned
  // routes (Mountain Pass alphabetically precedes Zebra Loop, the reverse
  // of their Most recent order), while Pinned's own single entry stays put
  // — proving the selector affects only Other routes, not a coincidence.
  await page.getByLabel("Sort by").selectOption("name-asc");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Alpine Climb",
      "Mountain Pass",
      "Zebra Loop",
    ]);
  }).toPass();

  // Pinning a second route lands it above the first.
  await pinAndWait(page, "Zebra Loop");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Zebra Loop",
      "Alpine Climb",
      "Mountain Pass",
    ]);
  }).toPass();

  // Search filters across both groups; the empty group's heading is
  // omitted (only Zebra Loop, in Pinned, matches "zebra").
  const search = page.getByLabel("Search routes");
  await search.fill("zebra");
  await expect(async () => {
    expect(await groupHeadings(page)).toEqual(["Pinned"]);
  }).toPass();
  await expect(page.locator(".route-card-title")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");

  // Reload preserves both pin state and pinned order (pin state and sort
  // choice are both persisted; the transient search query is not, per the
  // existing search/sort contract).
  await page.reload();
  await expect(async () => {
    expect(await groupHeadings(page)).toEqual(["Pinned", "Other routes"]);
  }).toPass();
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Zebra Loop",
      "Alpine Climb",
      "Mountain Pass",
    ]);
  }).toPass();

  // Unpinning Zebra Loop moves it into the unpinned group at the position
  // dictated by the currently selected sort order (name-asc: Mountain Pass
  // before Zebra Loop).
  await unpinAndWait(page, "Zebra Loop");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Alpine Climb",
      "Mountain Pass",
      "Zebra Loop",
    ]);
  }).toPass();

  // Pinning it again makes it the newest pinned route.
  await pinAndWait(page, "Zebra Loop");
  await expect(async () => {
    expect(await visibleCardTitles(page)).toEqual([
      "Zebra Loop",
      "Alpine Climb",
      "Mountain Pass",
    ]);
  }).toPass();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test("opening a pinned route and returning restores the pinned/unpinned grouping alongside the existing search, sort and scroll contract", async ({
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
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Zebra Loop");
  await pinAndWait(page, "Zebra Loop");
  await expect(async () => {
    expect(await groupHeadings(page)).toEqual(["Pinned", "Other routes"]);
  }).toPass();

  await page.getByRole("button", { name: "Zebra Loop", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Zebra Loop" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.getByRole("button", { name: "Routes" }).click();
  // exact: true — "Other routes" is itself an h2 heading once a route is
  // pinned, and would otherwise match this locator's default substring
  // matching alongside the screen's own top-level "Routes" h1.
  await expect(page.getByRole("heading", { name: "Routes", exact: true })).toBeVisible();

  await expect(async () => {
    expect(await groupHeadings(page)).toEqual(["Pinned", "Other routes"]);
  }).toPass();
  await expect(
    page.getByRole("button", { name: "Unpin Zebra Loop", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
