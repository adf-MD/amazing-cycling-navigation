import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readSavedRouteId, writeActiveRideStateRow } from "./support/rideStateDb.ts";

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
  for (const label of ["Routes", "Ride", "Plan", "Status", "Settings"]) {
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

    // Item 92: genuine (unstubbed) Chromium storage-quota evidence under
    // android-chrome emulation — the plain diagnostics.spec.ts additions
    // only ever run under the chromium project, so this is the one place
    // that makes a "Chromium-emulated Android" evidence claim true rather
    // than inherited boilerplate. Requires the real numeric branch, not
    // merely the disappearance of "Checking storage estimate…".
    if (label === "Status") {
      const storageValue = page
        .getByText("Storage", { exact: true })
        .locator("xpath=following-sibling::dd[1]");
      await expect(storageValue).toContainText("OK (schema version");
      await expect(storageValue).toContainText(/Estimated app storage: .+ used \(.+\)/);
    }
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

/**
 * Backlog item 117 under Android emulation. The Chromium coverage lives in
 * diagnostics.spec.ts; this is the one place that makes a
 * "Chromium-emulated Android" claim true for the Status screen's route-name
 * presentation rather than inheriting it. Seeded through the real GPX
 * import plus a real IndexedDB session row — no map is built, so this test
 * needs no local map style of its own.
 */
test("Status shows an active route-backed session by name, not by its identifier", async ({
  page,
}) => {
  // Imported under a multi-word name, so the assertion contrasts a genuine
  // rider-facing name against the UUID this row used to show.
  const routeName = "Evening loop";
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${routeName}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(await readFile(FIXTURE_GPX_PATH, "utf-8")),
  });
  await expect(page.getByRole("button", { name: routeName, exact: true })).toBeVisible();

  const routeId = await readSavedRouteId(page, routeName);
  expect(routeId).not.toBeNull();
  if (routeId === null) throw new Error("expected the imported route to have an id");

  await writeActiveRideStateRow(page, {
    id: "active",
    routeId,
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: null,
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
  });

  await page.getByRole("button", { name: "Status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeVisible();

  const sessionValue = page
    .getByText("Active session", { exact: true })
    .locator("xpath=following-sibling::dd[1]");
  await expect(sessionValue).toHaveText(routeName);
  expect(await page.locator("body").innerText()).not.toContain(routeId);

  const widths = await readScrollWidths(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("expected the android-chrome project to set a viewport");
  expect(widths.documentWidth).toBeLessThanOrEqual(viewport.width);
});

// Backlog item 118, at the Pixel-7 preset and at 200% root text — the
// enlarged-text condition this project treats as its accessibility
// evidence, since ACN has no iOS Dynamic Type opt-in. Chromium emulation,
// never a substitute for a physical Android device.
test("the Settings key-deletion confirmation stays inside its card at 200% text", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("OpenRouteService API key").fill("dummy-e2e-key");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.getByRole("button", { name: "Delete key" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((element) =>
      element.closest("section[aria-labelledby]")?.getAttribute("aria-labelledby"),
    ),
  ).toBe("ors-settings-heading");

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("expected the android-chrome project to set a viewport");
  const widths = await readScrollWidths(page);
  expect(widths.documentWidth).toBeLessThanOrEqual(viewport.width);
  expect(widths.bodyWidth).toBeLessThanOrEqual(viewport.width);

  const cardBox = await page
    .getByRole("region", { name: "OpenRouteService" })
    .boundingBox();
  const dialogBox = await dialog.boundingBox();
  if (!cardBox || !dialogBox) throw new Error("expected boxes for the card and dialog");
  expect(dialogBox.x).toBeGreaterThanOrEqual(cardBox.x);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);

  for (const name of ["Cancel", "Delete"]) {
    const box = await dialog.getByRole("button", { name, exact: true }).boundingBox();
    if (!box) throw new Error(`expected a bounding box for ${name}`);
    expect(box.height).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    expect(box.width).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
});

// Item 118's conditional-reveal follow-up, at the Pixel-7 preset. The
// confirmation is deliberately opened with a real DOM click from a seeded
// scroll position, so Playwright's own actionability scroll cannot stand
// in for the behaviour under test. Chromium emulation, never a substitute
// for a physical Android device.
test("the key-deletion confirmation's actions are brought fully into the usable band when it cannot fit", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("OpenRouteService API key").fill("dummy-e2e-key");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "120px");
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Delete key",
    );
    if (!btn) throw new Error("expected a Delete key button");
    const r = btn.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.bottom - (window.innerHeight - 20));
  });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Delete key",
    );
    if (!btn) throw new Error("expected a Delete key button");
    btn.click();
  });
  await expect(page.getByRole("alertdialog")).toBeVisible();

  const measured = await page.evaluate(() => {
    const GAP = 8;
    const dialog = document.querySelector('[role="alertdialog"]');
    if (!dialog) throw new Error("expected the confirmation to be rendered");
    const header = document.querySelector("header.app-header--sticky");
    const vv = window.visualViewport;
    const safeArea =
      Number.parseFloat(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--safe-area-inset-bottom")
          .trim(),
      ) || 0;
    return {
      bandTop:
        Math.max(header?.getBoundingClientRect().bottom ?? 0, vv?.offsetTop ?? 0) + GAP,
      bandBottom: (vv ? vv.offsetTop + vv.height : window.innerHeight) - (safeArea + GAP),
      insetHeight: dialog.getBoundingClientRect().height,
      actions: [...dialog.querySelectorAll("button")].map((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.textContent.trim(), top: r.top, bottom: r.bottom };
      }),
    };
  });

  // The overflow branch was genuinely taken, not an accidental fit.
  expect(measured.insetHeight).toBeGreaterThan(measured.bandBottom - measured.bandTop);
  expect(measured.actions).toHaveLength(2);
  for (const action of measured.actions) {
    expect(action.top, action.label).toBeGreaterThanOrEqual(measured.bandTop - 1);
    expect(action.bottom, action.label).toBeLessThanOrEqual(measured.bandBottom + 1);
  }

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("expected the android-chrome project to set a viewport");
  const widths = await readScrollWidths(page);
  expect(widths.documentWidth).toBeLessThanOrEqual(viewport.width);
});
