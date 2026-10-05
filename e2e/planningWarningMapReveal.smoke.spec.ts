import { expect, test, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 124, slice 10 (P-18), in both engines (this file runs under
// the "chromium" and "webkit-smoke" projects). Tapping a surface warning's
// highlighted stretch on Planning's map selects it, and its row in Route
// warnings expands to show "Surface: …" and "Route position: …". The page
// must then bring the row and those details into view together: below the
// sticky navigation plus an 8px gap, above the visible viewport's bottom
// less the safe-area inset plus 8px; not at all when the item already
// fits, otherwise by the minimum; and, when the item is taller than that
// band, with its beginning just below the navigation. Smooth unless
// reduced motion is set. One reveal per map selection, never repeated.
//
// Every geometry assertion is made against the band measured in the page,
// and each is labelled:
//   [behaviour]      what the rider sees: the row and its details inside
//                    the band, where they come to rest, focus, waypoints;
//   [implementation] how the app moved the page: its scroll calls,
//                    recorded by an init script.
// Only [behaviour] assertions count as visible regression evidence.
//
// Synthetic, and labelled where used: the routing provider is answered
// locally with a straight line between the requested waypoints carrying
// three surface warnings; the 34px bottom inset is the
// `--safe-area-inset-bottom` seam index.css documents; and the short and
// tall viewports are geometry stand-ins, not devices. Browser root-text
// scaling is not iOS Larger Text. Positioning is a programmatic scroll the
// test makes, kept in the scroll record as "test setup"; the rider's own
// scrolling is a real wheel, recorded as the page received it. Waiting is
// judged by timers, never animation frames, since headless WebKit can defer
// them. After an uninterrupted reveal, the test waits for the expected
// final geometry rather than a quiet moment: under load, headless WebKit
// can stand still for over two seconds before completing a smooth scroll.
// After a rider's input, nothing waits for the reveal's original
// destination; what the engine does with that input is not asserted.
//
// No test in this file contacts a live map or routing provider.

const LAT = 51.5;
const LON = -0.04;

test.use({
  serviceWorkers: "block",
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  geolocation: { latitude: LAT, longitude: LON },
  permissions: ["geolocation"],
});

// The whole record — every scroll attempt with its origin, start and
// destination, the trajectory and every wheel event — kept with each
// result, on failure as well as success.
test.afterEach(async ({ page }, testInfo) => {
  try {
    await testInfo.attach("scroll-record", {
      body: JSON.stringify(await recorded(page)),
      contentType: "application/json",
    });
  } catch {
    // The page may already be gone; the test's own failure says why.
  }
});

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DB_NAME = "amazing-cycling-navigation";
const GAP = 8;
const EDGE_TOLERANCE = 1.5;

const COPY = {
  en: {
    plan: "Plan",
    calculate: "Calculate route",
    warnings: "Route warnings",
    questionable: /^Questionable surface/,
    unknown: /^Unknown surface/,
    surface: "Surface: Compacted gravel",
    position: /^Route position: /,
    selected: /^Selected warning: /,
    clearSelection: "Clear warning selection",
  },
  de: {
    plan: "Planen",
    calculate: "Route berechnen",
    warnings: "Warnungen",
    questionable: /^Bedingt geeigneter Belag/,
    unknown: /^Unbekannter Belag/,
    surface: "Belag: Verdichteter Schotter",
    position: /^Position auf der Route: /,
    selected: /^Ausgewählte Warnung: /,
    clearSelection: "Auswahl der Warnung aufheben",
  },
} as const;
type Language = keyof typeof COPY;

// The synthetic route: the straight line between the two requested
// waypoints, 31 evenly spaced points, flat, with ORS surface codes giving
// questionable 20–40% (8, compacted gravel), unknown 60–80% (0) and
// unsuitable 80–100% (12). Built from the request, so the painted line
// runs through the two waypoint markers' centres.
const POINT_COUNT = 31;

/** Fails the test with a message instead of asserting non-null. */
function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}
const QUESTIONABLE_AT = 0.3;
// Unknown runs from 60% to 80%, and unsuitable adjoins it at 80%: 64% keeps
// the tap clear of the unsuitable stretch even once the map is zoomed out.
const UNKNOWN_AT = 0.64;

function buildOrsResponse(coordinates: readonly (readonly number[])[]) {
  const start = present(coordinates.at(0), "the first waypoint");
  const end = present(coordinates.at(-1), "the last waypoint");
  const points = Array.from({ length: POINT_COUNT }, (_, i) => {
    const t = i / (POINT_COUNT - 1);
    return [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1]), 10];
  });
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          summary: { distance: 1000, duration: 200 },
          extras: {
            surface: {
              values: [
                [0, 6, 1],
                [6, 12, 8],
                [12, 18, 1],
                [18, 24, 0],
                [24, 30, 12],
              ],
            },
          },
        },
        geometry: { type: "LineString", coordinates: points },
      },
    ],
  };
}

/** Records every attempt to scroll the page — `window.scrollBy`,
 * `scrollTo` and `scroll`, `Element.prototype.scrollIntoView`, `scrollBy`,
 * `scrollTo` and `scroll`, and writes to the document scroller's
 * `scrollTop` — with its time, the position it started from and, where it
 * names one, its destination clamped to the page's scroll range; then
 * forwards it unchanged, so a repeated reveal is both recorded and carried
 * out. Also records every real `wheel` event the page receives, and the
 * scroll trajectory. Installed before the app runs.
 *
 * Every attempt counts as the application's, except the one the test
 * itself makes through `setupScroll`, which marks the next attempt as
 * "test setup" in the record rather than leaving it out. */
function instrument() {
  interface Attempt {
    t: number;
    kind: string;
    arg: string;
    origin: "app" | "test setup";
    y: number;
    maxScrollY: number;
    destination: number | null;
  }
  interface Recorder {
    calls: Attempt[];
    positions: { t: number; y: number }[];
    wheels: { t: number; y: number; deltaY: number; target: string }[];
    nextIsSetup: boolean;
  }
  const recorder: Recorder = { calls: [], positions: [], wheels: [], nextIsSetup: false };
  (window as unknown as { __p18: Recorder }).__p18 = recorder;
  const scroller = () => document.scrollingElement ?? document.documentElement;
  const maxScrollY = () => scroller().scrollHeight - scroller().clientHeight;
  const clamp = (y: number) => Math.min(Math.max(y, 0), maxScrollY());
  /** The vertical target named by scrollBy/scrollTo-style arguments. */
  const named = (args: unknown[]): number | null => {
    const [first, second] = args;
    if (typeof first === "object" && first !== null && "top" in first) {
      const top = (first as { top?: unknown }).top;
      return typeof top === "number" ? top : null;
    }
    return typeof second === "number" ? second : null;
  };
  const record = (kind: string, args: unknown[], destination: number | null) => {
    recorder.calls.push({
      t: performance.now(),
      kind,
      arg: JSON.stringify(args),
      origin: recorder.nextIsSetup ? "test setup" : "app",
      y: window.scrollY,
      maxScrollY: maxScrollY(),
      destination: destination === null ? null : clamp(destination),
    });
    recorder.nextIsSetup = false;
  };
  const byWindow = window.scrollBy.bind(window) as (...args: unknown[]) => void;
  const toWindow = window.scrollTo.bind(window) as (...args: unknown[]) => void;
  const scrollWindow = window.scroll.bind(window) as (...args: unknown[]) => void;
  window.scrollBy = (...args: unknown[]) => {
    const delta = named(args);
    record("scrollBy", args, delta === null ? null : window.scrollY + delta);
    byWindow(...args);
  };
  window.scrollTo = (...args: unknown[]) => {
    record("scrollTo", args, named(args));
    toWindow(...args);
  };
  window.scroll = (...args: unknown[]) => {
    record("scroll", args, named(args));
    scrollWindow(...args);
  };
  const proto = Element.prototype as unknown as Record<
    string,
    ((this: Element, ...args: unknown[]) => void) | undefined
  >;
  for (const name of ["scrollIntoView", "scrollBy", "scrollTo", "scroll"]) {
    const original = proto[name];
    if (!original) continue;
    proto[name] = function (this: Element, ...args: unknown[]) {
      const own = this === scroller();
      const target = named(args);
      record(
        `element.${name}`,
        args,
        own && target !== null
          ? name === "scrollBy"
            ? window.scrollY + target
            : target
          : null,
      );
      original.apply(this, args);
    };
  }
  const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  // Saved only to be called with an explicit `this` below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const getTop = scrollTop?.get;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setTop = scrollTop?.set;
  if (getTop && setTop) {
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      enumerable: scrollTop.enumerable,
      get(this: Element) {
        return getTop.call(this) as number;
      },
      set(this: Element, value: number) {
        if (this === scroller() || this === document.body) {
          record("scrollTop=", [value], value);
        }
        setTop.call(this, value);
      },
    });
  }
  window.addEventListener(
    "wheel",
    (event) => {
      const target = event.target as Element | null;
      recorder.wheels.push({
        t: performance.now(),
        y: window.scrollY,
        deltaY: event.deltaY,
        target: target
          ? `${target.tagName}.${typeof target.className === "string" ? (target.className.split(" ")[0] ?? "") : ""}`
          : "none",
      });
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "scroll",
    () => {
      if (recorder.positions.length < 2000) {
        recorder.positions.push({ t: performance.now(), y: window.scrollY });
      }
    },
    { capture: true, passive: true },
  );
}

interface Attempt {
  t: number;
  kind: string;
  arg: string;
  origin: "app" | "test setup";
  y: number;
  maxScrollY: number;
  destination: number | null;
}

interface Recorded {
  calls: Attempt[];
  positions: { t: number; y: number }[];
  wheels: { t: number; y: number; deltaY: number; target: string }[];
}

function recorded(page: Page): Promise<Recorded> {
  return page.evaluate(() => {
    const r = (window as unknown as { __p18: Recorded }).__p18;
    return { calls: [...r.calls], positions: [...r.positions], wheels: [...r.wheels] };
  });
}

async function resetRecorded(page: Page): Promise<void> {
  await page.evaluate(() => {
    const r = (window as unknown as { __p18: Recorded }).__p18;
    r.calls.length = 0;
    r.positions.length = 0;
    r.wheels.length = 0;
  });
}

/** The test's own positioning: one `window.scrollTo` to `y`, marked as
 * "test setup" in the record. Setup, never evidence of a rider's input. */
async function setupScroll(page: Page, y: number): Promise<void> {
  await page.evaluate((y) => {
    (window as unknown as { __p18: { nextIsSetup: boolean } }).__p18.nextIsSetup = true;
    window.scrollTo(0, y);
  }, y);
}

/** Writes the language preference and a dummy routing key directly, before
 * the app boots — the same shape as planningWarningRows.spec.ts. */
async function seedLanguageAndKey(page: Page, language: Language): Promise<void> {
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

/** How long an uninterrupted reveal may take to come to rest. Measured on
 * 4 October 2026 in the pinned container: unconstrained, Chromium settled
 * within 1.0 s and WebKit within 0.4 s; under a 4-CPU limit with two
 * workers, Chromium within 1.0 s, while headless WebKit stood still after
 * its first 1–4 px for 0.8–2.4 s and then completed in one step. 8 s is
 * a little over three times the worst of those. */
const REVEAL_COMPLETION_BOUND_MS = 8000;

/**
 * After an uninterrupted reveal: waits, on timers, until the selected
 * warning has come to rest in its expected final place in the band
 * measured in the page — its bottom at the band's bottom when it arrives
 * from below, or, when it is taller than the band, its top at the band's
 * top — and the page has been still for 300 ms, or until the bound
 * expires. A quiet window alone is not enough: headless WebKit can stand
 * still for over two seconds before it completes a smooth scroll.
 *
 * It never fails by itself: the geometry assertions that follow judge the
 * outcome, so a missing or wrong reveal still fails on what the rider
 * would see. Never used after a rider's own input, which can legitimately
 * change where scrolling ends.
 */
async function waitForRevealedGeometry(
  page: Page,
  alignment: "bottom" | "top",
): Promise<{ reached: boolean; ms: number }> {
  return page.evaluate(
    ({ alignment, gap, tolerance, bound }) =>
      new Promise<{ reached: boolean; ms: number }>((resolve) => {
        const inPlace = () => {
          const item = document
            .querySelector(".route-warning-button.is-selected")
            ?.closest("li");
          if (!item) return false;
          const header = document.querySelector("header.app-header--sticky");
          const vv = window.visualViewport;
          const visibleTop = vv?.offsetTop ?? 0;
          const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
          const safeArea =
            Number.parseFloat(
              getComputedStyle(document.documentElement)
                .getPropertyValue("--safe-area-inset-bottom")
                .trim(),
            ) || 0;
          const bandTop =
            Math.max(header?.getBoundingClientRect().bottom ?? 0, visibleTop) + gap;
          const bandBottom = visibleBottom - (safeArea + gap);
          const r = item.getBoundingClientRect();
          return alignment === "bottom"
            ? Math.abs(r.bottom - bandBottom) <= tolerance && r.top >= bandTop - tolerance
            : Math.abs(r.top - bandTop) <= tolerance;
        };
        const start = performance.now();
        let last = window.scrollY;
        let still = performance.now();
        const tick = () => {
          const now = performance.now();
          if (window.scrollY !== last) {
            last = window.scrollY;
            still = now;
          }
          if (inPlace() && now - still >= 300) {
            resolve({ reached: true, ms: Math.round(now - start) });
          } else if (now - start > bound) {
            resolve({ reached: false, ms: Math.round(now - start) });
          } else {
            setTimeout(tick, 25);
          }
        };
        setTimeout(tick, 25);
      }),
    { alignment, gap: GAP, tolerance: EDGE_TOLERANCE, bound: REVEAL_COMPLETION_BOUND_MS },
  );
}

/** Waits, on timers, until at least `afterMs` has passed since the page's
 * time `since` and the page has been still for `quietMs` (bounded). */
async function quietSince(
  page: Page,
  since: number,
  afterMs: number,
  quietMs = 500,
  maxMs = 10_000,
): Promise<void> {
  await page.evaluate(
    ({ since, afterMs, quietMs, maxMs }) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        let last = window.scrollY;
        let still = performance.now();
        const tick = () => {
          const now = performance.now();
          if (window.scrollY !== last) {
            last = window.scrollY;
            still = now;
          }
          if ((now - since >= afterMs && now - still >= quietMs) || now - start > maxMs) {
            resolve();
          } else {
            setTimeout(tick, 25);
          }
        };
        setTimeout(tick, 25);
      }),
    { since, afterMs, quietMs, maxMs },
  );
}

/** Polls scrollY on timers until it has been still for `quietMs`. */
async function settle(page: Page, quietMs = 500, maxMs = 6000): Promise<void> {
  await page.evaluate(
    ({ quietMs, maxMs }) =>
      new Promise<void>((resolve) => {
        let last = window.scrollY;
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          if (window.scrollY !== last) {
            last = window.scrollY;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > maxMs) {
            resolve();
          } else {
            setTimeout(tick, 25);
          }
        };
        setTimeout(tick, 25);
      }),
    { quietMs, maxMs },
  );
}

interface Options {
  language: Language;
  rootText?: "200%";
  safeAreaPx?: number;
}

/** Opens Plan, places two waypoints by mouse (item 123: a mouse click
 * places), calculates the synthetic route and returns to the page's top
 * once the map's fit to the route has finished. */
async function planRoute(page: Page, options: Options): Promise<void> {
  await page.addInitScript(instrument);
  await installLocalMapStyle(page);
  await page.route(ORS_URL_GLOB, async (route) => {
    const body = route.request().postDataJSON() as {
      coordinates: (readonly number[])[];
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(buildOrsResponse(body.coordinates)),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Plan", exact: true })).toBeVisible();
  await seedLanguageAndKey(page, options.language);
  await page.reload();
  await page.evaluate(
    ({ rootText, safeAreaPx }) => {
      if (rootText) document.documentElement.style.fontSize = rootText;
      if (safeAreaPx !== undefined) {
        document.documentElement.style.setProperty(
          "--safe-area-inset-bottom",
          `${String(safeAreaPx)}px`,
        );
      }
    },
    { rootText: options.rootText, safeAreaPx: options.safeAreaPx },
  );
  const copy = COPY[options.language];
  await page.getByRole("button", { name: copy.plan, exact: true }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const map = page.locator('[data-testid="map-container"]');
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 15_000 });
  await setupScroll(page, 0);
  const box = await map.boundingBox();
  if (!box) throw new Error("no map box");
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await expect(page.locator(".planning-waypoint-marker")).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await expect(page.locator(".planning-waypoint-marker")).toHaveCount(2);
  const calculate = page.getByRole("button", { name: copy.calculate });
  await expect(calculate).toBeEnabled();
  await calculate.click();
  const list = page.getByRole("list", { name: copy.warnings });
  await expect(list.locator(".route-warning-button")).toHaveCount(3, { timeout: 15_000 });
  await setupScroll(page, 0);
  await waitForStillMarkers(page);
  await settle(page);
}

async function markerCentres(page: Page) {
  return page.evaluate(() => {
    const centre = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    return {
      start: centre(".planning-waypoint-marker--start"),
      finish: centre(".planning-waypoint-marker--finish"),
    };
  });
}

/** The map's fit to the calculated route has finished once both markers
 * have stopped moving. */
async function waitForStillMarkers(page: Page): Promise<void> {
  let previous = JSON.stringify(await markerCentres(page));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(250);
    const current = JSON.stringify(await markerCentres(page));
    if (current === previous && !current.includes("null")) return;
    previous = current;
  }
  throw new Error("the waypoint markers never came to rest");
}

/** A point on the painted route at `fraction` of the way from the start
 * marker to the finish marker, nudged along the same warning's stretch
 * (±4% of the route) only if a control covers it. Never off the stretch:
 * the map's hit box is ±14px. */
async function warningPoint(page: Page, fraction: number) {
  const { start, finish } = await markerCentres(page);
  if (!start || !finish) throw new Error("expected start and finish markers");
  for (const offset of [0, 0.02, -0.02, 0.04, -0.04]) {
    const t = fraction + offset;
    const point = {
      x: start.x + t * (finish.x - start.x),
      y: start.y + t * (finish.y - start.y),
    };
    const onCanvas = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName === "CANVAS",
      point,
    );
    if (onCanvas) return point;
  }
  throw new Error(
    `no map-canvas point on the warning's stretch near ${String(fraction)}`,
  );
}

/** One atomic in-page read of the selected warning and the usable band. */
function measure(page: Page) {
  return page.evaluate((gap) => {
    const box = (node: Element | null | undefined) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    const header = document.querySelector("header.app-header--sticky");
    const vv = window.visualViewport;
    const visibleTop = vv?.offsetTop ?? 0;
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const safeArea =
      Number.parseFloat(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--safe-area-inset-bottom")
          .trim(),
      ) || 0;
    const button = document.querySelector(".route-warning-button.is-selected");
    const item = button?.closest("li") ?? null;
    const lines = [...(item?.querySelectorAll(".route-warning-detail p") ?? [])];
    const status = document
      .querySelector("ul.route-warning-list")
      ?.parentElement?.querySelector(':scope > p[role="status"]');
    const scroller = document.scrollingElement ?? document.documentElement;
    const active = document.activeElement;
    return {
      scrollY: window.scrollY,
      maxScrollY: scroller.scrollHeight - scroller.clientHeight,
      bandTop: Math.max(box(header)?.bottom ?? 0, visibleTop) + gap,
      bandBottom: visibleBottom - (safeArea + gap),
      selectedText: button?.textContent.trim() ?? null,
      selectedIndex: button
        ? [...document.querySelectorAll(".route-warning-button")].indexOf(button)
        : -1,
      item: box(item),
      row: box(button),
      lines: lines.map((line) => {
        const r = line.getBoundingClientRect();
        return {
          text: line.textContent.trim(),
          top: r.top,
          bottom: r.bottom,
          height: r.height,
        };
      }),
      statusText: status?.textContent.trim() ?? null,
      activeIsWarningButton: active?.classList.contains("route-warning-button") ?? false,
      markers: document.querySelectorAll(".planning-waypoint-marker").length,
    };
  }, GAP);
}

type Snapshot = Awaited<ReturnType<typeof measure>>;

/** [behaviour] The selected warning's row and both of its detail lines
 * are wholly inside the band. */
function expectRowAndDetailsInBand(after: Snapshot, copy: (typeof COPY)[Language]) {
  expect(after.item, "[behaviour] a warning is selected").not.toBeNull();
  const item = present(after.item, "the selected item");
  expect(after.lines.map((line) => line.text)).toEqual([
    copy.surface,
    expect.stringMatching(copy.position),
  ]);
  // The details first: they are what the button-only reveal left below the
  // screen, so a failure here names the visible defect.
  for (const line of after.lines) {
    expect(
      line.bottom,
      `[behaviour] "${line.text}" above the bottom cushion`,
    ).toBeLessThanOrEqual(after.bandBottom + EDGE_TOLERANCE);
    expect(
      line.top,
      `[behaviour] "${line.text}" below the navigation`,
    ).toBeGreaterThanOrEqual(after.bandTop - EDGE_TOLERANCE);
  }
  const row = present(after.row, "the selected row");
  expect(row.top, "[behaviour] the row below the navigation").toBeGreaterThanOrEqual(
    after.bandTop - EDGE_TOLERANCE,
  );
  expect(row.bottom, "[behaviour] the row above the bottom cushion").toBeLessThanOrEqual(
    after.bandBottom + EDGE_TOLERANCE,
  );
  expect(item.bottom).toBeLessThanOrEqual(after.bandBottom + EDGE_TOLERANCE);
}

/** Keeps the measured geometry with the result, pass or fail. */
function annotate(
  label: string,
  snapshot: Snapshot,
  completion?: { reached: boolean; ms: number },
) {
  const r = (n: number) => Math.round(n * 10) / 10;
  test.info().annotations.push({
    type: "geometry",
    description: JSON.stringify({
      label,
      completion,
      scrollY: r(snapshot.scrollY),
      band: [r(snapshot.bandTop), r(snapshot.bandBottom)],
      item: snapshot.item && [r(snapshot.item.top), r(snapshot.item.bottom)],
      row: snapshot.row && [r(snapshot.row.top), r(snapshot.row.bottom)],
      lines: snapshot.lines.map((line) => [r(line.top), r(line.bottom)]),
    }),
  });
}

/** [implementation] The application's scroll attempts since the last
 * reset: every recorded attempt except the test's own setup. */
function appScrolls(record: Recorded) {
  return record.calls
    .filter((call) => call.origin === "app")
    .map((call) => `${call.kind} ${call.arg}`);
}

/** The test's own positioning attempts, made through `setupScroll`. */
function setupScrolls(record: Recorded) {
  return record.calls
    .filter((call) => call.origin === "test setup")
    .map((call) => `${call.kind} ${call.arg}`);
}

/** Taps (or clicks) the painted warning where the page now is: the
 * marker positions already reflect any scrolling. */
async function tapWarning(
  page: Page,
  fraction: number,
  input: "touch" | "mouse" = "touch",
) {
  const point = await warningPoint(page, fraction);
  if (input === "touch") {
    await page.touchscreen.tap(point.x, point.y);
  } else {
    await page.mouse.click(point.x, point.y);
  }
}

/** The rider zooms the map out with its own control until both waypoint
 * markers are well inside it — after a selection has framed one warning. */
async function zoomOutToRoute(page: Page): Promise<void> {
  const map = page.locator('[data-testid="map-container"]');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await waitForStillMarkers(page);
    const box = await map.boundingBox();
    const { start, finish } = await markerCentres(page);
    if (!box || !start || !finish) throw new Error("no map or markers");
    const inside = (p: { x: number; y: number }) =>
      p.x > box.x + 24 &&
      p.x < box.x + box.width - 24 &&
      p.y > box.y &&
      p.y < box.y + box.height;
    if (inside(start) && inside(finish)) return;
    // A real click at the control's centre, so no automation scrolling
    // enters the scroll record.
    const zoomOut = await page
      .getByRole("button", { name: "Zoom out", exact: true })
      .boundingBox();
    if (!zoomOut) throw new Error("no Zoom out control");
    await page.mouse.click(zoomOut.x + zoomOut.width / 2, zoomOut.y + zoomOut.height / 2);
  }
  throw new Error("the route never came back into view");
}

const CONFIGURATIONS = [
  { language: "en", rootText: undefined, motion: "no-preference" },
  { language: "de", rootText: undefined, motion: "reduce" },
  { language: "en", rootText: "200%", motion: "reduce" },
  { language: "de", rootText: "200%", motion: "no-preference" },
] as const;

for (const { language, rootText, motion } of CONFIGURATIONS) {
  test(`${language} ${rootText ?? "100%"}, ${motion} motion: a warning tapped on the map comes to rest with its details at the band's bottom`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await planRoute(page, { language, rootText });
    const copy = COPY[language];
    const before = await measure(page);
    expect(before.selectedIndex).toBe(-1);
    await resetRecorded(page);

    await tapWarning(page, QUESTIONABLE_AT);
    const completion = await waitForRevealedGeometry(page, "bottom");
    const after = await measure(page);
    annotate("after", after, completion);
    const record = await recorded(page);

    expect(after.selectedText, "[behaviour] the questionable warning").toMatch(
      copy.questionable,
    );
    expectRowAndDetailsInBand(after, copy);
    // Arriving from below, the minimum brings the item's bottom to the
    // band's bottom and no further.
    expect(
      Math.abs(present(after.item, "the selected item").bottom - after.bandBottom),
      "[behaviour] the minimum movement",
    ).toBeLessThanOrEqual(EDGE_TOLERANCE);
    expect(after.scrollY, "[behaviour] the page moved").toBeGreaterThan(before.scrollY);
    expect(after.statusText, "[behaviour] the announcement").toMatch(copy.selected);
    expect(after.activeIsWarningButton, "[behaviour] focus was not moved").toBe(false);
    expect(after.markers, "[behaviour] no waypoint added").toBe(2);
    const behavior = motion === "reduce" ? "auto" : "smooth";
    expect(appScrolls(record), "[implementation] one scroll call").toEqual([
      expect.stringMatching(
        new RegExp(
          `^scrollBy \\[\\{"top":[\\d.]+,"left":0,"behavior":"${behavior}"\\}\\]$`,
        ),
      ),
    ]);

    // Planning re-renders every second; nothing re-issues the reveal.
    await page.waitForTimeout(2200);
    expect(appScrolls(await recorded(page)), "[implementation] no repeat").toHaveLength(
      1,
    );
    expect((await measure(page)).scrollY, "[behaviour] still at rest").toBe(
      after.scrollY,
    );
  });
}

test("a synthetic 34px bottom inset keeps the details 8px above it", async ({ page }) => {
  await planRoute(page, { language: "en", safeAreaPx: 34 });
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT);
  const completion = await waitForRevealedGeometry(page, "bottom");
  const after = await measure(page);
  annotate("after", after, completion);

  expectRowAndDetailsInBand(after, COPY.en);
  const visibleBottom = await page.evaluate(() =>
    window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height
      : window.innerHeight,
  );
  expect(
    Math.abs(
      present(after.item, "the selected item").bottom - (visibleBottom - 34 - GAP),
    ),
    "[behaviour] 8px above the inset",
  ).toBeLessThanOrEqual(EDGE_TOLERANCE);
});

test("from the lowest tappable start, the page still moves only the minimum", async ({
  page,
}) => {
  await planRoute(page, { language: "en" });
  // Positioned by the test: the painted warning just below the navigation,
  // the furthest down the page can be with it still tappable.
  const point = await warningPoint(page, QUESTIONABLE_AT);
  const headerBottom = await page.evaluate(
    () =>
      document.querySelector("header.app-header--sticky")?.getBoundingClientRect()
        .bottom ?? 0,
  );
  const scrolledBy = Math.max(0, Math.floor(point.y - (headerBottom + 24)));
  await setupScroll(page, scrolledBy);
  await settle(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolledBy);
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT);
  const completion = await waitForRevealedGeometry(page, "bottom");
  const after = await measure(page);
  annotate("after", after, completion);

  expectRowAndDetailsInBand(after, COPY.en);
  expect(
    Math.abs(present(after.item, "the selected item").bottom - after.bandBottom),
    "[behaviour] the minimum movement",
  ).toBeLessThanOrEqual(EDGE_TOLERANCE);
  expect(
    appScrolls(await recorded(page)),
    "[implementation] one scroll call",
  ).toHaveLength(1);
});

test("an item taller than the band is aligned at its beginning, below the navigation", async ({
  page,
}) => {
  // A synthetic short viewport, a stand-in for a smaller phone at larger
  // text, in which German at 200% makes the row and its details taller
  // than the band.
  await page.setViewportSize({ width: 390, height: 460 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await planRoute(page, { language: "de", rootText: "200%" });
  // Positioned by the test so the painted warning is tappable below the
  // navigation.
  const point = await warningPoint(page, QUESTIONABLE_AT);
  const headerBottom = await page.evaluate(
    () =>
      document.querySelector("header.app-header--sticky")?.getBoundingClientRect()
        .bottom ?? 0,
  );
  const scrolledBy = Math.max(0, Math.floor(point.y - (headerBottom + 40)));
  await setupScroll(page, scrolledBy);
  await settle(page);
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT);
  const completion = await waitForRevealedGeometry(page, "top");
  const after = await measure(page);
  annotate("after", after, completion);

  expect(after.selectedText).toMatch(COPY.de.questionable);
  expect(
    present(after.item, "the selected item").height,
    "precondition: taller than the band",
  ).toBeGreaterThan(after.bandBottom - after.bandTop);
  expect(
    Math.abs(present(after.item, "the selected item").top - after.bandTop),
    "[behaviour] its beginning just below the navigation",
  ).toBeLessThanOrEqual(EDGE_TOLERANCE);
  // Its label and the start of its explanation show.
  const first = present(after.lines.at(0), "the first detail line");
  expect(first.text).toBe(COPY.de.surface);
  for (const part of [present(after.row, "the selected row"), first]) {
    expect(part.top, "[behaviour] below the navigation").toBeGreaterThanOrEqual(
      after.bandTop - EDGE_TOLERANCE,
    );
    expect(part.bottom, "[behaviour] above the bottom cushion").toBeLessThanOrEqual(
      after.bandBottom + EDGE_TOLERANCE,
    );
  }
  expect(
    appScrolls(await recorded(page)),
    "[implementation] one scroll call",
  ).toHaveLength(1);
  await page.waitForTimeout(1500);
  expect((await measure(page)).scrollY, "[behaviour] not repositioned").toBe(
    after.scrollY,
  );
});

test("a later map selection reveals the newly selected warning, and the rider's own scrolling afterwards is left alone", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await planRoute(page, { language: "en" });
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT);
  await waitForRevealedGeometry(page, "bottom");
  expect((await measure(page)).selectedText).toMatch(COPY.en.questionable);

  // Test setup, not a rider's input: one programmatic return to the page's
  // top, kept in the record as "test setup". The selection framed the first
  // warning on the map, so the map's own Zoom out control brings the route
  // back into view, and the second warning is tapped for real.
  await setupScroll(page, 0);
  await settle(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await zoomOutToRoute(page);
  await tapWarning(page, UNKNOWN_AT);
  const completion = await waitForRevealedGeometry(page, "bottom");
  const second = await measure(page);
  annotate("second", second, completion);

  expect(second.selectedText, "[behaviour] the newly selected warning").toMatch(
    COPY.en.unknown,
  );
  expect(second.item, "[behaviour] a warning is selected").not.toBeNull();
  for (const part of [...second.lines, present(second.row, "the selected row")]) {
    expect(part.bottom, "[behaviour] above the bottom cushion").toBeLessThanOrEqual(
      second.bandBottom + EDGE_TOLERANCE,
    );
    expect(part.top, "[behaviour] below the navigation").toBeGreaterThanOrEqual(
      second.bandTop - EDGE_TOLERANCE,
    );
  }
  expect(
    await page.getByText(COPY.en.surface).count(),
    "[behaviour] the first warning's details are closed",
  ).toBe(0);
  const instantReveal = expect.stringMatching(
    /^scrollBy \[\{"top":[\d.]+,"left":0,"behavior":"auto"\}\]$/,
  );
  const record = await recorded(page);
  expect(
    appScrolls(record),
    "[implementation] one reveal per map selection, and nothing else from the app",
  ).toEqual([instantReveal, instantReveal]);
  expect(setupScrolls(record), "the test's one setup call, kept in the record").toEqual([
    "scrollTo [0,0]",
  ]);

  // Then the rider scrolls up a little with a real wheel, the page at rest.
  await page.mouse.move(195, 820);
  await page.mouse.wheel(0, -200);
  await expect
    .poll(async () => (await recorded(page)).wheels.length, "the wheel reached the page")
    .toBe(1);
  const wheel = present((await recorded(page)).wheels.at(0), "the rider's wheel event");
  // The rider's own scroll takes effect — native, so waited for as an end
  // state — and stands through Planning's once-a-second re-renders.
  await expect
    .poll(() => page.evaluate(() => window.scrollY), {
      message: "[behaviour] the rider's scroll took effect",
      timeout: REVEAL_COMPLETION_BOUND_MS,
    })
    .toBeLessThan(second.scrollY - 100);
  await quietSince(page, wheel.t, 2200);
  const after = await recorded(page);
  expect(
    await page.evaluate(() => window.scrollY),
    "[behaviour] left where the rider put it",
  ).toBeLessThan(second.scrollY - 100);
  expect(
    after.calls.filter((call) => call.origin === "app" && call.t > wheel.t),
    "[implementation] no application scroll attempt after the rider's wheel",
  ).toEqual([]);
  expect(appScrolls(after)).toEqual([instantReveal, instantReveal]);
  expect(setupScrolls(after)).toEqual(["scrollTo [0,0]"]);
});

test("after the reveal request, a rider's wheel is followed by no further reveal or scroll from the app", async ({
  page,
}) => {
  // The application's guarantee, independent of native animation timing:
  // once the app has made its one reveal request, a rider's wheel is never
  // answered by another reveal or any other scroll from the app. The wheel
  // is dispatched as soon as the request is recorded. Whether it reaches
  // the page while the engine's smooth movement is still running is native
  // timing — recorded below as evidence, never a precondition — and what an
  // engine does with a wheel during its own movement is a separate
  // diagnostic, outside this suite (slice 10's repair note, 4 October
  // 2026). Where the page ends after the wheel is the engine's business,
  // and is not asserted.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await planRoute(page, { language: "en" });
  await resetRecorded(page); // Armed before the selection that starts the reveal.

  await tapWarning(page, QUESTIONABLE_AT);
  await expect
    .poll(async () => appScrolls(await recorded(page)).length, "the app's reveal request")
    .toBe(1);
  await page.mouse.move(195, 800);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await recorded(page)).wheels.length, "the wheel reached the page")
    .toBe(1);
  const early = await recorded(page);
  const reveal = present(early.calls.at(0), "the reveal request");
  const wheel = present(early.wheels.at(0), "the rider's wheel event");
  await quietSince(page, wheel.t, 2200);
  const record = await recorded(page);
  const after = await measure(page);
  const movedAfterWheel = record.positions.some((p) => p.t > wheel.t && p.y !== wheel.y);
  const low = Math.min(reveal.y, reveal.destination ?? reveal.y);
  const high = Math.max(reveal.y, reveal.destination ?? reveal.y);
  test.info().annotations.push({
    type: "reveal and wheel",
    description: JSON.stringify({
      reveal: { t: reveal.t, y: reveal.y, destination: reveal.destination },
      wheel,
      wheelAfterRequestMs: Math.round(wheel.t - reveal.t),
      // Evidence only: the wheel's own position strictly inside the
      // movement's span, with the page still moving after it.
      wheelDuringMovement: wheel.y > low + 1 && wheel.y < high - 1 && movedAfterWheel,
      finalScrollY: after.scrollY,
    }),
  });

  expect(after.selectedText, "[behaviour] the questionable warning is selected").toMatch(
    COPY.en.questionable,
  );
  expect(after.lines.map((line) => line.text)).toEqual([
    COPY.en.surface,
    expect.stringMatching(COPY.en.position),
  ]);
  expect(reveal.origin, "the request is the application's").toBe("app");
  expect(`${reveal.kind} ${reveal.arg}`, "[implementation] one smooth scrollBy").toMatch(
    /^scrollBy \[\{"top":[\d.]+,"left":0,"behavior":"smooth"\}\]$/,
  );
  expect(wheel.target, "the wheel landed on the page's content, not the map").not.toMatch(
    /^CANVAS/,
  );
  expect(wheel.t, "the wheel followed the reveal request").toBeGreaterThan(reveal.t);
  expect(
    record.calls.filter((call) => call.t > wheel.t),
    "[implementation] no scroll attempt of any kind after the rider's wheel",
  ).toEqual([]);
  expect(
    appScrolls(record),
    "[implementation] the one reveal request, in all",
  ).toHaveLength(1);
});

test("a mouse click on the warning reveals the row and its details in the same way", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "a Chromium guard; WebKit covers touch");
  await planRoute(page, { language: "en" });
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT, "mouse");
  const completion = await waitForRevealedGeometry(page, "bottom");
  const after = await measure(page);
  annotate("after", after, completion);

  expect(after.selectedText).toMatch(COPY.en.questionable);
  expectRowAndDetailsInBand(after, COPY.en);
  expect(
    Math.abs(present(after.item, "the selected item").bottom - after.bandBottom),
    "[behaviour] the minimum movement",
  ).toBeLessThanOrEqual(EDGE_TOLERANCE);
  expect(after.markers, "[behaviour] the click added no waypoint").toBe(2);
});

test("nothing moves when the selected warning already fits", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "a Chromium guard");
  // A synthetic tall viewport, a stand-in for a desktop window, in which
  // the list is already on screen with the map but the page still scrolls.
  // 2000px since item 122: the map reaches its 560px ceiling here, 100px
  // taller than before, so 1900px no longer shows the list with the map.
  await page.setViewportSize({ width: 390, height: 2000 });
  await planRoute(page, { language: "en" });
  const before = await measure(page);
  expect(before.maxScrollY, "precondition: the page can still scroll").toBeGreaterThan(0);
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT);
  await settle(page);
  const after = await measure(page);
  annotate("after", after);

  expectRowAndDetailsInBand(after, COPY.en);
  expect(after.scrollY, "[behaviour] nothing moved").toBe(before.scrollY);
  expect(appScrolls(await recorded(page)), "[implementation] no scroll call").toEqual([]);
});

test("a warning selected in the list does not scroll", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "a Chromium guard");
  await planRoute(page, { language: "en" });
  const row = page
    .getByRole("list", { name: COPY.en.warnings })
    .getByRole("button", { name: COPY.en.questionable });
  // Positioned by the test, the row in mid-screen, then clicked where it is.
  const rowTop = await page.evaluate(() => {
    const button = document.querySelector(".route-warning-button");
    if (!button) throw new Error("no warning row");
    return window.scrollY + button.getBoundingClientRect().top;
  });
  await setupScroll(page, rowTop - 300);
  await settle(page);
  await resetRecorded(page);
  const box = await row.boundingBox();
  if (!box) throw new Error("no row box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page);
  const after = await measure(page);
  annotate("after", after);

  expect(after.selectedText).toMatch(COPY.en.questionable);
  expect(after.lines.map((line) => line.text)[0]).toBe(COPY.en.surface);
  // Judged by where the row sits on screen, not by scrollY: the selection
  // also adds the 35px "Clear the selected warning…" below the map, above
  // the list, and scroll anchoring then adjusts scrollY by that amount to
  // keep the row where it was — measured in Chromium and WebKit alike, and
  // with anchoring switched off the row moved down 35px instead. Native
  // behaviour, unchanged by this slice.
  expect(
    Math.abs(present(after.row, "the selected row").top - box.y),
    "[behaviour] the row stayed where it was tapped",
  ).toBeLessThanOrEqual(EDGE_TOLERANCE);
  expect(after.statusText, "[behaviour] no map-selection announcement").toBeNull();
  expect(appScrolls(await recorded(page)), "[implementation] no scroll call").toEqual([]);
});

test("after Clear warning selection, a mouse click on the map still places a waypoint", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "a Chromium guard");
  await planRoute(page, { language: "en" });
  await tapWarning(page, QUESTIONABLE_AT);
  await settle(page);
  expect((await measure(page)).markers, "the selecting tap added no waypoint").toBe(2);

  await page.getByRole("button", { name: COPY.en.clearSelection }).click();
  await expect(page.locator(".route-warning-button.is-selected")).toHaveCount(0);
  await setupScroll(page, 0);
  await settle(page);
  const map = page.locator('[data-testid="map-container"]');
  const box = await map.boundingBox();
  if (!box) throw new Error("no map box");
  // Well clear of the horizontal route, which runs through the markers.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await expect(page.locator(".planning-waypoint-marker")).toHaveCount(3);
});
