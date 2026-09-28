import { expect, test, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

/**
 * Backlog item 113, stage 1. Browser coverage of the language boundary's
 * *outcomes* — never of its timing. The 250ms bootstrap bound is proved
 * deterministically with fake timers in src/i18n/bootstrap.test.ts; a
 * wall-clock assertion here would be brittle under CI load, which is
 * precisely the kind of flake this repository has already spent an
 * investigation on.
 */

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";

/** Writes the app-preferences singleton directly, before the app boots. */
async function seedLanguagePreference(page: Page, language: string): Promise<void> {
  await page.evaluate(
    async ({ dbName, language }) => {
      await new Promise<void>((resolve, reject) => {
        // Dexie stores schema version N as IndexedDB version N*10.
        const request = indexedDB.open(dbName, 50);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("appPreferences")) {
            db.createObjectStore("appPreferences", { keyPath: "id" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("appPreferences", "readwrite");
          tx.objectStore("appPreferences").put({ id: "app", language });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error(tx.error?.message ?? "IndexedDB request failed"));
          };
        };
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "IndexedDB request failed"));
        };
      });
    },
    { dbName: DB_NAME, language },
  );
}

async function readLanguagePreference(page: Page): Promise<string | undefined> {
  return page.evaluate(async (dbName) => {
    return new Promise<string | undefined>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("appPreferences")) {
          db.close();
          resolve(undefined);
          return;
        }
        const tx = db.transaction("appPreferences", "readonly");
        const get = tx.objectStore("appPreferences").get("app");
        get.onsuccess = () => {
          const row = get.result as { language?: string } | undefined;
          db.close();
          resolve(row?.language);
        };
        get.onerror = () => {
          reject(new Error(get.error?.message ?? "IndexedDB request failed"));
        };
      };
      request.onerror = () => {
        reject(new Error(request.error?.message ?? "IndexedDB request failed"));
      };
    });
  }, DB_NAME);
}

test("declares en-GB on the document and renders the English navigation", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Routes" })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-GB");

  // Backlog item 121: four destinations; Status is reached through the
  // Settings/Status switcher instead.
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const label of ["Routes", "Ride", "Plan", "Settings"]) {
    await expect(nav.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(nav.getByRole("button", { name: "Status" })).toHaveCount(0);
});

test("the generated manifest declares the same language the document does", async ({
  page,
}) => {
  // vite-plugin-pwa defaults this to a bare "en", which silently disagreed
  // with index.html's "en-GB". It is authored explicitly now, and the two
  // must not be allowed to drift apart again.
  await page.goto("./");
  const documentLang = await page.evaluate(() => document.documentElement.lang);
  const manifest = await page.evaluate(async () => {
    const response = await fetch("manifest.webmanifest");
    return (await response.json()) as { lang?: string };
  });
  expect(manifest.lang).toBe("en-GB");
  expect(manifest.lang).toBe(documentLang);
});

test("a stored German preference renders German across a genuine reload", async ({
  page,
}) => {
  // Backlog item 113 stage 6b. Through stages 1 to 6a this asserted the
  // opposite: German had no catalogue, so the gate clamped it to English.
  // What has not changed is that the stored row is never rewritten by
  // being read — which is asserted here as a guard against a future read
  // path that writes, and proved where it can actually fail in
  // src/storage/appPreferencesRepository.test.ts.
  await installLocalMapStyle(page);
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Routes" })).toBeVisible();

  await seedLanguagePreference(page, "de");
  await page.reload();

  await expect(page.getByRole("button", { name: "Einstellungen" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("de");
  expect(await readLanguagePreference(page)).toBe("de");
});

test("choosing a language applies it immediately and survives a reload", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Settings" }).click();

  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("de");
  expect(await readLanguagePreference(page)).toBe("de");

  await page.reload();
  await expect(page.getByRole("button", { name: "Einstellungen" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("de");

  // And back, so the control is not one-way.
  await page.getByRole("button", { name: "Einstellungen" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-GB");
  expect(await readLanguagePreference(page)).toBe("en");
});

test("an explicit choice beats the device language", async ({ browser }) => {
  // The override branch, in a real browser with a genuinely German
  // navigator rather than a seeded row.
  const context = await browser.newContext({
    locale: "de-DE",
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await installLocalMapStyle(page);
  await page.goto("./");

  await expect(page.getByRole("button", { name: "Einstellungen" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("de");

  await page.getByRole("button", { name: "Einstellungen" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-GB");
  await context.close();
});

// Backlog item 121: the four-destination navigation, measured from 320 to
// 430px. 320px is narrower than any phone iOS 26 supports, and is kept as
// a stress floor, as item 113 did.
const NAV_WIDTHS = [320, 360, 375, 390, 414, 430] as const;
const STRESS_FACTOR = 1.12;

/**
 * Item 113's device-width stress: widens each label by 12% of its own
 * natural width with a per-element letter-spacing, through CSSOM since the
 * CSP ignores an injected <style>, and reads the computed value back so a
 * no-op can never pass for a stressed run. The pinned container's fonts do
 * not predict iOS widths (on the iPhone 13 `Einstellungen` wrapped where
 * this container kept it on one line), so a stressed run is a regression
 * guard, never proof of fit on the device. `factor` 1 clears the stress.
 */
async function applyNavWidthStress(page: Page, factor: number) {
  const applied = await page.evaluate((factor) => {
    const spacings: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      ".main-nav-button > span",
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
    expect(applied.length).toBe(4);
    for (const spacing of applied) expect(Number.parseFloat(spacing)).toBeGreaterThan(0);
  }
}

async function measureNavigation(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".main-nav");
    if (!nav) throw new Error("no navigation");
    const doc = document.documentElement;
    const withNav = doc.scrollWidth;
    nav.style.display = "none";
    const withoutNav = doc.scrollWidth;
    nav.style.display = "";
    const buttons = [...nav.querySelectorAll(".main-nav-button")];
    return {
      navContributes: Math.max(0, withNav - withoutNav),
      documentOverflow: withNav - doc.clientWidth,
      labels: buttons.map((b) => {
        const span = b.querySelector("span");
        if (!span) throw new Error("no label span");
        // A Range, not scrollWidth, which is an integer and never smaller
        // than the element's own box (item 111's recorded trap).
        const range = document.createRange();
        range.selectNodeContents(span);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
        const box = b.getBoundingClientRect();
        const icon = b.querySelector("svg")?.getBoundingClientRect();
        return {
          text: span.textContent,
          lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
          // Inside its OWN tab (backlog item 121), not merely the viewport.
          insideTab:
            Math.min(...rects.map((rect) => rect.left)) >= box.left - 0.5 &&
            Math.max(...rects.map((rect) => rect.right)) <= box.right + 0.5,
          // The label must be complete: no ellipsis, no clipping.
          clipped: span.scrollWidth > Math.ceil(span.clientWidth) + 1,
          // A wrapped label must never sit on top of its icon.
          overlapsIcon: icon
            ? span.getBoundingClientRect().top < icon.bottom - 0.5
            : false,
          target: Math.min(box.width, box.height),
        };
      }),
    };
  });
}

for (const width of NAV_WIDTHS) {
  test(`the German navigation fits without horizontal overflow, at ordinary and 200% text (${String(width)}px)`, async ({
    page,
  }) => {
    // The measured containment rule, re-measured by item 121 for four tabs.
    // `Einstellungen` is 131px wide at 200% root text against a 73–101px
    // tab, so without the `:lang(de)` wrap rule German contributes 23–50px
    // of document overflow; at 200% it still breaks inside its own tab,
    // which item 113 accepted.
    await page.setViewportSize({ width, height: 844 });
    await installLocalMapStyle(page);
    await page.goto("./");
    await seedLanguagePreference(page, "de");
    await page.reload();
    await expect(page.getByRole("button", { name: "Einstellungen" })).toBeVisible();

    for (const rootFontSize of ["100%", "200%"]) {
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = value;
      }, rootFontSize);
      for (const stress of [1, STRESS_FACTOR]) {
        await applyNavWidthStress(page, stress);
        const measured = await measureNavigation(page);
        const condition = `${rootFontSize}, stress ${String(stress)}`;

        expect(measured.navContributes, `${condition} nav contribution`).toBe(0);
        if (width === 390) {
          expect(
            measured.documentOverflow,
            `${condition} document overflow`,
          ).toBeLessThanOrEqual(0);
        }
        expect(measured.labels.map((label) => label.text)).toEqual([
          "Routen",
          "Fahren",
          "Planen",
          "Einstellungen",
        ]);
        for (const label of measured.labels) {
          expect(label.insideTab, `${condition} ${label.text} inside its tab`).toBe(true);
          expect(label.clipped, `${condition} ${label.text} clipped`).toBe(false);
          expect(label.overlapsIcon, `${condition} ${label.text} over its icon`).toBe(
            false,
          );
          expect(
            label.target,
            `${condition} ${label.text} target`,
          ).toBeGreaterThanOrEqual(44);
        }
        // Both halves of the rule are load-bearing. Without the padding half
        // the wrap rule breaks `Einstellungen` onto two lines at ORDINARY
        // text at 320px — an ordinary-German regression that no overflow
        // assertion would catch, since it overflows nothing.
        //
        // The stressed run is asserted from 360px, as item 113 did: at
        // 320px, narrower than any iOS 26 phone, the stressed label breaks
        // inside its tab, which the insideTab check above still covers.
        //
        // Container-only evidence. On the installed iPhone 13 (25 September
        // 2026, 0.4.41) `Einstellungen` wrapped its final "n" onto a second
        // line at ordinary text in the five-tab bar, against a 71.59px
        // content box where this container measured about 65.5px: its fonts
        // do not predict iOS widths. Item 121's four tabs give it a 91px tab
        // at 390px; the device recheck confirms it.
        if (rootFontSize === "100%" && (stress === 1 || width >= 360)) {
          expect(
            measured.labels.map((label) => label.lines),
            `${condition} German stays on one line at ordinary text`,
          ).toEqual([1, 1, 1, 1]);
        }
      }
      await applyNavWidthStress(page, 1);
    }

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
  });

  test(`every English label stays whole inside its own tab, and the German rule leaves English untouched (${String(width)}px)`, async ({
    page,
  }) => {
    // The negative control for `:lang(de)` scoping, and backlog item 121's
    // in-tab requirement: English must stay on one line, inside its own
    // tab, at both root sizes, stressed or not. On the parent, `Settings`
    // at 200% stuck out of its tab by up to 8.6px (320px, stressed); the
    // `min-width: auto` on .main-nav-button is what contains it now.
    await page.setViewportSize({ width, height: 844 });
    await installLocalMapStyle(page);
    await page.goto("./");
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

    for (const rootFontSize of ["100%", "200%"]) {
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = value;
      }, rootFontSize);
      for (const stress of [1, STRESS_FACTOR]) {
        await applyNavWidthStress(page, stress);
        const measured = await measureNavigation(page);
        const condition = `${rootFontSize}, stress ${String(stress)}`;
        expect(measured.navContributes, `${condition} nav contribution`).toBe(0);
        expect(measured.labels.map((label) => label.text)).toEqual([
          "Routes",
          "Ride",
          "Plan",
          "Settings",
        ]);
        expect(
          measured.labels.map((label) => label.lines),
          `${condition} English stays on one line`,
        ).toEqual([1, 1, 1, 1]);
        for (const label of measured.labels) {
          expect(label.insideTab, `${condition} ${label.text} inside its tab`).toBe(true);
          expect(
            label.target,
            `${condition} ${label.text} target`,
          ).toBeGreaterThanOrEqual(44);
        }
      }
      await applyNavWidthStress(page, 1);
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
  });
}

test("an unrecognised stored preference recovers to English without a crash", async ({
  page,
}) => {
  await installLocalMapStyle(page);
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Routes" })).toBeVisible();

  await seedLanguagePreference(page, "klingon");
  await page.reload();

  await expect(page.getByRole("button", { name: "Routes" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-GB");
});
