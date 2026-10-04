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
// scaling is not iOS Larger Text. Positioning before a tap is a
// programmatic scroll the test makes; the rider's own scrolling is a real
// wheel. Settling is judged by timers, never animation frames, since
// headless WebKit can defer them.
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

/** Records every programmatic scroll the app makes, with a timestamp, and
 * the page's scroll positions over time. Installed before the app runs. */
function instrument() {
  interface Recorder {
    calls: { t: number; kind: string; arg: string }[];
    positions: { t: number; y: number }[];
  }
  const recorder: Recorder = { calls: [], positions: [] };
  (window as unknown as { __p18: Recorder }).__p18 = recorder;
  const wrap = (kind: string, original: (...args: never[]) => unknown) =>
    function (this: unknown, ...args: never[]) {
      recorder.calls.push({ t: performance.now(), kind, arg: JSON.stringify(args) });
      return original.apply(this, args);
    };
  window.scrollBy = wrap(
    "scrollBy",
    window.scrollBy.bind(window),
  ) as typeof window.scrollBy;
  window.scrollTo = wrap(
    "scrollTo",
    window.scrollTo.bind(window),
  ) as typeof window.scrollTo;
  window.scroll = wrap("scroll", window.scroll.bind(window)) as typeof window.scroll;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const intoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    recorder.calls.push({
      t: performance.now(),
      kind: "scrollIntoView",
      arg: JSON.stringify(arg ?? null),
    });
    intoView.call(this, arg as ScrollIntoViewOptions);
  };
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

interface Recorded {
  calls: { t: number; kind: string; arg: string }[];
  positions: { t: number; y: number }[];
}

function recorded(page: Page): Promise<Recorded> {
  return page.evaluate(() => {
    const r = (window as unknown as { __p18: Recorded }).__p18;
    return { calls: [...r.calls], positions: [...r.positions] };
  });
}

async function resetRecorded(page: Page): Promise<void> {
  await page.evaluate(() => {
    const r = (window as unknown as { __p18: Recorded }).__p18;
    r.calls.length = 0;
    r.positions.length = 0;
  });
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
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
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
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
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
function annotate(label: string, snapshot: Snapshot) {
  const r = (n: number) => Math.round(n * 10) / 10;
  test.info().annotations.push({
    type: "geometry",
    description: JSON.stringify({
      label,
      scrollY: r(snapshot.scrollY),
      band: [r(snapshot.bandTop), r(snapshot.bandBottom)],
      item: snapshot.item && [r(snapshot.item.top), r(snapshot.item.bottom)],
      row: snapshot.row && [r(snapshot.row.top), r(snapshot.row.bottom)],
      lines: snapshot.lines.map((line) => [r(line.top), r(line.bottom)]),
    }),
  });
}

/** [implementation] The app's own scroll calls since the last reset. */
function appScrolls(record: Recorded) {
  return record.calls.map((call) => `${call.kind} ${call.arg}`);
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
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
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
    await settle(page);
    const after = await measure(page);
    annotate("after", after);
    annotate("after", after);
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
  await settle(page);
  const after = await measure(page);
  annotate("after", after);

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
  await page.evaluate((y) => {
    window.scrollTo(0, y);
  }, scrolledBy);
  await settle(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolledBy);
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT);
  await settle(page);
  const after = await measure(page);
  annotate("after", after);

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
  await page.evaluate((y) => {
    window.scrollTo(0, y);
  }, scrolledBy);
  await settle(page);
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT);
  await settle(page);
  const after = await measure(page);
  annotate("after", after);

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
  await settle(page);
  expect((await measure(page)).selectedText).toMatch(COPY.en.questionable);

  // The rider scrolls back up to the map with the wheel, over the page's
  // own content rather than the map. The selection framed the first
  // warning, so they zoom out with the map's control, and tap another.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await page.evaluate(() => window.scrollY)) <= 0) break;
    await page.mouse.move(195, 820);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(80);
  }
  await settle(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await zoomOutToRoute(page);
  await tapWarning(page, UNKNOWN_AT);
  await settle(page);
  const second = await measure(page);
  annotate("second", second);

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
  const calls = appScrolls(await recorded(page));
  expect(
    calls.filter((call) => call.startsWith("scrollBy")),
    "[implementation] one reveal per map selection",
  ).toHaveLength(2);

  // Then the rider scrolls up a little by hand.
  await page.mouse.move(195, 820);
  await page.mouse.wheel(0, -200);
  await settle(page);
  const rested = await page.evaluate(() => window.scrollY);
  expect(rested).toBeLessThan(second.scrollY);
  await page.waitForTimeout(2200);
  expect(await page.evaluate(() => window.scrollY), "[behaviour] left alone").toBe(
    rested,
  );
  expect(appScrolls(await recorded(page)), "[implementation] no further call").toEqual(
    calls,
  );
});

test("a rider who scrolls while the smooth reveal is still moving is not pulled back by the app", async ({
  page,
}) => {
  // What this establishes, and what it does not. The app issues its one
  // smooth scroll, computed once, and nothing after the rider's own input:
  // asserted as [implementation], since no geometry can tell an app call
  // from the engine's own smooth-scroll animation. What the engine then
  // does with a wheel that arrives mid-animation is native behaviour and
  // differs: measured on 4 October 2026, headless WebKit applied it once
  // its animation had finished, while headless Chromium did not apply it
  // and completed the animation — with the old smooth scrollIntoView too.
  // That outcome is recorded in an annotation, not asserted. [behaviour]
  // is limited to the page staying where it came to rest.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await planRoute(page, { language: "en" });
  const start = await page.evaluate(() => window.scrollY);
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT);
  await expect.poll(async () => (await recorded(page)).calls.length).toBe(1);
  // Where the one reveal will take the page, read from the app's own call.
  const [call] = (await recorded(page)).calls;
  expect(
    appScrolls({ calls: [present(call, "the reveal call")], positions: [] }),
    "[implementation] the reveal is one smooth scrollBy",
  ).toEqual([
    expect.stringMatching(/^scrollBy \[\{"top":[\d.]+,"left":0,"behavior":"smooth"\}\]$/),
  ]);
  const arg = present(call, "the reveal call").arg;
  const target = start + (JSON.parse(arg) as [{ top: number }])[0].top;
  // The native smooth scroll is under way and not yet finished.
  await page.waitForFunction(
    ({ start, target }) => window.scrollY > start + 1 && window.scrollY < target - 1,
    { start, target },
    { polling: 5, timeout: 5000 },
  );
  const atWheel = await page.evaluate(() => ({
    y: window.scrollY,
    t: performance.now(),
  }));
  expect(
    await page.evaluate(() => document.elementFromPoint(195, 800)?.tagName),
    "the wheel lands on the page's content, not the map",
  ).not.toBe("CANVAS");
  await page.mouse.move(195, 800);
  await page.mouse.wheel(0, -300);
  await settle(page, 800);
  const rested = await page.evaluate(() => window.scrollY);
  const record = await recorded(page);

  expect(appScrolls(record), "[implementation] the one reveal, smooth").toEqual([
    expect.stringMatching(/^scrollBy \[\{"top":[\d.]+,"left":0,"behavior":"smooth"\}\]$/),
  ]);
  expect(
    record.calls.every((c) => c.t < atWheel.t),
    "[implementation] no app call after the rider's wheel",
  ).toBe(true);
  await page.waitForTimeout(2200);
  expect(
    await page.evaluate(() => window.scrollY),
    "[behaviour] not repositioned afterwards",
  ).toBe(rested);
  expect(
    appScrolls(await recorded(page)),
    "[implementation] still one call",
  ).toHaveLength(1);
  test.info().annotations.push({
    type: "native scroll trace",
    description: JSON.stringify({
      start,
      target,
      atWheel: atWheel.y,
      rested,
      wheelApplied: rested < target - 150,
      positionsAfterWheel: record.positions
        .filter((p) => p.t >= atWheel.t)
        .map((p) => Math.round(p.y)),
    }),
  });
});

test("a mouse click on the warning reveals the row and its details in the same way", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "a Chromium guard; WebKit covers touch");
  await planRoute(page, { language: "en" });
  await resetRecorded(page);

  await tapWarning(page, QUESTIONABLE_AT, "mouse");
  await settle(page);
  const after = await measure(page);
  annotate("after", after);

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
  await page.setViewportSize({ width: 390, height: 1900 });
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
  await page.evaluate(() => {
    const button = document.querySelector(".route-warning-button");
    if (!button) throw new Error("no warning row");
    window.scrollBy(0, button.getBoundingClientRect().top - 300);
  });
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
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await settle(page);
  const map = page.locator('[data-testid="map-container"]');
  const box = await map.boundingBox();
  if (!box) throw new Error("no map box");
  // Well clear of the horizontal route, which runs through the markers.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await expect(page.locator(".planning-waypoint-marker")).toHaveCount(3);
});
