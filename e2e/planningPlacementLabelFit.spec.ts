import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Item 113's 25 September 2026 follow-up. On the installed iPhone German
// "Wegpunkt hier setzen" wrapped onto two lines inside the map, covering
// more of it: the placement control's shrink-to-fit width was implicitly
// capped at half the map container by `left: 50%`. It now takes its
// natural single-line width, bounded by the container less a gutter.
//
// A regression guard in the pinned container, not proof of fit on iOS;
// the stressed runs widen the label by 12% (see
// e2e/germanRidingHeader.spec.ts for the calibration). Item 114 owns the
// separate 200%-text overlap with the attribution; this spec only records
// it, so any change in it is visible.

test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const STRESS_FACTOR = 1.12;
const GUTTER_PX = 16;
const COPY = {
  en: {
    plan: "Plan",
    add: "Add waypoint here",
    waypoint2: "Waypoint 2",
    move: "Move",
    moveHere: "Move waypoint 2 here",
  },
  de: {
    plan: "Planen",
    add: "Wegpunkt hier setzen",
    waypoint2: "Wegpunkt 2",
    move: "Verschieben",
    moveHere: "Wegpunkt 2 hierher verschieben",
  },
} as const;
type Language = keyof typeof COPY;

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

async function openPlanning(page: Page, context: BrowserContext, language: Language) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.goto("/");
  await seedLanguagePreference(page, language);
  await page.reload();
  await page.getByRole("button", { name: COPY[language].plan, exact: true }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  // The placement control is disabled until the one-time regional framing
  // settles, so its becoming enabled is the settle signal.
  await expect(page.getByRole("button", { name: COPY[language].add })).toBeEnabled({
    timeout: 15_000,
  });
}

interface Measurement {
  label: string;
  lines: number;
  naturalWidth: number;
  bound: number;
  bandPx: number;
  insideContainer: boolean;
  collisions: string[];
  attributionOverlapPx: number;
}

async function measureCallout(page: Page, stressed: boolean): Promise<Measurement> {
  return page.evaluate(
    ({ stressed, factor, gutter }) => {
      const callout = document.querySelector<HTMLElement>(".planning-crosshair-callout");
      const container = document.querySelector<HTMLElement>(".planning-map-container");
      if (!callout || !container) throw new Error("no placement control");
      callout.style.letterSpacing = "";
      if (stressed) {
        const probe = document.createElement("span");
        probe.textContent = callout.textContent;
        const style = getComputedStyle(callout);
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
        const characters = [...new Intl.Segmenter().segment(callout.textContent)].length;
        callout.style.letterSpacing = `${String(((factor - 1) * natural) / characters)}px`;
        if (getComputedStyle(callout).letterSpacing === "normal") {
          throw new Error("stress did not apply");
        }
      }

      const box = callout.getBoundingClientRect();
      const containerBox = container.getBoundingClientRect();
      // The isolation band is the box-shadow's spread: "rgb(…) 0px 0px 0px 4px".
      const shadow = getComputedStyle(callout).boxShadow;
      const spread = /(-?[\d.]+)px\s*$/.exec(shadow);
      const bandPx = spread ? Number.parseFloat(spread[1]) : 0;
      const footprint = {
        left: box.left - bandPx,
        right: box.right + bandPx,
        top: box.top - bandPx,
        bottom: box.bottom + bandPx,
      };

      const range = document.createRange();
      range.selectNodeContents(callout);
      const lines = new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top)),
      ).size;

      // The label's natural single-line border-box width, on a detached
      // copy so the live layout is never disturbed.
      const clone = callout.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.visibility = "hidden";
      clone.style.width = "max-content";
      clone.style.maxWidth = "none";
      clone.style.transform = "none";
      container.appendChild(clone);
      const naturalWidth = clone.getBoundingClientRect().width;
      clone.remove();

      const collisions: string[] = [];
      for (const selector of [
        ".planning-map-zoom-controls",
        ".planning-map-controls",
        ".planning-map-status-overlay",
        ".map-attribution",
      ]) {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          const other = element.getBoundingClientRect();
          if (other.width === 0 || other.height === 0) continue;
          const overlaps =
            footprint.left < other.right &&
            footprint.right > other.left &&
            footprint.top < other.bottom &&
            footprint.bottom > other.top;
          if (overlaps) collisions.push(selector);
        }
      }
      const attribution = document.querySelector<HTMLElement>(".map-attribution");
      const attributionBox = attribution?.getBoundingClientRect();
      const attributionOverlapPx = attributionBox
        ? Math.max(0, box.bottom - attributionBox.top)
        : 0;

      return {
        label: callout.textContent,
        lines,
        naturalWidth,
        bound: containerBox.width - 2 * gutter,
        bandPx,
        insideContainer:
          footprint.left >= containerBox.left - 1 &&
          footprint.right <= containerBox.right + 1 &&
          footprint.bottom <= containerBox.bottom + 1,
        collisions,
        attributionOverlapPx,
      };
    },
    { stressed, factor: STRESS_FACTOR, gutter: GUTTER_PX },
  );
}

function expectFits(measured: Measurement, context: string) {
  const report = `${context}: ${JSON.stringify(measured)}`;
  expect(measured.bandPx, report).toBe(4);
  expect(measured.insideContainer, report).toBe(true);
  expect(measured.collisions, report).toEqual([]);
  if (measured.naturalWidth <= measured.bound) {
    // A label that fits the bound is never wrapped.
    expect(measured.lines, report).toBe(1);
  }
}

for (const width of [320, 360, 390, 430] as const) {
  test.describe(`${String(width)}px portrait`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const language of ["en", "de"] as const) {
      test(`the placement control keeps a fitting label on one line (${language})`, async ({
        page,
        context,
      }) => {
        await openPlanning(page, context, language);
        const copy = COPY[language];
        const callout = page.locator(".planning-crosshair-callout");

        await expect(callout).toHaveText(copy.add);
        for (const stressed of [false, true]) {
          const measured = await measureCallout(page, stressed);
          test.info().annotations.push({
            type: `add${stressed ? " stressed" : ""}`,
            description: JSON.stringify(measured),
          });
          expectFits(measured, `add${stressed ? ", stressed" : ""}`);
        }
        if (width === 390) {
          // The reported case: fits on one line at the iPhone 13's width.
          expect((await measureCallout(page, false)).lines).toBe(1);
        }

        // The longer Move label, for waypoint 2.
        await callout.click();
        await callout.click();
        await page.getByRole("button", { name: copy.waypoint2, exact: true }).click();
        await page
          .getByRole("listitem")
          .filter({
            has: page.getByRole("button", { name: copy.waypoint2, exact: true }),
          })
          .getByRole("button", { name: copy.move, exact: true })
          .click();
        await expect(callout).toHaveText(copy.moveHere);
        for (const stressed of [false, true]) {
          const measured = await measureCallout(page, stressed);
          test.info().annotations.push({
            type: `move${stressed ? " stressed" : ""}`,
            description: JSON.stringify(measured),
          });
          expectFits(measured, `move${stressed ? ", stressed" : ""}`);
        }

        if (width === 390) {
          // Recorded, not asserted: item 114's own 200%-text overlap.
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "200%";
          });
          const enlarged = await measureCallout(page, false);
          test.info().annotations.push({
            type: "200% text",
            description: JSON.stringify(enlarged),
          });
          expect(enlarged.insideContainer, JSON.stringify(enlarged)).toBe(true);
        }
      });
    }
  });
}
