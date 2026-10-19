import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Backlog item 145, candidate B: while Screen on is refused, the toggle stays
// beside the status text and the refusal's message and retry ("Try again" /
// "Erneut versuchen") take their own full-width row of the status card.
// Before, they sat inside the toggle's column, widened it past the card and
// left the retry partly off screen. Since 0.4.73 (item 145's wrap-under
// slice) Screen on floats at the top right of the card's main region at its
// natural height, the status text flowing beside and beneath it, and the
// refusal row renders into a contained slot after the text.
//
// This file runs under the "chromium" and "webkit-smoke" projects, in English
// and German at ordinary root text, at 390x844, 375x667 and 320x693 with
// synthetic safe-area insets, in route riding (refused alone, then refused
// after a failed End ride) and in free roam (375x667, German). It checks:
// - the retry's whole box and label visible, at least 44x44, beside the
//   message; an ordinary click reaches it with no scrolling and retries;
// - Screen on at the main region's top right, beside the status row, whole
//   and operable, with no line of text overlapping it (visible text, not the
//   text wrapper's box, which extends beneath the float); the remaining
//   ascent whole; no page overflow; the Map/Profile switcher and the accepted
//   single-row Profile selector unaffected;
// - after a successful retry, the card is box for box the ordinary
//   successful Screen on state, with the failed End's error kept when present
//   (the free-roam case at 375x667 is the one WebKit kept 4 px taller before
//   the slot was contained);
// - at 390x844, route riding and free roam, English and German: the compact
//   control itself, at least 44x44 and no taller than its content needs, its
//   label and state inside it, lines beside it 8 px clear, route riding's GPS
//   line beneath it and free roam's detail line beside it, and the main
//   region exactly as tall as its content.
// Every snapshot is attached before its assertions or any click, with the
// map's imagery state; compared snapshots are taken only after the map's own
// full load, with no imagery row in the card (CI run 38567715515: a
// delayed-imagery row present in the reference but not in the recovery
// changed the card's height).
//
// Why a browser: the layout depends on a float, clearance, flow-root and line
// wrapping with real text metrics, on WebKit's own layout invalidation, and
// the retry's reachability on real hit testing. Overlap: ridingWakeLock.spec.ts covers the ordinary card layout in
// Chromium only; androidRiding.spec.ts only the refusal's presence;
// RidingWakeLockControl.test.tsx the lifecycle. Not asserted here: the rider's
// visibility in short maps, where item 145 keeps four cases open, and the map
// height, which the untrusted-GPX notice below the card changes over time.
// The refusal is simulated with a wake-lock stub; nothing here is
// installed-iPhone evidence, and the CI image's fonts are not iOS fonts.

test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const TOLERANCE_PX = 0.5;
const TOUCH_TARGET_PX = 44;
const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/elevation-distance-guides-route.gpx", import.meta.url),
);
const ROUTE_NAME = "elevation-distance-guides-route";
const FIX = { latitude: 51.5, longitude: -0.2, accuracy: 5 };

const SIZES = [
  { width: 390, height: 844, top: 47, bottom: 34 },
  { width: 375, height: 667, top: 20, bottom: 0 },
  { width: 320, height: 693, top: 47, bottom: 34 },
] as const;
type Size = (typeof SIZES)[number];
const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];

const COPY = {
  en: {
    nav: "Ride",
    startFreeRoam: "Start free roam",
    startRiding: "Start riding",
    endRide: "End ride",
    endFailed: "The ride could not be ended on this device. Try again.",
    screenOn: "Screen on",
    refused: "The screen could not be kept awake.",
    retry: "Try again",
    map: "Map",
    profile: "Profile",
    selector: "Elevation profile view",
  },
  de: {
    nav: "Fahren",
    startFreeRoam: "Freies Fahren starten",
    startRiding: "Fahrt starten",
    endRide: "Fahrt beenden",
    endFailed:
      "Die Fahrt konnte auf diesem Gerät nicht beendet werden. Versuche es erneut.",
    screenOn: "Display an",
    refused: "Das Display konnte nicht an bleiben.",
    retry: "Erneut versuchen",
    map: "Karte",
    profile: "Profil",
    selector: "Ansicht des Höhenprofils",
  },
} as const;
type Copy = (typeof COPY)[Language];

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Snapshot {
  viewport: { width: number; height: number };
  page: { scrollWidth: number; scrollHeight: number };
  header: Rect | null;
  card: Rect | null;
  /** The card's main region: Screen on and the text flowing around it. */
  main: Rect | null;
  /** The text's visible extent (its text rects), not its wrapper's box. */
  textColumn: Rect | null;
  /** The text wrapper's own layout box. */
  textBox: Rect | null;
  /** Each fragment of visible text in the text column, line by line. */
  textLines: Rect[];
  statusRowText: Rect | null;
  /** Route riding's GPS line or free roam's detail line: its text and lines. */
  gpsLine: { text: Rect; lines: number } | null;
  /** Screen on's label and state text. */
  toggleContent: Rect | null;
  toggle: (Rect & { visible: number; hit: boolean; pressed: string | null }) | null;
  statusLine: (Rect & { visible: number }) | null;
  message: { text: Rect; visibleText: boolean } | null;
  retry: (Rect & { visible: number; labelVisible: boolean; hit: boolean }) | null;
  switcher: Rect | null;
  alerts: string[];
  /** data-map-ready, and the status card's imagery rows by test id. */
  imagery: { mapReady: string | null; rows: string[] };
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

/** Synthetic safe-area insets (applied once <html> exists, since an init
 * script runs before it) and a wake-lock stub whose next request fails
 * while window.__e2eScreenOnRefuse is true, counting every request. */
async function installStubs(page: Page, size: Size): Promise<void> {
  await page.addInitScript(
    ({ top, bottom }) => {
      const apply = (html: Element) => {
        const style = (html as HTMLElement).style;
        style.setProperty("--safe-area-inset-top", `${String(top)}px`);
        style.setProperty("--safe-area-inset-bottom", `${String(bottom)}px`);
      };
      const existing = document.querySelector("html");
      if (existing) {
        apply(existing);
      } else {
        new MutationObserver((_mutations, observer) => {
          const html = document.querySelector("html");
          if (html) {
            apply(html);
            observer.disconnect();
          }
        }).observe(document, { childList: true });
      }
      const target = window as unknown as {
        __e2eScreenOnRefuse: boolean;
        __e2eScreenOnRequests: number;
      };
      target.__e2eScreenOnRefuse = false;
      target.__e2eScreenOnRequests = 0;
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: (): Promise<unknown> => {
            target.__e2eScreenOnRequests += 1;
            if (target.__e2eScreenOnRefuse) {
              return Promise.reject(new DOMException("refused", "NotAllowedError"));
            }
            return Promise.resolve({
              released: false,
              release: () => Promise.resolve(),
              addEventListener: () => {
                /* no-op: this stub never emits an unsolicited release */
              },
              removeEventListener: () => {
                /* no-op */
              },
            });
          },
        },
      });
    },
    { top: size.top, bottom: size.bottom },
  );
}

const setRefuse = (page: Page, refuse: boolean) =>
  page.evaluate((value) => {
    (window as unknown as { __e2eScreenOnRefuse: boolean }).__e2eScreenOnRefuse = value;
  }, refuse);

const requestCount = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __e2eScreenOnRequests: number }).__e2eScreenOnRequests,
  );

/** The item 139 seam: fails the first ride-state clear only. */
async function armFirstClearFailure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as {
      __e2eRideStateClearCalls: number;
      __acnE2eRideStateClearFailure?: () => Error | undefined;
    };
    target.__e2eRideStateClearCalls = 0;
    target.__acnE2eRideStateClearFailure = () => {
      target.__e2eRideStateClearCalls += 1;
      return target.__e2eRideStateClearCalls === 1
        ? new Error("e2e forced clear failure")
        : undefined;
    };
  });
}

/** Timer-driven layout settle (never animation frames: headless WebKit can
 * defer them). */
async function settle(page: Page, quietMs = 300): Promise<void> {
  await page.evaluate(
    (quietMs) =>
      new Promise<void>((resolve) => {
        const read = () =>
          JSON.stringify(
            [
              "header.riding-immersive-header",
              ".ride-status-card",
              ".wake-lock-failure-row",
              ".ride-immersive-switcher",
            ].map((selector) =>
              document.querySelector(selector)?.getBoundingClientRect(),
            ),
          ) + String(document.querySelectorAll("[role='alert']").length);
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

/** Every element's scroll offsets in the riding shell, and the window's. */
const scrollOffsets = (page: Page) =>
  page.evaluate(() => {
    const offsets: Record<string, [number, number]> = {
      window: [window.scrollX, window.scrollY],
    };
    document
      .querySelectorAll(".riding-fixed-shell, .riding-fixed-shell *")
      .forEach((element, index) => {
        if (element.scrollLeft !== 0 || element.scrollTop !== 0) {
          offsets[String(index)] = [element.scrollLeft, element.scrollTop];
        }
      });
    return JSON.stringify(offsets);
  });

/** A fresh fix at the same place, so the GPS line reads live in every
 * snapshot, then the layout settles. */
async function refreshAndSettle(page: Page, context: BrowserContext): Promise<void> {
  await context.setGeolocation(FIX);
  await settle(page);
}

async function snapshot(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<Snapshot> {
  const snap = await page.evaluate((): Snapshot => {
    const box = (element: Element): Rect => {
      const b = element.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const rect = (element: Element | null | undefined): Rect | null =>
      element ? box(element) : null;
    const inter = (a: Rect, b: Rect): Rect => ({
      left: Math.max(a.left, b.left),
      right: Math.min(a.right, b.right),
      top: Math.max(a.top, b.top),
      bottom: Math.min(a.bottom, b.bottom),
    });
    const area = (q: Rect) =>
      Math.max(0, q.right - q.left) * Math.max(0, q.bottom - q.top);
    const viewport: Rect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    /** The element's box clipped by every ancestor that clips and by the
     * viewport (display: contents ancestors have no box). */
    const visibleRect = (element: Element): Rect => {
      let q = box(element);
      for (let a = element.parentElement; a; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.display === "contents") continue;
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          q = inter(q, box(a));
        }
      }
      return inter(q, viewport);
    };
    const fraction = (element: Element) => {
      const whole = box(element);
      return area(visibleRect(element)) / Math.max(1e-6, area(whole));
    };
    const textRect = (element: Element): Rect | null => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (rects.length === 0) return null;
      return {
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right)),
        top: Math.min(...rects.map((r) => r.top)),
        bottom: Math.max(...rects.map((r) => r.bottom)),
      };
    };
    const within = (a: Rect, b: Rect) =>
      a.left >= b.left - 0.5 &&
      a.right <= b.right + 0.5 &&
      a.top >= b.top - 0.5 &&
      a.bottom <= b.bottom + 0.5;
    const hitsCentre = (element: Element) => {
      const r = box(element);
      const x = (r.left + r.right) / 2;
      const y = (r.top + r.bottom) / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const at = document.elementFromPoint(x, y);
      return !!at && (at === element || element.contains(at));
    };
    const card = document.querySelector(".ride-status-card");
    const toggle = card?.querySelector(".wake-lock-toggle") ?? null;
    const statusLine =
      card?.querySelector(".ride-status-card-remaining, .ride-status-card-detail") ??
      null;
    const row = card?.querySelector(".wake-lock-failure-row") ?? null;
    const text = card?.querySelector(".ride-status-card-text") ?? null;
    const statusRow = card?.querySelector(".ride-status-card-status-row") ?? null;
    const gps =
      card?.querySelector(".ride-status-card-gps, .ride-status-card-detail") ?? null;
    const gpsText = gps ? textRect(gps) : null;
    const message = row?.querySelector("p") ?? null;
    const retry = row?.querySelector("button") ?? null;
    const messageText = message ? textRect(message) : null;
    const retryText = retry ? textRect(retry) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      page: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      header: rect(document.querySelector("header.riding-immersive-header")),
      card: rect(card),
      main: rect(card?.querySelector(".ride-status-card-main")),
      textColumn: text ? textRect(text) : null,
      textBox: rect(text),
      textLines: text
        ? (() => {
            const range = document.createRange();
            range.selectNodeContents(text);
            return [...range.getClientRects()]
              .filter((r) => r.width > 0)
              .map((r) => ({
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
              }));
          })()
        : [],
      statusRowText: statusRow ? textRect(statusRow) : null,
      gpsLine:
        gps && gpsText
          ? {
              text: gpsText,
              lines: (() => {
                const range = document.createRange();
                range.selectNodeContents(gps);
                return new Set(
                  [...range.getClientRects()]
                    .filter((r) => r.width > 0)
                    .map((r) => Math.round(r.top)),
                ).size;
              })(),
            }
          : null,
      toggleContent: toggle ? textRect(toggle) : null,
      toggle: toggle
        ? {
            ...box(toggle),
            visible: fraction(toggle),
            hit: hitsCentre(toggle),
            pressed: toggle.getAttribute("aria-pressed"),
          }
        : null,
      statusLine: statusLine
        ? { ...box(statusLine), visible: fraction(statusLine) }
        : null,
      message:
        message && messageText
          ? { text: messageText, visibleText: within(messageText, visibleRect(message)) }
          : null,
      retry: retry
        ? {
            ...box(retry),
            visible: fraction(retry),
            labelVisible: !!retryText && within(retryText, visibleRect(retry)),
            hit: hitsCentre(retry),
          }
        : null,
      switcher: rect(document.querySelector(".ride-immersive-switcher")),
      alerts: [...document.querySelectorAll("[role='alert']")].map((a) =>
        a.textContent.trim(),
      ),
      imagery: {
        mapReady:
          document
            .querySelector("[data-testid='map-container']")
            ?.getAttribute("data-map-ready") ?? null,
        rows: [...(card?.querySelectorAll(".ride-status-card-imagery-row") ?? [])].map(
          (r) => r.getAttribute("data-testid") ?? r.className,
        ),
      },
    };
  });
  await testInfo.attach(label, {
    body: JSON.stringify(snap, null, 2),
    contentType: "application/json",
  });
  return snap;
}

function expectRefusedLayout(snap: Snapshot, copy: Copy, mode: "route" | "free"): void {
  const { retry, message, toggle, textColumn, statusLine } = snap;
  // Containment first: this is what the column layout broke.
  expect(retry, "the refused retry is rendered").not.toBeNull();
  if (!retry || !message || !toggle || !textColumn || !statusLine) {
    throw new Error("expected the retry, its message, Screen on and the status text");
  }
  expect(retry.visible, "the retry's whole box is visible").toBeGreaterThanOrEqual(0.999);
  expect(retry.labelVisible, "the retry's label is wholly visible").toBe(true);
  expect(retry.right - retry.left).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(retry.bottom - retry.top).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(retry.hit, "the retry is the element at its own centre").toBe(true);
  expect(message.visibleText, "the refusal's message is wholly visible").toBe(true);

  // Candidate B's fit: the retry sits beside its message, on one row.
  expect(retry.left).toBeGreaterThanOrEqual(message.text.right - TOLERANCE_PX);
  expect(retry.top).toBeLessThan(message.text.bottom);
  expect(retry.bottom).toBeGreaterThan(message.text.top);

  // Screen on stays at the top right, beside the status, whole, pressed and
  // operable; the text may continue beneath it but never overlaps it.
  expectScreenOnPlacement(snap, "refused");
  expect(toggle.visible).toBeGreaterThanOrEqual(0.999);
  expect(toggle.hit).toBe(true);
  expect(toggle.right - toggle.left).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(toggle.bottom - toggle.top).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(toggle.pressed).toBe("true");

  // The remaining distance and ascent (route) or the detail line (free roam).
  expect(statusLine.visible).toBeGreaterThanOrEqual(0.999);
  expect(snap.page.scrollWidth).toBeLessThanOrEqual(snap.viewport.width);
  expect(snap.page.scrollHeight).toBeLessThanOrEqual(snap.viewport.height);
  if (mode === "route") {
    expect(snap.switcher).not.toBeNull();
    expect(snap.switcher?.top ?? -1).toBeGreaterThanOrEqual(0);
    expect(snap.switcher?.bottom ?? Infinity).toBeLessThanOrEqual(snap.viewport.height);
  }
  expect(snap.alerts).toContain(copy.refused + copy.retry);
}

/** Item 145: Screen on at the main region's top right, beside the status
 * row; the status text may continue beneath it, but no fragment of visible
 * text overlaps it. Visible text, not the text wrapper's box, which extends
 * beneath the float. */
function expectScreenOnPlacement(snap: Snapshot, what: string): void {
  const { toggle, main, statusRowText, textLines } = snap;
  if (!toggle || !main || !statusRowText) {
    throw new Error(`${what}: expected Screen on, the main region and the status row`);
  }
  expect(
    Math.abs(toggle.top - main.top),
    `${what}: Screen on at the top`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(
    Math.abs(toggle.right - main.right),
    `${what}: Screen on at the right`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(
    statusRowText.right,
    `${what}: the status row beside Screen on`,
  ).toBeLessThanOrEqual(toggle.left + TOLERANCE_PX);
  expect(statusRowText.top).toBeLessThan(toggle.bottom);
  expect(textLines.length, `${what}: visible text`).toBeGreaterThan(0);
  for (const line of textLines) {
    const overlaps =
      line.right > toggle.left + TOLERANCE_PX &&
      line.left < toggle.right - TOLERANCE_PX &&
      line.bottom > toggle.top + TOLERANCE_PX &&
      line.top < toggle.bottom - TOLERANCE_PX;
    expect(overlaps, `${what}: text ${JSON.stringify(line)} clear of Screen on`).toBe(
      false,
    );
  }
}

/** Item 145, replacing item 82's stretched button: the compact control at
 * its natural height, with the text beside it 8 px clear and route riding's
 * GPS line beneath it; free roam's detail line stays beside it. The main
 * region's layout box is exactly as tall as the text's box or the control,
 * whichever is taller: no dead space. */
function expectCompactControl(
  snap: Snapshot,
  mode: "route" | "free",
  what: string,
): void {
  expectScreenOnPlacement(snap, what);
  const { toggle, toggleContent, main, textBox, gpsLine, textLines } = snap;
  if (!toggle || !toggleContent || !main || !textBox || !gpsLine) {
    throw new Error(
      `${what}: expected Screen on, its text, the text box and the GPS line`,
    );
  }
  expect(toggle.right - toggle.left).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  expect(toggle.bottom - toggle.top).toBeGreaterThanOrEqual(TOUCH_TARGET_PX - 0.01);
  for (const side of ["left", "top"] as const) {
    expect(
      toggleContent[side],
      `${what}: label and state inside Screen on`,
    ).toBeGreaterThanOrEqual(toggle[side]);
  }
  for (const side of ["right", "bottom"] as const) {
    expect(
      toggleContent[side],
      `${what}: label and state inside Screen on`,
    ).toBeLessThanOrEqual(toggle[side]);
  }
  // Natural height: the 44 px minimum, or its two lines with 2.5 px of
  // vertical padding and the 1 px borders, never stretched beyond that.
  const natural = Math.max(
    TOUCH_TARGET_PX,
    toggleContent.bottom - toggleContent.top + 2 * 2.5 + 2,
  );
  expect(
    toggle.bottom - toggle.top,
    `${what}: Screen on at its natural height`,
  ).toBeLessThanOrEqual(natural + 1);
  for (const line of textLines) {
    if (line.bottom <= toggle.top || line.top >= toggle.bottom) continue;
    expect(
      toggle.left - line.right,
      `${what}: text beside Screen on 8 px clear`,
    ).toBeGreaterThanOrEqual(8 - TOLERANCE_PX);
  }
  if (mode === "route") {
    expect(
      gpsLine.text.top,
      `${what}: the GPS line beneath Screen on`,
    ).toBeGreaterThanOrEqual(toggle.bottom - TOLERANCE_PX);
  } else {
    expect(
      gpsLine.text.top,
      `${what}: free roam's detail line beside Screen on`,
    ).toBeLessThan(toggle.bottom);
  }
  expect(gpsLine.lines, `${what}: the GPS line on one line`).toBe(1);
  expect(
    Math.abs(main.bottom - Math.max(textBox.bottom, toggle.bottom)),
    `${what}: no dead space in the main region`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
}

/** The ordinary card's boxes in two equivalent states must match. */
function expectSameCard(a: Snapshot, b: Snapshot, what: string): void {
  // The card also hosts the map's imagery rows (item 108), so both states
  // must share one settled imagery state before their boxes are compared.
  expect(a.imagery, `${what}: the reference's imagery state`).toEqual({
    mapReady: "true",
    rows: [],
  });
  expect(b.imagery, `${what}: the same imagery state`).toEqual(a.imagery);
  const boxes = (s: Snapshot) => ({
    header: s.header,
    card: s.card,
    main: s.main,
    textColumn: s.textColumn,
    toggle: s.toggle && {
      left: s.toggle.left,
      right: s.toggle.right,
      top: s.toggle.top,
      bottom: s.toggle.bottom,
    },
    statusLine: s.statusLine && {
      left: s.statusLine.left,
      right: s.statusLine.right,
      top: s.statusLine.top,
      bottom: s.statusLine.bottom,
    },
    switcher: s.switcher,
  });
  const before = boxes(a);
  const after = boxes(b);
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    const x = before[key];
    const y = after[key];
    if (x === null || y === null) {
      expect(y, `${what}: ${key}`).toEqual(x);
      continue;
    }
    for (const side of ["left", "right", "top", "bottom"] as const) {
      expect(Math.abs(x[side] - y[side]), `${what}: ${key}.${side}`).toBeLessThanOrEqual(
        TOLERANCE_PX,
      );
    }
  }
  expect(b.retry, `${what}: no retry`).toBeNull();
  expect(b.toggle?.pressed).toBe(a.toggle?.pressed);
}

/** A normal click on the retry while the stub still refuses: no element
 * scrolls, and exactly one more request is made. */
async function clickRetryWithoutScrolling(page: Page, copy: Copy): Promise<void> {
  const before = await scrollOffsets(page);
  const requests = await requestCount(page);
  await page
    .getByRole("alert")
    .filter({ hasText: copy.refused })
    .getByRole("button", { name: copy.retry, exact: true })
    .click();
  await expect.poll(() => requestCount(page)).toBe(requests + 1);
  await settle(page);
  expect(await scrollOffsets(page), "no element scrolled to reach the retry").toBe(
    before,
  );
  await expect(page.getByRole("alert").filter({ hasText: copy.refused })).toBeVisible();
}

async function refuseScreenOn(page: Page, copy: Copy): Promise<void> {
  const toggle = page.getByRole("button", { name: copy.screenOn, exact: true });
  await setRefuse(page, true);
  await toggle.click();
  await expect(page.getByRole("alert").filter({ hasText: copy.refused })).toBeVisible();
}

async function recoverScreenOn(page: Page, copy: Copy): Promise<void> {
  await setRefuse(page, false);
  await page
    .getByRole("alert")
    .filter({ hasText: copy.refused })
    .getByRole("button", { name: copy.retry, exact: true })
    .click();
  await expect(page.getByRole("alert").filter({ hasText: copy.refused })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: copy.screenOn, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
}

/** The accepted single-row Profile selector, with every label inside its
 * button, and no sideways scroll in the pane. */
async function expectProfileSelectorUnchanged(page: Page, copy: Copy): Promise<void> {
  const switcher = page.locator(".ride-immersive-switcher");
  await switcher.getByRole("button", { name: copy.profile, exact: true }).click();
  await expect(page.getByRole("group", { name: copy.selector })).toBeVisible();
  await settle(page);
  const selector = await page.evaluate(() => {
    const pane = document.querySelector(".ride-profile-pane--immersive");
    const buttons = pane ? [...pane.querySelectorAll(".elevation-window-button")] : [];
    return {
      rows: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size,
      buttons: buttons.length,
      labelsInside: buttons.every((button) => {
        const b = button.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(button);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        return rects.every((r) => r.left >= b.left + 2 && r.right <= b.right - 2);
      }),
      paneScrolls: pane ? pane.scrollWidth > pane.clientWidth : true,
    };
  });
  expect(selector.buttons).toBeGreaterThanOrEqual(3);
  expect(selector.rows).toBe(1);
  expect(selector.labelsInside).toBe(true);
  expect(selector.paneScrolls).toBe(false);
  await switcher.getByRole("button", { name: copy.map, exact: true }).click();
  await settle(page);
}

async function startRide(
  page: Page,
  context: BrowserContext,
  size: Size,
  language: Language,
  mode: "route" | "free",
): Promise<void> {
  await installStubs(page, size);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(FIX);
  await installLocalMapStyle(page);
  await page.goto("/");
  const copy = COPY[language];
  if (mode === "route") {
    // Import in English, where the file input's label is known, then switch.
    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_PATH);
    await expect(
      page.getByRole("button", { name: ROUTE_NAME, exact: true }),
    ).toBeVisible();
    await seedLanguagePreference(page, language);
    await page.reload();
    await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
    await page.getByRole("button", { name: copy.startRiding }).click();
  } else {
    await seedLanguagePreference(page, language);
    await page.reload();
    await page.getByRole("button", { name: copy.nav, exact: true }).click();
    await page.getByRole("button", { name: copy.startFreeRoam }).click();
  }
  await expect(page.locator("header.riding-immersive-header")).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ sessionId: expect.any(String) });
  // Active riding suppresses the in-map loading message and shows the map's
  // imagery messages in the status card (item 108), so map-loading hidden
  // is not enough. Wait for the map's own full load (mirroring
  // mapImageryRecovery.spec.ts's waitForMapFullyLoaded), then for the
  // card's imagery row, such as the delayed-imagery notice, to go, since it
  // clears a render after readiness.
  await expect(page.getByTestId("map-container")).toHaveAttribute(
    "data-map-ready",
    "true",
    {
      timeout: 20_000,
    },
  );
  await expect(
    page.locator(".ride-status-card .ride-status-card-imagery-row"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: copy.screenOn, exact: true }),
  ).toBeVisible();
  await refreshAndSettle(page, context);
}

async function turnScreenOn(page: Page, copy: Copy): Promise<void> {
  await setRefuse(page, false);
  const toggle = page.getByRole("button", { name: copy.screenOn, exact: true });
  const requests = await requestCount(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => requestCount(page)).toBeGreaterThan(requests);
}

async function turnScreenOff(page: Page, copy: Copy): Promise<void> {
  const toggle = page.getByRole("button", { name: copy.screenOn, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("alert").filter({ hasText: copy.refused })).toHaveCount(0);
}

for (const size of SIZES) {
  test.describe(`${String(size.width)}x${String(size.height)}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const language of LANGUAGES) {
      test(`${language}: a refused Screen on keeps its retry whole on its own row and Screen on beside the status, and recovery restores the ordinary card, with and without a failed End`, async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(90_000);
        const copy = COPY[language];
        await startRide(page, context, size, language, "route");

        await turnScreenOn(page, copy);
        await refreshAndSettle(page, context);
        const on = await snapshot(page, testInfo, "on");
        await turnScreenOff(page, copy);

        await refuseScreenOn(page, copy);
        await refreshAndSettle(page, context);
        const refused = await snapshot(page, testInfo, "refused");
        expectRefusedLayout(refused, copy, "route");
        await clickRetryWithoutScrolling(page, copy);
        await expectProfileSelectorUnchanged(page, copy);
        await refreshAndSettle(page, context);
        const backOnMap = await snapshot(page, testInfo, "refused, back on Map");
        expect(backOnMap.card).toEqual(refused.card);
        expect(backOnMap.retry).not.toBeNull();

        await recoverScreenOn(page, copy);
        await refreshAndSettle(page, context);
        expectSameCard(on, await snapshot(page, testInfo, "recovered"), "recovered");

        // A failed End ride: its error stays through the refusal and recovery.
        await armFirstClearFailure(page);
        await page
          .locator("header.riding-immersive-header")
          .getByRole("button", { name: copy.endRide, exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: copy.endRide, exact: true }).click();
        await expect(
          page.getByRole("alert").filter({ hasText: copy.endFailed }),
        ).toBeVisible();
        await refreshAndSettle(page, context);
        const onEnd = await snapshot(page, testInfo, "on, failed End");
        await turnScreenOff(page, copy);

        await refuseScreenOn(page, copy);
        await refreshAndSettle(page, context);
        const refusedEnd = await snapshot(page, testInfo, "refused, failed End");
        expectRefusedLayout(refusedEnd, copy, "route");
        expect(refusedEnd.alerts).toContain(copy.endFailed);
        await clickRetryWithoutScrolling(page, copy);

        await recoverScreenOn(page, copy);
        await refreshAndSettle(page, context);
        const recoveredEnd = await snapshot(page, testInfo, "recovered, failed End");
        expectSameCard(onEnd, recoveredEnd, "recovered after a failed End");
        expect(recoveredEnd.alerts).toContain(copy.endFailed);
      });
    }
  });
}

test.describe("375x667 free roam", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("de: a refused Screen on in free roam keeps its retry whole on its own row and Screen on beside the status, and recovery restores the ordinary card", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(90_000);
    const copy = COPY.de;
    await startRide(page, context, SIZES[1], "de", "free");

    await turnScreenOn(page, copy);
    await refreshAndSettle(page, context);
    const on = await snapshot(page, testInfo, "on");
    await turnScreenOff(page, copy);

    await refuseScreenOn(page, copy);
    await refreshAndSettle(page, context);
    const refused = await snapshot(page, testInfo, "refused");
    expectRefusedLayout(refused, copy, "free");
    await clickRetryWithoutScrolling(page, copy);

    await recoverScreenOn(page, copy);
    await refreshAndSettle(page, context);
    expectSameCard(on, await snapshot(page, testInfo, "recovered"), "recovered");
  });
});

test.describe("390x844: the compact Screen on control (item 145)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const mode of ["route", "free"] as const) {
    for (const language of LANGUAGES) {
      test(`${language}, ${mode}: Screen on sits compact at the card's top right, off and on, and works`, async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(90_000);
        const copy = COPY[language];
        await startRide(page, context, SIZES[0], language, mode);
        await refreshAndSettle(page, context);
        const off = await snapshot(page, testInfo, "off");
        expectCompactControl(off, mode, "off");
        expect(off.toggle?.pressed).toBe("false");
        expect(off.page.scrollWidth).toBeLessThanOrEqual(off.viewport.width);
        expect(off.page.scrollHeight).toBeLessThanOrEqual(off.viewport.height);
        // Free roam has no route, so no Map/Profile switcher.
        if (mode === "route") expect(off.switcher).not.toBeNull();

        // Activated, the pressed treatment changes no geometry.
        await turnScreenOn(page, copy);
        await refreshAndSettle(page, context);
        const on = await snapshot(page, testInfo, "on");
        expectCompactControl(on, mode, "on");
        expect(on.imagery, "the reference's imagery state").toEqual({
          mapReady: "true",
          rows: [],
        });
        expect(off.imagery).toEqual(on.imagery);
        for (const key of ["card", "main", "textColumn"] as const) {
          const x = off[key];
          const y = on[key];
          if (!x || !y) throw new Error(`expected ${key} in both states`);
          for (const side of ["left", "right", "top", "bottom"] as const) {
            expect(Math.abs(x[side] - y[side]), `on: ${key}.${side}`).toBeLessThanOrEqual(
              TOLERANCE_PX,
            );
          }
        }
        await turnScreenOff(page, copy);
      });
    }
  }
});
