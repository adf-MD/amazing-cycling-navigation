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

test("a stored German preference still renders English across a genuine reload", async ({
  page,
}) => {
  // The supported-language gate, in a real browser and across a genuine
  // reload: German has no catalogue yet, so the effective language must be
  // English.
  //
  // What this test does NOT prove, stated rather than implied: that the
  // stored choice is *preserved* rather than clamped. A negative control
  // that made fromStoredAppPreferences clamp "de" to "device" left all
  // four tests in this file passing — because nothing writes the row back
  // on read, so the row survives either way. That property is proved where
  // it can actually fail, in src/storage/appPreferencesRepository.test.ts
  // and src/ui/shared/AppLanguageProvider.test.tsx, where the same control
  // fails four tests. The row assertion below is a guard against a future
  // read path that *does* write, not evidence for the resolution rule.
  await installLocalMapStyle(page);
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Routes" })).toBeVisible();

  await seedLanguagePreference(page, "de");
  await page.reload();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-GB");
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  expect(await readLanguagePreference(page)).toBe("de");
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
