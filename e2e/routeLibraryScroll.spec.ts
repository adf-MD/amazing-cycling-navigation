import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

// Comfortably more than one 844px-tall phone viewport of route cards,
// whatever a card's real rendered height turns out to be — no pixel
// height is assumed or asserted anywhere in this file.
const ROUTE_COUNT = 20;

test.use({ viewport: { width: 390, height: 844 } });

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// layout.spec.ts/planning.spec.ts, which need the same workaround.
test.use({ serviceWorkers: "block" });

async function importManyRoutes(page: Page, count: number) {
  const gpxContents = await readFile(FIXTURE_GPX_PATH, "utf-8");
  for (let i = 0; i < count; i += 1) {
    const name = `Route ${String(i).padStart(2, "0")}`;
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${name}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(gpxContents),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

test("opening a route far down a long library shows Riding from the top; returning restores the prior scroll position", async ({
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
  await importManyRoutes(page, ROUTE_COUNT);

  const cards = page.locator(".route-list > li");
  await expect(cards).toHaveCount(ROUTE_COUNT);
  const lastCard = cards.last();
  await lastCard.scrollIntoViewIfNeeded();

  const scrollYBeforeOpen = await page.evaluate(() => window.scrollY);
  expect(scrollYBeforeOpen).toBeGreaterThan(0); // proves the library is genuinely scrolled

  const lastCardName = await lastCard.locator(".route-card-title").innerText();
  await lastCard.locator(".route-card-title").click();

  await expect(page.getByRole("heading", { name: lastCardName })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.getByRole("button", { name: "Routes" }).click();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollYBeforeOpen);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("opening the topmost, just-imported route stays at the top with no scrolling involved", async ({
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
  await importManyRoutes(page, 2);

  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.getByRole("button", { name: "Route 00", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Route 00" })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
