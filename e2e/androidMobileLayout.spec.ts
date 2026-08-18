import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves the "mobile layout baseline" requirement of CLAUDE.md backlog
// item 25 at a representative Android phone viewport/UA/touch context
// (this file's own "android-chrome" Playwright project in
// playwright.config.ts, devices["Pixel 7"] — Chromium-emulated, not real
// Android Chrome or WebView; see docs/android-chrome-acceptance.md for
// what this can and cannot prove). Reuses installLocalMapStyle and the
// GPX-import/open-route flow exactly as layout.spec.ts and
// stickyNavigation.spec.ts already do at their own (iPhone-shaped,
// desktop-Chromium) viewports — this file's only new axis is the device
// context, not new interaction logic.

test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
const TOUCH_TARGET_MIN_PX = 44;

function readScrollWidths(targetPage: Page) {
  return targetPage.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
}

test("no horizontal overflow, sticky header, and usable touch targets across the primary screens and the pre-ride/active-riding transition", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("expected the android-chrome project to set a viewport");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  const header = page.locator("header.app-header--sticky");

  // Every MainNavigation destination: usable touch target, sticky header,
  // no horizontal overflow.
  for (const label of ["Routes", "Ride", "Plan", "Diagnostics", "Settings"]) {
    const navButton = page.getByRole("button", { name: label });
    const box = await navButton.boundingBox();
    if (!box)
      throw new Error(`expected the "${label}" nav button to have a bounding box`);
    expect(box.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    expect(box.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);

    await navButton.click();
    await expect(header).toHaveCSS("position", "sticky");
    const widths = await readScrollWidths(page);
    expect(widths.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(widths.bodyWidth).toBeLessThanOrEqual(viewport.width);
  }

  // Pre-ride/Resume screen: import a route and open it (never tap Start
  // riding here — this proves the idle row of the sticky-header contract,
  // not the active-tracking row).
  await page.getByRole("button", { name: "Routes" }).click();
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  await expect(page.getByRole("heading", { name: "smoke-route" })).toBeVisible();
  await expect(header).toHaveCSS("position", "sticky");

  const preRideWidths = await readScrollWidths(page);
  expect(preRideWidths.documentWidth).toBeLessThanOrEqual(viewport.width);
  expect(preRideWidths.bodyWidth).toBeLessThanOrEqual(viewport.width);

  const startButton = page.getByRole("button", { name: "Start riding" });
  const startBox = await startButton.boundingBox();
  if (!startBox)
    throw new Error("expected the Start riding button to have a bounding box");
  expect(startBox.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);

  // Starting to track genuinely removes the global nav header from the
  // DOM (backlog item 55, superseding the old "static" contract) — the
  // same contract stickyNavigation.spec.ts proves at a different
  // (iPhone-shaped) viewport, reproven here under Android emulation.
  await startButton.click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(header).toHaveCount(0);
  await expect(page.locator("header.riding-immersive-header")).toBeVisible();

  const followButton = page.getByRole("button", { name: "Follow my location" });
  const northButton = page.getByRole("button", { name: "North-up, top-down view" });
  for (const control of [followButton, northButton]) {
    const box = await control.boundingBox();
    if (!box) throw new Error("expected a camera control to have a bounding box");
    expect(box.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    expect(box.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
  }

  const activeWidths = await readScrollWidths(page);
  expect(activeWidths.documentWidth).toBeLessThanOrEqual(viewport.width);
  expect(activeWidths.bodyWidth).toBeLessThanOrEqual(viewport.width);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
