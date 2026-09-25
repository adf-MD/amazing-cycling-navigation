import { expect, test, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Item 113's 25 September 2026 follow-up. On the installed iPhone German
// "Gerätesprache" protruded past its button's border in Settings' Language
// card: the equal-share segmented control could shrink a button below its
// label's longest word. The shared .cycling-profile-* rule now restores
// that minimum and wraps a button onto another row only when it needs
// the room.
//
// Covered: Settings' Language and default-profile groups, and Planning's
// draft-profile group, in English and German, at four widths, at ordinary
// and 200% root text, with and without a 12% device-width stress (see
// e2e/germanRidingHeader.spec.ts for its calibration). These are
// regression tests, not proof of fit on iOS; the installed-iPhone recheck
// is what confirms it.

test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const STRESS_FACTOR = 1.12;
const COPY = {
  en: { settings: "Settings", plan: "Plan" },
  de: { settings: "Einstellungen", plan: "Planen" },
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

async function openIn(page: Page, language: Language, destination: "settings" | "plan") {
  await installLocalMapStyle(page);
  await page.goto("/");
  await seedLanguagePreference(page, language);
  await page.reload();
  await page
    .getByRole("button", { name: COPY[language][destination], exact: true })
    .click();
  if (destination === "plan") {
    await page
      .locator("details:has(.planning-routing-disclosure-header) > summary")
      .click();
  }
  await expect(
    page.locator('[role="group"].cycling-profile-group').first(),
  ).toBeVisible();
}

/**
 * Sets root text and stress, then measures every segmented group on the
 * page. Stress is a per-button letter-spacing calibrated from each
 * label's own natural width, set through CSSOM (the CSP ignores an
 * injected <style>) and read back so a no-op cannot pass.
 */
async function measureGroups(page: Page, rootFontSize: string, stressed: boolean) {
  return page.evaluate(
    ({ rootFontSize, stressed, factor }) => {
      document.documentElement.style.fontSize = rootFontSize;
      const groups = [
        ...document.querySelectorAll<HTMLElement>('[role="group"].cycling-profile-group'),
      ];
      const segmenter = new Intl.Segmenter();
      for (const button of document.querySelectorAll<HTMLElement>(
        ".cycling-profile-group button",
      )) {
        button.style.letterSpacing = "";
        if (!stressed) continue;
        const probe = document.createElement("span");
        probe.textContent = button.textContent;
        const style = getComputedStyle(button);
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
        const characters = [...segmenter.segment(button.textContent)].length;
        button.style.letterSpacing = `${String(((factor - 1) * natural) / characters)}px`;
        if (getComputedStyle(button).letterSpacing === "normal") {
          throw new Error("stress did not apply");
        }
      }

      // What the groups themselves contribute to horizontal overflow,
      // mirroring language.spec.ts's navigation measurement: at 320px and
      // 200% text the document already overflows for unrelated, older
      // reasons (the OpenRouteService heading, and in English the primary
      // navigation's Settings label), measured identically with the groups
      // hidden and recorded in current-status.md.
      const doc = document.documentElement;
      const withGroups = doc.scrollWidth;
      for (const group of groups) group.style.display = "none";
      const withoutGroups = doc.scrollWidth;
      for (const group of groups) group.style.display = "";
      const groupsContribute = Math.max(0, withGroups - withoutGroups);
      const reports = groups.map((group) => {
        const failures: string[] = [];
        const lines: string[] = [];
        const groupBox = group.getBoundingClientRect();
        const container = group.closest(".panel, details") ?? group.parentElement;
        if (!container) throw new Error("no container");
        const containerBox = container.getBoundingClientRect();
        if (
          groupBox.left < containerBox.left - 0.5 ||
          groupBox.right > containerBox.right + 0.5
        ) {
          failures.push("group outside its container");
        }
        const buttons = [...group.querySelectorAll<HTMLElement>("button")];
        const tops = new Set<number>();
        const minContents: number[] = [];
        for (const button of buttons) {
          const box = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const contentLeft =
            box.left +
            Number.parseFloat(style.borderLeftWidth) +
            Number.parseFloat(style.paddingLeft);
          const contentRight =
            box.right -
            Number.parseFloat(style.borderRightWidth) -
            Number.parseFloat(style.paddingRight);
          const range = document.createRange();
          range.selectNodeContents(button);
          const text = range.getBoundingClientRect();
          if (text.left < contentLeft - 0.5 || text.right > contentRight + 0.5) {
            failures.push(`label outside its button: ${button.textContent}`);
          }
          // No word may be split across lines unless it alone is wider
          // than the whole row: overflow-wrap: break-word would otherwise
          // keep a label "inside" its button by breaking it mid-word, the
          // failure a containment check alone cannot see.
          const textNode = button.firstChild;
          if (textNode?.nodeType === Node.TEXT_NODE) {
            const content = textNode.textContent ?? "";
            for (const match of content.matchAll(/\S+/g)) {
              const wordRange = document.createRange();
              wordRange.setStart(textNode, match.index);
              wordRange.setEnd(textNode, match.index + match[0].length);
              const rects = [...wordRange.getClientRects()];
              const lineCount = new Set(rects.map((rect) => Math.round(rect.top))).size;
              // Its natural width: the pieces of a broken word, summed.
              const wordWidth = rects.reduce((total, rect) => total + rect.width, 0);
              const rowWidth =
                groupBox.width -
                Number.parseFloat(style.borderLeftWidth) -
                Number.parseFloat(style.paddingLeft) -
                Number.parseFloat(style.borderRightWidth) -
                Number.parseFloat(style.paddingRight);
              if (lineCount > 1 && wordWidth <= rowWidth) {
                failures.push(`word broken across lines: ${match[0]}`);
              }
            }
          }
          if (box.left < groupBox.left - 0.5 || box.right > groupBox.right + 0.5) {
            failures.push(`button outside its group: ${button.textContent}`);
          }
          if (box.width < 44 || box.height < 44) {
            failures.push(`touch target below 44px: ${button.textContent}`);
          }
          tops.add(Math.round(box.top));
          // The button's own min-content width, measured on a detached
          // copy so the live layout is never disturbed.
          const clone = button.cloneNode(true) as HTMLElement;
          clone.style.width = "min-content";
          clone.style.position = "absolute";
          clone.style.visibility = "hidden";
          document.body.appendChild(clone);
          minContents.push(clone.getBoundingClientRect().width);
          clone.remove();
          lines.push(
            `${button.textContent} box ${box.left.toFixed(1)}–${box.right.toFixed(1)} text ${text.left.toFixed(1)}–${text.right.toFixed(1)}`,
          );
        }
        const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
        const share = (groupBox.width - gap * (buttons.length - 1)) / buttons.length;
        const everyMinimumFits = Math.max(...minContents) <= share + 0.5;
        if (everyMinimumFits) {
          // Where everything fits, the presentation is exactly as before:
          // one row of equal shares.
          if (tops.size !== 1) failures.push("wrapped although every label fits");
          const widths = buttons.map((button) => button.getBoundingClientRect().width);
          if (Math.max(...widths) - Math.min(...widths) > 1) {
            failures.push("unequal widths although every label fits");
          }
        }
        lines.push(
          `share ${share.toFixed(1)} min ${minContents.map((m) => m.toFixed(1)).join("/")} rows ${String(tops.size)}`,
        );
        return {
          ok: failures.length === 0,
          failures,
          rows: tops.size,
          details: lines.join("\n"),
        };
      });
      return { groupsContribute, reports };
    },
    { rootFontSize, stressed, factor: STRESS_FACTOR },
  );
}

const CONDITIONS = [
  { rootFontSize: "100%", stressed: false },
  { rootFontSize: "100%", stressed: true },
  { rootFontSize: "200%", stressed: false },
  { rootFontSize: "200%", stressed: true },
] as const;

for (const width of [320, 360, 390, 430] as const) {
  test.describe(`${String(width)}px portrait`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const language of ["en", "de"] as const) {
      for (const destination of ["settings", "plan"] as const) {
        test(`${destination} segmented choices contain their labels (${language})`, async ({
          page,
        }) => {
          await openIn(page, language, destination);
          const expectedGroups = destination === "settings" ? 2 : 1;
          for (const condition of CONDITIONS) {
            const label = `${condition.rootFontSize}${condition.stressed ? ", stressed" : ""}`;
            const measured = await measureGroups(
              page,
              condition.rootFontSize,
              condition.stressed,
            );
            test.info().annotations.push({
              type: label,
              description: measured.reports
                .map((report) => report.details)
                .join("\n---\n"),
            });
            expect(measured.reports, label).toHaveLength(expectedGroups);
            expect(measured.groupsContribute, `${label} overflow from the groups`).toBe(
              0,
            );
            for (const report of measured.reports) {
              expect(report.failures, `${label}\n${report.details}`).toEqual([]);
            }
          }
        });
      }
    }
  });
}
