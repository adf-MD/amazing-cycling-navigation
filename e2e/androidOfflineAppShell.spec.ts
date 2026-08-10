import { expect, test } from "@playwright/test";

// The one spec in this suite that deliberately does NOT set
// `serviceWorkers: "block"` — every other android*.spec.ts file blocks
// service workers so page.route() can reliably intercept tile/ORS
// requests (a documented Playwright limitation, see
// support/localMapStyle.ts). This file instead lets the real, installed
// service worker register and activate, to prove the actual PWA
// offline-shell contract (vite.pwa.workbox.ts's app-shell-only precache,
// CLAUDE.md backlog item 25) rather than only the app's own IndexedDB +
// map-fallback-style resilience (see androidPersistenceAndOffline.spec.ts
// for that). Real service-worker activation/control timing is a known
// source of Playwright/Chromium flakiness; per CLAUDE.md item 25, if this
// file proves unreliable across a few local/CI runs, the documented
// fallback is to remove it and mark "app shell available offline" as
// real-Android-device-only in docs/android-chrome-acceptance.md, rather
// than forcing a flaky pass with retries or loosened assertions.

test("the installed service worker serves the app shell while genuinely offline", async ({
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

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  // A freshly installed/activated service worker controls only
  // navigations that start after it activates — the page that triggered
  // the install is never itself controlled. Wait for activation, then
  // reload once so the next navigation is actually served under the
  // worker's control before testing the offline case.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 10_000,
    })
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }

  expect(consoleErrors.filter((message) => !message.includes("net::ERR_FAILED"))).toEqual(
    [],
  );
});
