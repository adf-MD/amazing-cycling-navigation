import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { inflateSync as zlibInflateSync } from "node:zlib";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Backlog item 145's short-map slice (0.4.72): the follow camera frames the
// rider inside the VISIBLE map, the attribution, paused toast and climb cue
// sit at the visible bottom, the lower-right climb cue stops short of the
// rider's column and below the right-hand controls (18rem), and imported
// routes without trusted turns show one concise status. Measured cases:
// - route riding on a trusted route 60 m before a left turn: German 320x693
//   refused, End's confirmation held, a failed End (the canvas at its 160 px
//   floor with 128 px visible) and recovery, with and without a new fix; an
//   ordinary failed End; English 320x693 refused then refused with a failed
//   End; 375x667 German refused with a failed End; 320x600 German with the
//   canvas held at its floor while the visible map shrinks;
// - the two-climbs import, English 320x693: the concise notice, the rider at
//   its ordinary point beside the cue, refusal, a failed End and recovery
//   with no new fix, a second refusal, Follow and View each working; and the
//   18rem boundary one map pixel either side;
// - camera intent: a completed pan made while a framing renewal is pending,
//   and an anchored zoom followed by North-up, each surviving later layout
//   changes.
//
// Evidence is kept separate: geometry (boxes, the visible region through
// clipping ancestors, canvas against visible height), the current projection
// (data-camera-follow-anchor-*, after a proven settle), paint (the rider's
// fill in a screenshot) and hit testing (elementFromPoint and real clicks).
// Measurements are taken with the map ready and no imagery row in the card.
//
// Why a browser: the framing depends on real layout, ResizeObserver timing,
// MapLibre's projection and camera events, and text metrics in both engines;
// followFramingController.test.ts owns the timing contract, followFraming.test.ts
// the geometry. Overlap: ridingClimbView.spec.ts (Chromium) keeps item 115's
// placement contracts; ridingRefusedScreenOn.smoke.spec.ts the refused card.
// The refusal and the failed End are simulated; nothing here is
// installed-iPhone evidence, and the CI image's fonts are not iOS fonts.

test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const DISC_RADIUS_PX = 13;
const CLEARANCE_PX = 4;
const ORDINARY_OFFSET_PX = 60;
const TOLERANCE_PX = 0.5;
const TOUCH_TARGET_PX = 44;
const GATE_PX = 18 * 16;

const ROUTE_NAME = "item-145-visible-map-route";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;
const TURN_AT_METRES = 800;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const lonAtMetres = (m: number): number => ROUTE_START_LON + m / METRES_PER_DEGREE_LON;

const CLIMB_FIXTURE = fileURLToPath(
  new URL("./fixtures/two-climbs-route.gpx", import.meta.url),
);
const CLIMB_ROUTE_NAME = "two-climbs-route";
const CLIMB_LAT = 51.5;
const CLIMB_START_LON = -0.08;
const CLIMB_MID_METRES = 800;
const climbLonAtMetres = (m: number): number =>
  CLIMB_START_LON + m / METRES_PER_DEGREE_LON;

interface Size {
  width: number;
  height: number;
  top: number;
  bottom: number;
}
const SIZE_375 = { width: 375, height: 667, top: 20, bottom: 0 };
const SIZE_320 = { width: 320, height: 693, top: 47, bottom: 34 };
const SIZE_320_FLOOR = { width: 320, height: 600, top: 20, bottom: 0 };

type Language = "en" | "de";
const COPY = {
  en: {
    startRiding: "Start riding",
    endRide: "End ride",
    cancel: "Cancel",
    endFailed: "The ride could not be ended on this device. Try again.",
    refused: "The screen could not be kept awake.",
    turn: "Turn left onto Church Lane",
    finish: "Arrive at your destination",
    notice: "No turn guidance available.",
  },
  de: {
    startRiding: "Fahrt starten",
    endRide: "Fahrt beenden",
    cancel: "Abbrechen",
    endFailed:
      "Die Fahrt konnte auf diesem Gerät nicht beendet werden. Versuche es erneut.",
    refused: "Das Display konnte nicht an bleiben.",
    turn: "Biegen Sie links ab auf Church Lane",
    finish: "Sie haben Ihr Ziel erreicht",
    notice: "Keine Abbiegehinweise verfügbar.",
  },
} as const;

type Kind = "route" | "climb";

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Measure {
  canvas: Rect;
  visible: Rect;
  rider: { x: number; y: number } | null;
  overlays: { name: string; box: Rect }[];
  /** elementFromPoint at the rider's centre and four points 1 px inside its
   * disc: true where the map canvas, not an overlay, is hit. */
  riderHits: boolean[];
  attribution: { box: Rect; visible: Rect; whole: boolean; linkHit: boolean } | null;
  controls: { box: Rect; whole: boolean; hit: boolean }[];
  cue: {
    box: Rect;
    slotHeight: number;
    textWhole: boolean;
    action: { box: Rect; hit: boolean; whole: boolean };
  } | null;
  screenOnHit: boolean;
  remainingWhole: boolean;
  switcherHit: boolean;
  pageScrolls: boolean;
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

/** A straight 1 km import, made a trusted planner route with a left turn at
 * 800 m (as item 145's probe did), so the manoeuvre card shows. */
function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const metres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(metres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${ROUTE_NAME}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function makeRouteTrusted(page: Page, language: Language): Promise<void> {
  await page.evaluate(
    async ({ dbName, routeName, turn, finish, turnAt, length }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "IndexedDB open failed"));
        };
      });
      const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = db.transaction("routes").objectStore("routes").getAll();
        request.onsuccess = () => {
          resolve(request.result as Record<string, unknown>[]);
        };
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "IndexedDB read failed"));
        };
      });
      const row = rows.find((candidate) => candidate.name === routeName);
      if (!row) throw new Error("imported route row not found");
      row.source = {
        kind: "planner",
        provider: "openrouteservice",
        profile: "cycling-road",
      };
      row.manoeuvreProvenance = {
        kind: "routing-provider",
        provider: "openrouteservice",
      };
      row.manoeuvres = [
        { distanceFromStartMetres: turnAt, type: "left", instruction: turn },
        { distanceFromStartMetres: length, type: "finish", instruction: finish },
      ];
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("routes", "readwrite");
        tx.objectStore("routes").put(row);
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(new Error(tx.error?.message ?? "IndexedDB write failed"));
        };
      });
      db.close();
    },
    {
      dbName: DB_NAME,
      routeName: ROUTE_NAME,
      turn: COPY[language].turn,
      finish: COPY[language].finish,
      turnAt: TURN_AT_METRES,
      length: ROUTE_LENGTH_METRES,
    },
  );
}

/** Synthetic safe-area insets (applied once <html> exists, since an init
 * script runs before it), a wake-lock stub whose next request fails while
 * window.__e2eScreenOnRefuse is true, and a capture-phase record of the
 * button each click reaches. */
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
        __e2eClicks: string[];
      };
      target.__e2eScreenOnRefuse = false;
      target.__e2eClicks = [];
      document.addEventListener(
        "click",
        (event) => {
          const button =
            event.target instanceof Element ? event.target.closest("button") : null;
          target.__e2eClicks.push(
            button
              ? (button.getAttribute("aria-label") ?? button.textContent).trim()
              : "",
          );
        },
        { capture: true },
      );
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: (): Promise<unknown> => {
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

const takeClicks = (page: Page) =>
  page.evaluate(() => {
    const target = window as unknown as { __e2eClicks: string[] };
    const clicks = target.__e2eClicks;
    target.__e2eClicks = [];
    return clicks;
  });

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
              "[data-testid='map-container']",
              ".map-attribution",
              ".ride-climb-cue",
              ".ride-map-paused-toast",
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

/** The camera's settled pose: what application-triggered framing changes and
 * MapLibre's own resize events do not. */
const cameraPose = async (page: Page) => {
  const { center, zoom, bearing, pitch } = await readCamera(page);
  return { center, zoom, bearing, pitch };
};

const readCamera = (page: Page) =>
  page.evaluate(() => {
    const map = document.querySelector<HTMLElement>("[data-testid='map-container']");
    return {
      center: map?.dataset.cameraCenter ?? "",
      zoom: map?.dataset.cameraZoom ?? "",
      bearing: map?.dataset.cameraBearing ?? "",
      pitch: map?.dataset.cameraPitch ?? "",
      anchorX: map?.dataset.cameraFollowAnchorX ?? "",
      anchorY: map?.dataset.cameraFollowAnchorY ?? "",
    };
  });

/** The camera's settled values unchanged for a window longer than a follow
 * ease (600 ms) plus the framing's settle (120 ms). */
async function cameraStable(page: Page, windowMs: number): Promise<void> {
  let last = JSON.stringify(await readCamera(page));
  let since = Date.now();
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    await page.waitForTimeout(100);
    const now = JSON.stringify(await readCamera(page));
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= windowMs) {
      return;
    }
  }
  throw new Error("the camera did not settle");
}

async function mapSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("map-container")).toHaveAttribute(
    "data-map-ready",
    "true",
    {
      timeout: 20_000,
    },
  );
  await expect(
    page.locator(".ride-status-card .ride-status-card-imagery-row"),
  ).toHaveCount(0, { timeout: 20_000 });
}

interface Ride {
  page: Page;
  context: BrowserContext;
  kind: Kind;
  language: Language;
  step: number;
}

/** A fresh fix 4 m on (alternating), a proven settle (the camera's centre
 * changes), then a stable window. */
async function freshFix(ride: Ride): Promise<Measure> {
  const { page, context, kind } = ride;
  ride.step += 1;
  const before = await readCamera(page);
  const along = ride.step % 2 === 1 ? 4 : 0;
  await context.setGeolocation(
    kind === "climb"
      ? {
          latitude: CLIMB_LAT,
          longitude: climbLonAtMetres(CLIMB_MID_METRES + along),
          accuracy: 5,
        }
      : { latitude: ROUTE_LAT, longitude: lonAtMetres(740 + along), accuracy: 5 },
  );
  await expect.poll(async () => (await readCamera(page)).center).not.toBe(before.center);
  await cameraStable(page, 800);
  await settle(page);
  await mapSettled(page);
  return measure(page);
}

/** No new fix: the layout quiet, then the camera quiet for long enough for
 * any renewal a layout change starts to finish. */
async function noFix(ride: Ride): Promise<Measure> {
  await settle(ride.page);
  await cameraStable(ride.page, 1200);
  await settle(ride.page);
  await mapSettled(ride.page);
  return measure(ride.page);
}

function measure(page: Page): Promise<Measure> {
  return page.evaluate((radius): Measure => {
    const box = (element: Element): Rect => {
      const b = element.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    };
    const inter = (a: Rect, b: Rect): Rect => ({
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    });
    const viewport: Rect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    /** Clipped by every ancestor that clips and by the viewport. */
    const visibleRect = (element: Element): Rect => {
      let q = box(element);
      for (let a = element.parentElement; a; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.display === "contents") continue;
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          const ab = a.getBoundingClientRect();
          const left = ab.left + a.clientLeft;
          const top = ab.top + a.clientTop;
          q = inter(q, {
            left,
            top,
            right: left + a.clientWidth,
            bottom: top + a.clientHeight,
          });
        }
      }
      return inter(q, viewport);
    };
    const same = (a: Rect, b: Rect) =>
      Math.abs(a.left - b.left) < 0.5 &&
      Math.abs(a.right - b.right) < 0.5 &&
      Math.abs(a.top - b.top) < 0.5 &&
      Math.abs(a.bottom - b.bottom) < 0.5;
    const hits = (element: Element, x: number, y: number) => {
      const at = document.elementFromPoint(x, y);
      return !!at && (at === element || element.contains(at));
    };
    const centreHit = (element: Element) => {
      const b = box(element);
      return hits(element, (b.left + b.right) / 2, (b.top + b.bottom) / 2);
    };
    const textWhole = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const visible = visibleRect(element);
      return [...range.getClientRects()]
        .filter((r) => r.width > 0)
        .every(
          (r) =>
            r.left >= visible.left - 0.5 &&
            r.right <= visible.right + 0.5 &&
            r.top >= visible.top - 0.5 &&
            r.bottom <= visible.bottom + 0.5,
        );
    };
    const map = document.querySelector<HTMLElement>("[data-testid='map-container']");
    if (!map) throw new Error("no map");
    const canvas = box(map);
    const visible = visibleRect(map);
    const ax = Number.parseFloat(map.dataset.cameraFollowAnchorX ?? "");
    const ay = Number.parseFloat(map.dataset.cameraFollowAnchorY ?? "");
    const rider =
      Number.isFinite(ax) && Number.isFinite(ay)
        ? { x: canvas.left + ax, y: canvas.top + ay }
        : null;
    const attribution = document.querySelector(".ride-map-container .map-attribution");
    const link = attribution?.querySelector("a") ?? null;
    const cameraButtons = [
      ...document.querySelectorAll(".ride-map-zoom-controls button"),
      ...document.querySelectorAll(".ride-map-camera-controls button"),
    ];
    const cue = document.querySelector(".ride-climb-cue");
    const action = cue?.querySelector(".ride-climb-cue-action") ?? null;
    const toast = document.querySelector(".ride-map-paused-toast");
    const overlays = [
      ...(attribution ? [{ name: "attribution", box: box(attribution) }] : []),
      ...cameraButtons.map((button, index) => ({
        name: `control ${String(index)}`,
        box: box(button),
      })),
      ...(cue ? [{ name: "climb cue", box: box(cue) }] : []),
      ...(toast ? [{ name: "paused toast", box: box(toast) }] : []),
    ];
    const toggle = document.querySelector(".ride-status-card .wake-lock-toggle");
    const remaining = document.querySelector(".ride-status-card-remaining");
    const switcher = [...document.querySelectorAll(".ride-immersive-switcher button")];
    const root = document.documentElement;
    return {
      canvas,
      visible,
      rider,
      overlays,
      riderHits: rider
        ? [
            [0, 0],
            [radius - 1, 0],
            [-(radius - 1), 0],
            [0, radius - 1],
            [0, -(radius - 1)],
          ].map(([dx = 0, dy = 0]) => hits(map, rider.x + dx, rider.y + dy))
        : [],
      attribution: attribution
        ? {
            box: box(attribution),
            visible: visibleRect(attribution),
            whole:
              same(box(attribution), visibleRect(attribution)) && textWhole(attribution),
            linkHit: link ? centreHit(link) : false,
          }
        : null,
      controls: cameraButtons.map((button) => ({
        box: box(button),
        whole: same(box(button), visibleRect(button)),
        hit: centreHit(button),
      })),
      cue:
        cue && action
          ? {
              box: box(cue),
              slotHeight: cue.parentElement?.getBoundingClientRect().height ?? 0,
              textWhole: textWhole(cue),
              action: {
                box: box(action),
                hit: centreHit(action),
                whole: same(box(action), visibleRect(action)),
              },
            }
          : null,
      screenOnHit: toggle ? centreHit(toggle) : false,
      remainingWhole: remaining ? textWhole(remaining) : false,
      switcherHit: switcher.length === 2 && switcher.every((button) => centreHit(button)),
      pageScrolls:
        root.scrollHeight > root.clientHeight || root.scrollWidth > root.clientWidth,
    };
  }, DISC_RADIUS_PX);
}

/** The smallest gap between the rider's disc and the visible map's edges or
 * any overlay across the disc's width; negative when covered or cut. */
function riderGap(m: Measure): number {
  const rider = m.rider;
  if (!rider) throw new Error("no projected rider");
  const r = DISC_RADIUS_PX;
  const gaps = [
    rider.y - r - m.visible.top,
    m.visible.bottom - (rider.y + r),
    rider.x - r - m.visible.left,
    m.visible.right - (rider.x + r),
  ];
  for (const { box } of m.overlays) {
    if (box.right <= rider.x - r || box.left >= rider.x + r) continue;
    if (box.top >= rider.y) gaps.push(box.top - (rider.y + r));
    else if (box.bottom <= rider.y) gaps.push(rider.y - r - box.bottom);
    else gaps.push(-r);
  }
  return Math.min(...gaps);
}

/** Geometry and hit testing: the rider's 13 px disc lies wholly inside the
 * visible map, clear of every overlay by at least `minGap`, and the map
 * itself is what is hit at and around its centre. */
function expectRiderWhole(m: Measure, label: string, minGap = 0): void {
  expect(m.rider, `${label}: a projected rider`).not.toBeNull();
  expect(riderGap(m), `${label}: rider gap ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(
    minGap - 0.01,
  );
  expect(m.riderHits, `${label}: hit test at the rider`).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
}

/** The rider at the ordinary anchor: 60 px below the visible map's centre,
 * at the canvas's horizontal centre. */
function expectOrdinaryAnchor(m: Measure, label: string): void {
  const rider = m.rider;
  if (!rider) throw new Error(`${label}: no projected rider`);
  expect(rider.y, `${label}: ordinary anchor`).toBeCloseTo(
    (m.visible.top + m.visible.bottom) / 2 + ORDINARY_OFFSET_PX,
    0,
  );
  expect(Math.abs(rider.x - (m.canvas.left + m.canvas.right) / 2)).toBeLessThanOrEqual(
    TOLERANCE_PX,
  );
}

/** The ride's fixed chrome still operable, the attribution whole with its
 * link reachable, and nothing scrolls. */
function expectOperable(m: Measure, label: string, controls = true): void {
  expect(m.attribution?.whole, `${label}: attribution whole`).toBe(true);
  expect(m.attribution?.linkHit, `${label}: attribution link reachable`).toBe(true);
  if (m.attribution) {
    expect(m.attribution.box.bottom).toBeLessThanOrEqual(m.visible.bottom + TOLERANCE_PX);
  }
  if (controls) {
    expect(m.controls, `${label}: four map controls`).toHaveLength(4);
    for (const control of m.controls) {
      expect(
        control.whole && control.hit,
        `${label}: control ${JSON.stringify(control)}`,
      ).toBe(true);
    }
  }
  expect(m.screenOnHit, `${label}: Screen on reachable`).toBe(true);
  expect(m.remainingWhole, `${label}: remaining distance and ascent whole`).toBe(true);
  expect(m.switcherHit, `${label}: Map/Profile switcher reachable`).toBe(true);
  expect(m.pageScrolls, `${label}: no page scroll`).toBe(false);
}

/** Paint: the rider's blue fill (#1a73e8) is painted, centred on the
 * projection within 1 px, with a half-width of at least 5 px — an overlay or
 * the map's edge cutting the fill would move its centre. */
async function expectRiderPainted(page: Page, m: Measure, label: string): Promise<void> {
  const rider = m.rider;
  if (!rider) throw new Error(`${label}: no projected rider`);
  const clip = {
    x: Math.floor(rider.x - 16),
    y: Math.floor(rider.y - 16),
    width: 32,
    height: 32,
  };
  const png = decodePng(await page.screenshot({ clip, scale: "css" }));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let j = 0; j < png.height; j += 1) {
    for (let i = 0; i < png.width; i += 1) {
      const o = (j * png.width + i) * png.bytesPerPixel;
      const r = png.pixels[o];
      const g = png.pixels[o + 1];
      const b = png.pixels[o + 2];
      if (Math.abs(r - 26) <= 45 && Math.abs(g - 115) <= 45 && Math.abs(b - 232) <= 45) {
        xs.push(clip.x + i + 0.5);
        ys.push(clip.y + j + 0.5);
      }
    }
  }
  expect(xs.length, `${label}: painted fill`).toBeGreaterThan(0);
  const left = Math.min(...xs) - 0.5;
  const right = Math.max(...xs) + 0.5;
  const top = Math.min(...ys) - 0.5;
  const bottom = Math.max(...ys) + 0.5;
  expect(
    Math.abs((left + right) / 2 - rider.x),
    `${label}: fill centred (x)`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((top + bottom) / 2 - rider.y),
    `${label}: fill centred (y)`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.min(right - left, bottom - top) / 2,
    `${label}: fill half-width`,
  ).toBeGreaterThanOrEqual(5);
}

/** Copied from ridingClimbView.spec.ts per this repo's
 * no-shared-e2e-helpers convention: 8-bit, non-interlaced RGB or RGBA. */
function decodePng(buf: Buffer): {
  width: number;
  height: number;
  pixels: Buffer;
  bytesPerPixel: number;
} {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `unsupported PNG format bitDepth=${String(bitDepth)} colorType=${String(colorType)}`,
    );
  }
  const raw = zlibInflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rawOffset + x];
      const a = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
      const b = y > 0 ? pixels[prevRowStart + x] : 0;
      const c =
        y > 0 && x >= bytesPerPixel ? pixels[prevRowStart + x - bytesPerPixel] : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = (rawByte + a) & 0xff;
          break;
        case 2:
          value = (rawByte + b) & 0xff;
          break;
        case 3:
          value = (rawByte + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = (rawByte + predictor) & 0xff;
          break;
        }
        default:
          throw new Error(`unsupported filter type ${String(filterType)}`);
      }
      pixels[rowStart + x] = value;
    }
    rawOffset += stride;
  }
  return { width, height, pixels, bytesPerPixel };
}

async function startRide(
  page: Page,
  context: BrowserContext,
  size: Size,
  kind: Kind,
  language: Language,
): Promise<Ride> {
  const copy = COPY[language];
  await page.setViewportSize({ width: size.width, height: size.height });
  await installStubs(page, size);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(
    kind === "climb"
      ? {
          latitude: CLIMB_LAT,
          longitude: climbLonAtMetres(CLIMB_MID_METRES),
          accuracy: 5,
        }
      : { latitude: ROUTE_LAT, longitude: ROUTE_START_LON, accuracy: 5 },
  );
  await installLocalMapStyle(page);
  await page.goto("/");
  if (kind === "route") {
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${ROUTE_NAME}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildStraightRouteGpx()),
    });
    await expect(
      page.getByRole("button", { name: ROUTE_NAME, exact: true }),
    ).toBeVisible();
    await makeRouteTrusted(page, language);
  } else {
    await page.getByLabel("Import GPX file").setInputFiles(CLIMB_FIXTURE);
    await expect(
      page.getByRole("button", { name: CLIMB_ROUTE_NAME, exact: true }),
    ).toBeVisible();
  }
  await seedLanguagePreference(page, language);
  await page.reload();
  await page
    .getByRole("button", {
      name: kind === "route" ? ROUTE_NAME : CLIMB_ROUTE_NAME,
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: copy.startRiding }).click();
  await expect(page.locator("header.riding-immersive-header")).toBeVisible();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await mapSettled(page);
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ sessionId: expect.any(String) });
  if (kind === "route") {
    await expect(page.locator(".ride-manoeuvre-card")).toContainText(copy.turn);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
    await expect(page.locator(".ride-manoeuvre-distance")).toHaveText(/^400\s?m$/);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(736) });
    await expect(page.locator(".ride-manoeuvre-distance")).toHaveText(/^60\s?m$/);
  } else {
    await expect(page.locator(".ride-climb-cue")).toBeVisible({ timeout: 15_000 });
  }
  await settle(page);
  return { page, context, kind, language, step: 0 };
}

async function refuse(ride: Ride): Promise<void> {
  const toggle = ride.page.locator(".ride-status-card .wake-lock-toggle");
  if ((await toggle.getAttribute("aria-pressed")) === "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  }
  await setRefuse(ride.page, true);
  await toggle.click();
  await expect(
    ride.page.getByRole("alert").filter({ hasText: COPY[ride.language].refused }),
  ).toBeVisible();
}

async function recover(ride: Ride): Promise<void> {
  await setRefuse(ride.page, false);
  await ride.page.locator(".ride-status-card .wake-lock-failure-row button").click();
  await expect(
    ride.page.getByRole("alert").filter({ hasText: COPY[ride.language].refused }),
  ).toHaveCount(0);
  await expect(ride.page.locator(".ride-status-card .wake-lock-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function openEndConfirmation(ride: Ride) {
  await ride.page
    .locator("header.riding-immersive-header")
    .getByRole("button", { name: COPY[ride.language].endRide, exact: true })
    .click();
  const dialog = ride.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function failEnd(ride: Ride): Promise<void> {
  await armFirstClearFailure(ride.page);
  const dialog = await openEndConfirmation(ride);
  await dialog
    .getByRole("button", { name: COPY[ride.language].endRide, exact: true })
    .click();
  await expect(
    ride.page.getByRole("alert").filter({ hasText: COPY[ride.language].endFailed }),
  ).toBeVisible();
}

const followButton = (page: Page) =>
  page.locator(".ride-map-camera-controls button").nth(1);

test.describe("rider visibility in the visible map (item 145)", () => {
  test("320x693, German: refused, End's confirmation, a failed End at the canvas floor and recovery, with and without a new fix", async ({
    page,
    context,
  }) => {
    const ride = await startRide(page, context, SIZE_320, "route", "de");
    const ordinary = await freshFix(ride);
    expectOrdinaryAnchor(ordinary, "ordinary");
    expectRiderWhole(ordinary, "ordinary");
    await expectRiderPainted(page, ordinary, "ordinary");
    // Unclipped: the attribution where it always was.
    expect(ordinary.canvas.bottom - (ordinary.attribution?.box.bottom ?? 0)).toBeCloseTo(
      8,
      1,
    );

    await refuse(ride);
    const refused = await noFix(ride);
    expectRiderWhole(refused, "refused, no fix", CLEARANCE_PX);
    await expectRiderPainted(page, refused, "refused, no fix");
    expectOperable(refused, "refused, no fix");

    // End's confirmation collapses the visible map. Application-triggered
    // framing would move the camera's settled values; MapLibre's own
    // resize events cannot, so those values are compared.
    const beforeConfirmation = await cameraPose(page);
    const dialog = await openEndConfirmation(ride);
    await page.waitForTimeout(1500);
    expect(await cameraPose(page)).toEqual(beforeConfirmation);
    await dialog.getByRole("button", { name: COPY.de.cancel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await noFix(ride);
    expect(await cameraPose(page)).toEqual(beforeConfirmation);

    await failEnd(ride);
    const ended = await noFix(ride);
    // The canvas held at its 160 px floor, part of it hidden below.
    expect(ended.canvas.bottom - ended.canvas.top).toBeCloseTo(160, 0);
    expect(ended.visible.bottom).toBeLessThan(ended.canvas.bottom - 1);
    expectRiderWhole(ended, "refused + failed End, no fix", CLEARANCE_PX);
    await expectRiderPainted(page, ended, "refused + failed End, no fix");
    expectOperable(ended, "refused + failed End, no fix");
    const endedFresh = await freshFix(ride);
    expectRiderWhole(endedFresh, "refused + failed End, fresh fix", CLEARANCE_PX);
    expect(
      Math.abs((endedFresh.rider?.y ?? 0) - (ended.rider?.y ?? 0)),
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    // Back to the 180 px layout of a failed End alone, with no new fix: the
    // framing that layout decides (refused alone measured the same height).
    await recover(ride);
    const recovered = await noFix(ride);
    expectRiderWhole(recovered, "recovered, no fix", CLEARANCE_PX);
    expect(
      Math.abs((recovered.rider?.y ?? 0) - (refused.rider?.y ?? 0)),
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expectOperable(recovered, "recovered, no fix");
  });

  test("320x693, German: an ordinary failed End", async ({ page, context }) => {
    const ride = await startRide(page, context, SIZE_320, "route", "de");
    await freshFix(ride);
    await failEnd(ride);
    const ended = await freshFix(ride);
    expectRiderWhole(ended, "failed End", CLEARANCE_PX);
    await expectRiderPainted(page, ended, "failed End");
    expectOperable(ended, "failed End");
  });

  test("320x693, English: refused keeps the ordinary anchor, and a failed End at the canvas floor keeps the rider whole", async ({
    page,
    context,
  }) => {
    const ride = await startRide(page, context, SIZE_320, "route", "en");
    await refuse(ride);
    const refused = await freshFix(ride);
    // Whole and clear with less than the corrective clearance: kept.
    expectOrdinaryAnchor(refused, "refused");
    expectRiderWhole(refused, "refused");
    expectOperable(refused, "refused");

    await failEnd(ride);
    const ended = await noFix(ride);
    expect(ended.visible.bottom).toBeLessThan(ended.canvas.bottom - 1);
    expectRiderWhole(ended, "refused + failed End, no fix", CLEARANCE_PX);
    await expectRiderPainted(page, ended, "refused + failed End, no fix");
    expectOperable(ended, "refused + failed End, no fix");
  });

  test("375x667, German: refused with a failed End", async ({ page, context }) => {
    const ride = await startRide(page, context, SIZE_375, "route", "de");
    await refuse(ride);
    await failEnd(ride);
    const ended = await freshFix(ride);
    expectRiderWhole(ended, "refused + failed End", CLEARANCE_PX);
    await expectRiderPainted(page, ended, "refused + failed End");
    expectOperable(ended, "refused + failed End");
  });

  test("320x600, German: the canvas held at its floor while its clipping ancestor shrinks, with no new fix", async ({
    page,
    context,
  }) => {
    const ride = await startRide(page, context, SIZE_320_FLOOR, "route", "de");
    await refuse(ride);
    const refused = await freshFix(ride);
    expect(refused.canvas.bottom - refused.canvas.top).toBeCloseTo(160, 0);
    expectRiderWhole(refused, "refused", CLEARANCE_PX);

    await failEnd(ride);
    const ended = await noFix(ride);
    // The canvas itself does not change, so only the ancestor's change can
    // reveal the smaller visible map.
    expect(ended.canvas.bottom - ended.canvas.top).toBeCloseTo(160, 0);
    expect(ended.visible.bottom - ended.visible.top).toBeLessThan(
      refused.visible.bottom - refused.visible.top - 20,
    );
    expectRiderWhole(ended, "refused + failed End, no fix", CLEARANCE_PX);
    await expectRiderPainted(page, ended, "refused + failed End, no fix");
    // Below about 112 px the controls themselves no longer fit (a recorded,
    // pre-existing limit): only the attribution is checked here.
    expectOperable(ended, "refused + failed End, no fix", false);
  });

  test("the climb, English, 320x693: the concise notice, the rider at its ordinary point beside the cue, a failed End and refusals with no new fix, and Follow and View each working", async ({
    page,
    context,
  }) => {
    const ride = await startRide(page, context, SIZE_320, "climb", "en");
    const notice = page.getByRole("status").filter({ hasText: COPY.en.notice });
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveText(COPY.en.notice);
    await expect(page.locator("[aria-expanded]")).toHaveCount(0);
    await notice.evaluate((element) => {
      (window as unknown as { __e2eNotice: Element }).__e2eNotice = element;
    });
    const noticeUnchanged = () =>
      notice.evaluate(
        (element) =>
          element === (window as unknown as { __e2eNotice: Element }).__e2eNotice &&
          element.isConnected,
      );

    const ordinary = await freshFix(ride);
    expectOrdinaryAnchor(ordinary, "ordinary climb");
    expectRiderWhole(ordinary, "ordinary climb");
    await expectRiderPainted(page, ordinary, "ordinary climb");
    const cue = ordinary.cue;
    if (!cue || !ordinary.rider) throw new Error("expected the cue and the rider");
    // The cue leaves the rider's column clear by the corrective clearance.
    expect(cue.box.left).toBeGreaterThanOrEqual(
      ordinary.rider.x + DISC_RADIUS_PX + CLEARANCE_PX - TOLERANCE_PX,
    );
    expect(cue.textWhole).toBe(true);
    expect(cue.action.whole && cue.action.hit).toBe(true);
    expect(cue.action.box.right - cue.action.box.left).toBeGreaterThanOrEqual(
      TOUCH_TARGET_PX,
    );
    expect(cue.action.box.bottom - cue.action.box.top).toBeGreaterThanOrEqual(
      TOUCH_TARGET_PX,
    );
    expectOperable(ordinary, "ordinary climb");

    await refuse(ride);
    const refused = await noFix(ride);
    expectRiderWhole(refused, "refused, no fix");
    expect(refused.cue?.box.top ?? 0).toBeLessThanOrEqual(
      refused.visible.top + 8 + TOLERANCE_PX,
    );

    await failEnd(ride);
    const ended = await noFix(ride);
    expectRiderWhole(ended, "refused + failed End, no fix");
    await expectRiderPainted(page, ended, "refused + failed End, no fix");
    expectOperable(ended, "refused + failed End, no fix");

    await recover(ride);
    const recovered = await noFix(ride);
    expectRiderWhole(recovered, "recovered, no fix");
    expectOperable(recovered, "recovered, no fix");

    // A second shrink after the recovery, still with no new fix.
    await refuse(ride);
    const refusedAgain = await noFix(ride);
    expectRiderWhole(refusedAgain, "refused again, no fix");
    await recover(ride);
    const start = await noFix(ride);
    expectRiderWhole(start, "recovered again, no fix");

    // The cue and Follow no longer intersect, so each action is checked
    // from the same recovered, following Map view.
    const follow = start.controls.at(3)?.box;
    const startCue = start.cue;
    if (!follow || !startCue) throw new Error("expected Follow and the cue");
    const intersects =
      Math.min(follow.right, startCue.box.right) >
        Math.max(follow.left, startCue.box.left) &&
      Math.min(follow.bottom, startCue.box.bottom) >
        Math.max(follow.top, startCue.box.top);
    expect(intersects, JSON.stringify({ follow, cue: startCue.box })).toBe(false);
    await takeClicks(page);
    await page.mouse.click(
      (follow.left + follow.right) / 2,
      (follow.top + follow.bottom) / 2,
    );
    expect(await takeClicks(page)).toEqual(["Follow my location"]);
    await expect(followButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".ride-immersive-switcher button").nth(0)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await noFix(ride);
    const action = (await measure(page)).cue?.action.box;
    if (!action) throw new Error("expected the cue's action");
    await page.mouse.click(
      (action.left + action.right) / 2,
      (action.top + action.bottom) / 2,
    );
    expect(await takeClicks(page)).toEqual(["View climb"]);
    await expect(page.locator(".ride-immersive-switcher button").nth(1)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator(".ride-immersive-switcher button").nth(0).click();
    expect(await noticeUnchanged()).toBe(true);
    await expect(notice).toHaveText(COPY.en.notice);
  });

  test("the climb, English: one map pixel either side of the 18rem lower-right threshold", async ({
    page,
    context,
  }) => {
    const ride = await startRide(page, context, SIZE_320, "climb", "en");
    const first = await freshFix(ride);
    const slot = first.cue?.slotHeight ?? 0;
    expect(slot).toBeGreaterThan(GATE_PX);
    for (const target of [GATE_PX, GATE_PX - 1]) {
      // The map's height follows the viewport's one for one here.
      const height = SIZE_320.height - Math.round(slot - target);
      await page.setViewportSize({ width: SIZE_320.width, height });
      await settle(page);
      const m = await freshFix(ride);
      const cue = m.cue;
      if (!cue || !m.rider) throw new Error("expected the cue and the rider");
      expect(cue.slotHeight, `slot at ${String(height)}`).toBeCloseTo(target, 0);
      const follow = m.controls.at(3)?.box;
      if (!follow) throw new Error("expected Follow");
      const clearOfFollow =
        cue.box.top >= follow.bottom ||
        cue.box.right <= follow.left ||
        cue.box.left >= follow.right;
      expect(clearOfFollow, JSON.stringify({ cue: cue.box, follow })).toBe(true);
      if (target >= GATE_PX) {
        // Lower right, short of the rider's column.
        expect(m.canvas.right - cue.box.right).toBeCloseTo(8, 0);
        expect(cue.box.left).toBeGreaterThanOrEqual(
          m.rider.x + DISC_RADIUS_PX + CLEARANCE_PX - TOLERANCE_PX,
        );
      } else {
        expect(cue.box.top - m.visible.top).toBeLessThanOrEqual(8 + TOLERANCE_PX);
      }
      expectOrdinaryAnchor(m, `map ${String(target)} px`);
      expectRiderWhole(m, `map ${String(target)} px`);
      expect(cue.textWhole && cue.action.hit && cue.action.whole).toBe(true);
    }
  });

  test("320x693, German: a pan made while a renewal is pending ends the framing, and later layout changes leave the panned camera alone", async ({
    page,
    context,
  }) => {
    const ride = await startRide(page, context, SIZE_320, "route", "de");
    await freshFix(ride);
    const following = await cameraPose(page);
    await expect(followButton(page)).toHaveAttribute("aria-pressed", "true");
    // The refusal's row shrinks the visible map, so a renewal becomes due
    // once the layout has settled; the drag starts straight away, inside
    // the map where it now is, within that settle.
    await setRefuse(page, true);
    await page.locator(".ride-status-card .wake-lock-toggle").click();
    await expect(
      page.getByRole("alert").filter({ hasText: COPY.de.refused }),
    ).toBeVisible();
    const map = await page.getByTestId("map-container").boundingBox();
    if (!map) throw new Error("expected the map to have a box");
    const x = map.x + map.width / 2 - 40;
    const y = map.y + 70;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1)
      await page.mouse.move(x + 6 * step, y + 3 * step);
    await page.mouse.up();
    await expect(followButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".ride-map-paused-toast")).toBeVisible();
    await noFix(ride);
    const panned = await cameraPose(page);
    expect(panned.center).not.toBe(following.center);

    for (const change of ["failed End", "recovery"] as const) {
      if (change === "failed End") await failEnd(ride);
      else await recover(ride);
      await noFix(ride);
      expect(await cameraPose(page), change).toEqual(panned);
      await expect(followButton(page)).toHaveAttribute("aria-pressed", "false");
    }
  });

  test("320x693, German: an anchored zoom is kept and re-framed after a refusal, and North-up then survives a failed End and a fresh fix", async ({
    page,
    context,
  }) => {
    const ride = await startRide(page, context, SIZE_320, "route", "de");
    const before = await freshFix(ride);
    const zoomBefore = (await readCamera(page)).zoom;
    await page.locator(".ride-map-zoom-controls button").nth(0).click();
    await expect.poll(async () => (await readCamera(page)).zoom).not.toBe(zoomBefore);
    await cameraStable(page, 800);
    await expect(followButton(page)).toHaveAttribute("aria-pressed", "true");
    const zoomed = (await readCamera(page)).zoom;
    expectRiderWhole(before, "before the zoom");

    await refuse(ride);
    const refused = await noFix(ride);
    expect((await readCamera(page)).zoom).toBe(zoomed);
    expectRiderWhole(refused, "refused at the chosen zoom", CLEARANCE_PX);

    await page.locator(".ride-map-camera-controls button").nth(0).click();
    await expect
      .poll(async () => {
        const camera = await readCamera(page);
        return [camera.bearing, camera.pitch];
      })
      .toEqual(["0", "0"]);
    await noFix(ride);
    const northUp = await cameraPose(page);
    await failEnd(ride);
    await noFix(ride);
    expect(await cameraPose(page)).toMatchObject({
      center: northUp.center,
      zoom: northUp.zoom,
      bearing: "0",
      pitch: "0",
    });
    ride.step += 1;
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(748) });
    await settle(page);
    await cameraStable(page, 1200);
    expect(await cameraPose(page)).toMatchObject({
      center: northUp.center,
      bearing: "0",
      pitch: "0",
    });
    await expect(followButton(page)).toHaveAttribute("aria-pressed", "false");
  });
});
