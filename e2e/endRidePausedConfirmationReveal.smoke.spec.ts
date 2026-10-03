import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Backlog item 124's inventory case C-11, slice 8: the paused route screen's
// End ride confirmation, in both engines (this file runs under the "chromium"
// and "webkit-smoke" projects), at 390x844 portrait, in English and German,
// at ordinary and 200% root text, on the in-session paused screen and on item
// 132's cold-start paused screen.
//
// The rule (the common policy approved on 3 October 2026, and the rider's
// decision to correct C-11 the same day):
// - opening: no movement when the confirmation fits the usable band where it
//   opens; otherwise the minimum movement that shows all of it; and when it
//   is taller than the band, only as far as completes its Cancel/End ride row
//   — none when that row already shows. Once per opening; Cancel takes focus
//   without the browser's own focus scroll;
// - Cancel and Escape: the ride stays paused, focus returns to End ride
//   without the browser's own focus scroll, and the page moves only as far
//   as reveals End ride itself — the rider's position, including scrolling
//   done while the confirmation was open, is otherwise kept, apart from the
//   clamping a shorter page forces.
//
// The usable band is the one the app measures: from the sticky navigation's
// bottom (or the visual viewport's top) plus 8 px, to the visual viewport's
// bottom less the safe-area inset and 8 px.
//
// Input is real — pointer clicks at measured centres, key presses and wheel
// input — except where a step is labelled synthetic: the browser's scroll
// anchoring switched off for the confirmation that reappears after Pause,
// and a Pause write held open by the app's own e2e seam. The app's own scroll
// calls are recorded, and so are focus calls made by script that actually
// moved focus, with the page's geometry just before them, so the same
// assertion judges an unchanged build's browser focus scroll and the repair's
// deliberate reveal. Outcomes are labelled:
// - [behaviour] what the rider sees: the focused control, what is inside the
//   band, a movement of exactly the minimum, and the ride still paused;
// - [implementation] how: focus calls with preventScroll, and the app's one
//   scroll call accounting for all the movement.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const GAP = 8;
const TOLERANCE_PX = 1;

const ROUTE_NAME = "end-ride-reveal-route";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 50;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

const OLD_DRAFT = {
  id: "draft",
  waypoints: [
    { id: "wp-a", coordinate: [-0.1, 51.5] },
    { id: "wp-b", coordinate: [-0.09, 51.51] },
  ],
  routeName: "Unsaved plan",
  avoidFerries: true,
  profile: "cycling-road",
  updatedAt: "2026-10-03T08:00:00.000Z",
};

const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];
const TEXT_SIZES = ["100%", "200%"] as const;
type TextSize = (typeof TEXT_SIZES)[number];

const COPY = {
  en: {
    endRide: "End ride",
    confirmTitle: "End this ride?",
    cancel: "Cancel",
    startRiding: "Start riding",
    resumeRide: "Resume ride",
    pause: "Pause",
    pausing: "Pausing…",
    ride: "Ride",
    routes: "Routes",
    chooseRoute: "Choose a route",
    editCopy: "Edit copy",
    editTitle: "Replace your current draft?",
  },
  de: {
    endRide: "Fahrt beenden",
    confirmTitle: "Diese Fahrt beenden?",
    cancel: "Abbrechen",
    startRiding: "Fahrt starten",
    resumeRide: "Fahrt fortsetzen",
    pause: "Pause",
    pausing: "Wird pausiert…",
    ride: "Fahren",
    routes: "Routen",
    chooseRoute: "Route wählen",
    editCopy: "Kopie bearbeiten",
    editTitle: "Aktuellen Entwurf ersetzen?",
  },
} as const;

interface Rect {
  top: number;
  bottom: number;
}

/** A focus call made by script that left focus on its target, with the
 * geometry just before the call. */
interface FocusRecord {
  text: string;
  dialogTitle: string | null;
  inPanelRow: boolean;
  inRidingHeader: boolean;
  preventScroll: boolean;
  scrollYBefore: number;
  scrollYAfter: number;
  maxScrollYBefore: number;
  targetBefore: Rect;
  dialogBefore: Rect | null;
  actionsBefore: Rect | null;
  bandBefore: Rect;
}

/** The in-page fixture state; see installFixtures. */
interface AcnFixture {
  scrolls: string[];
  scrollByDeltas: number[];
  focusCalls: FocusRecord[];
  elementScrolls: string[];
  watchStarts: number;
}
type FixtureWindow = Window & { __acn: AcnFixture };

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
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

/** Installed before any of the app's scripts run. */
async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript((gap) => {
    const fixture: AcnFixture = {
      scrolls: [],
      scrollByDeltas: [],
      focusCalls: [],
      elementScrolls: [],
      watchStarts: 0,
    };
    (window as unknown as FixtureWindow).__acn = fixture;

    const rectOf = (node: Element | null | undefined) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const bandNow = () => {
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
      return {
        top: Math.max(rectOf(header)?.bottom ?? 0, visibleTop) + gap,
        bottom: visibleBottom - (safeArea + gap),
      };
    };

    // The caller's own arguments are forwarded unchanged: scrollBy(options)
    // and scrollBy(x, y) are different overloads.
    const scrollBy = window.scrollBy.bind(window) as (...args: unknown[]) => void;
    window.scrollBy = (...args: unknown[]) => {
      fixture.scrolls.push(`scrollBy ${JSON.stringify(args)}`);
      const first = args[0];
      const delta =
        typeof first === "object" && first !== null
          ? ((first as ScrollToOptions).top ?? 0)
          : typeof args[1] === "number"
            ? args[1]
            : 0;
      fixture.scrollByDeltas.push(delta);
      scrollBy(...args);
    };
    const scrollTo = window.scrollTo.bind(window) as (...args: unknown[]) => void;
    window.scrollTo = (...args: unknown[]) => {
      fixture.scrolls.push(`scrollTo ${JSON.stringify(args)}`);
      scrollTo(...args);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: Element,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      fixture.scrolls.push(`scrollIntoView ${this.tagName}`);
      scrollIntoView.call(this, arg);
    };
    // Every element that scrolls, the fixed riding shell's section.screen
    // included; the document's own scrolling is read from scrollY.
    document.addEventListener(
      "scroll",
      (event) => {
        const target = event.target;
        if (target instanceof Element) {
          fixture.elementScrolls.push(`${target.tagName}.${target.className}`);
        }
      },
      { capture: true, passive: true },
    );
    // Location watches started, so a Cancel can be shown not to resume.
    const geolocation = navigator.geolocation;
    const watchPosition = geolocation.watchPosition.bind(geolocation);
    geolocation.watchPosition = (
      success: PositionCallback,
      error?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) => {
      fixture.watchStarts += 1;
      return watchPosition(success, error, options);
    };
    // Only calls that actually leave focus on their target are recorded: a
    // call on a disabled button does nothing. React's own autoFocus is a
    // focus() call made during its commit, so an unchanged build's opening
    // is recorded here too.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      const dialog = this.closest('[role="dialog"]');
      const scroller = document.scrollingElement ?? document.documentElement;
      const target = this.getBoundingClientRect();
      const before = {
        scrollYBefore: window.scrollY,
        maxScrollYBefore: scroller.scrollHeight - scroller.clientHeight,
        targetBefore: { top: target.top, bottom: target.bottom },
        dialogBefore: rectOf(dialog),
        actionsBefore: rectOf(dialog?.querySelector(".route-delete-confirm-actions")),
        bandBefore: bandNow(),
      };
      focus.call(this, options);
      if (document.activeElement !== this) return;
      fixture.focusCalls.push({
        text: this.textContent.trim(),
        dialogTitle: dialog?.querySelector("h2, h3, h4")?.textContent.trim() ?? null,
        inPanelRow: dialog === null && this.closest(".ride-end-ride-panel-row") !== null,
        inRidingHeader: this.closest(".riding-immersive-header") !== null,
        preventScroll: options?.preventScroll === true,
        scrollYAfter: window.scrollY,
        ...before,
      });
    };
  }, GAP);
}

/** The app's own seam (rideStateRepository.ts): holds the ride's next
 * persistence write — Pause's — open until released. Starts disarmed, and
 * disarms again on release so later writes are never held. */
async function installPauseWriteHold(page: Page): Promise<void> {
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
        w.__resolveRideStateWriteDelay = () => {
          armed = false;
          resolve();
        };
      });
    };
  });
}

async function writeRow(page: Page, store: string, row: object): Promise<void> {
  await page.evaluate(
    ({ dbName, store, row }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(row);
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
      }),
    { dbName: DB_NAME, store, row },
  );
}

/** Waits for scrollY to hold still over timer-driven samples (never
 * animation frames: headless WebKit can defer them). */
async function settle(page: Page, quietMs = 300): Promise<void> {
  await page.evaluate(
    (quietMs) =>
      new Promise<void>((resolve) => {
        let last = scrollY;
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          if (scrollY !== last) {
            last = scrollY;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > 5_000) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        setTimeout(tick, 25);
      }),
    quietMs,
  );
}

async function setRootText(page: Page, size: TextSize): Promise<void> {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = size;
  }, size);
  await page.waitForTimeout(150);
  await settle(page);
}

async function resetRecords(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    fixture.scrolls = [];
    fixture.scrollByDeltas = [];
    fixture.focusCalls = [];
    fixture.elementScrolls = [];
  });
}

const records = (page: Page): Promise<AcnFixture> =>
  page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    return {
      scrolls: [...fixture.scrolls],
      scrollByDeltas: [...fixture.scrollByDeltas],
      focusCalls: [...fixture.focusCalls],
      elementScrolls: [...fixture.elementScrolls],
      watchStarts: fixture.watchStarts,
    };
  });

interface Snapshot {
  scrollY: number;
  scrollX: number;
  maxScrollY: number;
  headerPresent: boolean;
  band: Rect;
  trigger: Rect | null;
  dialog: Rect | null;
  actions: Rect | null;
  title: Rect | null;
  cancelFocused: boolean;
  triggerFocused: boolean;
}

/** One atomic in-page read, so nothing can move between measurements. The
 * trigger is the paused panel's own End ride; the confirmation is End ride's
 * wherever it is. */
function snapshot(page: Page, language: Language): Promise<Snapshot> {
  return page.evaluate(
    ({ gap, title }) => {
      const rectOf = (node: Element | null | undefined) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
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
      const dialog =
        [...document.querySelectorAll('[role="dialog"]')].find(
          (node) => node.querySelector("h2, h3, h4")?.textContent.trim() === title,
        ) ?? null;
      const actions = dialog?.querySelector(".route-delete-confirm-actions") ?? null;
      const cancel = actions?.querySelector("button") ?? null;
      const trigger = document.querySelector(".ride-end-ride-panel-row > button");
      const scroller = document.scrollingElement ?? document.documentElement;
      return {
        scrollY: window.scrollY,
        scrollX: window.scrollX,
        maxScrollY: scroller.scrollHeight - scroller.clientHeight,
        headerPresent: header !== null,
        band: {
          top: Math.max(rectOf(header)?.bottom ?? 0, visibleTop) + gap,
          bottom: visibleBottom - (safeArea + gap),
        },
        trigger: rectOf(trigger),
        dialog: rectOf(dialog),
        actions: rectOf(actions),
        title: rectOf(dialog?.querySelector("h2, h3, h4")),
        cancelFocused: cancel !== null && document.activeElement === cancel,
        triggerFocused: trigger !== null && document.activeElement === trigger,
      };
    },
    { gap: GAP, title: COPY[language].confirmTitle },
  );
}

/** A real mouse click at the element's centre, after proving that point
 * lies inside the viewport and hits the element itself (or something inside
 * it) — never through Playwright's own scroll-into-view. */
async function pointerClick(page: Page, locator: Locator): Promise<void> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("pointerClick: element is not laid out");
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  expect(y, "the click point is inside the viewport").toBeGreaterThan(0);
  expect(y, "the click point is inside the viewport").toBeLessThan(844);
  const hits = await locator.evaluate(
    (element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit !== null && (hit === element || element.contains(hit));
    },
    { x, y },
  );
  expect(hits, "the click point hits the intended element").toBe(true);
  await page.mouse.click(x, y);
}

/** Wheel input over ordinary page content, never the map or the header. */
async function wheelBy(page: Page, dy: number): Promise<void> {
  const point = await page.evaluate(() => {
    for (let y = innerHeight - 30; y > 100; y -= 20) {
      const hit = document.elementFromPoint(6, y);
      if (hit && !hit.closest(".maplibregl-map, [data-testid='map-container'], header")) {
        return { x: 6, y };
      }
    }
    throw new Error("no wheel point outside the map");
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, dy);
  await settle(page);
}

const panelTrigger = (page: Page): Locator =>
  page.locator(".ride-end-ride-panel-row > button");
const headerTrigger = (page: Page, language: Language): Locator =>
  page
    .locator(".riding-immersive-header")
    .getByRole("button", { name: COPY[language].endRide, exact: true });
const confirmation = (page: Page, language: Language): Locator =>
  page.getByRole("dialog", { name: COPY[language].confirmTitle });
const cancelButton = (page: Page, language: Language): Locator =>
  confirmation(page, language).getByRole("button", {
    name: COPY[language].cancel,
    exact: true,
  });
const resumeButton = (page: Page, language: Language): Locator =>
  page.getByRole("button", { name: COPY[language].resumeRide, exact: true });

function note(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

const round = (value: number) => Math.round(value * 10) / 10;

async function routeFileImport(page: Page): Promise<string> {
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${ROUTE_NAME}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });
  await expect(page.getByRole("button", { name: ROUTE_NAME, exact: true })).toBeVisible();
  const routeId = await readSavedRouteId(page, ROUTE_NAME);
  if (!routeId) throw new Error("expected the imported route's id");
  return routeId;
}

async function prepare(
  page: Page,
  context: BrowserContext,
  { holdPauseWrite = false }: { holdPauseWrite?: boolean } = {},
): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await installLocalMapStyle(page);
  await installFixtures(page);
  if (holdPauseWrite) await installPauseWriteHold(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  return pageErrors;
}

/** Imports the route, applies the language and opens the route's pre-ride
 * screen from Routes. */
async function openRoute(page: Page, language: Language): Promise<void> {
  await page.goto("/");
  await routeFileImport(page);
  if (language !== "en") {
    await writeRow(page, "appPreferences", { id: "app", language });
    await page.reload();
  }
  await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
  await expect(
    page.getByRole("button", { name: COPY[language].startRiding }),
  ).toBeVisible();
}

/** The ride is tracking with a fix 400 m along the route. */
async function startRidingWithFix(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY[language].startRiding }),
  );
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "route", lastFix: expect.anything() });
}

/** Pause, and the paused screen settled under the returned navigation. */
async function pauseRide(page: Page, language: Language): Promise<void> {
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY[language].pause, exact: true }),
  );
  await expect(resumeButton(page, language)).toBeVisible();
  await expect(page.locator("header.app-header--sticky")).toBeAttached();
  await settle(page);
}

/** The in-session paused screen, at the page's top: the lowest position
 * End ride can be opened from at this viewport, where it already sits in
 * the band. */
async function openPaused(
  page: Page,
  context: BrowserContext,
  language: Language,
  size: TextSize,
): Promise<{ pageErrors: string[] }> {
  const pageErrors = await prepare(page, context);
  await openRoute(page, language);
  await startRidingWithFix(page, context, language);
  await pauseRide(page, language);
  await expect(panelTrigger(page)).toBeEnabled();
  await setRootText(page, size);
  return { pageErrors };
}

/** Item 132's paused route screen after a reload — the browser's stand-in
 * for fully closing and reopening the installed PWA, not device evidence. */
async function openColdStartPaused(
  page: Page,
  context: BrowserContext,
  language: Language,
  size: TextSize,
): Promise<{ pageErrors: string[] }> {
  const pageErrors = await prepare(page, context);
  await openRoute(page, language);
  await startRidingWithFix(page, context, language);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: COPY[language].routes }),
  ).toBeVisible();
  await page.getByRole("button", { name: COPY[language].ride, exact: true }).click();
  await expect(resumeButton(page, language)).toBeVisible();
  await expect(panelTrigger(page)).toBeEnabled();
  await setRootText(page, size);
  return { pageErrors };
}

interface Opening {
  before: Snapshot;
  after: Snapshot;
  fixture: AcnFixture;
}

/** Opens End ride's confirmation from the paused panel: a real click on End
 * ride, or — where it is out of reach of the pointer — keyboard activation
 * of the button, focused without scrolling. */
async function openEndRide(
  page: Page,
  language: Language,
  how: "pointer" | "keyboard" = "pointer",
): Promise<Opening> {
  const trigger = panelTrigger(page);
  if (how === "keyboard") {
    await trigger.evaluate((element) => {
      (element as HTMLElement).focus({ preventScroll: true });
    });
  }
  await resetRecords(page);
  const before = await snapshot(page, language);
  if (how === "pointer") await pointerClick(page, trigger);
  else await page.keyboard.press("Enter");
  await expect(confirmation(page, language)).toBeVisible();
  await settle(page);
  return { before, after: await snapshot(page, language), fixture: await records(page) };
}

type Branch =
  | "fits, no movement"
  | "minimum reveal"
  | "oversized, action row"
  | "oversized, row shows";

/** The movement window.scrollBy would make for `delta`, clamped to the
 * page's own scrollable range from the recorded position. */
function clampDelta(record: FocusRecord, delta: number): number {
  const target = Math.min(
    Math.max(record.scrollYBefore + delta, 0),
    record.maxScrollYBefore,
  );
  return target - record.scrollYBefore;
}

/** The opening rule, applied to the confirmation's geometry just before
 * Cancel's focus call. */
function warrantedOpening(record: FocusRecord): { delta: number; branch: Branch } {
  const dialog = record.dialogBefore;
  const actions = record.actionsBefore;
  if (!dialog || !actions) throw new Error("the focus call recorded no confirmation");
  const band = record.bandBefore;
  const fits = dialog.bottom - dialog.top <= band.bottom - band.top;
  let delta = 0;
  if (fits) {
    if (dialog.bottom > band.bottom) delta = dialog.bottom - band.bottom;
    else if (dialog.top < band.top) delta = dialog.top - band.top;
  } else if (actions.bottom > band.bottom) delta = actions.bottom - band.bottom;
  else if (actions.top < band.top) delta = actions.top - band.top;
  if (Math.abs(delta) < TOLERANCE_PX) delta = 0;
  const branch: Branch = fits
    ? delta === 0
      ? "fits, no movement"
      : "minimum reveal"
    : delta === 0
      ? "oversized, row shows"
      : "oversized, action row";
  return { delta: clampDelta(record, delta), branch };
}

/** The cancellation rule: the smallest movement that brings End ride itself
 * into the band, from its geometry just before the focus call. */
function warrantedReturn(record: FocusRecord): number {
  const target = record.targetBefore;
  const band = record.bandBefore;
  let delta = 0;
  if (target.bottom > band.bottom) delta = target.bottom - band.bottom;
  else if (target.top < band.top) delta = target.top - band.top;
  if (Math.abs(delta) < TOLERANCE_PX) delta = 0;
  return clampDelta(record, delta);
}

const inBand = (rect: Rect | null, band: Rect) =>
  rect !== null &&
  rect.top >= band.top - TOLERANCE_PX &&
  rect.bottom <= band.bottom + TOLERANCE_PX;

/** Asserts one opening against the rule and returns the branch it took. */
function expectOpening(label: string, language: Language, opening: Opening): Branch {
  const { after, fixture } = opening;
  const calls = fixture.focusCalls.filter(
    (call) =>
      call.dialogTitle === COPY[language].confirmTitle &&
      call.text === COPY[language].cancel,
  );
  expect(calls, `${label}: one focus call landed on Cancel`).toHaveLength(1);
  const call = calls[0];
  const { delta, branch } = warrantedOpening(call);
  const moved = after.scrollY - call.scrollYBefore;
  const appMoved = fixture.scrollByDeltas.reduce((sum, d) => sum + d, 0);
  const height = (call.dialogBefore?.bottom ?? 0) - (call.dialogBefore?.top ?? 0);
  note(
    "opening",
    JSON.stringify({
      label,
      branch,
      triggerBefore: opening.before.trigger,
      scrollYBeforeOpening: opening.before.scrollY,
      band: call.bandBefore,
      dialogBefore: call.dialogBefore,
      actionsBefore: call.actionsBefore,
      height: round(height),
      warranted: round(delta),
      moved: round(moved),
      browserFocusScroll: round(call.scrollYAfter - call.scrollYBefore),
      appScrolls: fixture.scrolls,
      preventScroll: call.preventScroll,
      dialogAfter: after.dialog,
      actionsAfter: after.actions,
      titleAfter: after.title,
    }),
  );
  expect.soft(after.cancelFocused, `[behaviour] ${label}: Cancel has focus`).toBe(true);
  expect
    .soft(
      Math.abs(moved - delta),
      `[behaviour] ${label}: moved ${moved.toFixed(1)} px; the rule warrants ${delta.toFixed(1)} px (${branch})`,
    )
    .toBeLessThanOrEqual(TOLERANCE_PX);
  expect
    .soft(
      inBand(after.actions, after.band),
      `[behaviour] ${label}: the complete action row is in the band`,
    )
    .toBe(true);
  if (branch === "fits, no movement" || branch === "minimum reveal") {
    expect
      .soft(
        inBand(after.dialog, after.band),
        `[behaviour] ${label}: the whole confirmation, its title included, is in the band`,
      )
      .toBe(true);
  }
  expect.soft(after.scrollX, `[behaviour] ${label}: no horizontal scroll`).toBe(0);
  expect
    .soft(call.preventScroll, `[implementation] ${label}: focus({ preventScroll: true })`)
    .toBe(true);
  expect
    .soft(
      fixture.scrolls.length,
      `[implementation] ${label}: at most one deliberate scroll: ${fixture.scrolls.join("; ")}`,
    )
    .toBeLessThanOrEqual(delta === 0 ? 0 : 1);
  expect
    .soft(
      Math.abs(appMoved - moved),
      `[implementation] ${label}: the app's own scroll (${appMoved.toFixed(1)} px) accounts for all the movement`,
    )
    .toBeLessThanOrEqual(TOLERANCE_PX);
  return branch;
}

interface Cancellation {
  before: Snapshot;
  after: Snapshot;
  fixture: AcnFixture;
}

/** Cancel by pointer or Escape, measured from just before the input to
 * after the page has settled. */
async function cancelEndRide(
  page: Page,
  language: Language,
  how: "pointer" | "escape",
): Promise<Cancellation> {
  const before = await snapshot(page, language);
  await resetRecords(page);
  if (how === "pointer") await pointerClick(page, cancelButton(page, language));
  else await page.keyboard.press("Escape");
  await expect(confirmation(page, language)).toHaveCount(0);
  await settle(page);
  return { before, after: await snapshot(page, language), fixture: await records(page) };
}

/** Asserts a focus return to the paused panel's End ride: focus there
 * without the browser's own focus scroll, then exactly the movement that
 * reveals End ride itself, judged from its geometry just before the app's
 * focus call. `keptFrom` is the position before the Cancel when the page is
 * the same page throughout: what happened before the focus call must then
 * be the clamping a shorter page forces, and nothing more. */
function expectFocusReturn(
  label: string,
  language: Language,
  result: Cancellation,
  { keptFrom }: { keptFrom: number | null },
): void {
  const { after, fixture } = result;
  const calls = fixture.focusCalls.filter(
    (call) => call.inPanelRow && call.text === COPY[language].endRide,
  );
  expect
    .soft(calls.length, `[behaviour] ${label}: one focus call returned to End ride`)
    .toBe(1);
  expect
    .soft(after.triggerFocused, `[behaviour] ${label}: End ride has focus`)
    .toBe(true);
  expect
    .soft(
      inBand(after.trigger, after.band),
      `[behaviour] ${label}: End ride is in the band (${JSON.stringify({ trigger: after.trigger, band: after.band })})`,
    )
    .toBe(true);
  expect.soft(after.scrollX, `[behaviour] ${label}: no horizontal scroll`).toBe(0);
  const call = calls[0];
  if (calls.length !== 1) return;
  const delta = warrantedReturn(call);
  const moved = after.scrollY - call.scrollYBefore;
  const appMoved = fixture.scrollByDeltas.reduce((sum, d) => sum + d, 0);
  const clamped = keptFrom === null ? null : Math.min(keptFrom, after.maxScrollY);
  note(
    "return",
    JSON.stringify({
      label,
      scrollYBeforeCancel: keptFrom,
      clampedPosition: clamped,
      scrollYAtFocus: call.scrollYBefore,
      beforeFocus: clamped === null ? null : round(call.scrollYBefore - clamped),
      band: call.bandBefore,
      triggerBefore: call.targetBefore,
      warranted: round(delta),
      moved: round(moved),
      browserFocusScroll: round(call.scrollYAfter - call.scrollYBefore),
      appScrolls: fixture.scrolls,
      preventScroll: call.preventScroll,
      triggerAfter: after.trigger,
    }),
  );
  expect
    .soft(
      Math.abs(moved - delta),
      `[behaviour] ${label}: moved ${moved.toFixed(1)} px after the collapse; revealing End ride warrants ${delta.toFixed(1)} px`,
    )
    .toBeLessThanOrEqual(TOLERANCE_PX);
  if (clamped !== null) {
    expect
      .soft(
        Math.abs(call.scrollYBefore - clamped),
        `[behaviour] ${label}: the position was kept until the focus return, apart from clamping (${call.scrollYBefore.toFixed(1)} against ${clamped.toFixed(1)})`,
      )
      .toBeLessThanOrEqual(TOLERANCE_PX);
  }
  expect
    .soft(call.preventScroll, `[implementation] ${label}: focus({ preventScroll: true })`)
    .toBe(true);
  expect
    .soft(
      fixture.scrolls.length,
      `[implementation] ${label}: at most one deliberate scroll: ${fixture.scrolls.join("; ")}`,
    )
    .toBeLessThanOrEqual(delta === 0 ? 0 : 1);
  expect
    .soft(
      Math.abs(appMoved - moved),
      `[implementation] ${label}: the app's own scroll (${appMoved.toFixed(1)} px) accounts for all the movement after the collapse`,
    )
    .toBeLessThanOrEqual(TOLERANCE_PX);
}

type StoredRow = Awaited<ReturnType<typeof readActiveRideStateRow>>;

/** The ride is exactly as paused: the same stored row, Resume ride offered,
 * and no location watch started. */
async function expectStillPaused(
  page: Page,
  language: Language,
  row: StoredRow,
  watchStarts: number,
): Promise<void> {
  expect
    .soft(
      await readActiveRideStateRow(page),
      "[behaviour] the stored session is unchanged",
    )
    .toEqual(row);
  await expect(resumeButton(page, language)).toBeVisible();
  expect
    .soft((await records(page)).watchStarts, "[behaviour] no location watch started")
    .toBe(watchStarts);
}

// ---------------------------------------------------------------------------
// The in-session paused screen: the opening, then an immediate Cancel or
// Escape.

for (const language of LANGUAGES) {
  for (const size of TEXT_SIZES) {
    const how =
      (language === "de" && size === "100%") || (language === "en" && size === "200%")
        ? "escape"
        : "pointer";
    test(`(${language}, ${size}) paused: the opening moves only as the rule warrants; ${how === "escape" ? "Escape" : "Cancel"} returns focus to End ride, revealing only End ride, and keeps the ride paused`, async ({
      page,
      context,
    }) => {
      const { pageErrors } = await openPaused(page, context, language, size);
      const row = await readActiveRideStateRow(page);
      const { watchStarts } = await records(page);
      const opening = await openEndRide(page, language);
      note("branch", expectOpening("opening", language, opening));
      const result = await cancelEndRide(page, language, how);
      expectFocusReturn(how, language, result, { keptFrom: result.before.scrollY });
      await expectStillPaused(page, language, row, watchStarts);
      expect(pageErrors).toEqual([]);
    });
  }
}

// ---------------------------------------------------------------------------
// Item 132's paused route screen after a reload.

const COLD_START_CASES: readonly (readonly [Language, TextSize])[] = [
  ["en", "200%"],
  ["de", "200%"],
  ["en", "100%"],
];

for (const [language, size] of COLD_START_CASES) {
  test(`(${language}, ${size}) cold-start paused: the opening and Cancel follow the rule, and the ride stays paused`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { pageErrors } = await openColdStartPaused(page, context, language, size);
    const row = await readActiveRideStateRow(page);
    const { watchStarts } = await records(page);
    const opening = await openEndRide(page, language);
    note("branch", expectOpening("cold-start opening", language, opening));
    const result = await cancelEndRide(page, language, "pointer");
    expectFocusReturn("cold-start Cancel", language, result, {
      keptFrom: result.before.scrollY,
    });
    await expectStillPaused(page, language, row, watchStarts);
    expect(pageErrors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// Reopening after Cancel and a wheel scroll is measured afresh.

test("(en, 200%) reopening after Cancel and a wheel scroll is measured afresh", async ({
  page,
  context,
}) => {
  await openPaused(page, context, "en", "200%");
  const first = await openEndRide(page, "en");
  expectOpening("first opening", "en", first);
  await cancelEndRide(page, "en", "pointer");
  // Put End ride in a clearly different place, by real wheel input, while
  // keeping it clickable inside the band.
  const placed = await snapshot(page, "en");
  if (!placed.trigger) throw new Error("expected End ride to lay out");
  await wheelBy(page, placed.trigger.top - (placed.band.top + 120));
  const second = await openEndRide(page, "en");
  expectOpening("second opening", "en", second);
  const firstMoved = first.after.scrollY - first.before.scrollY;
  const secondMoved = second.after.scrollY - second.before.scrollY;
  note(
    "reopen",
    `first moved ${firstMoved.toFixed(1)} px, second ${secondMoved.toFixed(1)} px`,
  );
  expect
    .soft(
      Math.abs(firstMoved - secondMoved),
      "[behaviour] the second opening did not replay the first one's movement",
    )
    .toBeGreaterThan(TOLERANCE_PX);
  const result = await cancelEndRide(page, "en", "pointer");
  expectFocusReturn("second Cancel", "en", result, { keptFrom: result.before.scrollY });
});

// ---------------------------------------------------------------------------
// Cancellation after the rider has scrolled the open confirmation, by wheel:
// End ride's slot — the confirmation's own top, where End ride comes back —
// under the sticky navigation, partly above the viewport, or wholly above
// it. The first two keep Cancel tappable; the third is reachable from a
// keyboard only, so it is cancelled with Escape (desktop keyboard).

type Placement =
  "under the navigation" | "partly above the viewport" | "wholly above the viewport";

const SCROLLED_CASES: readonly (readonly [Language, TextSize, Placement])[] = [
  ["en", "100%", "under the navigation"],
  ["de", "100%", "under the navigation"],
  ["en", "200%", "under the navigation"],
  ["de", "200%", "under the navigation"],
  ["en", "100%", "partly above the viewport"],
  ["de", "200%", "partly above the viewport"],
  ["en", "100%", "wholly above the viewport"],
  ["en", "200%", "wholly above the viewport"],
];

for (const [language, size, placement] of SCROLLED_CASES) {
  const how = placement === "wholly above the viewport" ? "escape" : "pointer";
  test(`(${language}, ${size}) scrolled with End ride's slot ${placement}, then ${how === "escape" ? "Escape" : "Cancel"}: only the movement that reveals End ride`, async ({
    page,
    context,
  }) => {
    const { pageErrors } = await openPaused(page, context, language, size);
    const row = await readActiveRideStateRow(page);
    const { watchStarts } = await records(page);
    const closed = await snapshot(page, language);
    if (!closed.trigger) throw new Error("expected End ride to lay out");
    const triggerHeight = closed.trigger.bottom - closed.trigger.top;
    const opening = await openEndRide(page, language);
    expectOpening("opening", language, opening);

    const open = await snapshot(page, language);
    if (!open.dialog) throw new Error("expected the confirmation to lay out");
    const headerBottom = open.band.top - GAP;
    const slotTop =
      placement === "under the navigation"
        ? headerBottom - 32
        : placement === "partly above the viewport"
          ? -20
          : -(triggerHeight + 40);
    await wheelBy(page, open.dialog.top - slotTop);
    const placed = await snapshot(page, language);
    if (!placed.dialog) throw new Error("expected the confirmation to lay out");
    note(
      "placed",
      JSON.stringify({
        placement,
        slotTop: placed.dialog.top,
        triggerHeight,
        band: placed.band,
      }),
    );
    const reached =
      placement === "under the navigation"
        ? placed.dialog.top < headerBottom && placed.dialog.top > 0
        : placement === "partly above the viewport"
          ? placed.dialog.top < 0 && placed.dialog.top + triggerHeight > 0
          : placed.dialog.top + triggerHeight < 0;
    expect(reached, `wheel input put End ride's slot ${placement}`).toBe(true);
    expect(placed.cancelFocused, "Cancel kept focus while the page scrolled").toBe(true);

    const result = await cancelEndRide(page, language, how);
    expectFocusReturn(`${placement}, ${how}`, language, result, {
      keptFrom: result.before.scrollY,
    });
    await expectStillPaused(page, language, row, watchStarts);
    expect(pageErrors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// The separately recorded survivor (not fixed here): a confirmation left
// open in the riding header survives Pause and reappears in the paused panel.
// In that Pause commit the sticky navigation has not yet returned — App
// learns the ride has stopped from a passive effect — so the opening is
// judged only once it has, by where the confirmation and its actions end up.

const SURVIVOR_CASES: readonly (readonly [Language, TextSize, "off" | "default"])[] = [
  ["en", "200%", "off"],
  ["de", "200%", "off"],
  ["en", "100%", "off"],
  ["en", "200%", "default"],
];

for (const [language, size, anchoring] of SURVIVOR_CASES) {
  test(`(${language}, ${size}, scroll anchoring ${anchoring}) a confirmation surviving Pause reappears with its actions in the band once the navigation has returned`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const pageErrors = await prepare(page, context);
    await openRoute(page, language);
    await setRootText(page, size);
    await startRidingWithFix(page, context, language);
    await pointerClick(page, headerTrigger(page, language));
    await expect(confirmation(page, language)).toBeVisible();
    if (anchoring === "off") {
      // Synthetic: the browser's scroll anchoring switched off, so the result
      // cannot depend on it compensating for the navigation's return.
      await page.evaluate(() => {
        document.documentElement.style.overflowAnchor = "none";
        document.body.style.overflowAnchor = "none";
      });
    }
    await resetRecords(page);
    await pointerClick(
      page,
      page.getByRole("button", { name: COPY[language].pause, exact: true }),
    );
    await expect(resumeButton(page, language)).toBeVisible();
    await expect(
      confirmation(page, language),
      "the survivor is still open",
    ).toBeVisible();
    await expect(page.locator("header.app-header--sticky")).toBeAttached();
    await settle(page);
    const s = await snapshot(page, language);
    const fixture = await records(page);
    const fits =
      s.dialog !== null && s.dialog.bottom - s.dialog.top <= s.band.bottom - s.band.top;
    const cancelCall = fixture.focusCalls.find(
      (call) =>
        call.dialogTitle === COPY[language].confirmTitle &&
        call.text === COPY[language].cancel,
    );
    note(
      "survivor",
      JSON.stringify({
        scrollY: s.scrollY,
        band: s.band,
        dialog: s.dialog,
        actions: s.actions,
        title: s.title,
        fits,
        cancelFocused: s.cancelFocused,
        scrolls: fixture.scrolls,
        cancelFocus: cancelCall
          ? {
              preventScroll: cancelCall.preventScroll,
              scrolled: round(cancelCall.scrollYAfter - cancelCall.scrollYBefore),
            }
          : null,
      }),
    );
    expect.soft(s.cancelFocused, "[behaviour] Cancel has focus").toBe(true);
    expect
      .soft(
        inBand(s.actions, s.band),
        `[behaviour] the complete action row is in the band once the navigation has returned (${JSON.stringify({ actions: s.actions, band: s.band })})`,
      )
      .toBe(true);
    if (fits) {
      expect
        .soft(
          inBand(s.dialog, s.band),
          "[behaviour] the whole confirmation, its title included, is in the band",
        )
        .toBe(true);
    }
    // A minimum reveal leaves the confirmation's bottom (or, oversized, its
    // action row's) on the band's bottom edge; with no reveal it is simply
    // inside the band, as asserted above.
    if (fixture.scrolls.length > 0) {
      const edge = fits ? s.dialog?.bottom : s.actions?.bottom;
      expect
        .soft(
          Math.abs((edge ?? Number.NaN) - s.band.bottom),
          "[behaviour] the reveal moved no further than the band's bottom edge",
        )
        .toBeLessThanOrEqual(TOLERANCE_PX);
    }
    expect
      .soft(
        cancelCall?.preventScroll,
        "[implementation] Cancel focused with preventScroll on reappearing",
      )
      .toBe(true);
    expect
      .soft(fixture.scrolls.length, "[implementation] at most one deliberate scroll")
      .toBeLessThanOrEqual(1);
    const result = await cancelEndRide(page, language, "pointer");
    expectFocusReturn("survivor's Cancel", language, result, {
      keptFrom: result.before.scrollY,
    });
    expect(pageErrors).toEqual([]);
  });
}

// Both confirmations surviving together (D-07's pair): End ride's is the one
// whose Cancel is focused, and its actions end in the band. Chromium only, as
// a single real-geometry check of the effects' order; the unit tests pin the
// order itself.
test("(en, 200%) with Edit copy's confirmation reappearing too, End ride's actions end in the band with its Cancel focused", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "one real-geometry check of the order");
  test.setTimeout(90_000);
  await openPaused(page, context, "en", "200%");
  await writeRow(page, "planningDrafts", OLD_DRAFT);
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY.en.editCopy, exact: true }),
  );
  await expect(page.getByRole("dialog", { name: COPY.en.editTitle })).toBeVisible();
  await settle(page);
  // Below Edit copy's revealed confirmation: activated from the keyboard.
  await openEndRide(page, "en", "keyboard");
  await resumeButton(page, "en").evaluate((element) => {
    (element as HTMLElement).focus({ preventScroll: true });
  });
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: COPY.en.pause, exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    document.documentElement.style.overflowAnchor = "none";
    document.body.style.overflowAnchor = "none";
  });
  await resetRecords(page);
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY.en.pause, exact: true }),
  );
  await expect(resumeButton(page, "en")).toBeVisible();
  await expect(page.getByRole("dialog", { name: COPY.en.editTitle })).toBeVisible();
  await expect(confirmation(page, "en")).toBeVisible();
  await expect(page.locator("header.app-header--sticky")).toBeAttached();
  await settle(page);
  const s = await snapshot(page, "en");
  const fixture = await records(page);
  note(
    "both survivors",
    JSON.stringify({ scrolls: fixture.scrolls, actions: s.actions, band: s.band }),
  );
  expect.soft(s.cancelFocused, "[behaviour] End ride's Cancel has focus").toBe(true);
  expect
    .soft(inBand(s.actions, s.band), "[behaviour] End ride's action row is in the band")
    .toBe(true);
});

// ---------------------------------------------------------------------------
// A Cancel made in the riding header while a Pause is still being saved
// lands on the paused screen's End ride. Synthetic: the Pause write is held
// open by the app's own e2e seam; nothing in an ordinary flow makes that
// window wide enough to act in.

const HELD_CASES: readonly (readonly [Language, TextSize, "stays" | "Tab" | "wheel"])[] =
  [
    ["en", "100%", "stays"],
    ["en", "100%", "Tab"],
    ["de", "200%", "wheel"],
  ];

for (const [language, size, rider] of HELD_CASES) {
  test(`(${language}, ${size}) Cancel during a held Pause, then the rider ${rider === "stays" ? "does nothing" : `moves on with ${rider}`}`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const pageErrors = await prepare(page, context, { holdPauseWrite: true });
    await openRoute(page, language);
    await setRootText(page, size);
    await startRidingWithFix(page, context, language);
    await pointerClick(page, headerTrigger(page, language));
    await expect(confirmation(page, language)).toBeVisible();
    await page.evaluate(() => {
      (
        window as unknown as { __acnE2eArmRideStateWriteDelay?: () => void }
      ).__acnE2eArmRideStateWriteDelay?.();
    });
    await pointerClick(
      page,
      page.getByRole("button", { name: COPY[language].pause, exact: true }),
    );
    await expect(
      page.getByRole("button", { name: COPY[language].pausing }),
    ).toBeVisible();
    await pointerClick(page, cancelButton(page, language));
    await expect(confirmation(page, language)).toHaveCount(0);
    if (rider === "Tab") await page.keyboard.press("Tab");
    if (rider === "wheel") await page.mouse.wheel(0, 120);
    await resetRecords(page);
    await page.evaluate(() => {
      (
        window as unknown as { __resolveRideStateWriteDelay?: () => void }
      ).__resolveRideStateWriteDelay?.();
    });
    await expect(resumeButton(page, language)).toBeVisible();
    await expect(page.locator("header.app-header--sticky")).toBeAttached();
    await settle(page);
    const result: Cancellation = {
      before: await snapshot(page, language),
      after: await snapshot(page, language),
      fixture: await records(page),
    };
    if (rider === "stays") {
      expectFocusReturn("held Pause, rider waiting", language, result, {
        keptFrom: null,
      });
    } else {
      const toEndRide = result.fixture.focusCalls.filter(
        (call) => call.text === COPY[language].endRide,
      );
      note(
        "moved on",
        JSON.stringify({
          focusCalls: result.fixture.focusCalls,
          scrolls: result.fixture.scrolls,
        }),
      );
      expect
        .soft(result.after.triggerFocused, "[behaviour] End ride did not take focus")
        .toBe(false);
      expect
        .soft(toEndRide, "[behaviour] no focus call returned to End ride")
        .toEqual([]);
      expect
        .soft(result.fixture.scrolls, "[behaviour] the app did not move the page")
        .toEqual([]);
    }
    expect(pageErrors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// The riding header's confirmation (C-10), unchanged: it opens in its own row
// beneath the immersive header in a fixed shell that never scrolls, Cancel
// takes focus as it always has, and focus returns to the header's End ride.

const HEADER_CASES: readonly (readonly [Language, TextSize])[] = [
  ["en", "100%"],
  ["de", "200%"],
];

for (const [language, size] of HEADER_CASES) {
  test(`(${language}, ${size}) the riding header's confirmation (C-10) is unchanged: no scroll, and the same focus calls`, async ({
    page,
    context,
  }) => {
    const pageErrors = await prepare(page, context);
    await openRoute(page, language);
    await setRootText(page, size);
    await startRidingWithFix(page, context, language);
    const headerBox = () =>
      page.evaluate(() => {
        const r = document
          .querySelector(".riding-immersive-header")
          ?.getBoundingClientRect();
        return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
      });
    const shellBefore = await headerBox();
    const trigger = headerTrigger(page, language);
    for (const how of ["pointer", "escape"] as const) {
      await resetRecords(page);
      await pointerClick(page, trigger);
      await expect(cancelButton(page, language)).toBeFocused();
      expect
        .soft(await headerBox(), "[behaviour] the header did not move on opening")
        .toEqual(shellBefore);
      if (how === "pointer") await pointerClick(page, cancelButton(page, language));
      else await page.keyboard.press("Escape");
      await expect(confirmation(page, language)).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await settle(page);
      const fixture = await records(page);
      note(
        `header ${how}`,
        JSON.stringify({
          focusCalls: fixture.focusCalls,
          elementScrolls: fixture.elementScrolls,
        }),
      );
      expect
        .soft(
          await page.evaluate(() => scrollY),
          "[behaviour] the document did not scroll",
        )
        .toBe(0);
      expect
        .soft(
          fixture.elementScrolls.filter((entry) => entry.includes("screen")),
          "[behaviour] the riding shell did not scroll",
        )
        .toEqual([]);
      expect
        .soft(await headerBox(), "[behaviour] the header is unchanged")
        .toEqual(shellBefore);
      expect.soft(fixture.scrolls, "[implementation] no app scroll call").toEqual([]);
      expect
        .soft(
          fixture.focusCalls.map((call) => ({
            text: call.text,
            inRidingHeader: call.inRidingHeader,
            preventScroll: call.preventScroll,
          })),
          "[implementation] the same plain focus calls as before C-11: Cancel's autoFocus, then the header's End ride",
        )
        .toEqual([
          { text: COPY[language].cancel, inRidingHeader: false, preventScroll: false },
          {
            text: language === "de" ? "Beenden" : COPY.en.endRide,
            inRidingHeader: true,
            preventScroll: false,
          },
        ]);
    }
    expect(pageErrors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// End ride confirmed after a revealed opening: its ordinary operation,
// unchanged.

test("(de, 200%) End ride confirmed after the reveal ends the ride", async ({
  page,
  context,
}) => {
  await openPaused(page, context, "de", "200%");
  const opening = await openEndRide(page, "de");
  expectOpening("opening", "de", opening);
  await pointerClick(
    page,
    confirmation(page, "de").getByRole("button", { name: COPY.de.endRide, exact: true }),
  );
  await expect(page.getByRole("button", { name: COPY.de.chooseRoute })).toBeVisible();
  await expect.poll(() => readActiveRideStateRow(page)).toBeNull();
});
