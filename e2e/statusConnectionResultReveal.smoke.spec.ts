import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 124, slice 11 (P-15), in both engines (this file runs under
// the "chromium" and "webkit-smoke" projects). When Test routing
// connection finishes while the rider is still waiting, its result line
// comes into view: below the sticky navigation and the Settings/Status
// switcher plus an 8px gap, above the visible viewport's bottom less the
// safe-area inset plus 8px; not at all when it already fits, otherwise by
// the minimum; its beginning first when it is taller than that band.
// Smooth unless reduced motion is set, once per eligible completion. A
// rider who scrolled, tapped elsewhere, moved focus, left Status or hid
// the app while the request was pending is left where they are.
//
// Every assertion is labelled:
//   [behaviour]      what the rider sees: the result line against the band
//                    measured in the page, the button, focus, the text;
//   [implementation] how the app moved the page: its scroll calls,
//                    recorded by an init script.
// Only [behaviour] assertions count as visible regression evidence. Timing
// diagnostics are attached to each result and asserted on by neither.
//
// Synthetic, and labelled where used: the routing provider is answered
// locally, each request held until the test releases it with a success, a
// 401 or a network failure; the 34px bottom inset is the
// `--safe-area-inset-bottom` seam index.css documents; the short viewport
// is a geometry stand-in; a hidden document is a dispatched
// visibilitychange; and a programmatic focus stands in for assistive
// technology moving focus. Browser root-text scaling is not iOS Larger
// Text, and WebKit here is Playwright's Linux WebKit, whose focus behaviour
// is not iOS Safari's. Positioning is a programmatic scroll the test makes,
// recorded as "test setup"; the rider's own scrolling is a real wheel.
// Waiting is judged by timers, never animation frames. After an
// uninterrupted reveal the test waits for the expected final geometry, not
// a quiet moment, and no test tries to catch the engine's smooth scroll in
// flight.
//
// No test in this file contacts a live map or routing provider.

test.use({
  serviceWorkers: "block",
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DB_NAME = "amazing-cycling-navigation";
const GAP = 8;
const EDGE_TOLERANCE = 1.5;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COPY = {
  en: {
    mainNav: "Main",
    settings: "Settings",
    status: "Status",
    routes: "Routes",
    switcher: "Settings and Status",
    test: "Test routing connection",
    testing: "Testing…",
    hint: /^This sends one real request/,
    succeeded: /^Succeeded — /,
    failed: /^Failed — /,
    storage: /^Estimated app storage: /,
  },
  de: {
    mainNav: "Hauptbereiche",
    settings: "Einstellungen",
    status: "Status",
    routes: "Routen",
    switcher: "Einstellungen und Status",
    test: "Routing-Verbindung testen",
    testing: "Wird getestet…",
    hint: /^Dafür wird eine echte Anfrage/,
    succeeded: /^Erfolgreich — /,
    failed: /^Fehlgeschlagen — /,
    storage: /^Geschätzte App-Speichernutzung: /,
  },
} as const;
type Language = keyof typeof COPY;
type Outcome = "success" | "unauthorised" | "network";

// The record — every scroll attempt with its origin, start and
// destination, the trajectory, every wheel and focusin — kept with each
// result, on failure as well as success.
test.afterEach(async ({ page }, testInfo) => {
  try {
    await testInfo.attach("scroll-record", {
      body: JSON.stringify({ ...(await recorded(page)), diagnostics }),
      contentType: "application/json",
    });
  } catch {
    // The page may already be gone; the test's own failure says why.
  }
  // Nothing may stay held: the adapter would abort it at 15 s anyway.
  for (const request of held) request.settle("network");
  held.length = 0;
  diagnostics = {};
});

/** Records every attempt to scroll the page — `window.scrollBy`,
 * `scrollTo` and `scroll`, `Element.prototype.scrollIntoView`, `scrollBy`,
 * `scrollTo` and `scroll`, and writes to the document scroller's
 * `scrollTop` — with its time, the position it started from and, where it
 * names one, its destination; then forwards it unchanged. Also records
 * every real `wheel` and `focusin` the page receives, and the scroll
 * trajectory. Installed before the app runs. Every attempt counts as the
 * application's, except one the test makes through `setupScroll`, which
 * is marked "test setup" rather than left out. (The same recorder as
 * planningWarningMapReveal.smoke.spec.ts, with focus events added.) */
function instrument() {
  interface Attempt {
    t: number;
    kind: string;
    arg: string;
    origin: "app" | "test setup";
    y: number;
    destination: number | null;
  }
  interface Recorder {
    calls: Attempt[];
    positions: { t: number; y: number }[];
    wheels: { t: number; y: number }[];
    focusins: { t: number; target: string }[];
    nextIsSetup: boolean;
  }
  const recorder: Recorder = {
    calls: [],
    positions: [],
    wheels: [],
    focusins: [],
    nextIsSetup: false,
  };
  (window as unknown as { __p15: Recorder }).__p15 = recorder;
  const scroller = () => document.scrollingElement ?? document.documentElement;
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
      destination,
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
      record(`element.${name}`, args, null);
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
  const label = (node: EventTarget | null) => {
    if (!(node instanceof Element)) return node === document ? "document" : "none";
    const name = node.getAttribute("aria-label") ?? node.textContent.trim().slice(0, 30);
    return `${node.tagName}:${name}`;
  };
  window.addEventListener(
    "wheel",
    () => {
      recorder.wheels.push({ t: performance.now(), y: window.scrollY });
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "focusin",
    (event) => {
      recorder.focusins.push({ t: performance.now(), target: label(event.target) });
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
  destination: number | null;
}

interface Recorded {
  calls: Attempt[];
  positions: { t: number; y: number }[];
  wheels: { t: number; y: number }[];
  focusins: { t: number; target: string }[];
}

function recorded(page: Page): Promise<Recorded> {
  return page.evaluate(() => {
    const r = (window as unknown as { __p15: Recorded }).__p15;
    return {
      calls: [...r.calls],
      positions: [...r.positions],
      wheels: [...r.wheels],
      focusins: [...r.focusins],
    };
  });
}

/** The application's own scroll attempts since the page's time `since`.
 * Always measured from after the activation: in Chromium every activation
 * also records two `scrollTop` writes from React's own focus restoration
 * (its commit saves each ancestor's scroll offsets, refocuses the
 * previously focused button — now disabled — and writes the offsets back:
 * `<body>`'s 0 and the root's current position), which move nothing and
 * precede any answer. Traced to the bundle's commit path on 4 October
 * 2026; the same happens on the unchanged build. */
async function appCallsSince(page: Page, since: number): Promise<Attempt[]> {
  return (await recorded(page)).calls.filter(
    (call) => call.origin === "app" && call.t >= since,
  );
}

function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** The test's own positioning: one `window.scrollTo`, marked as "test
 * setup" in the record. Setup, never evidence of a rider's input. */
async function setupScroll(page: Page, y: number): Promise<void> {
  await page.evaluate((y) => {
    (window as unknown as { __p15: { nextIsSetup: boolean } }).__p15.nextIsSetup = true;
    window.scrollTo(0, y);
  }, y);
}

// ----- The routing provider, answered locally and held -----

interface Held {
  settle: (outcome: Outcome) => void;
  settled: boolean;
}
const held: Held[] = [];
let diagnostics: Record<string, number> = {};

/** A routing response the adapter accepts: the straight line between the
 * requested waypoints, flat, with no surface extras. */
function orsResponse(coordinates: readonly (readonly number[])[]) {
  const start = coordinates.at(0) ?? [8.68, 49.41];
  const end = coordinates.at(-1) ?? [8.69, 49.42];
  const points = Array.from({ length: 11 }, (_, i) => {
    const t = i / 10;
    return [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1]), 100];
  });
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: 1000, duration: 200 } },
        geometry: { type: "LineString", coordinates: points },
      },
    ],
  };
}

async function answer(route: Route, outcome: Outcome): Promise<void> {
  if (outcome === "network") {
    await route.abort("failed");
    return;
  }
  if (outcome === "unauthorised") {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({ error: "Access to this API has been disallowed" }),
    });
    return;
  }
  const body = route.request().postDataJSON() as { coordinates: number[][] };
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: CORS,
    body: JSON.stringify(orsResponse(body.coordinates)),
  });
}

async function holdProvider(page: Page): Promise<void> {
  await page.route(ORS_URL_GLOB, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const outcome = await new Promise<Outcome>((resolve) => {
      const entry: Held = {
        settled: false,
        settle: (value) => {
          if (entry.settled) return;
          entry.settled = true;
          resolve(value);
        },
      };
      held.push(entry);
    });
    try {
      await answer(route, outcome);
    } catch {
      // Already aborted by the adapter or the page; nothing to answer.
    }
  });
}

/** Waits until request `index` has reached the provider, then answers it,
 * returning the page's time just before the answer. */
async function release(page: Page, index: number, outcome: Outcome): Promise<number> {
  await expect.poll(() => held.length, { timeout: 10_000 }).toBeGreaterThan(index);
  const at = await pageNow(page);
  present(held.at(index), `held request ${String(index)}`).settle(outcome);
  return at;
}

// ----- Setup -----

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

interface Options {
  language: Language;
  rootText?: "200%";
  safeAreaPx?: number;
}

/** Lets the section's arrival top reset finish before any programmatic
 * scroll (settingsStatusSwitcher.smoke.spec.ts's `settleArrival`).
 * scrollToTopAndSettle keeps reasserting the top until three stable
 * animation frames have run, its one-second cap counted in frame time; a
 * rider's touch, pointer or wheel ends it at once, but a test's scroll is
 * none of those. Headless WebKit defers those frames, so under a 4-CPU
 * limit the loop outlived a wall-clock wait and flattened the test's own
 * setup scroll (measured 4 October 2026). Requesting frames forces them. */
async function settleArrival(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames += 1;
          if (frames >= 6) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** After arriving at Status: lets the top reset finish, then waits, on
 * timers, until the page's height and the button's place have been
 * unchanged for 600 ms (bounded), and at least 1.2 s has passed since
 * `since`. */
async function settleLayout(page: Page, since: number, testName: string): Promise<void> {
  await settleArrival(page);
  await page.evaluate(
    ({ since, testName }) =>
      new Promise<void>((resolve) => {
        const read = () => {
          const button = [...document.querySelectorAll("button")].find(
            (node) => node.textContent.trim() === testName,
          );
          const scroller = document.scrollingElement ?? document.documentElement;
          return `${String(scroller.scrollHeight)}:${String(
            button ? button.getBoundingClientRect().top + window.scrollY : -1,
          )}`;
        };
        const start = performance.now();
        let last = read();
        let still = performance.now();
        const tick = () => {
          const now = performance.now();
          const current = read();
          if (current !== last) {
            last = current;
            still = now;
          }
          if ((now - since >= 1200 && now - still >= 600) || now - start > 8000) {
            resolve();
          } else {
            setTimeout(tick, 50);
          }
        };
        setTimeout(tick, 50);
      }),
    { since, testName },
  );
}

async function openStatus(page: Page, language: Language): Promise<void> {
  const copy = COPY[language];
  await page
    .getByRole("navigation", { name: copy.mainNav })
    .getByRole("button", { name: copy.settings, exact: true })
    .click();
  const switched = await pageNow(page);
  await page
    .getByRole("navigation", { name: copy.switcher })
    .getByRole("button", { name: copy.status, exact: true })
    .click();
  await expect(page.getByRole("heading", { name: copy.status, level: 1 })).toBeAttached();
  await expect(testButton(page, language)).toBeEnabled();
  await expect(page.getByText(copy.storage)).toBeVisible();
  await settleLayout(page, switched, copy.test);
}

/** Opens Status with the provider held, the language and a dummy key
 * seeded, and any root-text size or synthetic inset applied. */
async function prepare(page: Page, options: Options): Promise<void> {
  await page.addInitScript(instrument);
  await installLocalMapStyle(page);
  await holdProvider(page);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
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
  await openStatus(page, options.language);
}

function testButton(page: Page, language: Language): Locator {
  return page
    .locator("section.diagnostics-screen")
    .getByRole("button", { name: COPY[language].test });
}

function busyButton(page: Page, language: Language): Locator {
  return page
    .locator("section.diagnostics-screen")
    .getByRole("button", { name: COPY[language].testing });
}

/** One atomic in-page read of the result line, the button and the band. */
function measure(page: Page) {
  return page.evaluate((gap) => {
    const box = (node: Element | null | undefined) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    const header = document.querySelector("header.app-header--sticky");
    const switcher = document.querySelector("nav.settings-status-switcher");
    const vv = window.visualViewport;
    const visibleTop = vv?.offsetTop ?? 0;
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const safeArea =
      Number.parseFloat(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--safe-area-inset-bottom")
          .trim(),
      ) || 0;
    const screen = document.querySelector("section.diagnostics-screen");
    const line = screen?.querySelector('p.status-row[role="status"]') ?? null;
    const routingSection = screen?.querySelector(
      'section[aria-labelledby="diagnostics-routing-heading"]',
    );
    const button = routingSection
      ? [...routingSection.querySelectorAll(":scope > button")].at(0)
      : null;
    const active = document.activeElement;
    const scroller = document.scrollingElement ?? document.documentElement;
    return {
      scrollY: window.scrollY,
      maxScrollY: scroller.scrollHeight - scroller.clientHeight,
      visibleBottom,
      bandTop:
        Math.max(box(header)?.bottom ?? 0, box(switcher)?.bottom ?? 0, visibleTop) + gap,
      bandBottom: visibleBottom - (safeArea + gap),
      line: box(line),
      lineText: line?.textContent.trim() ?? null,
      button: box(button),
      buttonText: button?.textContent.trim() ?? null,
      active:
        active === null || active === document.body
          ? "body"
          : `${active.tagName}:${active.getAttribute("aria-label") ?? active.textContent.trim().slice(0, 30)}`,
      activeIsLine: active !== null && active === line,
    };
  }, GAP);
}
type Snapshot = Awaited<ReturnType<typeof measure>>;

function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** One test-setup scroll to `y`, clamped to the page's range, waiting
 * until the page is there. */
async function scrollForSetup(page: Page, y: number): Promise<Snapshot> {
  const before = await measure(page);
  const target = Math.min(Math.max(y, 0), before.maxScrollY);
  await setupScroll(page, target);
  await expect
    .poll(async () => Math.abs((await measure(page)).scrollY - target))
    .toBeLessThan(1.5);
  return measure(page);
}

/** Positions the page so the button's bottom sits `aboveBandBottom` px
 * above the band's bottom ("low"), or its top at `top` px — or as near as
 * the page's end allows, which the callers' own assertions then judge. */
async function placeButton(
  page: Page,
  where: { aboveBandBottom: number } | { top: number },
): Promise<Snapshot> {
  const before = await measure(page);
  const button = present(before.button, "the test button");
  const delta =
    "top" in where
      ? button.top - where.top
      : button.bottom - (before.bandBottom - where.aboveBandBottom);
  const placed = await scrollForSetup(page, before.scrollY + delta);
  if (!("top" in where)) {
    // The low placement is the defect's precondition, so it is checked,
    // to within the whole-pixel scrolling WebKit applies.
    expect(
      Math.abs(
        present(placed.button, "the test button").bottom -
          (placed.bandBottom - where.aboveBandBottom),
      ),
    ).toBeLessThanOrEqual(EDGE_TOLERANCE);
  }
  return placed;
}

/** How long an uninterrupted reveal may take to come to rest. P-18's
 * measurement in the same container (4 October 2026): Chromium settled
 * within 1.0 s and WebKit within 0.4 s unconstrained; under a 4-CPU limit
 * headless WebKit stood still for 0.8–2.4 s before completing in one step.
 * 8 s is a little over three times the worst of those, and this file's
 * own constrained run is recorded with the slice. */
const REVEAL_COMPLETION_BOUND_MS = 8000;

/** After an uninterrupted reveal: waits, on timers, until the result line
 * has come to rest in its expected final place in the band measured in the
 * page — its bottom at the band's bottom, or, oversized, its top at the
 * band's top — and the page has been still for 300 ms, or the bound
 * expires. It never fails by itself: the assertions that follow judge it. */
async function waitForRevealedGeometry(
  page: Page,
  alignment: "bottom" | "top",
): Promise<{ reached: boolean; ms: number }> {
  return page.evaluate(
    ({ alignment, gap, tolerance, bound }) =>
      new Promise<{ reached: boolean; ms: number }>((resolve) => {
        const inPlace = () => {
          const line = document.querySelector(
            'section.diagnostics-screen p.status-row[role="status"]',
          );
          if (!line) return false;
          const header = document.querySelector("header.app-header--sticky");
          const switcher = document.querySelector("nav.settings-status-switcher");
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
            Math.max(
              header?.getBoundingClientRect().bottom ?? 0,
              switcher?.getBoundingClientRect().bottom ?? 0,
              visibleTop,
            ) + gap;
          const bandBottom = visibleBottom - (safeArea + gap);
          const r = line.getBoundingClientRect();
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

/** Waits, on timers, for `ms` of the page's own time. Used only where
 * nothing is expected to happen, to give a wrong reveal time to appear:
 * across at least two of Status's once-a-second re-renders. */
async function observe(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    ms,
  );
}

async function startByTap(page: Page, language: Language): Promise<void> {
  await testButton(page, language).tap();
  await expect(busyButton(page, language)).toBeDisabled();
}

/** [behaviour] The result line has come to rest at the band's bottom, by
 * the minimum, and is wholly inside the band. */
function expectRestingAtBandBottom(after: Snapshot): void {
  const line = present(after.line, "the result line");
  expect(line.bottom).toBeLessThanOrEqual(after.bandBottom + EDGE_TOLERANCE);
  expect(line.bottom).toBeGreaterThanOrEqual(after.bandBottom - EDGE_TOLERANCE);
  expect(line.top).toBeGreaterThanOrEqual(after.bandTop - EDGE_TOLERANCE);
}

/** [behaviour] The result line was left below the band: not revealed. */
function expectLeftBelowBand(after: Snapshot): void {
  const line = present(after.line, "the result line");
  expect(line.bottom).toBeGreaterThan(after.bandBottom + EDGE_TOLERANCE);
}

const geometryCases: {
  name: string;
  options: Options;
  outcome: Outcome;
  text: "succeeded" | "failed";
}[] = [
  {
    name: "English success",
    options: { language: "en" },
    outcome: "success",
    text: "succeeded",
  },
  {
    name: "English network failure, the longest English wrapping",
    options: { language: "en" },
    outcome: "network",
    text: "failed",
  },
  {
    name: "German 401",
    options: { language: "de" },
    outcome: "unauthorised",
    text: "failed",
  },
  {
    name: "German network failure, the longest wrapping",
    options: { language: "de" },
    outcome: "network",
    text: "failed",
  },
  {
    name: "English success at 200% root text",
    options: { language: "en", rootText: "200%" },
    outcome: "success",
    text: "succeeded",
  },
  {
    name: "German network failure at 200% root text",
    options: { language: "de", rootText: "200%" },
    outcome: "network",
    text: "failed",
  },
  {
    name: "English success with a 34px bottom inset (synthetic)",
    options: { language: "en", safeAreaPx: 34 },
    outcome: "success",
    text: "succeeded",
  },
];

test.describe("the result line revealed while the rider waits", () => {
  for (const { name, options, outcome, text } of geometryCases) {
    test(`${name}: with the button low on Status, the result line comes to rest at the band's bottom`, async ({
      page,
    }) => {
      await prepare(page, options);
      const copy = COPY[options.language];
      await placeButton(page, { aboveBandBottom: 4 });
      await startByTap(page, options.language);
      // Focus as the activation itself left it — the tap may focus the
      // button, which is then disabled — so the reveal is judged alone.
      const focusWhileWaiting = (await measure(page)).active;
      const releasedAt = await release(page, 0, outcome);
      await expect(
        page.locator('section.diagnostics-screen p[role="status"]'),
      ).toHaveText(copy[text]);
      const settled = await waitForRevealedGeometry(page, "bottom");
      diagnostics.revealMs = settled.ms;
      const after = await measure(page);
      const line = present(after.line, "the result line");
      Object.assign(diagnostics, {
        lineTop: line.top,
        lineBottom: line.bottom,
        lineHeight: line.height,
        bandTop: after.bandTop,
        bandBottom: after.bandBottom,
      });

      // [behaviour] where it comes to rest, and what else stayed the same.
      expectRestingAtBandBottom(after);
      expect(after.buttonText).toBe(copy.test);
      expect(after.activeIsLine).toBe(false);
      // The disabled button's own focus loss may still land late in Linux
      // WebKit (see the Enter case); nothing else may change focus.
      expect([focusWhileWaiting, "body"]).toContain(after.active);
      // [implementation] one smooth call, made after the answer.
      const calls = await appCallsSince(page, releasedAt);
      expect(calls.map((call) => call.kind)).toEqual(["scrollBy"]);
      expect(calls[0]?.arg).toContain('"behavior":"smooth"');
    });
  }

  test("reduced motion: the result line is revealed at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    const releasedAt = await release(page, 0, "success");
    await expect(page.locator('section.diagnostics-screen p[role="status"]')).toHaveText(
      COPY.en.succeeded,
    );
    // [implementation] one immediate call.
    await expect.poll(async () => (await appCallsSince(page, releasedAt)).length).toBe(1);
    const calls = await appCallsSince(page, releasedAt);
    expect(calls[0]?.arg).toContain('"behavior":"auto"');
    // [behaviour] already in place, with no animation to wait for.
    expectRestingAtBandBottom(await measure(page));
  });

  test("a result line that already fits is not moved", async ({ page }) => {
    await prepare(page, { language: "en" });
    await placeButton(page, { top: 300 });
    await startByTap(page, "en");
    const releasedAt = await release(page, 0, "success");
    await expect(page.locator('section.diagnostics-screen p[role="status"]')).toHaveText(
      COPY.en.succeeded,
    );
    await observe(page, 1500);
    const after = await measure(page);
    // [behaviour] the whole line inside the band, where it appeared.
    const line = present(after.line, "the result line");
    expect(line.top).toBeGreaterThanOrEqual(after.bandTop);
    expect(line.bottom).toBeLessThanOrEqual(after.bandBottom);
    // [implementation] no call at all.
    expect(await appCallsSince(page, releasedAt)).toEqual([]);
  });

  test("a result line on screen but inside the bottom cushion moves by the minimum (synthetic inset)", async ({
    page,
  }) => {
    await prepare(page, { language: "en", safeAreaPx: 34 });
    // A first test, mid-screen, leaves a result line to position by.
    await placeButton(page, { top: 300 });
    await startByTap(page, "en");
    await release(page, 0, "success");
    await expect(testButton(page, "en")).toBeEnabled();
    const first = await measure(page);
    const firstLine = present(first.line, "the first result line");
    // Its bottom 10px above the screen's edge: on screen, but inside the
    // 34px inset plus the 8px gap.
    const placed = await scrollForSetup(
      page,
      first.scrollY + firstLine.bottom - (first.visibleBottom - 10),
    );
    expect(present(placed.line, "the line").bottom).toBeLessThan(placed.visibleBottom);
    expect(present(placed.line, "the line").bottom).toBeGreaterThan(placed.bandBottom);

    await startByTap(page, "en");
    const releasedAt = await release(page, 1, "success");
    await expect(testButton(page, "en")).toBeEnabled();
    const settled = await waitForRevealedGeometry(page, "bottom");
    diagnostics.revealMs = settled.ms;
    // [behaviour] brought clear of the cushion, no further.
    expectRestingAtBandBottom(await measure(page));
    // [implementation] one call.
    expect((await appCallsSince(page, releasedAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);
  });

  test("a result line taller than the band shows its beginning below the switcher (synthetic short viewport)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 360 });
    await prepare(page, { language: "de", rootText: "200%" });
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "de");
    const releasedAt = await release(page, 0, "network");
    await expect(page.locator('section.diagnostics-screen p[role="status"]')).toHaveText(
      COPY.de.failed,
    );
    const settled = await waitForRevealedGeometry(page, "top");
    diagnostics.revealMs = settled.ms;
    const after = await measure(page);
    const line = present(after.line, "the result line");
    // The case is only meaningful if the line really is taller than the band.
    expect(line.height).toBeGreaterThan(after.bandBottom - after.bandTop);
    // [behaviour] its beginning just below the switcher, the rest below.
    expect(Math.abs(line.top - after.bandTop)).toBeLessThanOrEqual(EDGE_TOLERANCE);
    // [implementation] one call.
    expect((await appCallsSince(page, releasedAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);
  });

  test("a delayed completion, across Status's re-renders, is revealed once", async ({
    page,
  }) => {
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    await observe(page, 2500);
    const releasedAt = await release(page, 0, "success");
    await waitForRevealedGeometry(page, "bottom");
    expectRestingAtBandBottom(await measure(page));
    await observe(page, 2200);
    expect((await appCallsSince(page, releasedAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);
  });

  test("a repeated tap on the disabled button still counts as waiting", async ({
    page,
  }) => {
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    // locator.tap() would wait for the button to be enabled; tap its place.
    const button = present(await busyButton(page, "en").boundingBox(), "the busy button");
    await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
    const releasedAt = await release(page, 0, "success");
    await waitForRevealedGeometry(page, "bottom");
    expectRestingAtBandBottom(await measure(page));
    expect((await appCallsSince(page, releasedAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);
  });

  test("Enter on the focused button: revealed, with focus left where it was", async ({
    page,
  }) => {
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await testButton(page, "en").focus();
    await page.keyboard.press("Enter");
    await expect(busyButton(page, "en")).toBeDisabled();
    const before = await measure(page);
    const releasedAt = await release(page, 0, "success");
    await waitForRevealedGeometry(page, "bottom");
    const after = await measure(page);
    expectRestingAtBandBottom(after);
    // [behaviour] the reveal moved focus nowhere. The only change allowed
    // is the disabled button's own focus loss: Chromium moves focus to
    // <body> as the button is disabled, while Linux WebKit keeps the
    // disabled button focused until a deferred focus fixup, which can land
    // after the snapshot above (2 of 3 repeats, 4 October 2026). Neither
    // is iOS Safari's behaviour.
    expect([before.active, "body"]).toContain(after.active);
    expect(after.activeIsLine).toBe(false);
    expect((await appCallsSince(page, releasedAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);
  });

  test("a mouse click: revealed (Chromium: focus, then the button disabled)", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "a guard on Chromium's click-then-disable focus loss",
    );
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await testButton(page, "en").click();
    await expect(busyButton(page, "en")).toBeDisabled();
    const releasedAt = await release(page, 0, "success");
    await waitForRevealedGeometry(page, "bottom");
    expectRestingAtBandBottom(await measure(page));
    expect((await appCallsSince(page, releasedAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);
  });
});

test.describe("a rider who moved on while the test ran is left alone", () => {
  /** Starts a test with the button low, runs `moveOn`, answers, and checks
   * that the result appeared but nothing brought it into view. */
  async function movedOn(
    page: Page,
    moveOn: () => Promise<void>,
    expectFocus?: (snapshot: Snapshot) => void,
  ): Promise<void> {
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    const movedAt = await pageNow(page);
    await moveOn();
    await release(page, 0, "success");
    await expect(page.locator('section.diagnostics-screen p[role="status"]')).toHaveText(
      COPY.en.succeeded,
    );
    await observe(page, 2200);
    const after = await measure(page);
    // [behaviour] the result is there, the page was not moved to it.
    expect(after.buttonText).toBe(COPY.en.test);
    expectLeftBelowBand(after);
    expectFocus?.(after);
    // [implementation] no scroll attempt of any kind after the rider moved on.
    expect(await appCallsSince(page, movedAt)).toEqual([]);
  }

  test("a wheel while the test runs", async ({ page }) => {
    await movedOn(page, async () => {
      await page.mouse.move(195, 400);
      await page.mouse.wheel(0, -120);
      await expect.poll(async () => (await recorded(page)).wheels.length).toBe(1);
    });
  });

  test("a tap elsewhere while the test runs", async ({ page }) => {
    await movedOn(page, async () => {
      // The explanation above the button: plain text, not a control.
      await page.getByText(COPY.en.hint).tap();
    });
  });

  test("focus moved elsewhere while the test runs (programmatic, standing in for assistive technology)", async ({
    page,
  }) => {
    await movedOn(
      page,
      async () => {
        await page.evaluate(() => {
          document
            .querySelector<HTMLButtonElement>("nav.settings-status-switcher button")
            ?.focus({ preventScroll: true });
        });
        await expect
          .poll(async () => (await recorded(page)).focusins.length)
          .toBeGreaterThan(0);
      },
      (after) => {
        // [behaviour] focus stays where it was moved.
        expect(after.active).toBe("BUTTON:Settings");
      },
    );
  });

  test("Tab while the test runs", async ({ page }) => {
    await movedOn(page, async () => {
      await page.keyboard.press("Tab");
    });
  });

  test("the app hidden and shown again while the test runs (synthetic visibilitychange)", async ({
    page,
  }) => {
    await movedOn(page, async () => {
      await page.evaluate(() => {
        let state: DocumentVisibilityState = "hidden";
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => state,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        state = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
      });
    });
  });
});

test.describe("leaving Status, and later attempts", () => {
  test("an older completion after Settings and back takes over neither the screen nor the newer attempt", async ({
    page,
  }) => {
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    // Leave for Settings and come back while the first request is held.
    await page
      .getByRole("navigation", { name: COPY.en.switcher })
      .getByRole("button", { name: COPY.en.settings, exact: true })
      .tap();
    const back = await pageNow(page);
    await page
      .getByRole("navigation", { name: COPY.en.switcher })
      .getByRole("button", { name: COPY.en.status, exact: true })
      .tap();
    await expect(testButton(page, "en")).toBeEnabled();
    await settleLayout(page, back, COPY.en.test);
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");

    const firstAt = await release(page, 0, "success");
    await observe(page, 2200);
    const between = await measure(page);
    // [behaviour] the newer attempt is still running, and the older result
    // landed nowhere.
    expect(between.buttonText).toBe(COPY.en.testing);
    expect(between.line).toBeNull();
    // [implementation] nothing scrolled for the older completion.
    expect(await appCallsSince(page, firstAt)).toEqual([]);

    const secondAt = await release(page, 1, "success");
    await waitForRevealedGeometry(page, "bottom");
    expectRestingAtBandBottom(await measure(page));
    expect((await appCallsSince(page, secondAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);
  });

  test("a completion after the rider left for another tab scrolls nothing", async ({
    page,
  }) => {
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    await page
      .getByRole("navigation", { name: COPY.en.mainNav })
      .getByRole("button", { name: COPY.en.routes, exact: true })
      .tap();
    await expect(page.locator("section.diagnostics-screen")).toHaveCount(0);
    const releasedAt = await release(page, 0, "success");
    await observe(page, 2200);
    // [implementation] nothing after the answer.
    expect(await appCallsSince(page, releasedAt)).toEqual([]);
  });

  test("each attempt decides afresh: waiting, then moved on, then waiting", async ({
    page,
  }) => {
    await prepare(page, { language: "en" });
    let releasedAt: number;

    // 1. Waiting: revealed.
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    releasedAt = await release(page, 0, "success");
    await waitForRevealedGeometry(page, "bottom");
    expectRestingAtBandBottom(await measure(page));
    expect((await appCallsSince(page, releasedAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);

    // 2. Moved on with a wheel: left alone.
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    const movedAt = await pageNow(page);
    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, -120);
    await expect.poll(async () => (await recorded(page)).wheels.length).toBe(1);
    await release(page, 1, "success");
    await expect(testButton(page, "en")).toBeEnabled();
    await observe(page, 2200);
    expect(await appCallsSince(page, movedAt)).toEqual([]);

    // 3. Waiting again: revealed again.
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    releasedAt = await release(page, 2, "success");
    await waitForRevealedGeometry(page, "bottom");
    expectRestingAtBandBottom(await measure(page));
    expect((await appCallsSince(page, releasedAt)).map((call) => call.kind)).toEqual([
      "scrollBy",
    ]);
  });

  test("after a reveal, the rider's own scrolling is not undone across re-renders", async ({
    page,
  }) => {
    await prepare(page, { language: "en" });
    await placeButton(page, { aboveBandBottom: 4 });
    await startByTap(page, "en");
    await release(page, 0, "success");
    await waitForRevealedGeometry(page, "bottom");
    expectRestingAtBandBottom(await measure(page));

    // Scroll the line well out of the band, so a repeated reveal would
    // have something to do.
    const wheeledAt = await pageNow(page);
    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await recorded(page)).wheels.length).toBe(1);
    await expect
      .poll(async () => {
        const snapshot = await measure(page);
        return present(snapshot.line, "the line").bottom > snapshot.bandBottom;
      })
      .toBe(true);
    await observe(page, 2500);
    // [behaviour] the line stays where the rider's scroll left it.
    expectLeftBelowBand(await measure(page));
    // [implementation] no scroll attempt of any kind after the wheel.
    expect(await appCallsSince(page, wheeledAt)).toEqual([]);
  });
});
