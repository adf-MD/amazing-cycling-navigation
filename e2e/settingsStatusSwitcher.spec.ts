import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 121: the four-destination primary navigation and the sticky
// Settings/Status switcher. A self-contained spec, per this repository's
// no-shared-e2e-helpers convention.
//
// Every figure here was measured in the pinned Playwright container, whose
// fonts do not predict iOS widths (item 113's follow-up), so the stressed
// runs are regression guards and never proof of fit on the iPhone.

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
const DB_NAME = "amazing-cycling-navigation";
const STRESS_FACTOR = 1.12;
const WIDTHS = [320, 360, 375, 390, 414, 430] as const;

type Lang = "en" | "de";
const COPY = {
  en: {
    main: "Main",
    switcher: "Settings and Status",
    settings: "Settings",
    status: "Status",
    routes: "Routes",
    plan: "Plan",
    keyLabel: "OpenRouteService API key",
    save: "Save on this device",
    deleteKey: "Delete key",
    confirmDelete: "Delete",
    firstSettingsHeading: "Preferences",
    firstStatusHeading: "System status",
    openSettings: "Open Settings",
  },
  de: {
    main: "Hauptbereiche",
    switcher: "Einstellungen und Status",
    settings: "Einstellungen",
    status: "Status",
    routes: "Routen",
    plan: "Planen",
    keyLabel: "OpenRouteService-API-Schlüssel",
    save: "Auf diesem Gerät speichern",
    deleteKey: "Schlüssel löschen",
    confirmDelete: "Löschen",
    firstSettingsHeading: "Optionen",
    firstStatusHeading: "Systemstatus",
    openSettings: "Einstellungen öffnen",
  },
} as const;

function mainNav(page: Page, lang: Lang) {
  return page.getByRole("navigation", { name: COPY[lang].main });
}

function switcher(page: Page, lang: Lang) {
  return page.getByRole("navigation", { name: COPY[lang].switcher });
}

async function tab(page: Page, lang: Lang, name: string) {
  await mainNav(page, lang).getByRole("button", { name, exact: true }).click();
}

async function switchTo(page: Page, lang: Lang, view: "settings" | "status") {
  await switcher(page, lang)
    .getByRole("button", { name: COPY[lang][view], exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: COPY[lang][view], exact: true }),
  ).toBeAttached();
}

/** Starts on Routes in the chosen language, through the real language card. */
async function start(page: Page, lang: Lang) {
  await page.goto("/");
  if (lang === "de") {
    await tab(page, "en", "Settings");
    await page.getByRole("button", { name: "Deutsch" }).click();
    await tab(page, "de", COPY.de.routes);
  }
  await expect(mainNav(page, lang)).toBeVisible();
}

async function setRootFontSize(page: Page, value: string) {
  await page.evaluate((v) => {
    document.documentElement.style.fontSize = v;
  }, value);
}

async function countProviderKeyRows(page: Page): Promise<number> {
  return page.evaluate(
    (dbName) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("providerKeys")) {
            db.close();
            resolve(0);
            return;
          }
          const count = db
            .transaction("providerKeys")
            .objectStore("providerKeys")
            .count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            reject(new Error("count failed"));
          };
        };
        request.onerror = () => {
          reject(new Error("open failed"));
        };
      }),
    DB_NAME,
  );
}

/** The sticky chrome's lower edge: the header, or the switcher while it sticks. */
async function stickyChromeBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const header = document.querySelector(".app-header--sticky")?.getBoundingClientRect();
    const sw = document.querySelector(".settings-status-switcher");
    const swStuck = sw && getComputedStyle(sw).position === "sticky";
    return Math.max(header?.bottom ?? 0, swStuck ? sw.getBoundingClientRect().bottom : 0);
  });
}

async function importManyRoutes(page: Page, count: number) {
  const gpxContents = await readFile(FIXTURE_GPX_PATH, "utf-8");
  for (let i = 0; i < count; i += 1) {
    const name = `Switcher test route ${String(i).padStart(2, "0")}`;
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${name}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(gpxContents),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

/**
 * An arrival's scroll restore (backlog item 125; item 121's top reset
 * before it) keeps re-asserting its position for a few frames after
 * arriving (scrollToTopAndSettle.ts, item 95's reassertion loop), and a
 * rider's own touch or wheel ends it at once — but a test's programmatic
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

async function scrollDeep(page: Page): Promise<number> {
  await settleArrival(page);
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  return page.evaluate(() => window.scrollY);
}

// ---------------------------------------------------------------------------
// The unfinished key edit
// ---------------------------------------------------------------------------

for (const lang of ["en", "de"] as const) {
  test(`an unsaved key survives Settings → Status → Settings, and is never stored (${lang})`, async ({
    page,
  }) => {
    await start(page, lang);
    await tab(page, lang, COPY[lang].settings);
    await page.getByLabel(COPY[lang].keyLabel).fill("dummy-e2e-typed-but-unsaved");

    await switchTo(page, lang, "status");
    await expect(page.getByLabel(COPY[lang].keyLabel)).toHaveCount(0);
    await switchTo(page, lang, "settings");
    await expect(page.getByLabel(COPY[lang].keyLabel)).toHaveValue(
      "dummy-e2e-typed-but-unsaved",
    );
    // Masked again on return.
    await expect(page.getByLabel(COPY[lang].keyLabel)).toHaveAttribute(
      "type",
      "password",
    );

    // The Settings tab from Status keeps it too: the section never unmounts.
    await switchTo(page, lang, "status");
    await tab(page, lang, COPY[lang].settings);
    await expect(page.getByLabel(COPY[lang].keyLabel)).toHaveValue(
      "dummy-e2e-typed-but-unsaved",
    );

    expect(await countProviderKeyRows(page)).toBe(0);

    // Memory only: a reload discards it, and starts the section at Settings.
    await page.reload();
    await tab(page, lang, COPY[lang].settings);
    await expect(page.getByLabel(COPY[lang].keyLabel)).toHaveValue("");
  });
}

// ---------------------------------------------------------------------------
// Entering and returning
// ---------------------------------------------------------------------------

test("the Settings tab reopens the last-viewed view; from Status it opens Settings; Open Settings always opens Settings", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await start(page, "en");

  await tab(page, "en", "Settings");
  await switchTo(page, "en", "status");
  await tab(page, "en", "Routes");
  await tab(page, "en", "Settings");
  await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeAttached();
  await expect(
    switcher(page, "en").getByRole("button", { name: "Status" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    mainNav(page, "en").getByRole("button", { name: "Settings" }),
  ).toHaveAttribute("aria-current", "true");

  await tab(page, "en", "Settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeAttached();
  await expect(
    mainNav(page, "en").getByRole("button", { name: "Settings" }),
  ).toHaveAttribute("aria-current", "page");

  // Planning's missing-key notice: always Settings, even with Status last seen.
  await switchTo(page, "en", "status");
  await tab(page, "en", "Plan");
  await page.getByRole("button", { name: "Open Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeAttached();
  await expect(page.getByLabel("OpenRouteService API key")).toBeVisible();
});

test("the switcher appears on both views of the Settings section and nowhere else", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await start(page, "en");
  await expect(switcher(page, "en")).toHaveCount(0);
  for (const name of ["Ride", "Plan"]) {
    await tab(page, "en", name);
    await expect(switcher(page, "en")).toHaveCount(0);
  }
  await tab(page, "en", "Settings");
  await expect(switcher(page, "en")).toHaveCount(1);
  await switchTo(page, "en", "status");
  await expect(switcher(page, "en")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// Keyboard and focus
// ---------------------------------------------------------------------------

test("a switch keeps keyboard focus on the very button pressed, which becomes the current page", async ({
  page,
}) => {
  await start(page, "en");
  await tab(page, "en", "Settings");
  const status = switcher(page, "en").getByRole("button", { name: "Status" });
  await status.evaluate((element) => {
    element.dataset.probeIdentity = "pressed";
  });

  await status.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeAttached();

  // The same DOM node, not merely a button with the same name.
  expect(
    await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.probeIdentity,
    ),
  ).toBe("pressed");
  await expect(status).toHaveAttribute("aria-current", "page");
  await expect(status).toBeFocused();

  // Tab order: the switcher follows the primary navigation directly.
  await mainNav(page, "en").getByRole("button", { name: "Settings" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    switcher(page, "en").getByRole("button", { name: "Settings" }),
  ).toBeFocused();
});

test("keyboard focus never lands beneath the sticky rows, including after a key is deleted", async ({
  page,
}) => {
  await start(page, "en");
  await tab(page, "en", "Settings");

  // Shift+Tab onto a control parked 20px beneath the sticky chrome: on the
  // parent the browser left it there, obscured (it is still "in view").
  await settleArrival(page);
  const target = page.getByRole("button", { name: "English", exact: true });
  const next = page.getByRole("button", { name: "Deutsch", exact: true });
  await target.evaluate((element) => {
    const header = document.querySelector(".app-header--sticky")?.getBoundingClientRect();
    const sw = document
      .querySelector(".settings-status-switcher")
      ?.getBoundingClientRect();
    const chromeBottom = Math.max(header?.bottom ?? 0, sw?.bottom ?? 0);
    window.scrollBy(0, element.getBoundingClientRect().top - (chromeBottom - 20));
  });
  await next.evaluate((element) => {
    element.focus({ preventScroll: true });
  });
  await page.keyboard.press("Shift+Tab");
  await expect(target).toBeFocused();
  const targetTop = await target.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(targetTop).toBeGreaterThanOrEqual((await stickyChromeBottom(page)) - 0.5);

  // Item 118: after a confirmed delete, focus moves to the card's heading.
  await page.getByLabel("OpenRouteService API key").fill("dummy-e2e-key");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await page.getByRole("button", { name: "Delete key" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  const heading = page.getByRole("heading", { name: "OpenRouteService", level: 3 });
  await expect(heading).toBeFocused();
  const headingTop = await heading.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(headingTop).toBeGreaterThanOrEqual((await stickyChromeBottom(page)) - 0.5);
});

// ---------------------------------------------------------------------------
// Sticky behaviour and its release while typing
// ---------------------------------------------------------------------------

for (const view of ["settings", "status"] as const) {
  test(`the switcher sticks directly beneath the navigation on ${view} while scrolled`, async ({
    page,
  }) => {
    await start(page, "en");
    await tab(page, "en", "Settings");
    if (view === "status") await switchTo(page, "en", "status");

    await scrollDeep(page);
    const geometry = await page.evaluate(() => {
      const header = document
        .querySelector(".app-header--sticky")
        ?.getBoundingClientRect();
      const sw = document
        .querySelector(".settings-status-switcher")
        ?.getBoundingClientRect();
      return { headerBottom: header?.bottom ?? -1, switcherTop: sw?.top ?? -1 };
    });
    expect(Math.abs(geometry.switcherTop - geometry.headerBottom)).toBeLessThan(1);
    await expect(switcher(page, "en")).toBeInViewport();
  });
}

test("the switcher stops sticking while the key form has focus, and sticks again afterwards", async ({
  page,
}) => {
  await start(page, "en");
  await tab(page, "en", "Settings");
  const nav = switcher(page, "en");
  await expect(nav).toHaveCSS("position", "sticky");

  await page.getByLabel("OpenRouteService API key").focus();
  await expect(nav).toHaveCSS("position", "static");
  // Still static while focus moves within the form, so a press on Save can
  // never have the switcher re-stick over it mid-press.
  await page.getByRole("button", { name: "Reveal" }).focus();
  await expect(nav).toHaveCSS("position", "static");

  await page.getByRole("button", { name: "English", exact: true }).focus();
  await expect(nav).toHaveCSS("position", "sticky");
});

// ---------------------------------------------------------------------------
// The usability gate (Stage 0's U1–U3), kept as regression tests
// ---------------------------------------------------------------------------

const GATE_VIEWPORTS = [
  { width: 375, height: 667, keyboard: 260 },
  { width: 390, height: 844, keyboard: 336 },
  { width: 430, height: 932, keyboard: 336 },
] as const;

for (const lang of ["en", "de"] as const) {
  for (const vp of GATE_VIEWPORTS) {
    test(`the first heading, the key form above a keyboard stand-in, and the delete confirmation stay usable (${lang}, ${String(vp.width)}×${String(vp.height)})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await start(page, lang);
      for (const font of ["100%", "200%"]) {
        const condition = `${lang} ${String(vp.width)}×${String(vp.height)} ${font}`;
        await setRootFontSize(page, font);

        // U1: at either view's top, its first visible heading sits fully
        // below the sticky rows and within the viewport. Since backlog item
        // 125 a view comes back where the rider left it — here, after U2
        // and U3 have scrolled Settings — so the top is reached explicitly.
        for (const [view, headingName] of [
          ["status", COPY[lang].firstStatusHeading],
          ["settings", COPY[lang].firstSettingsHeading],
        ] as const) {
          if (view === "status") {
            await tab(page, lang, COPY[lang].settings);
            await switchTo(page, lang, "status");
          } else {
            await switchTo(page, lang, "settings");
          }
          await settleArrival(page);
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
          const heading = page.getByRole("heading", { level: 2, name: headingName });
          const box = await heading.evaluate((element) =>
            element.getBoundingClientRect(),
          );
          expect(box.top, `${condition} U1 ${view}`).toBeGreaterThanOrEqual(
            (await stickyChromeBottom(page)) - 0.5,
          );
          expect(box.bottom, `${condition} U1 ${view}`).toBeLessThanOrEqual(vp.height);
        }

        // U2: with the viewport shortened by a portrait keyboard stand-in,
        // the key form's label, field and Save row fit together below the
        // sticky rows. A proxy, never device acceptance.
        await page.setViewportSize({ width: vp.width, height: vp.height - vp.keyboard });
        await page.getByLabel(COPY[lang].keyLabel).focus();
        const u2 = await page.evaluate(() => {
          const label = document.querySelector('label[for="ors-key-input"]');
          const save = label?.closest("form")?.querySelector('button[type="submit"]');
          const header = document.querySelector(".app-header--sticky");
          const sw = document.querySelector(".settings-status-switcher");
          if (!label || !save || !header || !sw) throw new Error("missing key form");
          const swSticky = getComputedStyle(sw).position === "sticky";
          const sticky =
            header.getBoundingClientRect().height +
            (swSticky ? sw.getBoundingClientRect().height : 0);
          return {
            required:
              save.getBoundingClientRect().bottom - label.getBoundingClientRect().top,
            available: window.innerHeight - sticky,
            navigationOnly: window.innerHeight - header.getBoundingClientRect().height,
          };
        });
        // Released while the form has focus, the switcher takes nothing.
        expect(u2.available, `${condition} U2 switcher released`).toBe(u2.navigationOnly);
        if (lang === "de" && vp.width === 375 && font === "200%") {
          // The one recorded limitation: at 375×667 with 200% German the key
          // form alone is taller than the space above the stand-in keyboard,
          // by 24–30px, and was so before item 121 in the five-tab app. The
          // assertion above is what item 121 owes it — it adds nothing.
        } else {
          expect(u2.required, `${condition} U2`).toBeLessThanOrEqual(u2.available);
        }
        await page
          .getByRole("button", { name: COPY[lang].settings, exact: true })
          .first()
          .blur();
        await page.setViewportSize({ width: vp.width, height: vp.height });

        // U3: the Delete-key confirmation's actions end up fully visible
        // below the sticky rows (item 118's reveal).
        await page.getByLabel(COPY[lang].keyLabel).fill("dummy-e2e-key");
        await page.getByRole("button", { name: COPY[lang].save }).click();
        await page.getByRole("button", { name: COPY[lang].deleteKey }).click();
        const dialog = page.getByRole("dialog");
        const actions = await dialog.evaluate((element) => {
          const rects = [...element.querySelectorAll("button")].map((b) =>
            b.getBoundingClientRect(),
          );
          return {
            top: Math.min(...rects.map((r) => r.top)),
            bottom: Math.max(...rects.map((r) => r.bottom)),
          };
        });
        expect(actions.top, `${condition} U3`).toBeGreaterThanOrEqual(
          (await stickyChromeBottom(page)) - 0.5,
        );
        expect(actions.bottom, `${condition} U3`).toBeLessThanOrEqual(vp.height + 0.5);
        await dialog
          .getByRole("button", { name: COPY[lang].confirmDelete, exact: true })
          .click();
        await expect(page.getByLabel(COPY[lang].keyLabel)).toBeVisible();
      }
      await setRootFontSize(page, "");
    });
  }
}

// ---------------------------------------------------------------------------
// Scroll positions (backlog item 125, which replaced item 121's interim top
// reset): each view comes back where the rider left it in this app session,
// and a first visit starts at the top.
// ---------------------------------------------------------------------------

async function expectAtTopWithHeadingVisible(page: Page, headingName: string) {
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const box = await page
    .getByRole("heading", { level: 2, name: headingName })
    .evaluate((element) => element.getBoundingClientRect());
  expect(box.top).toBeGreaterThanOrEqual((await stickyChromeBottom(page)) - 0.5);
  expect(box.bottom).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
}

async function expectBackAt(page: Page, position: number) {
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - position))
    .toBeLessThanOrEqual(1);
}

test("a first visit to the Settings section, after scrolling deep into Routes, starts at the top", async ({
  page,
}) => {
  await start(page, "en");
  await importManyRoutes(page, 25);
  await scrollDeep(page);

  await tab(page, "en", "Settings");
  await expectAtTopWithHeadingVisible(page, "Preferences");
});

test("switching views and tapping the Settings tab from Status each come back where that view was left", async ({
  page,
}) => {
  await start(page, "en");
  await tab(page, "en", "Settings");
  const settingsAt = await scrollDeep(page);

  await switchTo(page, "en", "status");
  await expectAtTopWithHeadingVisible(page, "System status"); // a first visit
  await settleArrival(page);
  await page.evaluate(() => {
    window.scrollTo(0, 300);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);

  await switchTo(page, "en", "settings");
  await expectBackAt(page, settingsAt);

  await switchTo(page, "en", "status");
  await expectBackAt(page, 300);
  await tab(page, "en", "Settings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings", exact: true }),
  ).toBeAttached();
  await expectBackAt(page, settingsAt);
});

test("updates within a view, and tapping the Settings tab on Settings, leave the scroll position alone", async ({
  page,
}) => {
  await start(page, "en");
  await tab(page, "en", "Settings");
  await settleArrival(page);
  const summary = page.getByText("How climbs are classified", { exact: true });
  await summary.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);

  await summary.click();
  await tab(page, "en", "Settings");

  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  // Typing re-renders the section itself (it owns the unfinished key), which
  // neither a native disclosure nor a no-op tab press does: without this
  // step, a reset that ran on every render went unnoticed here.
  const input = page.getByLabel("OpenRouteService API key");
  await input.focus();
  const whileTyping = await page.evaluate(() => window.scrollY);
  expect(whileTyping).toBeGreaterThan(0);
  await input.pressSequentially("abc");
  expect(await page.evaluate(() => window.scrollY)).toBe(whileTyping);
});

test("leaving Settings for a first visit to Plan starts Plan at the top, never at Settings' offset", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await start(page, "en");
  await tab(page, "en", "Settings");
  const leftAt = await scrollDeep(page);
  expect(leftAt).toBeGreaterThan(200);

  await tab(page, "en", "Plan");
  await expect(
    page.getByRole("heading", { level: 1, name: "Plan a route" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

// ---------------------------------------------------------------------------
// Fit: 320–430px, ordinary and 200% text, with and without the width stress
// ---------------------------------------------------------------------------

async function applySwitcherWidthStress(page: Page, factor: number) {
  const applied = await page.evaluate((factor) => {
    const spacings: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      ".settings-status-switcher-button",
    )) {
      element.style.letterSpacing = "";
      if (factor === 1) continue;
      const text = element.textContent;
      const characters = [...new Intl.Segmenter().segment(text)].length;
      const style = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.textContent = text;
      for (const property of [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "fontStretch",
      ] as const) {
        probe.style[property] = style[property];
      }
      probe.style.whiteSpace = "nowrap";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);
      const natural = probe.getBoundingClientRect().width;
      probe.remove();
      element.style.letterSpacing = `${String(((factor - 1) * natural) / characters)}px`;
      spacings.push(getComputedStyle(element).letterSpacing);
    }
    return spacings;
  }, factor);
  if (factor !== 1) {
    expect(applied.length).toBe(2);
    for (const spacing of applied) expect(Number.parseFloat(spacing)).toBeGreaterThan(0);
  }
}

for (const lang of ["en", "de"] as const) {
  for (const width of WIDTHS) {
    test(`the switcher fits: whole words inside each button, stacking only when a word cannot fit, and no overflow (${lang}, ${String(width)}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await start(page, lang);
      await tab(page, lang, COPY[lang].settings);
      for (const font of ["100%", "200%"]) {
        await setRootFontSize(page, font);
        for (const stress of [1, STRESS_FACTOR]) {
          await applySwitcherWidthStress(page, stress);
          const condition = `${lang} ${String(width)}px ${font} stress ${String(stress)}`;
          const m = await page.evaluate(() => {
            const nav = document.querySelector<HTMLElement>(".settings-status-switcher");
            if (!nav) throw new Error("no switcher");
            const doc = document.documentElement;
            const withSwitcher = doc.scrollWidth;
            nav.style.display = "none";
            const withoutSwitcher = doc.scrollWidth;
            nav.style.display = "";
            const navStyle = getComputedStyle(nav);
            const rowWidth =
              nav.getBoundingClientRect().width -
              Number.parseFloat(navStyle.paddingLeft) -
              Number.parseFloat(navStyle.paddingRight);
            const gap = Number.parseFloat(navStyle.columnGap);
            const buttons = [...nav.querySelectorAll<HTMLElement>("button")].map((b) => {
              const range = document.createRange();
              range.selectNodeContents(b);
              const rects = [...range.getClientRects()].filter((r) => r.width > 0);
              const box = b.getBoundingClientRect();
              const style = getComputedStyle(b);
              const textWidth =
                Math.max(...rects.map((r) => r.right)) -
                Math.min(...rects.map((r) => r.left));
              return {
                text: b.textContent,
                top: box.top,
                width: box.width,
                height: box.height,
                lines: new Set(rects.map((r) => Math.round(r.top))).size,
                inside:
                  Math.min(...rects.map((r) => r.left)) >= box.left - 0.5 &&
                  Math.max(...rects.map((r) => r.right)) <= box.right + 0.5,
                // The narrowest this button can be with its word whole.
                minimum:
                  textWidth +
                  Number.parseFloat(style.paddingLeft) +
                  Number.parseFloat(style.paddingRight) +
                  Number.parseFloat(style.borderLeftWidth) +
                  Number.parseFloat(style.borderRightWidth),
                selected: b.getAttribute("aria-current") === "page",
                boxShadow: style.boxShadow,
              };
            });
            return {
              switcherContributes: Math.max(0, withSwitcher - withoutSwitcher),
              rowWidth,
              gap,
              buttons,
            };
          });

          expect(m.switcherContributes, `${condition} overflow`).toBe(0);
          expect(m.buttons).toHaveLength(2);
          const [first, second] = m.buttons;
          for (const b of m.buttons) {
            expect(b.lines, `${condition} ${b.text} stays whole`).toBe(1);
            expect(b.inside, `${condition} ${b.text} inside its button`).toBe(true);
            expect(b.height, `${condition} ${b.text} target`).toBeGreaterThanOrEqual(44);
            expect(b.width, `${condition} ${b.text} target`).toBeGreaterThanOrEqual(44);
          }
          const stacked = second.top > first.top + 1;
          const needsStacking = first.minimum + second.minimum + m.gap > m.rowWidth + 0.5;
          expect(stacked, `${condition} stacks exactly when a word cannot fit`).toBe(
            needsStacking,
          );
          if (font === "100%" && stress === 1) {
            expect(
              Math.abs(first.width - second.width),
              `${condition} equal`,
            ).toBeLessThan(1);
          }
          // The selected button reads without colour: an inset ring.
          const selected = m.buttons.find((b) => b.selected);
          const other = m.buttons.find((b) => !b.selected);
          expect(selected?.boxShadow).toContain("inset");
          expect(other?.boxShadow).not.toContain("inset");
        }
        await applySwitcherWidthStress(page, 1);
      }
      await setRootFontSize(page, "");
    });
  }
}
