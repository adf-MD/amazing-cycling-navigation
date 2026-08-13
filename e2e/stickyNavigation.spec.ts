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

// CLAUDE.md item 34: a real, confirmed field bug on the deployed iPhone
// PWA — scrolled content was visible through the iOS status-bar safe-area
// strip above the sticky header, because the header's own opaque box
// began below that strip (see index.css's .app-header--sticky comment
// for the full root-cause derivation). Desktop Chromium always resolves
// env(safe-area-inset-top) to 0px and Playwright cannot emulate iOS
// standalone status-bar compositing, so this group proves the CSS
// geometry only, by overriding the project's own --safe-area-inset-top
// custom property with a representative non-zero synthetic value via an
// inline style on the root element (higher specificity than the
// stylesheet's :root rule, so it applies with no real safe-area support
// needed from the test browser at all). This is structural evidence that
// the box geometry is correct in a real layout engine — it is not proof
// of the real iOS Safari/WKWebView status-bar compositor result, which
// remains an outstanding real-device check (see CLAUDE.md's Manual
// acceptance status / item 43).
test.describe("synthetic safe-area inset (iOS status-bar strip coverage)", () => {
  const SYNTHETIC_INSET_PX = 59; // representative of a real iPhone Dynamic Island inset
  const SPACE_8_PX = 8; // --space-8, mirrored here since CSS custom properties aren't importable

  // page.addInitScript runs at the earliest possible point in a new
  // document's lifetime — before document.documentElement necessarily
  // exists yet (confirmed directly: a bare
  // `document.documentElement.style.setProperty(...)` here throws
  // "Cannot read properties of null" and silently never applies, since
  // Playwright's own error reporting for an init-script exception doesn't
  // surface as a test failure). A MutationObserver on `document` itself
  // (which always exists) fires the instant <html> is inserted, well
  // before this app's own deferred module script (index.html's
  // <script type="module">) can run.
  async function useSyntheticSafeAreaInsetTop(page: Page) {
    await page.addInitScript((px) => {
      // TypeScript's DOM lib types document.documentElement as always
      // present, but empirically (confirmed via a standalone repro) it can
      // genuinely be null at this exact point — an init script runs before
      // <html> has necessarily been inserted into the document. Using
      // querySelector, whose return type is correctly nullable, keeps the
      // real runtime check without fighting the type checker.
      const applyTo = (html: Element) => {
        (html as HTMLElement).style.setProperty(
          "--safe-area-inset-top",
          `${String(px)}px`,
        );
      };
      const existingHtml = document.querySelector("html");
      if (existingHtml) {
        applyTo(existingHtml);
      } else {
        new MutationObserver((_mutations, observer) => {
          const html = document.querySelector("html");
          if (html) {
            applyTo(html);
            observer.disconnect();
          }
        }).observe(document, { childList: true });
      }
    }, SYNTHETIC_INSET_PX);
  }

  function mainNavLocator(page: Page) {
    return page.locator(".main-nav");
  }

  test("the sticky header's opaque box starts at the true viewport top, .main-nav sits below the inset plus the top dead zone, and a --space-8 buffer separates .main-nav from the border", async ({
    page,
  }) => {
    await useSyntheticSafeAreaInsetTop(page);
    await page.goto("/");
    await importManyRoutes(page, 20);

    const header = headerLocator(page);
    const nav = mainNavLocator(page);
    await expect(header).toHaveCSS("position", "sticky");

    const headerBox = await header.boundingBox();
    const navBox = await nav.boundingBox();
    if (!headerBox || !navBox) {
      throw new Error("expected both the header and the nav to have a bounding box");
    }

    // The opaque box (background/border-bottom) starts at the true
    // viewport top, not below the synthetic safe-area strip.
    expect(headerBox.y).toBeGreaterThanOrEqual(0);
    expect(headerBox.y).toBeLessThan(2);

    // .main-nav itself still sits below the inset plus the existing
    // top dead zone (--space-8) — the fix must not move the nav's own
    // visual position, only extend the header's opaque box above it.
    const expectedNavTop = SYNTHETIC_INSET_PX + SPACE_8_PX;
    expect(navBox.y).toBeGreaterThan(expectedNavTop - 3);
    expect(navBox.y).toBeLessThan(expectedNavTop + 3);

    // The header's own background is opaque, not transparent.
    const backgroundColor = await header.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(backgroundColor).not.toBe("transparent");

    // A --space-8-scale opaque buffer separates the bottom of .main-nav
    // from the header's own bottom edge (where border-bottom paints).
    const gap = headerBox.y + headerBox.height - (navBox.y + navBox.height);
    expect(gap).toBeGreaterThan(SPACE_8_PX - 4);
    expect(gap).toBeLessThan(SPACE_8_PX + 4);

    // The opaque box stays pinned at the true viewport top after a
    // genuine document scroll — reuses this file's own existing <2px
    // stability-tolerance pattern.
    await page.evaluate(() => {
      window.scrollTo(0, 2000);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const scrolledBox = await header.boundingBox();
    if (!scrolledBox) throw new Error("expected the header to still have a bounding box");
    expect(Math.abs(scrolledBox.y - headerBox.y)).toBeLessThan(2);
    expect(scrolledBox.y).toBeLessThan(2);
  });

  test("ordinary top-level screens keep the header sticky under a synthetic safe-area inset", async ({
    page,
  }) => {
    await useSyntheticSafeAreaInsetTop(page);
    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);
    await page.goto("/");
    const header = headerLocator(page);

    for (const label of ["Routes", "Plan", "Diagnostics", "Settings", "Ride"]) {
      await page.getByRole("button", { name: label }).click();
      await expect(header).toHaveCSS("position", "sticky");
    }

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });

  test("active Riding keeps the header static under a synthetic safe-area inset, without the sticky-only lower buffer", async ({
    page,
    context,
  }) => {
    await useSyntheticSafeAreaInsetTop(page);
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
    // The sticky-only lower buffer must not leak into the static header —
    // the base `header` rule's own padding-bottom (0) stays unmodified.
    await expect(header).toHaveCSS("padding-bottom", "0px");
  });
});
