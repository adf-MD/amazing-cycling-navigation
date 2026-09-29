import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { forceMapStyleFailure, installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 114: Planning's enlarged-text layout, proved at 200% browser
// text at every required portrait size, in both languages, for the longest
// placement labels and in every map-message state. A .smoke spec so that
// the webkit-smoke project runs it as well as chromium.
//
// At 200% text the ordinary layout cannot work: the attribution wraps into
// the placement control and the imagery banner outgrows the map. In the
// enlarged layout the attribution is a strip directly below the map, the
// placement control sits at the map's 8px inset, and every map message is
// in normal flow below the strip. Every number here is measured from the
// live layout; nothing is copied from the Stage 0/1 probes.
//
// Browser-root-text scaling, never iOS Dynamic Type: ACN has no Dynamic
// Type opt-in, and this overlap has not been observed on an iPhone.

test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 844 },
  { width: 375, height: 667 },
] as const;
const COPY = {
  en: { plan: "Plan", add: "Add waypoint here" },
  de: { plan: "Planen", add: "Wegpunkt hier setzen" },
} as const;
type Language = keyof typeof COPY;
type MessageState = "none" | "status" | "imagery";

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

async function openPlanning(
  page: Page,
  context: BrowserContext,
  language: Language,
  messageState: MessageState,
): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  if (messageState === "imagery") {
    await forceMapStyleFailure(page);
  } else {
    await installLocalMapStyle(page);
  }
  await page.goto("/");
  await seedLanguagePreference(page, language);
  await page.reload();
  await page.getByRole("button", { name: COPY[language].plan, exact: true }).click();
  const control = page.locator(".planning-crosshair-callout");
  // The placement control is disabled until the one-time regional framing
  // settles, so its becoming enabled is the settle signal.
  await expect(control).toBeEnabled({ timeout: 15_000 });
  // Wait for the map's own full load (MapView's data-map-ready), so that a
  // transient "taking longer than usual" notice from a slow first load in
  // headless WebKit has come and gone before anything is measured.
  await expect(page.getByTestId("map-container")).toHaveAttribute(
    "data-map-ready",
    "true",
    {
      timeout: 20_000,
    },
  );
  if (messageState === "imagery") {
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible({
      timeout: 15_000,
    });
  }
  if (messageState === "status") {
    // getApproximateLocationOnce accepts a cached fix, so revoking the
    // permission is not enough: make the one-shot request fail outright.
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        error?.({
          code: 1,
          message: "denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      };
    });
    await page.locator(".planning-map-controls button").nth(1).click();
    await expect(page.locator(".planning-map-status-message")).toHaveCount(1);
  }
}

async function setRootFontSize(page: Page, value: string): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = value;
  }, value);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/** Places twelve waypoints at the map centre (legal, and fast: no routing
 * happens until Calculate), then selects waypoint 12 and chooses the given
 * relocation, which gives the longest label describeCrosshairAction can
 * render for that mode. Language-neutral: the list's own structure. */
async function placeTwelveWaypoints(page: Page): Promise<void> {
  const control = page.locator(".planning-crosshair-callout");
  for (let index = 0; index < 12; index += 1) {
    await expect(control).toBeEnabled();
    await control.click();
  }
  await expect(page.locator(".waypoint-list li")).toHaveCount(12);
}

async function chooseRelocation(page: Page, mode: "move" | "insert"): Promise<void> {
  const row = page.locator(".waypoint-list li").nth(11);
  if (!((await row.getAttribute("class")) ?? "").includes("is-selected")) {
    await row.locator(".waypoint-row-select").click();
  }
  await row
    .locator(".waypoint-row-relocate button")
    .nth(mode === "move" ? 0 : 1)
    .click();
  await expect(page.locator(".planning-crosshair-callout")).toBeEnabled();
}

interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
  w: number;
  h: number;
}

interface Measurement {
  label: string;
  attributionNodes: number;
  attributionFontPx: number;
  attributionClipped: boolean;
  attributionGapBelowMap: number;
  attributionInsideMap: boolean;
  linkFragments: number;
  linkFragmentMisses: number;
  contrast: number;
  controlInsideMap: boolean;
  controlWidth: number;
  controlHeight: number;
  controlLabelClipped: boolean;
  controlTopmost: string;
  collisions: string[];
  messageCount: number;
  messagesInFlow: boolean;
  retry: { w: number; h: number; topmost: boolean }[];
  stabilityDeltaPx: number | null;
  discoverability: { mapFullyInView: boolean; offscreen: string[] };
  /** False if a message came or went mid-measurement, which would make the
   * geometry above describe two different pages. */
  messagesStayedAttached: boolean;
  scrollWidth: number;
  clientWidth: number;
}

/** One pass over the live layout. Hit tests scroll their subject into the
 * middle of the viewport first, and discoverability is judged with the
 * whole map just below the sticky header — how a rider working on the map
 * would see the page. */
async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    const box = (el: Element): Box => {
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    const hits = (a: Box, b: Box) =>
      a.w > 0 &&
      a.h > 0 &&
      b.w > 0 &&
      b.h > 0 &&
      a.x < b.r &&
      b.x < a.r &&
      a.y < b.b &&
      b.y < a.b;
    const need = (selector: string): HTMLElement => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el;
    };
    const map = need(".planning-map-container");
    const control = need(".planning-crosshair-callout");
    const attribution = need(".map-attribution");
    const link = need(".map-attribution a");
    const ring = need(".planning-crosshair");
    const zoom = need(".planning-map-zoom-controls");
    const cameraControls = need(".planning-map-controls");
    const messages = [
      ...document.querySelectorAll<HTMLElement>(
        ".map-status-message, .planning-map-status-message",
      ),
    ];
    const connected = () => messages.every((m) => m.isConnected);
    const retries = [
      ...document.querySelectorAll<HTMLElement>(".map-status-retry-button"),
    ];

    // The control's painted footprint: border box plus its isolation band
    // (the box-shadow spread, read back rather than assumed).
    const spreadMatch = /(-?[\d.]+)px\s*$/.exec(getComputedStyle(control).boxShadow);
    const band = spreadMatch ? Number.parseFloat(spreadMatch[1]) : 0;
    const footprint = (): Box => {
      const c = box(control);
      return {
        x: c.x - band,
        y: c.y - band,
        r: c.r + band,
        b: c.b + band,
        w: c.w + 2 * band,
        h: c.h + 2 * band,
      };
    };
    const mapBox = box(map);
    const fp = footprint();
    const within = (inner: Box, outer: Box) =>
      inner.x >= outer.x - 0.5 &&
      inner.r <= outer.r + 0.5 &&
      inner.y >= outer.y - 0.5 &&
      inner.b <= outer.b + 0.5;
    const nextBlock = (
      map.nextElementSibling?.classList.contains("planning-map-below")
        ? map.nextElementSibling.nextElementSibling
        : map.nextElementSibling
    ) as HTMLElement | null;

    const collisions: string[] = [];
    const attributionBox = box(attribution);
    const check = (name: string, a: Box, b: Box) => {
      if (hits(a, b)) collisions.push(name);
    };
    check("control/attribution", fp, attributionBox);
    check("control/crosshair", fp, box(ring));
    check("control/zoom controls", fp, box(zoom));
    check("control/camera controls", fp, box(cameraControls));
    if (nextBlock) check("control/next panel", fp, box(nextBlock));
    check("attribution/zoom controls", attributionBox, box(zoom));
    check("attribution/camera controls", attributionBox, box(cameraControls));
    for (const message of messages) {
      const m = box(message);
      check("control/message", fp, m);
      check("attribution/message", attributionBox, m);
      check("message/map", m, mapBox);
      check("message/zoom controls", m, box(zoom));
      check("message/camera controls", m, box(cameraControls));
    }

    const textRange = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const b = range.getBoundingClientRect();
      return { x: b.left, r: b.right, y: b.top, b: b.bottom };
    };
    const clipped = (el: Element) => {
      const t = textRange(el);
      const b = box(el);
      return t.x < b.x - 0.5 || t.r > b.r + 0.5 || t.y < b.y - 0.5 || t.b > b.b + 0.5;
    };

    // Contrast of the link text against the first opaque background behind it.
    const parse = (colour: string) => {
      const parts =
        /rgba?\(([^)]+)\)/
          .exec(colour)?.[1]
          ?.split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number) ?? [];
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
    };
    let backgroundEl: Element | null = attribution;
    let background = { r: 255, g: 255, b: 255, a: 1 };
    while (backgroundEl) {
      const c = parse(getComputedStyle(backgroundEl).backgroundColor);
      if (c.a > 0) {
        background = c;
        break;
      }
      backgroundEl = backgroundEl.parentElement;
    }
    const foreground = parse(getComputedStyle(link).color);
    const luminance = (c: { r: number; g: number; b: number }) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    };
    const lf = luminance(foreground);
    const lb = luminance(background);
    const contrast =
      background.a === 1 ? (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05) : 0;

    // Hit tests.
    const topmostGrid = async (el: HTMLElement) => {
      el.scrollIntoView({ block: "center" });
      await frame();
      const b = el.getBoundingClientRect();
      const inset = Math.max(
        2,
        Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
      );
      let good = 0;
      let total = 0;
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 5; j += 1) {
          const hit = document.elementFromPoint(
            b.left + inset + ((b.width - 2 * inset) * i) / 6,
            b.top + 2 + ((b.height - 4) * j) / 4,
          );
          total += 1;
          if (hit && (hit === el || el.contains(hit))) good += 1;
        }
      }
      return `${String(good)}/${String(total)}`;
    };
    const controlTopmost = await topmostGrid(control);
    link.scrollIntoView({ block: "center" });
    await frame();
    const fragments = [...link.getClientRects()].filter((q) => q.width > 0);
    const linkFragmentMisses = fragments.filter((q) => {
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return !(hit && (hit === link || link.contains(hit)));
    }).length;
    const retry = [];
    for (const button of retries) {
      button.scrollIntoView({ block: "center" });
      await frame();
      const b = button.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      retry.push({
        w: b.width,
        h: b.height,
        topmost: !!hit && (hit === button || button.contains(hit)),
      });
    }

    // Stability: taking the messages away must not move anything above them.
    let stabilityDeltaPx: number | null = null;
    if (messages.length) {
      const before = [box(control), box(ring), box(link)];
      const saved = messages.map((m) => m.style.display);
      for (const m of messages) m.style.display = "none";
      await frame();
      const after = [box(control), box(ring), box(link)];
      messages.forEach((m, i) => {
        m.style.display = saved[i] ?? "";
      });
      await frame();
      stabilityDeltaPx = Math.max(
        ...before.map((b, i) => {
          const a = after[i];
          return Math.max(
            Math.abs(a.x - b.x),
            Math.abs(a.y - b.y),
            Math.abs(a.w - b.w),
            Math.abs(a.h - b.h),
          );
        }),
      );
    }

    // Discoverability, with the whole map just below the sticky header.
    const header = document.querySelector(".app-header--sticky");
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    window.scrollBy(0, map.getBoundingClientRect().top - headerBottom);
    await frame();
    const inView = (el: Element) => {
      const b = el.getBoundingClientRect();
      return b.top >= headerBottom - 0.5 && b.bottom <= window.innerHeight + 0.5;
    };
    const offscreen: string[] = [];
    for (const m of messages)
      if (!inView(m)) offscreen.push(`message "${m.textContent}"`);
    for (const r of retries) if (!inView(r)) offscreen.push("retry");
    if (!inView(control)) offscreen.push("placement control");
    if (!inView(attribution)) offscreen.push("attribution");

    const finalMap = box(map);
    const finalAttribution = box(attribution);
    return {
      label: control.textContent,
      attributionNodes: document.querySelectorAll(".map-attribution").length,
      attributionFontPx: Number.parseFloat(getComputedStyle(attribution).fontSize),
      attributionClipped: clipped(attribution),
      attributionGapBelowMap: finalAttribution.y - finalMap.b,
      attributionInsideMap: within(finalAttribution, finalMap),
      linkFragments: fragments.length,
      linkFragmentMisses,
      contrast,
      controlInsideMap: within(fp, mapBox),
      controlWidth: box(control).w,
      controlHeight: box(control).h,
      controlLabelClipped: clipped(control),
      controlTopmost,
      collisions,
      messageCount: messages.length,
      messagesInFlow: messages.every((m) => !map.contains(m)),
      retry,
      stabilityDeltaPx,
      discoverability: { mapFullyInView: inView(map), offscreen },
      messagesStayedAttached: connected(),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

function expectEnlargedLayoutHolds(
  m: Measurement,
  ordinaryAttributionFontPx: number,
  context: string,
): void {
  const report = `${context}: ${JSON.stringify(m)}`;
  expect(m.messagesStayedAttached, report).toBe(true);
  // Exactly one attribution, in a strip flush against the map's bottom
  // edge, legible, unclipped, at twice its ordinary size, and linked.
  expect(m.attributionNodes, report).toBe(1);
  expect(m.attributionInsideMap, report).toBe(false);
  expect(m.attributionGapBelowMap, report).toBeGreaterThanOrEqual(-0.5);
  expect(m.attributionGapBelowMap, report).toBeLessThanOrEqual(1);
  expect(m.attributionClipped, report).toBe(false);
  expect(m.attributionFontPx, report).toBeCloseTo(2 * ordinaryAttributionFontPx, 1);
  expect(m.linkFragments, report).toBeGreaterThan(0);
  expect(m.linkFragmentMisses, report).toBe(0);
  expect(m.contrast, report).toBeGreaterThanOrEqual(4.5);
  // The placement control: inside the map, a full target, unclipped, on top
  // of everything across its surface, and clear of everything else.
  expect(m.controlInsideMap, report).toBe(true);
  expect(m.controlWidth, report).toBeGreaterThanOrEqual(44);
  expect(m.controlHeight, report).toBeGreaterThanOrEqual(44);
  expect(m.controlLabelClipped, report).toBe(false);
  expect(m.controlTopmost, report).toBe("35/35");
  expect(m.collisions, report).toEqual([]);
  // Messages in normal flow, with a usable Retry, visible when they appear,
  // and never moving what sits above them.
  expect(m.messagesInFlow, report).toBe(true);
  for (const retry of m.retry) {
    expect(retry.w, report).toBeGreaterThanOrEqual(44);
    expect(retry.h, report).toBeGreaterThanOrEqual(44);
    expect(retry.topmost, report).toBe(true);
  }
  if (m.stabilityDeltaPx !== null) {
    expect(m.stabilityDeltaPx, report).toBeLessThanOrEqual(0.5);
  }
  expect(m.discoverability.mapFullyInView, report).toBe(true);
  expect(m.discoverability.offscreen, report).toEqual([]);
  expect(m.scrollWidth, report).toBeLessThanOrEqual(m.clientWidth);
}

for (const size of SIZES) {
  for (const language of ["en", "de"] as const) {
    for (const messageState of ["none", "status", "imagery"] as const) {
      test(`200% text, ${String(size.width)}x${String(size.height)}, ${language}, ${messageState}: attribution, crosshair, placement control, map controls and messages all stay clear`, async ({
        page,
        context,
      }) => {
        await page.setViewportSize(size);
        await openPlanning(page, context, language, messageState);
        const ordinaryAttributionFontPx = await page
          .locator(".map-attribution")
          .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));

        await setRootFontSize(page, "200%");
        const control = page.locator(".planning-crosshair-callout");
        await expect(control).toHaveText(COPY[language].add);
        expectEnlargedLayoutHolds(await measure(page), ordinaryAttributionFontPx, "add");

        await placeTwelveWaypoints(page);
        await chooseRelocation(page, "move");
        const move = await measure(page);
        expect(move.label.length).toBeGreaterThan(COPY[language].add.length);
        expectEnlargedLayoutHolds(move, ordinaryAttributionFontPx, "move waypoint 12");

        await chooseRelocation(page, "insert");
        const insert = await measure(page);
        expectEnlargedLayoutHolds(
          insert,
          ordinaryAttributionFontPx,
          "insert after waypoint 12",
        );
        if (messageState !== "none") {
          expect(insert.messageCount).toBeGreaterThan(0);
        }
      });
    }
  }
}

test.describe("dark colour scheme", () => {
  test.use({ colorScheme: "dark" });

  for (const size of SIZES) {
    test(`200% text, ${String(size.width)}x${String(size.height)}: the attribution strip stays legible`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize(size);
      await openPlanning(page, context, "en", "none");
      await setRootFontSize(page, "200%");
      const m = await measure(page);
      expect(m.attributionInsideMap, JSON.stringify(m)).toBe(false);
      expect(m.contrast, JSON.stringify(m)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
