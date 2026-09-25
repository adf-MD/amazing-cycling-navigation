import { expect, test, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Item 113's 25 September 2026 follow-up, a focused Planning control
// correction. On the installed iPhone the Route warnings rows had the
// browser's full list indent, content-width buttons of uneven widths with
// centred text, and a reserved slot whose ✓ on selection read as
// "approved". The bullets and list semantics stay; the ✓ and its slot are
// gone, and every button fills the width beside a compact gutter,
// start-aligned. A regression guard in the pinned container, not proof of
// fit on iOS.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DB_NAME = "amazing-cycling-navigation";
const COPY = {
  en: {
    plan: "Plan",
    calculate: "Calculate route",
    summary: "Route summary",
    warnings: "Route warnings",
    questionable: /^Questionable surface/,
  },
  de: {
    plan: "Planen",
    calculate: "Route berechnen",
    summary: "Routenübersicht",
    warnings: "Warnungen",
    questionable: /^Bedingt geeigneter Belag/,
  },
} as const;

// Two questionable surface stretches then paved, duplicated from
// planning.spec.ts per this repo's no-shared-e2e-helpers convention.
const MOCK_ORS_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        summary: { distance: 950, duration: 200, ascent: 999, descent: 999 },
        segments: [
          {
            distance: 950,
            duration: 200,
            steps: [
              {
                distance: 950,
                duration: 200,
                type: 0,
                instruction: "Head north",
                way_points: [0, 9],
              },
            ],
          },
        ],
        extras: {
          surface: {
            // Two adjacent, different questionable surface types (8
            // "Compacted Gravel", 10 "Gravel"), followed by paved — proves
            // they render as two distinct, separately selectable entries
            // rather than silently merging just because they share a
            // classification.
            values: [
              [0, 2, 8],
              [2, 4, 10],
              [4, 9, 1],
            ],
          },
        },
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.1, 51.5, 10],
          [-0.099, 51.5005, 12],
          [-0.098, 51.501, 15],
          [-0.097, 51.5015, 20],
          [-0.096, 51.502, 25],
          [-0.095, 51.5025, 22],
          [-0.094, 51.503, 18],
          [-0.093, 51.5035, 14],
          [-0.092, 51.504, 11],
          [-0.091, 51.5045, 9],
        ],
      },
    },
  ],
};

/** Writes the language preference and a dummy routing key directly, before
 * the app boots — duplicated shape from language.spec.ts. */
async function seedLanguageAndKey(page: Page, language: string): Promise<void> {
  await page.evaluate(
    async ({ dbName, language }) => {
      await new Promise<void>((resolve, reject) => {
        // Dexie stores schema version N as IndexedDB version N*10.
        const request = indexedDB.open(dbName, 50);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["appPreferences", "providerKeys"], "readwrite");
          tx.objectStore("appPreferences").put({ id: "app", language });
          tx.objectStore("providerKeys").put({
            id: "openrouteservice",
            apiKey: "dummy-e2e-key",
            savedAt: new Date().toISOString(),
          });
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

async function planRouteWithWarnings(page: Page, language: "en" | "de") {
  await installLocalMapStyle(page);
  await page.route(ORS_URL_GLOB, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(MOCK_ORS_RESPONSE),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Plan", exact: true })).toBeVisible();
  await seedLanguageAndKey(page, language);
  await page.reload();
  const copy = COPY[language];
  await page.getByRole("button", { name: copy.plan, exact: true }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const mapContainer = page.locator('[data-testid="map-container"]');
  await mapContainer.click({ position: { x: 100, y: 100 } });
  await mapContainer.click({ position: { x: 200, y: 150 } });
  const calculateButton = page.getByRole("button", { name: copy.calculate });
  await expect(calculateButton).toBeEnabled();
  await calculateButton.click();
  await expect(page.getByRole("region", { name: copy.summary })).toBeVisible({
    timeout: 15_000,
  });
  const list = page.getByRole("list", { name: copy.warnings });
  await expect(list.getByRole("button", { name: copy.questionable })).toHaveCount(2);
  return list;
}

async function measureRows(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>("ul.route-warning-list");
    if (!list) throw new Error("no warning list");
    const listStyle = getComputedStyle(list);
    const listBox = list.getBoundingClientRect();
    const contentLeft = listBox.left + Number.parseFloat(listStyle.paddingLeft);
    const contentRight = listBox.right - Number.parseFloat(listStyle.paddingRight);
    const items = [...list.querySelectorAll<HTMLElement>(":scope > li")];
    const rows = items.map((item) => {
      const button = item.querySelector<HTMLElement>(".route-warning-button");
      if (!button) throw new Error("no warning button");
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const buttonContentLeft =
        box.left +
        Number.parseFloat(style.borderLeftWidth) +
        Number.parseFloat(style.paddingLeft);
      const range = document.createRange();
      range.selectNodeContents(button);
      const firstLine = range.getClientRects().item(0);
      // The trailing "<number> m" pair, which must never split.
      const text = button.textContent;
      const pair = /\d+\s(m|km)\b(?!.*\d\s(m|km)\b)/.exec(text);
      let pairLines = 0;
      const node = button.firstChild;
      if (pair && node?.nodeType === Node.TEXT_NODE) {
        const pairRange = document.createRange();
        pairRange.setStart(node, pair.index);
        pairRange.setEnd(node, pair.index + pair[0].length);
        pairLines = new Set([...pairRange.getClientRects()].map((r) => Math.round(r.top)))
          .size;
      }
      return {
        text,
        selected: button.classList.contains("is-selected"),
        marker: getComputedStyle(item).listStyleType,
        left: box.left,
        right: box.right,
        labelStartOffset: (firstLine?.left ?? Number.NaN) - buttonContentLeft,
        textAlign: style.textAlign,
        boxShadow: style.boxShadow,
        pairLines,
      };
    });
    return {
      gutter: rows.length > 0 ? Math.min(...rows.map((r) => r.left)) - listBox.left : 0,
      contentLeft,
      contentRight,
      rows,
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

for (const width of [320, 390] as const) {
  test.describe(`${String(width)}px portrait`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const language of ["en", "de"] as const) {
      test(`warning rows keep bullets, fill the width and show no check mark (${language})`, async ({
        page,
      }) => {
        const list = await planRouteWithWarnings(page, language);
        const buttons = list.getByRole("button", { name: COPY[language].questionable });
        await buttons.nth(1).click();
        await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
        await expect(list).not.toContainText("✓");

        const measured = await measureRows(page);
        const report = JSON.stringify(measured, null, 1);
        test.info().annotations.push({ type: "rows", description: report });
        expect(measured.rows.length, report).toBeGreaterThanOrEqual(2);
        // A compact gutter, not the browser's 40px indent.
        expect(measured.gutter, report).toBeLessThanOrEqual(24);
        for (const row of measured.rows) {
          expect(row.marker, report).not.toBe("none");
          expect(Math.abs(row.left - measured.contentLeft), report).toBeLessThanOrEqual(
            0.5,
          );
          expect(Math.abs(row.right - measured.contentRight), report).toBeLessThanOrEqual(
            0.5,
          );
          expect(row.textAlign, report).toBe("start");
          expect(Math.abs(row.labelStartOffset), report).toBeLessThanOrEqual(1);
          expect(row.pairLines, `${row.text}: number and unit on one line`).toBe(1);
        }
        const selected = measured.rows.filter((row) => row.selected);
        expect(selected, report).toHaveLength(1);
        expect(selected[0]?.boxShadow, report).not.toBe("none");
        expect(measured.documentOverflow, report).toBeLessThanOrEqual(0);

        // Keyboard focus still shows the global focus ring.
        await buttons.nth(0).focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        const outline = await buttons.nth(0).evaluate((element) => ({
          focusVisible: element.matches(":focus-visible"),
          outlineStyle: getComputedStyle(element).outlineStyle,
        }));
        expect(outline.focusVisible).toBe(true);
        expect(outline.outlineStyle).not.toBe("none");
      });
    }
  });
}
