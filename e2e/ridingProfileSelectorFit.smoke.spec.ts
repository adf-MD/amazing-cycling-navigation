import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 145's selector slice: the active Profile pane's range buttons
// (Full/2 km/10 km and, when offered, Climb) take 4px of inline padding in
// place of the global button rule's 16px. Before, German "Gesamt" spilled out
// of its quarter at 320px wide and the pane scrolled sideways.
//
// This file runs under the "chromium" and "webkit-smoke" projects, in English
// and German, with and without Climb. Each case measures at 320x693 and at
// 390x844 before asserting anything, so that every measurement is attached
// even when an early assertion fails. It checks:
// - every label inside its button, clear of the 2px inset selected ring, and
//   centred; no sideways scrolling in the pane or the document;
// - one row of equal quarters at the same literal boxes as before the change,
//   so item 80's geometry with and without Climb, including the empty fourth
//   track, is unchanged;
// - 44px targets, the Map/Profile switcher on screen, and every button
//   operable.
//
// Why a browser: label fit depends on real text metrics and grid layout,
// which jsdom does not compute. Overlap: item 80's checks in
// ridingElevationWindows.spec.ts, ridingClimbView.spec.ts and
// ridingMapProfileViews.spec.ts run in Chromium only, in English, at 390px or
// wider; this adds 320px, German and WebKit. The CI image's fonts are not
// iOS fonts, so a pass here does not establish the fit on an iPhone.

test.use({ serviceWorkers: "block", viewport: { width: 320, height: 693 } });

const DB_NAME = "amazing-cycling-navigation";
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const TOLERANCE_PX = 0.5;
/** The inset selected ring's width (.is-selected in the immersive pane). */
const RING_PX = 2;
const TOUCH_TARGET_PX = 44;
const GAP_PX = 8;

const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];

const COPY = {
  en: {
    startRiding: "Start riding",
    profile: "Profile",
    group: "Elevation profile view",
    climbPreview: "Climb preview",
  },
  de: {
    startRiding: "Fahrt starten",
    profile: "Profil",
    group: "Ansicht des Höhenprofils",
    climbPreview: "Vorschau des Anstiegs",
  },
} as const;

/** Item 80's two states. The climb route offers Climb from 200 m, before its
 * first climb; the flat route never does. Both fixtures are shared with
 * ridingClimbView.spec.ts and ridingElevationWindows.spec.ts. */
const ROUTES = {
  "with Climb": {
    path: fileURLToPath(new URL("./fixtures/two-climbs-route.gpx", import.meta.url)),
    name: "two-climbs-route",
    latitude: 51.5,
    longitude: -0.08 + 200 / METRES_PER_DEGREE_LON,
    buttons: 4,
  },
  "without Climb": {
    path: fileURLToPath(
      new URL("./fixtures/elevation-distance-guides-route.gpx", import.meta.url),
    ),
    name: "elevation-distance-guides-route",
    latitude: 51.5,
    longitude: -0.2,
    buttons: 3,
  },
} as const;
type RouteState = keyof typeof ROUTES;

/** The boxes the four tracks give, measured on the build before this change
 * (16px padding) and expected to stay exactly the same. */
const LAYOUTS = {
  narrow: {
    width: 320,
    height: 693,
    groupLeft: 16,
    groupWidth: 288,
    quarter: 66,
    xs: [16, 90, 164, 238],
  },
  ordinary: {
    width: 390,
    height: 844,
    groupLeft: 16,
    groupWidth: 358,
    quarter: 83.5,
    xs: [16, 107.5, 199, 290.5],
  },
} as const;
type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface Measurement {
  viewport: { width: number; height: number };
  group: Rect & { children: number };
  buttons: (Rect & { label: string; textLeft: number; textRight: number })[];
  pane: {
    scrollWidth: number;
    clientWidth: number;
    scrollHeight: number;
    clientHeight: number;
  };
  documentScrollWidth: number;
  switcher: Rect;
}

/** Duplicated from language.spec.ts per this repo's no-shared-e2e-helpers
 * convention: writes the app-preferences singleton directly. */
async function seedLanguagePreference(page: Page, language: Language): Promise<void> {
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

async function startRideOnProfile(
  page: Page,
  context: BrowserContext,
  state: RouteState,
  language: Language,
): Promise<Locator> {
  const route = ROUTES[state];
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: route.latitude,
    longitude: route.longitude,
    accuracy: 5,
  });
  await installLocalMapStyle(page);
  await page.goto("/");
  // Import in English, where the file input's label is known, then switch.
  await page.getByLabel("Import GPX file").setInputFiles(route.path);
  await expect(page.getByRole("button", { name: route.name, exact: true })).toBeVisible();
  await seedLanguagePreference(page, language);
  await page.reload();
  await page.getByRole("button", { name: route.name, exact: true }).click();
  await page.getByRole("button", { name: COPY[language].startRiding }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await page.getByRole("button", { name: COPY[language].profile, exact: true }).click();
  const group = page.getByRole("group", { name: COPY[language].group });
  await expect(group).toBeVisible({ timeout: 15_000 });
  await expect(group.getByRole("button")).toHaveCount(route.buttons, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return group;
}

/** Waits until the selector's boxes hold still over timer-driven samples
 * (never animation frames: headless WebKit can defer them). */
async function settle(page: Page, quietMs = 300): Promise<void> {
  await page.evaluate(
    (quietMs) =>
      new Promise<void>((resolve) => {
        const read = () =>
          JSON.stringify(
            [
              ...document.querySelectorAll(
                ".ride-profile-pane--immersive .elevation-window-group, .ride-profile-pane--immersive .elevation-window-button",
              ),
            ].map((element) => element.getBoundingClientRect()),
          );
        let last = read();
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          const now = read();
          if (now !== last) {
            last = now;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > 5_000) {
            resolve();
          } else {
            setTimeout(tick, 25);
          }
        };
        setTimeout(tick, 25);
      }),
    quietMs,
  );
}

async function resizeTo(page: Page, layout: Layout): Promise<void> {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await settle(page);
}

async function measure(
  page: Page,
  testInfo: TestInfo,
  layout: Layout,
): Promise<Measurement> {
  const measurement = await page.evaluate((): Measurement => {
    const rect = (element: Element): Rect => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const pane = document.querySelector(".ride-profile-pane--immersive");
    const group = pane?.querySelector(".elevation-window-group");
    const switcher = document.querySelector(".ride-immersive-switcher");
    if (!pane || !group || !switcher) {
      throw new Error("expected the active Profile pane, its selector and the switcher");
    }
    const buttons = [...group.querySelectorAll("button")].map((button) => {
      // The label's own painted extent, which a button's box does not clip.
      const range = document.createRange();
      range.selectNodeContents(button);
      const textRects = [...range.getClientRects()].filter((r) => r.width > 0);
      return {
        ...rect(button),
        label: button.textContent.trim(),
        textLeft: Math.min(...textRects.map((r) => r.left)),
        textRight: Math.max(...textRects.map((r) => r.right)),
      };
    });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      group: { ...rect(group), children: group.children.length },
      buttons,
      pane: {
        scrollWidth: pane.scrollWidth,
        clientWidth: pane.clientWidth,
        scrollHeight: pane.scrollHeight,
        clientHeight: pane.clientHeight,
      },
      documentScrollWidth: document.documentElement.scrollWidth,
      switcher: rect(switcher),
    };
  });
  await testInfo.attach(`selector at ${String(layout.width)}x${String(layout.height)}`, {
    body: JSON.stringify(measurement, null, 2),
    contentType: "application/json",
  });
  return measurement;
}

function expectSelectorFits(m: Measurement, layout: Layout, state: RouteState): void {
  const at = `at ${String(layout.width)}px`;
  // Labels first: this is what the 16px padding broke at 320px in German.
  for (const button of m.buttons) {
    const leftSpare = button.textLeft - button.left;
    const rightSpare = button.right - button.textRight;
    expect(leftSpare, `"${button.label}" left spare ${at}`).toBeGreaterThanOrEqual(
      RING_PX,
    );
    expect(rightSpare, `"${button.label}" right spare ${at}`).toBeGreaterThanOrEqual(
      RING_PX,
    );
  }
  expect(m.pane.scrollWidth, `Profile pane scroll width ${at}`).toBeLessThanOrEqual(
    m.pane.clientWidth,
  );
  expect(m.documentScrollWidth, `document scroll width ${at}`).toBeLessThanOrEqual(
    layout.width,
  );

  // One row of equal quarters, at the literal boxes the tracks give.
  expect(m.group.left).toBeCloseTo(layout.groupLeft, 1);
  expect(m.group.width).toBeCloseTo(layout.groupWidth, 1);
  m.buttons.forEach((button, index) => {
    expect(
      Math.abs(button.top - m.buttons[0].top),
      `"${button.label}" row ${at}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(
      Math.abs(button.left - layout.xs[index]),
      `"${button.label}" x ${at}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(
      Math.abs(button.width - layout.quarter),
      `"${button.label}" width ${at}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(
      Math.abs(button.height - TOUCH_TARGET_PX),
      `"${button.label}" height ${at}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(button.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  });
  expect(Math.abs(m.group.height - m.buttons[0].height)).toBeLessThanOrEqual(
    TOLERANCE_PX,
  );

  // Item 80: Climb takes the fourth track, flush right; without it the track
  // stays reserved and empty, so 10 km ends one full column short.
  expect(m.buttons).toHaveLength(ROUTES[state].buttons);
  expect(m.group.children).toBe(ROUTES[state].buttons);
  const last = m.buttons[m.buttons.length - 1];
  const expectedLastRight =
    state === "with Climb" ? m.group.right : m.group.right - (layout.quarter + GAP_PX);
  expect(Math.abs(last.right - expectedLastRight)).toBeLessThanOrEqual(TOLERANCE_PX);

  // A label wider than its content box is start-aligned and drifts right
  // before it spills, so centring is the early sign of a lost fit.
  for (const button of m.buttons) {
    const leftSpare = button.textLeft - button.left;
    const rightSpare = button.right - button.textRight;
    expect(
      Math.abs(leftSpare - rightSpare),
      `"${button.label}" centring ${at}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
  }

  expect(m.switcher.top).toBeGreaterThanOrEqual(0);
  expect(m.switcher.bottom).toBeLessThanOrEqual(layout.height);
}

for (const language of LANGUAGES) {
  for (const state of Object.keys(ROUTES) as RouteState[]) {
    test(`${language}, ${state}: the active Profile selector's labels fit one row of unchanged quarters at 320 and 390 px, and every button works`, async ({
      page,
      context,
    }, testInfo) => {
      const group = await startRideOnProfile(page, context, state, language);
      await settle(page);

      const narrow = await measure(page, testInfo, LAYOUTS.narrow);
      await resizeTo(page, LAYOUTS.ordinary);
      const ordinary = await measure(page, testInfo, LAYOUTS.ordinary);

      expectSelectorFits(narrow, LAYOUTS.narrow, state);
      expectSelectorFits(ordinary, LAYOUTS.ordinary, state);

      await resizeTo(page, LAYOUTS.narrow);
      const buttons = group.getByRole("button");
      for (let index = 0; index < ROUTES[state].buttons; index += 1) {
        await buttons.nth(index).click();
        await expect(buttons.nth(index)).toHaveAttribute("aria-pressed", "true");
      }
      if (state === "with Climb") {
        await expect(
          page.getByRole("region", { name: COPY[language].climbPreview }),
        ).toBeVisible();
      }
    });
  }
}
