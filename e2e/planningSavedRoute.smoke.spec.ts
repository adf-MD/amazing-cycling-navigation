import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import {
  readActiveRideStateRow,
  readPlanningDraftRow,
  readSavedRouteId,
} from "./support/rideStateDb.ts";

// Backlog item 124, slice 3 (inventory C-14), in both engines (this file
// runs under the "chromium" and "webkit-smoke" projects): Planning's Save
// only saves, and a separate Open saved route opens the saved route
// through App's ride-transition guard, whose switch confirmation — when
// another ride is unfinished — appears directly beneath that action under
// item 124's reveal and cancellation rule.
//
// Every geometric assertion is made against the usable band measured in
// the page (below the sticky header plus an 8px gap, above the visual
// viewport's bottom less the safe-area inset plus 8px) — never
// `toBeVisible()` alone. Nothing the rule governs is reached through
// Playwright's actionability scroll: the page is positioned by a
// programmatic scroll the test makes BEFORE the app is asked to do
// anything, Save, Open saved route and Cancel are pressed with the real
// mouse at their measured centres (each first proved inside the band and
// on top at that point), and Escape and Enter are real key presses. Where
// focus is placed programmatically first, the test says so.
//
// Not covered here, and why: a save write cannot be held open in a
// browser, so a rider's scroll DURING the save (which must cancel the
// feedback's reveal) is covered only by PlanningScreen.savedRoute.test.tsx;
// action stability across frames is sampled, in Chromium only, by
// confirmationRevealSettled.spec.ts. Browser root-text scaling is not iOS
// Larger Text, and desktop engines have no software keyboard.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";
const GAP = 8;
const EDGE_TOLERANCE = 1.5;
const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];
const TEXT_SIZES = ["100%", "200%"] as const;

const COPY = {
  en: {
    plan: "Plan",
    calculate: "Calculate route",
    planningTitle: "Plan a route",
    startRiding: "Start riding",
    saved: (name: string) => `“${name}” is saved in Routes.`,
  },
  de: {
    plan: "Planen",
    calculate: "Route berechnen",
    planningTitle: "Route planen",
    startRiding: "Fahrt starten",
    saved: (name: string) => `„${name}“ ist unter „Routen“ gespeichert.`,
  },
} as const;

// The save area is the Planning section holding the route-name field.
const SAVE_PANEL = ".planning-section:has(#planning-route-name)";
const SAVE_HEADING = `${SAVE_PANEL} > h2`;
const SAVE_BUTTON = `${SAVE_PANEL} > .row:not(.planning-saved-route) > .btn-primary`;
const FEEDBACK = `${SAVE_PANEL} > .planning-saved-route`;
const OPEN_BUTTON = `${FEEDBACK} > button`;
const DIALOG = `${SAVE_PANEL} > [role="dialog"]`;
const CANCEL = `${DIALOG} .route-delete-confirm-actions > .btn-secondary`;
const CONFIRM = `${DIALOG} .route-delete-confirm-actions > .btn-danger`;

interface Box {
  top: number;
  bottom: number;
  height: number;
}

interface Snapshot {
  scrollY: number;
  scrollX: number;
  maxScrollY: number;
  bandTop: number;
  bandBottom: number;
  save: Box | null;
  feedback: Box | null;
  open: Box | null;
  inset: Box | null;
  actions: Box | null;
  message: Box | null;
  heading: Box | null;
  dialogsInDocument: number;
  /** The confirmation is the save area's next element after the feedback. */
  dialogFollowsFeedback: boolean;
  /** The save area's own vertical gap between its rows, and the
   * confirmation's own top margin: together, "directly beneath". */
  panelRowGap: number;
  dialogMarginTop: number;
  cancelFocused: boolean;
  openFocused: boolean;
  headingFocused: boolean;
}

/** One atomic in-page read, so nothing can move between measurements. */
function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(
    ({ selectors, gap }) => {
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
      const scroller = document.scrollingElement ?? document.documentElement;
      const dialog = document.querySelector(selectors.dialog);
      const active = document.activeElement;
      const isActive = (selector: string) => {
        const node = document.querySelector(selector);
        return node !== null && active === node;
      };
      return {
        scrollY: window.scrollY,
        scrollX: window.scrollX,
        maxScrollY: scroller.scrollHeight - scroller.clientHeight,
        bandTop: Math.max(box(header)?.bottom ?? 0, visibleTop) + gap,
        bandBottom: visibleBottom - (safeArea + gap),
        save: box(document.querySelector(selectors.save)),
        feedback: box(document.querySelector(selectors.feedback)),
        open: box(document.querySelector(selectors.open)),
        inset: box(dialog),
        actions: box(dialog?.querySelector(".route-delete-confirm-actions")),
        message: box(dialog?.querySelector("p")),
        heading: box(document.querySelector(selectors.heading)),
        dialogsInDocument: document.querySelectorAll('[role="dialog"]').length,
        dialogFollowsFeedback:
          dialog !== null &&
          dialog.previousElementSibling === document.querySelector(selectors.feedback),
        panelRowGap:
          Number.parseFloat(
            getComputedStyle(
              document.querySelector(selectors.panel) ?? document.documentElement,
            ).rowGap,
          ) || 0,
        dialogMarginTop: dialog
          ? Number.parseFloat(getComputedStyle(dialog).marginTop) || 0
          : 0,
        cancelFocused: isActive(selectors.cancel),
        openFocused: isActive(selectors.open),
        headingFocused: isActive(selectors.heading),
      };
    },
    {
      selectors: {
        dialog: DIALOG,
        save: SAVE_BUTTON,
        feedback: FEEDBACK,
        open: OPEN_BUTTON,
        heading: SAVE_HEADING,
        cancel: CANCEL,
        panel: SAVE_PANEL,
      },
      gap: GAP,
    },
  );
}

/** Waits until scrollY has held still for a run of timer-driven samples.
 * Deliberately not requestAnimationFrame: headless WebKit can defer frames
 * until something triggers rendering. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = window.scrollY;
        let stable = 0;
        const tick = () => {
          const now = window.scrollY;
          stable = now === last ? stable + 1 : 0;
          last = now;
          if (stable >= 6) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        setTimeout(tick, 25);
      }),
  );
}

/** Records the vertical deltas the application itself asks window.scrollBy
 * for; the browser's own focus scrolling never goes through it. Reset on
 * every call. */
async function recordDeliberateScrolls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as {
      __acnScrollBy?: number[];
      __acnPatched?: boolean;
    };
    holder.__acnScrollBy = [];
    if (holder.__acnPatched === true) return;
    holder.__acnPatched = true;
    const original: (options?: ScrollToOptions) => void = window.scrollBy.bind(window);
    window.scrollBy = (options?: ScrollToOptions) => {
      holder.__acnScrollBy?.push(options?.top ?? 0);
      original(options);
    };
  });
}

function deliberateScrolls(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as { __acnScrollBy?: number[] }).__acnScrollBy ?? [],
  );
}

/** Scrolls the page itself (never through scrollBy, so it is not counted)
 * so that `selector`'s top lands at `targetTop`, and returns where it
 * actually landed — the document may be too short to reach the target. */
async function placeTop(
  page: Page,
  selector: string,
  targetTop: number,
): Promise<number> {
  await page.evaluate(
    ({ selector, targetTop }) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`expected ${selector}`);
      const top = node.getBoundingClientRect().top;
      window.scrollTo(0, window.scrollY + top - targetTop);
    },
    { selector, targetTop },
  );
  await settle(page);
  return page.evaluate((selector) => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`expected ${selector}`);
    return node.getBoundingClientRect().top;
  }, selector);
}

/** A real mouse press at the control's measured centre, which must be
 * inside the usable band and the topmost element there — what a rider can
 * actually tap. Never Playwright's actionability scroll. */
async function pointerPress(page: Page, selector: string): Promise<void> {
  const point = await page.evaluate(
    ({ selector, gap }) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`expected ${selector}`);
      const r = node.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const header = document.querySelector("header.app-header--sticky");
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      const vv = window.visualViewport;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        inBand: y > headerBottom + gap / 2 && y < visibleBottom - gap / 2,
        onTop: hit !== null && (hit === node || node.contains(hit)),
      };
    },
    { selector, gap: GAP },
  );
  expect(point.inBand, `${selector}: pressable inside the band`).toBe(true);
  expect(point.onTop, `${selector}: topmost at its centre`).toBe(true);
  await page.mouse.click(point.x, point.y);
}

function isWithinBand(box: Box, s: Snapshot): boolean {
  return box.top >= s.bandTop - 1 && box.bottom <= s.bandBottom + 1;
}

function onBandEdge(box: Box, s: Snapshot): boolean {
  return (
    Math.abs(box.top - s.bandTop) <= EDGE_TOLERANCE ||
    Math.abs(box.bottom - s.bandBottom) <= EDGE_TOLERANCE
  );
}

function shifted(box: Box, by: number): Box {
  return { top: box.top + by, bottom: box.bottom + by, height: box.height };
}

function note(label: string, description: string): void {
  test.info().annotations.push({ type: label, description });
}

// --------------------------------------------------------------------------
// Setup: a provider key, an optional unfinished ride, Planning ready.

/** See planning.spec.ts's identical workaround: without this, the POST to
 * the (page.route-mocked) ORS endpoint intermittently never reaches
 * Playwright's request interception in this test environment. */
async function fixWindowFetch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });
}

async function installGeolocationWatchCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const geolocation = navigator.geolocation;
    const original = geolocation.watchPosition.bind(geolocation);
    (
      window as unknown as { __e2eWatchPositionCallCount: number }
    ).__e2eWatchPositionCallCount = 0;
    geolocation.watchPosition = (
      ...args: Parameters<typeof geolocation.watchPosition>
    ) => {
      (
        window as unknown as { __e2eWatchPositionCallCount: number }
      ).__e2eWatchPositionCallCount += 1;
      return original(...args);
    };
  });
}

function readWatchPositionCallCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eWatchPositionCallCount?: number })
        .__e2eWatchPositionCallCount ?? 0,
  );
}

/** A body-aware ORS directions response that densifies each requested
 * leg, so Save's "more geometry points than waypoints" gate is met. */
async function mockOrsRequests(page: Page): Promise<void> {
  await page.route(ORS_URL_GLOB, async (route) => {
    const request = route.request();
    let coordinates: (readonly number[])[] = [];
    if (request.method() === "POST") {
      coordinates = (request.postDataJSON() as { coordinates: (readonly number[])[] })
        .coordinates;
    }
    const densified: number[][] = [];
    for (let i = 0; i < coordinates.length - 1; i += 1) {
      const [startLon = 0, startLat = 0] = coordinates[i] ?? [];
      const [endLon = 0, endLat = 0] = coordinates[i + 1] ?? [];
      for (let step = 0; step < 5; step += 1) {
        const t = step / 5;
        densified.push([
          startLon + t * (endLon - startLon),
          startLat + t * (endLat - startLat),
          10,
        ]);
      }
    }
    const [lastLon = 0, lastLat = 0] = coordinates[coordinates.length - 1] ?? [];
    densified.push([lastLon, lastLat, 10]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { summary: { distance: 100, duration: 20 } },
            geometry: { type: "LineString", coordinates: densified },
          },
        ],
      }),
    });
  });
}

const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const UNFINISHED_ROUTE = "Unfinished ride route";

function buildRouteGpx(): string {
  const points = Array.from({ length: 11 }, (_, index) => {
    const lon = -0.1 + (100 * index) / METRES_PER_DEGREE_LON;
    return `      <trkpt lat="51.5" lon="${String(lon)}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Saved-route switch test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function seedLanguagePreference(page: Page, language: Language): Promise<void> {
  await page.evaluate(
    async ({ dbName, language }) => {
      await new Promise<void>((resolve, reject) => {
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

async function putRideRow(page: Page, row: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ dbName, row }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "IndexedDB request failed"));
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("rideState", "readwrite");
          tx.objectStore("rideState").put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error(tx.error?.message ?? "IndexedDB request failed"));
          };
        };
      }),
    { dbName: DB_NAME, row },
  );
}

type UnfinishedRide = "none" | "paused-route" | "free-roam";

async function setRootText(page: Page, size: string): Promise<void> {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = size;
  }, size);
  await page.waitForTimeout(150);
  await settle(page);
}

async function openPlanning(
  page: Page,
  context: BrowserContext,
  { language, ride }: { language: Language; ride: UnfinishedRide },
): Promise<{ consoleErrors: string[] }> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  await fixWindowFetch(page);
  await installGeolocationWatchCounter(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await mockOrsRequests(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();

  let unfinishedRouteId: string | null = null;
  if (ride === "paused-route") {
    await page.getByRole("button", { name: "Routes", exact: true }).click();
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${UNFINISHED_ROUTE}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildRouteGpx()),
    });
    await expect(
      page.getByRole("button", { name: UNFINISHED_ROUTE, exact: true }),
    ).toBeVisible();
    unfinishedRouteId = await readSavedRouteId(page, UNFINISHED_ROUTE);
    if (!unfinishedRouteId) throw new Error("expected the imported route's id");
  }
  if (language !== "en") {
    await seedLanguagePreference(page, language);
    await page.reload();
  }
  // Written without a reload, so the app does not restore the ride; the
  // guard reads storage at the moment Open saved route is pressed. Each is a
  // current-version session, with its own identity (backlog item 140), so the
  // guard's read leaves it exactly as it is.
  if (ride === "paused-route" && unfinishedRouteId) {
    await putRideRow(page, {
      id: "active",
      kind: "route",
      routeId: unfinishedRouteId,
      startedAt: "2026-01-01T08:00:00.000Z",
      sessionId: "seeded-route-session",
      lastFix: null,
      lastMatchedPointIndex: 0,
      matchedDistanceFromStartMetres: 0,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    });
  } else if (ride === "free-roam") {
    await putRideRow(page, {
      id: "active",
      kind: "free-roam",
      startedAt: "2026-01-01T08:00:00.000Z",
      sessionId: "seeded-free-roam-session",
      lastFix: null,
    });
  }

  await page.getByRole("button", { name: COPY[language].plan, exact: true }).click();
  await expect(page.getByTestId("map-container")).toHaveAttribute(
    "data-map-ready",
    "true",
    {
      timeout: 20_000,
    },
  );
  return { consoleErrors };
}

/** Two waypoints by mouse click on the map (item 123), a calculated route
 * and a name — Save is then enabled. Setup only; Playwright may scroll. */
async function planRoute(page: Page, language: Language, name: string): Promise<void> {
  const map = page.getByTestId("map-container");
  await map.click({ position: { x: 100, y: 100 } });
  await map.click({ position: { x: 200, y: 150 } });
  await expect(page.locator(".waypoint-list li")).toHaveCount(2);
  const calculate = page.getByRole("button", { name: COPY[language].calculate });
  await expect(calculate).toBeEnabled();
  await calculate.click();
  await expect(page.locator(SAVE_BUTTON)).toBeEnabled({ timeout: 15_000 });
  await page.locator("#planning-route-name").fill(name);
  await expect(page.locator(SAVE_BUTTON)).toBeEnabled();
}

// --------------------------------------------------------------------------
// Saving.

interface Saved {
  before: Snapshot;
  after: Snapshot;
  deltas: number[];
}

async function pressSave(page: Page): Promise<Saved> {
  const before = await snapshot(page);
  await recordDeliberateScrolls(page);
  await pointerPress(page, SAVE_BUTTON);
  await expect(page.locator(FEEDBACK)).toHaveCount(1, { timeout: 10_000 });
  await settle(page);
  return { before, after: await snapshot(page), deltas: await deliberateScrolls(page) };
}

/**
 * The saved feedback — its message and Open saved route — ends inside the
 * band, moved there by at most one minimal reveal, made only when it was
 * not already inside. Saving also resets the draft above it, which can
 * shorten the page, so the position from before saving is no reference.
 */
function expectFeedbackShown(
  label: string,
  { after, deltas }: Saved,
): "kept" | "revealed" {
  const { feedback, open } = after;
  if (!feedback || !open) throw new Error(`${label}: expected the feedback to lay out`);
  expect(isWithinBand(feedback, after), `${label}: feedback inside the band`).toBe(true);
  expect(isWithinBand(open, after), `${label}: Open saved route inside the band`).toBe(
    true,
  );
  expect(deltas.length, `${label}: deliberate scrolls`).toBeLessThanOrEqual(1);
  expect(after.dialogsInDocument, `${label}: no confirmation`).toBe(0);
  if (deltas.length === 0) return "kept";
  expect(onBandEdge(feedback, after), `${label}: stopped at the band edge`).toBe(true);
  expect(
    isWithinBand(shifted(feedback, deltas[0] ?? 0), after),
    `${label}: was outside the band before the reveal`,
  ).toBe(false);
  return "revealed";
}

async function expectSavedInPlanning(
  page: Page,
  language: Language,
  name: string,
): Promise<void> {
  await expect(page.locator(`${FEEDBACK} [role="status"]`)).toHaveText(
    COPY[language].saved(name),
  );
  await expect(
    page.getByRole("heading", { level: 1, name: COPY[language].planningTitle }),
  ).toBeAttached();
  await expect.poll(() => readPlanningDraftRow(page), { timeout: 5_000 }).toBeNull();
  expect(await readSavedRouteId(page, name)).not.toBeNull();
  expect(await readWatchPositionCallCount(page)).toBe(0);
}

// --------------------------------------------------------------------------
// Opening and closing the switch confirmation.

interface Opened {
  before: Snapshot;
  open: Snapshot;
  deltas: number[];
}

async function openSwitch(page: Page, how: "pointer" | "keyboard"): Promise<Opened> {
  const before = await snapshot(page);
  await recordDeliberateScrolls(page);
  if (how === "pointer") {
    await pointerPress(page, OPEN_BUTTON);
  } else {
    // A keyboard rider's activation: focus placed without any scroll, then
    // a real Enter.
    await page.evaluate((selector) => {
      document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }, OPEN_BUTTON);
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(DIALOG)).toHaveCount(1);
  await settle(page);
  return { before, open: await snapshot(page), deltas: await deliberateScrolls(page) };
}

interface Closed {
  open: Snapshot;
  after: Snapshot;
  deltas: number[];
}

async function closeSwitch(
  page: Page,
  how: "cancel" | "escape" | "enter",
): Promise<Closed> {
  const open = await snapshot(page);
  await recordDeliberateScrolls(page);
  if (how === "cancel") await pointerPress(page, CANCEL);
  else await page.keyboard.press(how === "escape" ? "Escape" : "Enter");
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await settle(page);
  return { open, after: await snapshot(page), deltas: await deliberateScrolls(page) };
}

/** The opening rule, from geometry alone. Returns the branch taken. */
function expectOpening(
  label: string,
  { before, open, deltas }: Opened,
  { browserAnchoring = false }: { browserAnchoring?: boolean } = {},
): "fits" | "oversized" {
  const { inset, actions, open: action } = open;
  if (!inset || !actions || !action)
    throw new Error(
      `${label}: expected the confirmation and Open saved route to lay out`,
    );
  // In Planning, directly beneath Open saved route, and the only one.
  expect(open.dialogsInDocument, `${label}: one confirmation in the document`).toBe(1);
  expect(inset.top, `${label}: beneath Open saved route`).toBeGreaterThanOrEqual(
    action.bottom - 0.5,
  );
  expect(open.dialogFollowsFeedback, `${label}: next after the feedback`).toBe(true);
  const feedback = open.feedback;
  if (!feedback) throw new Error(`${label}: expected the feedback to lay out`);
  expect(
    action.bottom,
    `${label}: Open saved route ends the feedback`,
  ).toBeLessThanOrEqual(feedback.bottom + 0.5);
  expect(inset.top - feedback.bottom, `${label}: directly beneath`).toBeLessThanOrEqual(
    open.panelRowGap + open.dialogMarginTop + 1,
  );
  const moved = open.scrollY - before.scrollY;
  expect(deltas.length, `${label}: deliberate scrolls`).toBeLessThanOrEqual(1);
  const browserMoved = moved - deltas.reduce((sum, delta) => sum + delta, 0);
  if (browserAnchoring) {
    // See the one caller that passes this: the browser's own scroll
    // anchoring may complete part of the movement first, and the app's
    // reveal, measuring afterwards, only the rest. The final geometry,
    // asserted below, must still be the minimal reveal.
    note(`${label}: browser's own movement`, `${browserMoved.toFixed(3)}px`);
  } else {
    expect(
      Math.abs(browserMoved),
      `${label}: page moved only by the deliberate reveal`,
    ).toBeLessThanOrEqual(1);
  }
  expect(open.scrollX, `${label}: horizontal position`).toBe(before.scrollX);
  expect(open.cancelFocused, `${label}: Cancel focused`).toBe(true);
  expect(isWithinBand(actions, open), `${label}: actions inside the band`).toBe(true);

  const fits = inset.height <= open.bandBottom - open.bandTop;
  const target = fits ? inset : actions;
  if (fits) {
    expect(
      isWithinBand(inset, open),
      `${label}: whole confirmation inside the band`,
    ).toBe(true);
  }
  if (moved !== 0) {
    expect(onBandEdge(target, open), `${label}: stopped at the band edge`).toBe(true);
    expect(
      isWithinBand(shifted(target, moved), open),
      `${label}: was outside the band before the reveal`,
    ).toBe(false);
  }
  return fits ? "fits" : "oversized";
}

/** The fit phase: if the confirmation fits where it opens, the page must
 * not move; where no position leaves room below Open saved route, the
 * minimal reveal expectOpening asserted is correct, and it is recorded. */
function expectFitPhase({ before, open, deltas }: Opened): void {
  if (!open.inset) throw new Error("expected the confirmation to lay out");
  const inPlace = shifted(open.inset, open.scrollY - before.scrollY);
  if (isWithinBand(inPlace, open)) {
    expect(deltas, "fit phase: no deliberate scroll").toEqual([]);
    expect(open.scrollY, "fit phase: page unmoved").toBe(before.scrollY);
    note("fit phase outcome", "fits in place: no movement");
  } else {
    expect(deltas, "fit phase: a single minimal reveal").toHaveLength(1);
    note(
      "fit phase outcome",
      `no position leaves room below the action: minimal reveal of ${String(deltas[0])}px`,
    );
  }
}

/**
 * The cancellation rule, with `target` the control focus must return to.
 * `open` already contains any manual scrolling done while it was open: the
 * position from before opening is never a reference.
 */
function expectCancellation(
  label: string,
  { open, after, deltas }: Closed,
  target: "open" | "heading" = "open",
): "kept" | "corrected" {
  const box = target === "open" ? after.open : after.heading;
  if (!box) throw new Error(`${label}: expected the focus target to lay out`);
  expect(after.inset, `${label}: confirmation gone`).toBeNull();
  expect(after.dialogsInDocument, `${label}: no confirmation anywhere`).toBe(0);
  expect(
    target === "open" ? after.openFocused : after.headingFocused,
    `${label}: ${target} focused`,
  ).toBe(true);
  expect(isWithinBand(box, after), `${label}: ${target} inside the band`).toBe(true);
  expect(after.scrollX, `${label}: horizontal position`).toBe(open.scrollX);
  expect(deltas.length, `${label}: deliberate scrolls`).toBeLessThanOrEqual(1);
  const clamped = Math.min(open.scrollY, after.maxScrollY);
  const corrected = after.scrollY - clamped;
  if (deltas.length === 0) {
    expect(Math.abs(corrected), `${label}: position kept`).toBeLessThanOrEqual(1);
    return "kept";
  }
  expect(
    Math.abs(corrected - (deltas[0] ?? 0)),
    `${label}: only the deliberate move`,
  ).toBeLessThanOrEqual(1);
  expect(onBandEdge(box, after), `${label}: stopped at the band edge`).toBe(true);
  expect(
    isWithinBand(shifted(box, corrected), after),
    `${label}: ${target} was outside the band before the correction`,
  ).toBe(false);
  return "corrected";
}

// --------------------------------------------------------------------------
// The matrix: English and German, at ordinary and 200% root text.

for (const language of LANGUAGES) {
  for (const textSize of TEXT_SIZES) {
    test(`saved feedback (${language}, ${textSize}): saving stays in Planning and the feedback ends on screen, moved only by the minimum`, async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000);
      const { consoleErrors } = await openPlanning(page, context, {
        language,
        ride: "none",
      });
      await setRootText(page, textSize);

      // Save high in the band: the feedback appears beneath it.
      const highName = "Morning loop";
      await planRoute(page, language, highName);
      let s = await snapshot(page);
      let placed = await placeTop(page, SAVE_BUTTON, s.bandTop + 16);
      const high = await pressSave(page);
      const highBranch = expectFeedbackShown("Save high", high);
      note("Save high", `${highBranch}; Save top ${placed.toFixed(1)}`);
      await expectSavedInPlanning(page, language, highName);

      // Save just inside the band's bottom.
      const lowName = "Evening loop with a longer name";
      await planRoute(page, language, lowName);
      await expect(page.locator(FEEDBACK)).toHaveCount(0);
      s = await snapshot(page);
      placed = await placeTop(
        page,
        SAVE_BUTTON,
        s.bandBottom - (s.save?.height ?? 0) - 4,
      );
      const low = await pressSave(page);
      const lowBranch = expectFeedbackShown("Save low", low);
      note(
        "Save low",
        `${lowBranch}${low.deltas.length ? ` by ${String(low.deltas[0])}px` : ""}; Save top ${placed.toFixed(1)}`,
      );
      await expectSavedInPlanning(page, language, lowName);
      expect(consoleErrors).toEqual([]);
    });

    test(`switch confirmation (${language}, ${textSize}): saving alone asks nothing; Open saved route opens it beneath the action, minimally; Escape and Cancel keep the position and the paused ride`, async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000);
      const { consoleErrors } = await openPlanning(page, context, {
        language,
        ride: "paused-route",
      });
      const rideRow = await readActiveRideStateRow(page);
      expect(rideRow).toMatchObject({ kind: "route" });
      await setRootText(page, textSize);

      const name = "Saved while another ride is paused";
      await planRoute(page, language, name);
      const s = await snapshot(page);
      await placeTop(page, SAVE_BUTTON, s.bandTop + 16);
      const saved = await pressSave(page);
      expectFeedbackShown("Save", saved);
      await expectSavedInPlanning(page, language, name);
      // Saving alone requested nothing: no confirmation, and the paused
      // ride's row is untouched.
      await page.waitForTimeout(500);
      expect((await snapshot(page)).dialogsInDocument).toBe(0);
      expect(await readActiveRideStateRow(page)).toEqual(rideRow);

      // Fit phase: Open saved route high in the band.
      let placed = await placeTop(page, OPEN_BUTTON, (await snapshot(page)).bandTop + 16);
      const fitOpen = await openSwitch(page, "pointer");
      note(
        "fit phase",
        `${expectOpening("fit phase open", fitOpen)}; Open top ${placed.toFixed(1)}`,
      );
      expectFitPhase(fitOpen);
      expect(await readActiveRideStateRow(page)).toEqual(rideRow);
      const fitClose = await closeSwitch(page, "escape");
      note("fit phase Escape", expectCancellation("fit phase Escape", fitClose));
      expect(await readActiveRideStateRow(page)).toEqual(rideRow);

      // Reveal phase: Open saved route just inside the band's bottom.
      const r = await snapshot(page);
      placed = await placeTop(
        page,
        OPEN_BUTTON,
        r.bandBottom - (r.open?.height ?? 0) - 4,
      );
      const revealOpen = await openSwitch(page, "pointer");
      note(
        "reveal phase",
        `${expectOpening("reveal phase open", revealOpen)}; Open top ${placed.toFixed(1)}`,
      );
      expect(
        revealOpen.deltas,
        "reveal phase: exactly one deliberate scroll",
      ).toHaveLength(1);
      const revealClose = await closeSwitch(page, "cancel");
      note("reveal phase Cancel", expectCancellation("reveal phase Cancel", revealClose));

      // Still in Planning, the original ride kept, the saved route stored,
      // and no location tracking started.
      await expect(
        page.getByRole("heading", { level: 1, name: COPY[language].planningTitle }),
      ).toBeAttached();
      expect(await readActiveRideStateRow(page)).toEqual(rideRow);
      expect(await readSavedRouteId(page, name)).not.toBeNull();
      expect(await readWatchPositionCallCount(page)).toBe(0);
      expect(consoleErrors).toEqual([]);
    });
  }
}

// --------------------------------------------------------------------------
// Opening with nothing unfinished, and over an unfinished free roam.

test("Open saved route with nothing unfinished opens its pre-ride screen from the top, asking nothing and starting no location tracking", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const { consoleErrors } = await openPlanning(page, context, {
    language: "en",
    ride: "none",
  });
  const name = "Nothing unfinished";
  await planRoute(page, "en", name);
  await placeTop(page, SAVE_BUTTON, (await snapshot(page)).bandTop + 16);
  expectFeedbackShown("Save", await pressSave(page));

  await pointerPress(page, OPEN_BUTTON);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("button", { name: COPY.en.startRiding })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator('[role="dialog"]').count()).toBe(0);
  expect(await readActiveRideStateRow(page)).toBeNull();
  expect(await readWatchPositionCallCount(page)).toBe(0);
  expect(consoleErrors).toEqual([]);
});

test("Open saved route over an unfinished free roam asks beneath the action; End and switch ends the free roam and opens the saved route without tracking", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const { consoleErrors } = await openPlanning(page, context, {
    language: "en",
    ride: "free-roam",
  });
  const name = "Saved during free roam";
  await planRoute(page, "en", name);
  await placeTop(page, SAVE_BUTTON, (await snapshot(page)).bandTop + 16);
  expectFeedbackShown("Save", await pressSave(page));
  expect(await readActiveRideStateRow(page)).toMatchObject({ kind: "free-roam" });

  const opened = await openSwitch(page, "pointer");
  expectOpening("free roam open", opened);
  await pointerPress(page, CONFIRM);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("button", { name: COPY.en.startRiding })).toBeVisible();
  await expect.poll(() => readActiveRideStateRow(page)).toBeNull();
  expect(await readWatchPositionCallCount(page)).toBe(0);
  expect(consoleErrors).toEqual([]);
});

// --------------------------------------------------------------------------
// Oversized: at 200% root text the confirmation is taller than the band in
// both engines and both languages (measured), so only its complete action
// row is brought in, with the explanation above it reachable by scrolling.
//
// The other oversized branch — no movement at all when the complete row
// already shows — cannot be arranged here: the save area ends the page, so
// before opening, Open saved route always sits within about one action's
// height of the window's bottom and the confirmation always opens below
// the window. That branch is covered with stubbed geometry by
// PlanningScreen.savedRoute.test.tsx.

test("oversized: only the action row is brought in, by the minimum; closing keeps the position", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openPlanning(page, context, { language: "en", ride: "paused-route" });
  const rideRow = await readActiveRideStateRow(page);
  await setRootText(page, "200%");
  await planRoute(page, "en", "Oversized confirmation");
  await placeTop(page, SAVE_BUTTON, (await snapshot(page)).bandTop + 16);
  expectFeedbackShown("Save", await pressSave(page));

  // The second opening directly follows a collapse that clamped the page,
  // with no scroll in between — where Chromium's scroll anchoring restores
  // that position first (see the manual-scroll test below), so the
  // browser's share is recorded there and the minimal final geometry
  // asserted.
  let previousCloseClamped = false;
  for (const how of ["cancel", "escape"] as const) {
    const opened = await openSwitch(page, "pointer");
    expect(
      expectOpening(`oversized, ${how}`, opened, {
        browserAnchoring: previousCloseClamped,
      }),
    ).toBe("oversized");
    expect(opened.deltas.length, "at most one reveal").toBeLessThanOrEqual(1);
    const { actions, message } = opened.open;
    if (!actions || !message) throw new Error("expected the confirmation to lay out");
    // Exactly to the band's bottom: the row, and no further.
    expect(Math.abs(actions.bottom - opened.open.bandBottom)).toBeLessThanOrEqual(
      EDGE_TOLERANCE,
    );
    // The explanation's start is still reachable by scrolling up.
    expect(opened.open.scrollY + message.top).toBeGreaterThanOrEqual(
      opened.open.bandTop - 1,
    );
    note(
      `oversized, ${how}`,
      opened.deltas.length > 0
        ? `app revealed by ${String(opened.deltas[0])}px`
        : "app reveal not needed",
    );
    const closed = await closeSwitch(page, how);
    note(`oversized, ${how} closed`, expectCancellation(`oversized, ${how}`, closed));
    previousCloseClamped = closed.after.maxScrollY < closed.open.scrollY;
  }
  expect(await readActiveRideStateRow(page)).toEqual(rideRow);
});

// --------------------------------------------------------------------------
// Scrolling by hand while it is open. The save area ends the page, so in an
// ordinary phone window the confirmation opens at the document's foot and
// is revealed there; the rider then scrolls back up with a real wheel.

function middleOf(box: Box | null, label: string): number {
  if (!box) throw new Error(`expected ${label} to lay out`);
  return (box.top + box.bottom) / 2;
}

test("a manual wheel scroll while open is kept, renders do not reveal again, and an Open saved route scrolled out of view is corrected by the minimum", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openPlanning(page, context, { language: "en", ride: "paused-route" });
  const rideRow = await readActiveRideStateRow(page);
  await planRoute(page, "en", "Manual scroll");
  await placeTop(page, SAVE_BUTTON, (await snapshot(page)).bandTop + 16);
  expectFeedbackShown("Save", await pressSave(page));

  const first = await openSwitch(page, "pointer");
  note("first opening", expectOpening("first opening", first));

  // (i) A real wheel over the explanation, a small way back up: Open saved
  // route stays inside the band.
  await page.mouse.move(195, middleOf(first.open.message, "the explanation"));
  await page.mouse.wheel(0, -30);
  await settle(page);
  let s = await snapshot(page);
  expect(s.scrollY, "the wheel moved the page up").toBeLessThan(first.open.scrollY);
  expect(s.open && isWithinBand(s.open, s)).toBe(true);
  // At least one useNow tick re-renders Planning while it is open.
  await recordDeliberateScrolls(page);
  await page.waitForTimeout(1_200);
  expect(await deliberateScrolls(page), "no reveal on an unrelated render").toEqual([]);
  expect((await snapshot(page)).cancelFocused).toBe(true);
  const kept = await closeSwitch(page, "cancel");
  expect(expectCancellation("manual scroll, Open visible", kept)).toBe("kept");
  expect(kept.after.scrollY).not.toBe(first.open.scrollY);

  // (ii) Reopened, then wheeled back up until Open saved route — and the
  // confirmation with it — is below the band, focus still on Cancel: a
  // real Escape.
  // Measured in Chromium, not WebKit: Cancel's collapse had clamped the
  // page short of where the wheel left it, and on this reopen — no scroll
  // in between — Chromium's scroll anchoring first restores that position
  // (202px here) before the app's reveal adds only the rest. With `overflow-anchor: none` as a
  // control the app's reveal does the whole distance and the page ends at
  // the same position, so the minimal final geometry is asserted, and the
  // browser's share recorded rather than attributed to the app.
  const reopened = await openSwitch(page, "pointer");
  expectOpening("reopened", reopened, { browserAnchoring: true });
  s = await snapshot(page);
  if (!s.open) throw new Error("expected Open saved route to lay out");
  await page.mouse.move(195, middleOf(s.message, "the explanation"));
  await page.mouse.wheel(0, -(s.bandBottom - s.open.top + 40));
  await settle(page);
  s = await snapshot(page);
  expect(s.open && s.open.top > s.bandBottom, "Open saved route below the band").toBe(
    true,
  );
  expect(s.cancelFocused).toBe(true);
  const corrected = await closeSwitch(page, "escape");
  expect(expectCancellation("manual scroll, Open below the band", corrected)).toBe(
    "corrected",
  );
  expect(
    Math.abs((corrected.after.open?.bottom ?? 0) - corrected.after.bandBottom),
  ).toBeLessThanOrEqual(EDGE_TOLERANCE);
  expect(await readActiveRideStateRow(page)).toEqual(rideRow);
});

// --------------------------------------------------------------------------
// A window tall enough for the whole Planning page (a desktop window or a
// tablet, not a phone): the confirmation fits where it opens, so nothing
// moves at all. In the phone-sized window above, no position of the save
// area leaves that room, which the matrix records rather than hides.

test.describe("a window tall enough for the whole Planning page", () => {
  // 1900px since item 122: the map reaches its 560px ceiling here, 100px
  // taller than before, so 1800px no longer leaves the confirmation room.
  test.use({ viewport: { width: 390, height: 1900 } });

  test("the confirmation fits beneath Open saved route: opening, Cancel and Escape move nothing", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await openPlanning(page, context, { language: "en", ride: "paused-route" });
    const rideRow = await readActiveRideStateRow(page);
    await planRoute(page, "en", "Tall window");
    // The routed draft is still longer than the window; saving resets it to
    // a page that fits.
    const s = await snapshot(page);
    await placeTop(page, SAVE_BUTTON, s.bandBottom - (s.save?.height ?? 0) - 4);
    note("Save", expectFeedbackShown("Save", await pressSave(page)));
    const fitted = await snapshot(page);
    expect(fitted.maxScrollY, "the saved, reset page fits the window").toBe(0);

    for (const how of ["cancel", "escape"] as const) {
      const opened = await openSwitch(page, "pointer");
      expect(expectOpening(`tall window, ${how}`, opened)).toBe("fits");
      expect(opened.deltas, "no deliberate scroll").toEqual([]);
      expect(opened.open.scrollY, "page unmoved").toBe(opened.before.scrollY);
      const closed = await closeSwitch(page, how);
      expect(expectCancellation(`tall window, ${how}`, closed)).toBe("kept");
      expect(closed.after.scrollY).toBe(opened.before.scrollY);
    }
    expect(await readActiveRideStateRow(page)).toEqual(rideRow);
  });
});

// --------------------------------------------------------------------------
// A new draft begun while the confirmation is open: closing it also clears
// the feedback, so focus goes to the save area's heading instead.

test("a new draft begun while open: Cancel and Escape move focus to the save area's heading, and only as far as reveals it", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openPlanning(page, context, { language: "en", ride: "paused-route" });
  const rideRow = await readActiveRideStateRow(page);

  // Cancel, after renaming: the heading is already in view, so nothing moves.
  await planRoute(page, "en", "Renamed while open");
  await placeTop(page, SAVE_BUTTON, (await snapshot(page)).bandTop + 16);
  expectFeedbackShown("first Save", await pressSave(page));
  await placeTop(page, SAVE_HEADING, (await snapshot(page)).bandTop + 16);
  const renamed = await openSwitch(page, "pointer");
  expectOpening("before renaming", renamed);
  const resetName = await page.locator("#planning-route-name").inputValue();
  await pointerPress(page, "#planning-route-name");
  await page.keyboard.type(" next");
  await expect(page.locator("#planning-route-name")).not.toHaveValue(resetName);
  // The feedback is kept while its confirmation is open.
  await expect(page.locator(FEEDBACK)).toHaveCount(1);
  await expect(page.locator(DIALOG)).toHaveCount(1);
  await settle(page);
  const cancelled = await closeSwitch(page, "cancel");
  expect(cancelled.after.feedback, "feedback cleared once closed").toBeNull();
  expect(expectCancellation("renamed, Cancel", cancelled, "heading")).toBe("kept");

  // Escape, after a waypoint added on the map (the map click is setup and
  // may scroll): the heading is then out of view, so it is revealed by the
  // minimum. Focus is put back on Cancel without scrolling, as a keyboard
  // rider returning to the confirmation would, before the real Escape.
  await planRoute(page, "en", "Waypoint added while open");
  await placeTop(page, SAVE_BUTTON, (await snapshot(page)).bandTop + 16);
  expectFeedbackShown("second Save", await pressSave(page));
  await openSwitch(page, "pointer");
  await page.getByTestId("map-container").click({ position: { x: 150, y: 120 } });
  await expect(page.locator(".waypoint-list li")).toHaveCount(1);
  await expect(page.locator(FEEDBACK)).toHaveCount(1);
  await page.evaluate((selector) => {
    document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }, CANCEL);
  await settle(page);
  const escaped = await closeSwitch(page, "escape");
  expect(escaped.after.feedback, "feedback cleared once closed").toBeNull();
  note("waypoint, Escape", expectCancellation("waypoint, Escape", escaped, "heading"));
  expect(await readActiveRideStateRow(page)).toEqual(rideRow);
});
