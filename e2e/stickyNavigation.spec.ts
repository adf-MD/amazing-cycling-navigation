import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves the sticky primary-navigation contract recorded in CLAUDE.md
// backlog item 24, as superseded by item 55: App.tsx's own <header>
// (which wraps MainNavigation) stays pinned to the top of the viewport
// on every screen except while a ride is genuinely being GPS-tracked,
// where it is now genuinely ABSENT from the DOM entirely (not merely
// non-sticky, as item 24 originally shipped) — replaced by RidingScreen's/
// FreeRoamScreen's own persistent Pause/title/End header
// (.riding-immersive-header, see RidingImmersiveHeader.tsx and
// immersiveRidingShell.ts). A wholly independent, new spec file per this
// repo's documented no-shared-e2e-helpers convention — it never imports
// from, and shares no fixture/camera interaction with, planning.spec.ts's
// hardened "pressing Northwards twice" tests. The new immersive header's
// own full safe-area (all four sides) and orientation-change coverage
// lives in e2e/ridingImmersiveShell.spec.ts instead, alongside its Pause
// lifecycle — this file stays scoped to the global nav header's own
// sticky/absent contract.
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

// Scoped to .app-header--sticky specifically (App.tsx's own global nav
// header, unconditionally carrying that class whenever it renders at all
// — see App.tsx) rather than a bare "header" selector: while a ride is
// actively tracking, RidingScreen's/FreeRoamScreen's own immersive header
// (.riding-immersive-header, backlog item 55) is ALSO a genuine <header>
// element, and the two are mutually exclusive but a bare selector would
// blur that distinction. This locator resolves to zero elements whenever
// the global nav header is genuinely absent (the item-55 case) — callers
// must use .toHaveCount(0) rather than assuming a bounding box always
// exists.
function headerLocator(page: Page) {
  return page.locator("header.app-header--sticky");
}

function immersiveHeaderLocator(page: Page) {
  return page.locator("header.riding-immersive-header");
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

test("the global nav header is genuinely absent while a ride is actively tracked, replaced by a persistent immersive header that stays pinned even when scrolled (backlog item 55)", async ({
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

  // The global nav header (and MainNavigation with it) is genuinely
  // absent — not merely repositioned, item 24's original "static" state.
  await expect(headerLocator(page)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

  const immersiveHeader = immersiveHeaderLocator(page);
  await expect(immersiveHeader).toBeVisible();

  // Backlog item 56 supersedes this test's own pre-item-56 premise:
  // active Riding's whole .screen is now a fixed, non-scrolling shell
  // (.riding-fixed-shell, height: 100dvh; overflow: hidden) housing a
  // shared status stack plus a Map/Profile toggle that both fit within
  // one viewport by construction — RidingWakeLockControl also moved to
  // render after this header (correcting the real, screenshot-evidenced
  // field finding the old comment here used to describe), so the header
  // is the fixed shell's own first child and sits at the true viewport
  // top immediately, with no scrolling involved at all. The old proof
  // technique (scroll to the bottom, confirm the header is still stuck
  // at y ≈ 0) no longer applies, since there is nothing left to scroll —
  // proving that directly is now the load-bearing assertion, ahead of the
  // header's own position.
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportHeight = page.viewportSize()?.height;
  if (viewportHeight === undefined) throw new Error("expected a viewport height");
  expect(scrollHeight).toBeLessThanOrEqual(viewportHeight);

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const headerBox = await immersiveHeader.boundingBox();
  if (!headerBox) throw new Error("expected the immersive header to still be visible");
  expect(headerBox.y).toBeGreaterThanOrEqual(0);
  expect(headerBox.y).toBeLessThan(2);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});

test("Pause restores the global nav header immediately, and the route stays resumable in the background", async ({
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

  await expect(headerLocator(page)).toHaveCount(0);

  // Unlike item 24's original design (leaving an active ride via
  // MainNavigation, e.g. tapping "Settings"), that path no longer exists
  // once MainNavigation is genuinely absent (backlog item 55) — Pause is
  // now the only way to leave an active ride reversibly.
  await page.getByRole("button", { name: "Pause" }).click();
  // The same route screen stays mounted, showing its own resumable panel
  // directly — no launcher round-trip (backlog item 72).
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();
  await expect(headerLocator(page)).toHaveCSS("position", "sticky");

  await page.getByRole("button", { name: "Resume ride" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect(headerLocator(page)).toHaveCount(0);
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

  test("the sticky header's opaque box starts at the true viewport top, .main-nav sits below the inset plus the top dead zone, and .main-nav's bottom edge sits directly against the header's border-bottom with no buffer strip", async ({
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

    // .main-nav's own bottom edge now sits directly against the header's
    // border-bottom, exactly as its border-top divider does at the top —
    // no strip of unused space between the buttons and the bottom line
    // (item 76 removed the earlier --space-8 lower buffer). boundingBox()
    // returns the border box, so the only remaining separation is the
    // border-bottom's own 1px width — never demand an impossible
    // negative/zero gap, since that border genuinely occupies space.
    const gap = headerBox.y + headerBox.height - (navBox.y + navBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(2);

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

  test("the global nav header stays genuinely absent under a synthetic safe-area inset while active Riding shows its own immersive header instead", async ({
    page,
    context,
  }) => {
    // This test only proves the global header's own absence under a
    // synthetic inset — the immersive header's own full safe-area
    // behaviour (all four sides, including this same synthetic-inset
    // technique) is covered in e2e/ridingImmersiveShell.spec.ts instead,
    // alongside the rest of its Pause-lifecycle coverage.
    await useSyntheticSafeAreaInsetTop(page);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
    await installLocalMapStyle(page);

    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
    await page.getByRole("button", { name: "smoke-route", exact: true }).click();
    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

    await expect(headerLocator(page)).toHaveCount(0);
    await expect(immersiveHeaderLocator(page)).toBeVisible();
  });
});
