import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Item 113's 25 September 2026 follow-up. iOS shows a closed native
// <select>'s chosen option on one line and never wraps it; on the
// installed iPhone the pre-ride climb selector read "Anstieg 1 ·
// Kategorie 2 · beginnt bei 12," with the distance hidden under the
// chevrons. The option is now category plus start distance only.
//
// This measures label text against the closed select's own content box,
// minus an allowance for the native chevrons, in the select's own
// computed font. It is a regression test, not proof of fit on iOS: the
// pinned container's fonts are not the iPhone's, so the "stressed" run
// widens each label by 12% (see e2e/germanRidingHeader.spec.ts for the
// calibration), and only the installed-iPhone recheck confirms the fit.
// The old labels are measured too, so the probe proves it would have
// caught the defect it guards.

test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const CHEVRON_ALLOWANCE_PX = 24;
const STRESS_FACTOR = 1.12;
const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/gradient-route.gpx", import.meta.url),
);

const COPY = {
  en: {
    selector: "Recognised climbs",
    // Every category at a three-digit start distance, the widest a route
    // of under a thousand kilometres can produce.
    worst: [
      "Category 4 · at 999.9\u00a0km",
      "uncat. · at 999.9\u00a0km",
      "HC · at 999.9\u00a0km",
    ],
    old: ["Climb 12 · Uncategorised · starts at 123.4\u00a0km"],
    fixtureOption: /^Category 3 · at 0\.\d\u00a0km$/,
  },
  de: {
    selector: "Erkannte Anstiege",
    worst: [
      "Kategorie 4 · ab km\u00a0999,9",
      "Nicht kat. · ab km\u00a0999,9",
      "HC · ab km\u00a0999,9",
    ],
    // The label the iPhone clipped, and the old worst case.
    old: [
      "Anstieg 1 · Kategorie 2 · beginnt bei 12,3\u00a0km",
      "Anstieg 12 · Nicht kategorisiert · beginnt bei 123,4\u00a0km",
    ],
    fixtureOption: /^Kategorie 3 · ab km\u00a00,\d$/,
  },
} as const;

/** Duplicated from language.spec.ts per this repo's no-shared-e2e-helpers
 * convention: writes the app-preferences singleton directly. */
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

/** Natural single-line widths of `labels` in the select's own font,
 * optionally widened by `factor` through letter-spacing, against the
 * select's content width minus the chevron allowance. */
async function measureLabels(page: Page, labels: readonly string[], factor: number) {
  return page.evaluate(
    ({ labels, factor, allowance }) => {
      const select = document.querySelector<HTMLSelectElement>(
        ".recognised-climb-select",
      );
      if (!select) throw new Error("no climb selector");
      const style = getComputedStyle(select);
      const available =
        select.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight) -
        allowance;
      const segmenter = new Intl.Segmenter();
      const widths = labels.map((label) => {
        const probe = document.createElement("span");
        probe.textContent = label;
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
        const characters = [...segmenter.segment(label)].length;
        probe.style.letterSpacing = `${String(((factor - 1) * natural) / characters)}px`;
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return { label, width };
      });
      return { available, widths };
    },
    { labels, factor, allowance: CHEVRON_ALLOWANCE_PX },
  );
}

for (const width of [320, 360, 390] as const) {
  test.describe(`${String(width)}px portrait`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const language of ["en", "de"] as const) {
      test(`the closed climb selector shows its whole option (${language})`, async ({
        page,
      }) => {
        await installLocalMapStyle(page);
        await page.goto("/");
        await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
        const routeButton = page.getByRole("button", {
          name: "gradient-route",
          exact: true,
        });
        await expect(routeButton).toBeVisible();
        await seedLanguagePreference(page, language);
        await page.reload();
        await page.getByRole("button", { name: "gradient-route", exact: true }).click();

        const copy = COPY[language];
        const select = page.getByRole("combobox", { name: copy.selector });
        await expect(select).toBeVisible();
        const fixtureOption = (await select.locator("option").allTextContents())[1] ?? "";
        expect(fixtureOption).toMatch(copy.fixtureOption);

        // Under the device-width stress this is asserted from 360px. At
        // 320px, narrower than any phone iOS 26 supports, the stressed
        // German worst case ("Kategorie 4 · ab km 999,9") overflows by
        // about 4px; it fits unstressed. Recorded in item 113's history.
        const factors = width >= 360 ? [1, STRESS_FACTOR] : [1];
        for (const factor of factors) {
          const current = await measureLabels(
            page,
            [fixtureOption, ...copy.worst],
            factor,
          );
          const report = JSON.stringify(current);
          test
            .info()
            .annotations.push({ type: `labels x${String(factor)}`, description: report });
          for (const entry of current.widths) {
            expect(
              entry.width,
              `${entry.label} at x${String(factor)}: ${report}`,
            ).toBeLessThanOrEqual(current.available);
          }
        }

        // The probe discriminates: the old labels overflow here, unstressed.
        const old = await measureLabels(page, copy.old, 1);
        for (const entry of old.widths) {
          expect(entry.width, `${entry.label}: ${JSON.stringify(old)}`).toBeGreaterThan(
            old.available,
          );
        }
      });
    }
  });
}
