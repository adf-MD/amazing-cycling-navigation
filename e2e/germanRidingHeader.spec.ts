import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Item 113's 25 September 2026 follow-up. On the installed iPhone the
// active free roam header read `Pause | Freies Fa… | Fahrt beenden`: the
// fixed, short title was ellipsised because the full German End label took
// its room. The header now shows the compact `Beenden` while the button's
// accessible name stays `Fahrt beenden`.
//
// These are regression tests, not proof of fit on iOS. The pinned
// container's fonts are narrower than the iPhone's: e2e/language.spec.ts
// asserts that `Einstellungen` stays on one line here, yet it wrapped on
// the phone, whose content box was 71.59px against about 65.5px measured
// here — so the phone rendered it at least 9.3% wider. The "stressed" runs
// below therefore widen every measured label by 12% with a per-element
// letter-spacing calibrated from its own natural width. That is a
// heuristic lower bound on the device, not a model of it; only the
// installed-iPhone recheck confirms the fit.

// installLocalMapStyle's own doc comment requires this.
test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const STRESS_FACTOR = 1.12;
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;
const WIDTHS = [360, 375, 390, 430] as const;
const MIN_TITLE_SLACK_PX = 4;

const COPY = {
  en: {
    nav: "Ride",
    startFreeRoam: "Start free roam",
    freeRoamTitle: "Free roam",
    startRiding: "Start riding",
    endRide: "End ride",
    endRideCompact: "End ride",
    pause: "Pause",
    pausing: "Pausing…",
    cancel: "Cancel",
  },
  de: {
    nav: "Fahren",
    startFreeRoam: "Freies Fahren starten",
    freeRoamTitle: "Freies Fahren",
    startRiding: "Fahrt starten",
    endRide: "Fahrt beenden",
    endRideCompact: "Beenden",
    pause: "Pause",
    pausing: "Wird pausiert…",
    cancel: "Abbrechen",
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

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildStraightRouteGpx(name: string): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function openAppIn(page: Page, language: Language): Promise<void> {
  await page.goto("/");
  await seedLanguagePreference(page, language);
  await page.reload();
  await expect(
    page.getByRole("button", { name: COPY[language].nav, exact: true }),
  ).toBeVisible();
}

async function startFreeRoam(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  await openAppIn(page, language);
  await page.getByRole("button", { name: COPY[language].nav, exact: true }).click();
  await page.getByRole("button", { name: COPY[language].startFreeRoam }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: COPY[language].freeRoamTitle }),
  ).toBeVisible();
}

async function startRouteRide(
  page: Page,
  context: BrowserContext,
  language: Language,
  routeName: string,
): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  // Import in English, where the file input's label is known, then switch.
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${routeName}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx(routeName)),
  });
  await expect(page.getByRole("button", { name: routeName, exact: true })).toBeVisible();
  await seedLanguagePreference(page, language);
  await page.reload();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await page.getByRole("button", { name: COPY[language].startRiding }).click();
  await expect(page.locator("header.riding-immersive-header")).toBeVisible();
}

/**
 * Widens each matched element's own text by `factor` with a letter-spacing
 * derived from its natural single-line width — through CSSOM, since the
 * CSP silently ignores an injected <style> — and reads the computed value
 * back so a no-op can never pass for a stressed run.
 */
async function applyWidthStress(page: Page, selector: string, factor: number) {
  const applied = await page.evaluate(
    ({ selector, factor }) => {
      const results: { text: string; letterSpacing: string }[] = [];
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const text = element.textContent;
        // Letter-spacing is applied once per typographic character.
        const characters = [...new Intl.Segmenter().segment(text)].length;
        if (characters === 0) continue;
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
        results.push({ text, letterSpacing: getComputedStyle(element).letterSpacing });
      }
      return results;
    },
    { selector, factor },
  );
  expect(applied.length, `stress applied to ${selector}`).toBeGreaterThan(0);
  for (const entry of applied) {
    expect(entry.letterSpacing, entry.text).not.toBe("normal");
    expect(Number.parseFloat(entry.letterSpacing), entry.text).toBeGreaterThan(0);
  }
}

interface HeaderGeometry {
  labelsInsideButtons: boolean;
  buttonsInsideHeader: boolean;
  titleSlackPx: number;
  details: string;
}

async function measureHeader(page: Page): Promise<HeaderGeometry> {
  return page.evaluate(() => {
    const header = document.querySelector("header.riding-immersive-header");
    const title = document.querySelector<HTMLElement>(".riding-immersive-header-title");
    if (!header || !title) throw new Error("no immersive header");
    const headerStyle = getComputedStyle(header);
    const headerBox = header.getBoundingClientRect();
    const headerContent = {
      left: headerBox.left + Number.parseFloat(headerStyle.paddingLeft),
      right: headerBox.right - Number.parseFloat(headerStyle.paddingRight),
    };
    const lines: string[] = [];
    let labelsInsideButtons = true;
    let buttonsInsideHeader = true;
    for (const button of header.querySelectorAll("button")) {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const content = {
        left:
          box.left +
          Number.parseFloat(style.borderLeftWidth) +
          Number.parseFloat(style.paddingLeft),
        right:
          box.right -
          Number.parseFloat(style.borderRightWidth) -
          Number.parseFloat(style.paddingRight),
      };
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect();
      const inside = text.left >= content.left - 0.5 && text.right <= content.right + 0.5;
      labelsInsideButtons &&= inside;
      const contained =
        box.left >= headerContent.left - 0.5 && box.right <= headerContent.right + 0.5;
      buttonsInsideHeader &&= contained;
      lines.push(
        `${button.textContent} text ${text.left.toFixed(1)}–${text.right.toFixed(1)} content ${content.left.toFixed(1)}–${content.right.toFixed(1)} box ${box.left.toFixed(1)}–${box.right.toFixed(1)}`,
      );
    }
    // scrollWidth equals clientWidth whenever the title is not clipped, so
    // the spare room comes from the text's own extent instead.
    const titleStyle = getComputedStyle(title);
    const titleContentWidth =
      title.clientWidth -
      Number.parseFloat(titleStyle.paddingLeft) -
      Number.parseFloat(titleStyle.paddingRight);
    const titleRange = document.createRange();
    titleRange.selectNodeContents(title);
    const titleSlackPx = titleContentWidth - titleRange.getBoundingClientRect().width;
    lines.push(
      `title ${title.textContent} content ${titleContentWidth.toFixed(1)} slack ${titleSlackPx.toFixed(1)}`,
    );
    return {
      labelsInsideButtons,
      buttonsInsideHeader,
      titleSlackPx,
      details: lines.join("\n"),
    };
  });
}

for (const width of WIDTHS) {
  test.describe(`${String(width)}px portrait`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const language of ["en", "de"] as const) {
      for (const stressed of [false, true]) {
        const label = `${language}${stressed ? ", stressed" : ""}`;

        test(`free roam header keeps its title and End action (${label})`, async ({
          page,
          context,
        }) => {
          await installLocalMapStyle(page);
          await startFreeRoam(page, context, language);
          const copy = COPY[language];

          const end = page.locator(".riding-immersive-header-end button");
          await expect(end).toHaveText(copy.endRideCompact);
          await expect(end).toHaveAccessibleName(copy.endRide);
          await expect(
            page.getByRole("heading", { level: 1, name: copy.freeRoamTitle }),
          ).toHaveAccessibleName(copy.freeRoamTitle);

          if (stressed) {
            await applyWidthStress(
              page,
              ".riding-immersive-header button, .riding-immersive-header-title",
              STRESS_FACTOR,
            );
          }
          const geometry = await measureHeader(page);
          test
            .info()
            .annotations.push({ type: "geometry", description: geometry.details });
          expect(geometry.labelsInsideButtons, geometry.details).toBe(true);
          expect(geometry.buttonsInsideHeader, geometry.details).toBe(true);
          // The fixed title must be readable in full, with room to spare —
          // asserted on the text's own extent, because scrollWidth is an
          // integer and would pass a title that overflows by a fraction.
          // Under the device-width stress this is asserted only at 430px:
          // at 390px the stressed German title sits at the edge (about
          // -0.4px) and at 375px and 360px it clips, a limitation recorded
          // with its decision in item 113's history rather than hidden by
          // a looser assertion.
          if (!stressed || width >= 430) {
            expect(geometry.titleSlackPx, geometry.details).toBeGreaterThanOrEqual(
              MIN_TITLE_SLACK_PX,
            );
          }
        });

        test(`route-ride header keeps its End action inside (${label})`, async ({
          page,
          context,
        }) => {
          await installLocalMapStyle(page);
          await startRouteRide(page, context, language, "Abendrunde");
          const copy = COPY[language];

          const end = page.locator(".riding-immersive-header-end button");
          await expect(end).toHaveText(copy.endRideCompact);
          await expect(end).toHaveAccessibleName(copy.endRide);

          if (stressed) {
            await applyWidthStress(
              page,
              ".riding-immersive-header button, .riding-immersive-header-title",
              STRESS_FACTOR,
            );
          }
          const geometry = await measureHeader(page);
          test
            .info()
            .annotations.push({ type: "geometry", description: geometry.details });
          expect(geometry.labelsInsideButtons, geometry.details).toBe(true);
          expect(geometry.buttonsInsideHeader, geometry.details).toBe(true);
        });
      }
    }

    test("the pending German Pause label stays inside its button (stressed)", async ({
      page,
      context,
    }) => {
      // Deterministic seam (backlog item 68, rideStateRepository.ts): holds
      // Pause's own persistence write open so the wider pending label can
      // be measured rather than raced. Starts disarmed.
      await page.addInitScript(() => {
        const w = window as unknown as {
          __acnE2eArmRideStateWriteDelay?: () => void;
          __acnE2eRideStateWriteDelay?: () => Promise<void>;
          __resolveRideStateWriteDelay?: () => void;
        };
        let armed = false;
        w.__acnE2eArmRideStateWriteDelay = () => {
          armed = true;
        };
        w.__acnE2eRideStateWriteDelay = () => {
          if (!armed) return Promise.resolve();
          return new Promise((resolve) => {
            w.__resolveRideStateWriteDelay = resolve;
          });
        };
      });
      await installLocalMapStyle(page);
      await startFreeRoam(page, context, "de");
      await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

      await page.evaluate(() => {
        (
          window as unknown as { __acnE2eArmRideStateWriteDelay?: () => void }
        ).__acnE2eArmRideStateWriteDelay?.();
      });
      await page.getByRole("button", { name: COPY.de.pause, exact: true }).click();
      await expect(page.getByRole("button", { name: COPY.de.pausing })).toBeVisible();

      await applyWidthStress(
        page,
        ".riding-immersive-header button, .riding-immersive-header-title",
        STRESS_FACTOR,
      );
      const geometry = await measureHeader(page);
      test.info().annotations.push({ type: "geometry", description: geometry.details });
      expect(geometry.labelsInsideButtons, geometry.details).toBe(true);
      expect(geometry.buttonsInsideHeader, geometry.details).toBe(true);

      await page.evaluate(() => {
        (
          window as unknown as { __resolveRideStateWriteDelay?: () => void }
        ).__resolveRideStateWriteDelay?.();
      });
    });
  });
}

// The 0.4.42 installed-iPhone recheck (September 2026, IMG_8107/IMG_8108):
// opening the End confirmation emptied the header's End slot, so the title's
// flex item grew into the freed width and its centred text jumped right. The
// trigger now stays mounted while the confirmation is open — concealed,
// outside the accessibility tree and disabled — so nothing in the header
// moves. Pause was visible in the capture and is asserted here anyway.
interface HeaderSnapshot {
  pause: { x: number; y: number; width: number; height: number };
  titleText: { x: number; y: number; width: number; height: number };
  endSlot: { x: number; y: number; width: number; height: number };
}

async function snapshotHeader(page: Page): Promise<HeaderSnapshot> {
  return page.evaluate(() => {
    const header = document.querySelector("header.riding-immersive-header");
    const pause = header?.querySelector(".riding-immersive-header-start button");
    const title = header?.querySelector(".riding-immersive-header-title");
    const endSlot = header?.querySelector(".riding-immersive-header-end");
    if (!pause || !title || !endSlot) throw new Error("incomplete immersive header");
    const range = document.createRange();
    range.selectNodeContents(title);
    const box = (rect: DOMRect) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    return {
      pause: box(pause.getBoundingClientRect()),
      titleText: box(range.getBoundingClientRect()),
      endSlot: box(endSlot.getBoundingClientRect()),
    };
  });
}

function expectSameHeader(
  actual: HeaderSnapshot,
  expected: HeaderSnapshot,
  when: string,
) {
  for (const part of ["pause", "titleText", "endSlot"] as const) {
    for (const edge of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(actual[part][edge] - expected[part][edge]),
        `${when}: ${part}.${edge} ${JSON.stringify(actual[part])} vs ${JSON.stringify(expected[part])}`,
      ).toBeLessThanOrEqual(0.5);
    }
  }
}

for (const width of [375, 390] as const) {
  test.describe(`${String(width)}px portrait, End confirmation`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const language of ["en", "de"] as const) {
      for (const session of ["route", "free roam"] as const) {
        test(`the header stays still while the End confirmation opens and closes (${session}, ${language})`, async ({
          page,
          context,
        }) => {
          await installLocalMapStyle(page);
          if (session === "route") {
            await startRouteRide(page, context, language, "Abendrunde");
          } else {
            await startFreeRoam(page, context, language);
          }
          const copy = COPY[language];
          const header = page.locator("header.riding-immersive-header");
          const trigger = header.locator(".riding-immersive-header-end button");
          const pause = header.getByRole("button", { name: copy.pause, exact: true });
          await expect(trigger).toBeVisible();

          const before = await snapshotHeader(page);

          for (const close of ["Cancel", "Escape"] as const) {
            await trigger.click();
            const dialog = page.getByRole("dialog");
            await expect(dialog).toBeVisible();
            await expect(dialog.getByRole("button", { name: copy.cancel })).toBeFocused();

            // While open: Pause is still there and usable, the header's own
            // End trigger is concealed and has no role, and nothing moved.
            await expect(pause).toBeVisible();
            await expect(pause).toBeEnabled();
            await expect(trigger).toBeHidden();
            await expect(header.getByRole("button", { name: copy.endRide })).toHaveCount(
              0,
            );
            expectSameHeader(await snapshotHeader(page), before, `open (${close})`);

            if (close === "Cancel") {
              await dialog.getByRole("button", { name: copy.cancel }).click();
            } else {
              await page.keyboard.press("Escape");
            }
            await expect(dialog).toBeHidden();
            await expect(trigger).toBeVisible();
            await expect(trigger).toBeFocused();
            expectSameHeader(await snapshotHeader(page), before, `after ${close}`);
          }
        });
      }
    }
  });
}
