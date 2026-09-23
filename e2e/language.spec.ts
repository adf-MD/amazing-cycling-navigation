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

  for (const label of ["Routes", "Ride", "Plan", "Status", "Settings"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
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

test("the German navigation fits without horizontal overflow, at ordinary and 200% text", async ({
  page,
}) => {
  // The measured containment rule. `Einstellungen` is 131px wide at 200%
  // root text against an 87.6px budget, so without the `:lang(de)` rule
  // German contributes 22px of document overflow.
  await installLocalMapStyle(page);
  await page.goto("./");
  await seedLanguagePreference(page, "de");
  await page.reload();
  await expect(page.getByRole("button", { name: "Einstellungen" })).toBeVisible();

  for (const rootFontSize of ["100%", "200%"]) {
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = value;
    }, rootFontSize);

    const measured = await page.evaluate(() => {
      const nav = document.querySelector(".main-nav");
      if (!nav) throw new Error("no navigation");
      const doc = document.documentElement;
      const withNav = doc.scrollWidth;
      (nav as HTMLElement).style.display = "none";
      const withoutNav = doc.scrollWidth;
      (nav as HTMLElement).style.display = "";
      const buttons = [...nav.querySelectorAll(".main-nav-button")];
      return {
        navContributes: Math.max(0, withNav - withoutNav),
        documentOverflow: withNav - doc.clientWidth,
        smallestTarget: Math.min(
          ...buttons.map((b) => {
            const box = b.getBoundingClientRect();
            return Math.min(box.width, box.height);
          }),
        ),
        // The label must be complete: no ellipsis, no clipping.
        labels: buttons.map((b) => b.querySelector("span")?.textContent ?? ""),
        clipped: buttons.some((b) => {
          const span = b.querySelector("span");
          return span ? span.scrollWidth > Math.ceil(span.clientWidth) + 1 : false;
        }),
        lines: buttons.map((b) => {
          const span = b.querySelector("span");
          if (!span) return 0;
          const range = document.createRange();
          range.selectNodeContents(span);
          return range.getClientRects().length;
        }),
        iconOverlap: buttons.some((b) => {
          const icon = b.querySelector("svg");
          const span = b.querySelector("span");
          if (!icon || !span) return false;
          const iconBox = icon.getBoundingClientRect();
          const spanBox = span.getBoundingClientRect();
          return spanBox.top < iconBox.bottom - 0.5;
        }),
      };
    });

    expect(measured.navContributes, `${rootFontSize} nav contribution`).toBe(0);
    expect(
      measured.documentOverflow,
      `${rootFontSize} document overflow`,
    ).toBeLessThanOrEqual(0);
    expect(measured.labels).toEqual([
      "Routen",
      "Fahren",
      "Planen",
      "Status",
      "Einstellungen",
    ]);
    expect(measured.clipped, `${rootFontSize} clipped label`).toBe(false);
    expect(
      measured.smallestTarget,
      `${rootFontSize} touch target`,
    ).toBeGreaterThanOrEqual(44);
    // The wrapped label must never sit on top of its icon.
    expect(measured.iconOverlap, `${rootFontSize} label overlaps the icon`).toBe(false);
    if (rootFontSize === "100%") {
      // Both halves of the rule are load-bearing. Removing the padding
      // half alone leaves the wrap rule breaking `Einstellungen` onto two
      // lines at ORDINARY text — an ordinary-German regression that no
      // overflow assertion would catch, since it overflows nothing.
      expect(measured.lines, "German stays on one line at ordinary text").toEqual([
        1, 1, 1, 1, 1,
      ]);
    }
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
});

test("the English navigation is unchanged by the German rule", async ({ page }) => {
  // The negative control for `:lang(de)` scoping: English must stay on one
  // line at both root sizes, exactly as before this stage.
  await installLocalMapStyle(page);
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

  for (const rootFontSize of ["100%", "200%"]) {
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = value;
    }, rootFontSize);
    const measured = await page.evaluate(() => {
      const nav = document.querySelector(".main-nav");
      if (!nav) throw new Error("no navigation");
      const doc = document.documentElement;
      const withNav = doc.scrollWidth;
      (nav as HTMLElement).style.display = "none";
      const withoutNav = doc.scrollWidth;
      (nav as HTMLElement).style.display = "";
      const lines = [...nav.querySelectorAll(".main-nav-button span")].map((span) => {
        const range = document.createRange();
        range.selectNodeContents(span);
        return range.getClientRects().length;
      });
      return { navContributes: Math.max(0, withNav - withoutNav), lines };
    });
    expect(measured.navContributes, rootFontSize).toBe(0);
    expect(measured.lines, `${rootFontSize} English stays on one line`).toEqual([
      1, 1, 1, 1, 1,
    ]);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
});

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
