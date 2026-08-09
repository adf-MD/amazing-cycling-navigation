import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves the sticky/static primary-navigation contract recorded in
// CLAUDE.md backlog item 24: App.tsx's own <header> (which wraps
// MainNavigation) stays pinned to the top of the viewport on every
// screen except while a ride is genuinely being GPS-tracked, where it
// returns to normal document flow so the riding dashboard gets full
// space. A wholly independent, new spec file per this repo's documented
// no-shared-e2e-helpers convention — it never imports from, and shares
// no fixture/camera interaction with, planning.spec.ts's hardened
// "pressing Northwards twice" tests.
//
// The sticky declaration lives on <header>, not on .main-nav itself: a
// sticky element's stuck range is bounded by its own containing block,
// and a <header> that only ever wraps the nav is itself only as tall as
// the nav plus a little padding — position: sticky placed directly on
// .main-nav therefore had almost no room to remain stuck before
// scrolling away with that too-short header (a real, confirmed field
// bug on the deployed iPhone PWA at build 0.3.14 — see CLAUDE.md item 24
// for the incident). header's own containing block is .app-shell, which
// spans the full page height, giving header the room a sticky element
// needs. Every test below therefore targets <header> and uses genuine
// bounding-box geometry across a real document scroll — proven, via
// direct experiment, to render correctly in this repo's own Playwright/
// Chromium setup once the sticky declaration sits on the right element.

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

// There is exactly one <header> in the app shell (App.tsx), always
// wrapping MainNavigation — no need to scope the selector further.
function headerLocator(page: Page) {
  return page.locator("header");
}

test.use({ viewport: { width: 390, height: 844 } });

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) —
// see layout.spec.ts/planning.spec.ts, which need the same workaround.
test.use({ serviceWorkers: "block" });

async function importManyRoutes(page: Page, count: number) {
  const gpxContents = await readFile(FIXTURE_GPX_PATH, "utf-8");
  for (let i = 0; i < count; i += 1) {
    const name = `Sticky test route ${String(i).padStart(2, "0")}`;
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${name}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(gpxContents),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

test("stays pinned near the top while a long Routes list is scrolled", async ({
  page,
}) => {
  await page.goto("/");
  await importManyRoutes(page, 20);

  const header = headerLocator(page);
  await expect(header).toHaveCSS("position", "sticky");
  const topBox = await header.boundingBox();
  if (!topBox) throw new Error("expected the header to have a bounding box");

  await page.evaluate(() => {
    window.scrollTo(0, 2000);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const scrolledBox = await header.boundingBox();
  if (!scrolledBox) throw new Error("expected the header to still have a bounding box");
  expect(Math.abs(scrolledBox.y - topBox.y)).toBeLessThan(2);
  expect(scrolledBox.y).toBeGreaterThanOrEqual(0);
});

test("stays pinned on the pre-ride/Resume screen while scrolled", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await expect(page.getByRole("heading", { name: "smoke-route" })).toBeVisible();

  // Never taps Start riding — this proves the idle/pre-ride row of the
  // required state table, not the active-tracking row.
  const header = headerLocator(page);
  await expect(header).toHaveCSS("position", "sticky");
  const topBox = await header.boundingBox();
  if (!topBox) throw new Error("expected the header to have a bounding box");

  await page.evaluate(() => {
    window.scrollTo(0, 400);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const scrolledBox = await header.boundingBox();
  if (!scrolledBox) throw new Error("expected the header to still have a bounding box");
  expect(Math.abs(scrolledBox.y - topBox.y)).toBeLessThan(2);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});

test("stays pinned on Diagnostics while scrolled", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(
    page.getByRole("heading", { name: "Diagnostics", exact: true }),
  ).toBeVisible();

  const header = headerLocator(page);
  await expect(header).toHaveCSS("position", "sticky");
  const topBox = await header.boundingBox();
  if (!topBox) throw new Error("expected the header to have a bounding box");

  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(scrollHeight).toBeGreaterThan(844); // proves Diagnostics is genuinely scrollable here

  await page.evaluate(() => {
    window.scrollTo(0, 400);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const scrolledBox = await header.boundingBox();
  if (!scrolledBox) throw new Error("expected the header to still have a bounding box");
  expect(Math.abs(scrolledBox.y - topBox.y)).toBeLessThan(2);
});

test("scrolls out of view while a ride is actively tracked, and back once scrolled to the top", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const header = headerLocator(page);
  await expect(header).toHaveCSS("position", "static");

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect
    .poll(async () => {
      const box = await header.boundingBox();
      return box ? box.y + box.height : null;
    })
    .toBeLessThanOrEqual(0); // fully scrolled above the visible viewport

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(header).toHaveCSS("position", "static"); // never becomes sticky merely by reaching the top

  const restoredBox = await header.boundingBox();
  if (!restoredBox) throw new Error("expected the header to be back in the viewport");
  expect(restoredBox.y).toBeGreaterThanOrEqual(0);
  expect(restoredBox.y).toBeLessThan(200);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});

test("restores sticky positioning immediately on navigating away while the ride stays active/resumable in the background", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  const header = headerLocator(page);
  await expect(header).toHaveCSS("position", "static");

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(header).toHaveCSS("position", "sticky");

  // The ride was never explicitly stopped, only navigated away from — a
  // plain nav-tab return shows Resume riding (idle + restored fix), and
  // the header stays sticky there too.
  await page.getByRole("button", { name: "Ride" }).click();
  await expect(page.getByRole("button", { name: "Resume riding" })).toBeVisible();
  await expect(header).toHaveCSS("position", "sticky");
});

test("every top-level screen other than active Riding renders the header sticky", async ({
  page,
}) => {
  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
  await page.goto("/");
  const header = headerLocator(page);

  for (const label of ["Routes", "Plan", "Diagnostics", "Settings", "Ride"]) {
    await page.getByRole("button", { name: label }).click();
    await expect(header).toHaveCSS("position", "sticky");
  }

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});
