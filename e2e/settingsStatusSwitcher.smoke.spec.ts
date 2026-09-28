import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Backlog item 121, in WebKit as well as Chromium — this file joins the
// webkit-smoke project by name, because each behaviour below failed, or
// could only fail, in WebKit's own handling of focus and scrolling, and the
// iPhone is WebKit. Desktop WebKit in a container is still not
// installed-iPhone acceptance.

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

/**
 * The section's top reset keeps re-flattening the scroll for a few frames
 * after arriving (scrollToTopAndSettle.ts, item 95's reassertion loop), and
 * a rider's own touch or wheel ends it at once — but a test's programmatic
 * scroll is neither, so it must wait for the loop to settle first. Measured:
 * headless WebKit defers those frames until the next pointer activity, so
 * without this a scroll taken straight after arriving was reset to 0 by the
 * test's own next click. Requesting frames here forces them to run.
 */
async function settleArrival(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames += 1;
          if (frames >= 6) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

async function openSettings(page: Page) {
  await page.goto("/");
  await mainNav(page).getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("OpenRouteService API key")).toBeVisible();
  await settleArrival(page);
}

async function stickyChromeBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const header = document.querySelector(".app-header--sticky")?.getBoundingClientRect();
    const sw = document.querySelector(".settings-status-switcher");
    const swStuck = sw && getComputedStyle(sw).position === "sticky";
    return Math.max(header?.bottom ?? 0, swStuck ? sw.getBoundingClientRect().bottom : 0);
  });
}

for (const [width, height] of [
  [390, 844],
  [375, 667],
] as const) {
  test(`pressing Save while the switcher is released saves the key, with the page held still (${String(width)}×${String(height)})`, async ({
    page,
  }) => {
    // Measured in WebKit: when a scroll-padding change followed focus out of
    // the key field, WebKit scrolled the page by -61px between the press on
    // Save and its release, the release landed on the field above, and Save
    // never fired. The ordinary flow — fill the field, press Save — is the
    // one that reproduces it; a first version of this test scrolled the
    // field to the centre beforehand and, doing so, passed against the
    // defect.
    await page.setViewportSize({ width, height });
    await openSettings(page);
    await page.getByLabel("OpenRouteService API key").fill("dummy-e2e-key");
    await expect(page.locator(".settings-status-switcher")).toHaveCSS(
      "position",
      "static",
    );
    await page.evaluate(() => {
      const w = window as unknown as { __scrollAtPress: number[] };
      w.__scrollAtPress = [];
      for (const type of ["pointerdown", "pointerup", "click"]) {
        document.addEventListener(
          type,
          () => {
            w.__scrollAtPress.push(window.scrollY);
          },
          { capture: true },
        );
      }
    });

    await page.getByRole("button", { name: "Save on this device" }).click();

    await expect(page.getByRole("button", { name: "Delete key" })).toBeVisible();
    const positions = await page.evaluate(
      () => (window as unknown as { __scrollAtPress: number[] }).__scrollAtPress,
    );
    expect(positions.length).toBe(3);
    expect(new Set(positions).size, `scroll positions ${positions.join(", ")}`).toBe(1);
  });
}

test("Shift+Tab onto a control beneath the sticky rows brings it out from under them", async ({
  page,
}) => {
  await openSettings(page);
  const target = page.getByRole("button", { name: "English", exact: true });
  const next = page.getByRole("button", { name: "Deutsch", exact: true });
  const chromeBottom = await stickyChromeBottom(page);
  await target.evaluate((element, bottom) => {
    window.scrollBy(0, element.getBoundingClientRect().top - (bottom - 20));
  }, chromeBottom);
  await next.evaluate((element) => {
    element.focus({ preventScroll: true });
  });

  await page.keyboard.press("Shift+Tab");

  await expect(target).toBeFocused();
  const top = await target.evaluate((element) => element.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual((await stickyChromeBottom(page)) - 0.5);
});

test("focusing a control in the sticky rows never scrolls the page", async ({ page }) => {
  // A root scroll-padding counted the sticky rows' own controls as out of
  // view, so focusing one (a click on the Settings tab, in Chromium)
  // scrolled the page — 448px on one press.
  await openSettings(page);
  await page
    .getByText("How climbs are classified", { exact: true })
    .evaluate((element) => {
      element.scrollIntoView({ block: "center" });
    });
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);

  for (const control of [
    mainNav(page).getByRole("button", { name: "Settings", exact: true }),
    page
      .getByRole("navigation", { name: "Settings and Status" })
      .getByRole("button", { name: "Settings", exact: true }),
  ]) {
    await control.focus();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  }
  // And pressing the tab of the view already shown changes nothing at all.
  await mainNav(page).getByRole("button", { name: "Settings", exact: true }).click();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
