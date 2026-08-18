import { expect, test } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Proves route-less free roam (backlog item 42) under Android device
// emulation (this file's own "android-chrome" Playwright project,
// devices["Pixel 7"] — Chromium-emulated, not real Android Chrome; see
// docs/android-chrome-acceptance.md). A lighter-touch pass — start,
// persisted reload recovery, and End ride — mirroring androidRiding.spec.ts's
// own established scope note: the full camera/manual-gesture/conflict-guard
// state machine is already proven at a desktop viewport in freeRoam.spec.ts
// and is not duplicated here.

const START = { latitude: 51.5, longitude: -0.1 };

test("starts free roam, shows a live position, and persists a recoverable session across a real reload", async ({
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
  await context.setGeolocation(START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start free roam" })).toBeVisible();

  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('[data-testid="map-container"] canvas')).toBeVisible();
  await expect(page.getByText(/GPS accuracy:/)).toBeVisible();

  // The global nav header is genuinely absent the instant free roam is
  // genuinely watching (backlog item 55, superseding the old "static"
  // contract) — replaced by FreeRoamScreen's own immersive header.
  // Mirrors androidRiding.spec.ts's own identical contract.
  await expect(page.locator("header.app-header--sticky")).toHaveCount(0);
  await expect(page.locator("header.riding-immersive-header")).toBeVisible();

  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "free-roam", lastFix: expect.anything() });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume free roam" })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("End ride from the active screen clears the session and returns to the empty launcher", async ({
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
  await context.setGeolocation(START);

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free roam" })).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  await page.getByRole("button", { name: "End ride" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "End ride" }).click();

  await expect.poll(() => readActiveRideStateRow(page), { timeout: 10_000 }).toBeNull();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start free roam" })).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
